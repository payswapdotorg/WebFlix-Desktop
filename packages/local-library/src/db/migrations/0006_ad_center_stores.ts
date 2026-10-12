import type { Migration } from "../migrate";

/**
 * 0006_ad_center_stores — the durable Ad Center tables (P5-STORES row 1,
 * Phase-5 row 2: every P5-CONTRACTS shape this order persists gets its OWN
 * `ad_*` table).
 *
 * ADDITIVE ONLY: five new `ad_*` tables; no existing table is touched, so a
 * pre-existing 0001–0005 store file applies this on its next open with all
 * data intact (the forward-only runner records the hash; there is no data
 * migration because no Ad Center data existed before this order — the ads
 * lane had shapes and invariants only).
 *
 * Same rules as 0002–0005 (the durable-seam precedent), with the
 * separation rule stated structurally:
 *
 * - SEPARATION IS STRUCTURAL (phase5-ad-plan §3): these are the ads lane's
 *   OWN tables — NO foreign key, column, or index reaches into any catalog
 *   or intelligence (`mi_*` / `library_*`) table, and the stores never JOIN
 *   across the ad/intelligence boundary. Within the ads family, references
 *   are column-level and indexed ONLY where genuinely needed (claims ->
 *   records via `ad_record_id`; evidence edges -> claims via `claim_id`):
 *   deliberately WITHOUT SQL foreign-key constraints — integrity at the
 *   write boundary is enforced by the import seam through the domain
 *   invariants (the 0004/0005 keyed-stores rule: a claim row may honestly
 *   outlive the record row it was extracted from — record replacement
 *   deletes the replaced row — and stays readable; keyed stores are honest
 *   about what they key).
 * - CANONICAL JSON COLUMNS: the full shape payload is stored canonically
 *   in the `*_json` column (the round-trip source of truth); the typed
 *   columns exist for constraints, indexes, and honest debugging — never
 *   as a second source of the payload. A store-level FNV-1a identity
 *   checksum over the canonical payload lives in `checksum` and is
 *   re-verified on every read (tampering surfaces TYPED, the 0004/0005
 *   rule).
 * - PER-PROFILE ISOLATION is structural (every adapter binds to one
 *   profile-scoped database handle, ADR-0003), so no profile column exists
 *   or belongs here.
 * - Deterministic listing order everywhere: (stored_at, id) — the
 *   audio-rendition precedent; `idx_ad_records_source_ad` additionally
 *   orders the version history of one source-reported ad
 *   (source, source_ad_id) for the import seam's replace/append decision.
 * - `source_ad_id` is NULL when the source reports no ad id (honest
 *   absent, never a placeholder): such records carry no matchable source
 *   identity, and the import seam performs NO dedup magic on them.
 */
export const migration0006AdCenterStores: Migration = {
  id: 6,
  name: "0006_ad_center_stores",
  sql: `
CREATE TABLE IF NOT EXISTS ad_identities (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  identity_json TEXT NOT NULL,
  stored_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ad_records (
  id                     TEXT PRIMARY KEY,
  source                 TEXT NOT NULL,
  source_ad_id           TEXT,
  advertiser_identity_id TEXT NOT NULL,
  import_batch_id        TEXT NOT NULL,
  checksum               TEXT NOT NULL,
  record_json            TEXT NOT NULL,
  stored_at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_records_source_ad
  ON ad_records (source, source_ad_id, stored_at, id);
CREATE TABLE IF NOT EXISTS ad_claims (
  id           TEXT PRIMARY KEY,
  ad_record_id TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  claim_json   TEXT NOT NULL,
  stored_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_claims_record
  ON ad_claims (ad_record_id, stored_at, id);
CREATE TABLE IF NOT EXISTS ad_evidence_edges (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL,
  kind         TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  edge_json    TEXT NOT NULL,
  stored_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_evidence_edges_claim
  ON ad_evidence_edges (claim_id, stored_at, id);
CREATE TABLE IF NOT EXISTS ad_review_signals (
  id           TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  signal_json  TEXT NOT NULL,
  stored_at    INTEGER NOT NULL
);
`,
};
