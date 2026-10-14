import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

/*
 * P8-RELEASE-DRIFT-1 — T-1 (audit §4.2 / §1.5): the desktopRuntimeEnv wiring
 * under a PACKAGED webflix runtime (isPackaged=true + baked flavor "webflix"
 * [vitest define] + WEBFLIX_IDENTITY unset) resolves the WebFlix identity
 * WITHOUT any env var — appName "WebFlix", userData on the frozen root.
 * Before R2 a packaged WebFlix boot ran named "ZCode" against appData/ZCode
 * and ~/.zcode (release-blocking freeze §6.1/§6.8 violation).
 *
 * Electron is mocked (isPackaged is switchable per test); every module in
 * the desktopRuntimeEnv import chain is the REAL source. The battery define
 * bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix" exactly like a WebFlix bundle.
 */

const electronState = vi.hoisted(() => ({ isPackaged: false }));

vi.mock("electron", () => {
  const app = {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getName: () => "WebFlix",
    getPath: (name: string) => `/tmp/wf-runtime-env-test/${name}`,
    setName: vi.fn(),
    setPath: vi.fn(),
    setAppUserModelId: vi.fn(),
  };
  return {
    app,
    BrowserWindow: class {},
    ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    default: { app },
  };
});

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

async function importDesktopRuntimeEnv() {
  vi.resetModules();
  return await import("./desktopRuntimeEnv.js");
}

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
});

afterEach(() => {
  restoreEnv();
  electronState.isPackaged = false;
});

describe("T-1 / R2 — packaged webflix runtime identity (no env var)", () => {
  it("resolves WebFlix identity: root .webflix, appName WebFlix, userData on the frozen root", async () => {
    electronState.isPackaged = true;
    const mod = await importDesktopRuntimeEnv();
    expect(mod.webFlixDataRootName).toBe(".webflix");
    expect(mod.runtimeApplicationName).toBe("WebFlix");
    expect(mod.runtimeUserDataPath).toBe(join(homedir(), ".webflix"));
    expect(mod.runtimeSessionDataPath).toBe(join(homedir(), ".webflix", "session"));
    // The env contract is exported back for the services layer (R2):
    expect(process.env.WEBFLIX_IDENTITY).toBe("1");
    expect(process.env.WEBFLIX_DATA_ROOT).toBe(".webflix");
  });

  it("packaged non-webflix runtime keeps the ZCode identity (zero migration impact)", async () => {
    electronState.isPackaged = true;
    process.env.WEBFLIX_IDENTITY = "0"; // force-off: even a baked webflix build stays ZCode
    const mod = await importDesktopRuntimeEnv();
    expect(mod.webFlixDataRootName).toBeUndefined();
    expect(mod.runtimeApplicationName).toBe("ZCode");
    expect(mod.runtimeUserDataPath).toBe(join("/tmp/wf-runtime-env-test/appData", "ZCode"));
  });

  it("dev runtime stays default-off; WEBFLIX_IDENTITY=1 opts in as WebFlix Dev", async () => {
    electronState.isPackaged = false;
    const devDefault = await importDesktopRuntimeEnv();
    expect(devDefault.webFlixDataRootName).toBeUndefined();
    expect(devDefault.runtimeApplicationName).toBe("ZCode Dev");

    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = ".wf-runtime-env-isolated";
    const devOptIn = await importDesktopRuntimeEnv();
    expect(devOptIn.webFlixDataRootName).toBe(".wf-runtime-env-isolated");
    expect(devOptIn.runtimeApplicationName).toBe("WebFlix Dev");
    expect(devOptIn.runtimeUserDataPath).toBe(join(homedir(), ".wf-runtime-env-isolated"));
  });
});

describe("runtime env exports stay importable (no boot-time throw on any flavor)", () => {
  it("the module evaluates cleanly for the packaged webflix flavor", async () => {
    electronState.isPackaged = true;
    const mod = await importDesktopRuntimeEnv();
    expect(typeof mod.buildHostProcessEnv).toBe("function");
    expect(mod.desktopRuntimeEnv).toBe("production");
  });

  it("the module evaluates cleanly for the dev runtime", async () => {
    electronState.isPackaged = false;
    const mod = await importDesktopRuntimeEnv();
    expect(mod.desktopRuntimeEnv).toBe("development");
  });
});
