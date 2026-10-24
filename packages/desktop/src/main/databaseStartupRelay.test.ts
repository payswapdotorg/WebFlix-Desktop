import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-AGENT-PORT-REDELIVER-1 — the relay battery.
 *
 * The production defect this pins: the initial ServicePort is posted by main
 * at host-spawn / reload-reattach (dom-ready), while the renderer's startup
 * listener installs only when its DYNAMICALLY-imported boot chunk evaluates
 * (main.tsx: `void import("./webflix/boot.js")` / `void import("./zcodeBoot.js")`).
 * A slow (dev vite graph) or racing (packaged) boot chunk drops the port
 * MessageEvent with no listener installed — the WebFlix agent panel then
 * dead-ends at its honest "agent runtime unavailable" state (the exact live
 * failure observed in the sandbox audit: databasePhase "ready" +
 * hasPendingPort false + phase "timed-out").
 *
 * The fix under test: in the webflix flavor, a `snapshot` control (the
 * renderer's "my listener is up" signal — both boots send it at module
 * evaluation) re-delivers the service port through the SAME AttachServicePort
 * flow a renderer reload takes. The zcode flavors keep exactly-once delivery
 * verbatim (freeze: WEBFLIX_IDENTITY unset ⇒ zero ZCode impact).
 *
 * The battery define bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix" (vitest
 * config), so the default path here exercises the WebFlix bake; the
 * zero-impact pin injects flavor: "production" through the options seam
 * (mirroring webflixAgentWorkspaceIpc's flavor seam).
 */

const electronState = vi.hoisted(() => ({
  ipcListeners: new Map<string, unknown[]>(),
  messageChannels: [] as { port1: unknown; port2: unknown }[],
}));

vi.mock("electron", () => {
  class FakeMessageChannelMain {
    port1 = { fake: "port1", close: vi.fn() };
    port2 = { fake: "port2", close: vi.fn() };
    constructor() {
      electronState.messageChannels.push({ port1: this.port1, port2: this.port2 });
    }
  }
  return {
    MessageChannelMain: FakeMessageChannelMain,
    ipcMain: {
      on: vi.fn((channel: string, fn: unknown) => {
        const list = electronState.ipcListeners.get(channel) ?? [];
        list.push(fn);
        electronState.ipcListeners.set(channel, list);
      }),
      removeListener: vi.fn((channel: string, fn: unknown) => {
        const list = (electronState.ipcListeners.get(channel) ?? []).filter((f) => f !== fn);
        electronState.ipcListeners.set(channel, list);
      }),
    },
  };
});

vi.mock("./databaseStartupTelemetry.js", () => ({
  reportDatabaseStartupState: vi.fn(),
}));

import { InternalChannels } from "@zcode/shared";
import { bindDatabaseStartupRelay } from "./databaseStartupRelay.js";

interface FakeWebContents {
  postMessage: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
}

function createFakeWindow(): {
  win: unknown;
  webContents: FakeWebContents;
  fireClosed: () => void;
} {
  const webContents: FakeWebContents = {
    postMessage: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
  };
  const onceListeners = new Map<string, unknown[]>();
  return {
    webContents,
    win: {
      webContents,
      isDestroyed: () => false,
      once: (event: string, fn: unknown) => {
        onceListeners.set(event, [...(onceListeners.get(event) ?? []), fn]);
      },
      removeListener: vi.fn((event: string, fn: unknown) => {
        onceListeners.set(event, (onceListeners.get(event) ?? []).filter((f) => f !== fn));
      }),
    },
    fireClosed: () => {
      for (const fn of onceListeners.get("closed") ?? []) (fn as () => void)();
    },
  };
}

function createFakeHost(): {
  child: unknown;
  exitListeners: unknown[];
  posted: { message: unknown; transfer: unknown[] }[];
} {
  const exitListeners: unknown[] = [];
  const posted: { message: unknown; transfer: unknown[] }[] = [];
  const child = {
    postMessage: vi.fn((message: unknown, transfer?: unknown[]) => {
      posted.push({ message, transfer: transfer ?? [] });
    }),
    once: (event: string, fn: unknown) => {
      if (event === "exit") exitListeners.push(fn);
    },
    removeListener: vi.fn(),
  };
  return { child, exitListeners, posted };
}

function readyState(startupId: string, sequence = 1): Record<string, unknown> {
  const now = Date.now();
  return {
    schemaVersion: 1,
    startupId,
    attemptId: "attempt-1",
    sequence,
    startedAt: now,
    updatedAt: now,
    phase: "ready",
    disk: [],
  };
}

function findControlListener(): (event: unknown, raw: unknown) => void {
  const list = electronState.ipcListeners.get(InternalChannels.DatabaseStartupControl) ?? [];
  const listener = list[list.length - 1] as ((event: unknown, raw: unknown) => void) | undefined;
  if (!listener) throw new Error("no DatabaseStartupControl listener registered");
  return listener;
}

function snapshotControl(webContents: FakeWebContents): void {
  findControlListener()({ sender: webContents }, { action: "snapshot" });
}

function stateSends(webContents: FakeWebContents): unknown[][] {
  return webContents.send.mock.calls.filter(
    (call) => call[0] === InternalChannels.DatabaseStartupState,
  );
}

function attachPosts(posted: { message: unknown; transfer: unknown[] }[]): {
  message: Record<string, unknown>;
  transfer: unknown[];
}[] {
  return posted.filter((p) => (p.message as { type?: string }).type === "attach-service-port") as {
    message: Record<string, unknown>;
    transfer: unknown[];
  }[];
}

beforeEach(() => {
  electronState.ipcListeners.clear();
  electronState.messageChannels.length = 0;
  vi.clearAllMocks();
});

describe("bindDatabaseStartupRelay — snapshot state forwarding (inherited)", () => {
  it("forwards the latest state to the renderer on snapshot (receive-forward + snapshot-forward)", () => {
    const { win, webContents } = createFakeWindow();
    const { child } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1"));
    snapshotControl(webContents);
    const calls = stateSends(webContents);
    expect(calls.length).toBe(2);
    expect(calls[1]![1]).toMatchObject({ phase: "ready" });
  });

  it("ignores controls from a different webContents sender", () => {
    const { win } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1"));
    const attachesAfterReady = attachPosts(posted).length;
    const stranger = createFakeWindow().webContents;
    findControlListener()({ sender: stranger }, { action: "snapshot" });
    // The stranger's snapshot added nothing — only the ready transition's own attach is present.
    expect(attachPosts(posted)).toHaveLength(attachesAfterReady);
    expect(attachesAfterReady).toBe(1);
  });

  it("forwards nothing on snapshot before any state was received", () => {
    const { win, webContents } = createFakeWindow();
    const { child } = createFakeHost();
    bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    snapshotControl(webContents);
    expect(stateSends(webContents)).toHaveLength(0);
  });
});

describe("bindDatabaseStartupRelay — WFX-AGENT-PORT-REDELIVER-1 (webflix flavor)", () => {
  it("re-delivers the service port on the FIRST ready transition (the snapshot-before-ready ordering)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-42");
    // The renderer's boot chunk came up while storage preparation still ran:
    // its snapshot arrives BEFORE ready — the snapshot-path re-delivery is a
    // no-op at that moment.
    relay.receive({ ...readyState("startup-42"), phase: "starting" });
    snapshotControl(webContents);
    expect(attachPosts(posted)).toHaveLength(0);
    // The ready transition then re-delivers the port alongside the state.
    relay.receive({ ...readyState("startup-42"), phase: "ready", sequence: 2 });
    const attaches = attachPosts(posted);
    expect(attaches).toHaveLength(1);
    const message = attaches[0]?.message;
    expect(message?.clientMode).toBe("desktop-continuous");
    expect(message?.scope).toEqual({ kind: "local" });
    expect(typeof message?.requestId).toBe("string");
    expect(typeof message?.attachmentId).toBe("string");
    expect(attaches[0]?.transfer).toHaveLength(1);
    const portCalls = webContents.postMessage.mock.calls.filter(
      (call) => call[0] === InternalChannels.ServicePort,
    );
    expect(portCalls).toHaveLength(1);
    expect(portCalls[0]?.[1]).toEqual({ databaseStartupId: "startup-42" });
    expect(portCalls[0]?.[2]).toHaveLength(1);
  });

  it("re-delivers EXACTLY ONCE per ready generation (later ready forwards add no port)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1", 1));
    relay.receive({ ...readyState("startup-1", 2), disk: [{ sampledAt: 1 }] });
    relay.receive({ ...readyState("startup-1", 3), disk: [{ sampledAt: 2 }] });
    expect(attachPosts(posted)).toHaveLength(1);
    expect(
      webContents.postMessage.mock.calls.filter((call) => call[0] === InternalChannels.ServicePort),
    ).toHaveLength(1);
  });

  it("re-delivers on snapshot once ready (the cold-boot ordering: ready first, listener later)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    // Ready transition (renderer not listening yet — its port re-delivery is dropped).
    relay.receive(readyState("startup-1"));
    expect(attachPosts(posted)).toHaveLength(1);
    // The boot chunk finally evaluates; its snapshot asks for the state — and
    // the ready latest state makes the snapshot path re-deliver a fresh port.
    snapshotControl(webContents);
    expect(attachPosts(posted)).toHaveLength(2);
    const portCalls = webContents.postMessage.mock.calls.filter(
      (call) => call[0] === InternalChannels.ServicePort,
    );
    expect(portCalls).toHaveLength(2);
    expect(portCalls[1]?.[1]).toEqual({ databaseStartupId: "startup-1" });
  });

  it("replaces the pending port on repeat snapshots (the pending-port swap closes the superseded port renderer-side)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1"));
    snapshotControl(webContents);
    snapshotControl(webContents);
    // 1 from the ready transition + 2 from the snapshots.
    expect(attachPosts(posted)).toHaveLength(3);
    const portCalls = webContents.postMessage.mock.calls.filter(
      (call) => call[0] === InternalChannels.ServicePort,
    );
    expect(portCalls).toHaveLength(3);
  });

  it("does NOT re-deliver while the host state is not ready", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive({ ...readyState("startup-1"), phase: "starting" });
    snapshotControl(webContents);
    expect(attachPosts(posted)).toHaveLength(0);
    expect(webContents.postMessage).not.toHaveBeenCalled();
  });

  it("does NOT re-deliver after the host exited (state forced failed)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, exitListeners, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive({ ...readyState("startup-1"), phase: "starting" });
    (exitListeners[0] as () => void)();
    snapshotControl(webContents);
    expect(attachPosts(posted)).toHaveLength(0);
    expect(webContents.postMessage).not.toHaveBeenCalled();
  });

  it("does NOT re-deliver after the window closed (relay disposed, its control listener removed)", () => {
    const { win, webContents, fireClosed } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1"));
    const attachesBeforeClose = attachPosts(posted).length;
    const portCallsBeforeClose = webContents.postMessage.mock.calls.filter(
      (call) => call[0] === InternalChannels.ServicePort,
    ).length;
    fireClosed();
    // Disposed: the control listener is GONE — a late snapshot cannot even reach the relay.
    const list = electronState.ipcListeners.get(InternalChannels.DatabaseStartupControl) ?? [];
    expect(list).toHaveLength(0);
    expect(attachPosts(posted)).toHaveLength(attachesBeforeClose);
    expect(
      webContents.postMessage.mock.calls.filter((call) => call[0] === InternalChannels.ServicePort),
    ).toHaveLength(portCallsBeforeClose);
  });
});

describe("bindDatabaseStartupRelay — zero-ZCode-impact pin (inherited flavors)", () => {
  it("a production-flavor relay keeps exactly-once port delivery (NO re-delivery on snapshot or ready)", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1", {
      flavor: "production",
    });
    relay.receive(readyState("startup-1"));
    snapshotControl(webContents);
    // The inherited behavior: ready transitions and snapshots only forward the
    // STATE — never a port.
    expect(attachPosts(posted)).toHaveLength(0);
    expect(webContents.postMessage).not.toHaveBeenCalled();
    expect(stateSends(webContents)).toHaveLength(2);
  });
});

describe("bindDatabaseStartupRelay — exit control (inherited)", () => {
  it("accepts the exit control without re-delivering a port", () => {
    const { win, webContents } = createFakeWindow();
    const { child, posted } = createFakeHost();
    const relay = bindDatabaseStartupRelay(win as never, child as never, "startup-1");
    relay.receive(readyState("startup-1"));
    findControlListener()({ sender: webContents }, { action: "exit" });
    // The ready-transition re-delivery already fired on receive; the exit
    // control itself must not add another.
    expect(attachPosts(posted)).toHaveLength(1);
    expect(relay.startupId).toBe("startup-1");
  });
});
