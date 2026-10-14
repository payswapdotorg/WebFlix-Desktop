import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * P8-ISOLATION-WIRING-1 — #4 (isolation audit §3.4 finding): the
 * `webflixProductSurface` flag (default OFF) actually GATES the ZCode
 * commercial surfaces at their REAL owners in packages/desktop/src/main —
 * unreachable-when-off, the chrome-import analogue of
 * desktopBrowserDataIpc.ts / webflix-smoke.mjs:229-234.
 *
 * The vitest battery define bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix"
 * exactly like a WebFlix bundle (P8-RELEASE-DRIFT-1 battery plumbing), so
 * the wiring tests below exercise the WebFlix-build gating: flag unset →
 * surfaces OFF; WEBFLIX_ENABLE_PRODUCT_SURFACE=1 → surfaces ON. The flavor
 * matrix (ZCode identity builds are NEVER gated — the zero-ZCode-regression
 * acceptance) is pinned directly against the pure gate module.
 */

const ipcState = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  listeners: new Map<string, unknown>(),
  menuTemplates: [] as unknown[][],
  fromPartition: new Map<
    string,
    { clearCache: ReturnType<typeof vi.fn>; clearStorageData: ReturnType<typeof vi.fn> }
  >(),
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getName: () => "WebFlix Dev",
    getVersion: () => "0.0.0",
    getPath: (name: string) => `/tmp/wf-product-surface-test/${name}`,
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
  },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
    static getFocusedWindow(): null {
      return null;
    }
    static fromWebContents(): null {
      return null;
    }
  },
  dialog: { showMessageBox: vi.fn(), showMessageBoxSync: vi.fn(() => 0) },
  ipcMain: {
    handle: vi.fn((channel: string, fn: unknown) => {
      ipcState.handlers.set(channel, fn);
    }),
    on: vi.fn((channel: string, fn: unknown) => {
      ipcState.listeners.set(channel, fn);
    }),
    removeHandler: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn((template: unknown[]) => {
      ipcState.menuTemplates.push(template);
      return {};
    }),
    setApplicationMenu: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toDataURL: () => "" }) }),
    createFromDataURL: () => ({ isEmpty: () => false }),
  },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
  session: {
    fromPartition: vi.fn((partition: string) => {
      let entry = ipcState.fromPartition.get(partition);
      if (!entry) {
        entry = { clearCache: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}) };
        ipcState.fromPartition.set(partition, entry);
      }
      return entry;
    }),
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock("@arms/rum-electron", () => ({
  default: { sendCustom: vi.fn() },
}));

// desktopCommandHandlers + desktopApplicationMenu import the updater module
// at module scope; the disconnect path under test never touches it — mock it
// out so the cold import stays light (the electron-updater graph is the
// recorded T-8 slow-import class).
vi.mock("./autoUpdater.js", () => ({
  checkForUpdateMenuClick: vi.fn(),
  CHECK_FOR_UPDATE_MENU_ID: "help.check-for-updates",
  setAutoUpdaterMenuLocale: vi.fn(),
}));

import { resolveZCodeProductSurfaceForRuntime } from "./webflix/product-surface-guard.js";
import { PRODUCT_SURFACE_ENV, resolveIsolationFlags } from "./webflix/isolation-flags.js";
import { DesktopCommandIds, PlatformChannels } from "@zcode/shared";

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of [
    PRODUCT_SURFACE_ENV,
    "ZCODE_ENABLE_PRODUCT_SURFACE",
    "WEBFLIX_ENABLE_CHROME_IMPORT",
    "ZCODE_LARK_CLI_BINARY",
    "WEBFLIX_IDENTITY",
    "WEBFLIX_DATA_ROOT",
  ]) {
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

beforeEach(() => {
  snapshotEnv();
  delete process.env[PRODUCT_SURFACE_ENV];
  delete process.env.ZCODE_ENABLE_PRODUCT_SURFACE;
  delete process.env.ZCODE_LARK_CLI_BINARY;
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
  ipcState.handlers.clear();
  ipcState.listeners.clear();
  ipcState.menuTemplates.length = 0;
  ipcState.fromPartition.clear();
});

afterEach(() => {
  restoreEnv();
});

describe("product-surface-guard — pure flavor matrix (#4)", () => {
  it("ZCode identity builds are NEVER gated by the flag (zero ZCode regression)", () => {
    for (const flavor of ["production", "preview"]) {
      expect(
        resolveZCodeProductSurfaceForRuntime({ flavor, webflixProductSurface: false }),
      ).toEqual({ enabled: true, reason: expect.stringContaining("zcode-identity-build") });
      expect(resolveZCodeProductSurfaceForRuntime({ flavor, webflixProductSurface: true })).toEqual(
        { enabled: true, reason: expect.stringContaining("zcode-identity-build") },
      );
    }
  });

  it("a WebFlix build follows the flag: default OFF, explicit opt-in ON", () => {
    expect(
      resolveZCodeProductSurfaceForRuntime({ flavor: "webflix", webflixProductSurface: false }),
    ).toEqual({ enabled: false, reason: expect.stringContaining("fail-closed") });
    expect(
      resolveZCodeProductSurfaceForRuntime({ flavor: "webflix", webflixProductSurface: true }),
    ).toEqual({ enabled: true, reason: expect.stringContaining("explicitly enabled") });
  });

  it("unknown flavors fail CLOSED (no commercial surface)", () => {
    expect(resolveZCodeProductSurfaceForRuntime({ flavor: "strange" })).toEqual({
      enabled: false,
      reason: expect.stringContaining("fail-closed"),
    });
    expect(resolveZCodeProductSurfaceForRuntime({})).toEqual({
      enabled: false,
      reason: expect.stringContaining("fail-closed"),
    });
  });

  it("the battery bakes the WebFlix flavor and the flag resolves OFF by default", () => {
    // The wiring tests below run under the baked webflix flavor define, so
    // the reachable states are exactly the flag's two fail-closed-parsed
    // values.
    expect(resolveIsolationFlags(process.env).webflixProductSurface).toBe(false);
    expect(resolveZCodeProductSurfaceForRuntime({ flavor: "webflix" }).enabled).toBe(false);
  });
});

async function importRemoteIpc() {
  vi.resetModules();
  return await import("./desktopMainIpcRemote.js");
}

function remoteIpcOptions() {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    appTelemetryRuntime: {
      onRendererReady: vi.fn(),
      syncRendererContext: vi.fn(),
      onOAuthCallbackHandled: vi.fn(),
    },
    onOAuthCallbackHandledSideEffect: vi.fn(),
    appTelemetryCore: { reportEvent: vi.fn() },
    reportRemoteUsageEvent: vi.fn(),
    armsCustomContext: {
      deviceMid: "test-mid",
      platform: process.platform,
      appVersion: "0.0.0",
      armsEnv: "daily" as const,
    },
    createRemoteWorkspaceSession: vi.fn(),
    getRemoteConnectionStats: vi.fn(() => ({})),
    disposeRemoteWorkspaceSession: vi.fn(),
    cancelPendingRemoteWorkspaceSessionsForWindow: vi.fn(),
    bindRemoteWorkspaceSessionContext: vi.fn(),
    confirmRendererAttachmentReady: vi.fn(),
    isDockerDaemonAvailable: vi.fn(async () => true),
    listAvailableWSLDistros: vi.fn(async () => []),
    listAvailableDockerContainers: vi.fn(async () => []),
    listSSHConfigAliases: vi.fn(async () => []),
  };
}

const REMOTE_FAMILY_CHANNELS = [
  PlatformChannels.ConnectRemote,
  PlatformChannels.CancelPendingRemoteConnection,
  PlatformChannels.BindRemoteWorkspaceSessionContext,
  PlatformChannels.DisposeRemoteSession,
  PlatformChannels.IsDockerAvailable,
  PlatformChannels.ListWSLDistros,
  PlatformChannels.ListDockerContainers,
  PlatformChannels.ListSSHConfigAliases,
] as const;

describe("#4 unreachable-when-off — SSH/Docker/WSL remote IPC (desktopMainIpcRemote.ts)", () => {
  it("flag OFF (default): NONE of the remote-family channels are registered", async () => {
    const mod = await importRemoteIpc();
    mod.registerRemoteIpcHandlers(remoteIpcOptions());

    for (const channel of REMOTE_FAMILY_CHANNELS) {
      expect(ipcState.handlers.has(channel)).toBe(false);
    }
  }, 30_000);

  it("flag ON (explicit opt-in): the remote-family channels are registered", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importRemoteIpc();
    mod.registerRemoteIpcHandlers(remoteIpcOptions());

    for (const channel of REMOTE_FAMILY_CHANNELS) {
      expect(ipcState.handlers.has(channel)).toBe(true);
    }
  }, 30_000);
});

async function importCuaIpc() {
  vi.resetModules();
  return await import("./desktopCuaPermissionIpc.js");
}

const CUA_FAMILY_CHANNELS = [
  PlatformChannels.PrepareCuaHelperPermissionDrag,
  PlatformChannels.StartCuaHelperPermissionDrag,
  PlatformChannels.NotifyCuaHelperPermissionDragEnded,
  PlatformChannels.CancelCuaPermissionOnboarding,
  PlatformChannels.OpenCuaPermissionOnboarding,
] as const;

describe("#4 unreachable-when-off — CUA permission IPC (desktopCuaPermissionIpc.ts)", () => {
  it("flag OFF (default): NONE of the CUA permission channels are registered", async () => {
    const mod = await importCuaIpc();
    mod.registerCuaPermissionIpcHandlers({
      logger: { info: vi.fn(), warn: vi.fn() },
      currentApplicationLocale: () => "en-US",
    });

    for (const channel of CUA_FAMILY_CHANNELS) {
      expect(ipcState.handlers.has(channel)).toBe(false);
      expect(ipcState.listeners.has(channel)).toBe(false);
    }
  }, 30_000);

  it("flag ON (explicit opt-in): the CUA permission channels are registered", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importCuaIpc();
    mod.registerCuaPermissionIpcHandlers({
      logger: { info: vi.fn(), warn: vi.fn() },
      currentApplicationLocale: () => "en-US",
    });

    expect(ipcState.handlers.has(PlatformChannels.PrepareCuaHelperPermissionDrag)).toBe(true);
    expect(ipcState.handlers.has(PlatformChannels.OpenCuaPermissionOnboarding)).toBe(true);
    expect(ipcState.listeners.has(PlatformChannels.StartCuaHelperPermissionDrag)).toBe(true);
    expect(ipcState.listeners.has(PlatformChannels.NotifyCuaHelperPermissionDragEnded)).toBe(true);
    expect(ipcState.listeners.has(PlatformChannels.CancelCuaPermissionOnboarding)).toBe(true);
  }, 30_000);
});

async function importDesktopCommandHandlers() {
  vi.resetModules();
  return await import("./desktopCommandHandlers.js");
}

function commandOptions() {
  return {
    fetchHelpConfig: undefined,
    senderWindow: null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    updateZCodeStdioTapDevMenuState: vi.fn(),
    onZCodeEndpointChanged: vi.fn(),
    onRelaunchApp: vi.fn(),
    settingService: { get: vi.fn(async () => ({})), update: vi.fn(async () => {}) },
    credentialsDir: "/tmp/wf-product-surface-test/credentials",
    currentApplicationLocale: "en-US" as const,
  };
}

describe("#4 unreachable-when-off — gated desktop commands (desktopCommandHandlers.ts)", () => {
  it("flag OFF: the Coding Plan webview storage command refuses before the surface executes", async () => {
    const mod = await importDesktopCommandHandlers();
    const options = commandOptions();

    const result = await mod.executeDesktopCommand({
      ...options,
      command: DesktopCommandIds.ClearCodingPlanWebviewStorage,
    });

    expect(result).toBeUndefined();
    // The gated surface body never ran: the coding-plan partition was never
    // even addressed.
    expect(ipcState.fromPartition.has("persist:zcode-coding-plan")).toBe(false);
    expect(options.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("webflixProductSurface flag is OFF"),
    );
  }, 30_000);

  it("flag OFF: the CUA OS support command refuses (renderer gets no support info)", async () => {
    const mod = await importDesktopCommandHandlers();
    const options = commandOptions();

    const result = await mod.executeDesktopCommand({
      ...options,
      command: DesktopCommandIds.GetCuaOsSupport,
    });

    expect(result).toBeUndefined();
    expect(options.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("webflixProductSurface flag is OFF"),
    );
  }, 30_000);

  it("flag ON: the Coding Plan webview storage command executes the surface", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importDesktopCommandHandlers();

    await mod.executeDesktopCommand({
      ...commandOptions(),
      command: DesktopCommandIds.ClearCodingPlanWebviewStorage,
    });

    const codingPlanSession = ipcState.fromPartition.get("persist:zcode-coding-plan");
    expect(codingPlanSession?.clearStorageData).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("flag ON: the CUA OS support command answers (the support read runs)", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importDesktopCommandHandlers();

    const result = await mod.executeDesktopCommand({
      ...commandOptions(),
      command: DesktopCommandIds.GetCuaOsSupport,
    });

    expect(result).toEqual({ kind: "not-applicable" });
  }, 30_000);
});

async function importDeepLinkModule() {
  vi.resetModules();
  return await import("./desktopOAuthDeepLink.js");
}

function fakeTargetWindow() {
  const sends: unknown[][] = [];
  return {
    sends,
    window: {
      isMinimized: () => false,
      restore: vi.fn(),
      isVisible: () => true,
      show: vi.fn(),
      focus: vi.fn(),
      webContents: {
        id: 7,
        send: (...args: unknown[]) => {
          sends.push(args);
        },
      },
    },
  };
}

describe("#4 unreachable-when-off — payment-callback deep links (desktopOAuthDeepLink.ts)", () => {
  it("flag OFF: the payment callback is consumed UNROUTED (never sent to any renderer)", async () => {
    const mod = await importDeepLinkModule();
    const target = fakeTargetWindow();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const handled = mod.handleDeepLink("zcode://payment/callback", logger, {
      resolveApplicationWindow: () => target.window,
    });

    expect(handled).toBe(true);
    expect(target.sends).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("webflixProductSurface"),
      expect.anything(),
    );
  }, 30_000);

  it("flag ON: the payment callback routes to the target window's renderer", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importDeepLinkModule();
    const target = fakeTargetWindow();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const handled = mod.handleDeepLink("zcode://payment/callback", logger, {
      resolveApplicationWindow: () => target.window,
    });

    expect(handled).toBe(true);
    expect(target.sends).toHaveLength(1);
    expect(target.sends[0]?.[0]).toBe(PlatformChannels.PaymentCallback);
    expect(target.sends[0]?.[1]).toBe("zcode://payment/callback");
  }, 30_000);
});

async function importDesktopRuntimeEnv() {
  vi.resetModules();
  return await import("./desktopRuntimeEnv.js");
}

describe("#4 unreachable-when-off — Lark CLI binary env (desktopRuntimeEnv.ts)", () => {
  it("flag OFF: the lark-cli binary path never reaches the host process env", async () => {
    const mod = await importDesktopRuntimeEnv();

    const env = mod.buildHostProcessEnv({
      ZCODE_LARK_CLI_BINARY: process.execPath,
    });

    expect(env.ZCODE_LARK_CLI_BINARY).toBeUndefined();
  }, 30_000);

  it("flag ON: the lark-cli binary path is passed to the host process", async () => {
    process.env[PRODUCT_SURFACE_ENV] = "1";
    const mod = await importDesktopRuntimeEnv();

    const env = mod.buildHostProcessEnv({
      ZCODE_LARK_CLI_BINARY: process.execPath,
    });

    expect(env.ZCODE_LARK_CLI_BINARY).toBe(process.execPath);
  }, 30_000);
});

async function importApplicationMenu() {
  vi.resetModules();
  return await import("./desktopApplicationMenu.js");
}

function collectMenuEntries(
  template: unknown[],
  collected: { label?: unknown; id?: unknown }[] = [],
): { label?: unknown; id?: unknown }[] {
  for (const entry of template as Record<string, unknown>[]) {
    collected.push({ label: entry.label, id: entry.id });
    if (Array.isArray(entry.submenu)) {
      collectMenuEntries(entry.submenu, collected);
    }
  }
  return collected;
}

describe("#4 menu entries absent while OFF (desktopApplicationMenu.ts)", () => {
  it("the application menu template carries NO gated-surface entries while the flag is OFF", async () => {
    const mod = await importApplicationMenu();

    mod.rebuildApplicationMenu({
      currentApplicationLocale: "en-US",
      zcodeEndpointSelection: "production",
      executeDesktopCommand: vi.fn(async () => undefined),
    });

    expect(ipcState.menuTemplates).toHaveLength(1);
    const entries = collectMenuEntries(ipcState.menuTemplates[0] as unknown[]);
    // The menu really was built (the standard top-level menus exist).
    expect(entries.length).toBeGreaterThan(10);
    // No gated ZCode commercial surface has a menu entry while OFF — a
    // future Coding Plan / CUA / Lark / SSH-Docker-WSL remote entry must go
    // through the product-surface gate, never a bare template addition.
    const gatedSurfacePattern = /coding.?plan|paypal|cua|lark|remote|docker|wsl|ssh/i;
    for (const entry of entries) {
      expect(`${String(entry.label ?? "")} ${String(entry.id ?? "")}`).not.toMatch(
        gatedSurfacePattern,
      );
    }
  }, 30_000);
});
