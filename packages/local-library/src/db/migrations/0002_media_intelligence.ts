import type { Migration } from "../migrate";

/**
 * 0002_media_intelligence — durable MI stores (P4-ARTIFACTS row 1).
 *
 * ADDITIVE ONLY: three new `mi_*` tables + indexes; no existing table is
 * touched, so a pre-existing 0001-only store file applies this on its next
 * open with all library data intact (the forward-only runner records the
 * hash; there is no data migration because there was no MI data — the
 * stores were in-memory before this order).
 *
 * Original/derived separation is STRUCTURAL: derived-artifact descriptors
 * live in their own table (`mi_derived_artifacts`) with no mutable
 * reference into any original — `source_item_id` is a §2.1 catalog item id
 * (a DIFFERENT id universe from `library_entries`), so no foreign key into
 * the library tables exists or belongs here. The full contract objects are
 * stored canonically in the `*_json` columns (the round-trip source of
 * truth); the typed columns exist for constraints, indexes and honest
 * debugging, never as a second source of the payload.
 */
export const migration0002MediaIntelligence: Migration = {
  id: 2,
  name: "0002_media_intelligence",
  sql: `
CREATE TABLE IF NOT EXISTS mi_objectives (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  objective   TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mi_feedback_events (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('explicit', 'implicit')),
  kind        TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  event_json  TEXT NOT NULL,
  appended_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mi_feedback_events_item ON mi_feedback_events (item_id);
CREATE INDEX IF NOT EXISTS idx_mi_feedback_events_captured_at ON mi_feedback_events (captured_at);

CREATE TABLE IF NOT EXISTS mi_derived_artifacts (
  id             TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('transcript', 'summary', 'overview', 'translation', 'dubbing', 'qa')),
  created_at     TEXT NOT NULL,
  artifact_json  TEXT NOT NULL,
  stored_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mi_derived_artifacts_source ON mi_derived_artifacts (source_item_id);
CREATE INDEX IF NOT EXISTS idx_mi_derived_artifacts_created_at ON mi_derived_artifacts (created_at);
`,
};
