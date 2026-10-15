/**
 * P9-UI-1 (order requirements 1–5) — the WebFlix renderer boot: the shell
 * host that mounts the REAL webflix-shell (AppShell + every screen) over
 * the real session modules, in the baked webflix flavor ONLY.
 *
 * What this host is:
 *   - The WebFlix product surface. It imports NOTHING from @zcode/ui — the
 *     ZCode workspace Root, theme seeding and service-port admission never
 *     load into a WebFlix product process (main.tsx routes here only when
 *     the baked flavor is "webflix"; requirement 1).
 *   - A composition, not a fork: the shell components, the honest-state
 *     vocabulary, the contracts and the application-layer use cases are
 *     consumed AS-IS (relative source imports — the desktop package
 *     manifest is outside this order's allowed paths and gains no new
 *     dependency).
 *
 * Truthfulness rules pinned here (order requirements 3/4/5; freeze §2.3):
 *   - Local media works with NO network and NO credentials: a real Web file
 *     picker imports files the user picked; each becomes a playable object
 *     URL plus an honest CatalogItem (session library — stated in the UI,
 *     never implied).
 *   - Search never invents results. With no authorized transport in this
 *     build, a keyword query resolves to the honest requires-auth state; an
 *     official YouTube link resolves through the reviewed provider operation
 *     (the official IFrame embed) and plays immediately.
 *   - Accounts come ONLY from the real main-process OS-vault bridge
 *     (requirement 5): typed status, no tokens, fail-closed typed refusals.
 *     Connect is honestly UNAVAILABLE in this build (no operator-provisioned
 *     OAuth client — freeze AS-Q3); the typed outcome says exactly that.
 *   - Ad Center / MI Evaluation mount their engines' truthful never-run /
 *     none-available states — no engine is wired in the desktop host, so no
 *     results, metrics or adapters are invented.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { CatalogItem } from "../../../../../webflix-contracts/src/index.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import { AppShell } from "../../../../../webflix-shell/src/components/AppShell.js";
import { WatchScreen } from "../../../../../webflix-shell/src/components/WatchScreen.js";
import { theme } from "../../../../../webflix-shell/src/theme.js";
import {
  WEBFLIX_DOCUMENT_TITLE,
  WEBFLIX_MARK_ALT,
  WEBFLIX_MARK_SVG,
  webflixAboutLine,
} from "./brand.js";
import {
  bridgeUnavailableStatus,
  getWebFlixAccountsBridge,
  type WebFlixAccountPointer,
  type WebFlixAccountsStatus,
  type WebFlixConnectOutcome,
} from "./accountsBridge.js";
import { createLocalLibrarySession, type LocalLibrarySession } from "./localLibrarySession.js";
import { createRetentionSession, type RetentionSession } from "./retentionSession.js";
import { resolveSearchQuery, YOUTUBE_PROVIDER_ID } from "./searchFlow.js";
import { resolvePlayPlan, type WatchView } from "./watchPlan.js";

/** The renderer-entry HTML shell's ready contract (cited: index.html listens for this exact event name). */
const STARTUP_READY_EVENT = "zcode-react-startup-ready";

declare const __ZCODE_VERSION__: string | undefined;

/** The injected host dependencies — the seams the battery fakes; production uses the real ones. */
export interface WebFlixHostDeps {
  /** The account bridge (real preload bridge, or a test double). */
  readonly accountsBridge: ReturnType<typeof getWebFlixAccountsBridge>;
  /** Local-library session factory (default: createLocalLibrarySession). */
  readonly createLocalLibrary?: () => LocalLibrarySession;
  /** Retention session factory (default: createRetentionSession). */
  readonly createRetention?: () => RetentionSession;
  /** OS-path recovery for a picked file (default: the zcode preload's webUtils bridge, null off-desktop). */
  readonly resolveOsPath?: (file: File) => string | null;
  /** The product version line (default: the baked __ZCODE_VERSION__ define). */
  readonly appVersion?: string;
}

/** An app-wide error boundary with WebFlix styling only (no @zcode/ui dependency in this process). */
class WebFlixErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: theme.colors.background,
            color: theme.colors.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            data-testid="webflix-error-boundary"
            role="alert"
            style={{
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.danger}`,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              maxWidth: 520,
            }}
          >
            <h1 style={{ margin: 0, fontSize: theme.typography.sizes.xl }}>Something went wrong</h1>
            <p style={{ color: theme.colors.textMuted, lineHeight: 1.5 }}>
              WebFlix hit an unexpected error in this screen. The details below are exactly what was
              reported — nothing is summarized away.
            </p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: theme.typography.sizes.sm,
              }}
            >
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const hostStyles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: theme.colors.background,
    display: "flex",
    flexDirection: "column",
  },
  shell: { flex: 1, display: "flex", flexDirection: "column" },
  mark: { width: 22, height: 22, flex: "0 0 auto" },
  about: {
    borderTop: `1px solid ${theme.colors.border}`,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  vaultBanner: {
    margin: `0 ${theme.spacing.md}px`,
    marginTop: theme.spacing.sm,
    border: `1px solid ${theme.colors.warning}`,
    borderRadius: theme.radii.md,
    background: theme.colors.surface,
    color: theme.colors.warning,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
  },
  fileInput: { display: "none" },
};

/** Notifies the HTML startup shell that React committed (the inherited fade-out contract). */
function StartupReadyNotifier() {
  useEffect(() => {
    window.dispatchEvent(new Event(STARTUP_READY_EVENT));
  }, []);
  return null;
}

/**
 * The WebFlix product host: AppShell (Home / Search / Library / Accounts /
 * Ad Center / MI Evaluation / Settings) plus the watch view, wired to the
 * real session modules and the real account bridge.
 */
export function WebFlixHost(deps: WebFlixHostDeps) {
  const {
    accountsBridge,
    createLocalLibrary,
    createRetention,
    resolveOsPath: resolveOsPathDep,
    appVersion,
  } = deps;
  const localLibrary = useMemo(
    () => createLocalLibrary?.() ?? createLocalLibrarySession(),
    [createLocalLibrary],
  );
  const retention = useMemo(
    () => createRetention?.() ?? createRetentionSession(),
    [createRetention],
  );

  // Real session state — only what actually happened, never seeded.
  const [searchState, setSearchState] = useState<SearchState>({ phase: "idle" });
  const [localEntries, setLocalEntries] = useState<readonly CatalogItem[]>([]);
  const [recentItems, setRecentItems] = useState<readonly CatalogItem[]>([]);
  const [watch, setWatch] = useState<WatchView | null>(null);
  const [accountsStatus, setAccountsStatus] = useState<WebFlixAccountsStatus | null>(null);
  const [connectAttempt, setConnectAttempt] = useState<{
    readonly providerId: string;
    readonly outcome: WebFlixConnectOutcome;
  } | null>(null);
  const [retentionState, setRetentionState] = useState<Awaited<
    ReturnType<RetentionSession["getRetentionState"]>
  > | null>(null);
  const [resetResult, setResetResult] = useState<Awaited<
    ReturnType<RetentionSession["resetLocalData"]>
  > | null>(null);
  const lastQueryRef = useRef<string>("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The honest initial reads: account status (typed; fail-closed when the
  // bridge or the vault is unavailable) and the retention state (real use
  // case over the session stores — zero records until playback exists).
  useEffect(() => {
    let active = true;
    if (accountsBridge === null) {
      setAccountsStatus(bridgeUnavailableStatus());
    } else {
      // No account pointer exists in this build (connect is unavailable, and
      // nothing else mints accounts), so the honest pointer set is empty —
      // the vault's availability itself is the real status carried back.
      accountsBridge
        .getStatus([])
        .then((status) => {
          if (active) setAccountsStatus(status);
        })
        .catch(() => {
          if (active) setAccountsStatus(bridgeUnavailableStatus());
        });
    }
    retention
      .getRetentionState()
      .then((state) => {
        if (active) setRetentionState(state);
      })
      .catch(() => {
        /* absence stays honest: null = not loaded */
      });
    return () => {
      active = false;
    };
  }, [accountsBridge, retention]);

  const handleImportLocalFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesPicked = (files: readonly File[]) => {
    if (files.length === 0) return;
    const resolveOsPath =
      resolveOsPathDep ??
      ((file: File) => {
        // The inherited preload's neutral webUtils bridge (electron File.path
        // replacement) — absent in web/test DOMs, null then (honest).
        const bridge = (
          globalThis as { window?: { zcode?: { getPathForFile?: (file: File) => string | null } } }
        ).window?.zcode;
        return bridge?.getPathForFile?.(file) ?? null;
      });
    localLibrary.importFiles(files.map((file) => ({ file, osPath: resolveOsPath(file) })));
    setLocalEntries([...localLibrary.entryCatalogItems()]);
  };

  const handlePlay = (item: CatalogItem) => {
    const view = resolvePlayPlan(item, localLibrary);
    if (view.plan.kind !== "unavailable") {
      localLibrary.markPlayed(item);
      setRecentItems([...localLibrary.recents()]);
    }
    setWatch(view);
  };

  const handleSearchSubmit = (query: string) => {
    lastQueryRef.current = query;
    const outcome = resolveSearchQuery(query);
    if (outcome.kind === "youtube-link") {
      setSearchState({ phase: "idle" });
      localLibrary.markPlayed(outcome.catalogItem);
      setRecentItems([...localLibrary.recents()]);
      setWatch({ title: outcome.catalogItem.title, plan: outcome.plan });
      return;
    }
    setSearchState(outcome.state);
  };

  const handleConnect = (providerId: string) => {
    if (accountsBridge === null) {
      setConnectAttempt({
        providerId,
        outcome: {
          ok: false,
          code: "connect-unavailable",
          reason:
            "Connect is unavailable in this runtime (no desktop account bridge) — nothing was authorized.",
        },
      });
      return;
    }
    accountsBridge
      .connect(providerId)
      .then((outcome) => {
        setConnectAttempt({ providerId, outcome });
      })
      .catch(() => {
        setConnectAttempt({
          providerId,
          outcome: {
            ok: false,
            code: "connect-unavailable",
            reason: "Connect failed unexpectedly — nothing was authorized.",
          },
        });
      });
  };

  const handleDisconnect = (internalAccountId: string) => {
    if (accountsBridge === null) return;
    const pointer: WebFlixAccountPointer = {
      providerId: YOUTUBE_PROVIDER_ID,
      internalAccountId,
    };
    accountsBridge
      .disconnect(pointer)
      .then(() => accountsBridge.getStatus([]))
      .then((status) => {
        setAccountsStatus(status);
      })
      .catch(() => {
        /* the next status read carries the truth; nothing invented here */
      });
  };

  const handlePauseHistory = async () => {
    await retention.pauseHistoryTracking();
    setRetentionState(await retention.getRetentionState());
  };
  const handleResumeHistory = async () => {
    await retention.resumeHistoryTracking();
    setRetentionState(await retention.getRetentionState());
  };
  const handleResetLocalData = async (scope: Parameters<RetentionSession["resetLocalData"]>[0]) => {
    const result = await retention.resetLocalData(scope);
    setResetResult(result);
    setRetentionState(await retention.getRetentionState());
  };

  const version =
    appVersion ?? (typeof __ZCODE_VERSION__ !== "undefined" ? __ZCODE_VERSION__ : "dev");

  return (
    <div style={hostStyles.root}>
      <StartupReadyNotifier />
      {/* The hidden REAL file picker — the local import path (requirement 4). */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
        style={hostStyles.fileInput}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="webflix-local-file-input"
        onChange={(event) => {
          handleFilesPicked([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      {watch !== null ? (
        <div style={hostStyles.shell} data-testid="webflix-watch-view">
          <WatchScreen title={watch.title} plan={watch.plan} onClose={() => setWatch(null)} />
        </div>
      ) : (
        <div style={hostStyles.shell}>
          {/* The product mark in the header row — WebFlix chrome, never ZCode. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.sm,
              padding: `${theme.spacing.sm}px ${theme.spacing.md}px 0`,
            }}
          >
            <span
              style={hostStyles.mark}
              aria-label={WEBFLIX_MARK_ALT}
              role="img"
              data-testid="webflix-product-mark"
              dangerouslySetInnerHTML={{ __html: WEBFLIX_MARK_SVG }}
            />
          </div>

          {/* The fail-closed vault banner (requirement 5): a typed, recoverable
              truthful error — rendered only when the vault actually refused. */}
          {accountsStatus !== null && !accountsStatus.vault.available && (
            <p data-testid="webflix-vault-unavailable" role="alert" style={hostStyles.vaultBanner}>
              Account storage is unavailable on this system: {accountsStatus.vault.reason} — sign-in
              cannot be offered until the OS secure-storage backend (e.g. a keyring service) is
              available. No credentials are stored insecurely, ever.
            </p>
          )}

          <AppShell
            accounts={accountsStatus?.accounts ?? []}
            recentItems={recentItems}
            collections={[]}
            localEntries={localEntries}
            searchState={searchState}
            onPlay={handlePlay}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onImportLocalFiles={handleImportLocalFiles}
            onSearchSubmit={handleSearchSubmit}
            connectOutcome={
              connectAttempt === null
                ? null
                : {
                    providerId: connectAttempt.providerId,
                    ok: connectAttempt.outcome.ok,
                    reason: connectAttempt.outcome.reason,
                  }
            }
            onRetrySearch={() => {
              // The honest retry: the last query goes through the SAME real
              // flow again — no shortcut, no invented cache.
              if (lastQueryRef.current !== "") {
                handleSearchSubmit(lastQueryRef.current);
              }
            }}
            adCenterResults={null}
            evaluationResult={null}
            rankerAdapterEntries={[]}
            rankerSelectedAdapterId={null}
            rankerStatusNote={
              "No ranking adapter is wired in this desktop build — none is offered (the MI engine is a later order)."
            }
            retentionState={retentionState}
            retentionResetResult={resetResult}
            onPauseHistoryTracking={() => {
              void handlePauseHistory();
            }}
            onResumeHistoryTracking={() => {
              void handleResumeHistory();
            }}
            onResetLocalData={(scope) => {
              void handleResetLocalData(scope);
            }}
          />
        </div>
      )}

      {/* About/help copy (requirement 2) — the honest product line. */}
      <footer data-testid="webflix-about-line" style={hostStyles.about}>
        {webflixAboutLine(version)}
      </footer>
    </div>
  );
}

/**
 * The WebFlix renderer entry — boots the host on the #root element.
 * Called only from main.tsx's webflix route (baked flavor "webflix").
 */
export function bootWebFlixRenderer(): void {
  document.title = WEBFLIX_DOCUMENT_TITLE;
  const container = document.getElementById("root");
  if (container === null) {
    return;
  }
  createRoot(container).render(
    <WebFlixErrorBoundary>
      <WebFlixHost accountsBridge={getWebFlixAccountsBridge()} />
    </WebFlixErrorBoundary>,
  );
}

bootWebFlixRenderer();
