/*
 * WFX-AGENT-BRIDGE-1 — the renderer-side agent-runtime admission (freeze §9.3).
 *
 * The webflix flavor's main process ALREADY spawns the host utility process
 * (with the full ZCode agent runtime) on dom-ready and posts
 * `InternalChannels.ServicePort` + `DatabaseStartupState` to the renderer via
 * the preload — unconditionally (verified 2026-10-23, TL2). The media-first
 * webflix boot simply never listens. This module IS the listener.
 *
 * The law here replicates `zcodeBoot.tsx` exactly (same handshake, same
 * admission pairing, same 30s timeout guard):
 *
 *   1. listen for the preload's window messages (ServicePort with a
 *      transferred MessagePort + DatabaseStartupState);
 *   2. feed both into `DatabaseStartupAdmission` (state+port startupId
 *      pairing — ready(A) never pairs with an unrelated port(B));
 *   3. send the `snapshot` startup control so main re-forwards the latest
 *      startup state to this listener (mirrors zcodeBoot's boot send);
 *   4. once a matching state is `ready` and the port's startupId pairs,
 *      `connectViaMessagePort(port)` → services;
 *   5. lazily `import("@zcode/ui")` ONCE to run the SAME registration the
 *      ZCode boot runs — `registerBaseWorkspaceServices(services)` +
 *      `setStreamClientId(<device id>)`. The @zcode/ui JavaScript loads only
 *      when the agent panel first asks for the runtime, never at media-first
 *      boot (freeze §9.3 composition law);
 *   6. 30s wait guard: `getAgentRuntime()` resolves `null` (honest typed
 *      unavailable state — never a throw, never a fabricated runtime).
 *
 * Idempotence / single-admission safety (panel open/close cycles):
 *   - the window listener installs once per module evaluation (a module is
 *     evaluated once per renderer load);
 *   - after a handle is produced, later ServicePort/DatabaseStartupState
 *     messages are ignored (zcodeBoot's `appInitialized` guard, mirrored);
 *   - closing the agent panel does NOT dispose the runtime — the host
 *     connection and any long-running sessions stay alive so reopening the
 *     panel is instant and running tasks keep their execution identity;
 *   - `getAgentRuntime()` is safe to call any number of times: every call
 *     resolves with the SAME cached handle once admitted.
 *
 * Timing truth (why TL2 must import this module EARLY): the ServicePort
 * message is posted by main when the host spawns (after dom-ready + env
 * prewarm) and is delivered to whichever window listeners exist when the
 * message event dispatches. A listener installed only when the panel first
 * opens can miss it; the webflix boot must import this module (or call
 * `ensureAgentRuntimeAdmission()`) during renderer boot — the module pulls
 * ZERO @zcode/ui code, so the media-first surface stays ZCode-UI-free.
 */
import { DatabaseStartupAdmission } from "../databaseStartupAdmission.js";
import { connectViaMessagePort } from "@zcode/client";
import {
  InternalChannels,
  databaseStartupStateSchema,
  type DatabaseStartupState,
} from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";

/** The wait guard, mirroring zcodeBoot's 30s first-startup-state timer. */
export const AGENT_RUNTIME_ADMISSION_TIMEOUT_MS = 30_000;

/** A connected agent runtime. Cached for the renderer's lifetime (single admission). */
export interface AgentRuntimeHandle {
  readonly services: IServiceAccessor;
  /** The database startup generation this connection was admitted against. */
  readonly startupId: string;
  /** Epoch ms of admission (diagnostics/trace only). */
  readonly connectedAt: number;
}

/** The honest lifecycle phases the panel renders. */
export type AgentRuntimeAdmissionPhase = "listening" | "ready" | "timed-out" | "failed";

export interface AgentRuntimeAdmissionSnapshot {
  phase: AgentRuntimeAdmissionPhase;
  /** Latest accepted database startup phase (null = no state seen yet). */
  databasePhase: DatabaseStartupState["phase"] | null;
  /** A ServicePort arrived but admission has not completed. */
  hasPendingPort: boolean;
  /** The admitted handle (null until phase === "ready"). */
  handle: AgentRuntimeHandle | null;
  /** Typed connect-failure detail (phase === "failed"). */
  lastError: string | null;
}

/** The minimal window surface the handshake needs (jsdom/test fakes satisfy it). */
export interface AgentRuntimeAdmissionWindowTarget {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(data: unknown, targetOrigin: string): unknown;
}

/** Injectable seams — production binds the real surfaces; tests bind fakes. */
export interface AgentRuntimeAdmissionDependencies {
  /** The renderer window (preload posts ServicePort/DatabaseStartupState here). */
  windowTarget: AgentRuntimeAdmissionWindowTarget;
  /** connectViaMessagePort by default. */
  connectServices(port: MessagePort): IServiceAccessor;
  /**
   * The LAZY @zcode/ui loader — called exactly once, only when a paired port
   * is admitted (never at module evaluation). Runs registerBaseWorkspaceServices
   * + setStreamClientId from the loaded module.
   */
  loadWorkspaceUiModule(): Promise<AgentWorkspaceUiModule>;
  /** Device id, mirroring createDesktopPlatform().getDeviceId() without importing @zcode/ui. */
  readDeviceId(): string;
  now(): number;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(timer: ReturnType<typeof setTimeout>): void;
}

/** The @zcode/ui surface the admission needs (type-only view of the lazy import). */
export interface AgentWorkspaceUiModule {
  registerBaseWorkspaceServices(services: IServiceAccessor): void;
  setStreamClientId(clientId: string): void;
}

type RuntimeWaiter = {
  resolve: (handle: AgentRuntimeHandle | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The admission controller. One instance owns the window listener, the
 * DatabaseStartupAdmission pairing and the single cached runtime handle.
 * Construct directly in tests; production uses the module singleton.
 */
export class AgentRuntimeAdmissionController {
  private readonly deps: AgentRuntimeAdmissionDependencies;
  private readonly admission = new DatabaseStartupAdmission();
  private readonly waiterSet = new Set<RuntimeWaiter>();
  private installed = false;
  private handle: AgentRuntimeHandle | null = null;
  private phase: AgentRuntimeAdmissionPhase = "listening";
  private lastError: string | null = null;
  private connecting = false;
  private portSeen = false;

  constructor(deps: AgentRuntimeAdmissionDependencies) {
    this.deps = deps;
  }

  /** Installs the window listener (idempotent) + sends the snapshot control. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.deps.windowTarget.addEventListener("message", this.handleWindowMessage);
    // Mirror zcodeBoot's boot send: main re-forwards the latest startup state,
    // so a listener installed after the initial broadcast still learns the
    // current generation (the port itself is only posted on host spawn/reload).
    this.sendStartupControl({ action: "snapshot" });
  }

  /** Removes the listener and drops the cached handle (tests / renderer teardown). */
  dispose(): void {
    if (this.installed) {
      this.deps.windowTarget.removeEventListener("message", this.handleWindowMessage);
      this.installed = false;
    }
    for (const waiter of this.waiterSet) {
      this.deps.cancel(waiter.timer);
      waiter.resolve(null);
    }
    this.waiterSet.clear();
    this.handle = null;
    this.phase = "listening";
    this.lastError = null;
    this.connecting = false;
    this.portSeen = false;
  }

  /**
   * Waits for admission. Resolves the cached handle when already admitted,
   * otherwise waits up to `timeoutMs` (default 30s) and resolves `null` on
   * timeout — the honest unavailable state.
   */
  getRuntime(options: { timeoutMs?: number } = {}): Promise<AgentRuntimeHandle | null> {
    this.install();
    if (this.handle) return Promise.resolve(this.handle);
    const timeoutMs = options.timeoutMs ?? AGENT_RUNTIME_ADMISSION_TIMEOUT_MS;
    return new Promise<AgentRuntimeHandle | null>((resolve) => {
      const waiter: RuntimeWaiter = {
        resolve,
        timer: this.deps.schedule(() => {
          this.waiterSet.delete(waiter);
          if (this.handle) {
            resolve(this.handle);
            return;
          }
          if (this.phase !== "failed") this.phase = "timed-out";
          resolve(null);
        }, timeoutMs),
      };
      this.waiterSet.add(waiter);
    });
  }

  /** The typed status the panel renders (never throws, never blocks). */
  getSnapshot(): AgentRuntimeAdmissionSnapshot {
    return {
      phase: this.phase,
      databasePhase: this.admission.state?.phase ?? null,
      hasPendingPort: this.connecting || (this.portSeen && this.handle === null),
      handle: this.handle,
      lastError: this.lastError,
    };
  }

  /** Re-arms a timed-out wait: the next getRuntime() call waits afresh. */
  retry(): void {
    if (this.handle) return;
    if (this.phase === "timed-out") this.phase = "listening";
  }

  private sendStartupControl(control: { action: "snapshot" }): void {
    this.deps.windowTarget.postMessage(
      { type: InternalChannels.DatabaseStartupControl, control },
      "*",
    );
  }

  /**
   * zcodeBoot's handleServicePortMessage law, scoped to the two admission
   * channels (ServicePort + DatabaseStartupState); everything else on the
   * window bus is ignored — the webflix boot owns the remaining traffic.
   */
  private handleWindowMessage = (event: MessageEvent): void => {
    if (event.source !== this.deps.windowTarget) return;

    if (event.data?.type === InternalChannels.DatabaseStartupState) {
      const result = databaseStartupStateSchema.safeParse(event.data.state);
      if (!result.success || this.handle) return;
      if (!this.admission.acceptState(result.data)) return;
      this.tryAdmit();
      return;
    }

    if (event.data?.type !== InternalChannels.ServicePort || this.handle) return;
    const port = event.ports?.[0];
    if (!port) return;
    this.portSeen = true;
    this.admission.acceptPort({ databaseStartupId: event.data.databaseStartupId }, port);
    this.tryAdmit();
  };

  /** state ready + startupId-paired port → connect (exactly once). */
  private tryAdmit(): void {
    if (this.handle || this.connecting) return;
    const port = this.admission.takeReadyPort();
    if (!port) return;
    const startupId = this.admission.state?.startupId ?? "";
    this.connecting = true;
    void this.connect(port, startupId);
  }

  private async connect(port: MessagePort, startupId: string): Promise<void> {
    try {
      const services = this.deps.connectServices(port);
      const ui = await this.deps.loadWorkspaceUiModule();
      ui.registerBaseWorkspaceServices(services);
      ui.setStreamClientId(this.deps.readDeviceId());
      const handle: AgentRuntimeHandle = {
        services,
        startupId,
        connectedAt: this.deps.now(),
      };
      this.handle = handle;
      this.phase = "ready";
      this.lastError = null;
      this.connecting = false;
      for (const waiter of this.waiterSet) {
        this.deps.cancel(waiter.timer);
        waiter.resolve(handle);
      }
      this.waiterSet.clear();
    } catch (error) {
      this.connecting = false;
      this.phase = "failed";
      this.lastError = describeError(error);
      for (const waiter of this.waiterSet) {
        this.deps.cancel(waiter.timer);
        waiter.resolve(null);
      }
      this.waiterSet.clear();
    }
  }
}

// ---------------------------------------------------------------------------
// The production singleton
// ---------------------------------------------------------------------------

let defaultController: AgentRuntimeAdmissionController | null = null;

function readRendererDeviceId(): string {
  return (
    (globalThis as typeof globalThis & { __ZCODE_DEVICE_ID__?: string }).__ZCODE_DEVICE_ID__ ?? ""
  );
}

function productionDependencies(): AgentRuntimeAdmissionDependencies {
  return {
    // The renderer window (guarded — node-env test imports never touch it).
    windowTarget: globalThis.window as unknown as AgentRuntimeAdmissionWindowTarget,
    connectServices: (port) => connectViaMessagePort(port),
    // The lazy boundary: @zcode/ui loads only after a paired port is admitted.
    loadWorkspaceUiModule: () =>
      import("@zcode/ui") as Promise<AgentWorkspaceUiModule & Record<string, unknown>>,
    readDeviceId: readRendererDeviceId,
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (timer) => clearTimeout(timer),
  };
}

/**
 * Installs the admission listener on the renderer window (idempotent).
 * Called at this module's evaluation — importing the module is the act of
 * listening (the cheap path TL2's boot takes while the panel stays lazy).
 * No-op in non-window environments (node test imports).
 */
export function ensureAgentRuntimeAdmission(): AgentRuntimeAdmissionController | null {
  if (typeof globalThis.window === "undefined") return null;
  if (defaultController === null) {
    defaultController = new AgentRuntimeAdmissionController(productionDependencies());
    defaultController.install();
  }
  return defaultController;
}

/**
 * The mount API the agent panel (and any agent-side adapter) uses:
 * resolves the admitted ZCode runtime services, or `null` after the 30s wait
 * (timeout / connect failure — the honest typed unavailable state).
 */
export function getAgentRuntime(
  options: { timeoutMs?: number } = {},
): Promise<AgentRuntimeHandle | null> {
  const controller = ensureAgentRuntimeAdmission();
  if (controller === null) {
    // No window (node runtime): the bridge cannot exist — typed null, never a throw.
    return Promise.resolve(null);
  }
  return controller.getRuntime(options);
}

/** The typed status for the panel's connecting/unavailable states. */
export function getAgentRuntimeAdmissionSnapshot(): AgentRuntimeAdmissionSnapshot {
  const controller = ensureAgentRuntimeAdmission();
  if (controller === null) {
    return {
      phase: "failed",
      databasePhase: null,
      hasPendingPort: false,
      handle: null,
      lastError: "no renderer window in this runtime",
    };
  }
  return controller.getSnapshot();
}

/** Re-arms a timed-out admission (the panel's retry affordance). */
export function retryAgentRuntimeAdmission(): void {
  defaultController?.retry();
}

/** Test/teardown hook: fully resets the singleton (never called in production paths). */
export function __resetAgentRuntimeAdmissionForTest(): void {
  defaultController?.dispose();
  defaultController = null;
}

ensureAgentRuntimeAdmission();
