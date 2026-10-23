import { describe, expect, it, vi } from "vitest";
import { InternalChannels } from "@zcode/shared";
import type { DatabaseStartupState } from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import {
  AgentRuntimeAdmissionController,
  type AgentRuntimeAdmissionDependencies,
  type AgentRuntimeAdmissionWindowTarget,
} from "../runtimeAdmission.js";

/**
 * WFX-AGENT-BRIDGE-1 — the admission handshake battery.
 *
 * Pins zcodeBoot's law, scoped to the two admission channels (verified
 * against zcodeBoot.tsx handleServicePortMessage + DatabaseStartupAdmission):
 *   - the snapshot control is sent when the listener installs;
 *   - DatabaseStartupState + ServicePort pair by startupId (ready(A) never
 *     admits an unrelated port(B));
 *   - connect + registerBaseWorkspaceServices + setStreamClientId run in
 *     order, then the handle resolves;
 *   - 30s-style wait guard: timeout resolves `null` (honest typed state);
 *   - single-admission safety: a cached handle survives later port messages
 *     and repeated getRuntime() calls (panel open/close cycles).
 */

interface FakeWindowTarget extends AgentRuntimeAdmissionWindowTarget {
  listeners: Array<(event: MessageEvent) => void>;
  posted: Array<{ data: unknown; targetOrigin: string }>;
}

function createFakeWindowTarget(): FakeWindowTarget {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const posted: Array<{ data: unknown; targetOrigin: string }> = [];
  const target: FakeWindowTarget = {
    listeners,
    posted,
    addEventListener: (type, listener) => {
      if (type === "message") listeners.push(listener);
    },
    removeEventListener: (type, listener) => {
      if (type !== "message") return;
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    postMessage: (data, targetOrigin) => {
      posted.push({ data, targetOrigin });
      return undefined;
    },
  };
  return target;
}

function makeMessageEvent(
  source: FakeWindowTarget,
  data: unknown,
  ports: unknown[] = [],
): MessageEvent {
  return { source, data, ports } as unknown as MessageEvent;
}

function postStartupState(target: FakeWindowTarget, state: DatabaseStartupState): void {
  for (const listener of target.listeners) {
    listener(makeMessageEvent(target, { type: InternalChannels.DatabaseStartupState, state }));
  }
}

function postServicePort(target: FakeWindowTarget, startupId: string, port: unknown): void {
  for (const listener of target.listeners) {
    listener(
      makeMessageEvent(target, { type: InternalChannels.ServicePort, databaseStartupId: startupId }, [port]),
    );
  }
}

function makeState(
  startupId: string,
  phase: DatabaseStartupState["phase"],
  sequence = 1,
): DatabaseStartupState {
  return {
    schemaVersion: 1,
    startupId,
    attemptId: `${startupId}-attempt`,
    sequence,
    startedAt: 1,
    updatedAt: 2,
    phase,
    disk: [],
  };
}

interface FakePort {
  close: ReturnType<typeof vi.fn>;
}

function createFakePort(): FakePort {
  return { close: vi.fn() };
}

interface Harness {
  controller: AgentRuntimeAdmissionController;
  windowTarget: FakeWindowTarget;
  connectServices: ReturnType<typeof vi.fn>;
  loadWorkspaceUiModule: ReturnType<typeof vi.fn>;
  deviceId: string;
}

function createHarness(overrides: Partial<AgentRuntimeAdmissionDependencies> = {}): Harness {
  const windowTarget = createFakeWindowTarget();
  const connectServices = vi.fn(
    () => ({ marker: "services" }) as unknown as IServiceAccessor,
  );
  const loadWorkspaceUiModule = vi.fn(() =>
    Promise.resolve({
      registerBaseWorkspaceServices: vi.fn(),
      setStreamClientId: vi.fn(),
    }),
  );
  const deps: AgentRuntimeAdmissionDependencies = {
    windowTarget,
    connectServices,
    loadWorkspaceUiModule,
    readDeviceId: () => "device-42",
    now: () => 1_700_000_000_000,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (timer) => clearTimeout(timer),
    ...overrides,
  };
  return {
    controller: new AgentRuntimeAdmissionController(deps),
    windowTarget,
    connectServices,
    loadWorkspaceUiModule,
    deviceId: "device-42",
  };
}

describe("runtimeAdmission — zcodeBoot's handshake law", () => {
  it("sends the snapshot control once when the listener installs (idempotent install)", () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    controller.install();
    controller.install();
    expect(windowTarget.posted).toHaveLength(1);
    expect(windowTarget.posted[0]).toEqual({
      data: { type: InternalChannels.DatabaseStartupControl, control: { action: "snapshot" } },
      targetOrigin: "*",
    });
  });

  it("ignores window messages whose source is not the renderer window", async () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    const runtime = controller.getRuntime({ timeoutMs: 20 });
    // A message from a different source (e.g. an iframe) must not pair.
    for (const listener of windowTarget.listeners) {
      listener(
        makeMessageEvent(createFakeWindowTarget(), {
          type: InternalChannels.ServicePort,
          databaseStartupId: "A",
        }, [createFakePort()]),
      );
    }
    await expect(runtime).resolves.toBeNull();
  });

  it("admits a matching state+port pair and connects through the lazy ui module", async () => {
    const { controller, windowTarget, connectServices, loadWorkspaceUiModule } = createHarness();
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 5_000 });
    postStartupState(windowTarget, makeState("A", "starting"));
    postStartupState(windowTarget, makeState("A", "ready", 2));
    const port = createFakePort();
    postServicePort(windowTarget, "A", port);
    const handle = await pending;
    expect(handle).not.toBeNull();
    expect(handle?.startupId).toBe("A");
    expect(handle?.services).toEqual({ marker: "services" });
    expect(connectServices).toHaveBeenCalledTimes(1);
    expect(connectServices).toHaveBeenCalledWith(port);
    expect(loadWorkspaceUiModule).toHaveBeenCalledTimes(1);
    const uiModule = await loadWorkspaceUiModule.mock.results[0]?.value;
    expect(uiModule.registerBaseWorkspaceServices).toHaveBeenCalledWith({ marker: "services" });
    expect(uiModule.setStreamClientId).toHaveBeenCalledWith("device-42");
    expect(controller.getSnapshot().phase).toBe("ready");
    expect(controller.getSnapshot().databasePhase).toBe("ready");
    expect(port.close).not.toHaveBeenCalled();
  });

  it("admits when the port arrives before the ready state (startupId pairing both orders)", async () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 5_000 });
    const port = createFakePort();
    postServicePort(windowTarget, "A", port);
    // Not yet ready — no admission so far.
    expect(controller.getSnapshot().phase).toBe("listening");
    postStartupState(windowTarget, makeState("A", "ready"));
    const handle = await pending;
    expect(handle?.startupId).toBe("A");
  });

  it("ready(A) never admits an unrelated port(B) — the pairing law", async () => {
    const { controller, windowTarget, connectServices } = createHarness();
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 40 });
    postStartupState(windowTarget, makeState("A", "ready"));
    const foreignPort = createFakePort();
    postServicePort(windowTarget, "B", foreignPort);
    // Port B stays pending — never connected, never closed by us (the
    // admission only closes superseded ports of its own pairing).
    await expect(pending).resolves.toBeNull();
    expect(connectServices).not.toHaveBeenCalled();
    // A later matching port A still admits.
    const portA = createFakePort();
    postServicePort(windowTarget, "A", portA);
    const retry = await controller.getRuntime({ timeoutMs: 5_000 });
    expect(retry?.startupId).toBe("A");
    expect(connectServices).toHaveBeenCalledWith(portA);
  });

  it("a stale-sequence state is rejected (zcodeBoot's acceptState law)", () => {
    const { controller, windowTarget, connectServices } = createHarness();
    controller.install();
    // sequence 5 "starting" wins over the stale sequence-3 "ready" echo.
    postStartupState(windowTarget, makeState("A", "starting", 5));
    postStartupState(windowTarget, makeState("A", "ready", 3));
    postServicePort(windowTarget, "A", createFakePort());
    expect(connectServices).not.toHaveBeenCalled();
    expect(controller.getSnapshot().databasePhase).toBe("starting");
  });

  it("times out to typed null when nothing arrives (honest unavailable state)", async () => {
    const { controller } = createHarness();
    controller.install();
    const startedAt = Date.now();
    const handle = await controller.getRuntime({ timeoutMs: 25 });
    expect(handle).toBeNull();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(controller.getSnapshot().phase).toBe("timed-out");
    expect(controller.getSnapshot().handle).toBeNull();
  });

  it("retry() re-arms a timed-out controller for the next wait", async () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    await expect(controller.getRuntime({ timeoutMs: 15 })).resolves.toBeNull();
    expect(controller.getSnapshot().phase).toBe("timed-out");
    controller.retry();
    expect(controller.getSnapshot().phase).toBe("listening");
    const pending = controller.getRuntime({ timeoutMs: 5_000 });
    postStartupState(windowTarget, makeState("A", "ready"));
    postServicePort(windowTarget, "A", createFakePort());
    await expect(pending).resolves.not.toBeNull();
  });

  it("single-admission safety: the cached handle survives later ports and repeated getRuntime()", async () => {
    const { controller, windowTarget, connectServices } = createHarness();
    controller.install();
    const first = controller.getRuntime({ timeoutMs: 5_000 });
    postStartupState(windowTarget, makeState("A", "ready"));
    postServicePort(windowTarget, "A", createFakePort());
    const handle = await first;
    // Later messages (host reload echo) must be ignored.
    postServicePort(windowTarget, "A2", createFakePort());
    postStartupState(windowTarget, makeState("A2", "ready"));
    const again = await controller.getRuntime({ timeoutMs: 5_000 });
    expect(again).toBe(handle);
    expect(connectServices).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().phase).toBe("ready");
  });

  it("a connect failure answers typed null and records the error (never a throw)", async () => {
    const { controller, windowTarget } = createHarness({
      connectServices: () => {
        throw new Error("port exploded");
      },
    });
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 5_000 });
    postStartupState(windowTarget, makeState("A", "ready"));
    postServicePort(windowTarget, "A", createFakePort());
    await expect(pending).resolves.toBeNull();
    const snapshot = controller.getSnapshot();
    expect(snapshot.phase).toBe("failed");
    expect(snapshot.lastError).toBe("port exploded");
  });

  it("a failing lazy ui module load fails the admission honestly", async () => {
    const { controller, windowTarget } = createHarness({
      loadWorkspaceUiModule: () => Promise.reject(new Error("ui bundle missing")),
    });
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 5_000 });
    postStartupState(windowTarget, makeState("A", "ready"));
    postServicePort(windowTarget, "A", createFakePort());
    await expect(pending).resolves.toBeNull();
    expect(controller.getSnapshot().lastError).toBe("ui bundle missing");
  });

  it("dispose(): removes the listener and resolves pending waiters with null", async () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    const pending = controller.getRuntime({ timeoutMs: 60_000 });
    controller.dispose();
    expect(windowTarget.listeners).toHaveLength(0);
    await expect(pending).resolves.toBeNull();
    expect(controller.getSnapshot().phase).toBe("listening");
  });

  it("ignores unrelated window message types (the webflix boot owns the rest of the bus)", async () => {
    const { controller, windowTarget, connectServices } = createHarness();
    controller.install();
    for (const listener of windowTarget.listeners) {
      listener(makeMessageEvent(windowTarget, { type: "some-other-channel" }));
      listener(makeMessageEvent(windowTarget, { type: InternalChannels.DatabaseStartupState }));
      listener(
        makeMessageEvent(windowTarget, { type: InternalChannels.ServicePort }, []),
      );
    }
    expect(connectServices).not.toHaveBeenCalled();
    expect(controller.getSnapshot().databasePhase).toBeNull();
  });

  it("rejects a malformed DatabaseStartupState payload (schema-validated, zcodeBoot law)", () => {
    const { controller, windowTarget, connectServices } = createHarness();
    controller.install();
    for (const listener of windowTarget.listeners) {
      listener(
        makeMessageEvent(windowTarget, {
          type: InternalChannels.DatabaseStartupState,
          state: { startupId: "A" },
        }),
      );
    }
    postServicePort(windowTarget, "A", createFakePort());
    expect(connectServices).not.toHaveBeenCalled();
    expect(controller.getSnapshot().databasePhase).toBeNull();
  });

  it("rejects a ServicePort payload without a databaseStartupId (port closed by admission)", () => {
    const { controller, windowTarget } = createHarness();
    controller.install();
    postStartupState(windowTarget, makeState("A", "ready"));
    const badPort = createFakePort();
    for (const listener of windowTarget.listeners) {
      listener(makeMessageEvent(windowTarget, { type: InternalChannels.ServicePort }, [badPort]));
    }
    expect(badPort.close).toHaveBeenCalled();
  });
});
