// P6-DURABLE-WEB-1 — the durable persistence ADAPTER unit tests (node
// environment; fake-indexeddb is the IndexedDB test double, injected per
// test through the bootstrap's deps — no global is touched).
//
// Pins, honestly:
// - the versioned database: name + schema version 1, the two object stores
//   created by the upgrade path;
// - the persistence-mode SETTING store: first-run read, explicit-write
//   roundtrip, fail-safe invalid-record read (the session-only default
//   applies, the record is not munged), the injected-clock provenance stamp;
// - the DURABLE ranker-selection store (the host's existing
//   RankerSelectionStore interface): null-when-absent, put/get roundtrip,
//   clear's existence reporting, and the typed WebFlixError on a corrupt
//   persisted record (never a silently-mangled record);
// - durability ACROSS connections: a fresh bootstrap over the same factory
//   still reads the records (the actual durability proof);
// - the typed DEGRADATION paths: undefined IndexedDB, a synchronously
//   throwing factory, a VersionError open failure — every one resolves
//   degraded with a plain reason, never throws, never rejects;
// - clearAll forgets both records (WF-029 retention control);
// - NO localStorage/sessionStorage tokens exist in this seam at all.
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { WebFlixError } from "webflix-contracts";

import {
  PERSISTENCE_DB_NAME,
  PERSISTENCE_DB_VERSION,
  bootstrapPersistence,
} from "../src/persistence";
import {
  PERSISTENCE_MODE_SETTING_KEY,
  RANKER_SELECTION_KEY,
  RANKER_SELECTION_STORE,
  SETTINGS_STORE,
  requestToPromise,
} from "../src/persistence/idb";

const FIXED_NOW = () => new Date("2026-10-12T12:00:00.000Z");

/** A valid selection record for roundtrips. */
const SELECTION = {
  adapterId: "webflix.built-in-ranker",
  selectedAt: "2026-10-12T12:00:00.000Z",
} as const;

/** Writes a RAW record straight into an object store (corrupt-record injection). */
async function rawPut(
  factory: IDBFactory,
  store: string,
  value: unknown,
  key?: IDBValidKey,
): Promise<void> {
  const openRequest = factory.open(PERSISTENCE_DB_NAME);
  openRequest.onupgradeneeded = () => {
    const db = openRequest.result;
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
      db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
    }
    if (!db.objectStoreNames.contains(RANKER_SELECTION_STORE)) {
      db.createObjectStore(RANKER_SELECTION_STORE);
    }
  };
  const db = await requestToPromise(openRequest);
  const tx = db.transaction(store, "readwrite");
  if (key === undefined) {
    tx.objectStore(store).put(value);
  } else {
    tx.objectStore(store).put(value, key);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

describe("the versioned persistence database", () => {
  it("opens the named database at schema version 1 with both object stores", async () => {
    const factory = new IDBFactory();
    const bootstrap = await bootstrapPersistence({ indexedDB: factory });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;

    const openRequest = factory.open(PERSISTENCE_DB_NAME, PERSISTENCE_DB_VERSION);
    const db = await requestToPromise(openRequest);
    expect(db.name).toBe(PERSISTENCE_DB_NAME);
    expect(db.version).toBe(PERSISTENCE_DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [RANKER_SELECTION_STORE, SETTINGS_STORE].sort(),
    );
    db.close();
  });

  it("pins the schema version constant (the additive-upgrade baseline)", () => {
    expect(PERSISTENCE_DB_VERSION).toBe(1);
    expect(PERSISTENCE_DB_NAME).toBe("webflix-web-client");
  });
});

describe("the persistence-mode setting store", () => {
  it("reads first-run when no setting record exists (the honest default)", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: new IDBFactory() });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    expect(bootstrap.settingStatus).toBe("first-run");
    expect(bootstrap.initialMode).toBe("session-only");
  });

  it("persists an explicit choice and reads it back across a fresh bootstrap", async () => {
    const factory = new IDBFactory();
    const first = await bootstrapPersistence({ indexedDB: factory, now: FIXED_NOW });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    await first.durable.modeStore.put("durable");

    const second = await bootstrapPersistence({ indexedDB: factory });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.initialMode).toBe("durable");
    expect(second.settingStatus).toBe("stored");
  });

  it("keeps an explicit session-only choice distinct from first-run", async () => {
    const factory = new IDBFactory();
    const first = await bootstrapPersistence({ indexedDB: factory, now: FIXED_NOW });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    await first.durable.modeStore.put("session-only");

    const second = await bootstrapPersistence({ indexedDB: factory });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.initialMode).toBe("session-only");
    expect(second.settingStatus).toBe("stored");
  });

  it("fails SAFE on an unreadable setting: the session-only default applies, reported as invalid", async () => {
    const factory = new IDBFactory();
    await rawPut(factory, SETTINGS_STORE, {
      key: PERSISTENCE_MODE_SETTING_KEY,
      value: "all-the-things",
      changedAt: "not-a-choice",
    });
    const bootstrap = await bootstrapPersistence({ indexedDB: factory });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    expect(bootstrap.settingStatus).toBe("invalid");
    expect(bootstrap.initialMode).toBe("session-only");
  });

  it("stamps changedAt from the injected clock (explicit provenance, never the wall clock directly)", async () => {
    const factory = new IDBFactory();
    const bootstrap = await bootstrapPersistence({ indexedDB: factory, now: FIXED_NOW });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    await bootstrap.durable.modeStore.put("durable");

    const read = await bootstrap.durable.modeStore.read();
    expect(read.kind).toBe("stored");
    if (read.kind !== "stored") return;
    expect(read.setting.changedAt).toBe("2026-10-12T12:00:00.000Z");
    expect(read.setting.value).toBe("durable");
    expect(read.setting.key).toBe(PERSISTENCE_MODE_SETTING_KEY);
  });
});

describe("the durable ranker-selection store (the existing RankerSelectionStore interface)", () => {
  it("reads null when no record exists", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: new IDBFactory() });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    expect(await bootstrap.durable.selectionStore.get()).toBeNull();
  });

  it("roundtrips a valid selection through put/get", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: new IDBFactory() });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    await bootstrap.durable.selectionStore.put(SELECTION);
    expect(await bootstrap.durable.selectionStore.get()).toEqual(SELECTION);
  });

  it("persists the selection ACROSS connections (a fresh bootstrap still reads it)", async () => {
    const factory = new IDBFactory();
    const first = await bootstrapPersistence({ indexedDB: factory });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    await first.durable.selectionStore.put(SELECTION);

    const second = await bootstrapPersistence({ indexedDB: factory });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(await second.durable.selectionStore.get()).toEqual(SELECTION);
  });

  it("clear reports existence honestly (false -> true -> false)", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: new IDBFactory() });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    const store = bootstrap.durable.selectionStore;

    expect(await store.clear()).toBe(false);
    await store.put(SELECTION);
    expect(await store.clear()).toBe(true);
    expect(await store.get()).toBeNull();
    expect(await store.clear()).toBe(false);
  });

  it("surfaces a CORRUPT persisted record as the typed WebFlixError (never a mangled record)", async () => {
    const factory = new IDBFactory();
    // A record that fails the locked RankerAdapterSelection schema.
    await rawPut(
      factory,
      RANKER_SELECTION_STORE,
      { adapterId: 42, selectedAt: "yesterday, maybe" },
      RANKER_SELECTION_KEY,
    );
    const bootstrap = await bootstrapPersistence({ indexedDB: factory });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;

    let thrown: unknown;
    try {
      await bootstrap.durable.selectionStore.get();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WebFlixError);
    const error = thrown as WebFlixError;
    expect(error.code).toBe("intelligence/adapter-selection-invalid");
    expect(error.reason).toContain("RankerAdapterSelection");
    // Presence is still honestly reported (the record occupies storage).
    expect(bootstrap.durableSelectionPresent).toBe(true);
  });

  it("rejects a corrupt PUT at the boundary (the same law as the in-memory double)", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: new IDBFactory() });
    expect(bootstrap.status).toBe("ok");
    if (bootstrap.status !== "ok") return;
    await expect(
      bootstrap.durable.selectionStore.put({
        adapterId: "",
        selectedAt: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(WebFlixError);
    // And nothing was written.
    expect(await bootstrap.durable.selectionStore.get()).toBeNull();
  });
});

describe("the typed degradation paths", () => {
  it("degrades when IndexedDB is undefined (reason surfaced, never a crash)", async () => {
    const bootstrap = await bootstrapPersistence({ indexedDB: undefined });
    expect(bootstrap.status).toBe("degraded");
    if (bootstrap.status !== "degraded") return;
    expect(bootstrap.reason).toContain("IndexedDB is not available");
    expect(bootstrap.initialMode).toBe("session-only");
  });

  it("degrades when the factory throws synchronously on open", async () => {
    const throwingFactory = {
      open: () => {
        throw new Error("SecurityError: storage access denied");
      },
    } as unknown as IDBFactory;
    const bootstrap = await bootstrapPersistence({ indexedDB: throwingFactory });
    expect(bootstrap.status).toBe("degraded");
    if (bootstrap.status !== "degraded") return;
    expect(bootstrap.reason).toContain("SecurityError");
    expect(bootstrap.initialMode).toBe("session-only");
  });

  it("degrades on an open error event (a VersionError from an older requested version)", async () => {
    const factory = new IDBFactory();
    // Create the database at a FUTURE version (2) first, so the bootstrap's
    // version-1 open hits a VersionError — the typed onerror path.
    const upgrade = factory.open(PERSISTENCE_DB_NAME, 2);
    upgrade.onupgradeneeded = () => {
      upgrade.result.createObjectStore("future-store");
    };
    const upgraded = await requestToPromise(upgrade);
    upgraded.close();

    const bootstrap = await bootstrapPersistence({ indexedDB: factory });
    expect(bootstrap.status).toBe("degraded");
    if (bootstrap.status !== "degraded") return;
    expect(bootstrap.reason).toContain("VersionError");
    expect(bootstrap.initialMode).toBe("session-only");
  });
});

describe("forget (the WF-029 retention control)", () => {
  it("clearAll wipes both the setting and the selection (a fresh bootstrap is first-run again)", async () => {
    const factory = new IDBFactory();
    const first = await bootstrapPersistence({ indexedDB: factory, now: FIXED_NOW });
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    await first.durable.modeStore.put("durable");
    await first.durable.selectionStore.put(SELECTION);

    await first.durable.clearAll();

    const second = await bootstrapPersistence({ indexedDB: factory });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(second.settingStatus).toBe("first-run");
    expect(second.initialMode).toBe("session-only");
    expect(second.durableSelectionPresent).toBe(false);
    expect(await second.durable.selectionStore.get()).toBeNull();
  });
});
