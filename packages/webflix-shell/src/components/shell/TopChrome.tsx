// The top chrome (WFX-UX-SHELL-1, deliverable 1): the WebFlix product mark,
// the global video-search form, the account/connection status control, and
// the agent-panel toggle with its documented shortcut hint. Extracted from
// AppShell.tsx for the repo's max-lines law.
//
// WFX-WEB-LOOK-1: the chrome now carries the webflix-2.0 web product's
// topbar — the 56px bar, the brand mark + bold wordmark at the left, the
// centered rounded-full search pill with its icon submit, and the
// right-aligned status pills. Every data-testid / aria contract is
// unchanged.

import React from "react";
import { theme } from "../../theme";
import { AGENT_PANEL_TOGGLE_SHORTCUT } from "../AgentPanel";
import { Icon } from "../media/icons";

export interface TopChromeProps {
  /** The current global-search input value (shell-owned state). */
  readonly globalQuery: string;
  readonly onGlobalQueryChange: (value: string) => void;
  /** Form submit handler (the shell navigates to the search route). */
  readonly onGlobalSearchSubmit: (event: React.FormEvent) => void;
  /** Connected-account count (drives the honest status label). */
  readonly connectedCount: number;
  readonly onOpenAccounts: () => void;
  /** The agent panel's visibility (the toggle's pressed state). */
  readonly panelVisible: boolean;
  readonly onTogglePanel: () => void;
  /**
   * WFX-WEB-LOOK-1: the host-supplied brand mark node (the WebFlix logo
   * glyph), rendered at the topbar's left before the wordmark. Absent = the
   * wordmark alone renders.
   */
  readonly brandMark?: React.ReactNode;
}

const styles: Record<string, React.CSSProperties> = {
  chrome: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    // The web product's topbar: h-14, canvas background, no divider.
    minHeight: 56,
    padding: `${theme.spacing.xs}px ${theme.spacing.md}px`,
    background: theme.colors.background,
    flexShrink: 0,
  },
  brandBlock: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs + 2,
    flexShrink: 0,
    minWidth: 0,
  },
  brand: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: theme.colors.text,
    whiteSpace: "nowrap",
  },
  // The web product's centered search pill: rounded-full, bordered, with the
  // icon submit sewn onto the right edge.
  searchForm: {
    display: "flex",
    height: 40,
    flex: "1 1 260px",
    minWidth: 220,
    maxWidth: 560,
    borderRadius: 999,
    border: `1px solid ${theme.colors.border}`,
    background: "rgba(39,39,39,0.40)",
    overflow: "hidden",
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    color: theme.colors.text,
    border: "none",
    outline: "none",
    padding: `0 ${theme.spacing.md}px`,
    fontSize: theme.typography.sizes.md,
    minWidth: 0,
    font: "inherit",
  },
  searchButton: {
    width: 64,
    flexShrink: 0,
    background: theme.colors.surfaceRaised,
    color: theme.colors.text,
    border: "none",
    borderLeft: `1px solid ${theme.colors.border}`,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "inherit",
  },
  chromeSpacer: { flex: "1 1 auto" },
  // The web product's right-side pill family (guest sign-in / create).
  accountStatus: {
    background: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 999,
    padding: `0 ${theme.spacing.md + 2}px`,
    minHeight: 36,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  agentToggle: {
    background: "transparent",
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 999,
    padding: `0 ${theme.spacing.md + 2}px`,
    minHeight: 36,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  agentToggleActive: {
    background: theme.colors.accent,
    color: "#ffffff",
    borderColor: theme.colors.accent,
  },
  shortcutHint: {
    fontFamily: theme.typography.monoFamily,
    fontSize: 11,
    opacity: 0.7,
  },
};

export function TopChrome(props: TopChromeProps): React.ReactElement {
  const {
    globalQuery,
    onGlobalQueryChange,
    onGlobalSearchSubmit,
    connectedCount,
    onOpenAccounts,
    panelVisible,
    onTogglePanel,
    brandMark,
  } = props;

  return (
    <header style={styles.chrome} data-testid="shell-top-chrome">
      <div style={styles.brandBlock}>
        {brandMark}
        <span style={styles.brand}>{theme.name}</span>
      </div>
      <form
        role="search"
        aria-label="Global video search"
        data-testid="global-search-form"
        className="wfx-search"
        style={styles.searchForm}
        onSubmit={onGlobalSearchSubmit}
      >
        <input
          type="search"
          data-testid="global-search-input"
          aria-label="Search videos"
          placeholder="Search videos, channels…"
          value={globalQuery}
          onChange={(event) => onGlobalQueryChange(event.target.value)}
          style={styles.searchInput}
        />
        <button type="submit" data-testid="global-search-submit" style={styles.searchButton}>
          <Icon name="search" size={20} title="Search" />
          <span
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            Search
          </span>
        </button>
      </form>
      <div style={styles.chromeSpacer} />
      <button
        type="button"
        data-testid="account-status"
        aria-label={`Account status: ${
          connectedCount > 0
            ? `${connectedCount} account${connectedCount === 1 ? "" : "s"} connected`
            : "no account connected"
        } — open Accounts`}
        style={styles.accountStatus}
        onClick={onOpenAccounts}
      >
        <Icon name="accounts" size={18} />
        {connectedCount > 0
          ? `${connectedCount} account${connectedCount === 1 ? "" : "s"} connected`
          : "Not signed in"}
      </button>
      <button
        type="button"
        data-testid="agent-panel-toggle"
        aria-expanded={panelVisible}
        aria-controls="agent-panel"
        title={`Agent panel (${AGENT_PANEL_TOGGLE_SHORTCUT})`}
        style={{
          ...styles.agentToggle,
          ...(panelVisible ? styles.agentToggleActive : undefined),
        }}
        onClick={onTogglePanel}
      >
        <Icon name="agent" size={18} />
        Agent
        <span style={styles.shortcutHint} aria-hidden="true">
          Ctrl+J
        </span>
      </button>
    </header>
  );
}
