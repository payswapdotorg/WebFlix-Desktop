// The collapsible sidebar (WFX-UX-SHELL-1, deliverable 1): the reference
// pattern's grouped media navigation — WebFlix / You / Explore / Manage —
// rendered from the route model's NAV_GROUPS, with the user collapse toggle
// and the icon-rail collapsed form. Extracted from AppShell.tsx for the
// repo's max-lines law.

import React from "react";
import { theme } from "../../theme";
import { NAV_GROUPS } from "../../routes";
import type { MediaRoute, NavRoute } from "../../routes";
import { Icon, type IconName } from "../media/icons";

export interface SidebarProps {
  /** Collapsed = icon rail (labels visually hidden, names preserved). */
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** The active route (marks the current destination, aria-current). */
  readonly activeRoute: MediaRoute;
  /** Nav activation (browse surfaces only — watch/channel are content routes). */
  readonly onNavigate: (route: NavRoute) => void;
}

// The icons for the nav items (hand-drawn; see media/icons.tsx).
const NAV_ICONS: Record<NavRoute, IconName> = {
  home: "home",
  search: "search",
  shorts: "shorts",
  subscriptions: "subscriptions",
  library: "library",
  history: "history",
  trending: "trending",
  accounts: "accounts",
  ads: "ads",
  evaluation: "evaluation",
  settings: "settings",
};

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: theme.layout.sidebarWidth,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${theme.colors.border}`,
    background: theme.colors.surface,
    overflowY: "auto",
    overflowX: "hidden",
    transition: "width 150ms ease",
  },
  sidebarCollapsed: {
    width: theme.layout.sidebarRailWidth,
  },
  sidebarHeader: {
    padding: theme.spacing.sm,
    display: "flex",
    justifyContent: "flex-end",
  },
  sidebarHeaderCollapsed: { justifyContent: "center" },
  collapseToggle: {
    background: "transparent",
    color: theme.colors.textMuted,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    width: 36,
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    padding: `0 ${theme.spacing.sm}px ${theme.spacing.sm}px`,
    margin: 0,
    minWidth: 0,
  },
  navGroup: { display: "flex", flexDirection: "column", gap: 2, marginBottom: theme.spacing.xs },
  navGroupLabel: {
    margin: `${theme.spacing.xs}px ${theme.spacing.xs}px 0`,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: theme.colors.textMuted,
  },
  navButton: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.md,
    background: "transparent",
    color: theme.colors.textMuted,
    border: "none",
    borderRadius: theme.radii.md,
    padding: "8px 12px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
    textAlign: "left",
    width: "100%",
    minWidth: 0,
  },
  navButtonActive: {
    background: theme.colors.surfaceRaised,
    color: theme.colors.text,
    fontWeight: 600,
  },
  navButtonCollapsed: { justifyContent: "center", gap: 0, padding: "8px 0" },
  // The visually-hidden label technique: collapsed buttons keep their
  // accessible name and textContent while only the glyph shows.
  navLabelHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
};

export function Sidebar(props: SidebarProps): React.ReactElement {
  const { collapsed, onToggleCollapsed, activeRoute, onNavigate } = props;

  const sidebarStyle = collapsed
    ? { ...styles.sidebar, ...styles.sidebarCollapsed }
    : styles.sidebar;
  const navLabelStyle = collapsed ? styles.navLabelHidden : undefined;

  return (
    <div data-testid="sidebar" style={sidebarStyle}>
      <div style={collapsed ? styles.sidebarHeaderCollapsed : styles.sidebarHeader}>
        <button
          type="button"
          data-testid="sidebar-collapse-toggle"
          aria-expanded={!collapsed}
          aria-controls="primary-nav"
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          style={styles.collapseToggle}
          onClick={onToggleCollapsed}
        >
          <Icon name={collapsed ? "expand" : "collapse"} size={16} />
        </button>
      </div>
      <nav id="primary-nav" aria-label="Primary" data-testid="primary-nav" style={styles.nav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={styles.navGroup}>
            <h3
              style={{
                ...styles.navGroupLabel,
                ...(collapsed ? { display: "none" } : undefined),
              }}
            >
              {group.label}
            </h3>
            {group.items.map((navItem) => {
              const isActive = activeRoute === navItem.id;
              const buttonStyle = {
                ...styles.navButton,
                ...(isActive ? styles.navButtonActive : undefined),
                ...(collapsed ? styles.navButtonCollapsed : undefined),
              };
              return (
                <button
                  key={navItem.id}
                  type="button"
                  data-testid={`nav-${navItem.id}`}
                  aria-current={isActive ? "page" : undefined}
                  title={navItem.label}
                  style={buttonStyle}
                  onClick={() => onNavigate(navItem.id)}
                >
                  <Icon name={NAV_ICONS[navItem.id]} size={20} />
                  <span style={navLabelStyle}>{navItem.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
