import { ErrorCode, ReviewSignalSchema, WebFlixError } from "webflix-contracts";
import type { ReviewSignal } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable ReviewSignal store (P5-STORES row 2) on the local-library storage
 * seam — the AS-REPORTED independent review signals (the 0.8.0 shape: a
 * review source's own rating/classification vocabulary, verbatim, plus the
 * region/scope it covers and the import provenance), keyed by the signal's
 * own id in the OWN `ad_review_signals` table (additive migration 0006, the
 * 0002–0005 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's ReviewSignalStore (packages/webflix-application/src/ports.ts);
 * both sides are structurally typed, so this adapter satisfies the
 * application port without a cross-package dependency from this lane. The
 * composition root wires them in a later order (explicitly NOT this
 * order's scope).
 *
 * APPEND-ONLY (the charter's rule: review signals are append-only facts —
 * the store NEVER replaces or deletes): `append` is idempotent-by-id
 * check-then-insert (the 0002 FeedbackStore precedent) — re-appending a
 * stored id returns the STORED signal as a `duplicate`, never a second row,
 * and the idempotency survives restarts. There is NO put, NO delete, NO
 * clearAll in this module by design; a re-reported signal is a NEW signal
 * with a NEW id. NO AGGREGATION anywhere (the charter's honest non-goal):
 * the store never computes, normalizes, or scores anything — it persists
 * the source's own vocabulary verbatim and lists it.
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004/0005 store rules, verbatim in intent):
 * - SHAPE validation on append AND read through the 0.8.0 schema (including
 *   its at-least-one-of rating/classification refinement) — a shape
 *   violation surfaces as the typed `ads/record-invalid` WebFlixError (the
 *   code the contracts assign to ads-lane record defects at import/store
 *   boundaries: a review signal IS an ads-lane record this order persists);
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/review-signal-absent` error (never null, never a substitute);
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the canonical
 *   payload is re-computed and compared on every read — a corrupt or
 *   tampered row surfaces TYPED (an identity checksum, not a cryptographic
 *   claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) — the audio-rendition
 *   precedent;
 * - no telemetry, no network, no randomness: the only stamp is the injected
 *   clock's epoch-ms (`stored_at`).
 */

/** Idempotent-append outcome (mirrors the application port's union). */
export type ReviewSignalAppendResult =
  | { readonly outcome: "appended"; readonly signal: ReviewSignal }
  /** Same id as a stored signal: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: ReviewSignal };

/** Per-profile ReviewSignal store (structural port mirror). */
export interface ReviewSignalStorePort {
  /** Appends one signal; a stored id re-appends as a duplicate (idempotent). */
  append(signal: ReviewSignal): Promise<ReviewSignalAppendResult>;
  /**
   * The stored signal; rejects with the typed `ads/review-signal-absent`
   * error when none was appended (never null — absence is typed and
   * surfaced).
   */
  get(id: string): Promise<ReviewSignal>;
  /** All stored signals, deterministic (stored_at, id) order. */
  list(): Promise<readonly ReviewSignal[]>;
}

export interface ReviewSignalStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable ReviewSignalStore: rows in `ad_review_signals`. */
export class SqliteReviewSignalStore implements ReviewSignalStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: ReviewSignalStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async append(signal: ReviewSignal): Promise<ReviewSignalAppendResult> {
    const parsed = parseSignalShape(signal, "append");
    const existing = readSignalRow(this.db, parsed.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    const canonical = canonicalSignalJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_review_signals (id, source, checksum, signal_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.source),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
    return { outcome: "appended", signal: parsed };
  }

  async get(id: string): Promise<ReviewSignal> {
    const row = readSignalRow(this.db, id);
    if (row === undefined) {
      throw signalAbsent(id);
    }
    return row;
  }

  async list(): Promise<readonly ReviewSignal[]> {
    const rows = this.db
      .prepare("SELECT id, checksum, signal_json FROM ad_review_signals ORDER BY stored_at, id")
      .all();
    return rows.map((row) => verifyStoredSignal(row["id"], row["checksum"], row["signal_json"]));
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the signal: fixed key order (id, source,
 * asReportedRating, asReportedClassification, region, scope, provenance
 * {source, observedAt, importedAt, importBatchId} — the schema's own
 * declaration order), present keys only, no whitespace — the byte-exact
 * serialization the store round-trips through and checksums.
 */
function canonicalSignalJson(signal: ReviewSignal): string {
  return JSON.stringify({
    id: signal.id,
    source: signal.source,
    ...(signal.asReportedRating !== undefined ? { asReportedRating: signal.asReportedRating } : {}),
    ...(signal.asReportedClassification !== undefined
      ? { asReportedClassification: signal.asReportedClassification }
      : {}),
    ...(signal.region !== undefined ? { region: signal.region } : {}),
    ...(signal.scope !== undefined ? { scope: signal.scope } : {}),
    provenance: {
      source: signal.provenance.source,
      ...(signal.provenance.observedAt !== undefined
        ? { observedAt: signal.provenance.observedAt }
        : {}),
      importedAt: signal.provenance.importedAt,
      importBatchId: signal.provenance.importBatchId,
    },
  });
}

/** The typed shape-violation error for the append path. */
function signalInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsRecordInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates a signal through the 0.8.0 schema (typed errors). */
function parseSignalShape(input: unknown, path: string): ReviewSignal {
  const parsed = ReviewSignalSchema.safeParse(input);
  if (!parsed.success) {
    throw signalInvalid(
      `not a valid ReviewSignal (${path}): ${parsed.error.message}`,
      "ReviewSignal",
    );
  }
  return parsed.data;
}

/** Reads and verifies one signal row by id; undefined when no row exists. */
function readSignalRow(db: SqliteDatabase, id: string): ReviewSignal | undefined {
  const row = db
    .prepare("SELECT id, checksum, signal_json FROM ad_review_signals WHERE id = ?")
    .get(toSqlParam(id));
  if (row === undefined) {
    return undefined;
  }
  return verifyStoredSignal(row["id"], row["checksum"], row["signal_json"]);
}

/**
 * Parses the stored canonical-JSON column back into the signal and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled review facts).
 */
function verifyStoredSignal(rawId: unknown, rawChecksum: unknown, rawJson: unknown): ReviewSignal {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = ReviewSignalSchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw signalInvalid(
      `stored ad review signal row "${id}" failed its shape verification: ${parsed.error.message}`,
      "ReviewSignal",
      id,
    );
  }
  const canonical = canonicalSignalJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw signalInvalid(
      `stored ad review signal row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "ReviewSignal.checksum",
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
    throw signalInvalid(
      `stored ad review signal row "${id}" is not valid JSON: ${detail}`,
      "ReviewSignal",
      id,
    );
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function signalAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsReviewSignalAbsent,
    reason:
      `no stored Ad Center review signal for id "${id}" — ` +
      "the signal was never appended; review signals arrive as-reported through ads.import and stay unaggregated (this order stores them verbatim)",
    retryable: false,
    context: { id },
  });
}
