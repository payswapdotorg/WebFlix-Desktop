import type { Migration } from "../migrate";

/**
 * 0004_transcript_payloads — the durable transcript segment payloads
 * (P4-SUMMARIZE row 1: the P4-TRANSCRIBE recorded adjacency resolved).
 *
 * ADDITIVE ONLY: one new `mi_*` table; no existing table is touched, so a
 * pre-existing 0001/0002/0003 store file applies this on its next open with
 * all data intact (the forward-only runner records the hash; there is no
 * data migration because there was no persisted payload before this order —
 * transcript segment payloads lived only in the job result).
 *
 * Same rules as 0002/0003 (the durable-seam precedent): the full payload
 * record (`artifactId`, `segments`, `checksum`) is stored canonically in
 * `payload_json` (the round-trip source of truth); the typed columns exist
 * for constraints and honest debugging, never as a second source of the
 * payload. `artifact_id` keys the TRANSCRIPT artifact id — an id from the
 * derived-artifact registry (a different id universe from `library_entries`
 * and deliberately WITHOUT a foreign key into `mi_derived_artifacts`: the
 * payload store does not know the registry; a payload row may outlive its
 * descriptor through explicit descriptor deletion, and it stays readable —
 * keyed stores are honest about what they key). Per-profile isolation is
 * structural (every adapter binds to one profile-scoped database handle,
 * ADR-0003), so no profile column exists or belongs here.
 */
export const migration0004TranscriptPayloads: Migration = {
  id: 4,
  name: "0004_transcript_payloads",
  sql: `
CREATE TABLE IF NOT EXISTS mi_transcript_payloads (
  artifact_id   TEXT PRIMARY KEY,
  segment_count INTEGER NOT NULL,
  checksum      TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  stored_at     INTEGER NOT NULL
);
`,
};
