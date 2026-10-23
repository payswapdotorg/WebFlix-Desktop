import { describe, expect, it } from "vitest";
import {
  UiActionSchema,
  type UiAction,
  type VisibleMediaContext,
} from "../../../../../../webflix-contracts/src/ui-actions.js";
import {
  UI_ACTION_KINDS,
  createUiActionBridge,
  type UiActionHandlers,
} from "../uiActionBridge.js";

/**
 * WFX-AGENT-BRIDGE-1 — the dispatch table battery over the FROZEN
 * UiActionDispatcher contract (webflix-contracts v0.14.0, freeze §9.1):
 * every frozen action routes to exactly one handler call, every result is
 * schema-normalized, every executed action is traced, malformed input and
 * hostile handler behavior degrade to typed results — and NO dispatch ever
 * throws.
 */

function makeContext(overrides: Partial<VisibleMediaContext> = {}): VisibleMediaContext {
  return {
    at: "2026-10-23T12:00:00.000Z",
    route: "home",
    params: {},
    playingItem: null,
    watchPlanKind: null,
    visibleItemIds: ["item-1", "item-2"],
    connections: [{ providerId: "youtube", state: "not-configured" }],
    agentPanel: { visible: true, widthPx: null },
    pendingChoice: null,
    ...overrides,
  };
}

function sampleAction(kind: UiAction["action"]): UiAction {
  switch (kind) {
    case "searchCatalog":
      return { action: "searchCatalog", query: "MrBeast latest" };
    case "resolveChannel":
      return { action: "resolveChannel", query: "@MrBeast" };
    case "openRoute":
      return { action: "openRoute", route: "watch", params: { itemId: "item-1" } };
    case "playCatalogItem":
      return { action: "playCatalogItem", itemId: "item-9" };
    case "openAccountConnection":
      return { action: "openAccountConnection", providerId: "youtube" };
    case "toggleAgentPanel":
      return { action: "toggleAgentPanel", visible: true };
    case "getVisibleMediaContext":
      return { action: "getVisibleMediaContext" };
  }
}

function createHandlers(
  overrides: Record<string, unknown> = {},
): { handlers: UiActionHandlers; calls: Map<string, unknown[]> } {
  const calls = new Map<string, unknown[]>();
  const ok = (summary: string) => ({ kind: "ok" as const, summary });
  const record = (name: string) => (action: never) => {
    const list = calls.get(name) ?? [];
    list.push(action);
    calls.set(name, list);
    return Promise.resolve(ok(`${name} handled`));
  };
  const handlers = {
    searchCatalog: record("searchCatalog"),
    resolveChannel: record("resolveChannel"),
    openRoute: record("openRoute"),
    playCatalogItem: record("playCatalogItem"),
    openAccountConnection: record("openAccountConnection"),
    toggleAgentPanel: record("toggleAgentPanel"),
    getVisibleMediaContext: () => makeContext(),
    ...overrides,
  } as unknown as UiActionHandlers;
  return { handlers, calls };
}

describe("uiActionBridge — the frozen dispatch table", () => {
  it("routes every frozen action to exactly one handler call with the typed action", async () => {
    const { handlers, calls } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    for (const kind of UI_ACTION_KINDS) {
      const result = await bridge.dispatch(sampleAction(kind));
      expect(result.kind).toBe("ok");
    }
    for (const kind of UI_ACTION_KINDS) {
      if (kind === "getVisibleMediaContext") {
        expect(calls.has(kind)).toBe(false); // routed to the context provider, not a handler
      } else {
        expect(calls.get(kind)).toHaveLength(1);
        expect(calls.get(kind)?.[0]).toEqual(sampleAction(kind));
      }
    }
    expect(calls.size).toBe(UI_ACTION_KINDS.length - 1);
  });

  it("the closed routing table matches the frozen UiActionSchema kinds exactly", () => {
    // Discriminator options of the frozen union == the bridge's routing table.
    const schemaKinds = new Set(
      UiActionSchema.options.map(
        (option) => option.shape.action._def.values[0] as string,
      ),
    );
    expect(new Set<string>(UI_ACTION_KINDS)).toEqual(schemaKinds);
  });

  it("normalizes handler results through the frozen UiActionResultSchema (defaults applied)", async () => {
    const { handlers } = createHandlers({
      searchCatalog: async () => ({
        kind: "ok",
        summary: "Searched the catalog",
        items: [
          {
            itemId: "i1",
            title: "Video",
            providerId: "youtube",
            mediaKind: "video",
          },
        ],
      }),
    });
    const bridge = createUiActionBridge(handlers);
    const result = (await bridge.dispatch({ action: "searchCatalog", query: "q" })) as {
      kind: string;
      items: unknown[];
      channels: unknown[];
      evidence: unknown[];
    };
    expect(result.kind).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.channels).toEqual([]);
    expect(result.evidence).toEqual([]);
  });

  it("forwards needs-user-choice results verbatim (the agent ASKS, never picks)", async () => {
    const { handlers } = createHandlers({
      resolveChannel: async () => ({
        kind: "needs-user-choice",
        prompt: "Which channel?",
        choices: [
          { id: "ch-1", label: "MrBeast", description: "76M subs" },
          { id: "ch-2", label: "MrBeast Gaming" },
        ],
      }),
    });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "resolveChannel", query: "mrbeast" });
    expect(result).toEqual({
      kind: "needs-user-choice",
      prompt: "Which channel?",
      choices: [
        { id: "ch-1", label: "MrBeast", description: "76M subs" },
        { id: "ch-2", label: "MrBeast Gaming" },
      ],
    });
    expect(bridge.trace.getEntries()).toHaveLength(1);
    expect(bridge.trace.getEntries()[0]?.outcomeKind).toBe("needs-user-choice");
  });

  it("a thrown handler error becomes a typed retryable bridge-unavailable failure", async () => {
    const { handlers } = createHandlers({
      playCatalogItem: () => {
        throw new Error("playback planning exploded");
      },
    });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "playCatalogItem", itemId: "i1" });
    expect(result).toEqual({
      kind: "failure",
      code: "bridge-unavailable",
      message: expect.stringContaining("playback planning exploded"),
      retryable: true,
    });
    expect(bridge.trace.getEntries()).toHaveLength(1);
    expect(bridge.trace.getEntries()[0]?.summary).toContain("bridge-unavailable");
  });

  it("a non-conforming handler result is refused with a typed failure (never forwarded)", async () => {
    const { handlers } = createHandlers({
      openRoute: async () => ({ kind: "ok" }), // missing required summary
    });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "openRoute", route: "home" });
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.code).toBe("bridge-unavailable");
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("non-conforming");
    }
    expect(bridge.trace.getEntries()).toHaveLength(1);
  });

  it("an unwired handler answers the frozen capability vocabulary (unsupported, not a no-op)", async () => {
    const { handlers } = createHandlers({ searchCatalog: undefined });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "searchCatalog", query: "q" });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.capability).toBe("unavailable");
      expect(result.reason).toContain("searchCatalog");
    }
    expect(bridge.trace.getEntries()).toHaveLength(1);
    expect(bridge.trace.getEntries()[0]?.outcomeKind).toBe("unsupported");
  });

  it("malformed input answers typed failures and is NOT traced (evidence stays truthful)", async () => {
    const { handlers, calls } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    const unknown = await bridge.dispatch({ action: "subscribeToChannel" } as unknown as UiAction);
    expect(unknown.kind).toBe("failure");
    if (unknown.kind === "failure") {
      expect(unknown.code).toBe("unknown-action");
      expect(unknown.retryable).toBe(false);
    }
    const invalid = await bridge.dispatch({ action: "searchCatalog", query: "  " } as UiAction);
    expect(invalid.kind).toBe("failure");
    if (invalid.kind === "failure") {
      expect(invalid.code).toBe("invalid-action");
    }
    expect(bridge.trace.getEntries()).toHaveLength(0);
    expect(calls.size).toBe(0);
  });

  it("getVisibleMediaContext answers from host state with evidence + the context, traced", async () => {
    const { handlers } = createHandlers({
      getVisibleMediaContext: () => makeContext({ route: "watch" }),
    });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "getVisibleMediaContext" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary).toContain("watch");
      expect(result.context?.route).toBe("watch");
      expect(result.evidence).toEqual(
        expect.arrayContaining(["route=watch", "visibleItemIds(2)=item-1,item-2", "agentPanel.visible=true"]),
      );
    }
    expect(bridge.trace.getEntries()).toHaveLength(1);
    expect(bridge.trace.getEntries()[0]?.action.action).toBe("getVisibleMediaContext");
  });

  it("a non-conforming context snapshot answers a typed failure (never a fabricated context)", async () => {
    const { handlers } = createHandlers({
      getVisibleMediaContext: () => ({ route: "home" }),
    });
    const bridge = createUiActionBridge(handlers);
    const result = await bridge.dispatch({ action: "getVisibleMediaContext" });
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.code).toBe("bridge-unavailable");
      expect(result.message).toContain("non-conforming");
    }
  });

  it("the dispatcher method getVisibleMediaContext() answers the host provider value", () => {
    const context = makeContext({ route: "library" });
    const { handlers } = createHandlers({ getVisibleMediaContext: () => context });
    const bridge = createUiActionBridge(handlers);
    expect(bridge.getVisibleMediaContext()).toEqual(context);
  });

  it("the dispatcher method getVisibleMediaContext() fails loud when unwired", () => {
    const { handlers } = createHandlers({ getVisibleMediaContext: undefined });
    const bridge = createUiActionBridge(handlers);
    expect(() => bridge.getVisibleMediaContext()).toThrow(/not wired/i);
  });

  it("the trace buffer exports detached copies and clears", async () => {
    const { handlers } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    await bridge.dispatch({ action: "openRoute", route: "home" });
    await bridge.dispatch({ action: "openRoute", route: "search", params: { query: "x" } });
    const exported = bridge.trace.export();
    expect(exported).toHaveLength(2);
    exported.length = 0;
    expect(bridge.trace.getEntries()).toHaveLength(2);
    bridge.trace.clear();
    expect(bridge.trace.getEntries()).toHaveLength(0);
    expect(bridge.trace.export()).toHaveLength(0);
  });

  it("every trace entry validates against the frozen AgentActionTraceEntrySchema", async () => {
    const { handlers } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    for (const kind of UI_ACTION_KINDS) {
      await bridge.dispatch(sampleAction(kind));
    }
    expect(bridge.trace.getEntries()).toHaveLength(UI_ACTION_KINDS.length);
    for (const entry of bridge.trace.export()) {
      expect(typeof entry.at).toBe("string");
      expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(["ok", "failure", "needs-user-choice", "unsupported"]).toContain(entry.outcomeKind);
      expect(typeof entry.summary).toBe("string");
      expect(entry.summary.length).toBeGreaterThan(0);
      // The action re-validates against the FROZEN schema (evidence integrity).
      expect(() => UiActionSchema.parse(entry.action)).not.toThrow();
    }
  });

  it("the trace buffer is bounded (the exportable evidence never grows without limit)", async () => {
    const { handlers } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    const rounds = 520;
    for (let index = 0; index < rounds; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- sequential dispatch is the point
      await bridge.dispatch({ action: "getVisibleMediaContext" });
    }
    expect(bridge.trace.getEntries().length).toBeLessThanOrEqual(500);
    expect(bridge.trace.getEntries().length).toBe(500);
    // The oldest entries were evicted; the buffer still holds recent ones.
    const entries = bridge.trace.getEntries();
    expect(entries[entries.length - 1]?.action.action).toBe("getVisibleMediaContext");
  });

  it("no dispatch path ever throws (typed results only, even for hostile callers)", async () => {
    const { handlers } = createHandlers();
    const bridge = createUiActionBridge(handlers);
    await expect(
      bridge.dispatch(null as unknown as UiAction),
    ).resolves.toMatchObject({ kind: "failure", code: "unknown-action" });
    await expect(
      bridge.dispatch(42 as unknown as UiAction),
    ).resolves.toMatchObject({ kind: "failure", code: "unknown-action" });
    await expect(
      bridge.dispatch({ action: "playCatalogItem" } as unknown as UiAction),
    ).resolves.toMatchObject({ kind: "failure", code: "invalid-action" });
  });
});
