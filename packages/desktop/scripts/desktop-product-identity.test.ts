import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  WEBFLIX_IDENTITY_ENV,
  assertWebFlixIdentityNeverLeaksZCode,
  desktopProductIdentities,
  isWebFlixIdentityRequested,
  resolveDesktopArtifactSuffix,
  resolveDesktopProductFlavor,
  resolveDesktopProductIdentity,
  resolveWebFlixDataRootName,
  resolveWindowsAppUserModelId,
  resolveWindowsAppUserModelIdForFlavor,
} from "./desktop-product-identity.mjs";

/*
 * P8-RELEASE-DRIFT-1 — the audit §4.2 T-map pins over the single identity
 * switch point (release-safety-audit-2026-10-13 §1.2):
 * - T-1/R2: packaged runtime identity follows the BAKED flavor (audit §1.5);
 * - T-3/R1: packaged WebFlix AUMID is org.webflix.desktop, never dev.zcode.app*;
 * - T-6/R3 (build-config half): scheme values live on the identity objects;
 * - R4: artifact metadata (homepage/author/maintainer/manifest/cache names)
 *   switches by identity (PROPOSED WebFlix values — pinned so a swap is loud);
 * - T-7 (unit half): cross-product identity separation (distinct
 *   productName/appId/data-root/AUMID/package names).
 */

function envWith(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/** Read a file from the desktop package root (config-surface pins). */
async function readRepoFile(relativePath: string): Promise<string> {
  return await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("T-1 / R2 — packaged runtime identity follows the baked flavor", () => {
  it("packaged + baked webflix + WEBFLIX_IDENTITY unset → WebFlix identity ON (~/.webflix)", () => {
    expect(resolveWebFlixDataRootName(envWith({}), { isPackaged: true, flavor: "webflix" })).toBe(
      ".webflix",
    );
    expect(isWebFlixIdentityRequested(envWith({}), { isPackaged: true, flavor: "webflix" })).toBe(
      true,
    );
  });

  it("dev runtime + baked webflix stays default-OFF (explicit opt-in only, ~/.webflix-dev)", () => {
    expect(resolveWebFlixDataRootName(envWith({}), { isPackaged: false, flavor: "webflix" })).toBe(
      undefined,
    );
    expect(
      resolveWebFlixDataRootName(envWith({ WEBFLIX_IDENTITY: "1" }), {
        isPackaged: false,
        flavor: "webflix",
      }),
    ).toBe(".webflix-dev");
  });

  it("WEBFLIX_IDENTITY=1 forces the identity on in BOTH contexts (explicit override)", () => {
    expect(
      resolveWebFlixDataRootName(envWith({ WEBFLIX_IDENTITY: "1" }), {
        isPackaged: true,
        flavor: "production",
      }),
    ).toBe(".webflix");
    expect(
      resolveWebFlixDataRootName(envWith({ WEBFLIX_IDENTITY: "1" }), {
        isPackaged: false,
        flavor: "preview",
      }),
    ).toBe(".webflix-dev");
  });

  it("WEBFLIX_IDENTITY=0 forces the identity off even for a packaged webflix build", () => {
    expect(
      resolveWebFlixDataRootName(envWith({ WEBFLIX_IDENTITY: "0" }), {
        isPackaged: true,
        flavor: "webflix",
      }),
    ).toBe(undefined);
  });

  it("invalid WEBFLIX_IDENTITY spellings still throw (fail-closed, current semantics)", () => {
    expect(() =>
      resolveWebFlixDataRootName(envWith({ WEBFLIX_IDENTITY: "true" }), {
        isPackaged: true,
        flavor: "webflix",
      }),
    ).toThrow(/invalid WEBFLIX_IDENTITY/);
    expect(() => isWebFlixIdentityRequested(envWith({ WEBFLIX_IDENTITY: "yes" }))).toThrow(
      /expected 1 or 0/,
    );
  });

  it("non-webflix flavors keep the ZCode default (no env, packaged → no WebFlix root)", () => {
    expect(
      resolveWebFlixDataRootName(envWith({}), { isPackaged: true, flavor: "production" }),
    ).toBeUndefined();
    expect(
      resolveWebFlixDataRootName(envWith({}), { isPackaged: true, flavor: "preview" }),
    ).toBeUndefined();
  });

  it("WEBFLIX_DATA_ROOT stays the explicit test-isolation override", () => {
    expect(
      resolveWebFlixDataRootName(
        envWith({ WEBFLIX_IDENTITY: "1", WEBFLIX_DATA_ROOT: ".wf-test" }),
        {
          isPackaged: true,
        },
      ),
    ).toBe(".wf-test");
  });
});

describe("T-3 / R1 — packaged WebFlix AUMID", () => {
  it("resolves org.webflix.desktop for a packaged webflix runtime", () => {
    expect(resolveWindowsAppUserModelIdForFlavor("webflix", { isPackaged: true })).toBe(
      "org.webflix.desktop",
    );
  });

  it("never resolves a dev.zcode.app* AUMID on the webflix flavor (the R1 drift)", () => {
    for (const isPackaged of [true, false]) {
      const aumid = resolveWindowsAppUserModelIdForFlavor("webflix", { isPackaged });
      expect(aumid).not.toBe("dev.zcode.app");
      expect(aumid).not.toBe("dev.zcode.app.preview");
      expect(aumid).not.toMatch(/^dev\.zcode\.app/);
    }
  });

  it("keeps the dedicated dev AUMID org.webflix.desktop.dev (never cn.aminer.zcode)", () => {
    expect(resolveWindowsAppUserModelIdForFlavor("webflix", { isPackaged: false })).toBe(
      "org.webflix.desktop.dev",
    );
  });

  it("keeps the ZCode AUMIDs for ZCode flavors (zero migration impact)", () => {
    expect(resolveWindowsAppUserModelIdForFlavor("production", { isPackaged: true })).toBe(
      "dev.zcode.app",
    );
    expect(resolveWindowsAppUserModelIdForFlavor("preview", { isPackaged: true })).toBe(
      "dev.zcode.app.preview",
    );
    expect(
      resolveWindowsAppUserModelId(envWith({ ZCODE_ENV: "production" }), { isPackaged: true }),
    ).toBe("dev.zcode.app");
  });
});

describe("build-side flavor resolution (env-driven, unchanged by R2)", () => {
  it("WEBFLIX_IDENTITY=1 selects the webflix flavor (the tsup/vite bake input)", () => {
    expect(resolveDesktopProductFlavor(envWith({ WEBFLIX_IDENTITY: "1", ZCODE_ENV: "test" }))).toBe(
      "webflix",
    );
    expect(resolveDesktopProductIdentity(envWith({ WEBFLIX_IDENTITY: "1" })).productName).toBe(
      "WebFlix",
    );
  });

  it("WEBFLIX_IDENTITY + ZCODE_PREVIEW_IDENTITY together still throw (mutual exclusion)", () => {
    expect(() =>
      resolveDesktopProductFlavor(envWith({ WEBFLIX_IDENTITY: "1", ZCODE_PREVIEW_IDENTITY: "1" })),
    ).toThrow(/mutually exclusive/);
  });

  it("artifact suffix stays backend-axis only (_TEST for test backend)", () => {
    expect(resolveDesktopArtifactSuffix(envWith({ ZCODE_ENV: "test" }))).toBe("_TEST");
    expect(resolveDesktopArtifactSuffix(envWith({ ZCODE_ENV: "production" }))).toBe("");
  });
});

describe("T-6 / R3 (build-config half) + R4 — identity-sourced packaging values", () => {
  it("every flavor carries a scheme; WebFlix registers webflix, ZCode flavors zcode", () => {
    expect(desktopProductIdentities.webflix.scheme).toBe("webflix");
    expect(desktopProductIdentities.production.scheme).toBe("zcode");
    expect(desktopProductIdentities.preview.scheme).toBe("zcode");
  });

  it("electron-builder.config.js sources the scheme + metadata from the identity (no literals)", async () => {
    const configSource = await readRepoFile("../electron-builder.config.js");
    // R3: protocol registration follows the identity module, never a hardcoded scheme.
    expect(configSource).toContain("schemes: [desktopProductIdentity.scheme]");
    expect(configSource).not.toContain('schemes: ["zcode"]');
    // R4: artifact metadata switches by identity.
    expect(configSource).toContain("homepage: desktopProductIdentity.homepage");
    expect(configSource).toContain("desktopProductIdentity.authorName");
    expect(configSource).toContain("desktopProductIdentity.authorEmail");
    expect(configSource).toContain("desktopProductIdentity.installManifestName");
  });

  it("dev-app-update.yml keeps the ZCode cache name (the only reachable dev-updater context)", async () => {
    // The yml is static; the WebFlix dev-updater is refused by the H1 product
    // guard (autoUpdater.ts), so the ZCode value is identity-correct for every
    // reachable state. Pinned so the coupling is loud if either side drifts.
    const ymlSource = await readRepoFile("../dev-app-update.yml");
    expect(ymlSource).toContain(
      `updaterCacheDirName: ${desktopProductIdentities.production.updaterCacheDirName}`,
    );
    expect(ymlSource).not.toContain("webflix-dev-updater");
  });

  it("WebFlix artifact metadata carries no ZCode strings (R4)", () => {
    const webflix = desktopProductIdentities.webflix;
    expect(webflix.homepage).toBe("https://webflix.org"); // PROPOSED (flagged for TL2)
    expect(webflix.authorName).toBe("WebFlix"); // PROPOSED (flagged for TL2)
    expect(webflix.authorEmail).toBe("dev@webflix.org"); // PROPOSED (flagged for TL2)
    expect(webflix.installManifestName).toBe(".webflix-install-manifest");
    expect(webflix.updaterCacheDirName).toBe("webflix-dev-updater");
    for (const value of [
      webflix.homepage,
      webflix.authorName,
      webflix.authorEmail,
      webflix.installManifestName,
      webflix.updaterCacheDirName,
    ]) {
      expect(value).not.toContain("zcode");
    }
  });

  it("ZCode flavors keep the exact ZCode metadata (zero migration impact)", () => {
    for (const flavor of ["production", "preview"] as const) {
      const identity = desktopProductIdentities[flavor];
      expect(identity.homepage).toBe("https://zcode.z.ai");
      expect(identity.authorName).toBe("ZCode");
      expect(identity.authorEmail).toBe("dev@zcode.z.ai");
      expect(identity.installManifestName).toBe(".zcode-install-manifest");
      expect(identity.updaterCacheDirName).toBe("zcode-dev-updater");
    }
  });

  it("deb/rpm non-empty field requirement stays satisfied for every flavor (fpm validation)", () => {
    for (const identity of Object.values(desktopProductIdentities)) {
      expect(identity.homepage.trim().length).toBeGreaterThan(0);
      expect(identity.authorName.trim().length).toBeGreaterThan(0);
      expect(identity.authorEmail).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }
  });

  it("the resolved WebFlix identity passes the leak guard", () => {
    expect(
      assertWebFlixIdentityNeverLeaksZCode(
        resolveDesktopProductIdentity(envWith({ WEBFLIX_IDENTITY: "1" })),
      ),
    ).toBe(true);
  });
});

describe("T-7 (unit half) — WebFlix/ZCode identity separation at the switch point", () => {
  it("productNames are pairwise distinct", () => {
    const names = [
      desktopProductIdentities.production.productName,
      desktopProductIdentities.preview.productName,
      desktopProductIdentities.webflix.productName,
    ];
    expect(new Set(names).size).toBe(3);
  });

  it("appIds (packaged AUMIDs) are pairwise distinct", () => {
    const appIds = [
      desktopProductIdentities.production.appId,
      desktopProductIdentities.preview.appId,
      desktopProductIdentities.webflix.appId,
    ];
    expect(new Set(appIds).size).toBe(3);
  });

  it("Linux package names are pairwise distinct (no dpkg/rpm upgrade crossover)", () => {
    const packages = [
      desktopProductIdentities.production.linuxPackageName,
      desktopProductIdentities.preview.linuxPackageName,
      desktopProductIdentities.webflix.linuxPackageName,
    ];
    expect(new Set(packages).size).toBe(3);
    expect(desktopProductIdentities.webflix.linuxPackageName).toBe("webflix-desktop");
  });

  it("the WebFlix data root is disjoint from every ZCode path segment", () => {
    expect(desktopProductIdentities.webflix.dataRoot).toBe(".webflix");
    expect(desktopProductIdentities.webflix.devDataRoot).toBe(".webflix-dev");
    expect(desktopProductIdentities.webflix.dataRoot).not.toBe(".zcode");
    expect(desktopProductIdentities.webflix.devDataRoot).not.toBe(".zcode");
  });
});

describe("WEBFLIX_IDENTITY_ENV export", () => {
  it("stays the documented env var name (freeze §6.1 switch point)", () => {
    expect(WEBFLIX_IDENTITY_ENV).toBe("WEBFLIX_IDENTITY");
  });
});
