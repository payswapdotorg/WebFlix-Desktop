import { AdRecordSchema, ErrorCode, WebFlixError } from "webflix-contracts";
import type { AdRecord } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable AdRecord store (P5-STORES row 2) on the local-library storage
 * seam — one observed ad (the 0.8.0 shape: creative text/urls, regions/
 * periods as reported, the advertiser identity ref, the import
 * provenance), keyed by the record's own id in the OWN `ad_records` table
 * (additive migration 0006, the 0002–0005 rules). NO ranking signals and
 * NO user data are persisted — the shape itself carries none (the
 * structural separation the architecture rule pins).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's AdRecordStore (packages/webflix-application/src/ports.ts); both
 * sides are structurally typed, so this adapter satisfies the application
 * port without a cross-package dependency from this lane. The composition
 * root wires them in a later order (explicitly NOT this order's scope).
 *
 * PUT-REPLACES BY ID (the record house semantic) + the VERSION QUERY the
 * import seam decides on: `listBySourceAdId(source, sourceAdId)` returns
 * every stored record a source has reported under ONE source ad id — its
 * version history in (stored_at, id) order. The replace-vs-append decision
 * itself (same source id + same batch = replace; different batch = a NEW
 * version appended) lives in the application layer's ads.import seam where
 * the charter places it: this store stays DUMB — `put` inserts or replaces
 * by id, `delete` removes one row, and the seam orchestrates. The store
 * performs NO dedup magic of its own.
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004/0005 store rules, verbatim in intent):
 * - SHAPE validation on write AND read through the 0.8.0 schema — a shape
 *   violation surfaces as the typed `ads/record-invalid` WebFlixError;
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/record-absent` error (never null, never a substitute) —
 *   the honest pre-import state, with re-import named as the recovery;
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the canonical
 *   payload is re-computed and compared on every read — a corrupt or
 *   tampered row surfaces TYPED, never as silently-mangled ad data (an
 *   identity checksum, not a cryptographic claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) everywhere; the version
 *   query orders by (stored_at, id) within one (source, source_ad_id);
 * - a record with NO sourceAdId carries no matchable source identity —
 *   the honest-absent NULL column means the seam can only key it by id
 *   (no dedup magic without a source id);
 * - no telemetry, no network, no randomness: the only stamp is the
 *   injected clock's epoch-ms (`stored_at`).
 */

/** Per-profile AdRecord store (structural port mirror). */
export interface AdRecordStorePort {
  /** Persists (or replaces wholesale) the record for its id. */
  put(record: AdRecord): Promise<void>;
  /**
   * The stored record; rejects with the typed `ads/record-absent` error
   * when none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<AdRecord>;
  /** All stored records, deterministic (stored_at, id) order. */
  list(): Promise<readonly AdRecord[]>;
  /**
   * The version history of ONE source-reported ad: every stored record the
   * given source reports under the given source ad id, (stored_at, id)
   * order — the import seam's replace-vs-append decision surface. Empty
   * when the source has never reported that ad id (honest empty).
   */
  listBySourceAdId(source: string, sourceAdId: string): Promise<readonly AdRecord[]>;
  /**
   * Deletes one record by id; true when it existed. The import seam's
   * same-batch replace path (it removes the superseded row) and the
   * retention surface — never a silent cascade (claims of a deleted
   * record stay stored and readable; the keyed-stores honesty rule).
   */
  delete(id: string): Promise<boolean>;
}

export interface AdRecordStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable AdRecordStore: rows in `ad_records`. */
export class SqliteAdRecordStore implements AdRecordStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: AdRecordStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(record: AdRecord): Promise<void> {
    const parsed = parseRecordShape(record, "put");
    const canonical = canonicalRecordJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_records (id, source, source_ad_id, advertiser_identity_id, import_batch_id, checksum, record_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET source = excluded.source, source_ad_id = excluded.source_ad_id, " +
          "advertiser_identity_id = excluded.advertiser_identity_id, import_batch_id = excluded.import_batch_id, " +
          "checksum = excluded.checksum, record_json = excluded.record_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.provenance.source),
        toSqlParam(parsed.sourceAdId ?? null),
        toSqlParam(parsed.advertiserIdentityId),
        toSqlParam(parsed.provenance.importBatchId),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
  }

  async get(id: string): Promise<AdRecord> {
    const row = this.db
      .prepare("SELECT id, checksum, record_json FROM ad_records WHERE id = ?")
      .get(toSqlParam(id));
    if (row === undefined) {
      throw recordAbsent(id);
    }
    return verifyStoredRecord(row["id"], row["checksum"], row["record_json"]);
  }

  async list(): Promise<readonly AdRecord[]> {
    const rows = this.db
      .prepare("SELECT id, checksum, record_json FROM ad_records ORDER BY stored_at, id")
      .all();
    return rows.map((row) => verifyStoredRecord(row["id"], row["checksum"], row["record_json"]));
  }

  async listBySourceAdId(source: string, sourceAdId: string): Promise<readonly AdRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT id, checksum, record_json FROM ad_records " +
          "WHERE source = ? AND source_ad_id = ? ORDER BY stored_at, id",
      )
      .all(toSqlParam(source), toSqlParam(sourceAdId));
    return rows.map((row) => verifyStoredRecord(row["id"], row["checksum"], row["record_json"]));
  }

  async delete(id: string): Promise<boolean> {
    return this.db.prepare("DELETE FROM ad_records WHERE id = ?").run(toSqlParam(id)).changes > 0;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the record: fixed key order (id, sourceAdId,
 * advertiserIdentityId, creativeText, creativeUrls, regions, periods,
 * provenance{source, observedAt, importedAt, importBatchId} — the schema's
 * own declaration order), present keys only, no whitespace — the byte-exact
 * serialization the store round-trips through and checksums.
 */
function canonicalRecordJson(record: AdRecord): string {
  return JSON.stringify({
    id: record.id,
    ...(record.sourceAdId !== undefined ? { sourceAdId: record.sourceAdId } : {}),
    advertiserIdentityId: record.advertiserIdentityId,
    ...(record.creativeText !== undefined ? { creativeText: record.creativeText } : {}),
    ...(record.creativeUrls !== undefined ? { creativeUrls: record.creativeUrls } : {}),
    ...(record.regions !== undefined ? { regions: record.regions } : {}),
    ...(record.periods !== undefined ? { periods: record.periods } : {}),
    provenance: {
      source: record.provenance.source,
      ...(record.provenance.observedAt !== undefined
        ? { observedAt: record.provenance.observedAt }
        : {}),
      importedAt: record.provenance.importedAt,
      importBatchId: record.provenance.importBatchId,
    },
  });
}

/** The typed shape-violation error for the write path. */
function recordInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsRecordInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates a record through the 0.8.0 schema (typed errors). */
function parseRecordShape(input: unknown, path: string): AdRecord {
  const parsed = AdRecordSchema.safeParse(input);
  if (!parsed.success) {
    throw recordInvalid(`not a valid AdRecord (${path}): ${parsed.error.message}`, "AdRecord");
  }
  return parsed.data;
}

/**
 * Parses the stored canonical-JSON column back into the record and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled ad data).
 */
function verifyStoredRecord(rawId: unknown, rawChecksum: unknown, rawJson: unknown): AdRecord {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = AdRecordSchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw recordInvalid(
      `stored ad record row "${id}" failed its shape verification: ${parsed.error.message}`,
      "AdRecord",
      id,
    );
  }
  const canonical = canonicalRecordJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw recordInvalid(
      `stored ad record row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "AdRecord.checksum",
      id,
    );
  }
  return parsed.data;
}

/** Parses a stored JSON column, typed on corruption. */
function parseRowJson(raw: unknown, id: string): unknown {
  const text = typeof raw === "string" ? raw : String(raw);
  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw recordInvalid(
      `stored ad record row "${id}" is not valid JSON: ${detail}`,
      "AdRecord",
      id,
    );
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function recordAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsRecordAbsent,
    reason:
      `no stored Ad Center record for id "${id}" — ` +
      "the ad was never imported, its row was replaced away in a later same-batch import, or it was explicitly removed; import it through ads.import to make it resolvable",
    retryable: false,
    context: { id },
  });
}
