/*
 * P9-UI-1 — the renderer entry is now a thin PRODUCT-FLAVOR ROUTER.
 *
 * The pre-order main.tsx body lives on VERBATIM in ./zcodeBoot.tsx (zero
 * content change — the inherited ZCode renderer path is preserved EXACTLY
 * for the production/preview flavors, pinned by test against the BASE
 * tree). In the baked webflix flavor (freeze §6.1 R2) the main window
 * instead boots the WebFlix shell host (./webflix/boot.tsx): the WebFlix
 * product never mounts @zcode/ui's ZCode Root (order requirement 1), and
 * the ZCode workspace root is never loaded into a WebFlix product process.
 *
 * Before the WebFlix boot chunk loads, the entry SYNCHRONOUSLY swaps every
 * inherited ZCode-branded startup surface (document title, splash glyph,
 * loading aria-label) for the WebFlix brand (./webflix/splashSwap.ts —
 * order requirement 2). index.html itself is untouched: the ZCode flavors
 * keep the inherited startup shell byte-for-byte.
 *
 * The update-status window keeps the inherited ZCode update-status root in
 * EVERY flavor (rendererRoute.ts) — the WebFlix updater surface is disabled
 * at the source (updater-product-guard), so this window only ever exists
 * for ZCode builds.
 */
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { selectRendererRoute } from "./rendererRoute.js";
import { applyWebFlixStartupSurface } from "./webflix/splashSwap.js";

const windowKind = new URLSearchParams(window.location.search).get("windowKind") ?? undefined;
const route = selectRendererRoute({
  flavor: ZCODE_PRODUCT_FLAVOR,
  windowKind,
});

if (route === "webflix") {
  // The WebFlix product renderer (P9-UI-1). The brand swap runs FIRST, at
  // entry-module evaluation — before the boot chunk's dynamic import — so
  // the inherited ZCode splash glyph never becomes visible in this flavor.
  // The ZCode boot (theme seeding, service-port admission, workspace Root)
  // is never loaded into this process.
  applyWebFlixStartupSurface(document);
  void import("./webflix/boot.js");
} else {
  // The inherited ZCode renderer boot — VERBATIM (zcodeBoot.tsx). Its
  // statements run at import evaluation, in their original order.
  void import("./zcodeBoot.js");
}
