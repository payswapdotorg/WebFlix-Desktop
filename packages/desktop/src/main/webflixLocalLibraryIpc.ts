/**
 * WFX-DURABLE-LIB-1 (TL3 takeover lane) — the main-process side of the
 * durable local-library/history bridge: the ONE owner of the migration-backed
 * SQLite store (packages/local-library), opened once per app session under
 * the frozen WebFlix identity data root, and exposed to the renderer through
 * exactly this namespaced, defensively-validated IPC surface.
 *
 * What this module is (the boundary law, mirroring webflixAccountIpc.ts /
 * webflixAgentWorkspaceIpc.ts):
 *   - EXPLICITLY PERMISSIONED surface: exactly eight methods over exactly
 *     eight namespaced IPC channels (status, history list/record-watch/
 *     record-progress/clear, entries list/add). Nothing else is exposed —
 *     no generic invoke passthrough, no path-bearing write, no delete.
 *   - The MAIN process owns the STORE and the PATHS: the renderer sends
 *     typed facts (items, ids, progress), never filesystem paths to open;
 *     the only path-bearing write is the import flow's durable entry add,
 *     and that path comes from the OS file picker through the established
 *     webUtils bridge (device-scoped per the data-ownership table; there is
 *     no sync).
 *   - Fail-closed data root, exactly like the OS vault and the agent
 *     workspace: WEBFLIX_IDENTITY=1 + WEBFLIX_DATA_ROOT are the frozen
 *     identity env contract; a refusal never touches a ZCode root.
 *   - Flavor-gated: a ZCode identity build never gains these channels
 *     (registerWebFlixLocalLibraryIpc no-ops).
 *   - Honest typed results: every method answers { ok: true, … } or
 *     { ok: false, reason } — a store/engine failure answers ok:false and
 *     the renderer degrades to session-scoped behavior (the same surface
 *     as today when no bridge exists; never a fabricated durable success).
 *
 * Storage laws applied here (freeze §7.5/AS-Q8 + the architecture lock §7):
 *   - The store opens at `<dataRoot>/library/webflix.db` (dev
 *     `~/.webflix-dev/library/`, packaged `~/.webflix/library/`) —
 *     device-scoped, separated from the agent CLI's `<dataRoot>/cli/` home.
 *   - The §7.5 30-day TTL job runs once per app session at store open
 *     (sweepExpiredPayloads over the provider payloads riding history).
 *   - The engine is the adapter's choice (better-sqlite3 dynamic import
 *     with the node:sqlite fallback — designed for exactly this packaging
 *     constraint); the live engine name surfaces through the status channel.
 */
/* eslint-disable max-lines -- webflixLocalLibraryIpc.ts: the durable local-library boundary module (WFX-DURABLE-LIB-1); the eight channels, the typed result vocabulary, the one-store-per-session lifecycle and the defensive parsers share one boundary substrate — splitting the IPC surface mid-lane would scatter the battery-pinned channel mirror. Split deferred to the Phase-2 module split backlog (TL3 arbitration, repo precedent: localStore.ts). */
import { ipcMain } from "electron";
import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ZCODE_PRODUCT_FLAVOR, buildLocalMediaPreviewUrl } from "@zcode/shared";
import { resolveWebFlixVaultDataRoot } from "./webflix/osVaultAccountStore.js";
import {
  openStore,
  type LibraryEntry,
  type LibraryEntryKind,
  type WebFlixStore,
} from "local-library";

/** The typed IPC channels — MUST equal the preload bridge's exported constants (battery-pinned). */
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

/** The durable store's directory under the WebFlix data root. */
export const WEBFLIX_LOCAL_LIBRARY_DIR_NAME = "library";

/** Renderer-facing result vocabulary — every method answers one of these. */
export interface WebFlixLocalLibraryStatusResult {
  readonly ok: boolean;
  readonly engine: "better-sqlite3" | "node:sqlite" | null;
  readonly libraryDir?: string;
  readonly entryCount?: number;
  readonly historyCount?: number;
  readonly reason?: string;
}

/** One durable watch-history entry in the renderer seam's shape (media-history-port). */
export interface WebFlixWatchHistoryEntryPayload {
  readonly itemId: string;
  readonly providerId: string;
  readonly item: unknown;
  readonly positionMs: number;
  readonly durationMs?: number | null;
  readonly watchedAt: string;
}

export interface WebFlixHistoryListResult {
  readonly ok: boolean;
  readonly entries: readonly WebFlixWatchHistoryEntryPayload[];
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

/** One durable local-file library entry as the renderer may see it. */
export interface WebFlixLibraryEntryPayload {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: "video" | "audio";
  readonly sizeBytes: number;
  readonly addedAt: number;
  /** Live presence at list time (the honest missing-file state). */
  readonly present: boolean;
}

export interface WebFlixLibraryEntriesListResult {
  readonly ok: boolean;
  readonly entries: readonly WebFlixLibraryEntryPayload[];
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

/** One per-entry authorization outcome (the preview-URL grant). */
export interface WebFlixLibraryEntryAuthorizeOutcome {
  readonly id: string;
  /** The zcode-media preview URL for a PRESENT entry, or null with a reason. */
  readonly url: string | null;
  readonly reason?: string;
}

export interface WebFlixLibraryEntriesAuthorizeResult {
  readonly ok: boolean;
  readonly authorized?: readonly WebFlixLibraryEntryAuthorizeOutcome[];
  readonly reason?: string;
}

export interface RegisterWebFlixLocalLibraryIpcOptions {
  readonly logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  readonly flavor?: typeof ZCODE_PRODUCT_FLAVOR;
  /** Injectable for tests (defaults to the real resolver). */
  readonly resolveDataRoot?: () => string;
  /** Injectable store opener for tests (defaults to the real openStore). */
  readonly openStore?: (baseDir: string) => Promise<WebFlixStore>;
  /**
   * The local-media preview path registry (localMediaPreviewProtocol.ts —
   * structural): the ONLY way a durable entry's file becomes renderer-
   * playable (the privileged zcode-media scheme + the native file loader
   * that owns Range/seek). When absent, authorize answers the typed
   * refusal — the renderer never receives a playable URL it can't have.
   */
  readonly localMediaPathRegistry?: WebFlixLocalMediaPathRegistry;
}

/** The structural registry surface this module consumes (satisfied by createLocalMediaPreviewPathRegistry). */
export interface WebFlixLocalMediaPathRegistry {
  authorize(path: string): Promise<string>;
}

const MAX_HISTORY_LIMIT = 1000;
const MAX_ENTRIES_PER_ADD = 200;
const MAX_TITLE_LENGTH = 2000;

function noopLogger(): { info: () => void; warn: () => void } {
  return { info: () => undefined, warn: () => undefined };
}

/** The store open state — ONE store per app session, opened lazily, cached. */
interface StoreState {
  openError: string | null;
  store: WebFlixStore | null;
  opening: Promise<WebFlixStore> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Maps the store's epoch-ms record to the renderer seam's ISO-string shape. */
function toHistoryPayload(record: {
  itemId: string;
  providerId: string;
  item: unknown;
  positionMs: number;
  durationMs: number | null;
  watchedAt: number;
}): WebFlixWatchHistoryEntryPayload {
  return {
    itemId: record.itemId,
    providerId: record.providerId,
    item: record.item,
    positionMs: record.positionMs,
    ...(record.durationMs !== null ? { durationMs: record.durationMs } : {}),
    watchedAt: new Date(record.watchedAt).toISOString(),
  };
}

/** The durable entry kind for an import's media kind (the store's vocabulary). */
function toEntryKind(kind: "video" | "audio"): LibraryEntryKind {
  return kind === "audio" ? "other" : "movie";
}

/**
 * Registers the WebFlix durable local-library IPC channels. NO-OP unless the
 * baked product flavor is "webflix" — a ZCode identity build never gains this
 * surface.
 */
export function registerWebFlixLocalLibraryIpc(options: RegisterWebFlixLocalLibraryIpcOptions): void {
  const flavor = options.flavor ?? ZCODE_PRODUCT_FLAVOR;
  if (flavor !== "webflix") {
    return;
  }
  const logger = options.logger ?? noopLogger();

  const resolveDataRoot =
    options.resolveDataRoot ??
    ((): string => {
      // Fail-closed exactly like the OS vault / agent workspace: the frozen
      // identity env contract, and a typed refusal never touches a ZCode root.
      try {
        return resolveWebFlixVaultDataRoot();
      } catch (error) {
        throw new Error(
          `webflixLocalLibraryIpc: the WebFlix data root is unavailable — ${(error as Error).message}`,
        );
      }
    });

  const openTheStore = options.openStore ?? ((baseDir: string) => openStore({ baseDir }));
  const localMediaPathRegistry = options.localMediaPathRegistry;

  // ONE store per app session (migrations verify hashes on every open; the
  // §7.5 TTL sweep runs once here). The open is cached as a promise so
  // concurrent first calls share it; a failure is cached as the honest
  // unavailable state (never retried into a half-open store mid-session).
  const state: StoreState = { openError: null, store: null, opening: null };
  const getStore = (): Promise<WebFlixStore> => {
    if (state.store !== null) return Promise.resolve(state.store);
    if (state.openError !== null) return Promise.reject(new Error(state.openError));
    state.opening ??= (async () => {
      const libraryDir = join(resolveDataRoot(), WEBFLIX_LOCAL_LIBRARY_DIR_NAME);
      const store = await openTheStore(libraryDir);
      const swept = store.watchHistory.sweepExpiredPayloads();
      if (swept > 0) {
        logger.info(
          `[webflix-local-library] §7.5 TTL sweep degraded ${swept} expired provider payload(s) (facts kept)`,
        );
      }
      logger.info(
        `[webflix-local-library] durable store open (${store.engine}) at ${store.dbPath}`,
      );
      state.store = store;
      return store;
    })();
    return state.opening.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      state.openError = message;
      state.opening = null;
      throw new Error(message);
    });
  };

  ipcMain.handle(WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL, (): Promise<WebFlixLocalLibraryStatusResult> => {
    return getStore()
      .then(
        (store): WebFlixLocalLibraryStatusResult => ({
          ok: true,
          engine: store.engine,
          libraryDir: store.baseDir,
          entryCount: store.local.listLibraryEntries().length,
          historyCount: store.watchHistory.countHistory(),
        }),
      )
      .catch(
        (error: unknown): WebFlixLocalLibraryStatusResult => ({
          ok: false,
          engine: null,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
  });

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL,
    (_event, payload: unknown): Promise<WebFlixHistoryListResult> => {
      const body = isRecord(payload) ? payload : {};
      const kind = body["kind"] === "continue" ? "continue" : "history";
      const rawLimit = body["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(Math.floor(rawLimit), MAX_HISTORY_LIMIT)
          : undefined;
      return getStore()
        .then((store) => {
          const records =
            kind === "continue"
              ? store.watchHistory.listContinueWatching(limit)
              : store.watchHistory.listHistory(limit);
          return { ok: true, entries: records.map(toHistoryPayload) };
        })
        .catch((error: unknown) => ({
          ok: false,
          entries: [] as const,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
    (_event, payload: unknown): Promise<WebFlixHistoryWriteResult> => {
      const body = isRecord(payload) ? payload : {};
      const { itemId, providerId } = body;
      if (typeof itemId !== "string" || itemId.trim() === "" || typeof providerId !== "string" || providerId.trim() === "") {
        return Promise.resolve({
          ok: false,
          reason: "webflixLocalLibraryIpc: record-watch requires non-empty itemId + providerId",
        });
      }
      if (body["item"] === undefined || body["item"] === null) {
        return Promise.resolve({ ok: false, reason: "webflixLocalLibraryIpc: record-watch requires the item payload" });
      }
      const positionMs = typeof body["positionMs"] === "number" && Number.isFinite(body["positionMs"]) ? body["positionMs"] : 0;
      const rawDuration = body["durationMs"];
      const durationMs = typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : null;
      return getStore()
        .then((store) => {
          store.watchHistory.recordWatch({
            itemId,
            providerId,
            item: body["item"],
            positionMs,
            durationMs,
          });
          return { ok: true };
        })
        .catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
    (_event, payload: unknown): Promise<WebFlixHistoryWriteResult> => {
      const body = isRecord(payload) ? payload : {};
      const { itemId, positionMs } = body;
      if (typeof itemId !== "string" || itemId.trim() === "" || typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
        return Promise.resolve({
          ok: false,
          reason: "webflixLocalLibraryIpc: record-progress requires itemId + a non-negative positionMs",
        });
      }
      const rawDuration = body["durationMs"];
      const durationMs = typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : null;
      return getStore()
        .then(async (store) => {
          // The session seam's semantics: a progress write for an unknown
          // item is a no-op (never a new row) — surfaced as ok. A LOCAL
          // durable entry's id doubles as its watch itemId: progress also
          // RE-AUTHORIZES the entry's path (the preview registry's 30-min
          // TTL + LRU stay warm through long playback — one IPC, both
          // effects, best-effort by design).
          store.watchHistory.recordProgress({ itemId, positionMs, durationMs });
          if (localMediaPathRegistry !== undefined) {
            try {
              const entry = store.local.getLibraryEntry(itemId);
              if (entry !== null && fileIsPresent(entry.path)) {
                await localMediaPathRegistry.authorize(entry.path);
              }
            } catch {
              // A failed re-authorization never fails the progress write.
            }
          }
          return { ok: true };
        })
        .catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );

  ipcMain.handle(WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL, (): Promise<WebFlixHistoryClearResult> => {
    return getStore()
      .then((store) => ({ ok: true, removed: store.watchHistory.clearHistory() }))
      .catch((error: unknown) => ({
        ok: false,
        removed: 0,
        reason: error instanceof Error ? error.message : String(error),
      }));
  });

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL,
    (_event, payload: unknown): Promise<WebFlixLibraryEntriesAuthorizeResult> => {
      const body = isRecord(payload) ? payload : {};
      const rawIds = body["ids"];
      if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_ENTRIES_PER_ADD) {
        return Promise.resolve({
          ok: false,
          reason: `webflixLocalLibraryIpc: entries:authorize requires 1..${MAX_ENTRIES_PER_ADD} ids`,
        });
      }
      for (const id of rawIds) {
        if (typeof id !== "string" || id.trim() === "") {
          return Promise.resolve({
            ok: false,
            reason: "webflixLocalLibraryIpc: entries:authorize received a malformed id",
          });
        }
      }
      if (localMediaPathRegistry === undefined) {
        return Promise.resolve({
          ok: false,
          reason: "webflixLocalLibraryIpc: the local-media preview registry is unavailable in this runtime",
        });
      }
      return getStore()
        .then(async (store) => {
          const authorized: WebFlixLibraryEntryAuthorizeOutcome[] = [];
          for (const id of rawIds as readonly string[]) {
            const entry = store.local.getLibraryEntry(id);
            if (entry === null) {
              authorized.push({ id, url: null, reason: "no durable library entry with this id" });
              continue;
            }
            if (!fileIsPresent(entry.path)) {
              authorized.push({ id, url: null, reason: "the file is missing on this device" });
              continue;
            }
            try {
              const canonicalPath = await localMediaPathRegistry.authorize(entry.path);
              authorized.push({ id, url: buildLocalMediaPreviewUrl(canonicalPath) });
            } catch (error) {
              authorized.push({
                id,
                url: null,
                reason: error instanceof Error ? error.message : String(error),
              });
            }
          }
          return { ok: true, authorized };
        })
        .catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL,
    (): Promise<WebFlixLibraryEntriesListResult> => {
      return getStore()
        .then((store) => {
          const entries: WebFlixLibraryEntryPayload[] = [];
          for (const entry of store.local.listLibraryEntries()) {
            entries.push(toEntryPayload(entry));
          }
          return { ok: true, entries };
        })
        .catch((error: unknown) => ({
          ok: false,
          entries: [] as const,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );

  ipcMain.handle(
    WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
    (_event, payload: unknown): Promise<WebFlixLibraryEntriesAddResult> => {
      const body = isRecord(payload) ? payload : {};
      const rawEntries = body["entries"];
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        return Promise.resolve({
          ok: false,
          reason: "webflixLocalLibraryIpc: entries:add requires a non-empty entries array",
        });
      }
      if (rawEntries.length > MAX_ENTRIES_PER_ADD) {
        return Promise.resolve({
          ok: false,
          reason: `webflixLocalLibraryIpc: entries:add refuses more than ${MAX_ENTRIES_PER_ADD} entries per call`,
        });
      }
      const inputs: WebFlixLibraryEntryAddInput[] = [];
      for (const raw of rawEntries) {
        const parsed = parseEntryAddInput(raw);
        if (parsed === null) {
          return Promise.resolve({
            ok: false,
            reason: "webflixLocalLibraryIpc: entries:add received a malformed entry (absolute OS path + title + kind + sizeBytes + mtimeMs required)",
          });
        }
        inputs.push(parsed);
      }
      return getStore()
        .then((store) => {
          // Idempotent by path: re-importing the same file keeps ONE durable
          // entry per path (the stable id the renderer's catalog items and
          // history rows correlate by).
          const added: WebFlixLibraryEntryAddOutcomeItem[] = [];
          for (const input of inputs) {
            const existing = store.local.findLibraryEntryByPath(input.path);
            if (existing !== null) {
              added.push({ id: existing.id, path: existing.path, existed: true });
              continue;
            }
            const entry = store.local.addLibraryEntry({
              path: input.path,
              title: input.title.slice(0, MAX_TITLE_LENGTH),
              kind: toEntryKind(input.kind),
              sizeBytes: input.sizeBytes,
              mtimeMs: input.mtimeMs,
            });
            added.push({ id: entry.id, path: entry.path, existed: false });
          }
          return { ok: true, added };
        })
        .catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
    },
  );
}

/** The live presence + renderer shape for one durable library entry. */
function toEntryPayload(entry: LibraryEntry): WebFlixLibraryEntryPayload {
  return {
    id: entry.id,
    title: entry.title,
    path: entry.path,
    kind: entry.kind === "other" ? "audio" : "video",
    sizeBytes: entry.sizeBytes,
    addedAt: entry.addedAt,
    present: fileIsPresent(entry.path),
  };
}

/** Live stat (bounded by the user-picked library's small size; honest missing state). */
function fileIsPresent(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Defensive parse of one entry-add input (typed refusal on any malformed field). */
function parseEntryAddInput(raw: unknown): WebFlixLibraryEntryAddInput | null {
  if (!isRecord(raw)) return null;
  const { path, title, kind, sizeBytes, mtimeMs } = raw;
  // An absolute OS path only (the picker's webUtils resolution product) —
  // a relative path is refused at this boundary, never store-trusted.
  if (typeof path !== "string" || path.trim() === "" || !isAbsolute(path)) return null;
  if (typeof title !== "string" || title.trim() === "") return null;
  if (kind !== "video" && kind !== "audio") return null;
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return null;
  return { path, title, kind, sizeBytes, mtimeMs };
}
