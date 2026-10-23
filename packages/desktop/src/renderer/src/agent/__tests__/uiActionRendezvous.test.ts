import { describe, expect, it, vi } from "vitest";
import type { UiActionResult } from "../../../../../../webflix-contracts/src/ui-actions.js";
import {
  startWebflixUiActionRendezvous,
  WEBFLIX_UI_RENDEZVOUS_DIR_NAME,
  WEBFLIX_UI_REQUEST_SCHEMA_VERSION,
  type RendezvousFileService,
  type WebflixUiActionRendezvousDependencies,
} from "../uiActionRendezvous.js";
import { createUiActionBridge, type UiActionHandlers } from "../uiActionBridge.js";

/**
 * WFX-AGENT-BRIDGE-1 — the webflix_ui rendezvous responder battery.
 *
 * Pins the file-rendezvous transport (the zero-main-process-change channel
 * between the bundled stdio MCP entry and the renderer bridge): request
 * files in `<workspace>/.webflix-ui/requests` are read through the admitted
 * runtime's fileService, dispatched through the live bridge, and answered
 * with the typed UiActionResult JSON via the temp-attachment channel.
 * Malformed requests get typed failure responses — a tool call never hangs.
 */

/** A manual clock: scans fire only when the test advances them. */
function createManualScheduler(): {
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  fireNext: () => void;
  pendingCount: () => number;
} {
  const queue: Array<{ callback: () => void; id: number }> = [];
  let nextId = 1;
  return {
    schedule: (callback, _delayMs) => {
      const entry = { callback, id: nextId };
      nextId += 1;
      queue.push(entry);
      return entry.id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => {
      const id = timer as unknown as number;
      const index = queue.findIndex((entry) => entry.id === id);
      if (index >= 0) queue.splice(index, 1);
    },
    fireNext: () => {
      const entry = queue.shift();
      if (entry) entry.callback();
    },
    pendingCount: () => queue.length,
  };
}

interface FakeFs {
  service: RendezvousFileService;
  files: Map<string, string>;
  readdirCalls: number;
  readdirError: Error | null;
}

function createFakeFs(files: Record<string, string> = {}): FakeFs {
  const state = {
    files: new Map<string, string>(Object.entries(files)),
    readdirCalls: 0,
    readdirError: null as Error | null,
  };
  const service: RendezvousFileService = {
    readdir: async ({ path }) => {
      state.readdirCalls += 1;
      if (state.readdirError) throw state.readdirError;
      return [...state.files.keys()].map((name) => ({
        name,
        path: `${path}/${name}`,
        type: "file" as const,
      }));
    },
    readTextFile: async ({ path }) => {
      const name = path.split("/").pop() ?? "";
      const content = state.files.get(name);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return { content };
    },
  };
  return { service, ...state };
}

function createBridge(
  handlerResult: UiActionResult = {
    kind: "ok",
    summary: "done",
    items: [],
    channels: [],
    evidence: [],
  },
): { dispatch: ReturnType<typeof vi.fn>; bridge: ReturnType<typeof createUiActionBridge> } {
  const dispatch = vi.fn(async () => handlerResult);
  const handlers = {
    searchCatalog: dispatch,
    resolveChannel: dispatch,
    openRoute: dispatch,
    playCatalogItem: dispatch,
    openAccountConnection: dispatch,
    toggleAgentPanel: dispatch,
    getVisibleMediaContext: () => ({
      at: "2026-10-23T12:00:00.000Z",
      route: "home" as const,
      params: {},
      playingItem: null,
      watchPlanKind: null,
      visibleItemIds: [],
      connections: [],
      agentPanel: { visible: true, widthPx: null },
      pendingChoice: null,
    }),
  } as unknown as UiActionHandlers;
  return { dispatch, bridge: createUiActionBridge(handlers) };
}

function requestFile(requestId: string, action: unknown, schemaVersion = WEBFLIX_UI_REQUEST_SCHEMA_VERSION): string {
  return JSON.stringify({ schemaVersion, requestId, action });
}

function createDeps(overrides: Partial<WebflixUiActionRendezvousDependencies> = {}) {
  const scheduler = createManualScheduler();
  const written: Array<{ text: string; filename: string }> = [];
  const deps: WebflixUiActionRendezvousDependencies = {
    workspacePath: "/data/agent-workspace",
    fileService: null as unknown as RendezvousFileService,
    bridge: null as unknown as ReturnType<typeof createUiActionBridge>,
    createTempTextFile: async (text, filename) => {
      written.push({ text, filename });
      return { localPath: `/data/tmp/paste-attachments/2026-10-23/${filename}-abcd1234.txt` };
    },
    pollIntervalMs: 1_000,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    ...overrides,
  };
  return { deps, scheduler, written };
}

describe("uiActionRendezvous — the webflix_ui tool transport", () => {
  it("reads a valid request, dispatches it once, and answers the typed result", async () => {
    const fs = createFakeFs({ "req-1.json": requestFile("req-1", { action: "openRoute", route: "home" }) });
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext(); // the initial scan (delay 0)
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ action: "openRoute", route: "home" });
    const response = JSON.parse(written[0]?.text ?? "{}") as {
      schemaVersion: number;
      requestId: string;
      result: UiActionResult;
      respondedAt: string;
    };
    expect(response.schemaVersion).toBe(WEBFLIX_UI_REQUEST_SCHEMA_VERSION);
    expect(response.requestId).toBe("req-1");
    expect(response.result).toMatchObject({ kind: "ok", summary: "done" });
    expect(written[0]?.filename).toContain("req-1");
    expect(written[0]?.filename.startsWith("webflix-ui-response-req-1")).toBe(true);
    expect(handle.stats().responded).toBe(1);
    expect(handle.stats().scannedDirs).toBe(1);
    handle.stop();
  });

  it("a duplicate request file is processed exactly once (idempotent scans)", async () => {
    const fs = createFakeFs({ "req-1.json": requestFile("req-1", { action: "openRoute", route: "home" }) });
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    scheduler.fireNext(); // second scan: same file still there
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(handle.stats().dispatched).toBe(1);
    handle.stop();
  });

  it("non-json and directory entries in the requests dir are ignored", async () => {
    const fs = createFakeFs({ "notes.txt": "hello", "req-2.json": requestFile("req-2", { action: "getVisibleMediaContext" }) });
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(dispatch).not.toHaveBeenCalled(); // getVisibleMediaContext routes to the context provider
    expect(written[0]?.filename).toContain("req-2");
    handle.stop();
  });

  it("a malformed envelope answers a typed invalid-action failure (never hangs)", async () => {
    const fs = createFakeFs({ "req-3.json": "{not json" });
    const { bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    const response = JSON.parse(written[0]?.text ?? "{}") as { result: UiActionResult };
    expect(response.result.kind).toBe("failure");
    if (response.result.kind === "failure") {
      expect(response.result.code).toBe("invalid-action");
      expect(response.result.retryable).toBe(false);
    }
    handle.stop();
  });

  it("a wrong schemaVersion or mismatched requestId answers the typed failure", async () => {
    const fs = createFakeFs({
      "req-4.json": requestFile("req-4", { action: "openRoute", route: "home" }, 99),
      "req-5.json": requestFile("OTHER", { action: "openRoute", route: "home" }),
    });
    const { bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(2));
    for (const entry of written) {
      const response = JSON.parse(entry.text) as { result: UiActionResult };
      expect(response.result.kind).toBe("failure");
      if (response.result.kind === "failure") {
        expect(response.result.code).toBe("invalid-action");
      }
    }
    handle.stop();
  });

  it("an invalid ACTION inside a valid envelope answers the typed failure without dispatch", async () => {
    const fs = createFakeFs({ "req-6.json": requestFile("req-6", { action: "likeVideo", itemId: "x" }) });
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    const response = JSON.parse(written[0]?.text ?? "{}") as { result: UiActionResult };
    expect(response.result).toMatchObject({ kind: "failure", code: "unknown-action" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(handle.stats().dispatched).toBe(1); // the tool call was SEEN and answered
    handle.stop();
  });

  it("the requests dir path follows the frozen rendezvous layout", async () => {
    const fs = createFakeFs();
    const seenPaths: string[] = [];
    const service: RendezvousFileService = {
      readdir: async ({ path }) => {
        seenPaths.push(path);
        return [];
      },
      readTextFile: async () => ({ content: "" }),
    };
    void fs;
    const { deps, scheduler } = createDeps({ fileService: service, bridge: createBridge().bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seenPaths).toEqual([
      `/data/agent-workspace/${WEBFLIX_UI_RENDEZVOUS_DIR_NAME}/requests`,
    ]);
    handle.stop();
  });

  it("a missing requests dir is tolerated and polling continues when it appears", async () => {
    const files = new Map<string, string>();
    const service: RendezvousFileService = {
      readdir: async () => {
        if (files.size === 0) throw new Error("ENOENT: no such directory");
        return [...files.keys()].map((name) => ({ name, path: name, type: "file" as const }));
      },
      readTextFile: async ({ path }) => {
        const name = path.split("/").pop() ?? "";
        return { content: files.get(name) ?? "" };
      },
    };
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler, written } = createDeps({ fileService: service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handle.stats().lastError).toContain("ENOENT");
    expect(written).toHaveLength(0);
    files.set("req-7.json", requestFile("req-7", { action: "toggleAgentPanel" }));
    scheduler.fireNext();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(dispatch).toHaveBeenCalledWith({ action: "toggleAgentPanel" });
    expect(handle.stats().lastError).toBeNull();
    handle.stop();
  });

  it("stop() cancels pending polls and reports not-running", () => {
    const { deps, scheduler } = createDeps({ fileService: createFakeFs().service, bridge: createBridge().bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    expect(handle.stats().running).toBe(true);
    expect(scheduler.pendingCount()).toBe(1); // the initial scan (delay 0)
    scheduler.fireNext();
    expect(scheduler.pendingCount()).toBe(1); // the rescheduled next tick
    handle.stop();
    expect(handle.stats().running).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("without the temp-attachment writer the responder degrades honestly (typed error, no crash)", async () => {
    const fs = createFakeFs({ "req-8.json": requestFile("req-8", { action: "openRoute", route: "home" }) });
    const { dispatch, bridge } = createBridge();
    const { deps, scheduler } = createDeps({ fileService: fs.service, bridge });
    deps.createTempTextFile = undefined;
    const handle = startWebflixUiActionRendezvous({ ...deps, createTempTextFile: undefined });
    scheduler.fireNext();
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handle.stats().responded).toBe(0);
    expect(handle.stats().lastError).toContain("temp-attachment bridge unavailable");
    handle.stop();
  });

  it("the trace buffer records the rendezvous-dispatched action (acceptance evidence)", async () => {
    const fs = createFakeFs({ "req-9.json": requestFile("req-9", { action: "playCatalogItem", itemId: "item-1" }) });
    const { bridge } = createBridge();
    const { deps, scheduler } = createDeps({ fileService: fs.service, bridge });
    const handle = startWebflixUiActionRendezvous(deps);
    scheduler.fireNext();
    await vi.waitFor(() => expect(handle.stats().dispatched).toBe(1));
    expect(bridge.trace.export()).toHaveLength(1);
    expect(bridge.trace.export()[0]?.action).toEqual({ action: "playCatalogItem", itemId: "item-1" });
    handle.stop();
  });
});
