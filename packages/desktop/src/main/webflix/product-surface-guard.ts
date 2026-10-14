/**
 * Product-surface gate for the ZCode commercial surfaces — PURE module
 * (no Electron, no Node built-ins, no imports at all).
 *
 * P8-ISOLATION-WIRING-1 (isolation audit §3.4 FINDING, 2026-10-13): the
 * ISOLATION_FLAG_POLICY declared that `webflixProductSurface` (default OFF)
 * gates the Coding Plan / PayPal, CUA, Lark, SSH/Docker/WSL remote and
 * force-update surfaces — but the policy named enforcement files that do not
 * exist in the tree (ipc-router.ts, app-menu.ts, deep-links.ts). This module
 * is the real gate: one flavor-aware decision shared by the actual surface
 * owners in the desktop main process (desktopMainIpcRemote.ts remote IPC,
 * desktopCuaPermissionIpc.ts, desktopCommandHandlers.ts gated commands,
 * desktopOAuthDeepLink.ts payment deep links, desktopRuntimeEnv.ts Lark
 * binary env).
 *
 * Flavor interaction — the P8-RELEASE-DRIFT-1 baked flavor is the
 * discriminator: the gate only ever applies to a WebFlix build. ZCode
 * identity builds ("production"/"preview") keep their commercial surfaces
 * regardless of the isolation flag (zero ZCode regression), exactly like
 * isZCodeUpdaterSurfaceEnabledForFlavor consults the flavor for the updater
 * surface (updater-product-guard.ts). Unknown flavors fail CLOSED.
 *
 * The force-update flow is NOT gated here: P8-RELEASE-DRIFT-1's hazard H1
 * guard already fail-closes it for WebFlix builds (see
 * shouldSkipForceUpdateGateForFlavor in updater-product-guard.ts) — cited,
 * not duplicated.
 */

/** Outcome of the product-surface gate for the ZCode commercial surfaces. */
export interface ZCodeProductSurfaceDecision {
  readonly enabled: boolean;
  readonly reason: string;
}

/**
 * Whether the ZCode commercial surfaces (Coding Plan / PayPal, CUA, Lark,
 * SSH/Docker/WSL remotes) are enabled for this runtime:
 *
 *  - ZCode identity builds ("production"/"preview"): enabled — the flag is
 *    never consulted for a ZCode build (the ZCode product IS this surface).
 *  - WebFlix builds ("webflix"): follows the `webflixProductSurface`
 *    isolation flag — default OFF (fail-closed; only
 *    WEBFLIX_ENABLE_PRODUCT_SURFACE=1/true/yes/on enables).
 *  - Unknown flavors: fail-closed disabled (no commercial surface).
 */
export function resolveZCodeProductSurfaceForRuntime(input: {
  flavor?: string;
  webflixProductSurface?: boolean;
}): ZCodeProductSurfaceDecision {
  if (input.flavor === "production" || input.flavor === "preview") {
    return {
      enabled: true,
      reason: "zcode-identity-build (the isolation flag never gates a ZCode build)",
    };
  }
  if (input.flavor === "webflix") {
    return input.webflixProductSurface
      ? {
          enabled: true,
          reason: "webflix build with webflixProductSurface explicitly enabled",
        }
      : {
          enabled: false,
          reason:
            "webflix build with webflixProductSurface OFF (default, fail-closed — the gated " +
            "ZCode commercial surfaces stay unreachable; see ISOLATION_FLAG_POLICY)",
        };
  }
  return {
    enabled: false,
    reason: "unknown product flavor (fail-closed — no commercial surface)",
  };
}
