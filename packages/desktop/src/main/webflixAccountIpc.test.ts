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
  shell: {
    openExternal: async (_url: string) => {},
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
  WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID,
  connectUnavailableReason,
  registerWebFlixAccountIpc,
} from "./webflixAccountIpc.js";
import {
  WEBFLIX_ACCOUNTS_CONNECT_CHANNEL as PRELOAD_CONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL as PRELOAD_DISCONNECT_CHANNEL,
  WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL as PRELOAD_GET_STATUS_CHANNEL,
  WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID as PRELOAD_PRIMARY_ACCOUNT_ID,
  registerWebFlixAccountPreloadBridge,
} from "../preload/webflixAccountBridge.js";
import { YouTubeConnectFlowManager } from "./webflix/oauthConnectFlow.js";
import { disconnectProviderAccount } from "./providerDisconnectClear.js";
import type { OAuthAccountStore, StoredOAuthTokens } from "connectors";
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

  it("the canonical primary account id is identical on both sides (WFX-OAUTH-CONNECT-1)", () => {
    expect(PRELOAD_PRIMARY_ACCOUNT_ID).toBe(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID);
    expect(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID).toBe("primary");
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

describe("connect — honest typed outcomes (AS-Q3 provisioning closed by WFX-OAUTH-CONNECT-1)", () => {
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

  it("an environment with NO provisioned client says exactly why no flow can start", async () => {
    registerWebFlixAccountIpc({ logger, resolveClient: () => null });
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
    expect(logger.info).toHaveBeenCalled();
  });

  it("safeStorage unavailable refuses connect BEFORE any flow starts (fail-closed)", async () => {
    hoisted.state.encryptionAvailable = false;
    const openBrowser = vi.fn(async () => {});
    registerWebFlixAccountIpc({
      logger,
      resolveClient: () => ({ clientId: "test-client-id", clientSecret: "test-client-secret", source: "env" }),
      openBrowser,
    });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL)!;

    const outcome = (await handler(undefined, "youtube")) as { ok: boolean; code: string; reason: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("vault-unavailable");
    expect(outcome.reason).toContain("os_vault_unavailable");
    expect(outcome.reason.toLowerCase()).toContain("nothing was authorized");
    expect(openBrowser).not.toHaveBeenCalled();
  });
});

/** A full OAuthAccountStore double (records + tokens, keyed by account id). */
function makeFullStoreDouble() {
  const records = new Map<string, ProviderAccountRecord>();
  const tokens = new Map<string, StoredOAuthTokens>();
  const store: OAuthAccountStore = {
    loadAccount: async (id) => records.get(id) ?? null,
    saveAccount: async (record) => {
      records.set(record.internalAccountId, record);
    },
    removeAccount: async (id) => {
      records.delete(id);
    },
    loadTokens: async (id) => tokens.get(id) ?? null,
    saveTokens: async (id, value) => {
      tokens.set(id, value);
    },
    removeTokens: async (id) => {
      tokens.delete(id);
    },
  };
  return { records, tokens, store };
}

describe("connect — the REAL loopback+PKCE flow through the frozen session (WFX-OAUTH-CONNECT-1)", () => {
  const TEST_CLIENT = { clientId: "test-client-id", clientSecret: "test-client-secret", source: "env" as const };

  function buildFlow(options?: {
    env?: NodeJS.ProcessEnv;
    openBrowser?: (url: string) => Promise<void>;
    flowTimeoutMs?: number;
  }): {
    manager: YouTubeConnectFlowManager;
    connect: (payload?: unknown) => Promise<{ ok: boolean; code: string; reason: string }>;
    storeDouble: ReturnType<typeof makeFullStoreDouble>;
    tokenFetcher: ReturnType<typeof vi.fn>;
  } {
    const manager = new YouTubeConnectFlowManager(
      options?.flowTimeoutMs !== undefined ? { flowTimeoutMs: options.flowTimeoutMs } : {},
    );
    const storeDouble = makeFullStoreDouble();
    const tokenFetcher = vi.fn(async () => ({
      kind: "token" as const,
      token: {
        access_token: "test-access-token",
        expires_in: 3600,
        refresh_token: "test-refresh-token",
        scope: "https://www.googleapis.com/auth/youtube.readonly",
        token_type: "Bearer",
      },
    }));
    registerWebFlixAccountIpc({
      logger,
      resolveClient: () => TEST_CLIENT,
      createVaultStore: () => storeDouble.store as never,
      createTokenFetcher: () => tokenFetcher as never,
      openBrowser: options?.openBrowser ?? (vi.fn(async () => {}) as (url: string) => Promise<void>),
      env: options?.env ?? {},
      connectManager: manager,
    });
    const handler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_CONNECT_CHANNEL)!;
    return {
      manager,
      connect: (payload: unknown = "youtube") => handler(undefined, payload) as Promise<{ ok: boolean; code: string; reason: string }>,
      storeDouble,
      tokenFetcher,
    };
  }

  it("starts authorization honestly: the system browser gets the REAL consent URL (public client id, PKCE, state)", async () => {
    const capturedUrls: string[] = [];
    const openBrowser = vi.fn(async (url: string) => {
      capturedUrls.push(url);
    });
    const flow = buildFlow({ openBrowser, flowTimeoutMs: 150 });

    const outcome = await flow.connect();

    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe("authorization-started");
    expect(outcome.reason).toContain("system browser");
    expect(outcome.reason).not.toMatch(/secret|token/i);
    expect(openBrowser).toHaveBeenCalledTimes(1);

    const consentUrl = new URL(capturedUrls[0]!);
    expect(consentUrl.origin + consentUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(consentUrl.searchParams.get("client_id")).toBe(TEST_CLIENT.clientId);
    expect(consentUrl.searchParams.get("response_type")).toBe("code");
    expect(consentUrl.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube.readonly");
    expect(consentUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(consentUrl.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(consentUrl.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(consentUrl.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    // The consent URL carries ONLY public material — never the secret.
    expect(capturedUrls[0]).not.toContain(TEST_CLIENT.clientSecret);

    // Single-flight: a second connect while one waits is the typed refusal.
    const second = await flow.connect();
    expect(second.ok).toBe(false);
    expect(second.code).toBe("authorization-in-progress");
    expect(openBrowser).toHaveBeenCalledTimes(1);

    const completion = flow.manager.pendingCompletion("youtube");
    expect(completion).not.toBeNull();
    await completion; // let the background settle (no callback: timeout path is separate)
  }, 20_000);

  it("completes the REAL round trip: Google's redirect → PKCE exchange → vault record → getStatus", async () => {
    const capturedUrls: string[] = [];
    const openBrowser = vi.fn(async (url: string) => {
      capturedUrls.push(url);
    });
    const flow = buildFlow({ openBrowser });

    const outcome = await flow.connect();
    expect(outcome.code).toBe("authorization-started");
    const completion = flow.manager.pendingCompletion("youtube");
    expect(completion).not.toBeNull();

    // Simulate Google's redirect to the REAL loopback listener.
    const consentUrl = new URL(capturedUrls[0]!);
    const state = consentUrl.searchParams.get("state")!;
    const redirectUri = consentUrl.searchParams.get("redirect_uri")!;
    const callbackResponse = await fetch(`${redirectUri}?code=test-authorization-code&state=${encodeURIComponent(state)}`);
    expect(callbackResponse.status).toBe(200);
    const page = await callbackResponse.text();
    expect(page).toContain("account connected");

    const settled = await completion!;
    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.code).toBe("connected");
      expect(settled.record.internalAccountId).toBe(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID);
      expect(settled.record.providerId).toBe("youtube");
      expect(settled.record.status).toBe("connected");
    }

    // The token exchange went through the REAL session with PKCE + the exact
    // loopback redirect URI (the verifier reaches only the token endpoint).
    expect(flow.tokenFetcher).toHaveBeenCalledTimes(1);
    const exchange = flow.tokenFetcher.mock.calls[0]![0] as {
      kind: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
    };
    expect(exchange.kind).toBe("token-exchange");
    expect(exchange.code).toBe("test-authorization-code");
    expect(exchange.redirectUri).toBe(redirectUri);
    expect(exchange.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The vault double holds tokens + the renderer-safe record.
    expect(flow.storeDouble.tokens.get(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID)?.accessToken).toBe("test-access-token");
    expect(flow.storeDouble.records.get(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID)?.status).toBe("connected");

    // getStatus now answers the connected record for the canonical pointer.
    const statusHandler = hoisted.ipcHandlers.get(WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL)!;
    const status = (await statusHandler(undefined, [
      { providerId: "youtube", internalAccountId: WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID },
    ])) as { vault: { available: boolean }; accounts: ProviderAccountRecord[] };
    expect(status.vault.available).toBe(true);
    expect(status.accounts).toHaveLength(1);
    expect(status.accounts[0]!.internalAccountId).toBe(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID);
  }, 20_000);

  it("a mismatched state (CSRF) aborts typed and persists NOTHING", async () => {
    const capturedUrls: string[] = [];
    const openBrowser = vi.fn(async (url: string) => {
      capturedUrls.push(url);
    });
    const flow = buildFlow({ openBrowser });

    await flow.connect();
    const completion = flow.manager.pendingCompletion("youtube");
    const consentUrl = new URL(capturedUrls[0]!);
    const redirectUri = consentUrl.searchParams.get("redirect_uri")!;

    const response = await fetch(`${redirectUri}?code=test-code&state=attacker-state`);
    expect(response.status).toBe(400);

    const settled = await completion!;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect(settled.code).toBe("state-mismatch");
      expect(settled.reason).toContain("CSRF");
    }
    expect(flow.storeDouble.records.size).toBe(0);
    expect(flow.storeDouble.tokens.size).toBe(0);
    expect(flow.tokenFetcher).not.toHaveBeenCalled();
  }, 20_000);

  it("Google's access_denied redirect is the typed refusal (nothing authorized)", async () => {
    const capturedUrls: string[] = [];
    const openBrowser = vi.fn(async (url: string) => {
      capturedUrls.push(url);
    });
    const flow = buildFlow({ openBrowser });

    await flow.connect();
    const completion = flow.manager.pendingCompletion("youtube");
    const consentUrl = new URL(capturedUrls[0]!);
    const redirectUri = consentUrl.searchParams.get("redirect_uri")!;

    const response = await fetch(`${redirectUri}?error=access_denied`);
    expect(response.status).toBe(400);

    const settled = await completion!;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect(settled.code).toBe("access-denied");
    }
    expect(flow.storeDouble.records.size).toBe(0);
  }, 20_000);

  it("a failed browser launch is the typed flow-error (nothing authorized)", async () => {
    const flow = buildFlow({
      openBrowser: async () => {
        throw new Error("no default browser");
      },
    });

    const outcome = await flow.connect();
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe("flow-error");
    expect(outcome.reason).toContain("system browser");
    expect(outcome.reason).toContain("nothing was authorized");
    expect(flow.storeDouble.records.size).toBe(0);
  });

  it("manual mode (WEBFLIX_YOUTUBE_OAUTH_OPEN=manual) skips the browser and logs the consent URL", async () => {
    const openBrowser = vi.fn(async () => {});
    const flow = buildFlow({ openBrowser, env: { WEBFLIX_YOUTUBE_OAUTH_OPEN: "manual" }, flowTimeoutMs: 150 });

    const outcome = await flow.connect();
    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe("authorization-started");
    expect(outcome.reason).toContain("manual");
    expect(openBrowser).not.toHaveBeenCalled();
    const loggedUrl = logger.info.mock.calls
      .map((call) => JSON.stringify(call))
      .find((serialized) => serialized.includes("accounts.google.com"));
    expect(loggedUrl).toBeDefined();
    await flow.manager.pendingCompletion("youtube");
  }, 20_000);

  it("the bounded flow times out typed when no consent arrives", async () => {
    const flow = buildFlow({ flowTimeoutMs: 60 });
    const outcome = await flow.connect();
    expect(outcome.code).toBe("authorization-started");
    const completion = flow.manager.pendingCompletion("youtube");
    expect(completion).not.toBeNull();

    const settled = await completion!;
    expect(settled.ok).toBe(false);
    if (!settled.ok) {
      expect(settled.code).toBe("flow-timeout");
      expect(settled.reason).toContain("nothing was authorized");
    }
    expect(flow.storeDouble.records.size).toBe(0);
    // The expired flow is cleaned up: a fresh connect may start.
    const second = await flow.connect();
    expect(second.code).toBe("authorization-started");
    await flow.manager.pendingCompletion("youtube");
  }, 20_000);

  it("no outcome, log call, or stored payload ever carries the client secret", async () => {
    const flow = buildFlow({ flowTimeoutMs: 80 });
    const outcome = await flow.connect();
    const completion = flow.manager.pendingCompletion("youtube");
    const settled = await completion!;

    const serializedSurfaces = JSON.stringify({
      outcome,
      settled,
      logs: logger.info.mock.calls.concat(logger.warn.mock.calls),
    });
    expect(serializedSurfaces).not.toContain(TEST_CLIENT.clientSecret);
    expect(serializedSurfaces).not.toContain("test-access-token");
    expect(serializedSurfaces).not.toContain("test-refresh-token");
  }, 20_000);
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
