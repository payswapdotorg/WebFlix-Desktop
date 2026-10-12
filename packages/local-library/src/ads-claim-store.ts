import { ClaimSchema, ErrorCode, WebFlixError } from "webflix-contracts";
import type { Claim } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable Claim store (P5-STORES row 2) on the local-library storage seam —
 * the EXTRACTIVE claim spans (the 0.8.0 shape: a verbatim quoted span of an
 * ad record's own creative text with its UTF-16 offsets), keyed by the
 * claim's own id in the OWN `ad_claims` table (additive migration 0006, the
 * 0002–0005 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's ClaimStore (packages/webflix-application/src/ports.ts); both sides
 * are structurally typed, so this adapter satisfies the application port
 * without a cross-package dependency from this lane. The composition root
 * wires them in a later order (explicitly NOT this order's scope).
 *
 * DIVISION OF HONESTY, stated plainly: this store persists CLAIMS AS DATA —
 * it validates the SHAPE (ClaimSchema) on write and read, and nothing else.
 * The EXTRACTIVE discipline (offsets within the referenced record's
 * creative text, quote byte-equal to the offset window) is the domain
 * invariant `validateClaimOffsets`, which the APPLICATION layer's ads.import
 * seam runs against the referenced record BEFORE persisting — this lane
 * does not import webflix-domain for claims (the store keys rows, the seam
 * validates references; a claim row may honestly outlive the record it was
 * extracted from through record replacement and stays readable — the
 * 0004/0005 keyed-stores rule, `ad_claims.ad_record_id` is deliberately NOT
 * a foreign key).
 *
 * PUT-REPLACES BY ID (the record house semantic): claims are not append-only
 * facts — a re-put of the same id replaces the row wholesale (the id is the
 * idempotency key; the import seam's adRecordId-stability check keeps an id
 * from silently re-pointing at a different record). The ATTACHMENT SURFACE
 * `listByAdRecordId` lists one record's claims in (stored_at, id) order (the
 * rendition listBySource precedent — P5-CLAIMS reads it when building
 * evidence graphs over imported records).
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004/0005 store rules, verbatim in intent):
 * - SHAPE validation on write AND read through the 0.8.0 schema — a shape
 *   violation surfaces as the typed `ads/claim-invalid` WebFlixError;
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/claim-absent` error (never null, never a substitute);
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the canonical
 *   payload is re-computed and compared on every read — a corrupt or
 *   tampered row surfaces TYPED (an identity checksum, not a cryptographic
 *   claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) everywhere;
 * - no telemetry, no network, no randomness: the only stamp is the injected
 *   clock's epoch-ms (`stored_at`).
 */

/** Per-profile Claim store (structural port mirror). */
export interface ClaimStorePort {
  /** Persists (or replaces wholesale) the claim for its id. */
  put(claim: Claim): Promise<void>;
  /**
   * The stored claim; rejects with the typed `ads/claim-absent` error when
   * none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<Claim>;
  /** All stored claims, deterministic (stored_at, id) order. */
  list(): Promise<readonly Claim[]>;
  /**
   * The claims extracted from ONE ad record, (stored_at, id) order — the
   * attachment surface. Empty when the record has no stored claims
   * (honest empty).
   */
  listByAdRecordId(adRecordId: string): Promise<readonly Claim[]>;
}

export interface ClaimStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable ClaimStore: rows in `ad_claims`. */
export class SqliteClaimStore implements ClaimStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: ClaimStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(claim: Claim): Promise<void> {
    const parsed = parseClaimShape(claim, "put");
    const canonical = canonicalClaimJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_claims (id, ad_record_id, checksum, claim_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET ad_record_id = excluded.ad_record_id, " +
          "checksum = excluded.checksum, claim_json = excluded.claim_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.adRecordId),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
  }

  async get(id: string): Promise<Claim> {
    const row = this.db
      .prepare("SELECT id, checksum, claim_json FROM ad_claims WHERE id = ?")
      .get(toSqlParam(id));
    if (row === undefined) {
      throw claimAbsent(id);
    }
    return verifyStoredClaim(row["id"], row["checksum"], row["claim_json"]);
  }

  async list(): Promise<readonly Claim[]> {
    const rows = this.db
      .prepare("SELECT id, checksum, claim_json FROM ad_claims ORDER BY stored_at, id")
      .all();
    return rows.map((row) => verifyStoredClaim(row["id"], row["checksum"], row["claim_json"]));
  }

  async listByAdRecordId(adRecordId: string): Promise<readonly Claim[]> {
    const rows = this.db
      .prepare(
        "SELECT id, checksum, claim_json FROM ad_claims " +
          "WHERE ad_record_id = ? ORDER BY stored_at, id",
      )
      .all(toSqlParam(adRecordId));
    return rows.map((row) => verifyStoredClaim(row["id"], row["checksum"], row["claim_json"]));
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the claim: fixed key order (id, adRecordId, quote,
 * startOffset, endOffset — the schema's own declaration order), no
 * whitespace — the byte-exact serialization the store round-trips through
 * and checksums.
 */
function canonicalClaimJson(claim: Claim): string {
  return JSON.stringify({
    id: claim.id,
    adRecordId: claim.adRecordId,
    quote: claim.quote,
    startOffset: claim.startOffset,
    endOffset: claim.endOffset,
  });
}

/** The typed shape-violation error for the write path. */
function claimInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsClaimInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates a claim through the 0.8.0 schema (typed errors). */
function parseClaimShape(input: unknown, path: string): Claim {
  const parsed = ClaimSchema.safeParse(input);
  if (!parsed.success) {
    throw claimInvalid(`not a valid Claim (${path}): ${parsed.error.message}`, "Claim");
  }
  return parsed.data;
}

/**
 * Parses the stored canonical-JSON column back into the claim and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled claims).
 */
function verifyStoredClaim(rawId: unknown, rawChecksum: unknown, rawJson: unknown): Claim {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = ClaimSchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw claimInvalid(
      `stored ad claim row "${id}" failed its shape verification: ${parsed.error.message}`,
      "Claim",
      id,
    );
  }
  const canonical = canonicalClaimJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw claimInvalid(
      `stored ad claim row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "Claim.checksum",
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
    throw claimInvalid(`stored ad claim row "${id}" is not valid JSON: ${detail}`, "Claim", id);
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function claimAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsClaimAbsent,
    reason:
      `no stored Ad Center claim for id "${id}" — ` +
      "the claim was never imported or its row was explicitly removed; claims arrive as extracted spans through ads.import (P5-CLAIMS builds the extraction engine on these stores)",
    retryable: false,
    context: { id },
  });
}
