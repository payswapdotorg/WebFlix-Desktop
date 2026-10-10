import { createHash } from 'node:crypto';
import { inTransaction, type SqliteDatabase } from './adapter';
import { MigrationError, MigrationHashMismatchError } from '../errors';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export interface AppliedMigration {
  id: number;
  name: string;
  hash: string;
  appliedAt: number;
}

export const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
`;

export function migrationHash(migration: Migration): string {
  return createHash('sha256').update(migration.sql, 'utf8').digest('hex');
}

export function listAppliedMigrations(db: SqliteDatabase): AppliedMigration[] {
  return db
    .prepare('SELECT id, name, hash, applied_at FROM schema_migrations ORDER BY id')
    .all()
    .map((row) => ({
      id: Number(row['id']),
      name: String(row['name']),
      hash: String(row['hash']),
      appliedAt: Number(row['applied_at']),
    }));
}

/**
 * Forward-only migration runner: applies pending migrations in order and records
 * each one's sha-256 hash in schema_migrations. Re-opening an already-migrated
 * store re-verifies every recorded hash — any tampering or source rewrite stops
 * the store from opening. There are no down migrations.
 */
export function runMigrations(db: SqliteDatabase, migrations: readonly Migration[], now: number = Date.now()): number {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new MigrationError(`duplicate migration id ${migration.id} in migration list`);
    }
    seen.add(migration.id);
  }
  for (let i = 1; i < migrations.length; i += 1) {
    if (migrations[i].id <= migrations[i - 1].id) {
      throw new MigrationError('migrations must be listed in strictly ascending id order');
    }
  }

  db.exec(SCHEMA_MIGRATIONS_DDL);
  const known = new Map(migrations.map((migration) => [migration.id, migration]));

  for (const record of listAppliedMigrations(db)) {
    const migration = known.get(record.id);
    if (!migration) {
      throw new MigrationError(
        `schema_migrations records migration ${record.id} (${record.name}) which is no longer in the forward-only migration list`,
      );
    }
    if (migration.name !== record.name) {
      throw new MigrationError(
        `migration ${record.id} was recorded as "${record.name}" but is now named "${migration.name}" — forward-only history must not be rewritten`,
      );
    }
    const hash = migrationHash(migration);
    if (hash !== record.hash) {
      throw new MigrationHashMismatchError(
        `migration ${record.id} (${record.name}) hash mismatch: recorded ${record.hash}, computed ${hash}`,
      );
    }
  }

  const applied = new Set(listAppliedMigrations(db).map((record) => record.id));
  let appliedNow = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    inTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, hash, applied_at) VALUES (?, ?, ?, ?)').run(
        migration.id,
        migration.name,
        migrationHash(migration),
        now,
      );
    });
    appliedNow += 1;
  }
  return appliedNow;
}
