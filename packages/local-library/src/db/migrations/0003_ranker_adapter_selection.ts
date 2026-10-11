import type { Migration } from "../migrate";

/**
 * 0003_ranker_adapter_selection — the durable per-profile ranker-adapter
 * selection (P4-ADAPTERS row 2), on the established MI seam.
 *
 * ADDITIVE ONLY: one new `mi_*` table; no existing table is touched, so a
 * pre-existing 0001/0002 store file applies this on its next open with all
 * data intact (forward-only runner records the hash; there is no data
 * migration because there was no persisted selection before this order —
 * selection did not exist).
 *
 * Same rules as 0002 (the durable-seam precedent): the full contract record
 * is stored canonically in `selection_json` (the round-trip source of
 * truth); the typed columns exist for constraints and honest debugging,
 * never as a second source of the payload. A SINGLETON row (id = 1, the
 * mi_objectives pattern): one selection per profile — per-profile isolation
 * is structural (every adapter binds to one profile-scoped database handle,
 * ADR-0003), so no profile column exists or belongs here. No FK into any
 * original: `adapter_id` references the application layer's REGISTRY (a
 * build-time concept), not a row in this database — registry-known
 * validation is the set-time use case's job; drift at resolve time is the
 * application layer's documented fail-soft, and a corrupt row here surfaces
 * as a typed WebFlixError on read.
 */
export const migration0003RankerAdapterSelection: Migration = {
  id: 3,
  name: "0003_ranker_adapter_selection",
  sql: `
CREATE TABLE IF NOT EXISTS mi_ranker_selection (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  adapter_id      TEXT NOT NULL,
  selected_at     TEXT NOT NULL,
  selection_json  TEXT NOT NULL,
  stored_at       INTEGER NOT NULL
);
`,
};
