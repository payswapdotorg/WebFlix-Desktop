/*
 * WFX-AGENT-BRIDGE-1 — the UI-action bridge executor (freeze §9.1).
 *
 * Implements the FROZEN `UiActionDispatcher` port from
 * `webflix-contracts/src/ui-actions.ts` (v0.14.0) over an injected, typed
 * `UiActionHandlers` record that TL2's boot integration provides — the SAME
 * application use cases the visible WebFlix UI buttons use. The bridge is a
 * typed facade, never a parallel implementation:
 *
 *   - dispatch(action) routes to the matching handler (exactly one call per
 *     dispatch) and returns a SCHEMA-NORMALIZED `UiActionResult`:
 *       ok (summary + items + channels + evidence + post-action context),
 *       failure (typed code + message + retryable),
 *       needs-user-choice (verbatim prompt + labeled choices — the agent
 *         ASKS, it never picks for the user),
 *       unsupported (frozen CapabilityStatus + reason + operationId);
 *   - a missing/unwired handler answers a typed `unsupported` result — the
 *     frozen capability vocabulary, never a silent no-op;
 *   - a thrown handler error becomes a typed `failure` (bridge-unavailable,
 *     retryable) — the bridge never lets an exception escape as an
 *     unstructured tool error;
 *   - every dispatch (including failures/choices/unsupported) records an
 *     `AgentActionTraceEntry` in the exportable, bounded trace buffer — the
 *     acceptance-run evidence;
 *   - `getVisibleMediaContext()` answers from the injected host provider —
 *     the agent NEVER scrapes the renderer DOM (freeze §9.1: context comes
 *     from the host's own state, `visibleItemIds` capped by the contract);
 *   - NO DOM manipulation anywhere in this module.
 *
 * The frozen 7-action set is navigation/read/play ONLY. Provider account
 * mutations (like, subscribe, comment, playlist writes) are deliberately
 * absent from the contract and therefore unreachable through this bridge.
 */
import {
  AgentActionTraceEntrySchema,
  UiActionResultSchema,
  UiActionSchema,
  VisibleMediaContextSchema,
  type AgentActionTraceEntry,
  type UiAction,
  type UiActionResult,
  type UiActionDispatcher,
  type VisibleMediaContext,
} from "../../../../../webflix-contracts/src/ui-actions.js";

/** The 7 frozen action kinds — the closed routing table. */
export const UI_ACTION_KINDS = [
  "searchCatalog",
  "resolveChannel",
  "openRoute",
  "playCatalogItem",
  "openAccountConnection",
  "toggleAgentPanel",
  "getVisibleMediaContext",
] as const;

export type UiActionKind = (typeof UI_ACTION_KINDS)[number];

type UiActionOf<K extends UiActionKind> = Extract<UiAction, { action: K }>;

/**
 * The host-provided handler record — TL2's boot integration binds each entry
 * to the app's own use case (searchCatalog → the search port the Search
 * screen uses; playCatalogItem → the playback planning path the player uses).
 * Every handler returns a TYPED result; ambiguity must surface as
 * needs-user-choice, never as a silent guess.
 */
export interface UiActionHandlers {
  searchCatalog(action: UiActionOf<"searchCatalog">): Promise<UiActionResult>;
  resolveChannel(action: UiActionOf<"resolveChannel">): Promise<UiActionResult>;
  openRoute(action: UiActionOf<"openRoute">): Promise<UiActionResult>;
  playCatalogItem(action: UiActionOf<"playCatalogItem">): Promise<UiActionResult>;
  openAccountConnection(action: UiActionOf<"openAccountConnection">): Promise<UiActionResult>;
  toggleAgentPanel(action: UiActionOf<"toggleAgentPanel">): Promise<UiActionResult>;
  /** The visible-media snapshot from the host's OWN state (never a DOM scrape). */
  getVisibleMediaContext(): VisibleMediaContext;
}

/** The bounded, exportable action-trace evidence buffer. */
export interface AgentActionTraceBuffer {
  getEntries(): readonly AgentActionTraceEntry[];
  /** A detached copy for export (acceptance evidence). */
  export(): AgentActionTraceEntry[];
  clear(): void;
}

/** The frozen dispatcher + the trace evidence surface. */
export interface UiActionBridge extends UiActionDispatcher {
  readonly trace: AgentActionTraceBuffer;
}

const TRACE_BUFFER_CAP = 500;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parses/validates unknown dispatch input against the FROZEN UiActionSchema,
 * answering the typed failure for the two malformed cases:
 * `unknown-action` (not one of the frozen 7 kinds) and `invalid-action`
 * (a known kind with a malformed payload). Shared by the bridge's defensive
 * path and the agent-side tool input validation.
 */
export function parseUiActionInput(
  input: unknown,
): { ok: true; action: UiAction } | { ok: false; result: UiActionResult } {
  const actionKind =
    typeof input === "object" && input !== null
      ? (input as { action?: unknown }).action
      : undefined;
  if (typeof actionKind !== "string" || !(UI_ACTION_KINDS as readonly string[]).includes(actionKind)) {
    return {
      ok: false,
      result: {
        kind: "failure",
        code: "unknown-action",
        message: `"${String(actionKind)}" is not one of the frozen UI actions (${UI_ACTION_KINDS.join(", ")})`,
        retryable: false,
      },
    };
  }
  const parsed = UiActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      result: {
        kind: "failure",
        code: "invalid-action",
        message: `malformed ${actionKind} payload: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`)
          .join("; ")}`,
        retryable: false,
      },
    };
  }
  return { ok: true, action: parsed.data };
}

function unsupportedUnwiredResult(actionKind: string): UiActionResult {
  return {
    kind: "unsupported",
    capability: "unavailable",
    reason: `The WebFlix host did not wire the "${actionKind}" action — this build answers honestly instead of pretending to act.`,
  };
}

function normalizeResult(raw: unknown): { ok: true; result: UiActionResult } | { ok: false } {
  const parsed = UiActionResultSchema.safeParse(raw);
  if (parsed.success) {
    // Return the schema-normalized view (defaults applied by the contract).
    return { ok: true, result: parsed.data as UiActionResult };
  }
  return { ok: false };
}

function thrownFailure(actionKind: string, error: unknown): UiActionResult {
  return {
    kind: "failure",
    code: "bridge-unavailable",
    message: `The "${actionKind}" use case failed unexpectedly: ${
      error instanceof Error ? error.message : String(error)
    }`,
    retryable: true,
  };
}

function summarizeResult(result: UiActionResult): string {
  switch (result.kind) {
    case "ok":
      return result.summary;
    case "failure":
      return `[${result.code}] ${result.message}`;
    case "needs-user-choice":
      return result.prompt;
    case "unsupported":
      return `[${result.capability}] ${result.reason}`;
  }
}

function buildContextEvidence(context: VisibleMediaContext): string[] {
  const evidence: string[] = [`route=${context.route}`, `playingItem=${context.playingItem?.itemId ?? "none"}`];
  if (context.visibleItemIds.length > 0) {
    evidence.push(`visibleItemIds(${context.visibleItemIds.length})=${context.visibleItemIds.join(",")}`);
  }
  evidence.push(`agentPanel.visible=${context.agentPanel.visible}`);
  return evidence;
}

function createContextReadResult(context: VisibleMediaContext): UiActionResult {
  const validated = VisibleMediaContextSchema.safeParse(context);
  if (!validated.success) {
    return {
      kind: "failure",
      code: "bridge-unavailable",
      message: `The visible-media context provider returned a non-conforming snapshot: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "context"} ${issue.message}`)
        .join("; ")}`,
      retryable: false,
    };
  }
  const snapshot = validated.data;
  return {
    kind: "ok",
    summary: `Read the visible media context from host state: route "${snapshot.route}"${
      snapshot.playingItem ? `, playing "${snapshot.playingItem.title}" (${snapshot.playingItem.itemId})` : ", nothing playing"
    }.`,
    items: [],
    channels: [],
    evidence: buildContextEvidence(snapshot),
    context: snapshot,
  };
}

/**
 * Builds the bridge over the injected host handlers. The result is the frozen
 * `UiActionDispatcher` plus the trace evidence surface.
 */
export function createUiActionBridge(handlers: UiActionHandlers): UiActionBridge {
  const entries: AgentActionTraceEntry[] = [];
  const traceBuffer: AgentActionTraceBuffer = {
    getEntries: () => entries,
    export: () => entries.map((entry) => ({ ...entry, action: { ...entry.action } })),
    clear: () => {
      entries.length = 0;
    },
  };

  const recordTrace = (action: UiAction, result: UiActionResult): void => {
    const candidate: AgentActionTraceEntry = {
      at: nowIso(),
      action,
      outcomeKind: result.kind,
      summary: summarizeResult(result),
    };
    const validated = AgentActionTraceEntrySchema.safeParse(candidate);
    if (!validated.success) return;
    entries.push(validated.data as AgentActionTraceEntry);
    if (entries.length > TRACE_BUFFER_CAP) {
      entries.splice(0, entries.length - TRACE_BUFFER_CAP);
    }
  };

  const dispatch = async (action: UiAction): Promise<UiActionResult> => {
    // Defensive re-validation of the frozen contract at the boundary (a JS
    // caller can pass anything; typed callers get the same guarantee).
    const parsedInput = parseUiActionInput(action);
    if (!parsedInput.ok) {
      // Malformed input is answered with the typed failure but NOT traced:
      // AgentActionTraceEntrySchema only carries schema-valid UiActions, and
      // inventing a stand-in action would falsify the evidence.
      return parsedInput.result;
    }
    const typedAction = parsedInput.action;

    switch (typedAction.action) {
      case "getVisibleMediaContext": {
        if (typeof handlers.getVisibleMediaContext !== "function") {
          const result = unsupportedUnwiredResult("getVisibleMediaContext");
          recordTrace(typedAction, result);
          return result;
        }
        // The context read is synchronous host state — no await, no guessing.
        const result = createContextReadResult(handlers.getVisibleMediaContext());
        recordTrace(typedAction, result);
        return result;
      }
      case "searchCatalog":
      case "resolveChannel":
      case "openRoute":
      case "playCatalogItem":
      case "openAccountConnection":
      case "toggleAgentPanel": {
        const handler = handlers[typedAction.action] as
          | ((action: UiAction) => Promise<UiActionResult>)
          | undefined;
        if (typeof handler !== "function") {
          const result = unsupportedUnwiredResult(typedAction.action);
          recordTrace(typedAction, result);
          return result;
        }
        let rawResult: unknown;
        try {
          rawResult = await handler(typedAction);
        } catch (error) {
          const result = thrownFailure(typedAction.action, error);
          recordTrace(typedAction, result);
          return result;
        }
        const normalized = normalizeResult(rawResult);
        if (!normalized.ok) {
          const result: UiActionResult = {
            kind: "failure",
            code: "bridge-unavailable",
            message: `The "${typedAction.action}" handler returned a non-conforming UiActionResult — the bridge refuses to forward a malformed result.`,
            retryable: false,
          };
          recordTrace(typedAction, result);
          return result;
        }
        recordTrace(typedAction, normalized.result);
        return normalized.result;
      }
    }
  };

  return {
    dispatch,
    getVisibleMediaContext: (): VisibleMediaContext => {
      if (typeof handlers.getVisibleMediaContext !== "function") {
        // Fail loud at integration time — a fabricated context would violate
        // the freeze §9.1 truth law (the agent may only see host state).
        throw new Error(
          "UiActionHandlers.getVisibleMediaContext is not wired — the host must provide its own state snapshot",
        );
      }
      return handlers.getVisibleMediaContext();
    },
    trace: traceBuffer,
  };
}
