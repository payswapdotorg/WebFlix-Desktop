/**
 * P6-DURABLE-WEB-1 — the typed IndexedDB core of the durable adapter.
 *
 * A MINIMAL promise-wrapped surface over the browser's IndexedDB: the
 * versioned database open + the two object stores the host persists —
 * "settings" (the persistence-mode setting record) and "ranker-selection"
 * (the single ranker-adapter selection record). NO schema magic, NO
 * network, NO localStorage/sessionStorage (rg-provable: IndexedDB is the
 * one and only durable mechanism this host ever touches).
 *
 * Schema versioning — the native IndexedDB database version IS the schema
 * version:
 * - version 1 (this row): creates { settings (keyPath "key"),
 *   ranker-selection (out-of-line singleton key "current") }.
 * - FUTURE versions MUST bump PERSISTENCE_DB_VERSION and add ONLY
 *   additive upgrades inside onupgradeneeded (new stores / new indexes) —
 *   never mutate or drop an existing store's records in place. The honest
 *   migration ruling mirrors local-library's additive migration law.
 *
 * Every failure path is TYPED: openPersistenceDatabase never throws and
 * never rejects — an unavailable IndexedDB (undefined global, synchronous
 * SecurityError, VersionError, blocked upgrade) resolves as the typed
 * "unavailable" outcome so the bootstrap can degrade honestly to
 * session-only (fail-safe: never claim durable when it could not open).
 */

export const PERSISTENCE_DB_NAME = "webflix-web-client";
export const PERSISTENCE_DB_VERSION = 1;

/** The settings object store (keyPath "key" — one record per named setting). */
export const SETTINGS_STORE = "settings";
/** The ranker-selection object store (out-of-line key — exactly one record). */
export const RANKER_SELECTION_STORE = "ranker-selection";

/** The settings-store key for the persistence-mode setting record. */
export const PERSISTENCE_MODE_SETTING_KEY = "persistence-mode";
/** The singleton key for the one ranker-adapter selection record. */
export const RANKER_SELECTION_KEY = "current";

/** Promise wrapper over an IDBRequest (rejects with the request's own error). */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("unknown IndexedDB request error"));
    };
  });
}

/** Promise wrapper over an IDBTransaction's completion (commit or abort). */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction error"));
    };
  });
}

/** The typed open outcome: a live connection, or the named reason it is unavailable. */
export type OpenPersistenceResult =
  | { readonly status: "open"; readonly db: IDBDatabase }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Opens (or creates + upgrades) the versioned persistence database.
 * Total: never throws, never rejects — every failure resolves as the typed
 * "unavailable" outcome with a plain-language reason.
 */
export function openPersistenceDatabase(indexedDB: IDBFactory): Promise<OpenPersistenceResult> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(PERSISTENCE_DB_NAME, PERSISTENCE_DB_VERSION);
    } catch (err) {
      // Some environments throw synchronously (e.g. SecurityError) — typed
      // degradation, never a crash at the composition root.
      resolve({
        status: "unavailable",
        reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return;
    }
    request.onupgradeneeded = () => {
      // The version-N schema — additive only (see the module comment).
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(RANKER_SELECTION_STORE)) {
        db.createObjectStore(RANKER_SELECTION_STORE);
      }
    };
    request.onsuccess = () => {
      resolve({ status: "open", db: request.result });
    };
    request.onerror = () => {
      const error = request.error;
      resolve({
        status: "unavailable",
        reason:
          error !== null && error !== undefined
            ? `${error.name}: ${error.message}`
            : "the IndexedDB open request failed without an error",
      });
    };
    request.onblocked = () => {
      // A rare multi-tab upgrade contention: another connection holds an
      // older version open. Degrading here is fail-safe (the mode falls
      // back to session-only; nothing is claimed durable that is not).
      resolve({
        status: "unavailable",
        reason: "another tab holds an older version of this database open",
      });
    };
  });
}
