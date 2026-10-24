// WebFlix visual identity.
//
// WFX-WEB-LOOK-1 (operator directive, 2026-10-24): the desktop shell now
// carries the webflix-2.0 web product's visual system — the YouTube-baseline
// dark canvas (#0f0f0f), the web product's red primary (#ff0000), the
// secondary chip surface (#272727), the 8/10/12/16 radius ladder and the
// system font stack — sourced from the web app's globals.css tokens. This
// supersedes the earlier "deliberately NOT YouTube" accent doctrine
// (ADR-0003's independent-VALUE doctrine stays: the permanent notice below,
// the honest-state vocabulary, and the no-ZCode-branding laws are unchanged).
// The shell reserves permanent space for the independent-value notice —
// screens may restyle it, never remove it.

export const theme = {
  name: "WebFlix",
  tagline: "Your videos, honestly presented.",

  colors: {
    // webflix-2.0 globals.css .dark tokens (the web product's defaults).
    background: "#0f0f0f",
    surface: "#0f0f0f",
    surfaceRaised: "#272727",
    border: "#303030",
    text: "#f1f1f1",
    textMuted: "#aaaaaa",
    /** WebFlix brand primary — the web product's red (--primary #ff0000). */
    accent: "#ff0000",
    accentStrong: "#cc0000",
    focus: "#ff0000",
    danger: "#cc0000",
    warning: "#fc7512",
    ok: "#2ba640",
  },

  // webflix-2.0 radius ladder (--radius 0.75rem: sm 8 / md 10 / lg 12 / xl 16).
  radii: { sm: "8px", md: "10px", lg: "12px", xl: "16px" },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },

  // WFX-UX-SHELL-1 (media-first shell): the layout geometry tokens. Additive
  // — every value the shell chrome needs so breakpoints stay in ONE place.
  // WFX-WEB-LOOK-1: sidebar 240 (the web w-60), rail 72 (web w-[72px]),
  // watch column 402 (the web watch page's lg aside).
  layout: {
    /** Expanded sidebar width (px). */
    sidebarWidth: 240,
    /** Collapsed icon-rail width (px). */
    sidebarRailWidth: 72,
    /** Below this viewport width the sidebar auto-collapses to the rail. */
    narrowViewportPx: 1024,
    /** The agent panel's default/min/max widths (px; min per the work order). */
    agentPanelDefaultWidth: 380,
    agentPanelMinWidth: 320,
    agentPanelMaxWidth: 720,
    /** The docked persistent-watch column width (px; freeze §9.6 position). */
    watchDockWidth: 402,
    /** Watch dock shrinks to this before the layout gives up width (px). */
    watchDockMinWidth: 280,
  },

  typography: {
    // The web product's --font-sans (ui-sans-serif stack), verbatim.
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    monoFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    sizes: { sm: "13px", md: "14px", lg: "18px", xl: "24px", display: "34px" },
  },

  // ADR-0003 — independent-value notice. Rendered by the shell in
  // theme.notice.slot on every screen; it is identity, not decoration.
  notice: {
    id: "independent-value-notice",
    slot: "footer",
    text: "WebFlix is an independent desktop app. It is not affiliated with, endorsed by, or sponsored by YouTube or Google.",
  },
} as const;

export type WebFlixTheme = typeof theme;
