import { EvidenceLinkSchema, ErrorCode, WebFlixError } from "webflix-contracts";
import type { EvidenceLink } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";
import { adsCanonicalChecksum } from "./ads-checksum";

/**
 * Durable EvidenceEdge store (P5-STORES row 2) on the local-library storage
 * seam — the evidence-graph EDGES (the 0.8.0 EvidenceLink discriminated
 * union: a claim linked to a source-reported fact / an independent review /
 * offer terms / a user-imported document, with the relationship and the
 * import provenance), keyed by the edge's own id in the OWN `ad_evidence_edges`
 * table (additive migration 0006, the 0002–0005 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's EvidenceEdgeStore (packages/webflix-application/src/ports.ts);
 * both sides are structurally typed, so this adapter satisfies the
 * application port without a cross-package dependency from this lane. The
 * composition root wires them in a later order (explicitly NOT this
 * order's scope).
 *
 * APPEND-ONLY (the charter's rule: evidence edges are append-only facts —
 * the store NEVER replaces or deletes): `append` is idempotent-by-id
 * check-then-insert (the 0002 FeedbackStore precedent) — re-appending a
 * stored id returns the STORED edge as a `duplicate`, never a second row,
 * and the idempotency survives restarts. There is NO put, NO delete, NO
 * clearAll in this module by design; correcting an edge means appending a
 * new edge with a new id (history is the point of an evidence graph).
 *
 * DIVISION OF HONESTY, stated plainly: this store persists EDGES AS DATA —
 * it validates the SHAPE (EvidenceLinkSchema) on append and read, and
 * nothing else. The REFERENTIAL checks (the edge's claim resolves; an
 * independent-review edge's review signal resolves) are the domain
 * invariant `validateEvidenceLinkReferential`, which the application layer
 * runs at ITS boundaries (P5-CLAIMS constructs evidence graphs over
 * imported records through it) — `ad_evidence_edges.claim_id` is
 * deliberately NOT a foreign key (an edge may honestly outlive its claim;
 * the 0004/0005 keyed-stores rule).
 *
 * The import seam (ads.import) does NOT import evidence edges this order
 * (the charter's batch is records + identities + claims + optional review
 * signals) — this store ships NOW because the charter's migration + store
 * scope covers every P5-CONTRACTS shape, and P5-CLAIMS builds on it.
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004/0005 store rules, verbatim in intent):
 * - SHAPE validation on append AND read through the 0.8.0 schema — a shape
 *   violation surfaces as the typed `ads/evidence-invalid` WebFlixError;
 * - ABSENCE IS TYPED: `get` on an id with no stored row rejects with the
 *   typed `ads/evidence-absent` error (never null, never a substitute);
 * - CHECKSUM ON READ: the row's FNV-1a identity checksum over the canonical
 *   payload is re-computed and compared on every read — a corrupt or
 *   tampered row surfaces TYPED (an identity checksum, not a cryptographic
 *   claim — see ads-checksum.ts);
 * - LISTING is deterministic: (stored_at, id) everywhere; the ATTACHMENT
 *   SURFACE `listByClaim` lists one claim's edges (the rendition
 *   listBySource precedent);
 * - no telemetry, no network, no randomness: the only stamp is the injected
 *   clock's epoch-ms (`stored_at`).
 */

/** Idempotent-append outcome (mirrors the application port's union). */
export type EvidenceEdgeAppendResult =
  | { readonly outcome: "appended"; readonly edge: EvidenceLink }
  /** Same id as a stored edge: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: EvidenceLink };

/** Per-profile EvidenceEdge store (structural port mirror). */
export interface EvidenceEdgeStorePort {
  /** Appends one edge; a stored id re-appends as a duplicate (idempotent). */
  append(edge: EvidenceLink): Promise<EvidenceEdgeAppendResult>;
  /**
   * The stored edge; rejects with the typed `ads/evidence-absent` error when
   * none was appended (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<EvidenceLink>;
  /** All stored edges, deterministic (stored_at, id) order. */
  list(): Promise<readonly EvidenceLink[]>;
  /**
   * The evidence edges attached to ONE claim, (stored_at, id) order — the
   * attachment surface. Empty when the claim has no edges (honest empty).
   */
  listByClaim(claimId: string): Promise<readonly EvidenceLink[]>;
}

export interface EvidenceEdgeStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable EvidenceEdgeStore: rows in `ad_evidence_edges`. */
export class SqliteEvidenceEdgeStore implements EvidenceEdgeStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: EvidenceEdgeStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async append(edge: EvidenceLink): Promise<EvidenceEdgeAppendResult> {
    const parsed = parseEdgeShape(edge, "append");
    const existing = readEdgeRow(this.db, parsed.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    const canonical = canonicalEdgeJson(parsed);
    this.db
      .prepare(
        "INSERT INTO ad_evidence_edges (id, claim_id, kind, checksum, edge_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        toSqlParam(parsed.id),
        toSqlParam(parsed.claimId),
        toSqlParam(parsed.kind),
        toSqlParam(adsCanonicalChecksum(canonical)),
        toSqlParam(canonical),
        toSqlParam(this.clock()),
      );
    return { outcome: "appended", edge: parsed };
  }

  async get(id: string): Promise<EvidenceLink> {
    const row = readEdgeRow(this.db, id);
    if (row === undefined) {
      throw evidenceAbsent(id);
    }
    return row;
  }

  async list(): Promise<readonly EvidenceLink[]> {
    const rows = this.db
      .prepare("SELECT id, checksum, edge_json FROM ad_evidence_edges ORDER BY stored_at, id")
      .all();
    return rows.map((row) => verifyStoredEdge(row["id"], row["checksum"], row["edge_json"]));
  }

  async listByClaim(claimId: string): Promise<readonly EvidenceLink[]> {
    const rows = this.db
      .prepare(
        "SELECT id, checksum, edge_json FROM ad_evidence_edges " +
          "WHERE claim_id = ? ORDER BY stored_at, id",
      )
      .all(toSqlParam(claimId));
    return rows.map((row) => verifyStoredEdge(row["id"], row["checksum"], row["edge_json"]));
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the edge: fixed key order per variant (kind, id,
 * claimId, relationship, the variant's own fields in schema declaration
 * order, provenance{source, observedAt, importedAt, importBatchId}), no
 * whitespace — the byte-exact serialization the store round-trips through
 * and checksums. The variant is discriminated by `kind`, so every branch is
 * exhaustive over the union.
 */
function canonicalEdgeJson(edge: EvidenceLink): string {
  const provenance = {
    source: edge.provenance.source,
    ...(edge.provenance.observedAt !== undefined ? { observedAt: edge.provenance.observedAt } : {}),
    importedAt: edge.provenance.importedAt,
    importBatchId: edge.provenance.importBatchId,
  };
  switch (edge.kind) {
    case "source-reported-fact":
      return JSON.stringify({
        kind: edge.kind,
        id: edge.id,
        claimId: edge.claimId,
        relationship: edge.relationship,
        url: edge.url,
        ...(edge.asReportedText !== undefined ? { asReportedText: edge.asReportedText } : {}),
        provenance,
      });
    case "independent-review":
      return JSON.stringify({
        kind: edge.kind,
        id: edge.id,
        claimId: edge.claimId,
        relationship: edge.relationship,
        reviewSignalId: edge.reviewSignalId,
        provenance,
      });
    case "offer-terms":
      return JSON.stringify({
        kind: edge.kind,
        id: edge.id,
        claimId: edge.claimId,
        relationship: edge.relationship,
        url: edge.url,
        ...(edge.declaredTermsExcerpt !== undefined
          ? { declaredTermsExcerpt: edge.declaredTermsExcerpt }
          : {}),
        provenance,
      });
    case "user-imported-document":
      return JSON.stringify({
        kind: edge.kind,
        id: edge.id,
        claimId: edge.claimId,
        relationship: edge.relationship,
        documentId: edge.documentId,
        provenance,
      });
  }
}

/** The typed shape-violation error for the append path. */
function evidenceInvalid(reason: string, subject: string, id?: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsEvidenceInvalid,
    reason,
    retryable: false,
    context: { subject, ...(id !== undefined ? { id } : {}) },
  });
}

/** Parses + validates an edge through the 0.8.0 schema (typed errors). */
function parseEdgeShape(input: unknown, path: string): EvidenceLink {
  const parsed = EvidenceLinkSchema.safeParse(input);
  if (!parsed.success) {
    throw evidenceInvalid(
      `not a valid EvidenceLink (${path}): ${parsed.error.message}`,
      "EvidenceLink",
    );
  }
  return parsed.data;
}

/** Reads and verifies one edge row by id; undefined when no row exists. */
function readEdgeRow(db: SqliteDatabase, id: string): EvidenceLink | undefined {
  const row = db
    .prepare("SELECT id, checksum, edge_json FROM ad_evidence_edges WHERE id = ?")
    .get(toSqlParam(id));
  if (row === undefined) {
    return undefined;
  }
  return verifyStoredEdge(row["id"], row["checksum"], row["edge_json"]);
}

/**
 * Parses the stored canonical-JSON column back into the edge and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled evidence).
 */
function verifyStoredEdge(rawId: unknown, rawChecksum: unknown, rawJson: unknown): EvidenceLink {
  const id = typeof rawId === "string" ? rawId : String(rawId);
  const storedChecksum = typeof rawChecksum === "string" ? rawChecksum : String(rawChecksum);
  const parsed = EvidenceLinkSchema.safeParse(parseRowJson(rawJson, id));
  if (!parsed.success) {
    throw evidenceInvalid(
      `stored ad evidence edge row "${id}" failed its shape verification: ${parsed.error.message}`,
      "EvidenceLink",
      id,
    );
  }
  const canonical = canonicalEdgeJson(parsed.data);
  const expected = adsCanonicalChecksum(canonical);
  if (storedChecksum !== expected) {
    throw evidenceInvalid(
      `stored ad evidence edge row "${id}" failed its checksum verification: row says ${storedChecksum}, ` +
        `payload hashes to ${expected} — the row is corrupt or was tampered with`,
      "EvidenceLink.checksum",
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
    throw evidenceInvalid(
      `stored ad evidence edge row "${id}" is not valid JSON: ${detail}`,
      "EvidenceLink",
      id,
    );
  }
}

/** The typed absent error (mirror of the application layer's factory). */
function evidenceAbsent(id: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.AdsEvidenceAbsent,
    reason:
      `no stored Ad Center evidence edge for id "${id}" — ` +
      "the edge was never appended; evidence edges are append-only facts constructed over imported claims (P5-CLAIMS builds the evidence graph on these stores)",
    retryable: false,
    context: { id },
  });
}
