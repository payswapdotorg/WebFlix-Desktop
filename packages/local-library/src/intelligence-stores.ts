import {
  DerivedArtifactSchema,
  ErrorCode,
  FeedbackEventSchema,
  UserObjectiveSchema,
  WebFlixError,
} from "webflix-contracts";
import type { CatalogItem, DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import { parseOrThrow, validateDerivedArtifactLineage } from "webflix-domain";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";

/**
 * Durable media-intelligence stores on the local-library storage seam
 * (P4-ARTIFACTS row 1): ObjectiveStore, FeedbackStore and ArtifactRegistry
 * adapters over the migration-managed `mi_*` tables (0002_media_intelligence).
 *
 * PORT MIRROR NOTE (the LocalStorePort precedent, verbatim in spirit): the
 * port interfaces below mirror the shape of the application layer's MI ports
 * (packages/webflix-application/src/ports.ts); because both sides are
 * structurally typed, these adapters satisfy the application ports without
 * introducing a cross-package dependency from this lane. The composition
 * root wires them in a later order (explicitly NOT this order's scope).
 *
 * Per-profile isolation (ADR-0003): every adapter binds to ONE
 * profile-scoped SqliteDatabase handle — the same per-profile store the
 * library's own LocalStore uses (openStore with the profile's baseDir). No
 * adapter ever crosses profiles; isolation is structural.
 *
 * Honesty rules enforced here:
 * - ids are the idempotency keys: append is check-then-insert keyed by the
 *   event id, so a re-append of a stored id returns the STORED event
 *   (duplicate), never a second row — and the idempotency SURVIVES restarts;
 * - nothing validates user INTENT: these stores persist what the validated
 *   use-cases hand over (shapes are re-checked defensively on write and on
 *   read — a corrupt/tampered row surfaces as a typed WebFlixError, never
 *   as a silently-mangled contract object);
 * - deletion is EXPLICIT and per-profile (Row 2): individual delete,
 *   clear-all, and deleteBySource for artifacts. Deleting an original
 *   (wherever that happens — catalog deletion is not this lane's call)
 *   NEVER silently cascades into deleting derived artifacts: they stay
 *   stored and are listed with an explicit `dangling` lineage marker via
 *   listWithLineage (the documented choice — marker at list, never silent
 *   hiding and never rejection at read);
 * - no telemetry, no network, no randomness: the only stamps are the
 *   injected clock's epoch-ms (appended_at/stored_at/updated_at) and the
 *   contract objects' own timestamps.
 */

// ---------------------------------------------------------------------------
// Ports — structural mirrors of the application layer's MI ports
// ---------------------------------------------------------------------------

/** Idempotent-append outcome (mirrors the application port's union). */
export type FeedbackAppendResult =
  | { readonly outcome: "appended"; readonly event: FeedbackEvent }
  /** Same id as a stored event: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: FeedbackEvent };

/** Per-profile objective store (put replaces wholesale — current goals only). */
export interface ObjectiveStorePort {
  get(): Promise<UserObjective | null>;
  put(objective: UserObjective): Promise<void>;
}

/** Per-profile feedback store with idempotent-append-by-event-id semantics. */
export interface FeedbackStorePort {
  append(event: FeedbackEvent): Promise<FeedbackAppendResult>;
  get(id: string): Promise<FeedbackEvent | null>;
  list(): Promise<readonly FeedbackEvent[]>;
}

/** Per-profile derived-artifact descriptor registry (descriptors ONLY). */
export interface ArtifactRegistryPort {
  put(descriptor: DerivedArtifact): Promise<void>;
  get(id: string): Promise<DerivedArtifact | null>;
  list(): Promise<readonly DerivedArtifact[]>;
}

/** Retention surface (P4-ARTIFACTS row 2): user data is deletable, per profile. */
export interface DurableObjectiveStore extends ObjectiveStorePort {
  /** Deletes the current objective (back to never-set); true when one existed. */
  clear(): Promise<boolean>;
}

export interface DurableFeedbackStore extends FeedbackStorePort {
  /** Deletes one event by id; true when it existed. */
  delete(id: string): Promise<boolean>;
  /** Clear-all per profile; returns the number of events removed. */
  clearAll(): Promise<number>;
}

/**
 * Lineage status of a stored descriptor against a catalog snapshot:
 * `attached` when its source resolves; `dangling` (with the unresolved
 * source id) when the original is gone from the snapshot. Dangling
 * descriptors are still LISTED — never hidden, never auto-deleted.
 */
export type ArtifactLineageStatus =
  | { readonly descriptor: DerivedArtifact; readonly lineage: "attached" }
  | {
      readonly descriptor: DerivedArtifact;
      readonly lineage: "dangling";
      readonly sourceItemId: string;
    };

export interface DurableArtifactRegistry extends ArtifactRegistryPort {
  /** Deletes one descriptor by id; true when it existed. */
  delete(id: string): Promise<boolean>;
  /** Clear-all per profile; returns the number of descriptors removed. */
  clearAll(): Promise<number>;
  /**
   * EXPLICIT bulk deletion for one original's derivations — an API the
   * original-deletion flow can offer the user as a CHOICE; nothing in this
   * package ever calls it implicitly (no silent cascades). Returns the count.
   */
  deleteBySource(sourceItemId: string): Promise<number>;
  /**
   * Lists every descriptor with its lineage status against `catalog`
   * (domain authority: sources resolve through schema-valid catalog entries
   * only). This is the documented dangling-policy surface: marker at list.
   */
  listWithLineage(catalog: readonly CatalogItem[]): Promise<readonly ArtifactLineageStatus[]>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IntelligenceStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// SqliteObjectiveStore
// ---------------------------------------------------------------------------

/** Durable ObjectiveStore: the singleton row in `mi_objectives`. */
export class SqliteObjectiveStore implements DurableObjectiveStore {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: IntelligenceStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async get(): Promise<UserObjective | null> {
    const row = this.db.prepare("SELECT objective FROM mi_objectives WHERE id = 1").get();
    if (row === undefined) return null;
    return parseStored(
      UserObjectiveSchema,
      row["objective"],
      ErrorCode.IntelligenceObjectiveInvalid,
      "UserObjective",
    );
  }

  async put(objective: UserObjective): Promise<void> {
    const validated = parseOrThrow(
      UserObjectiveSchema,
      objective,
      ErrorCode.IntelligenceObjectiveInvalid,
      "UserObjective",
    );
    this.db
      .prepare(
        "INSERT INTO mi_objectives (id, objective, declared_at, updated_at) VALUES (1, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET objective = excluded.objective, declared_at = excluded.declared_at, updated_at = excluded.updated_at",
      )
      .run(
        toSqlParam(JSON.stringify(validated)),
        toSqlParam(validated.declaredAt),
        toSqlParam(this.clock()),
      );
  }

  async clear(): Promise<boolean> {
    return this.db.prepare("DELETE FROM mi_objectives WHERE id = 1").run().changes > 0;
  }
}

// ---------------------------------------------------------------------------
// SqliteFeedbackStore
// ---------------------------------------------------------------------------

/** Durable FeedbackStore: idempotent append keyed by the event id. */
export class SqliteFeedbackStore implements DurableFeedbackStore {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: IntelligenceStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async append(event: FeedbackEvent): Promise<FeedbackAppendResult> {
    const validated = parseOrThrow(
      FeedbackEventSchema,
      event,
      ErrorCode.IntelligenceFeedbackInvalid,
      "FeedbackEvent",
    );
    const existing = this.db
      .prepare("SELECT event_json FROM mi_feedback_events WHERE id = ?")
      .get(toSqlParam(validated.id));
    if (existing !== undefined) {
      return {
        outcome: "duplicate",
        existing: parseStored(
          FeedbackEventSchema,
          existing["event_json"],
          ErrorCode.IntelligenceFeedbackInvalid,
          "FeedbackEvent",
        ),
      };
    }
    this.db
      .prepare(
        "INSERT INTO mi_feedback_events (id, item_id, channel, kind, captured_at, event_json, appended_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        toSqlParam(validated.id),
        toSqlParam(validated.itemId),
        toSqlParam(validated.channel),
        toSqlParam(validated.kind),
        toSqlParam(validated.provenance.capturedAt),
        toSqlParam(JSON.stringify(validated)),
        toSqlParam(this.clock()),
      );
    return { outcome: "appended", event: validated };
  }

  async get(id: string): Promise<FeedbackEvent | null> {
    const row = this.db
      .prepare("SELECT event_json FROM mi_feedback_events WHERE id = ?")
      .get(toSqlParam(id));
    if (row === undefined) return null;
    return parseStored(
      FeedbackEventSchema,
      row["event_json"],
      ErrorCode.IntelligenceFeedbackInvalid,
      "FeedbackEvent",
    );
  }

  async list(): Promise<readonly FeedbackEvent[]> {
    return this.db
      .prepare("SELECT event_json FROM mi_feedback_events ORDER BY appended_at, id")
      .all()
      .map((row) =>
        parseStored(
          FeedbackEventSchema,
          row["event_json"],
          ErrorCode.IntelligenceFeedbackInvalid,
          "FeedbackEvent",
        ),
      );
  }

  async delete(id: string): Promise<boolean> {
    return (
      this.db.prepare("DELETE FROM mi_feedback_events WHERE id = ?").run(toSqlParam(id)).changes > 0
    );
  }

  async clearAll(): Promise<number> {
    return this.db.prepare("DELETE FROM mi_feedback_events").run().changes;
  }
}

// ---------------------------------------------------------------------------
// SqliteArtifactRegistry
// ---------------------------------------------------------------------------

/** Durable ArtifactRegistry: derived-artifact descriptors in their OWN table. */
export class SqliteArtifactRegistry implements DurableArtifactRegistry {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: IntelligenceStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(descriptor: DerivedArtifact): Promise<void> {
    const validated = parseOrThrow(
      DerivedArtifactSchema,
      descriptor,
      ErrorCode.IntelligenceArtifactInvalid,
      "DerivedArtifact",
    );
    this.db
      .prepare(
        "INSERT INTO mi_derived_artifacts (id, source_item_id, kind, created_at, artifact_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET source_item_id = excluded.source_item_id, kind = excluded.kind, created_at = excluded.created_at, artifact_json = excluded.artifact_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(validated.id),
        toSqlParam(validated.sourceItemId),
        toSqlParam(validated.kind),
        toSqlParam(validated.createdAt),
        toSqlParam(JSON.stringify(validated)),
        toSqlParam(this.clock()),
      );
  }

  async get(id: string): Promise<DerivedArtifact | null> {
    const row = this.db
      .prepare("SELECT artifact_json FROM mi_derived_artifacts WHERE id = ?")
      .get(toSqlParam(id));
    if (row === undefined) return null;
    return parseStored(
      DerivedArtifactSchema,
      row["artifact_json"],
      ErrorCode.IntelligenceArtifactInvalid,
      "DerivedArtifact",
    );
  }

  async list(): Promise<readonly DerivedArtifact[]> {
    return this.db
      .prepare("SELECT artifact_json FROM mi_derived_artifacts ORDER BY created_at, id")
      .all()
      .map((row) =>
        parseStored(
          DerivedArtifactSchema,
          row["artifact_json"],
          ErrorCode.IntelligenceArtifactInvalid,
          "DerivedArtifact",
        ),
      );
  }

  async listWithLineage(
    catalog: readonly CatalogItem[],
  ): Promise<readonly ArtifactLineageStatus[]> {
    const descriptors = await this.list();
    return descriptors.map((descriptor) => {
      const violations = validateDerivedArtifactLineage(descriptor, catalog);
      if (violations.length === 0) {
        return { descriptor, lineage: "attached" } as const;
      }
      // Shape violations are impossible here (validated on write); the only
      // reachable violation is source-not-found — the dangling marker.
      return {
        descriptor,
        lineage: "dangling",
        sourceItemId: descriptor.sourceItemId,
      } as const;
    });
  }

  async delete(id: string): Promise<boolean> {
    return (
      this.db.prepare("DELETE FROM mi_derived_artifacts WHERE id = ?").run(toSqlParam(id)).changes >
      0
    );
  }

  async clearAll(): Promise<number> {
    return this.db.prepare("DELETE FROM mi_derived_artifacts").run().changes;
  }

  async deleteBySource(sourceItemId: string): Promise<number> {
    return this.db
      .prepare("DELETE FROM mi_derived_artifacts WHERE source_item_id = ?")
      .run(toSqlParam(sourceItemId)).changes;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** The three durable MI stores bound to one profile-scoped database handle. */
export interface IntelligenceStores {
  readonly objectives: DurableObjectiveStore;
  readonly feedback: DurableFeedbackStore;
  readonly artifacts: DurableArtifactRegistry;
}

/**
 * Creates the durable MI store trio over an ALREADY-MIGRATED profile store
 * (openStore ran 0002_media_intelligence). Per-profile by construction: the
 * handle IS the profile's database.
 */
export function createIntelligenceStores(
  db: SqliteDatabase,
  options: IntelligenceStoreOptions = {},
): IntelligenceStores {
  return {
    objectives: new SqliteObjectiveStore(db, options),
    feedback: new SqliteFeedbackStore(db, options),
    artifacts: new SqliteArtifactRegistry(db, options),
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Parses a stored canonical-JSON column back through the locked schema —
 * corrupt or tampered rows surface as typed WebFlixErrors (never silently
 * mangled contract objects).
 */
function parseStored<T>(
  schema: { parse(value: unknown): T },
  raw: unknown,
  code: ErrorCode,
  what: string,
): T {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new WebFlixError({
      code,
      reason: `stored ${what} row is not valid JSON: ${detail}`,
      retryable: false,
      context: { subject: what, stored: typeof raw === "string" ? raw.slice(0, 120) : raw },
    });
  }
  return parseOrThrow(schema, parsedJson, code, what);
}
