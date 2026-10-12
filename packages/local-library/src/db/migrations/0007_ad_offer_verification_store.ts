import type { Migration } from "../migrate";

/**
 * 0007_ad_offer_verification_store — the durable OfferVerification table
 * (P5-VERIFY row 1, Phase-5 row 4: the ads.verify engine's append-only
 * read-outs).
 *
 * ADDITIVE ONLY: one new `ad_*` table; no existing table is touched, so a
 * pre-existing 0001–0006 store file applies this on its next open with all
 * data intact (the forward-only runner records the hash; there is no data
 * migration because no verification data existed before this order — the
 * ads lane had stores + claims + evidence edges, and verification runs are
 * minted by ads.verify from this order on).
 *
 * Same rules as 0002–0006 (the durable-seam precedent, the 0006 ads rules
 * verbatim in intent):
 *
 * - SEPARATION IS STRUCTURAL (phase5-ad-plan §3): this is the ads lane's
 *   OWN table — NO foreign key, column, or index reaches into any catalog
 *   or intelligence (`mi_*` / `library_*`) table, and the store never JOINs
 *   across the ad/intelligence boundary. Within the ads family, the
 *   reference is column-level and indexed ONLY where genuinely needed
 *   (verifications -> claims via `claim_id`): deliberately WITHOUT an SQL
 *   foreign-key constraint — integrity at the write boundary is enforced by
 *   the ads.verify use case through the domain invariant
 *   `validateOfferVerificationState` (the 0004/0005/0006 keyed-stores
 *   rule: a verification row may honestly outlive the claim row it
 *   verified — claims are put-replaced by later extraction runs — and
 *   stays readable; keyed stores are honest about what they key).
 * - CANONICAL JSON COLUMN: the full OfferVerification payload is stored
 *   canonically in `verification_json` (the round-trip source of truth);
 *   the typed columns (`claim_id`, `outcome`) exist for constraints,
 *   indexes, and honest debugging — never as a second source of the
 *   payload. A store-level FNV-1a identity checksum over the canonical
 *   payload lives in `checksum` and is re-verified on every read
 *   (tampering surfaces TYPED, the 0004–0006 rule).
 * - PER-PROFILE ISOLATION is structural (every adapter binds to one
 *   profile-scoped database handle, ADR-0003), so no profile column exists
 *   or belongs here.
 * - APPEND-ONLY BY VERIFICATION ID (the charter's rule): the store's write
 *   surface is an idempotent-by-id `append` — a stored id re-appends as a
 *   duplicate returning the STORED record, never a second row. There is no
 *   put, no delete: an OfferVerification is an immutable read-out of one
 *   check instant (the domain state machine: unchecked -> checked only; a
 *   re-verification is a NEW record with its own id).
 * - Deterministic listing order everywhere: (stored_at, id) — the
 *   audio-rendition / 0006 precedent; `idx_ad_offer_verifications_claim`
 *   orders one claim's verification history for the reading surface.
 */
export const migration0007AdOfferVerificationStore: Migration = {
  id: 7,
  name: "0007_ad_offer_verification_store",
  sql: `
CREATE TABLE IF NOT EXISTS ad_offer_verifications (
  id                  TEXT PRIMARY KEY,
  claim_id            TEXT NOT NULL,
  outcome             TEXT NOT NULL,
  checksum            TEXT NOT NULL,
  verification_json   TEXT NOT NULL,
  stored_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_offer_verifications_claim
  ON ad_offer_verifications (claim_id, stored_at, id);
`,
};
