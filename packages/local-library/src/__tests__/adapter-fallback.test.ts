/**
 * WFX-DURABLE-LIB-1 — the sqlite adapter's fallback battery (the
 * live-Electron findings, pinned so they never regress).
 *
 * Pinned here (all binding):
 *   - The Electron finding #1: a better-sqlite3 that IMPORTS but whose
 *     CONSTRUCTOR throws (the system-Node ABI mismatch under Electron)
 *     degrades to node:sqlite — never a thrown open, and the unusable
 *     engine is remembered (the next open skips it).
 *   - The Electron finding #2 (root cause): the node:sqlite fallback loads
 *     through createRequire + require("node:sqlite") — tsup's ESM splitting
 *     strips the node: prefix from dynamic imports, which does NOT resolve
 *     to the builtin under Electron's ESM loader (the desktop main bundle's
 *     services chunks use this same require pattern; the adapter now does
 *     too, pinned by construction — the source contains no dynamic
 *     node:-import to regress to).
 *   - A genuine open failure (a path whose parent does not exist) surfaces
 *     the raw engine error — never a fake success, never a masked failure.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The simulated Electron runtime: better-sqlite3 RESOLVES (the import works)
// but every instantiation throws the ABI mismatch — exactly what the live
// desktop main process produced before the fallback landed.
vi.mock("better-sqlite3", () => ({
  default: class SimulatedAbiMismatch {
    constructor() {
      throw new Error(
        "simulated: was compiled against a different Node.js version using NODE_MODULE_VERSION",
      );
    }
  },
}));

import { createSqliteDatabase } from "../db/adapter";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webflix-adapter-fallback-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createSqliteDatabase — the better-sqlite3 instantiation-failure fallback (the Electron finding)", () => {
  it("degrades to node:sqlite when the better-sqlite3 constructor throws (ABI mismatch)", async () => {
    const db = await createSqliteDatabase(join(dir, "a.db"));
    expect(db.engine).toBe("node:sqlite");
    db.exec("CREATE TABLE probe (id TEXT PRIMARY KEY, n INTEGER);");
    db.prepare("INSERT INTO probe (id, n) VALUES (?, ?)").run("x", 1);
    expect(db.prepare("SELECT n FROM probe WHERE id = ?").get("x")?.["n"]).toBe(1);
    db.close();
  });

  it("remembers the unusable engine (the second open skips better-sqlite3 entirely)", async () => {
    const first = await createSqliteDatabase(join(dir, "a.db"));
    expect(first.engine).toBe("node:sqlite");
    first.close();
    const second = await createSqliteDatabase(join(dir, "b.db"));
    expect(second.engine).toBe("node:sqlite");
    second.close();
  });

  it("surfaces a genuine open failure raw (a missing parent directory — never a fake success)", async () => {
    await expect(createSqliteDatabase(join(dir, "no-such-dir", "a.db"))).rejects.toThrow();
  });
});
