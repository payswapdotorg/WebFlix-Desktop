import { ErrorCode, OfferVerificationSchema, WebFlixError } from "webflix-contracts";
import type { OfferVerification } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable OfferVerification store (P5-VERIFY row 1) on the local-library
 * storage seam — the ads.verify engine's read-outs (the 0.8.0 shape: WHAT
 * was checked via `claimId`, against WHICH declared sources via
 * `declaredSources`, WHEN via `checkedAt`, and the TYPED `outcome`), keyed
 * by the verification's own id in the OWN `ad_offer_verifications` table
 * (additive migration 0007, the 0002–0006 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's OfferVerificationStore (packages/webflix-application/src/ports.ts);
 * both sides are structurally typed, so this adapter satisfies the
 * application port without a cross-package dependency from this lane. The
 * composition root wires them in a later order (explicitly NOT this
 * order's scope).
 *
 * APPEND-ONLY BY VERIFICATION ID (the charter's rule: a verification is an
 * immutable read-out of ONE check instant — the domain state machine
 * allows only unchecked -> checked transitions within a record, and a
 * re-verification is a NEW record with its own id, so the store NEVER
 * replaces or deletes): `append` is idempotent-by-id check-then-insert
 * (the 0002 FeedbackStore / 0006 edge+signal precedent) — re-appending a
 * stored id returns the STORED verification as a `duplicate`, never a
 * second row, and the idempotency survives restarts. There is NO put, NO
 * delete, NO clearAll in this module by design.
 *
 * DIVISION OF HONESTY, stated plainly: this store persists verifications
 * AS DATA — it validates the SHAPE (OfferVerificationSchema) on append and
 * read, and nothing else. The STATE-MACHINE legality (unchecked records
 * are bare; checked records carry their full evidence list and check
 * instant) is the domain invariant `validateOfferVerificationState`, which
 * the application layer's ads.verify use case runs at ITS boundary over
 * every record BEFORE appending — `ad_offer_verifications.claim_id` is
 * deliberately NOT a foreign key (a verification row may honestly outlive
 * its claim row; the 0004/0005/0006 keyed-stores rule).
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE
 * profile-scoped SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004–0006 store rules, verbatim in
 * intent):
 * - SHAPE validation on append AND read through the 0.8.0 schema — a
 *   shape violation surfaces as the typed `ads/verification-invalid`
 *   WebFlixError;
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/verification-absent` error (never null, never a
 *   substitute; the 0.10.0 code this store shipped with);
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the
 *   canonical payload is re-computed and compared on every read — a
 *   corrupt or tampered row surfaces TYPED (an identity checksum, not a
 *   cryptographic claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) everywhere; the ATTACHMENT
 *   SURFACE `listByClaim` lists one claim's verification history (the
 *   evidence-edge listByClaim precedent);
 * - no telemetry, no network, no randomness: the only stamp is the
 *   injected clock's epoch-ms (`stored_at`).
 */

/** Idempotent-append outcome (mirrors the application port's union). */
export type OfferVerificationAppendResult =
  | { readonly outcome: "appended"; readonly verification: OfferVerification }
  /** Same id as a stored verification: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: OfferVerification };

/** Per-profile OfferVerification store (structural port mirror). */
export interface OfferVerificationStorePort {
  /** Appends one verification; a stored id re-appends as a duplicate. */
  append(verification: OfferVerification): Promise<OfferVerificationAppendResult>;
  /**
   * The stored verification; rejects with the typed
   * `ads/verification-absent` error when none was appended (never null —
   * absence is typed and surfaced).
   */
  get(id: string): Promise<OfferVerification>;
  /** All stored verifications, deterministic (stored_at, id) order. */
  list(): Promise<readonly OfferVerification[]>;
  /**
   * The verification history of ONE claim, (stored_at, id) order — the
   * attachment surface. Empty when the claim has none (honest empty).
   */
  listByClaim(claimId: string): Promise<readonly OfferVerification[]>;
}

export interface OfferVerificationStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable OfferVerificationStore: rows in `ad_offer_verifications`. */
export class SqliteOfferVerificationStore implements OfferVerificationStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: OfferVerificationStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async append(verification: OfferVerification): Promise<OfferVerificationAppendResult> {
    const parsed = parseVerificationShape(verification, "append");
    const existing = readVerificationRow(this.db, parsed.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    const canonical = canonicalVerificationJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_offer_verifications (id, claim_id, outcome, checksum, verification_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.claimId),
        toSqlParam(parsed.outcome),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
    return { outcome: "appended", verification: parsed };
  }

  async get(id: string): Promise<OfferVerification> {
    const row = readVerificationRow(this.db, id);
    if (row === undefined) {
      throw verificationAbsent(id);
    }
    return row;
  }

  async list(): Promise<readonly OfferVerification[]> {
    const rows = this.db
      .prepare(
        "SELECT id, checksum, verification_json FROM ad_offer_verifications ORDER BY stored_at, id",
      )
      .all();
    return rows.map((row) =>
      verifyStoredVerification(row["id"], row["checksum"], row["verification_json"]),
    );
  }

  async listByClaim(claimId: string): Promise<readonly OfferVerification[]> {
    const rows = this.db
      .prepare(
        "SELECT id, checksum, verification_json FROM ad_offer_verifications " +
          "WHERE claim_id = ? ORDER BY stored_at, id",
      )
      .all(toSqlParam(claimId));
    return rows.map((row) =>
      verifyStoredVerification(row["id"], row["checksum"], row["verification_json"]),
    );
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the verification: fixed key order (id, claimId,
 * declaredSources?, checkedAt?, outcome — the schema's own declaration
 * order; each VerificationSource as {source, url?, asReported?}), present
 * keys only, no whitespace — the byte-exact serialization the store
 * round-trips through and checksums.
 */
function canonicalVerificationJson(verification: OfferVerification): string {
  return JSON.stringify({
    id: verification.id,
    claimId: verification.claimId,
    ...(verification.declaredSources !== undefined
      ? {
          declaredSources: verification.declaredSources.map((declared) => ({
            source: declared.source,
            ...(declared.url !== undefined ? { url: declared.url } : {}),
            ...(declared.asReported !== undefined ? { asReported: declared.asReported } : {}),
          })),
        }
      : {}),
    ...(verification.checkedAt !== undefined ? { checkedAt: verification.checkedAt } : {}),
    outcome: verification.outcome,
  });
}

/** The typed shape-violation error for the append path. */
function verificationInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsVerificationInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates a verification through the 0.8.0 schema (typed). */
function parseVerificationShape(input: unknown, path: string): OfferVerification {
  const parsed = OfferVerificationSchema.safeParse(input);
  if (!parsed.success) {
    throw verificationInvalid(
      `not a valid OfferVerification (${path}): ${parsed.error.message}`,
      "OfferVerification",
    );
  }
  return parsed.data;
}

/** Reads and verifies one verification row by id; undefined when no row. */
function readVerificationRow(db: SqliteDatabase, id: string): OfferVerification | undefined {
  const row = db
    .prepare("SELECT id, checksum, verification_json FROM ad_offer_verifications WHERE id = ?")
    .get(toSqlParam(id));
  if (row === undefined) {
    return undefined;
  }
  return verifyStoredVerification(row["id"], row["checksum"], row["verification_json"]);
}

/**
 * Parses the stored canonical-JSON column back into the verification and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled read-outs).
 */
function verifyStoredVerification(
  rawId: unknown,
  rawChecksum: unknown,
  rawJson: unknown,
): OfferVerification {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = OfferVerificationSchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw verificationInvalid(
      `stored ad offer verification row "${id}" failed its shape verification: ${parsed.error.message}`,
      "OfferVerification",
      id,
    );
  }
  const canonical = canonicalVerificationJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw verificationInvalid(
      `stored ad offer verification row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "OfferVerification.checksum",
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
    throw verificationInvalid(
      `stored ad offer verification row "${id}" is not valid JSON: ${detail}`,
      "OfferVerification",
      id,
    );
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function verificationAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsVerificationAbsent,
    reason:
      `no stored Ad Center offer verification for id "${id}" — ` +
      "no ads.verify run ever appended it; run ads.verify over the claim to mint the check's read-out (verifications are append-only records of check instants, never invented)",
    retryable: false,
    context: { id },
  });
}
