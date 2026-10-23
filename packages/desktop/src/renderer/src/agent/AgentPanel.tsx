/**
 * WFX-AGENT-BRIDGE-1 — the toggleable ZCode agent panel (freeze §9.3).
 *
 * The MOUNT API TL2's shell integration calls:
 *
 *   <AgentPanel
 *     workspacePath="<dataRoot>/agent-workspace"   // freeze §9.7
 *     onClose={() => setAgentPanelVisible(false)}  // the shell owns visibility
 *     uiActionHandlers={handlers}                  // the typed host record (memoize: one stable bridge)
 *     onBridgeReady={(bridge) => {                 // OPTIONAL: acceptance evidence
 *       agentBridge = bridge;                      // bridge.trace.export() → AgentActionTraceEntry[]
 *     }}
 *   />
 *
 * EARLY ADMISSION (timing law): the host utility process posts the
 * ServicePort MessagePort once (at spawn, after dom-ready) — a window
 * listener installed only when the panel first opens can miss it. TL2's
 * boot should import this module's admission seam at renderer boot (it
 * pulls ZERO @zcode/ui code):
 *
 *   import { ensureAgentRuntimeAdmission } from ".../agent/runtimeAdmission.js";
 *   ensureAgentRuntimeAdmission(); // installs the window listener + snapshot ask
 *
 * Composition law:
 *   - This module imports NOTHING from @zcode/ui — the media-first shell
 *     never pays the ZCode UI bundle cost until the panel opens (freeze
 *     §9.3). The real chat surface (V4ChatPane behind the full provider
 *     stack) loads through a dynamic import ONLY when the runtime is
 *     admitted (see agentChatSurface.tsx — that module statically imports
 *     @zcode/ui + its stylesheet, and is reachable only dynamically).
 *   - The panel chrome is self-contained inline styling (no ZCode theme
 *     classes, no webflix-shell dependency) so it cannot restyle or be
 *     restyled by either surface.
 *   - Honest unavailable states: while connecting, the typed admission
 *     snapshot is shown; on 30s timeout (or connect failure) the panel
 *     renders the typed unavailable state with a retry affordance — never a
 *     spinner lie, never a fabricated runtime.
 *   - Panel close does NOT dispose the admitted runtime (sessions and long
 *     tasks keep their execution identity; reopening is instant).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getAgentRuntime,
  retryAgentRuntimeAdmission,
  type AgentRuntimeHandle,
} from "./runtimeAdmission.js";
import { createUiActionBridge, type UiActionBridge, type UiActionHandlers } from "./uiActionBridge.js";
import { startWebflixUiActionRendezvous } from "./uiActionRendezvous.js";

/** The ZCode theme root classes the lazy surface container carries (freeze §9.4). */
export const AGENT_ZCODE_THEME_ROOT_CLASSNAMES = ["dark", "theme-zai-dark"] as const;

/** Props of the lazily-imported chat surface module (agentChatSurface.tsx). */
export interface AgentChatSurfaceProps {
  workspacePath: string;
  runtime: AgentRuntimeHandle;
  /** Extra chrome above the chat surface (the task/session strip is internal). */
  header?: ReactNode;
}

/** The lazy module contract — tests inject fakes; production dynamic-imports. */
export type LoadAgentChatSurface = () => Promise<{
  AgentChatSurface: (props: AgentChatSurfaceProps) => ReactNode;
}>;

export interface AgentPanelProps {
  /** The agent workspace dir (freeze §9.7: `<dataRoot>/agent-workspace`, TL2 injects). */
  workspacePath: string;
  /** Close affordance — the shell owns panel visibility/width persistence. */
  onClose: () => void;
  /** TL2's typed handler record (the same use cases the UI buttons use). */
  uiActionHandlers: UiActionHandlers;
  /**
   * Host hook for the acceptance-run evidence: invoked once per bridge
   * (re)creation with the live `UiActionBridge` — its `trace` buffer is the
   * exportable AgentActionTraceEntry evidence (read `bridge.trace.export()`;
   * `bridge.dispatch` is the same frozen dispatcher the webflix_ui tool rides).
   * Memoize `uiActionHandlers` at the call site to keep one stable bridge.
   */
  onBridgeReady?: (bridge: UiActionBridge) => void;
  /** Test seam: the runtime wait (default: the real admission module). */
  getRuntime?: (options: { timeoutMs?: number }) => Promise<AgentRuntimeHandle | null>;
  /** Test seam: the lazy surface loader (default: dynamic import — never static). */
  loadChatSurface?: LoadAgentChatSurface;
  /** Test seam: the rendezvous factory (default: the real responder). */
  startRendezvous?: typeof startWebflixUiActionRendezvous;
  /** Test seam: retry re-arm (default: the real admission module's). */
  retryAdmission?: () => void;
  /** Admission wait override (tests shrink; default: the frozen 30s). */
  admissionTimeoutMs?: number;
}

const panelStyles: Record<string, React.CSSProperties> = {
  root: {
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "#101014",
    color: "#e7e7ea",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderBottom: "1px solid #2a2a31",
    flex: "0 0 auto",
  },
  title: { fontWeight: 600, fontSize: 13, letterSpacing: 0.2 },
  subtitle: { color: "#9a9aa3", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  closeButton: {
    flex: "0 0 auto",
    background: "transparent",
    border: "1px solid #2a2a31",
    borderRadius: 6,
    color: "#c9c9d1",
    cursor: "pointer",
    fontSize: 11,
    padding: "3px 8px",
  },
  body: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  stateBox: {
    margin: 12,
    padding: 12,
    border: "1px solid #2a2a31",
    borderRadius: 8,
    background: "#16161b",
    lineHeight: 1.5,
    fontSize: 12.5,
  },
  stateTitle: { fontWeight: 600, marginBottom: 4 },
  retryButton: {
    marginTop: 10,
    background: "#2450ff",
    border: "none",
    borderRadius: 6,
    color: "white",
    cursor: "pointer",
    fontSize: 12,
    padding: "6px 12px",
  },
};

type PanelPhase =
  | { kind: "connecting" }
  | { kind: "unavailable"; reason: string; retryable: boolean }
  | { kind: "ready"; runtime: AgentRuntimeHandle };

/**
 * The panel: admission-aware wrapper that lazily mounts the REAL ZCode chat.
 * The lazy surface module (agentChatSurface.tsx) is the ONLY @zcode/ui
 * import boundary and is loaded exclusively via dynamic import.
 */
export function AgentPanel({
  workspacePath,
  onClose,
  uiActionHandlers,
  onBridgeReady,
  getRuntime = getAgentRuntime,
  loadChatSurface,
  startRendezvous = startWebflixUiActionRendezvous,
  retryAdmission = retryAgentRuntimeAdmission,
  admissionTimeoutMs,
}: AgentPanelProps) {
  const [phase, setPhase] = useState<PanelPhase>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [surfaceModule, setSurfaceModule] = useState<Awaited<ReturnType<LoadAgentChatSurface>> | null>(null);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const bridge = useMemo(() => createUiActionBridge(uiActionHandlers), [uiActionHandlers]);
  const rendezvousRef = useRef<{ stop(): void } | null>(null);

  // Hand the live bridge (trace buffer included) to the host — the
  // acceptance-run evidence surface. Fires once per bridge (re)creation.
  useEffect(() => {
    onBridgeReady?.(bridge);
  }, [bridge, onBridgeReady]);

  // The admission wait — one per attempt; resolves the handle or null (timeout).
  useEffect(() => {
    let active = true;
    setPhase({ kind: "connecting" });
    void getRuntime(admissionTimeoutMs ? { timeoutMs: admissionTimeoutMs } : {}).then((runtime) => {
      if (!active) return;
      if (runtime === null) {
        setPhase({
          kind: "unavailable",
          reason:
            "The ZCode agent runtime did not deliver its service port to this window within the admission wait. The host utility process posts the port once (at spawn, after dom-ready); if this renderer started listening after that moment the port was already dropped — reloading the window re-attaches it.",
          retryable: true,
        });
        return;
      }
      setPhase({ kind: "ready", runtime });
    });
    return () => {
      active = false;
    };
  }, [attempt, getRuntime, admissionTimeoutMs]);

  // The lazy @zcode/ui boundary: the surface module loads ONLY when the
  // runtime is admitted (the panel is open and the user is waiting on chat).
  useEffect(() => {
    if (phase.kind !== "ready") return;
    let active = true;
    const loader = loadChatSurface ?? defaultLoadChatSurface;
    void loader()
      .then((module) => {
        if (active) setSurfaceModule(module);
      })
      .catch((error: unknown) => {
        if (active) {
          setSurfaceError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      active = false;
    };
  }, [phase, loadChatSurface]);

  // The webflix_ui tool rendezvous responder — started when the bridge has
  // real services to read with; stopped when the panel unmounts (a new open
  // restarts it; the dispatcher itself is stateless). The stats counter is
  // polled (2s) so the bridge note reflects real tool-call activity instead
  // of freezing at the value captured at start.
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const handle = startRendezvous({
      workspacePath,
      fileService: phase.runtime.services.fileService,
      bridge,
    });
    rendezvousRef.current = handle;
    setSessionCount(handle.stats().dispatched);
    const statsTimer = window.setInterval(() => {
      setSessionCount(handle.stats().dispatched);
    }, 2_000);
    return () => {
      window.clearInterval(statsTimer);
      handle.stop();
      if (rendezvousRef.current === handle) rendezvousRef.current = null;
    };
  }, [phase, workspacePath, bridge, startRendezvous]);

  const handleRetry = useCallback(() => {
    retryAdmission();
    setSurfaceModule(null);
    setSurfaceError(null);
    setAttempt((n) => n + 1);
  }, [retryAdmission]);

  const subtitle =
    phase.kind === "ready"
      ? `${workspacePath}`
      : phase.kind === "connecting"
        ? "connecting to the agent runtime…"
        : "agent runtime unavailable";

  return (
    <section
      style={panelStyles.root}
      data-testid="agent-panel-root"
      aria-label="ZCode agent panel"
    >
      <header style={panelStyles.header}>
        <span style={panelStyles.title} data-testid="agent-panel-title">
          Agent
        </span>
        <span style={panelStyles.subtitle} data-testid="agent-panel-subtitle" title={subtitle}>
          {subtitle}
        </span>
        <button
          type="button"
          style={panelStyles.closeButton}
          onClick={onClose}
          data-testid="agent-panel-close"
          aria-label="Close agent panel"
        >
          Close
        </button>
      </header>
      <div style={panelStyles.body}>
        {phase.kind === "connecting" && (
          <div style={panelStyles.stateBox} data-testid="agent-panel-connecting">
            <div style={panelStyles.stateTitle}>Connecting to the ZCode agent runtime…</div>
            <p style={{ margin: 0, color: "#9a9aa3" }}>
              Waiting for the host utility process to admit the service port (same
              DatabaseStartup handshake the ZCode desktop uses). Nothing is simulated —
              if the runtime does not answer, this panel will say so.
            </p>
          </div>
        )}
        {phase.kind === "unavailable" && (
          <div
            style={panelStyles.stateBox}
            data-testid="agent-panel-unavailable"
            role="alert"
          >
            <div style={panelStyles.stateTitle}>Agent runtime unavailable</div>
            <p style={{ margin: 0, color: "#c9c9d1" }}>{phase.reason}</p>
            {phase.retryable && (
              <button
                type="button"
                style={panelStyles.retryButton}
                onClick={handleRetry}
                data-testid="agent-panel-retry"
              >
                Retry connection
              </button>
            )}
          </div>
        )}
        {phase.kind === "ready" && surfaceModule === null && surfaceError === null && (
          <div style={panelStyles.stateBox} data-testid="agent-panel-loading-surface">
            <div style={panelStyles.stateTitle}>Loading the ZCode chat surface…</div>
            <p style={{ margin: 0, color: "#9a9aa3" }}>
              The real V4 chat pane and its stylesheet load now — only for this panel
              (the media-first app never loads them at boot).
            </p>
          </div>
        )}
        {phase.kind === "ready" && surfaceError !== null && (
          <div style={panelStyles.stateBox} data-testid="agent-panel-surface-error" role="alert">
            <div style={panelStyles.stateTitle}>The chat surface failed to load</div>
            <p style={{ margin: 0, color: "#c9c9d1" }}>{surfaceError}</p>
            <button
              type="button"
              style={panelStyles.retryButton}
              onClick={() => {
                setSurfaceError(null);
                setSurfaceModule(null);
                setAttempt((n) => n + 1);
              }}
              data-testid="agent-panel-surface-retry"
            >
              Retry loading
            </button>
          </div>
        )}
        {phase.kind === "ready" && surfaceModule !== null && (
          <surfaceModule.AgentChatSurface
            workspacePath={workspacePath}
            runtime={phase.runtime}
            header={
              <span data-testid="agent-panel-bridge-note">
                webflix_ui bridge active{sessionCount > 0 ? ` — ${sessionCount} action(s) dispatched` : ""}
              </span>
            }
          />
        )}
      </div>
    </section>
  );
}

/**
 * The production lazy loader — a DYNAMIC import (never static): the
 * agentChatSurface module statically imports @zcode/ui + styles.css, so it
 * must stay unreachable from the media-first boot graph.
 */
function defaultLoadChatSurface(): Promise<{
  AgentChatSurface: (props: AgentChatSurfaceProps) => ReactNode;
}> {
  return import("./agentChatSurface.js");
}
