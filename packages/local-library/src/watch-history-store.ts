import { CatalogItemSchema } from "webflix-contracts";
import type { CatalogItem } from "webflix-contracts";
import { PROVIDER_METADATA_TTL_MS } from "./constants";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { ValidationError } from "./errors";

/** Parses through the locked schema, surfacing failures as the lane's typed error. */
function parseItem(value: unknown): CatalogItem {
  try {
    return CatalogItemSchema.parse(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid input";
    throw new ValidationError(`watch-history item payload is not a valid CatalogItem: ${detail}`);
  }
}

/**
 * Durable WebFlix-owned watch-history store (WFX-DURABLE-LIB-1) on the
 * local-library storage seam — the `watch_history` table (additive migration
 * 0008, the freeze §7.5/AS-Q8 storage profile; see the migration header for
 * the applied laws verbatim).
 *
 * What this store is:
 *   - the durable form of the renderer session seam MediaWatchHistorySource
 *     (packages/webflix-application/src/media/media-history-port.ts — the
 *     frozen producer seam, unchanged): one row per watched item, newest
 *     watch wins, positions for resume, WebFlix-owned facts only (provider
 *     account watch-history is a provider-owned record with no third-party
 *     read surface and NEVER enters here — AUDIT-SOURCES §8).
 *   - the pause/reset target of the retention controls (WF-021): clearHistory
 *     is the history reset scope; countHistory feeds the honest record
 *     counts (facts, including TTL-degraded rows).
 *
 * Honesty rules enforced here:
 *   - WRITE validation: recordWatch validates the incoming CatalogItem
 *     through the locked CatalogItemSchema — a malformed item is a typed
 *     ValidationError, never persisted.
 *   - READ degradation: a payload that fails the locked schema (corruption,
 *     tampering, schema drift) degrades to payload-null — the SAME honest
 *     state as a TTL-expired payload: the facts survive, the row stops
 *     rendering. Never a silently-mangled card, never a thrown list.
 *   - TTL: sweepExpiredPayloads nulls provider-sourced payloads older than
 *     PROVIDER_METADATA_TTL_MS (30 days) — refresh-or-delete, §7.5; watching
 *     again IS the refresh (the upsert re-stamps payload_fetched_at). The
 *     local provider is exempt (WebFlix-owned metadata end-to-end).
 *   - No network, no telemetry: the only stamps are the injected clock's
 *     epoch-ms columns.
 */

/** One durable watch-history row (the facts + the nullable cached payload). */
export interface WatchHistoryRecord {
  readonly itemId: string;
  readonly providerId: string;
  /** The canonical CatalogItem captured at watch time; null once TTL'd/degraded. */
  readonly item: CatalogItem | null;
  /** Epoch-ms when the cached payload was last refreshed (null with item). */
  readonly payloadFetchedAt: number | null;
  readonly positionMs: number;
  readonly durationMs: number | null;
  /** Epoch-ms of the LAST watch (upsert keeps one row per item). */
  readonly watchedAt: number;
  readonly updatedAt: number;
}

/** The write input for recordWatch (the payload is re-stamped as fresh). */
export interface WatchHistoryWriteInput {
  readonly itemId: string;
  readonly providerId: string;
  readonly item: CatalogItem;
  /** Resume position (ms) when the watch itself resumes (default 0). */
  readonly positionMs?: number;
  readonly durationMs?: number | null;
}

/** The progress write input (only updates an EXISTING row — session semantics). */
export interface WatchProgressInput {
  readonly itemId: string;
  readonly positionMs: number;
  readonly durationMs?: number | null;
}

export interface WatchHistoryStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  readonly now?: () => number;
}

const PROVIDER_ID_LOCAL = "local";

/** Durable watch-history store over the `watch_history` table. */
export class SqliteWatchHistoryStore {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: WatchHistoryStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  /**
   * Upserts one watched item (the latest watch wins — one row per item_id).
   * The item payload is validated and re-stamped as freshly fetched (the
   * §7.5 refresh path); positionMs starts at the input (resume-aware, 0 for
   * a fresh watch) and progress writes follow.
   */
  recordWatch(input: WatchHistoryWriteInput): WatchHistoryRecord {
    if (typeof input.itemId !== "string" || input.itemId.trim().length === 0) {
      throw new ValidationError("WatchHistoryWriteInput.itemId must be a non-empty string");
    }
    const item = parseItem(input.item);
    if (item.id !== input.itemId) {
      throw new ValidationError(
        `WatchHistoryWriteInput.itemId must match item.id (${input.itemId} vs ${item.id})`,
      );
    }
    if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) {
      throw new ValidationError("WatchHistoryWriteInput.providerId must be a non-empty string");
    }
    const now = this.clock();
    const positionMs = normalizeMs(input.positionMs ?? 0);
    const durationMs = normalizeNullableMs(input.durationMs);
    this.db
      .prepare(
        "INSERT INTO watch_history (item_id, provider_id, item_payload, payload_fetched_at, " +
          "position_ms, duration_ms, watched_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(item_id) DO UPDATE SET provider_id = excluded.provider_id, " +
          "item_payload = excluded.item_payload, payload_fetched_at = excluded.payload_fetched_at, " +
          "position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, " +
          "watched_at = excluded.watched_at, updated_at = excluded.updated_at",
      )
      .run(
        toSqlParam(item.id),
        toSqlParam(input.providerId),
        toSqlParam(JSON.stringify(item)),
        toSqlParam(now),
        toSqlParam(positionMs),
        toSqlParam(durationMs),
        toSqlParam(now),
        toSqlParam(now),
      );
    return {
      itemId: item.id,
      providerId: input.providerId,
      item,
      payloadFetchedAt: now,
      positionMs,
      durationMs,
      watchedAt: now,
      updatedAt: now,
    };
  }

  /**
   * Updates the playhead position of an EXISTING row (the session source's
   * semantics: a progress write for an unknown item is a no-op, never a new
   * row — progress rides a watch that actually happened). Returns the
   * updated record, or null when no row exists.
   */
  recordProgress(input: WatchProgressInput): WatchHistoryRecord | null {
    const positionMs = normalizeMs(input.positionMs);
    const durationMs = normalizeNullableMs(input.durationMs);
    const now = this.clock();
    const changes = this.db
      .prepare(
        "UPDATE watch_history SET position_ms = ?, duration_ms = COALESCE(?, duration_ms), " +
          "updated_at = ? WHERE item_id = ?",
      )
      .run(toSqlParam(positionMs), toSqlParam(durationMs), toSqlParam(now), toSqlParam(input.itemId))
      .changes;
    if (changes === 0) return null;
    return this.get(input.itemId);
  }

  /** One row by itemId (facts + payload, TTL-swept payload reads as null). */
  get(itemId: string): WatchHistoryRecord | null {
    const row = this.db.prepare("SELECT * FROM watch_history WHERE item_id = ?").get(toSqlParam(itemId));
    return row === undefined ? null : rowToRecord(row);
  }

  /**
   * The full durable watch history — newest watchedAt first, RENDERABLE rows
   * only (a TTL-degraded or corrupt payload row carries no card and is
   * excluded from the view; its facts stay countable via countHistory).
   */
  listHistory(limit?: number): readonly WatchHistoryRecord[] {
    return this.listRenderable(limit);
  }

  /**
   * Continue-watching candidates — newest first, excluding near-complete
   * entries (position >= 95% of a known duration — the session source's
   * documented filter).
   */
  listContinueWatching(limit?: number): readonly WatchHistoryRecord[] {
    return this.listRenderable(limit).filter((record) => {
      if (record.durationMs === null || record.durationMs <= 0) return true;
      return record.positionMs < record.durationMs * 0.95;
    });
  }

  /** Total durable rows (FACTS, including payload-degraded ones) — honest retention counts. */
  countHistory(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM watch_history").get();
    return row === undefined ? 0 : Number(row["n"] ?? 0);
  }

  /**
   * The retention history-reset scope (WF-021): deletes every watch-history
   * row and reports how many facts were removed. `all`-scope resets call
   * this too (the scope union includes history).
   */
  clearHistory(): number {
    const result = this.db.prepare("DELETE FROM watch_history").run();
    return Number(result.changes ?? 0);
  }

  /**
   * The §7.5 30-day refresh-or-delete sweep over the cached payloads: every
   * provider-sourced (non-local) payload older than the TTL is nulled (the
   * row's facts survive). Returns how many rows were degraded.
   */
  sweepExpiredPayloads(): number {
    const now = this.clock();
    const cutoff = now - PROVIDER_METADATA_TTL_MS;
    const result = this.db
      .prepare(
        "UPDATE watch_history SET item_payload = NULL, payload_fetched_at = NULL, updated_at = ? " +
          "WHERE item_payload IS NOT NULL AND provider_id != ? AND payload_fetched_at IS NOT NULL " +
          "AND payload_fetched_at < ?",
      )
      .run(toSqlParam(now), toSqlParam(PROVIDER_ID_LOCAL), toSqlParam(cutoff));
    return Number(result.changes ?? 0);
  }

  /**
   * The renderable listing (newest watch first, stable by item_id): rows
   * whose cached payload is null (TTL'd or degraded) carry no card and stay
   * out of the view — their facts remain via countHistory.
   */
  private listRenderable(limit?: number): readonly WatchHistoryRecord[] {
    const rows =
      limit === undefined
        ? this.db
            .prepare(
              "SELECT * FROM watch_history WHERE item_payload IS NOT NULL " +
                "ORDER BY watched_at DESC, item_id",
            )
            .all()
        : this.db
            .prepare(
              "SELECT * FROM watch_history WHERE item_payload IS NOT NULL " +
                "ORDER BY watched_at DESC, item_id LIMIT ?",
            )
            .all(toSqlParam(limit));
    const records: WatchHistoryRecord[] = [];
    for (const row of rows) {
      const record = rowToRecord(row);
      // A corrupt payload (parse failure) degrades to null AFTER the SQL
      // filter — re-checked here so a mangled card never renders.
      if (record.item !== null) records.push(record);
    }
    return records;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Normalizes a non-negative ms value (positions never go negative). */
function normalizeMs(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Normalizes an optional duration into a nullable, non-negative integer ms. */
function normalizeNullableMs(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Row → record. The cached payload parses through the locked CatalogItemSchema;
 * ANY parse failure degrades to payload-null (facts kept, card dropped — the
 * documented corruption rule; never a mangled card, never a thrown list).
 */
function rowToRecord(row: Record<string, unknown>): WatchHistoryRecord {
  const rawPayload = row["item_payload"];
  let item: CatalogItem | null = null;
  if (typeof rawPayload === "string" && rawPayload.length > 0) {
    try {
      item = CatalogItemSchema.parse(JSON.parse(rawPayload));
    } catch {
      item = null;
    }
  }
  return {
    itemId: String(row["item_id"] ?? ""),
    providerId: String(row["provider_id"] ?? ""),
    item,
    payloadFetchedAt:
      row["payload_fetched_at"] === null || row["payload_fetched_at"] === undefined
        ? null
        : Number(row["payload_fetched_at"]),
    positionMs: Number(row["position_ms"] ?? 0),
    durationMs:
      row["duration_ms"] === null || row["duration_ms"] === undefined ? null : Number(row["duration_ms"]),
    watchedAt: Number(row["watched_at"] ?? 0),
    updatedAt: Number(row["updated_at"] ?? 0),
  };
}
