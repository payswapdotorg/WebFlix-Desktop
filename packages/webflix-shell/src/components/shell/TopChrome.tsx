// The top chrome (WFX-UX-SHELL-1, deliverable 1): the WebFlix product mark,
// the global video-search form, the account/connection status control, and
// the agent-panel toggle with its documented shortcut hint. Extracted from
// AppShell.tsx for the repo's max-lines law.

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
}

const styles: Record<string, React.CSSProperties> = {
  chrome: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.md,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderBottom: `1px solid ${theme.colors.border}`,
    background: theme.colors.surface,
    flexShrink: 0,
  },
  brandBlock: { display: "flex", alignItems: "baseline", gap: theme.spacing.sm, flexShrink: 0 },
  brand: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: 700,
    letterSpacing: "0.5px",
    color: theme.colors.accent,
  },
  tagline: { color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  searchForm: {
    display: "flex",
    gap: theme.spacing.sm,
    flex: "1 1 260px",
    minWidth: 220,
    maxWidth: 560,
  },
  searchInput: {
    flex: 1,
    background: theme.colors.background,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: "8px 12px",
    minHeight: 44,
    fontSize: theme.typography.sizes.md,
    minWidth: 0,
  },
  searchButton: {
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "8px 16px",
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
  },
  chromeSpacer: { flex: "1 1 auto" },
  accountStatus: {
    background: "transparent",
    color: theme.colors.textMuted,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    flexShrink: 0,
  },
  agentToggle: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.md,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    flexShrink: 0,
  },
  agentToggleActive: {
    background: theme.colors.accent,
    color: "#08211b",
  },
  shortcutHint: {
    fontFamily: theme.typography.monoFamily,
    fontSize: 11,
    opacity: 0.8,
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
  } = props;

  return (
    <header style={styles.chrome} data-testid="shell-top-chrome">
      <div style={styles.brandBlock}>
        <span style={styles.brand}>{theme.name}</span>
        <span style={styles.tagline}>{theme.tagline}</span>
      </div>
      <form
        role="search"
        aria-label="Global video search"
        data-testid="global-search-form"
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
          Search
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
        <Icon name="accounts" size={16} />
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
        <Icon name="agent" size={16} />
        Agent
        <span style={styles.shortcutHint} aria-hidden="true">
          Ctrl+J
        </span>
      </button>
    </header>
  );
}
