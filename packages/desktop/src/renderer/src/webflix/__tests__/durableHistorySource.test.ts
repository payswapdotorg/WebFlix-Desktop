/**
 * WFX-DURABLE-LIB-1 — the durable watch-history source battery.
 *
 * Pinned here (all binding):
 *   - The session stays the fast path: with a NULL bridge every behavior is
 *     byte-equivalent to the session-only source (records, ordering, the
 *     continue 95% filter) — the honest degrade.
 *   - Write-through: recordWatch/recordProgress fire the bridge calls with
 *     the exact payload shapes (itemId/providerId/item/positionMs/durationMs)
 *     and never block or revert a play when the bridge fails (the error
 *     sink observes; the session record still lands).
 *   - The merged read: session rows win, durable rows for items NOT
 *     re-watched pass through, newest-first; malformed durable item
 *     payloads are DROPPED (the corruption guard — never a thrown list).
 *   - Pause gates WRITES on both stores (existing rows stay readable).
 *   - clearAll reports the honest per-store counts (a failed durable clear
 *     reports the session number only); countHistory merges distinct ids;
 *     resumePositionMs answers the stored position (null when none).
 */
import { describe, expect, it, vi } from "vitest";
import type { CatalogItem, VideoCardView } from "../../../../../webflix-contracts/src/index.js";
import { createDurableHistorySource } from "../durableHistorySource.js";
import type { WebFlixLocalLibraryBridge, WebFlixLibraryEntryAddInput, WebFlixLibraryEntriesAddResult, WebFlixLibraryEntriesAuthorizeResult, WebFlixLibraryEntriesListResult, WebFlixHistoryClearResult, WebFlixHistoryListResult, WebFlixHistoryWriteResult, WebFlixLocalLibraryStatus } from "../localLibraryBridge.js";

const T0 = new Date("2026-10-31T12:00:00.000Z");
const T1 = new Date("2026-10-31T12:05:00.000Z");
const at = (date: Date) => () => date;

const item = (id: string, providerId = "youtube"): CatalogItem => ({
  id,
  providerId,
  title: `Item ${id}`,
  mediaKind: "video",
  assets: [],
  metadata: {},
});

const card = (forItem: CatalogItem): VideoCardView => ({ item: forItem, title: forItem.title });

/** A recording bridge double: every method captures calls, results injectable. */
function bridgeDouble(overrides?: {
  history?: readonly { itemId: string; item: unknown; positionMs: number; durationMs?: number; watchedAt: string }[];
  clearRemoved?: number;
  failReads?: boolean;
}): WebFlixLocalLibraryBridge & {
  watchCalls: { itemId: string; providerId: string; item: unknown; positionMs?: number; durationMs?: number | null }[];
  progressCalls: { itemId: string; positionMs: number; durationMs?: number | null }[];
  clearCalls: number;
} {
  const watchCalls: { itemId: string; providerId: string; item: unknown; positionMs?: number; durationMs?: number | null }[] = [];
  const progressCalls: { itemId: string; positionMs: number; durationMs?: number | null }[] = [];
  const double = {
    watchCalls,
    progressCalls,
    clearCalls: 0,
    async getStatus(): Promise<WebFlixLocalLibraryStatus> {
      return { ok: true, engine: "node:sqlite" };
    },
    async listHistory(kind: "history" | "continue", limit?: number): Promise<WebFlixHistoryListResult> {
      if (overrides?.failReads === true) throw new Error("bridge read failed");
      const all = (overrides?.history ?? []).map((entry) => ({
        itemId: entry.itemId,
        providerId: "youtube",
        item: entry.item,
        positionMs: entry.positionMs,
        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
        watchedAt: entry.watchedAt,
      }));
      const filtered =
        kind === "continue"
          ? all.filter((entry) => entry.positionMs < (entry.durationMs ?? Number.POSITIVE_INFINITY) * 0.95)
          : all;
      return { ok: true, entries: limit === undefined ? filtered : filtered.slice(0, limit) };
    },
    async recordWatch(payload: { itemId: string; providerId: string; item: unknown; positionMs?: number; durationMs?: number | null }): Promise<WebFlixHistoryWriteResult> {
      watchCalls.push(payload);
      return { ok: true };
    },
    async recordProgress(payload: { itemId: string; positionMs: number; durationMs?: number | null }): Promise<WebFlixHistoryWriteResult> {
      progressCalls.push(payload);
      return { ok: true };
    },
    async clearHistory(): Promise<WebFlixHistoryClearResult> {
      double.clearCalls += 1;
      return { ok: true, removed: overrides?.clearRemoved ?? 0 };
    },
    async listEntries(): Promise<WebFlixLibraryEntriesListResult> {
      return { ok: true, entries: [] };
    },
    async addEntries(entries: readonly WebFlixLibraryEntryAddInput[]): Promise<WebFlixLibraryEntriesAddResult> {
      return {
        ok: true,
        added: entries.map((entry) => ({ id: `durable-${entry.path}`, path: entry.path, existed: false })),
      };
    },
    async authorizeEntries(ids: readonly string[]): Promise<WebFlixLibraryEntriesAuthorizeResult> {
      return { ok: true, authorized: ids.map((id) => ({ id, url: `zcode-media://local/preview?path=/x/${id}` })) };
    },
  };
  return double as unknown as WebFlixLocalLibraryBridge & {
    watchCalls: { itemId: string; providerId: string; item: unknown; positionMs?: number; durationMs?: number | null }[];
    progressCalls: { itemId: string; positionMs: number; durationMs?: number | null }[];
    clearCalls: number;
  };
}

describe("createDurableHistorySource — the null-bridge session-equivalent degrade", () => {
  it("records, orders newest-first, and filters continue at 95% exactly like the session source", async () => {
    let now = T0;
    const source = createDurableHistorySource({ bridge: null, now: () => now });
    source.recordWatch(item("a"), card(item("a")), 100_000);
    now = T1;
    source.recordWatch(item("b"), null, 100_000);
    const history = await source.listHistory();
    expect(history.map((entry) => entry.itemId)).toEqual(["b", "a"]);
    source.recordProgress("b", 96_000);
    const continueList = await source.listContinueWatching();
    // 96_000 >= 95% of 100_000 → b drops from continue, a stays.
    expect(continueList.map((entry) => entry.itemId)).toEqual(["a"]);
    expect(await source.countHistory()).toBe(2);
  });

  it("records the resume position into the session row (the pre-seek crash case keeps the old position)", async () => {
    const source = createDurableHistorySource({ bridge: null, now: at(T0) });
    source.recordWatch(item("a"), null, 120_000, 45_000);
    const history = await source.listHistory();
    expect(history[0]?.positionMs).toBe(45_000);
    expect(await source.resumePositionMs("a")).toBe(45_000);
    expect(await source.resumePositionMs("never")).toBeNull();
  });
});

describe("createDurableHistorySource — the bridge-backed durable behavior", () => {
  it("writes through with the exact payload shape (itemId/providerId/item/positionMs/durationMs)", async () => {
    const bridge = bridgeDouble();
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    const watched = item("a");
    source.recordWatch(watched, card(watched), 90_000, 12_000);
    source.recordProgress("a", 15_000, 90_000);
    await vi.waitFor(() => expect(bridge.watchCalls).toHaveLength(1));
    expect(bridge.watchCalls[0]).toMatchObject({
      itemId: "a",
      providerId: "youtube",
      positionMs: 12_000,
      durationMs: 90_000,
    });
    expect(bridge.watchCalls[0]?.item).toMatchObject({ id: "a" });
    await vi.waitFor(() => expect(bridge.progressCalls).toHaveLength(1));
    expect(bridge.progressCalls[0]).toMatchObject({ itemId: "a", positionMs: 15_000, durationMs: 90_000 });
  });

  it("never blocks or reverts a play when the durable write fails (the error sink observes)", async () => {
    const errors: unknown[] = [];
    const failing = bridgeDouble();
    failing.recordWatch = async () => Promise.reject(new Error("durable write failed"));
    const source = createDurableHistorySource({ bridge: failing, now: at(T0), onWriteError: (error) => errors.push(error) });
    const watched = item("a");
    source.recordWatch(watched, card(watched), 90_000, 12_000);
    // The session record landed anyway (the play is never blocked/reverted).
    const history = await source.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.positionMs).toBe(12_000);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
  });

  it("merges reads: session rows win, durable-only rows pass through, newest-first", async () => {
    const bridge = bridgeDouble({
      history: [
        // A durable-only row (older) and a durable row for an item re-watched this session (session wins).
        { itemId: "durable-old", item: item("durable-old"), positionMs: 5_000, watchedAt: "2026-10-31T11:00:00.000Z" },
        { itemId: "a", item: item("a"), positionMs: 99_000, watchedAt: "2026-10-31T11:30:00.000Z" },
      ],
    });
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    source.recordWatch(item("a"), null, 100_000, 1_000);
    const merged = await source.listHistory();
    expect(merged.map((entry) => entry.itemId)).toEqual(["a", "durable-old"]);
    // The session's fresh watch of "a" wins (positionMs 1_000, not the durable 99_000).
    expect(merged[0]?.positionMs).toBe(1_000);
    expect(await source.countHistory()).toBe(2);
  });

  it("drops malformed durable item payloads (the corruption guard — never a thrown list)", async () => {
    const bridge = bridgeDouble({
      history: [
        { itemId: "bad", item: { id: "mismatched" }, positionMs: 1, watchedAt: "2026-10-31T11:00:00.000Z" },
        { itemId: "good", item: item("good"), positionMs: 2, watchedAt: "2026-10-31T11:00:00.000Z" },
      ],
    });
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    const merged = await source.listHistory();
    expect(merged.map((entry) => entry.itemId)).toEqual(["good"]);
  });

  it("degrades to session-only when the durable read fails (never a thrown list)", async () => {
    const bridge = bridgeDouble({ failReads: true });
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    source.recordWatch(item("a"), null);
    expect((await source.listHistory()).map((entry) => entry.itemId)).toEqual(["a"]);
  });

  it("pause gates writes on both stores; existing rows stay readable", async () => {
    const bridge = bridgeDouble();
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    source.recordWatch(item("a"), null);
    source.setPaused(true);
    source.recordWatch(item("b"), null);
    source.recordProgress("a", 42_000);
    expect(bridge.watchCalls).toHaveLength(1);
    expect(bridge.progressCalls).toHaveLength(0);
    // The pre-pause row stays readable (pause = stop tracking, not hide).
    expect((await source.listHistory()).map((entry) => entry.itemId)).toEqual(["a"]);
    source.setPaused(false);
    source.recordWatch(item("b"), null);
    expect(bridge.watchCalls).toHaveLength(2);
  });

  it("clearAll reports the honest per-store sum (session + durable removed)", async () => {
    const bridge = bridgeDouble({ clearRemoved: 3 });
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    source.recordWatch(item("a"), null);
    source.recordWatch(item("b"), null);
    const removed = await source.clearAll();
    expect(removed).toBe(5);
    expect(bridge.clearCalls).toBe(1);
    expect(await source.countHistory()).toBe(0);
  });

  it("a failed durable clear reports the session count only (durable rows honestly survive)", async () => {
    const bridge = bridgeDouble({ clearRemoved: 3 });
    bridge.clearHistory = async () => Promise.reject(new Error("clear failed"));
    const source = createDurableHistorySource({ bridge, now: at(T0) });
    source.recordWatch(item("a"), null);
    const removed = await source.clearAll();
    expect(removed).toBe(1);
  });
});
