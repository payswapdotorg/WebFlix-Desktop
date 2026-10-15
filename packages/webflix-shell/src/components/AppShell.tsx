import React, { useState } from "react";
import { theme } from "../theme";
import type {
  CatalogItem,
  Collection,
  EvaluationResult,
  ProviderAccountRecord,
} from "webflix-contracts";
import type {
  AdsQualificationItemOutcome,
  RankerAdapterDescriptor,
  RetentionScope,
  RetentionState,
  ResetLocalDataResult,
} from "webflix-application";
import type { SearchState } from "../states";
import { HomeScreen } from "./HomeScreen";
import { SearchScreen } from "./SearchScreen";
import { LibraryScreen } from "./LibraryScreen";
import { AccountsScreen } from "./AccountsScreen";
import { AdCenterPanel } from "./AdCenterPanel";
import { EvaluationPanel } from "./EvaluationPanel";
import { RankerAdapterSelector } from "./RankerAdapterSelector";
import { SettingsScreen } from "./SettingsScreen";

export type ScreenId =
  | "home"
  | "search"
  | "library"
  | "accounts"
  | "ads"
  | "evaluation"
  | "settings";

export const NAV_ITEMS: readonly { id: ScreenId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "search", label: "Search" },
  { id: "library", label: "Library" },
  { id: "accounts", label: "Accounts" },
  { id: "ads", label: "Ad Center" },
  { id: "evaluation", label: "MI Evaluation" },
  // P7-COMPOSE-1 (WF-021 surface): the retention/settings screen.
  { id: "settings", label: "Settings" },
];

export interface AppShellProps {
  readonly initialScreen?: ScreenId;
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly recentItems?: readonly CatalogItem[];
  readonly collections?: readonly Collection[];
  readonly localEntries?: readonly CatalogItem[];
  readonly searchState?: SearchState;
  readonly onPlay?: (item: CatalogItem) => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onDisconnect?: (accountId: string) => void;
  readonly onSearchQuery?: (query: string) => void;
  readonly onSearchSubmit?: (query: string) => void;
  readonly onRetrySearch?: () => void;
  /**
   * P9-UI-1 (order requirement 3 — the real local import path): passed
   * through to LibraryScreen; the host owns the actual file picker.
   * Absent = no import affordance rendered (never a dead control).
   */
  readonly onImportLocalFiles?: () => void;
  // DESKTOP-COMPOSITION-1 (the composition row the P4/P5 ledger rows
  // promised): the Ad Center + MI Evaluation surfaces mount props-driven,
  // flat-optional like every other screen prop. Defaults are the honest
  // never-run states — null / [] — NO faked data, NO invented defaults that
  // look like real results; the Phase-6 host app passes real data.
  /** Ad Center qualification read-outs; null = no qualification run yet. */
  readonly adCenterResults?: readonly AdsQualificationItemOutcome[] | null;
  /** The MI evaluation read-out; null = no evaluation run yet. */
  readonly evaluationResult?: EvaluationResult | null;
  /** The ranker adapter registry to offer; [] = none available (honest). */
  readonly rankerAdapterEntries?: readonly RankerAdapterDescriptor[];
  /** The stored adapter selection; null = never set (the default stays unselected). */
  readonly rankerSelectedAdapterId?: string | null;
  /** Fires with the adapter id when the user selects one (host wiring is Phase 6). */
  readonly onRankerAdapterSelectionChange?: (adapterId: string) => void;
  /** Optional honest status line; null = nothing rendered (nothing invented). */
  readonly rankerStatusNote?: string | null;
  // P7-COMPOSE-1 (WF-021 surface): the retention/settings surface mounts
  // props-driven, flat-optional like every other screen prop. Defaults are
  // the honest never-loaded states — null / null — NO faked data; the host
  // app passes the GetRetentionState output and wires the use cases.
  /** The retention state view model; null = not loaded yet (honest default). */
  readonly retentionState?: RetentionState | null;
  /** The last scoped reset's result, rendered verbatim; null = no reset yet. */
  readonly retentionResetResult?: ResetLocalDataResult | null;
  /** Fires on the explicit pause action (PauseHistoryTracking use case). */
  readonly onPauseHistoryTracking?: () => void;
  /** Fires on the explicit resume action (ResumeHistoryTracking use case). */
  readonly onResumeHistoryTracking?: () => void;
  /** Fires with the CONFIRMED scope (ResetLocalData use case). */
  readonly onResetLocalData?: (scope: RetentionScope) => void;
  /**
   * P9-UI-1 (order requirement 5 — the truthful connect outcome): the typed
   * outcome of the last REAL connect attempt, passed through to
   * AccountsScreen's honest status line. null = no attempt yet.
   */
  readonly connectOutcome?: { providerId: string; ok: boolean; reason: string } | null;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateRows: "auto auto 1fr auto",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    background: theme.colors.background,
    color: theme.colors.text,
  },
  header: { display: "flex", alignItems: "baseline", gap: theme.spacing.sm },
  brand: {
    fontSize: theme.typography.sizes.display,
    fontWeight: 700,
    letterSpacing: "0.5px",
    color: theme.colors.accent,
  },
  tagline: { color: theme.colors.textMuted },
  // P6-SHELL-RESPONSIVE-1: the nav carries its own responsive truth —
  // it wraps on narrow viewports (flexWrap was previously unset; the
  // host composed it in apps/web-client — that debt is now paid here).
  nav: { display: "flex", flexWrap: "wrap", gap: theme.spacing.sm },
  navButton: {
    background: "transparent",
    color: theme.colors.textMuted,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    // P6-SHELL-RESPONSIVE-1: the 44px touch-target bar is the shell's own
    // guarantee now (previously host-composed; additive prop only).
    minHeight: 44,
    cursor: "pointer",
    fontSize: theme.typography.sizes.md,
  },
  navButtonActive: {
    background: theme.colors.accent,
    borderColor: theme.colors.accent,
    color: "#08211b",
    fontWeight: 600,
  },
  main: { display: "block" },
  // The evaluation screen stack: RankerAdapterSelector above EvaluationPanel.
  screenStack: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
  },
  footer: {
    borderTop: `1px solid ${theme.colors.border}`,
    paddingTop: theme.spacing.sm,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
};

export function AppShell(props: AppShellProps) {
  const {
    initialScreen = "home",
    accounts = [],
    recentItems = [],
    collections = [],
    localEntries = [],
    searchState = { phase: "idle" },
    // Honest never-run defaults (DESKTOP-COMPOSITION-1): null results, an
    // empty registry, no stored selection, no status line — the panels'
    // own factual empty states render until a host app passes real data.
    adCenterResults = null,
    evaluationResult = null,
    rankerAdapterEntries = [],
    rankerSelectedAdapterId = null,
    onRankerAdapterSelectionChange,
    rankerStatusNote = null,
    // Honest never-loaded retention defaults (P7-COMPOSE-1): null state,
    // null reset result — the settings surface's own factual empty states
    // render until a host app passes real data.
    retentionState = null,
    retentionResetResult = null,
    onPauseHistoryTracking,
    onResumeHistoryTracking,
    onResetLocalData,
    onPlay,
    onConnect,
    onDisconnect,
    onSearchQuery,
    onSearchSubmit,
    onRetrySearch,
    onImportLocalFiles,
    connectOutcome = null,
  } = props;

  const [screen, setScreen] = useState<ScreenId>(initialScreen);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.brand}>{theme.name}</span>
        <span style={styles.tagline}>{theme.tagline}</span>
      </header>

      <nav aria-label="Primary" style={styles.nav}>
        {NAV_ITEMS.map((navItem) => (
          <button
            key={navItem.id}
            type="button"
            data-testid={`nav-${navItem.id}`}
            aria-current={screen === navItem.id ? "page" : undefined}
            style={
              screen === navItem.id
                ? { ...styles.navButton, ...styles.navButtonActive }
                : styles.navButton
            }
            onClick={() => setScreen(navItem.id)}
          >
            {navItem.label}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {screen === "home" && (
          <HomeScreen
            accounts={accounts}
            recentItems={recentItems}
            onNavigate={setScreen}
            onPlay={onPlay}
          />
        )}
        {screen === "search" && (
          <SearchScreen
            state={searchState}
            onQueryChange={onSearchQuery}
            onSubmit={onSearchSubmit}
            onRetry={onRetrySearch}
            onConnect={onConnect}
            onSelectItem={onPlay}
          />
        )}
        {screen === "library" && (
          <LibraryScreen
            collections={collections}
            localEntries={localEntries}
            onPlay={onPlay}
            onImportLocalFiles={onImportLocalFiles}
          />
        )}
        {screen === "accounts" && (
          <AccountsScreen
            accounts={accounts}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            connectOutcome={connectOutcome}
          />
        )}
        {screen === "settings" && (
          <SettingsScreen
            retentionState={retentionState}
            resetResult={retentionResetResult}
            onPauseHistoryTracking={onPauseHistoryTracking}
            onResumeHistoryTracking={onResumeHistoryTracking}
            onResetLocalData={onResetLocalData}
          />
        )}
        {screen === "ads" && <AdCenterPanel results={adCenterResults} />}
        {screen === "evaluation" && (
          <div style={styles.screenStack} data-testid="screen-evaluation">
            <RankerAdapterSelector
              entries={rankerAdapterEntries}
              selectedAdapterId={rankerSelectedAdapterId}
              onSelectionChange={(adapterId) => onRankerAdapterSelectionChange?.(adapterId)}
              statusNote={rankerStatusNote}
            />
            <EvaluationPanel result={evaluationResult} />
          </div>
        )}
      </main>

      {/* ADR-0003: the independent-value notice is permanent shell chrome. */}
      <footer data-testid="independent-value-notice" style={styles.footer}>
        {theme.notice.text}
      </footer>
    </div>
  );
}
