/**
 * P9-UI-1 (requirement 2) — the WebFlix product brand, single source for
 * every renderer-side branding surface.
 *
 * Values are the FROZEN WebFlix identity (freeze §6.1; mirrored from
 * packages/webflix-shell/src/identity.ts and
 * packages/desktop/scripts/desktop-product-identity.mjs — cited, not
 * re-derived). This module deliberately contains NO ZCode branding value:
 * the pin test asserts none of the freeze §6.1 forbidden values appear
 * here, and that the product title is exactly "WebFlix".
 */

/** The user-facing product name (freeze §6.1 productName). */
export const WEBFLIX_PRODUCT_NAME = "WebFlix";

/** The renderer document title for the WebFlix flavor. */
export const WEBFLIX_DOCUMENT_TITLE = "WebFlix";

/**
 * The WebFlix mark — an original stream-forward glyph (three ascending
 * signal strokes over a play chevron), drawn with theme-matching brand
 * colors (packages/webflix-shell theme: background #0f1420, accent #2fd6b3).
 * Deliberately NOT the ZCode "Z" glyph and not a YouTube play-button
 * pastiche (ADR-0003 independent-value doctrine; the shell theme already
 * bans YouTube red).
 *
 * The same geometry drives packages/desktop/build/webflix-icons/ (the
 * product icon set + its generator) — see that folder's README.
 */
export const WEBFLIX_MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="WebFlix mark"><rect x="2" y="2" width="60" height="60" rx="14" fill="#0f1420"/><path d="M14 22h10.5v4.5H19v3.5h5v4.5h-5v7.5H14z" fill="#2fd6b3"/><path d="M27 22h5.5l3.5 6.5 3.5-6.5H45l-6.5 11 6.9 11.5h-5.7l-3.7-6.7-3.7 6.7H27l6.9-11.5z" fill="#2fd6b3" transform="translate(1 0)"/><path d="M48 24.5l9.5 5.5-9.5 5.5z" fill="#2fd6b3"/></svg>` as const;

/** Alt text for the mark where it is embedded as an image. */
export const WEBFLIX_MARK_ALT = "WebFlix";

/** The startup/splash aria label in the WebFlix flavor. */
export const WEBFLIX_SPLASH_ARIA_LABEL = "Loading WebFlix…";

/**
 * About/help copy (requirement 2): the in-app product line rendered in the
 * shell footer. The ADR-0003 independent-value notice itself stays in the
 * shell theme (webflix-shell theme.notice) — this constant is only the
 * version line the host appends.
 */
export function webflixAboutLine(version: string): string {
  return `WebFlix ${version} — an independent desktop app. Local playback works offline; provider features use each signed-in user's own authorization.`;
}
