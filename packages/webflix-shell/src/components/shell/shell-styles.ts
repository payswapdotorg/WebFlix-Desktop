// Shared shell-layout styles (WFX-UX-SHELL-1). Extracted from AppShell.tsx
// for the repo's max-lines law; every value is unchanged. The shell chrome
// (top chrome, sidebar) carries its own styles co-located in its component
// files; this module owns the LAYOUT skeleton both share.

import { theme } from "../../theme";

/** Focus-visible law: the shell's single focus stylesheet (mounted once). */
export const FOCUS_STYLES = `
.wfx-shell :focus-visible { outline: 2px solid ${theme.colors.focus}; outline-offset: 2px; }
.wfx-shell [role="separator"]:focus-visible { outline-offset: -2px; }
`;

export const shellStyles: Record<string, React.CSSProperties> = {
  root: {
    height: "100vh",
    minHeight: "100vh",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    fontFamily: theme.typography.fontFamily,
    background: theme.colors.background,
    color: theme.colors.text,
    overflow: "hidden",
  },
  skipLink: {
    position: "absolute",
    left: -9999,
    top: 0,
    background: theme.colors.accent,
    color: "#08211b",
    padding: "8px 14px",
    borderRadius: theme.radii.sm,
    fontWeight: 600,
    zIndex: 10,
  },
  // ---- body row ----
  body: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  // ---- main + watch dock ----
  main: {
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: theme.spacing.md,
    display: "block",
  },
  mainHidden: { display: "none" },
  watchAreaMain: {
    flex: "1 1 auto",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: theme.spacing.md,
  },
  watchAreaDocked: {
    width: theme.layout.watchDockWidth,
    minWidth: theme.layout.watchDockMinWidth,
    flexShrink: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: theme.spacing.md,
    borderLeft: `1px solid ${theme.colors.border}`,
    background: theme.colors.surface,
    boxSizing: "border-box",
  },
  watchNothingPlaying: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    background: theme.colors.surface,
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    maxWidth: 560,
  },
  watchNothingTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  watchNothingMessage: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  // ---- screen stack (evaluation) ----
  screenStack: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
  },
  // ---- footer ----
  footer: {
    borderTop: `1px solid ${theme.colors.border}`,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    paddingInline: theme.spacing.md,
    flexShrink: 0,
  },
};
