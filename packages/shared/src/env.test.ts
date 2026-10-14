import { describe, expect, it } from "vitest";

import {
  ZCODE_ENV,
  ZCODE_PRODUCT_FLAVOR,
  normalizeZCodeEnv,
  normalizeZCodeProductFlavor,
  type ZCodeProductFlavor,
} from "./env.js";

/*
 * P8-RELEASE-DRIFT-1 — T-2 (audit release-safety-audit-2026-10-13 §4.2,
 * drift R1 §1.4): the baked `"webflix"` flavor must survive runtime
 * normalization VERBATIM. Before this fix every non-{production,preview}
 * value collapsed into the zcodeEnv fallback, so a packaged WebFlix build
 * resolved `dev.zcode.app[.preview]` as its AUMID and enabled the ZCode
 * updater/force-update surfaces (hazard H1 §2.2).
 */
describe("normalizeZCodeProductFlavor (P8-RELEASE-DRIFT-1 T-2 / R1)", () => {
  it('preserves a baked "webflix" verbatim, on both backend axes', () => {
    const bakedTest: ZCodeProductFlavor = normalizeZCodeProductFlavor("webflix", "test");
    const bakedProd: ZCodeProductFlavor = normalizeZCodeProductFlavor("webflix", "production");
    expect(bakedTest).toBe("webflix");
    expect(bakedProd).toBe("webflix");
  });

  it('preserves "production" and "preview" verbatim (existing single-axis semantics)', () => {
    expect(normalizeZCodeProductFlavor("production", "test")).toBe("production");
    expect(normalizeZCodeProductFlavor("preview", "production")).toBe("preview");
  });

  it("normalizes case and surrounding whitespace before matching", () => {
    expect(normalizeZCodeProductFlavor("  WebFLIX ", "test")).toBe("webflix");
    expect(normalizeZCodeProductFlavor("Production", "test")).toBe("production");
  });

  it("keeps the fail-closed zcodeEnv fallback for unknown values", () => {
    expect(normalizeZCodeProductFlavor("canary", "production")).toBe("production");
    expect(normalizeZCodeProductFlavor("canary", "test")).toBe("preview");
  });

  it("keeps the fail-closed zcodeEnv fallback for absent values", () => {
    expect(normalizeZCodeProductFlavor(undefined, "production")).toBe("production");
    expect(normalizeZCodeProductFlavor(undefined, "test")).toBe("preview");
    expect(normalizeZCodeProductFlavor("", "test")).toBe("preview");
  });

  it('never rewrites "webflix" into a ZCode flavor (the R1 drift)', () => {
    for (const zcodeEnv of ["test", "production"] as const) {
      expect(normalizeZCodeProductFlavor("webflix", zcodeEnv)).not.toBe("production");
      expect(normalizeZCodeProductFlavor("webflix", zcodeEnv)).not.toBe("preview");
    }
  });
});

describe("ZCODE_PRODUCT_FLAVOR runtime constant (baked define path)", () => {
  it("derives from the baked define via the same normalization", () => {
    // This battery bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix" (vitest.config.ts
    // define, mirroring tsup.config.ts:104 for WEBFLIX_IDENTITY=1 builds) — the
    // packaged WebFlix runtime receives exactly this define, so the constant
    // must carry the baked flavor through unchanged.
    expect(ZCODE_PRODUCT_FLAVOR).toBe("webflix");
  });

  it("ZCODE_ENV stays on the backend axis (test default without a bake)", () => {
    expect(["test", "production"]).toContain(normalizeZCodeEnv(undefined));
    expect(typeof ZCODE_ENV).toBe("string");
  });
});
