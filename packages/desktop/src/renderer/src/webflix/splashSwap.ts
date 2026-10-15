/**
 * P9-UI-1 (requirement 2) — the WebFlix startup-surface swap.
 *
 * Runs SYNCHRONOUSLY at renderer-entry module evaluation (main.tsx calls it
 * in the webflix branch BEFORE dynamically importing the boot chunk), so the
 * swap wins the race against the HTML startup shell's opacity ramp (the
 * inherited shell animates 0 → visible over ~274ms; the entry module
 * evaluates within that window when served from the local bundle).
 *
 * What it swaps — every INHERITED ZCode-branded startup element:
 *   1. document.title: "ZCode" (index.html <title>) → "WebFlix".
 *   2. the #loading aria-label: "Loading..." → "Loading WebFlix…".
 *   3. the .startup-logo Z-glyph SVG → the WebFlix mark (the same geometry
 *      as build/webflix-icons/icon.svg — pinned by test).
 *
 * index.html itself is NOT edited (zero ZCode impact — the ZCode flavors
 * keep the inherited startup shell byte-for-byte; pinned by the P9-UI-1
 * battery against a fixture of the BASE file). The DOM swap above happens
 * only in the baked webflix flavor, before any WebFlix or ZCode UI mounts.
 *
 * PURE-DOM module (no imports beyond brand constants) so the battery can
 * pin it with a jsdom docblock or source pins without a renderer runtime.
 */
import { WEBFLIX_DOCUMENT_TITLE, WEBFLIX_MARK_SVG, WEBFLIX_SPLASH_ARIA_LABEL } from "./brand.js";

/** The startup-shell logo element class the inherited index.html ships (cited, not re-derived). */
const STARTUP_LOGO_SELECTOR = ".startup-logo";
/** The id of the inherited full-viewport startup/loading overlay. */
const STARTUP_LOADING_ID = "loading";

/**
 * The WebFlix splash logo markup — the brand mark with the inherited
 * `.startup-logo` class so the shell's own sizing CSS (56px, height auto)
 * keeps applying. The mark carries explicit fills, so the shell's
 * `color: #ffffff` currentColor styling is irrelevant to it.
 */
export function webflixSplashLogoSvg(): string {
  return WEBFLIX_MARK_SVG.replace("<svg ", '<svg class="startup-logo" aria-hidden="true" ', 1);
}

/** Swaps every inherited ZCode-branded startup element for the WebFlix brand. */
export function applyWebFlixStartupSurface(documentRef: Document): void {
  documentRef.title = WEBFLIX_DOCUMENT_TITLE;

  const loading = documentRef.getElementById(STARTUP_LOADING_ID);
  if (loading !== null) {
    loading.setAttribute("aria-label", WEBFLIX_SPLASH_ARIA_LABEL);
  }

  const inheritedLogo = documentRef.querySelector(STARTUP_LOGO_SELECTOR);
  if (inheritedLogo !== null) {
    inheritedLogo.outerHTML = webflixSplashLogoSvg();
  }
}
