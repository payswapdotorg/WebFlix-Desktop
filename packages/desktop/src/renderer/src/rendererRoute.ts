/**
 * P9-UI-1 — the renderer root/route selector (requirement 1, pin-tested).
 *
 * The renderer entry (main.tsx) is a flavor router: the WebFlix product
 * flavor mounts the WebFlix shell host; every ZCode flavor (production /
 * preview) keeps the inherited ZCode renderer boot EXACTLY (freeze §6.1
 * migration doctrine: WEBFLIX_IDENTITY unset ⇒ zero ZCode impact). The
 * update-status window keeps the inherited ZCode update-status root in
 * every flavor — the WebFlix updater surface is disabled at the source
 * (updater-product-guard), so this window only ever exists for ZCode
 * builds, and preserving its behavior exactly is the safe rule.
 *
 * PURE module (no React/DOM imports) so the battery can pin every route
 * outcome without a renderer runtime.
 */

/** The renderer roots this app can boot. */
export type RendererRoute = "webflix" | "zcode";

export interface RendererRouteInput {
  /** The BAKED product flavor (`__ZCODE_PRODUCT_FLAVOR__` define — freeze §6.1 R2). */
  readonly flavor: string;
  /** The window's `windowKind` loadURL flag ("" for the main window). */
  readonly windowKind: string | undefined;
}

/**
 * Route selection (fail-closed on unknown flavors — an unknown baked value
 * must never silently mount a product root it cannot vouch for; it takes the
 * inherited ZCode path, which is the status quo this fork shipped with).
 */
export function selectRendererRoute(input: RendererRouteInput): RendererRoute {
  const isMainWindow = input.windowKind !== "update-status";
  if (input.flavor === "webflix" && isMainWindow) {
    return "webflix";
  }
  return "zcode";
}
