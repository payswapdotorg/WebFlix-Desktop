/**
 * WFX-DURABLE-LIB-1 (TL3 takeover lane) — the durable watch-history source:
 * the session-scoped seam's drop-in upgrade over the main-process durable
 * store (webflixLocalLibraryIpc.ts, reached through the preload bridge).
 *
 * Semantics (the honest merge, one law per behavior):
 *   - THE SESSION REMAINS THE FAST PATH: writes land in the session map
 *     first (instant reads, byte-equivalent to createSessionHistorySource)
 *     and write THROUGH to the durable store fire-and-forget — a failed
 *     durable write never blocks or reverts a play (the session is still
 *     the truth for THIS session; only the restart depends on the durable
 *     copy).
 *   - READS MERGE: session rows win (a re-watch this session is fresher by
 *     construction — its watchedAt is newer); durable rows for items NOT
 *     re-watched this session pass through, newest-first. When the bridge
 *     is absent (web build, test DOM, preload not loaded) every read is
 *     session-only — byte-equivalent to the pre-wave behavior, the honest
 *     degrade, never a fabricated durable success.
 *   - PAUSE GATES WRITES (WF-021): the retention pause/resume controls flip
 *     setPaused(); a paused source records NOTHING new (session append and
 *     durable write-through both refuse) — existing rows stay visible (the
 *     pause is "stop tracking", not "hide history", per the retention model).
 *   - MALFORMED DURABLE ROWS DEGRADE: a durable entry whose item payload
 *     does not survive the shape sanity check (id/providerId/title) is
 *     dropped from the view — the main store's own validated writes make
 *     this a corruption guard, never a normal path (never a thrown list).
 */
import type { CatalogItem, VideoCardView } from "../../../../../webflix-contracts/src/index.js";
import type { MediaWatchHistoryEntry } from "../../../../../webflix-application/src/media/media-history-port.js";
import type { WebFlixLocalLibraryBridge, WebFlixWatchHistoryEntry } from "./localLibraryBridge.js";

/** One session record (the same shape the session source keeps). */
interface SessionRecord {
  readonly item: CatalogItem;
  readonly card: VideoCardView | null;
  positionMs: number;
  durationMs?: number;
  watchedAt: string;
}

/** The durable history source's own surface (SessionHistorySource + the durable extras). */
export interface DurableHistorySource extends MediaWatchHistorySource {
  recordWatch(item: CatalogItem, card: VideoCardView | null, durationMs?: number, positionMs?: number): void;
  recordProgress(itemId: string, positionMs: number, durationMs?: number): void;
  /** WF-021: the retention pause gate — true refuses every new record (both stores). */
  setPaused(paused: boolean): void;
  /** The honest merged fact count (session + durable distinct items) — retention counts. */
  countHistory(): Promise<number>;
  /** The retention history-reset scope: clears BOTH stores; returns the removed fact count. */
  clearAll(): Promise<number>;
  /**
   * The stored resume position for one item (the merged history view's
   * positionMs), or null when the item has no stored progress — the play
   * path seeks the player to it once (WFX-DURABLE-LIB-1 resume).
   */
  resumePositionMs(itemId: string): Promise<number | null>;
}

export interface DurableHistoryDeps {
  /** The preload bridge, or null for the honest session-only degrade. */
  readonly bridge: WebFlixLocalLibraryBridge | null;
  /** Injectable clock (tests pin it); default: real Date. */
  readonly now?: () => Date;
  /** Injectable error sink (tests observe write-through failures); default: silent. */
  readonly onWriteError?: (error: unknown) => void;
}

/** The durable-backed watch-history source (the session seam's drop-in upgrade). */
export function createDurableHistorySource(deps: DurableHistoryDeps): DurableHistorySource {
  const bridge = deps.bridge;
  const clock = (): string => (deps.now ?? (() => new Date()))().toISOString();
  const records = new Map<string, SessionRecord>();
  let paused = false;

  const sessionEntries = (): readonly MediaWatchHistoryEntry[] =>
    [...records.values()]
      .sort((a, b) => (a.watchedAt < b.watchedAt ? 1 : -1))
      .map((record) => ({
        itemId: record.item.id,
        item: record.item,
        positionMs: record.positionMs,
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
        watchedAt: record.watchedAt,
      }));

  /** Fire-and-forget durable write-through — never blocks, never reverts. */
  const writeThrough = (call: (live: WebFlixLocalLibraryBridge) => Promise<unknown>): void => {
    if (bridge === null) return;
    void call(bridge).catch((error: unknown) => {
      deps.onWriteError?.(error);
    });
  };

  /** Shape-sanity for a durable row's item payload (the corruption guard). */
  const durableItemOf = (entry: WebFlixWatchHistoryEntry): CatalogItem | null => {
    const item = entry.item as Partial<CatalogItem> | null;
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.id !== "string" ||
      item.id !== entry.itemId ||
      typeof item.providerId !== "string" ||
      typeof item.title !== "string"
    ) {
      return null;
    }
    return item as CatalogItem;
  };

  const durableEntries = async (kind: "history" | "continue"): Promise<readonly MediaWatchHistoryEntry[]> => {
    if (bridge === null) return [];
    try {
      const result = await bridge.listHistory(kind);
      if (!result.ok) return [];
      const mapped: MediaWatchHistoryEntry[] = [];
      for (const entry of result.entries) {
        const item = durableItemOf(entry);
        if (item === null) continue;
        mapped.push({
          itemId: entry.itemId,
          item,
          positionMs: entry.positionMs,
          ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
          watchedAt: entry.watchedAt,
        });
      }
      return mapped;
    } catch {
      // A failed durable read degrades to session-only — never a thrown list.
      return [];
    }
  };

  /** The merged view: session rows win, durable rows pass through, newest first. */
  const mergedEntries = async (
    kind: "history" | "continue",
    limit?: number,
  ): Promise<readonly MediaWatchHistoryEntry[]> => {
    const durable = await durableEntries(kind);
    const seen = new Set(records.keys());
    const merged = [...sessionEntries(), ...durable.filter((entry) => !seen.has(entry.itemId))];
    merged.sort((a, b) => (a.watchedAt < b.watchedAt ? 1 : -1));
    const filtered =
      kind === "continue"
        ? merged.filter((entry) => {
            if (entry.durationMs === undefined || !(entry.durationMs > 0)) return true;
            return entry.positionMs < entry.durationMs * 0.95;
          })
        : merged;
    return limit === undefined ? filtered : filtered.slice(0, limit);
  };

  return {
    recordWatch(item, card, durationMs, positionMs) {
      if (paused) return;
      records.set(item.id, {
        item,
        card,
        positionMs: positionMs ?? 0,
        ...(durationMs !== undefined ? { durationMs } : {}),
        watchedAt: clock(),
      });
      writeThrough((live) =>
        live.recordWatch({
          itemId: item.id,
          providerId: item.providerId,
          item,
          positionMs: positionMs ?? 0,
          ...(durationMs !== undefined ? { durationMs } : {}),
        }),
      );
    },
    recordProgress(itemId, positionMs, durationMs) {
      if (paused) return;
      const existing = records.get(itemId);
      if (existing === undefined) {
        // The session semantics hold: progress rides a watch that happened.
        // A durable-only row (restored/restart case) still records through.
        writeThrough((live) =>
          live.recordProgress({
            itemId,
            positionMs,
            ...(durationMs !== undefined ? { durationMs } : {}),
          }),
        );
        return;
      }
      existing.positionMs = positionMs;
      if (durationMs !== undefined) existing.durationMs = durationMs;
      existing.watchedAt = clock();
      writeThrough((live) =>
        live.recordProgress({
          itemId,
          positionMs,
          ...(durationMs !== undefined ? { durationMs } : {}),
        }),
      );
    },
    async listContinueWatching(limit) {
      return mergedEntries("continue", limit);
    },
    async listHistory(limit) {
      return mergedEntries("history", limit);
    },
    setPaused(nextPaused) {
      paused = nextPaused;
    },
    async resumePositionMs(itemId) {
      const merged = await mergedEntries("history");
      const found = merged.find((entry) => entry.itemId === itemId);
      return found !== undefined && found.positionMs > 0 ? found.positionMs : null;
    },
    async countHistory() {
      const durable = bridge === null ? [] : await durableEntries("history");
      const ids = new Set<string>([...records.keys(), ...durable.map((entry) => entry.itemId)]);
      return ids.size;
    },
    async clearAll() {
      // The honest per-store removed count: session rows always clear; the
      // durable count is what the IPC reports removed (a failed durable
      // clear leaves its rows counted by the NEXT countHistory — consistent,
      // never an invented "removed" number).
      const sessionRemoved = records.size;
      records.clear();
      if (bridge === null) return sessionRemoved;
      try {
        const result = await bridge.clearHistory();
        if (result.ok) return sessionRemoved + result.removed;
      } catch {
        // The durable clear failed — the session part still cleared; the
        // honest count is the session number only (the durable rows remain
        // and stay visible in every subsequent read).
      }
      return sessionRemoved;
    },
  };
}
