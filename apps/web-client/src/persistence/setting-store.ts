/**
 * P6-DURABLE-WEB-1 — the persistence-mode SETTING store (IndexedDB-backed,
 * the "settings" object store).
 *
 * The setting is the user's explicit, deliberate persistence-mode choice
 * (default session-only unless opted in). It is persisted in IndexedDB
 * ITSELF so the choice sticks across visits — read once at bootstrap,
 * BEFORE mount; written only on an explicit user change (never eagerly on
 * first run: a first run has no record, and none is invented).
 *
 * Read validation is fail-safe and total: an unreadable record (corrupt
 * value, wrong shape) resolves as the typed "invalid" outcome and the
 * session-only DEFAULT applies — never a crash, never a silently-mangled
 * record, never a durable claim the record cannot support. The invalid
 * record itself is not rewritten on read; it is replaced on the next
 * explicit change, or removed by the clear (forget) control.
 */

import {
  PERSISTENCE_MODE_SETTING_KEY,
  SETTINGS_STORE,
  requestToPromise,
  transactionDone,
} from "./idb";
import type { PersistenceMode } from "./mode";

/** The stored persistence-mode setting record (the one record this store owns). */
export interface PersistenceModeSetting {
  readonly key: string;
  readonly value: PersistenceMode;
  /** When the user last changed it (explicit provenance — the injected clock, never the wall clock directly). */
  readonly changedAt: string;
}

/** The typed read outcome: stored / first-run (no record) / invalid (unreadable record). */
export type PersistenceModeSettingRead =
  | { readonly kind: "stored"; readonly setting: PersistenceModeSetting }
  | { readonly kind: "first-run" }
  | { readonly kind: "invalid"; readonly detail: string };

function isPersistenceMode(value: unknown): value is PersistenceMode {
  return value === "session-only" || value === "durable";
}

/** Validates a raw stored record against the two-value union — total, never throws. */
function readSettingRecord(raw: unknown): PersistenceModeSettingRead {
  if (raw === null || raw === undefined) {
    return { kind: "first-run" };
  }
  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (
      record.key === PERSISTENCE_MODE_SETTING_KEY &&
      isPersistenceMode(record.value) &&
      typeof record.changedAt === "string"
    ) {
      return {
        kind: "stored",
        setting: {
          key: PERSISTENCE_MODE_SETTING_KEY,
          value: record.value,
          changedAt: record.changedAt,
        },
      };
    }
  }
  return {
    kind: "invalid",
    detail: "the stored record does not match the persistence-setting shape",
  };
}

/** The persistence-mode setting store: IndexedDB-backed, explicit writes only. */
export class PersistenceModeSettingStore {
  constructor(
    private readonly db: IDBDatabase,
    private readonly now: () => Date,
  ) {}

  /** Reads the setting — total: stored / first-run / invalid, never throws. */
  async read(): Promise<PersistenceModeSettingRead> {
    const tx = this.db.transaction(SETTINGS_STORE, "readonly");
    const raw = await requestToPromise(
      tx.objectStore(SETTINGS_STORE).get(PERSISTENCE_MODE_SETTING_KEY),
    );
    return readSettingRecord(raw);
  }

  /** Persists an explicit user choice (the only writer — no eager first-run write). */
  async put(mode: PersistenceMode): Promise<void> {
    const setting: PersistenceModeSetting = {
      key: PERSISTENCE_MODE_SETTING_KEY,
      value: mode,
      changedAt: this.now().toISOString(),
    };
    const tx = this.db.transaction(SETTINGS_STORE, "readwrite");
    tx.objectStore(SETTINGS_STORE).put(setting);
    await transactionDone(tx);
  }
}
