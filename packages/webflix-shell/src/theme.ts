// WebFlix visual identity (D1 lane).
//
// Deliberately NOT YouTube: no red primary, no play-button pastiche, no
// YouTube-lookalike layout. WebFlix is an independent desktop client
// (ADR-0003), so the shell reserves permanent space for the
// independent-value notice — screens may restyle it, never remove it.

export const theme = {
  name: 'WebFlix',
  tagline: 'Your videos, honestly presented.',

  colors: {
    background: '#0f1420',
    surface: '#172033',
    surfaceRaised: '#1f2b44',
    border: '#2c3a58',
    text: '#eaf0f9',
    textMuted: '#9aa8c0',
    /** WebFlix brand primary — teal. YouTube red (#ff0000) is banned here. */
    accent: '#2fd6b3',
    accentStrong: '#19b28f',
    focus: '#8f7bff',
    danger: '#e05f74',
    warning: '#d9a13b',
    ok: '#3fc878',
  },

  radii: { sm: '4px', md: '8px', lg: '14px' },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },

  typography: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    monoFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
    sizes: { sm: '13px', md: '15px', lg: '18px', xl: '24px', display: '34px' },
  },

  // ADR-0003 — independent-value notice. Rendered by the shell in
  // theme.notice.slot on every screen; it is identity, not decoration.
  notice: {
    id: 'independent-value-notice',
    slot: 'footer',
    text:
      'WebFlix is an independent desktop app. It is not affiliated with, endorsed by, or sponsored by YouTube or Google.',
  },
} as const;

export type WebFlixTheme = typeof theme;
