import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * P9-UI-1 (order requirement 5 + requirement 6 pins) — the account-boundary
 * battery for the WebFlix Accounts IPC surface
 * (packages/desktop/src/main/webflixAccountIpc.ts) and its preload mirror
 * (packages/desktop/src/preload/webflixAccountBridge.ts).
 *
 * Pinned here (all binding):
 *   - The channel strings on the main side and the preload side AGREE (a
 *     typo on either side fails this battery, never a silent mismatch).
 *   - Registration is flavor-gated: only the baked webflix flavor registers
 *     the channels; a zcode flavor registers NOTHING.
 *   - Fail-closed: when OS secure storage is unavailable the status surface
 *     answers with the typed refusal and NO vault store is even constructed;
 *     malformed renderer input is refused typed, never guessed.
 *   - Honest connect: the known provider's connect outcome says exactly why
 *     nothing was authorized (no operator OAuth client in this build).
 *   - The disconnect outcome is the REAL ruling-6 two-leg composition result
 *     (vault removes + scoped partition clear), verbatim.
 *   - No payload on this surface can carry a token: the status success shape
 *     is vault availability + renderer-safe records only.
 *
 * Electron is mocked (the providerDisconnectClear.test.ts pattern: per-
 * partition fake sessions from a hoisted registry, an ipcMain.handle
 * recorder, and a real-transform safeStorage mock that can be switched
 * unavailable per test); webflixAccountIpc.ts, webflixAccountBridge.ts and
 * providerDisconnectClear.ts are the REAL source.
 */

const hoisted = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: readonly unknown[]) => unknown>();
  const exposedWorlds = new Map<string, unknown>();
  const partitionSessions = new Map<
    string,
    { clearCache: ReturnType<typeof vi.fn>; clearStorageData: ReturnType<typeof vi.fn> }
  >();
  const state = { encryptionAvailable: true };
  return { ipcHandlers, exposedWorlds, partitionSessions, state };
});

function ensurePartition(partition: string) {
  let session = hoisted.partitionSessions.get(partition);
  if (!session) {
    session = {
      clearCache: vi.fn(async () => {}),
      clearStorageData: vi.fn(async (_options?: unknown) => {}),
    };
    hoisted.partitionSessions.set(partition, session);
  }
  return session;
}

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: readonly unknown[]) => unknown) => {
      hoisted.ipcHandlers.set(channel, handler);
    },
  },
  contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => {
      hoisted.exposedWorlds.set(apiKey, api);
    },
  },
  ipcRenderer: {
    invoke: async () => ({}),
  },
  safeStorage: {
    isEncryptionAvailable: () => hoisted.state.encryptionAvailable,
    encryptString: (plainText: string) =>
      Buffer.from(`mock-safe:${Buffer.from(plainText, "utf8").toString("base64")}`),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("mock-safe:")) {
        throw new Error("mock keychain could not decrypt the buffer");
      }
      return Buffer.from(text.slice("mock-safe:".length), "base64").toString("utf8");
    },
  },
  session: {
    fromPartition: (partition: string) => ensurePartition(partition),
  },
  // chromeLocalStorageManager (browserDataManager's import chain) imports
  // BrowserWindow at module scope; the disconnect path never touches it.
  BrowserWindow: class {},
}));

import {
  WEBFLIX_ACCOUNTS_CONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL,
  connectUnavailableReason,
  registerWebFlixAccountIpc,
} from "./webflixAccountIpc.js";
import {
  WEBFLIX_ACCOUNTS_CONNECT_CHANNEL as PRELOAD_CONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL as PRELOAD_DISCONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL as PRELOAD_GET_STATUS_CHANNEL,
  registerWebFlixAccountPreloadBridge,
} from "../preload/webflixAccountBridge.js";
import { disconnectProviderAccount } from "./providerDisconnectClear.js";
import type { ProviderAccountRecord } from "webflix-contracts";

const logger = { info: vi.fn(), warn: vi.fn() };

function makeRecord(): ProviderAccountRecord {
  return {
    providerId: "youtube",
    internalAccountId: "local-user-1",
    displayName: "Local Test User",
    grantedScopes: ["youtube.readonly"],
    status: "connected",
    connectedAt: "2026-10-14T00:00:00.000Z",
  };
}

/** A vault store double — keyed lookups only, no enumeration surface. */
function makeStoreDouble(records: ReadonlyMap<string, ProviderAccountRecord>) {
  const removed = new Set<string>();
  return {
    removed,
    store: {
      loadAccount: async (internalAccountId: string) => records.get(internalAccountId) ?? null,
      removeAccount: async (internalAccountId: string) => {
        removed.add(internalAccountId);
      },
      removeTokens: async (internalAccountId: string) => {
        removed.add(internalAccountId);
      },
    },
  };
}

beforeEach(() => {
  hoisted.ipcHandlers.clear();
  hoisted.exposedWorlds.clear();
  hoisted.partitionSessions.clear();
  hoisted.state.encryptionAvailable = true;
  logger.info.mockClear();
  logger.warn.mockClear();
});

describe("channel mirrors — main and preload agree (requirement 5)", () => {
  it("the three channel strings are identical on both sides of the boundary", () => {
    expect(PRELOAD_GET_STATUS_CHANNEL).toBe(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL);
    expect(PRELOAD_CONNECT_CHANNEL).toBe(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL);
    expect(PRELOAD_DISCONNECT_CHANNEL).toBe(WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL);
  });

  it("the channels are the namespaced webflix:accounts:* strings", () => {
    expect(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL).toBe("webflix:accounts:get-status");
    expect(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL).toBe("webflix:accounts:connect");
    expect(WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL).toBe("webflix:accounts:disconnect");
  });
});

describe("registration is flavor-gated (zero ZCode-build surface)", () => {
  it("a zcode flavor registers NO ipc handlers", () => {
    registerWebFlixAccountIpc({ logger, flavor: "zcode" });
    expect(hoisted.ipcHandlers.size).toBe(0);
  });

  it("a preview flavor registers NO ipc handlers", () => {
    registerWebFlixAccountIpc({ logger, flavor: "preview" });
    expect(hoisted.ipcHandlers.size).toBe(0);
  });

  it("the webflix flavor registers exactly the three typed channels", () => {
    registerWebFlixAccountIpc({ logger });
    expect([...hoisted.ipcHandlers.keys()].sort()).toEqual(
      [
        WEBFLIX_ACCOUNTS_CONNECT_CHANNEL,
        WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL,
        WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL,
      ].sort(),
    );
  });
});

describe("get-status — fail-closed and typed (requirement 5)", () => {
  it("answers the typed refusal when OS secure storage is unavailable, and never constructs a vault", async () => {
    hoisted.state.encryptionAvailable = false;
    const createVaultStore = vi.fn();
    registerWebFlixAccountIpc({ logger, createVaultStore });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;

    const status = (await handler(undefined, [
      { providerId: "youtube", internalAccountId: "local-user-1" },
    ])) as { vault: { available: boolean; reason: string }; accounts: unknown[] };

    expect(status.vault.available).toBe(false);
    expect(status.vault.reason).toContain("os_vault_unavailable");
    expect(status.vault.reason).toContain("never falls back to plaintext");
    expect(status.accounts).toEqual([]);
    expect(createVaultStore).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("refuses a malformed pointer list typed (not an array, unknown provider, over-limit)", async () => {
    const createVaultStore = vi.fn();
    registerWebFlixAccountIpc({ logger, createVaultStore });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;

    for (const malformed of [
      "not-an-array",
      null,
      [{ providerId: "not-a-known-provider", internalAccountId: "x" }],
      [{ providerId: "youtube" }],
      [{ internalAccountId: "x" }],
      Array.from({ length: 33 }, () => ({
        providerId: "youtube",
        internalAccountId: "x",
      })),
    ]) {
      const status = (await handler(undefined, malformed)) as {
        vault: { available: boolean; reason: string };
      };
      expect(status.vault.available).toBe(false);
      expect(status.vault.reason).toContain("malformed status request refused");
    }
    expect(createVaultStore).not.toHaveBeenCalled();
  });

  it("returns ONLY the records for asked-about pointers (keyed lookups, no enumeration)", async () => {
    const records = new Map([["local-user-1", makeRecord()]]);
    const double = makeStoreDouble(records);
    registerWebFlixAccountIpc({ logger, createVaultStore: () => double.store as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;

    const status = (await handler(undefined, [
      { providerId: "youtube", internalAccountId: "local-user-1" },
      { providerId: "youtube", internalAccountId: "absent-account" },
    ])) as { vault: { available: boolean }; accounts: ProviderAccountRecord[] };

    expect(status.vault).toEqual({ available: true, reason: null });
    expect(status.accounts).toEqual([records.get("local-user-1")]);
  });

  it("maps a vault read error to the typed refusal (fail-closed, no partial data)", async () => {
    const failingStore = {
      loadAccount: async () => {
        throw new Error("boom");
      },
    };
    registerWebFlixAccountIpc({ logger, createVaultStore: () => failingStore as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;

    const status = (await handler(undefined, [
      { providerId: "youtube", internalAccountId: "local-user-1" },
    ])) as { vault: { available: boolean; reason: string }; accounts: unknown[] };

    expect(status.vault.available).toBe(false);
    expect(status.vault.reason).toContain("webflix-account-ipc");
    expect(status.accounts).toEqual([]);
  });

  it("the success payload carries no token-bearing field (vault status + records only)", async () => {
    const double = makeStoreDouble(new Map([["local-user-1", makeRecord()]]));
    registerWebFlixAccountIpc({ logger, createVaultStore: () => double.store as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;

    const status = (await handler(undefined, [
      { providerId: "youtube", internalAccountId: "local-user-1" },
    ])) as Record<string, unknown>;

    expect(Object.keys(status).sort()).toEqual(["accounts", "vault"]);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(/token|secret|password|credential/i);
  });
});

describe("connect — honestly unavailable in this build (freeze AS-Q3)", () => {
  it("an unknown provider is refused typed (invalid-provider)", async () => {
    registerWebFlixAccountIpc({ logger });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, "not-a-provider")) as {
      ok: boolean;
      code: string;
      reason: string;
    };
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("invalid-provider");
    expect(outcome.reason).toContain("nothing was authorized");
  });

  it("the known youtube provider says exactly why no flow can start", async () => {
    registerWebFlixAccountIpc({ logger });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, "youtube")) as {
      ok: boolean;
      code: string;
      reason: string;
    };
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("connect-unavailable");
    expect(outcome.reason).toBe(connectUnavailableReason("youtube"));
    expect(outcome.reason).toContain("no operator-provisioned OAuth client");
    expect(outcome.reason).toContain("nothing was authorized");
  });
});

describe("disconnect — the real ruling-6 two-leg composition (requirement 5)", () => {
  it("refuses an unscoped disconnect without touching the vault or ANY partition", async () => {
    const double = makeStoreDouble(new Map());
    registerWebFlixAccountIpc({ logger, createVaultStore: () => double.store as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, { providerId: "youtube" })) as {
      ok: boolean;
      errors: string[];
    };
    expect(outcome.ok).toBe(false);
    expect(outcome.errors).toEqual(["invalid_disconnect_scope"]);
    expect(double.removed.size).toBe(0);
    expect(hoisted.partitionSessions.size).toBe(0);
  });

  it("returns the real composition result verbatim (vault removes + scoped partition clear)", async () => {
    const double = makeStoreDouble(new Map());
    registerWebFlixAccountIpc({ logger, createVaultStore: () => double.store as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, {
      providerId: "youtube",
      internalAccountId: "local-user-1",
    })) as { ok: boolean; vaultRemoved: boolean; partitionCleared: boolean; errors: string[] };

    // The exact partition providerDisconnectClear derives for this pair
    // (FNV-1a over the account key — the providerDisconnectClear battery's
    // own pinned derivation).
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(outcome).toEqual({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] });
    expect(cleared.clearCache).toHaveBeenCalledTimes(1);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(1);
    expect([...hoisted.partitionSessions.keys()]).toEqual([
      "persist:webflix-embedded-youtube-9c5d0986",
    ]);

    // The direct composition over the same double agrees (the IPC outcome is
    // the composition's result VERBATIM, not a reinterpretation).
    const direct = await disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-2",
      accountStore: double.store,
    });
    expect(direct.success).toBe(true);
    expect(double.removed.has("local-user-2")).toBe(true);
  });

  it("a vault-leg failure is typed and the partition leg is still attempted (order-independence)", async () => {
    const failingVault = {
      loadAccount: async () => null,
      removeAccount: async () => {
        throw new Error("vault remove failed");
      },
      removeTokens: async () => {},
    };
    registerWebFlixAccountIpc({ logger, createVaultStore: () => failingVault as never });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, {
      providerId: "youtube",
      internalAccountId: "local-user-1",
    })) as { ok: boolean; vaultRemoved: boolean; partitionCleared: boolean; errors: string[] };

    expect(outcome.ok).toBe(false);
    expect(outcome.vaultRemoved).toBe(false);
    expect(outcome.errors[0]).toBe("disconnect_vault_remove_error");
    // The partition leg still ran (both legs are always attempted).
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(1);
  });
});

describe("preload bridge — the narrow renderer surface (requirement 5)", () => {
  it("exposes exactly window.webflixAccounts with the three typed methods in the webflix flavor", () => {
    const invoke = vi.fn(async () => ({}));
    const exposeInMainWorld = vi.fn((key: string, api: unknown) => {
      hoisted.exposedWorlds.set(key, api);
    });
    registerWebFlixAccountPreloadBridge(
      { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } },
      "webflix",
    );

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld).toHaveBeenCalledWith("webflixAccounts", expect.any(Object));
    const bridge = hoisted.exposedWorlds.get("webflixAccounts") as Record<string, unknown>;
    expect(Object.keys(bridge).sort()).toEqual(["connect", "disconnect", "getStatus"]);

    void (bridge.getStatus as (p: unknown) => Promise<unknown>)([]);
    void (bridge.connect as (p: unknown) => Promise<unknown>)("youtube");
    void (bridge.disconnect as (p: unknown) => Promise<unknown>)({
      providerId: "youtube",
      internalAccountId: "local-user-1",
    });
    expect(invoke).toHaveBeenNthCalledWith(1, WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL, []);
    expect(invoke).toHaveBeenNthCalledWith(2, WEBFLIX_ACCOUNTS_CONNECT_CHANNEL, "youtube");
    expect(invoke).toHaveBeenNthCalledWith(3, WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL, {
      providerId: "youtube",
      internalAccountId: "local-user-1",
    });
  });

  it("a zcode flavor exposes NOTHING (no preload surface in ZCode builds)", () => {
    const exposeInMainWorld = vi.fn();
    registerWebFlixAccountPreloadBridge(
      { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke: vi.fn() } },
      "zcode",
    );
    expect(exposeInMainWorld).not.toHaveBeenCalled();
  });
});
