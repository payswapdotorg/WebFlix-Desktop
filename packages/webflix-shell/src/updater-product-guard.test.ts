import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isZCodeUpdaterSurfaceEnabledForFlavor,
  resolveWebFlixUpdaterRefusal,
  shouldSkipForceUpdateGateForFlavor,
} from "./updater-product-guard.js";

/*
 * P8-RELEASE-DRIFT-1 — T-8 / R1 consumer matrix (audit §4.2, hazard H1 §2.2):
 * every flavor member is handled EXPLICITLY by the updater-surface gates —
 * production keeps the ZCode updater, preview and webflix fail CLOSED,
 * unknown flavors fail closed. Also pins the vendoring contract: the
 * desktop main process imports a byte-identical copy of this module
 * (packages/desktop/src/main/webflix/updater-product-guard.ts), so any
 * drift between the two files fails here.
 */

describe("isZCodeUpdaterSurfaceEnabledForFlavor (tray/menu/manual entries)", () => {
  it("enables the updater surface only for the ZCode production flavor", () => {
    expect(isZCodeUpdaterSurfaceEnabledForFlavor("production")).toBe(true);
  });

  it("disables it for preview and webflix, explicitly", () => {
    expect(isZCodeUpdaterSurfaceEnabledForFlavor("preview")).toBe(false);
    expect(isZCodeUpdaterSurfaceEnabledForFlavor("webflix")).toBe(false);
  });

  it("fails closed for unknown flavors", () => {
    expect(isZCodeUpdaterSurfaceEnabledForFlavor("canary")).toBe(false);
    expect(isZCodeUpdaterSurfaceEnabledForFlavor("")).toBe(false);
  });
});

describe("resolveWebFlixUpdaterRefusal (H1 fail-closed product guard)", () => {
  it("refuses when the WebFlix runtime identity is active, with a logged reason", () => {
    const refusal = resolveWebFlixUpdaterRefusal({ webFlixIdentityActive: true });
    expect(refusal.refuse).toBe(true);
    expect(refusal.reason).toContain("WebFlix runtime product identity");
  });

  it("refuses when the baked flavor is webflix, with a logged reason", () => {
    const refusal = resolveWebFlixUpdaterRefusal({ flavor: "webflix" });
    expect(refusal.refuse).toBe(true);
    expect(refusal.reason).toContain("webflix");
  });

  it("the identity signal wins over any flavor spelling (defense in depth)", () => {
    const refusal = resolveWebFlixUpdaterRefusal({
      flavor: "production",
      webFlixIdentityActive: true,
    });
    expect(refusal.refuse).toBe(true);
  });

  it("does not refuse ZCode production/preview runtimes", () => {
    expect(resolveWebFlixUpdaterRefusal({ flavor: "production" }).refuse).toBe(false);
    expect(resolveWebFlixUpdaterRefusal({ flavor: "preview" }).refuse).toBe(false);
    expect(resolveWebFlixUpdaterRefusal({}).refuse).toBe(false);
    expect(resolveWebFlixUpdaterRefusal({ flavor: "production" }).reason).toBeNull();
  });
});

describe("shouldSkipForceUpdateGateForFlavor (ZCode kill-switch gate)", () => {
  it("runs the gate only for the ZCode production flavor", () => {
    expect(shouldSkipForceUpdateGateForFlavor("production").skip).toBe(false);
  });

  it("skips preview and webflix with distinct, explicit reasons", () => {
    expect(shouldSkipForceUpdateGateForFlavor("preview")).toEqual({
      skip: true,
      reason: "preview",
    });
    expect(shouldSkipForceUpdateGateForFlavor("webflix").skip).toBe(true);
    expect(shouldSkipForceUpdateGateForFlavor("webflix").reason).toContain(
      "webflix-never-consults-the-zcode-kill-switch",
    );
  });

  it("fails closed for unknown flavors", () => {
    expect(shouldSkipForceUpdateGateForFlavor("beta").skip).toBe(true);
  });
});

describe("vendoring contract (updater-guard.ts pattern)", () => {
  it("the desktop copy is byte-identical to this module (no mirror drift)", () => {
    const shellSource = readFileSync(
      new URL("./updater-product-guard.ts", import.meta.url),
      "utf8",
    );
    const desktopSource = readFileSync(
      new URL(
        "../../../packages/desktop/src/main/webflix/updater-product-guard.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(desktopSource).toBe(shellSource);
  });
});
