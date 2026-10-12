/**
 * Durable ranker-adapter selection store tests (P4-ADAPTERS row 2): the
 * sqlite-backed RankerSelectionStore on the local-library seam — restart
 * round-trip (write -> close -> reopen -> read identical), replace and
 * clear/replace semantics, clear-resets-to-default honesty, per-profile
 * isolation, the honest migration of pre-0003 store files, and typed
 * WebFlixErrors on corrupt rows.
 *
 * HERMETIC: temp dirs only (the store refuses ~/.webflix under tests);
 * no network, no wall clock (the epoch-ms clock is injected and pinned).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { RankerAdapterSelection } from "webflix-contracts";
import {
  migration0001Init,
  migration0002MediaIntelligence,
  migration0003RankerAdapterSelection,
  openStore,
  runMigrations,
  createSqliteDatabase,
  SqliteRankerSelectionStore,
  type WebFlixStore,
} from "../index";

const AS_OF = "2026-10-11T09:30:00Z";
const AS_OF_MS = 1791715800000;

const selection = (over: Partial<RankerAdapterSelection> = {}): RankerAdapterSelection => ({
  adapterId: "webflix.built-in-ranker",
  selectedAt: AS_OF,
  ...over,
});

/** Pinned epoch-ms clock — no wall time anywhere in these tests. */
const pinnedClock = (): (() => number) => () => AS_OF_MS;

async function expectWebFlixErrorAsync(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

describe("durable ranker-adapter selection store (sqlite seam, temp dirs)", () => {
  let dir: string;
  const opened: WebFlixStore[] = [];

  const open = async (baseDir: string): Promise<WebFlixStore> => {
    const store = await openStore({ baseDir, now: pinnedClock() });
    opened.push(store);
    return store;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webflix-ranker-selection-"));
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

  // -------------------------------------------------------------------------
  // Durability: restart round-trip + replace + clear
  // -------------------------------------------------------------------------

  it("round-trips the selection identically through a restart (write -> close -> reopen -> read)", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());

    store.close();
    const reopened = await open(dir);
    expect(await reopened.rankerAdapterSelection.get()).toEqual(selection());
  });

  it("get() returns null before any selection is set (never-set, not a stored default)", async () => {
    const store = await open(dir);
    expect(await store.rankerAdapterSelection.get()).toBeNull();
  });

  it("put replaces the selection wholesale — the CURRENT choice survives the restart, earlier ones do not", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());
    await store.rankerAdapterSelection.put(
      selection({ adapterId: "webflix.later-adapter", selectedAt: "2026-10-12T00:00:00Z" }),
    );

    store.close();
    const reopened = await open(dir);
    expect(await reopened.rankerAdapterSelection.get()).toEqual({
      adapterId: "webflix.later-adapter",
      selectedAt: "2026-10-12T00:00:00Z",
    });
  });

  it("clear deletes the selection and reports true; clear again reports false — resetting honestly, never an error state", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());

    expect(await store.rankerAdapterSelection.clear()).toBe(true);
    expect(await store.rankerAdapterSelection.get()).toBeNull();
    expect(await store.rankerAdapterSelection.clear()).toBe(false);

    // The reset survives the restart (no zombie row).
    store.close();
    const reopened = await open(dir);
    expect(await reopened.rankerAdapterSelection.get()).toBeNull();
  });

  it("the singleton row is the only row (one selection per profile, structurally)", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());
    await store.rankerAdapterSelection.put(selection({ adapterId: "webflix.another-adapter" }));
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM mi_ranker_selection").get();
    expect(Number(rows?.["n"])).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Per-profile isolation (ADR-0003)
  // -------------------------------------------------------------------------

  it("selections are isolated per profile (two baseDirs never see each other's choice)", async () => {
    const dirB = mkdtempSync(join(tmpdir(), "webflix-ranker-selection-b-"));
    try {
      const profileA = await open(dir);
      const profileB = await open(dirB);

      await profileA.rankerAdapterSelection.put(selection({ adapterId: "webflix.adapter-a" }));
      await profileB.rankerAdapterSelection.put(selection({ adapterId: "webflix.adapter-b" }));

      expect((await profileA.rankerAdapterSelection.get())?.adapterId).toBe("webflix.adapter-a");
      expect((await profileB.rankerAdapterSelection.get())?.adapterId).toBe("webflix.adapter-b");

      profileB.close();
      const reopenedB = await open(dirB);
      expect((await reopenedB.rankerAdapterSelection.get())?.adapterId).toBe("webflix.adapter-b");
    } finally {
      rmSync(dirB, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Honest migration of pre-0003 store files
  // -------------------------------------------------------------------------

  it("a pre-0003 store file (0001+0002 only) applies the later additive migrations on its next open — library data intact, no selection yet", async () => {
    // Build an old-generation store by hand: run ONLY migrations 0001+0002.
    const raw = await createSqliteDatabase(join(dir, "webflix.db"));
    runMigrations(raw, [migration0001Init, migration0002MediaIntelligence], AS_OF_MS);
    raw.exec(
      "CREATE TABLE IF NOT EXISTS _old_gen_probe (id INTEGER PRIMARY KEY, note TEXT NOT NULL)",
    );
    raw.prepare("INSERT INTO _old_gen_probe (id, note) VALUES (1, 'pre-0003 data')").run();
    raw.close();

    // Open through the normal path: 0003 AND 0004 (P4-SUMMARIZE appended
    // it) apply additively, the probe table survives untouched
    // (additive-only), and there is no selection (never-set).
    const store = await open(dir);
    const probe = store.db.prepare("SELECT note FROM _old_gen_probe WHERE id = 1").get();
    expect(probe?.["note"]).toBe("pre-0003 data");
    expect(await store.rankerAdapterSelection.get()).toBeNull();

    const migrations = store.db.prepare("SELECT name FROM schema_migrations ORDER BY id").all();
    expect(migrations.map((row) => String(row["name"]))).toEqual([
      "0001_init",
      "0002_media_intelligence",
      "0003_ranker_adapter_selection",
      "0004_transcript_payloads",
      "0005_text_and_audio_payloads",
      "0006_ad_center_stores",
      "0007_ad_offer_verification_store",
    ]);
  });

  // -------------------------------------------------------------------------
  // Typed errors — corrupt rows and invalid writes
  // -------------------------------------------------------------------------

  it("a corrupt selection_json row surfaces as a typed WebFlixError on get — never a mangled record", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());
    store.db.exec("UPDATE mi_ranker_selection SET selection_json = '{not json' WHERE id = 1");

    const wfe = await expectWebFlixErrorAsync(
      () => store.rankerAdapterSelection.get(),
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    );
    expect(wfe.reason).toContain("not valid JSON");
  });

  it("a tampered-but-valid-JSON row that violates the locked schema surfaces as a typed WebFlixError", async () => {
    const store = await open(dir);
    await store.rankerAdapterSelection.put(selection());
    store.db
      .prepare("UPDATE mi_ranker_selection SET selection_json = ? WHERE id = 1")
      .run(JSON.stringify({ adapterId: "", selectedAt: AS_OF }));

    const wfe = await expectWebFlixErrorAsync(
      () => store.rankerAdapterSelection.get(),
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    );
    expect(wfe.reason).toContain("RankerAdapterSelection");
  });

  it("put validates the record shape on write (typed rejection, nothing stored)", async () => {
    const store = await open(dir);
    await expectWebFlixErrorAsync(
      () => store.rankerAdapterSelection.put({ adapterId: "", selectedAt: AS_OF }),
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.rankerAdapterSelection.put({
          adapterId: "webflix.built-in-ranker",
          selectedAt: "2026-10-11 09:30:00",
        }),
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    );
    expect(await store.rankerAdapterSelection.get()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Structural honesty — the store does not know the registry
  // -------------------------------------------------------------------------

  it("a well-formed selection for an adapter NO current registry knows still persists (registry validation is the use case's job; drift is resolved honestly upstream)", async () => {
    const store = await open(dir);
    const future = selection({ adapterId: "webflix.adapter-removed-later" });
    await store.rankerAdapterSelection.put(future);
    expect(await store.rankerAdapterSelection.get()).toEqual(future);
  });
});

// ---------------------------------------------------------------------------
// Direct-adapter tests (bypassing openStore — the composition root may build
// the adapter over any migrated handle)
// ---------------------------------------------------------------------------

describe("SqliteRankerSelectionStore (direct construction)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webflix-ranker-selection-direct-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("stamps stored_at from the injected clock (pinned, no wall time) and exposes the singleton row honestly", async () => {
    const db = await createSqliteDatabase(join(dir, "webflix.db"));
    try {
      runMigrations(db, [
        migration0001Init,
        migration0002MediaIntelligence,
        migration0003RankerAdapterSelection,
      ]);
      const store = new SqliteRankerSelectionStore(db, { now: pinnedClock() });
      await store.put(selection());
      const row = db
        .prepare("SELECT adapter_id, selected_at, stored_at FROM mi_ranker_selection WHERE id = 1")
        .get();
      expect(row?.["adapter_id"]).toBe("webflix.built-in-ranker");
      expect(row?.["selected_at"]).toBe(AS_OF);
      expect(Number(row?.["stored_at"])).toBe(AS_OF_MS);
    } finally {
      db.close();
    }
  });
});
