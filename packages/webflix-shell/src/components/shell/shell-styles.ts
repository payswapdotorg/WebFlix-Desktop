// Shared shell-layout styles (WFX-UX-SHELL-1). Extracted from AppShell.tsx
// for the repo's max-lines law. WFX-WEB-LOOK-1: the shell chrome now carries
// the webflix-2.0 web product's idioms — the slim scrollbar, the hover
// surfaces for nav rows / chips / icon buttons, and the web gutters — all
// mounted through the shell's single stylesheet so inline styles stay
// test-stable.

import { theme } from "../../theme";

/**
 * Focus-visible law + the web product's interactive idioms: the shell's
 * single stylesheet (mounted once). Hover surfaces live here because inline
 * styles cannot express :hover — the classes are shell-scoped (.wfx-shell)
 * and carry no product identity strings.
 */
export const FOCUS_STYLES = `
.wfx-shell :focus-visible { outline: 2px solid ${theme.colors.focus}; outline-offset: 2px; }
.wfx-shell [role="separator"]:focus-visible { outline-offset: -2px; }
.wfx-shell .wfx-nav-item { transition: background-color 80ms ease; }
.wfx-shell .wfx-nav-item:hover { background-color: ${theme.colors.surfaceRaised}; }
.wfx-shell .wfx-chip { transition: background-color 80ms ease; }
.wfx-shell .wfx-chip:hover { background-color: #3f3f3f; }
.wfx-shell .wfx-chip[data-active="true"]:hover { background-color: ${theme.colors.text}; }
.wfx-shell .wfx-icon-btn { transition: background-color 80ms ease; }
.wfx-shell .wfx-icon-btn:hover { background-color: ${theme.colors.surfaceRaised}; }
.wfx-shell .wfx-search { transition: border-color 80ms ease; }
.wfx-shell .wfx-search:focus-within { border-color: rgba(241,241,241,0.40); }
.wfx-shell .wfx-scroll { scrollbar-width: thin; scrollbar-color: #4d4d4d transparent; }
.wfx-shell .wfx-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.wfx-shell .wfx-scroll::-webkit-scrollbar-track { background: transparent; }
.wfx-shell .wfx-scroll::-webkit-scrollbar-thumb { background: #4d4d4d; border-radius: 8px; }
.wfx-shell .wfx-card { transition: transform 120ms ease; }
.wfx-shell .wfx-card:hover { transform: scale(1.03); }
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
    color: "#ffffff",
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
    // The web product's content gutters (px-4 sm:px-6).
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px ${theme.spacing.md}px`,
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
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderLeft: `1px solid ${theme.colors.border}`,
    background: theme.colors.background,
    boxSizing: "border-box",
  },
  watchNothingPlaying: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    background: theme.colors.surfaceRaised,
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
