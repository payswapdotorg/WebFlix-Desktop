export * from "./constants";
export * from "./errors";
export * from "./fingerprint";
export * from "./paths";
export * from "./ports";
export * from "./types";

export { createSqliteDatabase, inTransaction, toSqlParam } from "./db/adapter";
export type {
  SqliteDatabase,
  SqliteEngineName,
  SqlParam,
  SqlRunResult,
  SqliteStatement,
} from "./db/adapter";

export {
  listAppliedMigrations,
  migrationHash,
  runMigrations,
  SCHEMA_MIGRATIONS_DDL,
} from "./db/migrate";
export type { AppliedMigration, Migration } from "./db/migrate";

export { migration0001Init } from "./db/migrations/0001_init";

export { LocalStore } from "./localStore";
export type { LocalStoreOptions } from "./localStore";

export { indexPath, DEFAULT_MEDIA_EXTENSIONS } from "./indexing";
export type { IndexOptions } from "./indexing";

export { createBackup, restoreBackup, sha256File } from "./backup";
export type { BackupResult, RestoreOptions, RestoreResult } from "./backup";

export { sweepProviderMetadata } from "./ttl";
export type {
  MetadataRefreshFn,
  MetadataRefreshResult,
  TtlSweepOptions,
  TtlSweepResult,
} from "./ttl";

export { ALL_MIGRATIONS, openStore, WebFlixStore } from "./store";
export type { OpenStoreOptions } from "./store";

export { migration0002MediaIntelligence } from "./db/migrations/0002_media_intelligence";
export { migration0003RankerAdapterSelection } from "./db/migrations/0003_ranker_adapter_selection";

// Durable ranker-adapter selection store (P4-ADAPTERS row 2): the
// per-profile selection on this package's storage seam (own mi_ranker_selection
// table, additive migration 0003, the 0002 rules), exported for the
// composition root (a later order wires it — the port is a structural mirror
// of the application layer's RankerSelectionStore, per the LocalStorePort
// precedent).
export { SqliteRankerSelectionStore } from "./ranker-selection-store";
export type {
  RankerSelectionStoreOptions,
  RankerSelectionStorePort,
} from "./ranker-selection-store";

// Durable media-intelligence stores (P4-ARTIFACTS row 1): the MI store trio
// on this package's storage seam, exported for the composition root (a
// later order wires them — ports are structural mirrors of the application
// layer's MI ports, per the LocalStorePort precedent).
export {
  createIntelligenceStores,
  SqliteObjectiveStore,
  SqliteFeedbackStore,
  SqliteArtifactRegistry,
} from "./intelligence-stores";
export type {
  ArtifactLineageStatus,
  ArtifactRegistryPort,
  DurableArtifactRegistry,
  DurableFeedbackStore,
  DurableObjectiveStore,
  FeedbackAppendResult,
  FeedbackStorePort,
  IntelligenceStoreOptions,
  IntelligenceStores,
  ObjectiveStorePort,
} from "./intelligence-stores";
