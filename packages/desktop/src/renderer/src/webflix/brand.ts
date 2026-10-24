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
 * The WebFlix mark (WFX-WEB-LOOK-1, operator directive 2026-10-24): the
 * webflix-2.0 WEB PRODUCT'S OWN LOGO GEOMETRY — the red rounded rect with
 * the white play triangle (webflix-2.0 src/components/app/logo.tsx /
 * public/favicon.svg) — redrawn on the square 64 viewBox the desktop icon
 * set requires. This supersedes the earlier teal "Fx" monogram: the
 * operator directed the desktop app to carry the web app's look. It is
 * still NOT the ZCode "Z" glyph (pinned by test), and the ADR-0003
 * independent-VALUE doctrine (the permanent notice, the honesty laws) is
 * unchanged — only the visual identity moved to web parity.
 *
 * The same geometry drives packages/desktop/build/webflix-icons/ (the
 * product icon set + its generator) — see that folder's README.
 */
export const WEBFLIX_MARK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="WebFlix mark"><rect x="2" y="8" width="60" height="48" rx="12" fill="#ff0000"/><path d="M25 22v20l17-10z" fill="#ffffff"/></svg>` as const;

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
