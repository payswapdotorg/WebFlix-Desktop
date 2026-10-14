import { describe, expect, it } from "vitest";

import { LEGACY_ZCODE_IDENTITY, WEBFLIX_IDENTITY, protocolSchemeNameOf } from "./identity.js";

/*
 * P8-RELEASE-DRIFT-1 — T-6 value half + R3 (audit §1.6): the frozen scheme
 * values are the ONLY source for protocol registration; `webflix://` and
 * `zcode://` stay disjoint; the bare-scheme helper used by
 * app.setAsDefaultProtocolClient / electron-builder `schemes` derives from
 * the frozen values with no new literals. The desktop mirror of this module
 * (packages/desktop/src/main/webflix/identity.ts) is byte-identical except
 * for its header comment (audit §1.1) — the scheme pin below therefore
 * covers both mirrors.
 */

describe("protocolSchemeNameOf (bare scheme for OS registration)", () => {
  it("strips the :// suffix from the frozen scheme values", () => {
    expect(protocolSchemeNameOf(WEBFLIX_IDENTITY.scheme)).toBe("webflix");
    expect(protocolSchemeNameOf(LEGACY_ZCODE_IDENTITY.scheme)).toBe("zcode");
  });

  it("is idempotent and tolerates single-slash spellings", () => {
    expect(protocolSchemeNameOf(protocolSchemeNameOf(WEBFLIX_IDENTITY.scheme))).toBe("webflix");
    expect(protocolSchemeNameOf("webflix:/")).toBe("webflix");
  });

  it("leaves bare scheme names untouched", () => {
    expect(protocolSchemeNameOf("webflix")).toBe("webflix");
    expect(protocolSchemeNameOf("zcode")).toBe("zcode");
  });
});

describe("frozen scheme disjointness (freeze §6.1 coexistence)", () => {
  it("webflix:// is the frozen WebFlix scheme; zcode:// is the legacy reference", () => {
    expect(WEBFLIX_IDENTITY.scheme).toBe("webflix://");
    expect(LEGACY_ZCODE_IDENTITY.scheme).toBe("zcode://");
    expect(WEBFLIX_IDENTITY.scheme).not.toBe(LEGACY_ZCODE_IDENTITY.scheme);
  });

  it("the bare registration names are disjoint too (no handler-ownership collision)", () => {
    expect(protocolSchemeNameOf(WEBFLIX_IDENTITY.scheme)).not.toBe(
      protocolSchemeNameOf(LEGACY_ZCODE_IDENTITY.scheme),
    );
  });

  it("no WebFlix scheme value contains the zcode spelling", () => {
    expect(WEBFLIX_IDENTITY.scheme.toLowerCase().includes("zcode")).toBe(false);
    expect(protocolSchemeNameOf(WEBFLIX_IDENTITY.scheme).includes("zcode")).toBe(false);
  });
});
