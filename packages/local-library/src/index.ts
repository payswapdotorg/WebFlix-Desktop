export * from './constants';
export * from './errors';
export * from './fingerprint';
export * from './paths';
export * from './ports';
export * from './types';

export { createSqliteDatabase, inTransaction, toSqlParam } from './db/adapter';
export type {
  SqliteDatabase,
  SqliteEngineName,
  SqlParam,
  SqlRunResult,
  SqliteStatement,
} from './db/adapter';

export {
  listAppliedMigrations,
  migrationHash,
  runMigrations,
  SCHEMA_MIGRATIONS_DDL,
} from './db/migrate';
export type { AppliedMigration, Migration } from './db/migrate';

export { migration0001Init } from './db/migrations/0001_init';

export { LocalStore } from './localStore';
export type { LocalStoreOptions } from './localStore';

export { indexPath, DEFAULT_MEDIA_EXTENSIONS } from './indexing';
export type { IndexOptions } from './indexing';

export { createBackup, restoreBackup, sha256File } from './backup';
export type { BackupResult, RestoreOptions, RestoreResult } from './backup';

export { sweepProviderMetadata } from './ttl';
export type { MetadataRefreshFn, MetadataRefreshResult, TtlSweepOptions, TtlSweepResult } from './ttl';

export { ALL_MIGRATIONS, openStore, WebFlixStore } from './store';
export type { OpenStoreOptions } from './store';
