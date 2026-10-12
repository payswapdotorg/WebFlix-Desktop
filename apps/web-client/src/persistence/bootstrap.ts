/**
 * P6-DURABLE-WEB-1 — the BOOTSTRAP READ, typed (the work order's row 3:
 * "persisted in IndexedDB itself — a bootstrap read before mount;
 * first-run default session-only").
 *
 * bootstrapPersistence() runs ONCE before the App mounts (see main.tsx):
 * it probes IndexedDB and reads the persisted setting + the durable
 * selection's presence, resolving as exactly one of two typed outcomes:
 * - "ok": the durable stores are live; initialMode is the stored choice
 *   (first-run default session-only; an unreadable setting fails SAFE to
 *   the session-only default and is reported as "invalid", never munged);
 * - "degraded": IndexedDB is unavailable (undefined global, open failure,
 *   blocked upgrade) — the typed fallback to session-only, reason
 *   surfaced in the UI. The bootstrap is TOTAL: it never throws and never
 *   rejects, so mount never depends on an untyped crash path.
 *
 * NO network, NO localStorage/sessionStorage — IndexedDB is the only
 * mechanism probed or used (rg-provable).
 */

import { openPersistenceDatabase } from "./idb";
import { RANKER_SELECTION_STORE, SETTINGS_STORE, transactionDone } from "./idb";
import { DEFAULT_PERSISTENCE_MODE } from "./mode";
import type { PersistenceMode } from "./mode";
import { PersistenceModeSettingStore } from "./setting-store";
import { DurableRankerSelectionStore } from "./selection-store";

/** The durable persistence handle the host keeps when IndexedDB opens. */
export interface DurablePersistence {
  /** The persistence-mode setting store (the opt-in choice, persisted in IndexedDB itself). */
  readonly modeStore: PersistenceModeSettingStore;
  /** The durable ranker-selection store (the host's existing store interface, IndexedDB-backed). */
  readonly selectionStore: DurableRankerSelectionStore;
  /** FORGET (WF-029 retention honesty): clears every persisted record — the setting and the selection. */
  clearAll(): Promise<void>;
}

/** The bootstrap's "ok" outcome: durable stores live + the honest initial state. */
export interface PersistenceBootstrapOk {
  readonly status: "ok";
  readonly durable: DurablePersistence;
  /** The mode that is ACTUALLY active at mount (the stored choice, or the first-run default). */
  readonly initialMode: PersistenceMode;
  /** The setting record's typed read outcome (first-run / stored / invalid). */
  readonly settingStatus: "first-run" | "stored" | "invalid";
  /** Whether a durable selection record exists (the leftover-data honesty line when session-only). */
  readonly durableSelectionPresent: boolean;
}

/** The bootstrap's "degraded" outcome: IndexedDB unavailable — typed session-only fallback. */
export interface PersistenceBootstrapDegraded {
  readonly status: "degraded";
  /** The plain-language reason, surfaced in the UI (never swallowed). */
  readonly reason: string;
  readonly initialMode: "session-only";
}

export type PersistenceBootstrap = PersistenceBootstrapOk | PersistenceBootstrapDegraded;

/** Injectable bootstrap dependencies (tests inject a factory + a fixed clock). */
export interface BootstrapPersistenceDeps {
  /** The IndexedDB factory to probe (default: the global — undefined degrades honestly). */
  readonly indexedDB?: IDBFactory;
  /** The clock for setting provenance stamps (default: the real clock, injected once here). */
  readonly now?: () => Date;
}

/**
 * The bootstrap read — BEFORE mount. Probes IndexedDB, reads the persisted
 * mode setting, and reads the durable selection's presence. Total: the
 * only "durable" outcome is one where the database actually opened.
 */
export async function bootstrapPersistence(
  deps: BootstrapPersistenceDeps = {},
): Promise<PersistenceBootstrap> {
  const indexedDB = deps.indexedDB ?? globalThis.indexedDB;
  if (indexedDB === undefined || indexedDB === null) {
    return {
      status: "degraded",
      reason: "IndexedDB is not available in this environment",
      initialMode: "session-only",
    };
  }
  const opened = await openPersistenceDatabase(indexedDB);
  if (opened.status === "unavailable") {
    return { status: "degraded", reason: opened.reason, initialMode: "session-only" };
  }
  const db = opened.db;
  const now = deps.now ?? (() => new Date());
  const modeStore = new PersistenceModeSettingStore(db, now);
  const selectionStore = new DurableRankerSelectionStore(db);

  const clearAll = async (): Promise<void> => {
    const tx = db.transaction([SETTINGS_STORE, RANKER_SELECTION_STORE], "readwrite");
    tx.objectStore(SETTINGS_STORE).clear();
    tx.objectStore(RANKER_SELECTION_STORE).clear();
    await transactionDone(tx);
  };

  const read = await modeStore.read();
  let initialMode: PersistenceMode = DEFAULT_PERSISTENCE_MODE;
  let settingStatus: "first-run" | "stored" | "invalid" = "first-run";
  if (read.kind === "stored") {
    initialMode = read.setting.value;
    settingStatus = "stored";
  } else if (read.kind === "invalid") {
    settingStatus = "invalid";
  }

  // Presence, not content: an unreadable record still occupies storage and
  // is honestly reported as present (the leftover note + clear control
  // cover it) — its content is never invented.
  const durableSelectionPresent = await selectionStore.get().then(
    (stored) => stored !== null,
    () => true,
  );

  return {
    status: "ok",
    durable: { modeStore, selectionStore, clearAll },
    initialMode,
    settingStatus,
    durableSelectionPresent,
  };
}
