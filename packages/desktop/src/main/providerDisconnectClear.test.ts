import { beforeEach, describe, expect, it, vi } from "vitest";

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
