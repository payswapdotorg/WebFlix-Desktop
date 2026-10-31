import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-DURABLE-LIB-1 — the durable local-library IPC battery
 * (packages/desktop/src/main/webflixLocalLibraryIpc.ts) and its preload
 * mirror (packages/desktop/src/preload/webflixLocalLibraryBridge.ts).
 *
 * Pinned here (all binding):
 *   - The channel strings on the main side and the preload side AGREE (a
 *     typo on either side fails this battery, never a silent mismatch).
 *   - Registration is flavor-gated: only the baked webflix flavor registers
 *     the channels; a zcode flavor registers NOTHING.
 *   - The channels run against the REAL local-library store (hermetic temp
 *     data root — the full migration + WatchHistoryStore path, not a mock
 *     of the store): round-trips, upsert-by-path idempotency, the honest
 *     present/missing flag, the preview-URL authorize grant through the
 *     registry seam, and the §7.5-faithful record semantics.
 *   - Fail-closed: a refused data root or a failing store open answers the
 *     typed ok:false on EVERY surface (cached — never a retry storm), and
 *     malformed renderer input is refused typed, never guessed.
 *
 * Electron is mocked (the webflixAccountIpc.test.ts pattern: an ipcMain
 * .handle recorder and a contextBridge world recorder); the IPC module, the
 * preload bridge and local-library's openStore are the REAL source.
 */

const hoisted = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: readonly unknown[]) => unknown>();
  const exposedWorlds = new Map<string, unknown>();
  return { ipcHandlers, exposedWorlds };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: readonly unknown[]) => unknown) => {
      hoisted.ipcHandlers.set(channel, handler);
    },
  },
  contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => {
      hoisted.exposedWorlds.set(apiKey, api);
    },
  },
  ipcRenderer: {
    invoke: async () => ({}),
  },
}));

import {
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
  registerWebFlixLocalLibraryIpc,
} from "./webflixLocalLibraryIpc.js";
import {
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL as PRELOAD_ENTRIES_ADD_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL as PRELOAD_ENTRIES_AUTHORIZE_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL as PRELOAD_ENTRIES_LIST_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL as PRELOAD_HISTORY_CLEAR_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL as PRELOAD_HISTORY_LIST_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL as PRELOAD_HISTORY_RECORD_PROGRESS_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL as PRELOAD_HISTORY_RECORD_WATCH_CHANNEL,
  WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL as PRELOAD_STATUS_CHANNEL,
} from "../preload/webflixLocalLibraryBridge.js";
import { openStore } from "local-library";
import { buildLocalMediaPreviewUrl } from "@zcode/shared";
import type { CatalogItem } from "webflix-contracts";
import type {
  WebFlixHistoryClearResult,
  WebFlixHistoryListResult,
  WebFlixHistoryWriteResult,
  WebFlixLibraryEntriesAddResult,
  WebFlixLibraryEntriesAuthorizeResult,
  WebFlixLibraryEntriesListResult,
  WebFlixLocalLibraryStatusResult,
} from "./webflixLocalLibraryIpc.js";

const noopLogger = { info: () => undefined, warn: () => undefined };

let dataRoot: string;

beforeEach(() => {
  hoisted.ipcHandlers.clear();
  hoisted.exposedWorlds.clear();
  dataRoot = mkdtempSync(join(tmpdir(), "webflix-local-lib-ipc-"));
});

afterEach(() => {
  rmSync(dataRoot, { recursive: true, force: true });
});

/** Registers with the REAL store opener against this test's temp data root. */
function registerReal(): void {
  registerWebFlixLocalLibraryIpc({
    logger: noopLogger,
    resolveDataRoot: () => dataRoot,
    openStore: (baseDir) => openStore({ baseDir }),
  });
}

/** Registers with a registry double (the preview-URL grant seam). */
function registerRealWithRegistry(): void {
  registerWebFlixLocalLibraryIpc({
    logger: noopLogger,
    resolveDataRoot: () => dataRoot,
    openStore: (baseDir) => openStore({ baseDir }),
    localMediaPathRegistry: { authorize: async (path) => path },
  });
}

/** Invokes a registered channel (typed helper over the recorded handlers). */
async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const handler = hoisted.ipcHandlers.get(channel);
  if (handler === undefined) {
    throw new Error(`channel not registered: ${channel}`);
  }
  return (await handler(undefined, payload ?? {})) as T;
}

const youtubeItem = (id: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title: "Amp Hour",
  mediaKind: "video",
  assets: [],
  metadata: {},
});

describe("channel mirror + flavor gate", () => {
  it("pins the main and preload channel constants agree (all eight)", () => {
    expect(PRELOAD_STATUS_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL);
    expect(PRELOAD_HISTORY_LIST_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL);
    expect(PRELOAD_HISTORY_RECORD_WATCH_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL);
    expect(PRELOAD_HISTORY_RECORD_PROGRESS_CHANNEL).toBe(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
    );
    expect(PRELOAD_HISTORY_CLEAR_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL);
    expect(PRELOAD_ENTRIES_LIST_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL);
    expect(PRELOAD_ENTRIES_ADD_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL);
    expect(PRELOAD_ENTRIES_AUTHORIZE_CHANNEL).toBe(WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL);
  });

  it("registers the eight channels in the webflix flavor and NOTHING in a zcode flavor", () => {
    registerReal();
    expect(hoisted.ipcHandlers.size).toBe(8);
    hoisted.ipcHandlers.clear();
    registerWebFlixLocalLibraryIpc({ logger: noopLogger, flavor: "zcode" as "webflix" });
    expect(hoisted.ipcHandlers.size).toBe(0);
  });
});

describe("status surface (the REAL store under the temp data root)", () => {
  it("answers ok with the live engine, the library dir and honest counts", async () => {
    registerReal();
    const status = await invoke<WebFlixLocalLibraryStatusResult>(
      WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
    );
    expect(status.ok).toBe(true);
    expect(status.engine === "better-sqlite3" || status.engine === "node:sqlite").toBe(true);
    expect(status.libraryDir).toBe(join(dataRoot, "library"));
    expect(status.entryCount).toBe(0);
    expect(status.historyCount).toBe(0);
  });

  it("fails closed (and caches) when the store cannot open", async () => {
    let openCalls = 0;
    registerWebFlixLocalLibraryIpc({
      logger: noopLogger,
      resolveDataRoot: () => dataRoot,
      openStore: () => {
        openCalls += 1;
        return Promise.reject(new Error("engine unavailable in this runtime"));
      },
    });
    const first = await invoke<WebFlixLocalLibraryStatusResult>(
      WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
    );
    expect(first.ok).toBe(false);
    expect(first.engine).toBeNull();
    expect(first.reason).toContain("engine unavailable");
    const second = await invoke<WebFlixLocalLibraryStatusResult>(
      WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
    );
    expect(second.ok).toBe(false);
    expect(openCalls).toBe(1);
  });

  it("fails closed when the WebFlix identity data root is refused", async () => {
    registerWebFlixLocalLibraryIpc({
      logger: noopLogger,
      resolveDataRoot: () => {
        throw new Error("WEBFLIX_IDENTITY contract absent — refusing to guess a root");
      },
    });
    const status = await invoke<WebFlixLocalLibraryStatusResult>(
      WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
    );
    expect(status.ok).toBe(false);
    expect(status.reason).toContain("refusing to guess");
  });
});

describe("history surfaces (the REAL WatchHistoryStore)", () => {
  it("refuses malformed record-watch payloads typed", async () => {
    registerReal();
    const noItem = await invoke<WebFlixHistoryWriteResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
      { itemId: "youtube:video:x", providerId: "youtube" },
    );
    expect(noItem.ok).toBe(false);
    const noId = await invoke<WebFlixHistoryWriteResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
      { providerId: "youtube", item: youtubeItem("youtube:video:x") },
    );
    expect(noId.ok).toBe(false);
  });

  it("records a watch, lists it back (ISO watchedAt), records progress, clears with the honest count", async () => {
    registerReal();
    const watch = await invoke<WebFlixHistoryWriteResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_WATCH_CHANNEL,
      {
        itemId: "youtube:video:abc",
        providerId: "youtube",
        item: youtubeItem("youtube:video:abc"),
        positionMs: 0,
      },
    );
    expect(watch.ok).toBe(true);

    const list = await invoke<WebFlixHistoryListResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL,
      { kind: "history" },
    );
    expect(list.ok).toBe(true);
    expect(list.entries).toHaveLength(1);
    const entry = list.entries[0] as { itemId: string; watchedAt: string; item: { id: string } };
    expect(entry.itemId).toBe("youtube:video:abc");
    expect(entry.item.id).toBe("youtube:video:abc");
    expect(Number.isNaN(Date.parse(entry.watchedAt))).toBe(false);

    const progress = await invoke<WebFlixHistoryWriteResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
      { itemId: "youtube:video:abc", positionMs: 12_000, durationMs: 90_000 },
    );
    expect(progress.ok).toBe(true);

    const continueList = await invoke<WebFlixHistoryListResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_LIST_CHANNEL,
      { kind: "continue" },
    );
    expect(continueList.entries[0]?.positionMs).toBe(12_000);

    const cleared = await invoke<WebFlixHistoryClearResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_CLEAR_CHANNEL,
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.removed).toBe(1);
  });

  it("answers ok for a progress write to an unknown item (the session no-op semantics, never a new row)", async () => {
    registerReal();
    const progress = await invoke<WebFlixHistoryWriteResult>(
      WEBFLIX_LOCAL_LIBRARY_HISTORY_RECORD_PROGRESS_CHANNEL,
      { itemId: "never-watched", positionMs: 1_000 },
    );
    expect(progress.ok).toBe(true);
    const status = await invoke<WebFlixLocalLibraryStatusResult>(
      WEBFLIX_LOCAL_LIBRARY_STATUS_CHANNEL,
    );
    expect(status.historyCount).toBe(0);
  });
});

describe("entries surfaces (the REAL LocalStore library entries)", () => {
  it("refuses malformed entries:add payloads typed", async () => {
    registerReal();
    const empty = await invoke<WebFlixLibraryEntriesAddResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
      { entries: [] },
    );
    expect(empty.ok).toBe(false);
    const malformed = await invoke<WebFlixLibraryEntriesAddResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
      { entries: [{ path: "not-absolute", title: "X", kind: "video", sizeBytes: 1, mtimeMs: 1 }] },
    );
    expect(malformed.ok).toBe(false);
  });

  it("adds entries idempotently by path (the stable durable id) and lists the honest present/missing flag", async () => {
    registerReal();
    const mediaDir = join(dataRoot, "media");
    mkdirSync(mediaDir);
    const presentPath = join(mediaDir, "holiday.mkv");
    writeFileSync(presentPath, "fake-bytes");
    const missingPath = join(mediaDir, "gone.mkv");

    const added = await invoke<WebFlixLibraryEntriesAddResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
      {
        entries: [
          { path: presentPath, title: "holiday.mkv", kind: "video", sizeBytes: 10, mtimeMs: 1 },
          { path: missingPath, title: "gone.mkv", kind: "video", sizeBytes: 10, mtimeMs: 1 },
        ],
      },
    );
    expect(added.ok).toBe(true);
    expect(added.added).toHaveLength(2);

    // Re-importing the same path keeps ONE entry (existed: true, same id).
    const again = await invoke<WebFlixLibraryEntriesAddResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
      {
        entries: [{ path: presentPath, title: "holiday.mkv", kind: "video", sizeBytes: 10, mtimeMs: 1 }],
      },
    );
    expect(again.added?.[0]?.existed).toBe(true);
    expect(again.added?.[0]?.id).toBe(added.added?.[0]?.id);

    const list = await invoke<WebFlixLibraryEntriesListResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_LIST_CHANNEL,
    );
    expect(list.ok).toBe(true);
    expect(list.entries).toHaveLength(2);
    const present = list.entries.find((entry) => entry.path === presentPath);
    const missing = list.entries.find((entry) => entry.path === missingPath);
    expect(present?.present).toBe(true);
    expect(missing?.present).toBe(false);
  });

  it("grants the preview URL only through authorize (the registry seam), with per-entry honest refusals", async () => {
    registerRealWithRegistry();
    const mediaDir = join(dataRoot, "media");
    mkdirSync(mediaDir);
    const presentPath = join(mediaDir, "clip.mp4");
    writeFileSync(presentPath, "fake-bytes");
    const added = await invoke<WebFlixLibraryEntriesAddResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_ADD_CHANNEL,
      {
        entries: [{ path: presentPath, title: "clip.mp4", kind: "video", sizeBytes: 10, mtimeMs: 1 }],
      },
    );
    const presentId = added.added?.[0]?.id as string;

    const authorized = await invoke<WebFlixLibraryEntriesAuthorizeResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL,
      { ids: [presentId, "no-such-entry"] },
    );
    expect(authorized.ok).toBe(true);
    const outcomes = authorized.authorized ?? [];
    expect(outcomes).toHaveLength(2);
    const granted = outcomes.find((outcome) => outcome.id === presentId);
    expect(granted?.url).toBe(buildLocalMediaPreviewUrl(presentPath));
    const refused = outcomes.find((outcome) => outcome.id === "no-such-entry");
    expect(refused?.url).toBeNull();
    expect(refused?.reason).toContain("no durable library entry");
  });

  it("answers the typed refusal when no registry was provided (fail-closed — no playable URL without the grant path)", async () => {
    registerReal();
    const refused = await invoke<WebFlixLibraryEntriesAuthorizeResult>(
      WEBFLIX_LOCAL_LIBRARY_ENTRIES_AUTHORIZE_CHANNEL,
      { ids: ["any"] },
    );
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain("preview registry is unavailable");
  });
});
