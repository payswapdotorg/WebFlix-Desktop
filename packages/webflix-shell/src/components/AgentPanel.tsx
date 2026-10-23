// The agent panel SLOT (WFX-UX-SHELL-1, deliverable 7).
//
// ── SHORTCUTS ────────────────────────────────────────────────────────────
// Agent panel toggle .... Ctrl+J (Windows/Linux) · Cmd+J (macOS)
//   Handled at the AppShell level (window keydown); the shortcut label is
//   surfaced on the toggle button's title/aria-description and pinned by
//   the agent-panel tests. The handle also resizes by keyboard: focus the
//   resize handle and press ArrowLeft/ArrowRight (±32px, clamped to the
//   min/max widths; ArrowLeft widens, ArrowRight narrows — the panel docks
//   right, so left = bigger).
// ─────────────────────────────────────────────────────────────────────────
//
// What this slot IS:
// - A RIGHT-DOCKED, resizable, closable layout region — layout ONLY. The
//   panel CONTENT is Worker 3's lane (the ZCode chat surface dynamically
//   imports when the panel opens, per freeze §9.3); this component mounts
//   whatever `children` it is given, lazily: content mounts ONLY while the
//   panel is visible (a render-prop receives a `close` api).
// - Persisted: visibility + width commit through the injected
//   `PanelPersistence` port (the host provides storage; the default is
//   in-memory — survives navigation, not restarts — and says so).
// - NEVER an overlay: the slot is a flow child of the shell's body row,
//   so at ANY width (≥ its 320px minimum) it pushes content, it never
//   covers the watch player's controls (freeze §9.3/§9.6 posture; pinned
//   by the no-overlap test in tests/agent-panel.test.tsx).
//
// What it is NOT: no ZCode imports, no theme leakage (freeze §9.4 — the
// media shell keeps its own tokens; the CONTENT may scope its own), no
// chat runtime, no network.

import React, { useCallback, useRef, useState } from "react";
import { theme } from "../theme";

/** The persisted panel state (visibility + width). */
export interface AgentPanelViewState {
  readonly visible: boolean;
  /** Persisted width in px; null = the default width. */
  readonly widthPx: number | null;
}

/** The width-resize request payload (committed width in px). */
export type AgentPanelResizeRequest = number;

/**
 * Host-injected persistence (deliverable 7): the host provides storage;
 * the default is in-memory. `load` failures fall back to the initial
 * state — persistence is a convenience, never a crash.
 */
export interface PanelPersistence {
  load(): AgentPanelViewState;
  save(state: AgentPanelViewState): void;
}

/** The lazy-content api the render-prop receives. */
export interface AgentPanelApi {
  close(): void;
}

/** The documented toggle shortcut (see the SHORTCUTS block above). */
export const AGENT_PANEL_TOGGLE_SHORTCUT = "Ctrl+J / Cmd+J" as const;

/** In-memory persistence: survives navigation within the session only. */
export function createInMemoryPanelPersistence(
  initial: AgentPanelViewState = { visible: false, widthPx: null },
): PanelPersistence {
  let state = initial;
  return {
    load: () => state,
    save: (next) => {
      state = next;
    },
  };
}

export interface UseAgentPanelStateOptions {
  /** Host-injected storage; default: in-memory (session-only). */
  readonly persistence?: PanelPersistence;
  /** Mount-time state used when persistence yields nothing usable. */
  readonly initial?: AgentPanelViewState;
  /** Reports every COMMITTED state change (toggle, close, resize). */
  readonly onStateChange?: (state: AgentPanelViewState) => void;
}

/**
 * The panel state hook: loads from persistence on mount, commits every
 * change back, and reports commits to the host callback. Widths are
 * clamped to the frozen min/max before commit. The returned functions are
 * reference-stable (refs carry the latest state), so shell effects that
 * depend on them do not churn.
 */
export function useAgentPanelState(
  options: UseAgentPanelStateOptions = {},
): {
  state: AgentPanelViewState;
  toggle: () => void;
  setVisible: (visible: boolean) => void;
  resize: (widthPx: AgentPanelResizeRequest) => void;
} {
  const { persistence, initial, onStateChange } = options;
  const min = theme.layout.agentPanelMinWidth;
  const max = theme.layout.agentPanelMaxWidth;

  const [state, setState] = useState<AgentPanelViewState>(() => {
    // Precedence (the option docs' own law): persistence first — the stored
    // user preference is the truth; `initial` is the mount-time state used
    // when persistence yields nothing usable; the honest closed default
    // otherwise.
    if (persistence !== undefined) {
      try {
        const loaded = persistence.load();
        if (loaded !== null && typeof loaded.visible === "boolean") return loaded;
      } catch {
        // Persistence is convenience, never a crash: fall through to the
        // next honest source.
      }
    }
    if (initial !== undefined) return initial;
    return { visible: false, widthPx: null };
  });

  // Refs so commit() stays reference-stable while reading fresh values.
  const stateRef = useRef(state);
  stateRef.current = state;
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  const commit = useCallback(
    (next: AgentPanelViewState) => {
      const clamped: AgentPanelViewState = {
        visible: next.visible,
        widthPx:
          next.widthPx === null
            ? null
            : Math.min(max, Math.max(min, Math.round(next.widthPx))),
      };
      setState(clamped);
      try {
        persistenceRef.current?.save(clamped);
      } catch {
        // Storage refusal must not break the panel.
      }
      onStateChangeRef.current?.(clamped);
    },
    [min, max],
  );

  const toggle = useCallback(() => {
    const current = stateRef.current;
    commit({ visible: !current.visible, widthPx: current.widthPx });
  }, [commit]);

  const setVisible = useCallback(
    (visible: boolean) => {
      const current = stateRef.current;
      commit({ visible, widthPx: current.widthPx });
    },
    [commit],
  );

  const resize = useCallback(
    (widthPx: AgentPanelResizeRequest) => {
      commit({ visible: true, widthPx });
    },
    [commit],
  );

  return { state, toggle, setVisible, resize };
}

export interface AgentPanelSlotProps {
  /** The panel's element id (the toggle's aria-controls target). */
  readonly panelId?: string;
  readonly visible: boolean;
  readonly widthPx: number | null;
  /** Fired when the user closes the panel (its own close control). */
  readonly onRequestClose: () => void;
  /** Fired when a resize COMMITS (drag end / keyboard step / restore). */
  readonly onRequestResize?: (widthPx: AgentPanelResizeRequest) => void;
  /**
   * Lazy content: a node, or a render-prop receiving the close api. The
   * content mounts ONLY while `visible` is true.
   */
  readonly children?: React.ReactNode | ((api: AgentPanelApi) => React.ReactNode);
  readonly minWidth?: number;
  readonly maxWidth?: number;
  /** Heading for the panel's header row (also its aria-label). */
  readonly label?: string;
}

const DRAG_STEP_PX = 32;

const styles: Record<string, React.CSSProperties> = {
  hiddenSlot: { display: "none" },
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    height: "100%",
    boxSizing: "border-box",
    background: theme.colors.surface,
    borderLeft: `1px solid ${theme.colors.border}`,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    borderBottom: `1px solid ${theme.colors.border}`,
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: theme.typography.sizes.md,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  headerActions: { display: "flex", alignItems: "center", gap: theme.spacing.xs },
  closeButton: {
    background: "transparent",
    color: theme.colors.textMuted,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    padding: "6px 10px",
    minHeight: 32,
    minWidth: 32,
    cursor: "pointer",
    font: "inherit",
  },
  resizeHandle: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "col-resize",
    // The handle must be discoverable by keyboard; the focus ring comes
    // from the shell's focus-visible stylesheet.
    touchAction: "none",
  },
  resizeHandleDragging: { background: theme.colors.accent },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: theme.spacing.md,
  },
  empty: {
    margin: 0,
    color: theme.colors.textMuted,
    lineHeight: 1.5,
    fontSize: theme.typography.sizes.sm,
  },
};

/**
 * The right-docked slot. Layout-only, flow-positioned (never an overlay):
 * the parent lays it out beside the main surface and the persistent watch
 * column, so it cannot cover player controls at any width ≥ its minimum.
 */
export function AgentPanelSlot(props: AgentPanelSlotProps): React.ReactElement | null {
  const {
    panelId = "agent-panel",
    visible,
    widthPx,
    onRequestClose,
    onRequestResize,
    children,
    minWidth = theme.layout.agentPanelMinWidth,
    maxWidth = theme.layout.agentPanelMaxWidth,
    label = "Agent panel",
  } = props;

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragWidthRef = useRef<number | null>(null);

  const effectiveWidth = Math.min(
    maxWidth,
    Math.max(minWidth, dragWidth ?? widthPx ?? theme.layout.agentPanelDefaultWidth),
  );

  const requestResize = useCallback(
    (width: number) => {
      const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
      onRequestResize?.(clamped);
    },
    [onRequestResize, minWidth, maxWidth],
  );

  // Pointer drag: live width while dragging, commit on release. The commit
  // happens in the mouseup handler (not inside a state updater) so it fires
  // exactly once per drag.
  const onHandleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    draggingRef.current = true;
    dragWidthRef.current = effectiveWidth;
    setDragWidth(effectiveWidth);
    const onMove = (move: MouseEvent) => {
      if (!draggingRef.current) return;
      if (typeof window === "undefined") return;
      const next = window.innerWidth - move.clientX;
      const clamped = Math.min(maxWidth, Math.max(minWidth, next));
      dragWidthRef.current = clamped;
      setDragWidth(clamped);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const finalWidth = dragWidthRef.current;
      dragWidthRef.current = null;
      setDragWidth(null);
      if (finalWidth !== null) requestResize(finalWidth);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Keyboard resize: ArrowLeft widens (panel docks right), ArrowRight narrows.
  const onHandleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      requestResize(effectiveWidth + DRAG_STEP_PX);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      requestResize(effectiveWidth - DRAG_STEP_PX);
    }
  };

  const api = useRef<AgentPanelApi>({ close: onRequestClose });
  api.current = { close: onRequestClose };

  const renderChildren = (): React.ReactNode => {
    if (typeof children === "function") return children(api.current);
    return children;
  };

  if (!visible) {
    // Closed: the slot keeps NO content mounted (lazy) and hides itself
    // from the layout entirely (display none, not visibility — the media
    // surface reclaims the full width).
    return <div id={panelId} data-testid="agent-panel" style={styles.hiddenSlot} aria-hidden="true" />;
  }

  const content = renderChildren();
  const hasContent = content !== null && content !== undefined && content !== false && content !== "";

  return (
    <div
      id={panelId}
      data-testid="agent-panel"
      role="complementary"
      aria-label={label}
      style={{ ...styles.panel, width: effectiveWidth, flexShrink: 0 }}
    >
      <button
        type="button"
        data-testid="agent-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuenow={effectiveWidth}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        style={{
          ...styles.resizeHandle,
          ...(dragWidth !== null ? styles.resizeHandleDragging : undefined),
        }}
        onMouseDown={onHandleMouseDown}
        onKeyDown={onHandleKeyDown}
      />
      <header style={styles.header}>
        <h2 style={styles.headerTitle}>{label}</h2>
        <div style={styles.headerActions}>
          <button
            type="button"
            data-testid="agent-panel-close"
            aria-label={`Close ${label}`}
            style={styles.closeButton}
            onClick={onRequestClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </header>
      <div style={styles.body}>
        {hasContent ? (
          content
        ) : (
          <p data-testid="agent-panel-empty" style={styles.empty}>
            The agent panel is open, but no agent surface is mounted in this host yet. WebFlix does
            not fake an assistant — the panel shows real content the moment one is connected.
          </p>
        )}
      </div>
    </div>
  );
}
