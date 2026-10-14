import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * P8-RELEASE-DRIFT-1 — T-6 runtime half (audit §4.2 / drift R3 §1.6):
 * a WebFlix runtime registers `webflix://` (app.setAsDefaultProtocolClient)
 * and NEVER claims `zcode://` on that surface; scheme values are sourced
 * from the frozen identity module; incoming `webflix://` URLs route through
 * the deep-link matcher. The build-config half of T-6 (electron-builder
 * `schemes`) is pinned in desktop-product-identity.test.ts (scheme values)
 * — the config import itself stays a packaging-tier claim (audit §3.6).
 */

const setAsDefaultProtocolClient = vi.hoisted(() =>
  vi.fn((_scheme: string, ..._rest: unknown[]) => true),
);

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    name: "WebFlix Dev",
    getPath: (name: string) => `/tmp/wf-deeplink-test/${name}`,
    setAsDefaultProtocolClient,
    show: vi.fn(),
  },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
    static getFocusedWindow(): null {
      return null;
    }
  },
  dialog: {
    showMessageBox: vi.fn(),
  },
}));

import {
  normalizeIncomingDeepLinkUrl,
  resolveDeepLinkSchemeForIdentity,
} from "./desktopOAuthDeepLink.js";

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of ["WEBFLIX_IDENTITY", "WEBFLIX_DATA_ROOT"]) {
    SAVED_ENV[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function importDeepLinkModule() {
  vi.resetModules();
  setAsDefaultProtocolClient.mockClear();
  return await import("./desktopOAuthDeepLink.js");
}

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
});

afterEach(() => {
  restoreEnv();
});

describe("scheme selection follows the identity module (R3, no new literals)", () => {
  it("WebFlix identity selects the frozen webflix scheme", () => {
    expect(resolveDeepLinkSchemeForIdentity(true)).toBe("webflix");
  });

  it("ZCode identity keeps the zcode scheme (zero migration impact)", () => {
    expect(resolveDeepLinkSchemeForIdentity(false)).toBe("zcode");
  });

  it("the selected schemes stay disjoint from each other", () => {
    expect(resolveDeepLinkSchemeForIdentity(true)).not.toBe(
      resolveDeepLinkSchemeForIdentity(false),
    );
  });
});

describe("T-6 — runtime protocol registration", () => {
  it("a WebFlix runtime registers webflix:// and never claims zcode://", async () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = ".wf-deeplink-isolated";
    const mod = await importDeepLinkModule();
    expect(mod.resolveRuntimeDeepLinkScheme()).toBe("webflix");
    const logger = { info: vi.fn(), warn: vi.fn() };
    mod.registerDeepLinkProtocol(logger, {});
    expect(setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith("webflix");
    const registeredSchemes = setAsDefaultProtocolClient.mock.calls.map(
      ([scheme]) => scheme as string,
    );
    expect(registeredSchemes).not.toContain("zcode");
  });

  it("a ZCode runtime keeps registering zcode:// (unchanged behavior)", async () => {
    const mod = await importDeepLinkModule();
    expect(mod.resolveRuntimeDeepLinkScheme()).toBe("zcode");
    const logger = { info: vi.fn(), warn: vi.fn() };
    mod.registerDeepLinkProtocol(logger, {});
    expect(setAsDefaultProtocolClient).toHaveBeenCalledWith("zcode");
  });
});

describe("incoming webflix:// URL aliasing (frozen matcher seam)", () => {
  it("aliases webflix:// URLs for the internal matcher only when the identity is active", () => {
    expect(
      normalizeIncomingDeepLinkUrl("webflix://workspace/open?path=/tmp/x", {
        webFlixIdentityActive: true,
      }),
    ).toBe("zcode://workspace/open?path=/tmp/x");
    expect(
      normalizeIncomingDeepLinkUrl("webflix://workspace/open?path=/tmp/x", {
        webFlixIdentityActive: false,
      }),
    ).toBe("webflix://workspace/open?path=/tmp/x");
  });

  it("handles uppercase WEBFLIX:// forms and leaves foreign URLs untouched", () => {
    expect(
      normalizeIncomingDeepLinkUrl("WEBFLIX://share/import?code=abc", {
        webFlixIdentityActive: true,
      }),
    ).toBe("zcode://share/import?code=abc");
    expect(
      normalizeIncomingDeepLinkUrl("https://webflix.org/watch", {
        webFlixIdentityActive: true,
      }),
    ).toBe("https://webflix.org/watch");
  });

  it("handleDeepLink routes a webflix:// workspace URL only under WebFlix identity", async () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = ".wf-deeplink-isolated";
    const webflixMod = await importDeepLinkModule();
    const logger = { info: vi.fn(), warn: vi.fn() };
    // The workspace gate returning false is a distinct, window-free outcome:
    // TRUE proves the webflix:// URL matched the workspace/open route.
    expect(
      webflixMod.handleDeepLink("webflix://workspace/open?path=/tmp/wf-probe", logger, {
        canOpenWorkspace: () => false,
      }),
    ).toBe(true);

    delete process.env.WEBFLIX_IDENTITY;
    delete process.env.WEBFLIX_DATA_ROOT;
    const zcodeMod = await importDeepLinkModule();
    // Without the WebFlix identity the same URL is not recognized (no alias).
    expect(
      zcodeMod.handleDeepLink("webflix://workspace/open?path=/tmp/wf-probe", logger, {
        canOpenWorkspace: () => false,
      }),
    ).toBe(false);
  });
});
