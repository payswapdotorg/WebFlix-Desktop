import { createRequire } from "node:module";
import { SqliteUnavailableError } from "../errors";

/**
 * Minimal, engine-agnostic SQLite surface used across the local-library package.
 *
 * The preferred engine is better-sqlite3 (declared in this package's dependencies).
 * The D2-LOCAL environment rules forbid running installs inside the preinstalled
 * harness, so when better-sqlite3 is not resolvable (or its native build is
 * unavailable — including the WFX-DURABLE-LIB-1 live finding: under Electron a
 * system-Node-built better-sqlite3 IMPORTS fine but its INSTANTIATION throws the
 * ABI mismatch, so the adapter also degrades on constructor failure) the adapter
 * transparently falls back to node:sqlite — the SQLite driver that ships with
 * Node 24. Both engines are driven exclusively through positional parameters so
 * binding semantics are identical.
 *
 * The node:sqlite fallback loads through createRequire + require("node:sqlite")
 * — the SAME pattern every services chunk in the desktop main bundle uses —
 * because tsup's ESM code-splitting rewrites dynamic import("node:sqlite")
 * into import("sqlite") (the node: prefix stripped), which does NOT resolve to
 * the builtin under Electron's ESM loader (pinned live: the durable bridge
 * answered the typed unavailable until this pattern landed).
 */

export type SqlParam = string | number | bigint | Uint8Array | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface SqliteStatement {
  run(...params: SqlParam[]): SqlRunResult;
  get(...params: SqlParam[]): Record<string, unknown> | undefined;
  all(...params: SqlParam[]): Array<Record<string, unknown>>;
}

export type SqliteEngineName = "better-sqlite3" | "node:sqlite";

export interface SqliteDatabase {
  readonly engine: SqliteEngineName;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export function toSqlParam(value: unknown): SqlParam {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint")
    return value;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`unsupported SQLite bind value: ${typeof value}`);
}

interface RawStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface RawEngine {
  exec(sql: string): unknown;
  prepare(sql: string): RawStatement;
  close(): unknown;
}

type BetterSqlite3Constructor = new (path: string, options?: unknown) => RawEngine;

let cachedBetterSqlite3: BetterSqlite3Constructor | null | undefined;

async function loadBetterSqlite3(): Promise<BetterSqlite3Constructor | null> {
  if (cachedBetterSqlite3 !== undefined) {
    return cachedBetterSqlite3;
  }
  try {
    const specifier = "better-sqlite3";
    const mod = (await import(/* @vite-ignore */ specifier)) as { default?: unknown } & Record<
      string,
      unknown
    >;
    const candidate = (mod?.default ?? mod) as unknown;
    cachedBetterSqlite3 =
      typeof candidate === "function" ? (candidate as BetterSqlite3Constructor) : null;
  } catch {
    // Not installed in this harness (or native rebuild unavailable) → node:sqlite fallback.
    cachedBetterSqlite3 = null;
  }
  return cachedBetterSqlite3;
}

function wrapRaw(engine: SqliteEngineName, raw: RawEngine): SqliteDatabase {
  return {
    engine,
    exec: (sql) => {
      raw.exec(sql);
    },
    prepare: (sql) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: SqlParam[]) => {
          const info = statement.run(...params);
          return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
        },
        get: (...params: SqlParam[]) =>
          statement.get(...params) as Record<string, unknown> | undefined,
        all: (...params: SqlParam[]) => statement.all(...params) as Array<Record<string, unknown>>,
      };
    },
    close: () => {
      raw.close();
    },
  };
}

async function openNodeSqlite(file: string): Promise<SqliteDatabase> {
  let DatabaseSync: new (path: string) => RawEngine;
  try {
    // createRequire — NOT a dynamic import — the tsup/ESM-splitting finding
    // documented in the module header (the desktop bundle's proven pattern).
    ({ DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as unknown as {
      DatabaseSync: new (path: string) => RawEngine;
    });
  } catch (error) {
    throw new SqliteUnavailableError(
      "neither better-sqlite3 nor node:sqlite could be loaded in this runtime",
      { cause: error },
    );
  }
  return wrapRaw("node:sqlite", new DatabaseSync(file));
}

function configureConnection(db: SqliteDatabase): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA synchronous = NORMAL;");
}

export async function createSqliteDatabase(file: string): Promise<SqliteDatabase> {
  const BetterSqlite3 = await loadBetterSqlite3();
  if (BetterSqlite3) {
    try {
      const db = wrapRaw("better-sqlite3", new BetterSqlite3(file));
      configureConnection(db);
      return db;
    } catch (error) {
      // WFX-DURABLE-LIB-1 (the Electron-runtime finding, live-pinned): under
      // Electron the dynamic import of a system-Node-built better-sqlite3
      // RESOLVES (the require shim defers the native load), and the ABI
      // mismatch surfaces only at INSTANTIATION — an instantiation failure
      // means the module is unusable in THIS runtime, which is exactly the
      // documented fallback condition. Cache the unusability and degrade to
      // node:sqlite; a genuine open error (bad path etc.) re-surfaces from
      // the fallback attempt, so no real failure is masked.
      cachedBetterSqlite3 = null;
      void error;
    }
  }
  const db = await openNodeSqlite(file);
  configureConnection(db);
  return db;
}

/** Manual transaction; do not nest. */
export function inTransaction<T>(db: SqliteDatabase, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // best effort: the outer error is what matters
    }
    throw error;
  }
}
