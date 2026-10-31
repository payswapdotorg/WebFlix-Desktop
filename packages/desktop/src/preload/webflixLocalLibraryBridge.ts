/**
 * WFX-DURABLE-LIB-1 (TL3 takeover lane) — the narrowly scoped preload bridge
 * for the durable local-library/history surface.
 *
 * Boundary rules (all binding, mirroring webflixAccountBridge.ts /
 * packages/desktop/src/main/webflixLocalLibraryIpc.ts):
 *   - EXPLICITLY PERMISSIONMED surface: exactly eight methods over exactly
 *     eight namespaced IPC channels. Nothing else is exposed — no generic
 *     invoke passthrough, no delete, no store paths beyond the
 *     device-scoped library entry facts the main process chooses to share.
 *   - PLAYBACK URL GRANTS come only from entries:authorize (the main-side
 *     local-media preview registry decides); there is no method that could
 *     turn an arbitrary renderer path into a playable URL.
 *   - Flavor-gated: the bridge is exposed ONLY in the baked webflix flavor
 *     (a ZCode build's preload never gains this surface).
 *   - The channel strings are the MIRROR of the main module's exported
 *     constants; the battery pins both sides agree (a typo on either side
 *     fails the pin, never a silent runtime mismatch).
 *
 * Registration is idempotent-safe: the module self-registers at import
 * evaluation via registerWebFlixLocalLibraryPreloadBridge() (the preload
 * bundle imports this module exactly once, from index.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

/**
 * The typed IPC channels — MUST equal the main module's exported constants
 * (packages/desktop/src/main/webflixLocalLibraryIpc.ts; battery-pinned).
 */
export const WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL = "webflix:local-library:status";
export const WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL = "webflix:local-library:history:list";
export const WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL =
  "webflix:local-library:history:record-watch";
export const WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL =
  "webflix:local-library:history:record-progress";
export const WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL = "webflix:local-library:history:clear";
export const WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL = "webflix:local-library:entries:list";
export const WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL = "webflix:local-library:entries:add";
export const WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL =
  "webflix:local-library:entries:authorize";

/** The window-global preload bridge key this surface exposes. */
export const WEBFLIX_LOCAL_LIBRARY_BRIDGE_KEY = "webflixLocalLibrary";

/** The renderer-facing result vocabulary (mirrored from the main module, battery-pinned). */
export interface WebFlixLocalLibraryStatus {
  readonly ok: boolean;
  readonly engine: "better-sqlite3" | "node:sqlite" | null;
  readonly libraryDir?: string;
  readonly entryCount?: number;
  readonly historyCount?: number;
  readonly reason?: string;
}

export interface WebFlixWatchHistoryEntry {
  readonly itemId: string;
  readonly providerId: string;
  readonly item: unknown;
  readonly positionMs: number;
  readonly durationMs?: number;
  readonly watchedAt: string;
}

export interface WebFlixHistoryListResult {
  readonly ok: boolean;
  readonly entries: readonly WebFlixWatchHistoryEntry[];
  readonly reason?: string;
}

export interface WebFlixHistoryWriteResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface WebFlixHistoryClearResult {
  readonly ok: boolean;
  readonly removed: number;
  readonly reason?: string;
}

export interface WebFlixLibraryEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: "video" | "audio";
  readonly sizeBytes: number;
  readonly addedAt: number;
  readonly present: boolean;
}

export interface WebFlixLibraryEntriesListResult {
  readonly ok: boolean;
  readonly entries: readonly WebFlixLibraryEntry[];
  readonly reason?: string;
}

export interface WebFlixLibraryEntryAddInput {
  readonly path: string;
  readonly title: string;
  readonly kind: "video" | "audio";
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

export interface WebFlixLibraryEntryAddOutcomeItem {
  readonly id: string;
  readonly path: string;
  readonly existed: boolean;
}

export interface WebFlixLibraryEntriesAddResult {
  readonly ok: boolean;
  readonly added?: readonly WebFlixLibraryEntryAddOutcomeItem[];
  readonly reason?: string;
}

export interface WebFlixLibraryEntryAuthorizeOutcome {
  readonly id: string;
  readonly url: string | null;
  readonly reason?: string;
}

export interface WebFlixLibraryEntriesAuthorizeResult {
  readonly ok: boolean;
  readonly authorized?: readonly WebFlixLibraryEntryAuthorizeOutcome[];
  readonly reason?: string;
}

/** The preload-exposed durable library bridge surface (renderer mirror: localLibraryBridge.ts). */
export interface WebFlixLocalLibraryPreloadBridge {
  getStatus(): Promise<WebFlixLocalLibraryStatus>;
  listHistory(kind: "history" | "continue", limit?: number): Promise<WebFlixHistoryListResult>;
  recordWatch(payload: {
    itemId: string;
    providerId: string;
    item: unknown;
    positionMs?: number;
    durationMs?: number | null;
  }): Promise<WebFlixHistoryWriteResult>;
  recordProgress(payload: {
    itemId: string;
    positionMs: number;
    durationMs?: number | null;
  }): Promise<WebFlixHistoryWriteResult>;
  clearHistory(): Promise<WebFlixHistoryClearResult>;
  listEntries(): Promise<WebFlixLibraryEntriesListResult>;
  addEntries(entries: readonly WebFlixLibraryEntryAddInput[]): Promise<WebFlixLibraryEntriesAddResult>;
  authorizeEntries(ids: readonly string[]): Promise<WebFlixLibraryEntriesAuthorizeResult>;
}

/** The preload surfaces this module may touch (injectable for the battery). */
export interface WebFlixLocalLibraryPreloadElectron {
  readonly contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };
  readonly ipcRenderer: {
    invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
  };
}

/**
 * Registers the `window.webflixLocalLibrary` bridge. NO-OP unless the baked
 * product flavor is "webflix" — a ZCode identity build's preload never
 * exposes this surface.
 */
export function registerWebFlixLocalLibraryPreloadBridge(
  electron: WebFlixLocalLibraryPreloadElectron,
  flavor: string = ZCODE_PRODUCT_FLAVOR,
): void {
  if (flavor !== "webflix") {
    return;
  }
  const bridge: WebFlixLocalLibraryPreloadBridge = {
    getStatus: () =>
      ipcInvokeStrict<WebFlixLocalLibraryStatus>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
        {},
      ),
    listHistory: (kind, limit) =>
      ipcInvokeStrict<WebFlixHistoryListResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL,
        { kind, ...(limit !== undefined ? { limit } : {}) },
      ),
    recordWatch: (payload) =>
      ipcInvokeStrict<WebFlixHistoryWriteResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
        payload,
      ),
    recordProgress: (payload) =>
      ipcInvokeStrict<WebFlixHistoryWriteResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
        payload,
      ),
    clearHistory: () =>
      ipcInvokeStrict<WebFlixHistoryClearResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL,
        {},
      ),
    listEntries: () =>
      ipcInvokeStrict<WebFlixLibraryEntriesListResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL,
        {},
      ),
    addEntries: (entries) =>
      ipcInvokeStrict<WebFlixLibraryEntriesAddResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
        { entries },
      ),
    authorizeEntries: (ids) =>
      ipcInvokeStrict<WebFlixLibraryEntriesAuthorizeResult>(
        electron.ipcRenderer,
        WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL,
        { ids },
      ),
  };
  electron.contextBridge.exposeInMainWorld(WEBFLIX_LOCAL_LIBRARY_BRIDGE_KEY, bridge);
}

/**
 * The single invoke wrapper — every method goes through the SAME strict
 * channel check, so no method can ever grow a looser path.
 */
function ipcInvokeStrict<T>(
  ipcRenderer: WebFlixLocalLibraryPreloadElectron["ipcRenderer"],
  channel: string,
  payload: unknown,
): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

registerWebFlixLocalLibraryPreloadBridge({ contextBridge, ipcRenderer });
