import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DB_FILENAME } from './constants';
import { createSqliteDatabase, type SqliteDatabase } from './db/adapter';
import { runMigrations } from './db/migrate';
import { migration0001Init } from './db/migrations/0001_init';
import type { Migration } from './db/migrate';
import { ValidationError } from './errors';
import { LocalStore, type LocalStoreOptions } from './localStore';
import { assertNotDefaultDataRootInTests } from './paths';

export const ALL_MIGRATIONS: readonly Migration[] = [migration0001Init];

export interface OpenStoreOptions {
  /**
   * Absolute path of the WebFlix data root, injected by the caller.
   * Tests MUST pass a temp dir — the store refuses ~/.webflix under a test run.
   */
  baseDir: string;
  dbFilename?: string;
  now?: () => number;
}

export class WebFlixStore {
  constructor(
    public readonly baseDir: string,
    public readonly dbPath: string,
    public readonly db: SqliteDatabase,
    public readonly local: LocalStore,
  ) {}

  get engine(): SqliteDatabase['engine'] {
    return this.db.engine;
  }

  journalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get();
    return row ? String(row['journal_mode'] ?? '') : '';
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Opens (creating if needed) the WebFlix data root: ensures the directory
 * exists, opens the SQLite database in WAL mode and applies forward-only
 * migrations. `baseDir` is constructor-injected; tests use temp dirs.
 */
export async function openStore(options: OpenStoreOptions): Promise<WebFlixStore> {
  if (typeof options.baseDir !== 'string' || options.baseDir.trim().length === 0) {
    throw new ValidationError('OpenStoreOptions.baseDir must be a non-empty string');
  }
  const baseDir = resolve(options.baseDir);
  assertNotDefaultDataRootInTests(baseDir);
  mkdirSync(baseDir, { recursive: true });
  const dbPath = join(baseDir, options.dbFilename ?? DB_FILENAME);
  const db = await createSqliteDatabase(dbPath);
  try {
    runMigrations(db, ALL_MIGRATIONS);
  } catch (error) {
    db.close();
    throw error;
  }
  const storeOptions: LocalStoreOptions = options.now ? { now: options.now } : {};
  return new WebFlixStore(baseDir, dbPath, db, new LocalStore(db, storeOptions));
}
