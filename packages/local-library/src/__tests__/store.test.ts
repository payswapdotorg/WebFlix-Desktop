import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BackupHashMismatchError,
  BackupValidationError,
  DuplicateError,
  IndexCancelledError,
  LocalStore,
  MigrationHashMismatchError,
  NotFoundError,
  PathSafetyError,
  PROVIDER_METADATA_TTL_MS,
  ValidationError,
  WebFlixStore,
  createBackup,
  defaultDataRoot,
  fingerprintFor,
  indexPath,
  openStore,
  restoreBackup,
  sweepProviderMetadata,
} from "../index";
import type { LibraryEntryPatch } from "../index";

describe("local-library store (unit, temp dirs)", () => {
  let dir: string;
  const opened: WebFlixStore[] = [];

  const open = async (baseDir: string): Promise<WebFlixStore> => {
    const store = await openStore({ baseDir });
    opened.push(store);
    return store;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webflix-local-store-"));
  });

  afterEach(() => {
    for (const store of opened.splice(0)) {
      try {
        store.close();
      } catch {
        // already closed
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  describe("store.ts: data root, WAL mode, migrations", () => {
    it("opens the injected data root with WAL enabled and records the 0001_init migration hash", async () => {
      const store = await open(dir);
      expect(store.dbPath.endsWith("webflix.db")).toBe(true);
      expect(store.journalMode()).toBe("wal");
      expect(store.engine === "better-sqlite3" || store.engine === "node:sqlite").toBe(true);
      expect(store.local).toBeInstanceOf(LocalStore);

      const rows = store.db
        .prepare("SELECT id, name, hash FROM schema_migrations ORDER BY id")
        .all();
      expect(rows).toHaveLength(1);
      expect(rows[0]["name"]).toBe("0001_init");
      expect(String(rows[0]["hash"])).toMatch(/^[0-9a-f]{64}$/);
    });

    it("applies each migration exactly once across reopens", async () => {
      const store = await open(dir);
      store.close();
      const reopened = await open(dir);
      const count = reopened.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get();
      expect(Number(count?.["n"])).toBe(1);

      const p = join(dir, "x.mp4");
      writeFileSync(p, "x");
      expect(reopened.local.addLibraryEntry({ path: p }).title).toBe("x");
    });

    it("is forward-only: a tampered migration hash stops the store from opening", async () => {
      const store = await open(dir);
      store.db.exec("UPDATE schema_migrations SET hash = 'deadbeef'");
      store.close();
      await expect(openStore({ baseDir: dir })).rejects.toThrowError(MigrationHashMismatchError);
    });

    it("never opens the default ~/.webflix data root and rejects an empty baseDir under test", async () => {
      await expect(openStore({ baseDir: defaultDataRoot() })).rejects.toThrowError(PathSafetyError);
      await expect(openStore({ baseDir: "" })).rejects.toThrowError(ValidationError);
    });
  });

  describe("library CRUD", () => {
    it("adds, reads, updates and deletes entries with content-independent fingerprints", async () => {
      const store = await open(dir);
      const p = join(dir, "clip.mp4");
      writeFileSync(p, "aaaa");
      const before = statSync(p);

      const entry = store.local.addLibraryEntry({ path: p });
      expect(entry.title).toBe("clip");
      expect(entry.kind).toBe("other");
      expect(entry.missing).toBe(false);
      expect(entry.sizeBytes).toBe(4);
      expect(entry.lastIndexedAt).toBeNull();
      expect(entry.fingerprint).toBe(fingerprintFor(entry.path, entry.sizeBytes, entry.mtimeMs));

      // same size + same mtime, different bytes → same fingerprint (no media bytes are read)
      writeFileSync(p, "bbbb");
      utimesSync(p, before.atime, before.mtime);
      const after = statSync(p);
      expect(after.size).toBe(4);
      expect(Math.abs(Math.floor(after.mtimeMs) - Math.floor(before.mtimeMs))).toBeLessThanOrEqual(
        1,
      ); // fs mtime granularity
      expect(fingerprintFor(entry.path, after.size, Math.floor(before.mtimeMs))).toBe(
        entry.fingerprint,
      ); // invariant: fingerprint == hash at index time

      expect(store.local.getLibraryEntry(entry.id)?.path).toBe(entry.path);
      expect(store.local.findLibraryEntryByPath(p)?.id).toBe(entry.id);
      expect(store.local.getLibraryEntry("missing")).toBeNull();
      expect(store.local.findLibraryEntryByPath(join(dir, "nope.mp4"))).toBeNull();

      expect(() => store.local.addLibraryEntry({ path: p })).toThrowError(DuplicateError);

      const updated = store.local.updateLibraryEntry(entry.id, {
        title: "Better Title",
        kind: "movie",
      });
      expect(updated.title).toBe("Better Title");
      expect(updated.kind).toBe("movie");
      expect(updated.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
      expect(() =>
        store.local.updateLibraryEntry(entry.id, { kind: "nope" } as unknown as LibraryEntryPatch),
      ).toThrowError(ValidationError);
      expect(() => store.local.updateLibraryEntry("missing", { title: "x" })).toThrowError(
        NotFoundError,
      );

      expect(store.local.listLibraryEntries()).toHaveLength(1);
      expect(store.local.deleteLibraryEntry(entry.id)).toBe(true);
      expect(store.local.getLibraryEntry(entry.id)).toBeNull();
      expect(store.local.deleteLibraryEntry(entry.id)).toBe(false);
    });

    it("rejects unsafe paths", async () => {
      const store = await open(dir);
      expect(() => store.local.addLibraryEntry({ path: "bad\0path.mp4" })).toThrowError(
        PathSafetyError,
      );
      expect(() => store.local.addLibraryEntry({ path: "   " })).toThrowError(ValidationError);
    });
  });

  describe("collections", () => {
    it("creates, renames and deletes collections with unique names", async () => {
      const store = await open(dir);
      const one = store.local.createCollection("Movie Night", "friday picks");
      expect(one.name).toBe("Movie Night");
      expect(one.description).toBe("friday picks");
      expect(store.local.findCollectionByName("Movie Night")?.id).toBe(one.id);
      expect(() => store.local.createCollection("Movie Night")).toThrowError(DuplicateError);
      expect(() => store.local.createCollection("   ")).toThrowError(ValidationError);

      const two = store.local.createCollection("Two");
      expect(
        store.local
          .listCollections()
          .map((c) => c.name)
          .sort(),
      ).toEqual(["Movie Night", "Two"]);

      const renamed = store.local.updateCollection(two.id, { name: "Renamed", description: null });
      expect(renamed.name).toBe("Renamed");
      expect(renamed.description).toBeNull();
      expect(() => store.local.updateCollection(two.id, { name: "Movie Night" })).toThrowError(
        DuplicateError,
      );

      expect(store.local.getCollection("missing")).toBeNull();
      expect(() => store.local.updateCollection("missing", { name: "X" })).toThrowError(
        NotFoundError,
      );
      expect(store.local.deleteCollection("missing")).toBe(false);

      expect(store.local.deleteCollection(two.id)).toBe(true);
      expect(store.local.getCollection(two.id)).toBeNull();
    });
  });

  describe("playlists", () => {
    it("appends, dedupes, compacts on removal, reorders strictly, and cascades with its owners", async () => {
      const store = await open(dir);
      const entryIds = ["one.mp4", "two.mp4", "three.mp4"].map((name) => {
        const p = join(dir, name);
        writeFileSync(p, "x");
        return store.local.addLibraryEntry({ path: p }).id;
      });

      const collection = store.local.createCollection("Queue");
      for (const entryId of entryIds) {
        store.local.addPlaylistItem(collection.id, entryId);
      }

      let items = store.local.listPlaylistItems(collection.id);
      expect(items.map((i) => i.entryId)).toEqual(entryIds);
      expect(items.map((i) => i.position)).toEqual([0, 1, 2]);

      expect(() => store.local.addPlaylistItem(collection.id, entryIds[0])).toThrowError(
        DuplicateError,
      );
      expect(() => store.local.addPlaylistItem(collection.id, "missing-entry")).toThrowError(
        NotFoundError,
      );
      expect(() => store.local.addPlaylistItem("missing-collection", entryIds[0])).toThrowError(
        NotFoundError,
      );

      expect(store.local.removePlaylistItem(collection.id, entryIds[1])).toBe(true);
      items = store.local.listPlaylistItems(collection.id);
      expect(items.map((i) => i.entryId)).toEqual([entryIds[0], entryIds[2]]);
      expect(items.map((i) => i.position)).toEqual([0, 1]);
      expect(store.local.removePlaylistItem(collection.id, entryIds[1])).toBe(false);

      store.local.reorderPlaylist(collection.id, [items[1].id, items[0].id]);
      items = store.local.listPlaylistItems(collection.id);
      expect(items.map((i) => i.entryId)).toEqual([entryIds[2], entryIds[0]]);
      expect(items.map((i) => i.position)).toEqual([0, 1]);

      expect(() => store.local.reorderPlaylist(collection.id, [items[0].id])).toThrowError(
        ValidationError,
      );
      expect(() =>
        store.local.reorderPlaylist(collection.id, ["bogus-item", items[1].id]),
      ).toThrowError(NotFoundError);

      // deleting an entry cascades into playlist_items
      store.local.deleteLibraryEntry(entryIds[2]);
      expect(store.local.listPlaylistItems(collection.id).map((i) => i.entryId)).toEqual([
        entryIds[0],
      ]);

      // deleting the collection cascades into playlist_items
      expect(store.local.deleteCollection(collection.id)).toBe(true);
      expect(store.local.listPlaylistItems(collection.id)).toHaveLength(0);
    });
  });

  describe("watched state & progress", () => {
    it("toggles watched state with timestamps and lists watched entries", async () => {
      const store = await open(dir);
      const p = join(dir, "w.mp4");
      writeFileSync(p, "x");
      const entry = store.local.addLibraryEntry({ path: p });

      expect(store.local.getWatchedState(entry.id)).toBeNull();
      const at = 1_700_000_000_000;
      const state = store.local.setWatched(entry.id, true, at);
      expect(state.watched).toBe(true);
      expect(state.watchedAt).toBe(at);
      expect(store.local.listWatched(true).map((e) => e.id)).toEqual([entry.id]);
      expect(store.local.listWatched(false)).toHaveLength(0);

      const unwatched = store.local.setWatched(entry.id, false);
      expect(unwatched.watched).toBe(false);
      expect(unwatched.watchedAt).toBeNull();
      expect(store.local.listWatched(true)).toHaveLength(0);

      expect(() => store.local.setWatched("missing", true)).toThrowError(NotFoundError);
    });

    it("stores playback progress, computes percentages and clears them", async () => {
      const store = await open(dir);
      const p = join(dir, "p.mp4");
      writeFileSync(p, "x");
      const entry = store.local.addLibraryEntry({ path: p });

      expect(store.local.getProgress(entry.id)).toBeNull();
      const progress = store.local.setProgress(entry.id, 45 * 60_000, 90 * 60_000);
      expect(progress.positionMs).toBe(45 * 60_000);
      expect(progress.durationMs).toBe(90 * 60_000);
      expect(progress.percent).toBe(50);

      const clamped = store.local.setProgress(entry.id, 91 * 60_000, 90 * 60_000);
      expect(clamped.percent).toBe(100);

      const noDuration = store.local.setProgress(entry.id, 10_000);
      expect(noDuration.percent).toBe(0);

      expect(store.local.clearProgress(entry.id)).toBe(true);
      expect(store.local.getProgress(entry.id)).toBeNull();
      expect(store.local.clearProgress(entry.id)).toBe(false);
      expect(() => store.local.setProgress("missing", 0)).toThrowError(NotFoundError);
    });
  });

  describe("provider metadata cache + 30-day TTL", () => {
    it("caches provider payloads with fetchedAt/expiry and upserts per (provider, externalId)", async () => {
      const store = await open(dir);
      const p = join(dir, "m.mp4");
      writeFileSync(p, "x");
      const entry = store.local.addLibraryEntry({ path: p });

      const now = 1_800_000_000_000;
      const record = store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "tt123",
        entryId: entry.id,
        payload: { title: "M" },
        now,
      });
      expect(record.fetchedAt).toBe(now);
      expect(record.expiresAt).toBe(now + PROVIDER_METADATA_TTL_MS);
      expect(JSON.parse(record.payload)).toEqual({ title: "M" });

      const upserted = store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "tt123",
        payload: { title: "M2" },
        now: now + 1,
      });
      expect(upserted.id).toBe(record.id);
      expect(JSON.parse(upserted.payload)).toEqual({ title: "M2" });
      expect(upserted.entryId).toBeNull();

      expect(store.local.getProviderMetadata("tmdb", "tt123")?.id).toBe(record.id);
      expect(store.local.getProviderMetadata("tmdb", "missing")).toBeNull();
      expect(store.local.listProviderMetadata("tmdb")).toHaveLength(1);
      expect(store.local.listProviderMetadata()).toHaveLength(1);
    });

    it("sweeps entries older than 30 days: refresh-or-delete", async () => {
      const store = await open(dir);
      const day = 86_400_000;
      const now = 1_800_000_000_000;
      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "fresh",
        payload: { v: 1 },
        now,
      });
      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "stale-a",
        payload: { v: 1 },
        now: now - 31 * day,
      });
      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "stale-b",
        payload: { v: 1 },
        now: now - 40 * day,
      });

      const deleted = await sweepProviderMetadata(store.local, { now });
      expect(deleted).toEqual({ expired: 2, refreshed: 0, deleted: 2 });
      expect(store.local.getProviderMetadata("tmdb", "fresh")).not.toBeNull();

      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "stale-a",
        payload: { v: 1 },
        now: now - 31 * day,
      });
      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "stale-b",
        payload: { v: 1 },
        now: now - 40 * day,
      });
      const mixed = await sweepProviderMetadata(store.local, {
        now,
        refresh: (record) =>
          record.externalId === "stale-b" ? null : { payload: { refreshed: true } },
      });
      expect(mixed).toEqual({ expired: 2, refreshed: 1, deleted: 1 });
      const refreshedRecord = store.local.getProviderMetadata("tmdb", "stale-a");
      expect(refreshedRecord?.fetchedAt).toBe(now);
      expect(refreshedRecord?.expiresAt).toBe(now + PROVIDER_METADATA_TTL_MS);
      expect(JSON.parse(refreshedRecord?.payload ?? "{}")).toEqual({ refreshed: true });
      expect(store.local.getProviderMetadata("tmdb", "stale-b")).toBeNull();

      store.local.putProviderMetadata({
        provider: "tmdb",
        externalId: "stale-c",
        payload: { v: 1 },
        now: now - 31 * day,
      });
      const failing = await sweepProviderMetadata(store.local, {
        now,
        refresh: () => {
          throw new Error("provider down");
        },
      });
      expect(failing).toEqual({ expired: 1, refreshed: 0, deleted: 1 });
      expect(store.local.getProviderMetadata("tmdb", "stale-c")).toBeNull();
    });
  });

  describe("jobs", () => {
    it("enqueues, claims, retries and completes jobs FIFO", async () => {
      const store = await open(dir);
      const first = store.local.enqueueJob("index-path", { root: "/media" }, 2);
      const second = store.local.enqueueJob("ttl-sweep");
      expect(first.state).toBe("queued");
      expect(first.attempts).toBe(0);
      expect(store.local.listJobs("queued")).toHaveLength(2);

      expect(store.local.claimNextJob()?.id).toBe(first.id);
      const claimed = store.local.getJob(first.id);
      expect(claimed?.state).toBe("running");
      expect(claimed?.attempts).toBe(1);
      expect(claimed?.startedAt).not.toBeNull();

      const retried = store.local.failJob(first.id, "transient boom");
      expect(retried.state).toBe("queued");
      expect(retried.lastError).toBe("transient boom");

      expect(store.local.claimNextJob()?.id).toBe(first.id);
      const dead = store.local.failJob(first.id, "permanent boom");
      expect(dead.state).toBe("failed");
      expect(dead.finishedAt).not.toBeNull();

      expect(store.local.claimNextJob()?.id).toBe(second.id);
      const done = store.local.completeJob(second.id);
      expect(done.state).toBe("done");
      expect(done.finishedAt).not.toBeNull();

      expect(store.local.listJobs("done")).toHaveLength(1);
      expect(store.local.listJobs()).toHaveLength(2);
      expect(store.local.claimNextJob()).toBeNull();
      expect(() => store.local.completeJob("missing")).toThrowError(NotFoundError);
      expect(() => store.local.failJob("missing", "x")).toThrowError(NotFoundError);
    });
  });

  describe("indexing", () => {
    it("walks folders recursively, filters by extension, and keeps fingerprints stable but mtime-sensitive", () => {
      const root = join(dir, "library");
      mkdirSync(join(root, "season 01"), { recursive: true });
      writeFileSync(join(root, "movie.mp4"), "m");
      writeFileSync(join(root, "notes.txt"), "n");
      writeFileSync(join(root, "season 01", "e01.mkv"), "e");

      const files = indexPath(root);
      expect(files).toHaveLength(2);
      expect(files.every((f) => f.path.startsWith(root + sep))).toBe(true);
      expect(files.map((f) => f.title).sort()).toEqual(["e01", "movie"]);
      expect(files.every((f) => f.kind === "other")).toBe(true);

      const secondPass = indexPath(root);
      expect(secondPass.map((f) => f.fingerprint)).toEqual(files.map((f) => f.fingerprint));

      const future = new Date(Date.now() + 60_000);
      utimesSync(join(root, "movie.mp4"), future, future);
      const thirdPass = indexPath(root);
      const movieBefore = files.find((f) => f.title === "movie");
      const movieAfter = thirdPass.find((f) => f.title === "movie");
      expect(movieAfter?.fingerprint).not.toBe(movieBefore?.fingerprint);

      const onlyMkv = indexPath(root, { extensions: [".mkv"] });
      expect(onlyMkv.map((f) => f.path)).toEqual([join(root, "season 01", "e01.mkv")]);
      expect(indexPath(root, { kind: "episode" }).every((f) => f.kind === "episode")).toBe(true);
      expect(() => indexPath(join(dir, "does-not-exist"))).toThrowError();
    });

    it("is path-safe: symlinks escaping the root are never indexed or followed", () => {
      const root = join(dir, "root");
      const outside = join(dir, "outside");
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(root, "ok.mp4"), "o");
      writeFileSync(join(outside, "secret.mp4"), "s");
      symlinkSync(join(outside, "secret.mp4"), join(root, "leak.mp4"));
      symlinkSync(outside, join(root, "outside-dir"));

      const files = indexPath(root);
      expect(files.map((f) => f.path)).toEqual([join(root, "ok.mp4")]);
    });

    it("is cancellable via AbortSignal (before and mid-scan)", () => {
      const root = join(dir, "cancel-root");
      mkdirSync(root, { recursive: true });
      for (let i = 0; i < 8; i += 1) {
        writeFileSync(join(root, `v${i}.mp4`), "x");
      }

      const preAborted = new AbortController();
      preAborted.abort();
      expect(() => indexPath(root, { signal: preAborted.signal })).toThrowError(
        IndexCancelledError,
      );

      const midScan = new AbortController();
      expect(() =>
        indexPath(root, {
          signal: midScan.signal,
          onProgress: () => midScan.abort(),
        }),
      ).toThrowError(IndexCancelledError);
    });

    it("upserts indexed files by path and marks vanished files as missing", async () => {
      const store = await open(dir);
      const root = join(dir, "lib");
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "a.mp4"), "a");
      writeFileSync(join(root, "b.mp4"), "b");

      const files = indexPath(root);
      expect(store.local.upsertLibraryEntries(files)).toEqual({ added: 2, updated: 0 });
      expect(store.local.upsertLibraryEntries(files)).toEqual({ added: 0, updated: 2 });
      expect(store.local.listLibraryEntries()).toHaveLength(2);

      rmSync(join(root, "a.mp4"));
      const seen = indexPath(root);
      expect(
        store.local.markEntriesMissing(
          root,
          seen.map((f) => f.path),
        ),
      ).toBe(1);

      const missing = store.local.listLibraryEntries({ missing: true });
      expect(missing).toHaveLength(1);
      expect(missing[0].path).toBe(join(root, "a.mp4"));
      expect(store.local.listLibraryEntries({ missing: false })).toHaveLength(1);
    });
  });

  describe("backup / restore", () => {
    it("writes a consistent snapshot with a sha-256 sidecar and refuses to restore without or with a wrong hash", async () => {
      const store = await open(dir);
      const p = join(dir, "keep.mp4");
      writeFileSync(p, "keep");
      store.local.addLibraryEntry({ path: p });

      const out = join(dir, "backups", "snapshot.db");
      const backup = await createBackup(store, out);
      expect(existsSync(out)).toBe(true);
      expect(backup.path).toBe(out);
      expect(backup.bytes).toBeGreaterThan(0);
      expect(backup.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(backup.hashFile, "utf8").trim()).toBe(backup.hash);

      // corrupted snapshot → hash mismatch → target left untouched
      appendFileSync(out, "corruption");
      const target = join(dir, "restore-target");
      await expect(restoreBackup({ backupPath: out, targetBaseDir: target })).rejects.toThrowError(
        BackupHashMismatchError,
      );
      expect(existsSync(target)).toBe(false);

      // missing hash source (sidecar removed, no expectedHash) → validation error
      const out2 = join(dir, "backups2", "snapshot.db");
      const backup2 = await createBackup(store, out2);
      rmSync(backup2.hashFile);
      await expect(
        restoreBackup({ backupPath: out2, targetBaseDir: join(dir, "target2") }),
      ).rejects.toThrowError(BackupValidationError);

      // explicit expectedHash restores successfully
      const restored = await restoreBackup({
        backupPath: out2,
        targetBaseDir: join(dir, "target3"),
        expectedHash: backup2.hash,
      });
      expect(restored.hash).toBe(backup2.hash);
      expect(existsSync(restored.dbPath)).toBe(true);
    });
  });
});
