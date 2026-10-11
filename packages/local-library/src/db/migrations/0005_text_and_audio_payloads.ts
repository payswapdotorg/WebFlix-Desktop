import type { Migration } from "../migrate";

/**
 * 0005_text_and_audio_payloads — the durable TEXT payloads for non-
 * transcript derived artifacts + the AUDIO renditions attached to source
 * artifacts (P4-TRANSLATE row 2: the translation/TTS pipeline's payload
 * stores — the dispatch commit's "migration 0005 payload stores", plural).
 *
 * ADDITIVE ONLY: two new `mi_*` tables; no existing table is touched, so a
 * pre-existing 0001–0004 store file applies this on its next open with all
 * data intact (the forward-only runner records the hash; there is no data
 * migration because there were no persisted text projections or audio
 * renditions before this order).
 *
 * Same rules as 0002/0003/0004 (the durable-seam precedent), with ONE
 * honestly-documented deviation:
 *
 * - `mi_text_payloads` follows the 0004 pattern verbatim: the full payload
 *   record (`artifactId`, `kind`, `text`, optional `languageTag`,
 *   `checksum`) is stored canonically in `payload_json` (the round-trip
 *   source of truth); the typed columns exist for constraints and honest
 *   debugging, never as a second source of the payload. `artifact_id` keys
 *   a derived-artifact registry id — deliberately WITHOUT a foreign key
 *   into `mi_derived_artifacts` (the store does not know the registry; a
 *   payload row may outlive its descriptor and stays readable — keyed
 *   stores are honest about what they key).
 * - `mi_audio_renditions` stores the rendition's STRUCTURED record
 *   (`renditionId`, `sourceArtifactId`, `engineId`, optional
 *   `engineVersion`/`modelLineage`, `voiceId`, `inputsHash`, `contentType`,
 *   `byteLength`, `createdAt`) canonically in `metadata_json` AND the audio
 *   bytes in a BLOB column — the honest deviation: the 0004
 *   canonical-JSON rule covers JSON-shaped payloads, and BYTES are not
 *   JSON-shaped; a BLOB is the canonical form of bytes (base64-wrapping
 *   them into JSON would inflate every row ~33% to feed no check). The
 *   BLOB is the rendition's audio source of truth; `byte_length` is a
 *   constraint/debugging column verified on read (a mismatched row surfaces
 *   typed, exactly like a checksum mismatch). `source_artifact_id` +
 *   `rendition_id` are indexed for the by-source listing; `rendition_id`
 *   is the primary key; there is NO foreign key into the registry or the
 *   originals (a rendition may honestly outlive its source descriptor).
 *
 * Per-profile isolation is structural (every adapter binds to one
 * profile-scoped database handle, ADR-0003), so no profile column exists
 * or belongs here.
 */
export const migration0005TextAndAudioPayloads: Migration = {
  id: 5,
  name: "0005_text_and_audio_payloads",
  sql: `
CREATE TABLE IF NOT EXISTS mi_text_payloads (
  artifact_id   TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  language_tag  TEXT,
  checksum      TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  stored_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mi_audio_renditions (
  rendition_id       TEXT PRIMARY KEY,
  source_artifact_id TEXT NOT NULL,
  engine_id          TEXT NOT NULL,
  engine_version     TEXT,
  model_lineage      TEXT,
  voice_id           TEXT NOT NULL,
  inputs_hash        TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  byte_length        INTEGER NOT NULL,
  metadata_json      TEXT NOT NULL,
  audio              BLOB NOT NULL,
  stored_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mi_audio_renditions_source
  ON mi_audio_renditions (source_artifact_id, stored_at, rendition_id);
`,
};
