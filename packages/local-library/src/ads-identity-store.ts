import { AdvertiserIdentitySchema, ErrorCode, WebFlixError } from "webflix-contracts";
import type { AdvertiserIdentity } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable AdvertiserIdentity store (P5-STORES row 2) on the local-library
 * storage seam — the source-reported identity REFERENCE TARGETS (the 0.8.0
 * shape), keyed by the identity's own id in the OWN `ad_identities` table
 * (additive migration 0006, the 0002–0005 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's AdvertiserIdentityStore (packages/webflix-application/src/ports.ts);
 * both sides are structurally typed, so this adapter satisfies the
 * application port without a cross-package dependency from this lane. The
 * composition root wires them in a later order (explicitly NOT this
 * order's scope).
 *
 * PUT-REPLACES (the record house semantic): identities are records, not
 * append-only facts — a re-put of the same id replaces the row wholesale
 * (a source re-reporting an identity updates it; the import seam's
 * id-stability check keeps an id from silently migrating between sources).
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004/0005 store rules, verbatim in intent):
 * - SHAPE validation on write AND read through the 0.8.0 schema — a shape
 *   violation surfaces as the typed `ads/record-invalid` WebFlixError (the
 *   code the contracts assign to AdvertiserIdentity defects at import/store
 *   boundaries), never as a silently-stored malformed identity;
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/identity-absent` error (never null, never a substitute) —
 *   the honest pre-import state, with re-import named as the recovery;
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the canonical
 *   payload is re-computed and compared on every read — a corrupt or
 *   tampered row surfaces as a TYPED `ads/record-invalid` error, never as
 *   silently-mangled identity facts (an identity checksum, not a
 *   cryptographic claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) — the audio-rendition
 *   precedent;
 * - no telemetry, no network, no randomness: the only stamp is the injected
 *   clock's epoch-ms (`stored_at`).
 */

/** Per-profile AdvertiserIdentity store (structural port mirror). */
export interface AdvertiserIdentityStorePort {
  /** Persists (or replaces wholesale) the identity for its id. */
  put(identity: AdvertiserIdentity): Promise<void>;
  /**
   * The stored identity; rejects with the typed `ads/identity-absent` error
   * when none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<AdvertiserIdentity>;
  /** All stored identities, deterministic (stored_at, id) order. */
  list(): Promise<readonly AdvertiserIdentity[]>;
}

export interface AdvertiserIdentityStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable AdvertiserIdentityStore: rows in `ad_identities`. */
export class SqliteAdvertiserIdentityStore implements AdvertiserIdentityStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: AdvertiserIdentityStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(identity: AdvertiserIdentity): Promise<void> {
    const parsed = parseIdentityShape(identity, "put");
    const canonical = canonicalIdentityJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_identities (id, source, checksum, identity_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET source = excluded.source, checksum = excluded.checksum, " +
          "identity_json = excluded.identity_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.source),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
  }

  async get(id: string): Promise<AdvertiserIdentity> {
    const row = this.db
      .prepare("SELECT id, checksum, identity_json FROM ad_identities WHERE id = ?")
      .get(toSqlParam(id));
    if (row === undefined) {
      throw identityAbsent(id);
    }
    return verifyStoredIdentity(row["id"], row["checksum"], row["identity_json"]);
  }

  async list(): Promise<readonly AdvertiserIdentity[]> {
    const rows = this.db
      .prepare("SELECT id, checksum, identity_json FROM ad_identities ORDER BY stored_at, id")
      .all();
    return rows.map((row) =>
      verifyStoredIdentity(row["id"], row["checksum"], row["identity_json"]),
    );
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the identity: fixed key order (id, source,
 * sourceAdvertiserId, names, regions, verificationState, reportedAt — the
 * schema's own declaration order), present keys only, no whitespace — the
 * byte-exact serialization the store round-trips through and checksums.
 */
function canonicalIdentityJson(identity: AdvertiserIdentity): string {
  return JSON.stringify({
    id: identity.id,
    source: identity.source,
    ...(identity.sourceAdvertiserId !== undefined
      ? { sourceAdvertiserId: identity.sourceAdvertiserId }
      : {}),
    ...(identity.names !== undefined ? { names: identity.names } : {}),
    ...(identity.regions !== undefined ? { regions: identity.regions } : {}),
    ...(identity.verificationState !== undefined
      ? { verificationState: identity.verificationState }
      : {}),
    ...(identity.reportedAt !== undefined ? { reportedAt: identity.reportedAt } : {}),
  });
}

/** The typed shape-violation error for the write path. */
function identityInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsRecordInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates an identity through the 0.8.0 schema (typed errors). */
function parseIdentityShape(input: unknown, path: string): AdvertiserIdentity {
  const parsed = AdvertiserIdentitySchema.safeParse(input);
  if (!parsed.success) {
    throw identityInvalid(
      `not a valid AdvertiserIdentity (${path}): ${parsed.error.message}`,
      "AdvertiserIdentity",
    );
  }
  return parsed.data;
}

/**
 * Parses the stored canonical-JSON column back into the identity and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled identity facts). The 0004/0005
 * parseStored precedent plus the integrity re-check.
 */
function verifyStoredIdentity(rawId: unknown, rawChecksum: unknown, rawJson: unknown) {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = AdvertiserIdentitySchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw identityInvalid(
      `stored ad identity row "${id}" failed its shape verification: ${parsed.error.message}`,
      "AdvertiserIdentity",
      id,
    );
  }
  const canonical = canonicalIdentityJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw identityInvalid(
      `stored ad identity row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "AdvertiserIdentity.checksum",
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
    throw identityInvalid(
      `stored ad identity row "${id}" is not valid JSON: ${detail}`,
      "AdvertiserIdentity",
      id,
    );
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function identityAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsIdentityAbsent,
    reason:
      `no stored Ad Center identity for id "${id}" — ` +
      "the identity was never imported or its row was explicitly removed; import it through ads.import to make it resolvable",
    retryable: false,
    context: { id },
  });
}
