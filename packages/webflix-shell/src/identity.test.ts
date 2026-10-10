import { describe, expect, it } from "vitest";

import {
  CANONICAL_ENV_PREFIX,
  FLAVOR,
  LegacyIdentityCollisionError,
  LEGACY_ZCODE_IDENTITY,
  WEBFLIX_IDENTITY,
  aumidFor,
  assertWebFlixIdentity,
  dataRootFor,
  isWebflixSchemeUrl,
  readEnv,
  resolveDataRoot,
} from "./identity";

describe("frozen WebFlix identity values (freeze §6.1)", () => {
  it("pins the flavor", () => {
    expect(FLAVOR).toBe("webflix");
  });

  it("pins appId to org.webflix.desktop (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.appId).toBe("org.webflix.desktop");
  });

  it("pins productName to WebFlix (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.productName).toBe("WebFlix");
  });

  it("pins the scheme to webflix:// (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.scheme).toBe("webflix://");
  });

  it("pins the production data root to ~/.webflix (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.dataRoot).toBe("~/.webflix");
  });

  it("pins the development data root to ~/.webflix-dev (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.devDataRoot).toBe("~/.webflix-dev");
  });

  it("pins the development AUMID to org.webflix.desktop.dev (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.devAumid).toBe("org.webflix.desktop.dev");
  });

  it("pins the Linux package glob and concrete names (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.linuxPackageGlob).toBe("webflix-desktop*");
    expect(WEBFLIX_IDENTITY.linuxPackageNames).toEqual(["webflix-desktop", "webflix-desktop-dev"]);
  });

  it("keeps the legacy ZCODE_* env aliases during migration (freeze §6.1)", () => {
    expect(WEBFLIX_IDENTITY.legacyEnvPrefix).toBe("ZCODE_");
  });

  it("exposes exactly the frozen keys", () => {
    expect(Object.keys(WEBFLIX_IDENTITY).sort()).toEqual(
      [
        "appId",
        "dataRoot",
        "devAumid",
        "devDataRoot",
        "legacyEnvPrefix",
        "linuxPackageGlob",
        "linuxPackageNames",
        "productName",
        "scheme",
      ].sort(),
    );
  });

  it("matches the frozen record as a whole", () => {
    expect(WEBFLIX_IDENTITY).toEqual({
      appId: "org.webflix.desktop",
      productName: "WebFlix",
      scheme: "webflix://",
      dataRoot: "~/.webflix",
      devDataRoot: "~/.webflix-dev",
      devAumid: "org.webflix.desktop.dev",
      linuxPackageGlob: "webflix-desktop*",
      linuxPackageNames: ["webflix-desktop", "webflix-desktop-dev"],
      legacyEnvPrefix: "ZCODE_",
    });
  });

  it("is frozen at runtime", () => {
    expect(Object.isFrozen(WEBFLIX_IDENTITY)).toBe(true);
  });
});

describe("legacy ZCode identity is pinned for coexistence checks", () => {
  it("pins the legacy values exactly", () => {
    expect(LEGACY_ZCODE_IDENTITY).toEqual({
      appId: "cn.aminer.zcode",
      scheme: "zcode://",
      dataRoot: "~/.zcode",
      envPrefix: "ZCODE_",
      buggyDevAumid: "cn.aminer.zcode",
    });
    expect(Object.isFrozen(LEGACY_ZCODE_IDENTITY)).toBe(true);
  });
});

describe("legacy dev AUMID cn.aminer.zcode is NOT used", () => {
  it("never uses the legacy ZCode AUMID as the WebFlix dev AUMID", () => {
    expect(WEBFLIX_IDENTITY.devAumid).not.toBe("cn.aminer.zcode");
    expect(WEBFLIX_IDENTITY.devAumid).not.toBe(LEGACY_ZCODE_IDENTITY.appId);
    expect(WEBFLIX_IDENTITY.devAumid).not.toBe(LEGACY_ZCODE_IDENTITY.buggyDevAumid);
  });

  it("never reuses the production appId as the dev AUMID (AUDIT-DESKTOP)", () => {
    expect(WEBFLIX_IDENTITY.devAumid).not.toBe(WEBFLIX_IDENTITY.appId);
    expect(WEBFLIX_IDENTITY.devAumid.endsWith(".dev")).toBe(true);
    expect(WEBFLIX_IDENTITY.appId.endsWith(".dev")).toBe(false);
  });

  it("resolves AUMIDs per mode", () => {
    expect(aumidFor("prod")).toBe("org.webflix.desktop");
    expect(aumidFor("dev")).toBe("org.webflix.desktop.dev");
  });

  it("rejects a WebFlix surface carrying the legacy AUMID", () => {
    expect(() =>
      assertWebFlixIdentity({ appId: WEBFLIX_IDENTITY.appId, aumid: "cn.aminer.zcode" }),
    ).toThrow(LegacyIdentityCollisionError);
    expect(() =>
      assertWebFlixIdentity({ appId: WEBFLIX_IDENTITY.appId, aumid: "cn.aminer.zcode" }),
    ).toThrow(/cn\.aminer\.zcode/);
  });

  it("rejects an appId equal to the legacy ZCode appId", () => {
    expect(() => assertWebFlixIdentity({ appId: "cn.aminer.zcode" })).toThrow(
      LegacyIdentityCollisionError,
    );
  });
});

describe("ZCode/WebFlix coexistence (freeze §6.1)", () => {
  it("uses separate userData data roots", () => {
    expect(WEBFLIX_IDENTITY.dataRoot).not.toBe(WEBFLIX_IDENTITY.devDataRoot);
    expect(dataRootFor("prod")).toBe("~/.webflix");
    expect(dataRootFor("dev")).toBe("~/.webflix-dev");
    expect(dataRootFor("prod")).not.toBe(LEGACY_ZCODE_IDENTITY.dataRoot);
    expect(dataRootFor("dev")).not.toBe(LEGACY_ZCODE_IDENTITY.dataRoot);
    expect(
      new Set([dataRootFor("prod"), dataRootFor("dev"), LEGACY_ZCODE_IDENTITY.dataRoot]).size,
    ).toBe(3);
  });

  it("uses pairwise-distinct AUMIDs", () => {
    const aumids = [aumidFor("prod"), aumidFor("dev"), LEGACY_ZCODE_IDENTITY.appId];
    expect(new Set(aumids).size).toBe(3);
  });

  it("uses a scheme disjoint from the legacy ZCode scheme", () => {
    expect(WEBFLIX_IDENTITY.scheme).not.toBe(LEGACY_ZCODE_IDENTITY.scheme);
    expect(isWebflixSchemeUrl("webflix://open?item=42")).toBe(true);
    expect(isWebflixSchemeUrl("WEBFLIX://OPEN")).toBe(true);
    expect(isWebflixSchemeUrl("zcode://open")).toBe(false);
    expect(() =>
      assertWebFlixIdentity({ appId: WEBFLIX_IDENTITY.appId, scheme: "zcode://" }),
    ).toThrow(LegacyIdentityCollisionError);
  });

  it("uses Linux package names disjoint from the legacy ZCode packages", () => {
    for (const name of WEBFLIX_IDENTITY.linuxPackageNames) {
      expect(name.startsWith("webflix-desktop")).toBe(true);
      expect(name.toLowerCase().includes("zcode")).toBe(false);
    }
    expect(new Set(WEBFLIX_IDENTITY.linuxPackageNames).size).toBe(
      WEBFLIX_IDENTITY.linuxPackageNames.length,
    );
  });

  it("rejects a WebFlix surface carrying the legacy data root", () => {
    expect(() =>
      assertWebFlixIdentity({ appId: WEBFLIX_IDENTITY.appId, dataRoot: "~/.zcode" }),
    ).toThrow(LegacyIdentityCollisionError);
  });

  it("accepts the canonical production surface", () => {
    expect(() =>
      assertWebFlixIdentity({
        appId: WEBFLIX_IDENTITY.appId,
        aumid: aumidFor("prod"),
        dataRoot: dataRootFor("prod"),
        scheme: WEBFLIX_IDENTITY.scheme,
      }),
    ).not.toThrow();
  });

  it("accepts the canonical development surface", () => {
    expect(() =>
      assertWebFlixIdentity({
        appId: WEBFLIX_IDENTITY.appId,
        aumid: aumidFor("dev"),
        dataRoot: dataRootFor("dev"),
        scheme: WEBFLIX_IDENTITY.scheme,
      }),
    ).not.toThrow();
  });
});

describe("env aliases during migration (freeze §6.1)", () => {
  it("falls back to legacy ZCODE_* aliases", () => {
    expect(readEnv({ ZCODE_DATA_DIR: "/legacy" }, "DATA_DIR")).toBe("/legacy");
  });

  it("prefers canonical WEBFLIX_* over legacy ZCODE_*", () => {
    expect(readEnv({ WEBFLIX_DATA_DIR: "/webflix", ZCODE_DATA_DIR: "/legacy" }, "DATA_DIR")).toBe(
      "/webflix",
    );
  });

  it("treats empty strings as unset", () => {
    expect(readEnv({ WEBFLIX_DATA_DIR: "", ZCODE_DATA_DIR: "/legacy" }, "DATA_DIR")).toBe(
      "/legacy",
    );
    expect(readEnv({ WEBFLIX_DATA_DIR: "", ZCODE_DATA_DIR: "" }, "DATA_DIR")).toBeUndefined();
  });

  it("returns undefined when neither alias is present", () => {
    expect(readEnv({}, "DATA_DIR")).toBeUndefined();
  });

  it("keeps the canonical prefix distinct from the frozen legacy prefix", () => {
    expect(CANONICAL_ENV_PREFIX).toBe("WEBFLIX_");
    expect(CANONICAL_ENV_PREFIX).not.toBe(WEBFLIX_IDENTITY.legacyEnvPrefix);
  });
});

describe("data-root resolution helpers", () => {
  it("expands the frozen ~ data roots against a home directory", () => {
    expect(resolveDataRoot(WEBFLIX_IDENTITY.dataRoot, "/home/alice")).toBe("/home/alice/.webflix");
    expect(resolveDataRoot(WEBFLIX_IDENTITY.devDataRoot, "/home/alice")).toBe(
      "/home/alice/.webflix-dev",
    );
  });

  it("leaves absolute roots untouched", () => {
    expect(resolveDataRoot("/var/lib/webflix", "/home/alice")).toBe("/var/lib/webflix");
  });

  it("expands a bare ~ to the home directory", () => {
    expect(resolveDataRoot("~", "/home/alice")).toBe("/home/alice");
  });
});
