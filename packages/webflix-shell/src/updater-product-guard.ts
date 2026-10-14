/**
 * Product-flavor gates for the desktop updater surfaces — PURE module
 * (no Electron, no Node built-ins, no imports at all).
 *
 * P8-RELEASE-DRIFT-1 (audit release-safety-audit-2026-10-13 §2.2, hazard H1
 * + drift R1): the ZCode updater surfaces (auto-update enablement, manual
 * "Check for Updates" entries, the force-update kill-switch gate) must never
 * fire for a WebFlix product runtime — freeze §6.1 defers the WebFlix feed
 * ("no Phase-1 releases"), so a WebFlix build pointing at the ZCode manifest
 * feed is cross-product update contamination. Every flavor member is handled
 * EXPLICITLY; unknown flavors fail CLOSED (no updater surface).
 *
 * Vendored into packages/desktop/src/main/webflix/updater-product-guard.ts
 * (byte-identical copy — the updater-guard.ts pattern). The shell-side test
 * battery pins this module; the vendored copy is what the desktop main
 * process imports. Byte-identity between the two is pinned by the test.
 */

/** The three desktop product flavors (mirrors ZCodeProductFlavor structurally). */
export type DesktopProductFlavor = "production" | "preview" | "webflix";

/** Whether the flavor carries a ZCode updater surface at all (tray/menu/manual entries). */
export function isZCodeUpdaterSurfaceEnabledForFlavor(flavor: string): boolean {
  if (flavor === "production") {
    return true;
  }
  if (flavor === "preview") {
    // Preview（含生产后端的 Preview）没有更新渠道：stable feed 只分发正式 ZCode 包。
    return false;
  }
  if (flavor === "webflix") {
    // freeze §6.1：WebFlix feed DEFERRED——更新器入口整体 fail-closed。
    return false;
  }
  // 未知 flavor：fail-closed，绝不露出更新入口。
  return false;
}

/** Outcome of the H1 fail-closed product guard for updater enablement. */
export interface WebFlixUpdaterRefusal {
  readonly refuse: boolean;
  readonly reason: string | null;
}

/**
 * H1 fail-closed product guard (defense in depth): the updater chain itself
 * refuses enablement when the runtime product identity is WebFlix — whether
 * that identity comes from the baked flavor (`"webflix"`) or from a resolved
 * WebFlix data root (WEBFLIX_IDENTITY=1 explicit override, packaged
 * default-on per R2). A future refactor that passes `enabled: true` for a
 * WebFlix build still cannot reach the ZCode feed.
 */
export function resolveWebFlixUpdaterRefusal(input: {
  flavor?: string;
  webFlixIdentityActive?: boolean;
}): WebFlixUpdaterRefusal {
  if (input.webFlixIdentityActive) {
    return {
      refuse: true,
      reason:
        "WebFlix runtime product identity is active (H1 fail-closed; freeze §6.1 defers the WebFlix update feed — the ZCode manifest feed must never serve a WebFlix build)",
    };
  }
  if (input.flavor === "webflix") {
    return {
      refuse: true,
      reason:
        "baked product flavor is webflix (H1 fail-closed; freeze §6.1 defers the WebFlix update feed — the ZCode manifest feed must never serve a WebFlix build)",
    };
  }
  return { refuse: false, reason: null };
}

/** Whether the ZCode force-update kill-switch gate may run for this flavor. */
export function shouldSkipForceUpdateGateForFlavor(flavor: string): {
  skip: boolean;
  reason: string;
} {
  if (flavor === "production") {
    return { skip: false, reason: "zcode-production-gate" };
  }
  if (flavor === "preview") {
    return { skip: true, reason: "preview" };
  }
  if (flavor === "webflix") {
    // 审计 §1.4 第 3 项：打包 WebFlix（生产后端）绝不能去查 ZCode 的
    // client-configs kill-switch API——那是 ZCode 产品的强升门。
    return { skip: true, reason: "webflix-never-consults-the-zcode-kill-switch" };
  }
  return { skip: true, reason: "unknown-flavor-fail-closed" };
}
