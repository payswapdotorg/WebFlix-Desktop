import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { DB_FILENAME } from "./constants";
import type { SqliteDatabase } from "./db/adapter";
import { BackupHashMismatchError, BackupValidationError } from "./errors";
import { WebFlixStore } from "./store";

export interface BackupResult {
  path: string;
  hashFile: string;
  hash: string;
  bytes: number;
}

export interface RestoreOptions {
  backupPath: string;
  /** Data root directory to restore into; must not hold an open connection. */
  targetBaseDir: string;
  dbFilename?: string;
  /** Explicit hash; when omitted, the `<backupPath>.sha256` sidecar is used. */
  expectedHash?: string;
}

export interface RestoreResult {
  dbPath: string;
  hash: string;
  bytes: number;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function vacuumInto(db: SqliteDatabase, target: string): void {
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } catch {
    const escaped = target.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  }
}

/**
 * Consistent snapshot of the live (WAL) database via `VACUUM INTO`, followed by
 * a sha-256 written to a `.sha256` sidecar used to validate restores.
 */
export async function createBackup(
  store: WebFlixStore | SqliteDatabase,
  outPath: string,
): Promise<BackupResult> {
  const db = store instanceof WebFlixStore ? store.db : store;
  const target = resolve(outPath);
  if (target.includes("\0")) {
    throw new BackupValidationError(`backup path contains a NUL byte: ${JSON.stringify(outPath)}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true }); // VACUUM INTO refuses an existing target
  vacuumInto(db, target);
  const hash = await sha256File(target);
  const hashFile = `${target}.sha256`;
  writeFileSync(hashFile, `${hash}\n`, "utf8");
  return { path: target, hashFile, hash, bytes: statSync(target).size };
}

/**
 * Restores a snapshot into `targetBaseDir`. The backup hash is validated
 * (sidecar or explicit expectedHash) BEFORE anything on the target is touched;
 * on mismatch nothing is overwritten. Stale WAL/SHM sidecars are removed so the
 * restored snapshot cannot be corrupted by leftovers of a previous database.
 */
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const backupPath = resolve(options.backupPath);
  if (!existsSync(backupPath)) {
    throw new BackupValidationError(`backup file not found: ${backupPath}`);
  }
  const hashFile = `${backupPath}.sha256`;
  const expected =
    options.expectedHash ?? (existsSync(hashFile) ? readFileSync(hashFile, "utf8").trim() : null);
  if (!expected || !/^[0-9a-f]{64}$/i.test(expected)) {
    throw new BackupValidationError(
      `no valid sha-256 hash available for backup ${backupPath} — pass expectedHash or keep the .sha256 sidecar`,
    );
  }
  const actual = await sha256File(backupPath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new BackupHashMismatchError(
      `backup ${backupPath} hash mismatch: expected ${expected}, got ${actual} — refusing to overwrite the target`,
    );
  }
  const targetDir = resolve(options.targetBaseDir);
  mkdirSync(targetDir, { recursive: true });
  const dbPath = join(targetDir, options.dbFilename ?? DB_FILENAME);
  const tmpPath = `${dbPath}.restore-${randomUUID()}.tmp`;
  copyFileSync(backupPath, tmpPath);
  try {
    const copyHash = await sha256File(tmpPath);
    if (copyHash.toLowerCase() !== actual.toLowerCase()) {
      throw new BackupHashMismatchError("restored temp copy failed verification");
    }
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      rmSync(dbPath + suffix, { force: true });
    }
    renameSync(tmpPath, dbPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
  return { dbPath, hash: actual, bytes: statSync(dbPath).size };
}
