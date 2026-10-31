/**
 * Durable watch-history store tests (WFX-DURABLE-LIB-1): the `watch_history`
 * sqlite seam (migration 0008) — round-trips (full + honest-absent), the
 * upsert-by-item_id semantics (one row per item, newest watch wins, watching
 * again IS the §7.5 payload refresh), progress writes (existing rows only —
 * the session seam's no-op-for-unknown semantics), the continue-watching
 * 95% filter, the 30-day TTL sweep (provider payloads refresh-or-delete;
 * the local provider exempt; facts survive a sweep), corrupt-payload
 * degradation (facts kept, card dropped, never a thrown list), write
 * validation (typed ValidationError), retention clear with honest counts,
 * restart durability, the pre-migration regression (an 0001–0007 store file
 * applies 0008 forward with all prior data intact), and per-profile
 * isolation (ADR-0003 — every case opens its own temp-root store).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CatalogItem } from "webflix-contracts";
import {
  ALL_MIGRATIONS,
  LocalStore,
  openStore,
  runMigrations,
  createSqliteDatabase,
  WebFlixStore,
  ValidationError,
} from "../index";

const T0 = 1793440000000;
/** The pinned clock's tick helper: base + n minutes. */
const at = (minutes: number): number => T0 + minutes * 60_000;

let dir: string;
let store: WebFlixStore;
let clockNow: number;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "webflix-watch-history-"));
  clockNow = T0;
  store = await openStore({ baseDir: dir, now: () => clockNow });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const youtubeItem = (id: string, title: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title,
  mediaKind: "video",
  assets: [],
  metadata: { author: "MrBeast" },
});

const localItem = (id: string, title: string): CatalogItem => ({
  id,
  providerId: "local",
  title,
  mediaKind: "local-file",
  assets: [],
  metadata: { osPath: "/tmp/some/file.mkv" },
});

describe("SqliteWatchHistoryStore round-trips + upsert semantics", () => {
  it("records a watch and reads it back with the payload and facts", () => {
    const record = store.watchHistory.recordWatch({
      itemId: "youtube:video:abc",
      providerId: "youtube",
      item: youtubeItem("youtube:video:abc", "Amp Hour"),
      positionMs: 0,
    });
    expect(record.itemId).toBe("youtube:video:abc");
    expect(record.item?.title).toBe("Amp Hour");
    expect(record.payloadFetchedAt).toBe(T0);
    expect(record.positionMs).toBe(0);

    const fetched = store.watchHistory.get("youtube:video:abc");
    expect(fetched?.item?.providerId).toBe("youtube");
    expect(fetched?.watchedAt).toBe(T0);

    expect(store.watchHistory.get("youtube:video:nope")).toBeNull();
  });

  it("keeps ONE row per item — the latest watch wins and refreshes the payload", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:abc",
      providerId: "youtube",
      item: youtubeItem("youtube:video:abc", "Amp Hour"),
    });
    clockNow = at(10);
    store.watchHistory.recordWatch({
      itemId: "youtube:video:abc",
      providerId: "youtube",
      item: youtubeItem("youtube:video:abc", "Amp Hour (fixed title)"),
      positionMs: 1200,
      durationMs: 90_000,
    });
    expect(store.watchHistory.countHistory()).toBe(1);
    const list = store.watchHistory.listHistory();
    expect(list).toHaveLength(1);
    expect(list[0]?.item?.title).toBe("Amp Hour (fixed title)");
    expect(list[0]?.payloadFetchedAt).toBe(at(10));
    expect(list[0]?.positionMs).toBe(1200);
    expect(list[0]?.durationMs).toBe(90_000);
  });

  it("lists newest watch first with a stable item-id tiebreak and honors the limit", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:a",
      providerId: "youtube",
      item: youtubeItem("youtube:video:a", "First"),
    });
    clockNow = at(5);
    store.watchHistory.recordWatch({
      itemId: "youtube:video:b",
      providerId: "youtube",
      item: youtubeItem("youtube:video:b", "Second"),
    });
    clockNow = at(2);
    store.watchHistory.recordWatch({
      itemId: "youtube:video:c",
      providerId: "youtube",
      item: youtubeItem("youtube:video:c", "Third"),
    });
    const ids = store.watchHistory.listHistory().map((record) => record.itemId);
    expect(ids).toEqual(["youtube:video:b", "youtube:video:c", "youtube:video:a"]);
    expect(store.watchHistory.listHistory(2)).toHaveLength(2);
    expect(store.watchHistory.listHistory(2)[0]?.itemId).toBe("youtube:video:b");
  });

  it("rejects malformed writes with the lane's typed ValidationError", () => {
    expect(() =>
      store.watchHistory.recordWatch({
        itemId: "",
        providerId: "youtube",
        item: youtubeItem("x", "X"),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      store.watchHistory.recordWatch({
        itemId: "youtube:video:mismatch",
        providerId: "youtube",
        item: youtubeItem("youtube:video:other", "Mismatch"),
      }),
    ).toThrow(ValidationError);
    expect(() =>
      store.watchHistory.recordWatch({
        itemId: "youtube:video:bad",
        providerId: "",
        item: youtubeItem("youtube:video:bad", "Bad"),
      }),
    ).toThrow(ValidationError);
    // A schema-invalid CatalogItem is a typed write refusal, never persisted.
    expect(() =>
      store.watchHistory.recordWatch({
        itemId: "youtube:video:bad",
        providerId: "youtube",
        item: { id: "youtube:video:bad" } as unknown as CatalogItem,
      }),
    ).toThrow(ValidationError);
    expect(store.watchHistory.countHistory()).toBe(0);
  });
});

describe("SqliteWatchHistoryStore progress", () => {
  it("updates an existing row's position and duration", () => {
    store.watchHistory.recordWatch({
      itemId: "local:1",
      providerId: "local",
      item: localItem("local:1", "Holiday cut"),
      durationMs: null,
    });
    const updated = store.watchHistory.recordProgress({
      itemId: "local:1",
      positionMs: 41_000,
      durationMs: 120_000,
    });
    expect(updated?.positionMs).toBe(41_000);
    expect(updated?.durationMs).toBe(120_000);
    expect(store.watchHistory.get("local:1")?.positionMs).toBe(41_000);
  });

  it("keeps the stored duration when a progress write omits it (COALESCE)", () => {
    store.watchHistory.recordWatch({
      itemId: "local:1",
      providerId: "local",
      item: localItem("local:1", "Holiday cut"),
      durationMs: 120_000,
    });
    const updated = store.watchHistory.recordProgress({ itemId: "local:1", positionMs: 5_000 });
    expect(updated?.durationMs).toBe(120_000);
  });

  it("is a no-op for an unknown item — never mints a row (the session seam's semantics)", () => {
    expect(
      store.watchHistory.recordProgress({ itemId: "local:never-watched", positionMs: 100 }),
    ).toBeNull();
    expect(store.watchHistory.countHistory()).toBe(0);
  });

  it("normalizes negative and non-finite positions to 0", () => {
    store.watchHistory.recordWatch({
      itemId: "local:1",
      providerId: "local",
      item: localItem("local:1", "Holiday cut"),
    });
    const updated = store.watchHistory.recordProgress({
      itemId: "local:1",
      positionMs: Number.NaN,
    });
    expect(updated?.positionMs).toBe(0);
  });
});

describe("SqliteWatchHistoryStore continue-watching filter", () => {
  it("excludes near-complete entries (>= 95% of a known duration) from continue but not history", () => {
    store.watchHistory.recordWatch({
      itemId: "local:almost",
      providerId: "local",
      item: localItem("local:almost", "Almost done"),
      positionMs: 95_000,
      durationMs: 100_000,
    });
    store.watchHistory.recordWatch({
      itemId: "local:midway",
      providerId: "local",
      item: localItem("local:midway", "Halfway"),
      positionMs: 50_000,
      durationMs: 100_000,
    });
    store.watchHistory.recordWatch({
      itemId: "local:unknown-dur",
      providerId: "local",
      item: localItem("local:unknown-dur", "No duration"),
      positionMs: 5_000,
    });
    const continueIds = store.watchHistory.listContinueWatching().map((r) => r.itemId);
    // Equal watchedAt instants (the pinned clock) fall to the stable item-id tiebreak.
    expect(continueIds).toEqual(["local:midway", "local:unknown-dur"]);
    expect(store.watchHistory.listHistory()).toHaveLength(3);
  });
});

describe("SqliteWatchHistoryStore TTL sweep (freeze §7.5)", () => {
  it("nulls provider payloads older than 30 days — facts survive, rows stop rendering", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:old",
      providerId: "youtube",
      item: youtubeItem("youtube:video:old", "Old watch"),
    });
    clockNow = T0 + 31 * 24 * 60 * 60 * 1000;
    store.watchHistory.recordWatch({
      itemId: "youtube:video:fresh",
      providerId: "youtube",
      item: youtubeItem("youtube:video:fresh", "Fresh watch"),
    });
    const degraded = store.watchHistory.sweepExpiredPayloads();
    expect(degraded).toBe(1);
    // Facts survive: the row is still counted.
    expect(store.watchHistory.countHistory()).toBe(2);
    // The view only renders payload-bearing rows.
    const viewIds = store.watchHistory.listHistory().map((r) => r.itemId);
    expect(viewIds).toEqual(["youtube:video:fresh"]);
    // The degraded row reads back as facts-only.
    const oldRow = store.watchHistory.get("youtube:video:old");
    expect(oldRow?.item).toBeNull();
    expect(oldRow?.payloadFetchedAt).toBeNull();
    expect(oldRow?.positionMs).toBe(0);
  });

  it("exempts the local provider (WebFlix-owned metadata end-to-end)", () => {
    store.watchHistory.recordWatch({
      itemId: "local:keep",
      providerId: "local",
      item: localItem("local:keep", "Holiday cut"),
    });
    clockNow = T0 + 400 * 24 * 60 * 60 * 1000;
    expect(store.watchHistory.sweepExpiredPayloads()).toBe(0);
    expect(store.watchHistory.listHistory()[0]?.itemId).toBe("local:keep");
  });

  it("treats watching again as the refresh — a re-watched row survives a later sweep", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:again",
      providerId: "youtube",
      item: youtubeItem("youtube:video:again", "Rewatched"),
    });
    clockNow = T0 + 40 * 24 * 60 * 60 * 1000;
    // The user watches the item again at day 40 — payload re-stamped fresh.
    store.watchHistory.recordWatch({
      itemId: "youtube:video:again",
      providerId: "youtube",
      item: youtubeItem("youtube:video:again", "Rewatched"),
    });
    expect(store.watchHistory.sweepExpiredPayloads()).toBe(0);
    expect(store.watchHistory.listHistory()[0]?.payloadFetchedAt).toBe(clockNow);
  });
});

describe("SqliteWatchHistoryStore corrupt-payload degradation + retention", () => {
  it("degrades a corrupt/tampered payload to facts-only — never a mangled card, never a thrown list", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:corrupt",
      providerId: "youtube",
      item: youtubeItem("youtube:video:corrupt", "Will be tampered"),
    });
    store.db
      .prepare("UPDATE watch_history SET item_payload = '{not json' WHERE item_id = ?")
      .run("youtube:video:corrupt");
    // The list does NOT throw; the row drops from the view, facts stay countable.
    expect(store.watchHistory.listHistory()).toEqual([]);
    expect(store.watchHistory.countHistory()).toBe(1);
    expect(store.watchHistory.get("youtube:video:corrupt")?.item).toBeNull();
  });

  it("clears every row and reports the honest removed count (the WF-021 history reset scope)", () => {
    store.watchHistory.recordWatch({
      itemId: "youtube:video:a",
      providerId: "youtube",
      item: youtubeItem("youtube:video:a", "A"),
    });
    store.watchHistory.recordWatch({
      itemId: "local:b",
      providerId: "local",
      item: localItem("local:b", "B"),
    });
    expect(store.watchHistory.clearHistory()).toBe(2);
    expect(store.watchHistory.countHistory()).toBe(0);
    expect(store.watchHistory.clearHistory()).toBe(0);
  });
});

describe("SqliteWatchHistoryStore durability + migration", () => {
  it("survives a restart (reopen the same baseDir — rows intact, facts and payloads)", async () => {
    store.watchHistory.recordWatch({
      itemId: "local:1",
      providerId: "local",
      item: localItem("local:1", "Holiday cut"),
      positionMs: 33_000,
      durationMs: 120_000,
    });
    store.close();
    const reopened = await openStore({ baseDir: dir, now: () => clockNow });
    try {
      const row = reopened.watchHistory.get("local:1");
      expect(row?.positionMs).toBe(33_000);
      expect(row?.durationMs).toBe(120_000);
      expect(row?.item?.title).toBe("Holiday cut");
    } finally {
      reopened.close();
    }
  });

  it("applies 0008 forward on a pre-0008 store file with all prior data intact", async () => {
    // A genuine pre-wave store file: a FRESH dir, migrations 0001–0007 only,
    // and one durable library fact written through the pre-wave surface.
    const preDir = mkdtempSync(join(tmpdir(), "webflix-watch-history-pre0008-"));
    try {
      const db = await createSqliteDatabase(join(preDir, "webflix.db"));
      runMigrations(db, ALL_MIGRATIONS.slice(0, 7));
      const preLocal = new LocalStore(db);
      preLocal.addLibraryEntry({ path: "/tmp/pre-existing.mkv", title: "Pre-existing" });
      db.close();
      // The full open (the wave's runtime path) applies 0008 forward.
      const reopened = await openStore({ baseDir: preDir, now: () => clockNow });
      try {
        const entries = reopened.local.listLibraryEntries();
        expect(entries.some((entry) => entry.title === "Pre-existing")).toBe(true);
        reopened.watchHistory.recordWatch({
          itemId: "local:post",
          providerId: "local",
          item: localItem("local:post", "Post-migration watch"),
        });
        expect(reopened.watchHistory.countHistory()).toBe(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(preDir, { recursive: true, force: true });
    }
  });
});
