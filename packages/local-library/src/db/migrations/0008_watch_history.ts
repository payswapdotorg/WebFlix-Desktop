import type { Migration } from "../migrate";

/**
 * 0008_watch_history — the durable WebFlix-owned watch-history table
 * (WFX-DURABLE-LIB-1: the durable local-library/history bridge, the standing
 * recycle-recovery residual).
 *
 * ADDITIVE ONLY: one new `watch_history` table; no existing table is touched,
 * so a pre-existing 0001–0007 store file applies this on its next open with
 * all data intact (the forward-only runner records the hash; there is no data
 * migration because no durable watch-history rows existed before this order —
 * the renderer's watch history was session-scoped by documented design).
 *
 * Storage profile — freeze §7.5 (AS-Q8) applied verbatim:
 * - WebFlix-OWNED FACTS persist indefinitely: the watched item id, the
 *   provider id, timestamps, the playhead position and duration. These are
 *   the columns; they are never TTL'd.
 * - The cached PROVIDER METADATA riding the record (the canonical CatalogItem
 *   captured at watch time — the only way a continue card can render) is
 *   refresh-or-delete with the 30-day TTL (PROVIDER_METADATA_TTL_MS, the same
 *   law as the provider_metadata table): `item_payload` + `payload_fetched_at`
 *   are the cached field set; the sweep nulls expired payloads (the row's
 *   facts survive; the row stops rendering — no card without the item).
 *   Watching an item again IS the refresh (the upsert re-stamps
 *   payload_fetched_at).
 * - `provider_id = 'local'` is EXEMPT from the TTL: the local provider's
 *   item payload is WebFlix-owned file metadata end-to-end (title/size/path
 *   facts captured at import), not provider-sourced cache.
 * - CANONICAL JSON COLUMN: `item_payload` is the canonical CatalogItem JSON
 *   (the round-trip source of truth). A payload that fails the locked
 *   CatalogItemSchema on read degrades to payload-null (the corruption rule:
 *   the user's FACTS are never silently discarded; the cached card degrades
 *   honestly instead of rendering mangled data).
 * - SEPARATION IS STRUCTURAL (the 0002–0007 precedent): no foreign key or
 *   join reaches into any library, mi or ad table family. A watch-history
 *   row may honestly exist without a library entry (provider items are
 *   watched without being library entries); the itemId correlation is by
 *   value only.
 * - PER-PROFILE ISOLATION is structural (every adapter binds to one
 *   profile-scoped database handle, ADR-0003), so no profile column exists.
 * - Upsert-by-item_id: one row per watched item (the latest watch wins — the
 *   documented session-source semantics), `watched_at` = last watch,
 *   `updated_at` = last write of any kind.
 */
export const migration0008WatchHistory: Migration = {
  id: 8,
  name: "0008_watch_history",
  sql: `
CREATE TABLE IF NOT EXISTS watch_history (
  item_id             TEXT PRIMARY KEY,
  provider_id         TEXT NOT NULL,
  item_payload        TEXT,
  payload_fetched_at  INTEGER,
  position_ms         INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER,
  watched_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_history_watched_at
  ON watch_history (watched_at DESC, item_id);
`,
};
