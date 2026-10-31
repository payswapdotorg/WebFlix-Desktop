/**
 * WFX-DURABLE-LIB-1 (TL3 takeover lane) — the renderer-side durable
 * local-library bridge accessor.
 *
 * The durable history/library surfaces talk to the REAL main-process store
 * (packages/local-library, opened once under the WebFlix identity data root)
 * through the explicitly permissioned preload bridge
 * (`window.webflixLocalLibrary`, exposed by
 * packages/desktop/src/preload/webflixLocalLibraryBridge.ts over the
 * narrowly-scoped IPC channels registered by
 * packages/desktop/src/main/webflixLocalLibraryIpc.ts).
 *
 * Boundary rules this module encodes:
 *   - Fail-closed everywhere: when the bridge is ABSENT (a plain web build,
 *     a test DOM, or a runtime that did not load the preload module), the
 *     accessor returns null and the consumers degrade to the honest
 *     session-scoped behavior — byte-equivalent to the pre-wave surfaces.
 *     Nothing is fabricated, no durable success is ever implied.
 *   - Playback URL grants come ONLY from authorizeEntries (the main-side
 *     preview-path registry decides); this surface has no method that could
 *     turn a renderer path into a playable URL, by construction.
 *   - The payload interfaces here are the renderer-side MIRROR of the
 *     preload module's payload types; the battery pins the channel strings
 *     and payload shapes on both sides (see webflixLocalLibraryIpc.test.ts).
 */

/** The renderer-facing result vocabulary (mirrored from the preload module). */
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

/** The preload-exposed durable library bridge surface (see preload/webflixLocalLibraryBridge.ts). */
export interface WebFlixLocalLibraryBridge {
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
  addEntries(
    entries: readonly WebFlixLibraryEntryAddInput[],
  ): Promise<WebFlixLibraryEntriesAddResult>;
  authorizeEntries(ids: readonly string[]): Promise<WebFlixLibraryEntriesAuthorizeResult>;
}

declare global {
  interface Window {
    readonly webflixLocalLibrary?: WebFlixLocalLibraryBridge;
  }
}

/**
 * The live bridge, or null when it is not present. Callers MUST treat null
 * as the typed "bridge unavailable" state (fail-closed) — the session-scoped
 * behavior is the honest degrade, never a fabricated durable success.
 */
export function getWebFlixLocalLibraryBridge(): WebFlixLocalLibraryBridge | null {
  const candidate = (globalThis as { window?: { webflixLocalLibrary?: unknown } }).window
    ?.webflixLocalLibrary;
  if (candidate == null || typeof candidate !== "object") {
    return null;
  }
  const bridge = candidate as Partial<WebFlixLocalLibraryBridge>;
  if (
    typeof bridge.getStatus !== "function" ||
    typeof bridge.listHistory !== "function" ||
    typeof bridge.recordWatch !== "function" ||
    typeof bridge.recordProgress !== "function" ||
    typeof bridge.clearHistory !== "function" ||
    typeof bridge.listEntries !== "function" ||
    typeof bridge.addEntries !== "function" ||
    typeof bridge.authorizeEntries !== "function"
  ) {
    return null;
  }
  return bridge as WebFlixLocalLibraryBridge;
}
