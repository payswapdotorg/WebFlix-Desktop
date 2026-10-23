/**
 * HistoryPort producer (WFX-PROVIDER-SLICE-1) — the local watch-history
 * surface, grouped continue-watching from the injected WebFlix-owned
 * history store.
 *
 * Honest laws:
 *   - WEBFLIX-OWNED FACTS ONLY: the groups come from the local store —
 *     what the user watched in WebFlix and where they stopped. Provider
 *     watch-history sync is deliberately absent (no third-party surface
 *     exists; AUDIT-SOURCES §8) and never implied.
 *   - Grouping is deterministic on the injected clock: Today / Yesterday /
 *     This week / Earlier (calendar-day buckets, UTC — the same no-locale-
 *     guessing rule as the labels). Entries sort newest-first inside a
 *     group (the store's own order).
 *   - Honest phases: empty when no history exists; unavailable when the
 *     local store fails; never a fabricated row.
 */
import type { ContinueCardView, HistoryPort, HistoryView } from "webflix-contracts";
import { continueCardFromEntry } from "./media-cards";
import type { ClockPort } from "../ports";
import type { MediaWatchHistoryEntry, MediaWatchHistorySource } from "./media-history-port";

export interface HistoryProducerDeps {
  readonly clock: ClockPort;
  /** The WebFlix-owned local history seam (provider facts never enter here). */
  readonly history: MediaWatchHistorySource;
  /** Maximum entries rendered (default 200). */
  readonly limit?: number;
}

const DEFAULT_HISTORY_LIMIT = 200;

/** The local-history producer (grouped continue-watching, WebFlix-owned facts). */
export class LocalHistoryProducer implements HistoryPort {
  private readonly deps: HistoryProducerDeps;

  constructor(deps: HistoryProducerDeps) {
    this.deps = deps;
  }

  async history(): Promise<HistoryView> {
    let entries: readonly MediaWatchHistoryEntry[];
    try {
      entries = await this.deps.history.listHistory(this.deps.limit ?? DEFAULT_HISTORY_LIMIT);
    } catch (error) {
      return {
        groups: [],
        phase: "unavailable",
        detail: `the local watch-history store failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (entries.length === 0) {
      return {
        groups: [],
        phase: "empty",
        detail: "No watch history yet — videos you watch in WebFlix appear here.",
      };
    }

    const now = this.deps.clock.now();
    const buckets: { label: string; items: ContinueCardView[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "This week", items: [] },
      { label: "Earlier", items: [] },
    ];
    const dayStart = utcDayStart(now);
    const dayMs = 86_400_000;
    for (const entry of entries) {
      const watchedMs = Date.parse(entry.watchedAt);
      const ageDays = Number.isFinite(watchedMs) ? Math.floor((dayStart - utcDayStart(new Date(watchedMs))) / dayMs) : Number.POSITIVE_INFINITY;
      const bucket = buckets[ageDays <= 0 ? 0 : ageDays === 1 ? 1 : ageDays <= 7 ? 2 : 3];
      if (bucket !== undefined) bucket.items.push(continueCardFromEntry(entry, now));
    }
    const groups = buckets.filter((bucket) => bucket.items.length > 0);
    return { groups, phase: "ready" };
  }
}

function utcDayStart(instant: Date): number {
  return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}
