/**
 * The local watch-history seam (WFX-PROVIDER-SLICE-1) — WebFlix-owned facts
 * ONLY, injected into the History/Home producers.
 *
 * What this seam is:
 *   - the continue-watching and watch-history source for the media surfaces
 *     (HomeFeedPort's continue rail, HistoryPort's grouped view). Entries
 *     are WebFlix-OWNED local records: what the user watched in WebFlix,
 *     where they stopped, and when — never a provider account's own
 *     watch-history sync (YouTube watch history is a provider-owned record
 *     with no third-party read surface; see AUDIT-SOURCES §8).
 *   - each entry carries the canonical CatalogItem VERBATIM as recorded at
 *     watch time, so continue cards play through the SAME playback planning
 *     the original surface used. Provider-sourced metadata riding these
 *     records is cached provider data: durable implementations MUST apply
 *     the freeze §7.8 30-day refresh-or-delete rule to it.
 *   - implementations live app-side/desktop-side (the durable history store
 *     is the local-library seam's later order); tests inject the in-memory
 *     fakes. Nothing here performs I/O — the seam is data in, data out.
 */
import type { CatalogItem } from "webflix-contracts";

/** One WebFlix-owned watch-history entry (a continue-watching fact). */
export interface MediaWatchHistoryEntry {
  /** The canonical CatalogItem id (must match entry.item.id). */
  readonly itemId: string;
  /** The canonical CatalogItem as recorded at watch time — rides VERBATIM into continue cards. */
  readonly item: CatalogItem;
  /** Last playhead position reached, in ms. */
  readonly positionMs: number;
  /** The item's duration in ms when known (for progress percent + labels). */
  readonly durationMs?: number;
  /** When this watch session was last observed (ISO-8601 UTC, injected clock). */
  readonly watchedAt: string;
}

/** The local history seam the History/Home producers consume. */
export interface MediaWatchHistorySource {
  /** Continue-watching candidates — most-recently-watched first, unwatched-complete entries excluded. */
  listContinueWatching(limit?: number): Promise<readonly MediaWatchHistoryEntry[]>;
  /** The full local watch history — most-recently-watched first. */
  listHistory(limit?: number): Promise<readonly MediaWatchHistoryEntry[]>;
}
