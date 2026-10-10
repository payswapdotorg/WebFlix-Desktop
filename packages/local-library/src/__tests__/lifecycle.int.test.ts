import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBackup,
  fingerprintFor,
  indexPath,
  openStore,
  restoreBackup,
  sweepProviderMetadata,
} from "../index";
import type { WebFlixStore } from "../index";

describe("local-library integration (D2-LOCAL)", () => {
  let rootA: string;
  let rootB: string;
  const opened: WebFlixStore[] = [];

  const open = async (baseDir: string): Promise<WebFlixStore> => {
    const store = await openStore({ baseDir });
    opened.push(store);
    return store;
  };

  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), "webflix-it-a-"));
    rootB = mkdtempSync(join(tmpdir(), "webflix-it-b-"));
  });

  afterEach(() => {
    for (const store of opened.splice(0)) {
      try {
        store.close();
      } catch {
        // already closed
      }
    }
    for (const tempDir of [rootA, rootB]) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the full lifecycle: add → index → collection → progress → backup → restore → verify", async () => {
    const mediaDir = join(rootA, "media");
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, "s01e01.mkv"), "episode-one");
    writeFileSync(join(mediaDir, "s01e02.mkv"), "episode-two");
    writeFileSync(join(mediaDir, "manual-movie.mp4"), "movie");
    writeFileSync(join(mediaDir, "readme.txt"), "not media");

    const storeA = await open(rootA);
    expect(storeA.engine === "better-sqlite3" || storeA.engine === "node:sqlite").toBe(true);
    expect(storeA.journalMode()).toBe("wal");

    // ── add ──────────────────────────────────────────────────────────────────
    const manualPath = join(mediaDir, "manual-movie.mp4");
    const manual = storeA.local.addLibraryEntry({
      path: manualPath,
      kind: "movie",
      title: "Manual Movie",
    });

    // ── index ────────────────────────────────────────────────────────────────
    const files = indexPath(mediaDir);
    expect(files).toHaveLength(3);
    const upsert = storeA.local.upsertLibraryEntries(files);
    expect(upsert).toEqual({ added: 2, updated: 1 });
    expect(
      storeA.local.markEntriesMissing(
        mediaDir,
        files.map((f) => f.path),
      ),
    ).toBe(0);

    const ep1 = storeA.local.findLibraryEntryByPath(join(mediaDir, "s01e01.mkv"));
    const ep2 = storeA.local.findLibraryEntryByPath(join(mediaDir, "s01e02.mkv"));
    if (!ep1 || !ep2) {
      throw new Error("indexing failed to register episodes");
    }
    expect(ep1.fingerprint).toBe(fingerprintFor(ep1.path, ep1.sizeBytes, ep1.mtimeMs));
    expect(storeA.local.listLibraryEntries()).toHaveLength(3);

    // ── collection ───────────────────────────────────────────────────────────
    const collection = storeA.local.createCollection("Movie Night", "friday picks");
    for (const entry of [ep1, ep2, manual]) {
      storeA.local.addPlaylistItem(collection.id, entry.id);
    }
    const beforeReorder = storeA.local.listPlaylistItems(collection.id);
    expect(beforeReorder.map((i) => i.entryId)).toEqual([ep1.id, ep2.id, manual.id]);
    storeA.local.reorderPlaylist(collection.id, [
      beforeReorder[2].id,
      beforeReorder[0].id,
      beforeReorder[1].id,
    ]);
    const afterReorder = storeA.local.listPlaylistItems(collection.id);
    expect(afterReorder.map((i) => i.entryId)).toEqual([manual.id, ep1.id, ep2.id]);

    // ── watched state + progress ────────────────────────────────────────────
    storeA.local.setWatched(ep1.id, true);
    storeA.local.setProgress(ep2.id, 45 * 60_000, 90 * 60_000);

    // ── provider metadata cache + a job ─────────────────────────────────────
    storeA.local.putProviderMetadata({
      provider: "tmdb",
      externalId: "tt0111161",
      entryId: manual.id,
      payload: { title: "Manual Movie", year: 1994 },
    });
    const job = storeA.local.enqueueJob("refresh-provider-metadata", { provider: "tmdb" });
    const claimed = storeA.local.claimNextJob();
    expect(claimed?.id).toBe(job.id);
    expect(storeA.local.completeJob(job.id).state).toBe("done");

    // ── backup (consistent snapshot via VACUUM INTO) ────────────────────────
    const backup = await createBackup(storeA, join(rootA, "backups", "snapshot.db"));
    expect(backup.hash).toMatch(/^[0-9a-f]{64}$/);

    // post-backup mutations must NOT survive the restore
    storeA.local.deleteLibraryEntry(ep1.id);
    storeA.local.createCollection("Post Backup");
    expect(storeA.local.findLibraryEntryByPath(ep1.path)).toBeNull();

    // ── restore (hash validated before overwrite) ───────────────────────────
    const restored = await restoreBackup({ backupPath: backup.path, targetBaseDir: rootB });
    expect(restored.hash).toBe(backup.hash);
    expect(existsSync(restored.dbPath)).toBe(true);

    const storeB = await open(rootB);
    expect(storeB.journalMode()).toBe("wal");

    // ── verify ───────────────────────────────────────────────────────────────
    expect(storeB.local.listLibraryEntries()).toHaveLength(3);
    const restoredEp1 = storeB.local.findLibraryEntryByPath(ep1.path);
    expect(restoredEp1?.fingerprint).toBe(ep1.fingerprint); // deleted post-backup → restored
    expect(storeB.local.findCollectionByName("Post Backup")).toBeNull();
    const restoredCollection = storeB.local.findCollectionByName("Movie Night");
    if (!restoredCollection) {
      throw new Error("collection missing after restore");
    }
    expect(storeB.local.listPlaylistItems(restoredCollection.id).map((i) => i.entryId)).toEqual([
      manual.id,
      ep1.id,
      ep2.id,
    ]);
    expect(storeB.local.getWatchedState(ep1.id)?.watched).toBe(true);
    const progress = storeB.local.getProgress(ep2.id);
    expect(progress?.positionMs).toBe(45 * 60_000);
    expect(progress?.percent).toBe(50);
    const metadata = storeB.local.getProviderMetadata("tmdb", "tt0111161");
    expect(metadata?.entryId).toBe(manual.id);
    expect(JSON.parse(metadata?.payload ?? "{}")).toEqual({ title: "Manual Movie", year: 1994 });
    expect(storeB.local.listJobs("done")).toHaveLength(1);

    // ── 30-day TTL sweep works on the restored store ────────────────────────
    const day = 86_400_000;
    storeB.local.putProviderMetadata({
      provider: "tmdb",
      externalId: "stale",
      payload: { old: true },
      now: Date.now() - 31 * day,
    });
    const sweep = await sweepProviderMetadata(storeB.local, {});
    expect(sweep.expired).toBe(1);
    expect(sweep.deleted).toBe(1);
    expect(sweep.refreshed).toBe(0);
    expect(storeB.local.getProviderMetadata("tmdb", "stale")).toBeNull();
    expect(storeB.local.getProviderMetadata("tmdb", "tt0111161")).not.toBeNull();
  });
});
