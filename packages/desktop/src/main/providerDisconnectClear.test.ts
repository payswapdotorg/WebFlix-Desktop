import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * P8-ISOLATION-WIRING-1 — #3 (isolation audit §2.3 / §4.2 #3): a disconnect
 * at the desktop adapter seam propagates to the per-provider embedded
 * partition via clearEmbeddedBrowserData({providerId, accountKey}) — the
 * disconnected account's partition is cleared, OTHER providers' partitions
 * and the shared partition survive. The adapter is the ordered minimal seam
 * (no application-layer account path exists yet — audit §1.5; the blocker
 * is named in providerDisconnectClear.ts and the delivery notes).
 *
 * Electron is mocked (session.fromPartition hands out per-partition fake
 * sessions, lazily created and recorded in the hoisted registry);
 * browserDataManager.ts and the adapter are the REAL source.
 */

interface FakePartitionSession {
  clearCache: ReturnType<typeof vi.fn>;
  clearStorageData: ReturnType<typeof vi.fn>;
  cookies: { set: ReturnType<typeof vi.fn>; flushStore: ReturnType<typeof vi.fn> };
}

const partitionSessions = vi.hoisted(
  () =>
    new Map<
      string,
      { clearCache: ReturnType<typeof vi.fn>; clearStorageData: ReturnType<typeof vi.fn> }
    >(),
);

function createPartitionSession(): FakePartitionSession {
  return {
    clearCache: vi.fn(async () => {}),
    clearStorageData: vi.fn(async (_options?: unknown) => {}),
    cookies: { set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) },
  };
}

/** Materializes a partition's fake session (the electron mock does this lazily). */
function ensurePartition(partition: string): FakePartitionSession {
  let session = partitionSessions.get(partition) as FakePartitionSession | undefined;
  if (!session) {
    session = createPartitionSession();
    partitionSessions.set(partition, session);
  }
  return session;
}

vi.mock("electron", () => ({
  session: {
    fromPartition: (partition: string) => {
      let session = partitionSessions.get(partition);
      if (!session) {
        session = {
          clearCache: vi.fn(async () => {}),
          clearStorageData: vi.fn(async (_options?: unknown) => {}),
          cookies: { set: vi.fn(async () => {}), flushStore: vi.fn(async () => {}) },
        };
        partitionSessions.set(partition, session);
      }
      return session;
    },
  },
  // chromeLocalStorageManager (browserDataManager's import chain) imports
  // BrowserWindow at module scope; the disconnect-clear path never touches it.
  BrowserWindow: class {},
  // P8-VAULT-1: the OS vault (webflix/osVaultAccountStore.ts) defaults its key
  // management to Electron safeStorage — the real-transform mock from the
  // vault battery (anything that skipped encryption would leak plaintext).
  safeStorage: {
    isEncryptionAvailable: () => true,
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
}));

async function importAdapter() {
  vi.resetModules();
  return await import("./providerDisconnectClear.js");
}

beforeEach(() => {
  partitionSessions.clear();
});

describe("#3 disconnect → scoped partition clear (audit §2.3)", () => {
  it("clears ONLY the disconnected account's per-provider partition (mode all)", async () => {
    const { clearDisconnectedProviderAccountPartition } = await importAdapter();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const result = await clearDisconnectedProviderAccountPartition({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
    });

    expect(result).toEqual({ success: true });

    // The scoped per-provider partition was cleared with BOTH the cache and
    // the full storage sweep (mode "all" — a disconnect drops every trace).
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearCache).toHaveBeenCalledTimes(1);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(1);
    expect(cleared.clearStorageData).toHaveBeenCalledWith();
    expect(cleared.cookies.set).not.toHaveBeenCalled();

    // The partition name is exactly the browserDataManager derivation —
    // resolveEmbeddedBrowserPartition("youtube", "local-user-1") hashed the
    // same account key with the REAL derivation (FNV-1a), and it is the
    // only partition that was ever addressed.
    expect([...partitionSessions.keys()]).toEqual(["persist:webflix-embedded-youtube-9c5d0986"]);
  }, 30_000);

  it("OTHER providers' partitions and the shared partition survive the disconnect clear", async () => {
    const { clearDisconnectedProviderAccountPartition } = await importAdapter();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { resolveEmbeddedBrowserPartition } = await import("./browserDataManager.js");

    // Populate sibling partitions first (another provider, another account
    // on the same provider, and the legacy shared partition).
    const twitchPartition = ensurePartition(
      resolveEmbeddedBrowserPartition("twitch", "local-user-9"),
    );
    const siblingAccountPartition = ensurePartition(
      resolveEmbeddedBrowserPartition("youtube", "local-user-2"),
    );
    const sharedPartition = ensurePartition(resolveEmbeddedBrowserPartition());
    expect(resolveEmbeddedBrowserPartition("twitch", "local-user-9")).toBe(
      "persist:webflix-embedded-twitch-a45d161e",
    );
    expect(resolveEmbeddedBrowserPartition("youtube", "local-user-2")).toBe(
      "persist:webflix-embedded-youtube-9b5d07f3",
    );
    expect(resolveEmbeddedBrowserPartition()).toBe("persist:zcode-embedded-browser");

    const result = await clearDisconnectedProviderAccountPartition({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
    });
    expect(result).toEqual({ success: true });

    // The disconnected account's partition was cleared; every other
    // partition was never addressed.
    const disconnected = ensurePartition(
      resolveEmbeddedBrowserPartition("youtube", "local-user-1"),
    );
    expect(disconnected.clearCache).toHaveBeenCalledTimes(1);
    expect(disconnected.clearStorageData).toHaveBeenCalledTimes(1);
    expect(twitchPartition.clearCache).not.toHaveBeenCalled();
    expect(twitchPartition.clearStorageData).not.toHaveBeenCalled();
    expect(siblingAccountPartition.clearCache).not.toHaveBeenCalled();
    expect(siblingAccountPartition.clearStorageData).not.toHaveBeenCalled();
    expect(sharedPartition.clearCache).not.toHaveBeenCalled();
    expect(sharedPartition.clearStorageData).not.toHaveBeenCalled();
  }, 30_000);

  it("is idempotent per (provider, account): a repeated disconnect clear succeeds", async () => {
    const { clearDisconnectedProviderAccountPartition } = await importAdapter();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const first = await clearDisconnectedProviderAccountPartition({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
    });
    const second = await clearDisconnectedProviderAccountPartition({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
    });

    expect(first).toEqual({ success: true });
    expect(second).toEqual({ success: true });
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearCache).toHaveBeenCalledTimes(2);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("refuses an unscoped clear without touching ANY partition (never the shared one)", async () => {
    const { clearDisconnectedProviderAccountPartition, INVALID_DISCONNECT_SCOPE_ERROR } =
      await importAdapter();
    const logger = { info: vi.fn(), warn: vi.fn() };

    for (const badScope of [
      { providerId: "", accountKey: "local-user-1" },
      { providerId: "youtube", accountKey: "" },
      { providerId: "", accountKey: "" },
    ]) {
      const result = await clearDisconnectedProviderAccountPartition({ logger, ...badScope });
      expect(result).toEqual({ success: false, error: INVALID_DISCONNECT_SCOPE_ERROR });
    }

    // No session was ever created — the provider-less fallback (the SHARED
    // partition) must not be reachable through a disconnect at all.
    expect(partitionSessions.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(3);
  }, 30_000);
});

/*
 * P8-VAULT-1 ruling 6 — the disconnect composition: vault remove + the
 * P8-ISOLATION scoped partition clear in ONE idempotent, order-independent
 * call (phase8-successor-payload.md; audit §1.5/§2.3). The REAL OS vault
 * (webflix/osVaultAccountStore.ts with the mocked-safeStorage electron
 * default) is composed with the REAL adapter — fixture-tested only, per the
 * work order (no live keychain claims).
 */
describe("P8-VAULT-1 ruling 6 — the disconnect composition (vault remove + scoped partition clear)", () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "wfx-disconnect-compose-"));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  /** Resets the module registry ONCE and imports the adapter + the real vault together. */
  async function importComposition() {
    vi.resetModules();
    const [composition, vault] = await Promise.all([
      import("./providerDisconnectClear.js"),
      import("./webflix/osVaultAccountStore.js"),
    ]);
    return { composition, vault };
  }

  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn() };
  }

  function vaultRecord(internalAccountId: string, providerId = "youtube") {
    return {
      providerId,
      internalAccountId,
      displayName: "Composition Test Channel",
      grantedScopes: ["youtube.readonly"],
      status: "connected" as const,
      connectedAt: "2026-10-14T00:00:00.000Z",
    };
  }

  function vaultTokens() {
    return {
      accessToken: "ya29.composition-SECRET-access-token",
      refreshToken: "1//0gcomposition-SECRET-refresh-token",
      expiresAtMs: 1_767_225_600_000,
      scope: "youtube.readonly",
      tokenType: "Bearer",
    };
  }

  it("one disconnect call removes the account's vault entries AND clears its scoped partition (real vault + real adapter)", async () => {
    const { composition, vault } = await importComposition();
    const logger = makeLogger();
    const store = vault.createOsVaultAccountStore("youtube", { dataRoot, logger });
    // The account to disconnect + a sibling account on the SAME provider.
    await store.saveAccount(vaultRecord("local-user-1"));
    await store.saveTokens("local-user-1", vaultTokens());
    await store.saveAccount(vaultRecord("local-user-2"));
    await store.saveTokens("local-user-2", vaultTokens());

    const result = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: store,
    });

    expect(result).toEqual({
      success: true,
      vaultRemoved: true,
      partitionCleared: true,
      errors: [],
    });
    // Vault: the disconnected account is GONE (keyed lookups → null)…
    expect(await store.loadAccount("local-user-1")).toBeNull();
    expect(await store.loadTokens("local-user-1")).toBeNull();
    // …while the sibling account on the same provider survives INTACT.
    expect(await store.loadAccount("local-user-2")).toEqual(vaultRecord("local-user-2"));
    expect(await store.loadTokens("local-user-2")).toEqual(vaultTokens());
    // Partition: exactly the disconnected account's scoped partition was cleared.
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearCache).toHaveBeenCalledTimes(1);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(1);
    expect([...partitionSessions.keys()]).toEqual(["persist:webflix-embedded-youtube-9c5d0986"]);
  }, 30_000);

  it("is idempotent: a repeated disconnect call converges to the same success result", async () => {
    const { composition, vault } = await importComposition();
    const logger = makeLogger();
    const store = vault.createOsVaultAccountStore("youtube", { dataRoot, logger });
    await store.saveAccount(vaultRecord("local-user-1"));
    await store.saveTokens("local-user-1", vaultTokens());

    const expected = { success: true, vaultRemoved: true, partitionCleared: true, errors: [] };
    const first = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: store,
    });
    const second = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: store,
    });
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    // The end state is stable: still gone, and each call re-cleared the
    // (already empty) partition exactly once.
    expect(await store.loadAccount("local-user-1")).toBeNull();
    expect(await store.loadTokens("local-user-1")).toBeNull();
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearCache).toHaveBeenCalledTimes(2);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("order-independent: a partition failure never skips the vault removal, and a vault failure never skips the partition clear", async () => {
    const { composition, vault } = await importComposition();
    const logger = makeLogger();
    const store = vault.createOsVaultAccountStore("youtube", { dataRoot, logger });
    await store.saveAccount(vaultRecord("local-user-1"));
    await store.saveTokens("local-user-1", vaultTokens());

    // Direction 1 — the partition clear FAILS (its session's clearCache
    // rejects): the vault removal must still have run to completion.
    const partition = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    partition.clearCache.mockRejectedValueOnce(new Error("partition clear failed"));
    const partitionFailed = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: store,
    });
    expect(partitionFailed).toEqual({
      success: false,
      vaultRemoved: true,
      partitionCleared: false,
      errors: ["embedded_browser_clear_failed"],
    });
    expect(await store.loadAccount("local-user-1")).toBeNull();
    expect(await store.loadTokens("local-user-1")).toBeNull();

    // Direction 2 — the vault removes FAIL (both throw): the partition clear
    // must still have run (fresh session registry, only this leg observed).
    partitionSessions.clear();
    const failingStore = {
      removeTokens: async () => {
        throw new Error("vault remove failed");
      },
      removeAccount: async () => {
        throw new Error("vault remove failed");
      },
    };
    const vaultFailed = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: failingStore,
    });
    expect(vaultFailed).toEqual({
      success: false,
      vaultRemoved: false,
      partitionCleared: true,
      errors: ["disconnect_vault_remove_error", "disconnect_vault_remove_error"],
    });
    const cleared = ensurePartition("persist:webflix-embedded-youtube-9c5d0986");
    expect(cleared.clearCache).toHaveBeenCalledTimes(1);
    expect(cleared.clearStorageData).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[provider-disconnect] vault remove failed during disconnect (idempotent retry converges)",
      expect.objectContaining({
        providerId: "youtube",
        accountKey: "local-user-1",
        entry: "tokens",
      }),
    );
  }, 30_000);

  it("refuses an unscoped disconnect (or a missing store) without touching the vault or ANY partition", async () => {
    const { composition } = await importComposition();
    const logger = makeLogger();
    const calls: string[] = [];
    const recordingStore = {
      removeTokens: async () => {
        calls.push("removeTokens");
      },
      removeAccount: async () => {
        calls.push("removeAccount");
      },
    };
    const badScopes = [
      { providerId: "", accountKey: "local-user-1" },
      { providerId: "youtube", accountKey: "" },
      { providerId: "", accountKey: "" },
    ];
    for (const badScope of badScopes) {
      const result = await composition.disconnectProviderAccount({
        logger,
        ...badScope,
        accountStore: recordingStore,
      });
      expect(result).toEqual({
        success: false,
        vaultRemoved: false,
        partitionCleared: false,
        errors: [composition.INVALID_DISCONNECT_SCOPE_ERROR],
      });
    }
    // A missing store refuses identically (scope includes the store).
    const noStore = await composition.disconnectProviderAccount({
      logger,
      providerId: "youtube",
      accountKey: "local-user-1",
      accountStore: undefined as unknown as composition.DisconnectAccountRemovalStore,
    });
    expect(noStore.errors).toEqual([composition.INVALID_DISCONNECT_SCOPE_ERROR]);

    expect(calls).toEqual([]); // the vault was NEVER touched
    expect(partitionSessions.size).toBe(0); // no partition was ever addressed
    expect(logger.warn).toHaveBeenCalledTimes(4);
  }, 30_000);
});
