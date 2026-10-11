import { ErrorCode, RankerAdapterSelectionSchema, WebFlixError } from "webflix-contracts";
import type { RankerAdapterSelection } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";

/**
 * Durable ranker-adapter selection store (P4-ADAPTERS row 2) on the
 * local-library storage seam — the per-profile selection persisted in its
 * OWN `mi_ranker_selection` table (additive migration 0003, the 0002 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface below mirrors the shape of the application
 * layer's RankerSelectionStore (packages/webflix-application/src/
 * ranker-adapter-selection.ts); both sides are structurally typed, so this
 * adapter satisfies the application port without a cross-package dependency
 * from this lane. The composition root wires them in a later order
 * (explicitly NOT this order's scope).
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle — the same per-profile store the library's own
 * LocalStore uses (openStore with the profile's baseDir). One selection per
 * profile (the singleton row); no adapter ever crosses profiles.
 *
 * Honesty rules enforced here:
 * - SHAPE validation only, on write AND read: the record is re-checked
 *   through the locked RankerAdapterSelectionSchema — a corrupt or tampered
 *   row surfaces as a typed IntelligenceAdapterSelectionInvalid
 *   WebFlixError, never as a silently-mangled record;
 * - this store does NOT know the REGISTRY: registry-known validation is the
 *   set-time use case's job (application layer); an unknown-but-well-formed
 *   adapterId persists fine here and is resolved honestly (documented
 *   fail-soft) by resolveSelectedRanker at read time;
 * - `clear` deletes the selection (back to never-set) and reports whether
 *   one existed — deleting a selection resets to the documented default
 *   honestly, never an error state;
 * - no telemetry, no network, no randomness: the only stamp is the injected
 *   clock's epoch-ms (`stored_at`); `selected_at` is the contract record's
 *   own explicit provenance instant (stamped by the set-time use case, never
 *   invented here).
 */

/** Per-profile ranker-adapter selection store (structural port mirror). */
export interface RankerSelectionStorePort {
  /** The stored selection, or null when the user never set one. */
  get(): Promise<RankerAdapterSelection | null>;
  /** Replaces the selection wholesale (the CURRENT choice). */
  put(selection: RankerAdapterSelection): Promise<void>;
  /** Deletes the selection; true when one existed. */
  clear(): Promise<boolean>;
}

export interface RankerSelectionStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable RankerSelectionStore: the singleton row in `mi_ranker_selection`. */
export class SqliteRankerSelectionStore implements RankerSelectionStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: RankerSelectionStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async get(): Promise<RankerAdapterSelection | null> {
    const row = this.db
      .prepare("SELECT selection_json FROM mi_ranker_selection WHERE id = 1")
      .get();
    if (row === undefined) return null;
    return parseStoredSelection(row["selection_json"]);
  }

  async put(selection: RankerAdapterSelection): Promise<void> {
    const validated = parseOrThrow(
      RankerAdapterSelectionSchema,
      selection,
      ErrorCode.IntelligenceAdapterSelectionInvalid,
      "RankerAdapterSelection",
    );
    this.db
      .prepare(
        "INSERT INTO mi_ranker_selection (id, adapter_id, selected_at, selection_json, stored_at) " +
          "VALUES (1, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET adapter_id = excluded.adapter_id, selected_at = excluded.selected_at, " +
          "selection_json = excluded.selection_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(validated.adapterId),
        toSqlParam(validated.selectedAt),
        toSqlParam(JSON.stringify(validated)),
        toSqlParam(this.clock()),
      );
  }

  async clear(): Promise<boolean> {
    return this.db.prepare("DELETE FROM mi_ranker_selection WHERE id = 1").run().changes > 0;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Parses the stored canonical-JSON column back through the locked schema —
 * corrupt or tampered rows surface as typed WebFlixErrors (never silently
 * mangled contract records). Mirrors the 0002 parseStored precedent.
 */
function parseStoredSelection(raw: unknown): RankerAdapterSelection {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new WebFlixError({
      code: ErrorCode.IntelligenceAdapterSelectionInvalid,
      reason: `stored ranker-adapter selection row is not valid JSON: ${detail}`,
      retryable: false,
      context: {
        subject: "RankerAdapterSelection",
        stored: typeof raw === "string" ? raw.slice(0, 120) : raw,
      },
    });
  }
  return parseOrThrow(
    RankerAdapterSelectionSchema,
    parsedJson,
    ErrorCode.IntelligenceAdapterSelectionInvalid,
    "RankerAdapterSelection",
  );
}
