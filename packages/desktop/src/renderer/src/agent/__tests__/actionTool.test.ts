import { describe, expect, it, vi } from "vitest";
import {
  MediaRouteSchema,
  UiActionSchema,
} from "../../../../../../webflix-contracts/src/ui-actions.js";
import {
  dispatchWebflixUiToolInput,
  buildWebflixUiAgentWorkspaceArtifacts,
  buildWebflixUiMcpServerConfig,
  buildWebflixUiSkillMarkdown,
  WEBFLIX_UI_MEDIA_ROUTES,
  WEBFLIX_UI_MCP_ENTRY_REFERENCE_SOURCE,
  WEBFLIX_UI_SKILL_DIR_NAME,
  WEBFLIX_UI_TOOL_DESCRIPTION,
  WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA,
  WEBFLIX_UI_TOOL_NAME,
} from "../actionTool.js";
import {
  WEBFLIX_UI_RENDEZVOUS_DIR_NAME,
  WEBFLIX_UI_REQUEST_SCHEMA_VERSION,
} from "../uiActionRendezvous.js";
import { createUiActionBridge, type UiActionHandlers } from "../uiActionBridge.js";

/**
 * WFX-AGENT-BRIDGE-1 — the agent-side `webflix_ui` tool contract battery.
 *
 * Pins the round-trip between the hand-derived MCP input JSON Schema and the
 * FROZEN `UiActionSchema` (webflix-contracts v0.14.0): every frozen action
 * sample validates under both, every malformed sample is rejected by both,
 * the action literals and media-route enums match exactly, and the tool
 * execution path routes through the live bridge. Also pins the registration
 * artifacts (MCP config + workspace skill + the stdio entry source) and the
 * consent-law encoding.
 */

// ---------------------------------------------------------------------------
// A compact evaluator for the JSON-Schema subset WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA
// uses (type/const/enum/required/properties/additionalProperties/oneOf +
// string/integer/number bounds) — exactly the constructs an MCP runtime's
// inputSchema validator consumes.
// ---------------------------------------------------------------------------

type JsonSchemaNode = {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean;
  oneOf?: JsonSchemaNode[];
  minLength?: number;
  minimum?: number;
  maximum?: number;
};

function typeMatches(expected: string, value: unknown): boolean {
  switch (expected) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      throw new Error(`evaluator does not support type "${expected}"`);
  }
}

function evaluateSchema(node: JsonSchemaNode, value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (node.oneOf) {
    const branches = node.oneOf.map((branch) => evaluateSchema(branch, value, path));
    if (branches.filter((branch) => branch.length === 0).length !== 1) {
      errors.push(`${path}: expected exactly one oneOf branch to match`);
    }
    return errors;
  }
  if (node.type !== undefined) {
    const expectedTypes = Array.isArray(node.type) ? node.type : [node.type];
    if (!expectedTypes.some((expected) => typeMatches(expected, value))) {
      return [`${path}: expected type ${expectedTypes.join("|")}`];
    }
  }
  if (node.const !== undefined && value !== node.const) {
    errors.push(`${path}: expected const ${JSON.stringify(node.const)}`);
  }
  if (node.enum !== undefined && !node.enum.includes(value)) {
    errors.push(`${path}: expected one of ${node.enum.map((entry) => JSON.stringify(entry)).join(",")}`);
  }
  if (typeof value === "string" && node.minLength !== undefined && value.length < node.minLength) {
    errors.push(`${path}: shorter than minLength ${node.minLength}`);
  }
  if (typeof value === "number") {
    if (node.minimum !== undefined && value < node.minimum) {
      errors.push(`${path}: below minimum ${node.minimum}`);
    }
    if (node.maximum !== undefined && value > node.maximum) {
      errors.push(`${path}: above maximum ${node.maximum}`);
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const key of node.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    }
    if (node.properties) {
      for (const [key, propertySchema] of Object.entries(node.properties)) {
        if (key in value) {
          errors.push(...evaluateSchema(propertySchema, (value as Record<string, unknown>)[key], `${path}.${key}`));
        }
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in node.properties)) errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }
  }
  return errors;
}

function jsonSchemaAccepts(value: unknown): boolean {
  const errors = evaluateSchema(
    WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA as unknown as JsonSchemaNode,
    value,
    "$",
  );
  if (errors.length > 0) {
    throw new Error(`JSON schema rejected the sample: ${errors.join("; ")}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Round-trip samples
// ---------------------------------------------------------------------------

const validSamples: Array<{ label: string; value: unknown }> = [
  { label: "searchCatalog minimal", value: { action: "searchCatalog", query: "mrbeast" } },
  { label: "searchCatalog with limit", value: { action: "searchCatalog", query: "space", limit: 25 } },
  { label: "resolveChannel handle", value: { action: "resolveChannel", query: "@MrBeast" } },
  { label: "openRoute home", value: { action: "openRoute", route: "home" } },
  {
    label: "openRoute watch with params",
    value: { action: "openRoute", route: "watch", params: { itemId: "item-1" } },
  },
  {
    label: "openRoute channel with handle + tab",
    value: { action: "openRoute", route: "channel", params: { handle: "mrbeast", channelTab: "shorts" } },
  },
  { label: "openRoute trending with region", value: { action: "openRoute", route: "trending", params: { region: "US" } } },
  { label: "playCatalogItem minimal", value: { action: "playCatalogItem", itemId: "item-9" } },
  { label: "playCatalogItem with startAtSec", value: { action: "playCatalogItem", itemId: "item-9", startAtSec: 30 } },
  { label: "openAccountConnection", value: { action: "openAccountConnection", providerId: "youtube" } },
  { label: "toggleAgentPanel toggle", value: { action: "toggleAgentPanel" } },
  { label: "toggleAgentPanel force-visible", value: { action: "toggleAgentPanel", visible: false } },
  { label: "getVisibleMediaContext", value: { action: "getVisibleMediaContext" } },
  // Unknown keys are STRIPPED by the frozen zod objects (default strip
  // semantics) — so the JSON schema mirrors that (no additionalProperties:
  // false) and these samples validate under BOTH.
  {
    label: "unknown top-level key (stripped)",
    value: { action: "getVisibleMediaContext", traceTag: "call-7" },
  },
  {
    label: "unknown route param key (stripped)",
    value: { action: "openRoute", route: "watch", params: { item: "x" } },
  },
];

const invalidSamples: Array<{ label: string; value: unknown }> = [
  { label: "unknown action kind", value: { action: "subscribeToChannel", channelId: "ch-1" } },
  { label: "missing action", value: { query: "mrbeast" } },
  { label: "not an object", value: "searchCatalog" },
  { label: "searchCatalog empty query", value: { action: "searchCatalog", query: "" } },
  { label: "searchCatalog zero limit", value: { action: "searchCatalog", query: "x", limit: 0 } },
  { label: "searchCatalog limit over max", value: { action: "searchCatalog", query: "x", limit: 51 } },
  { label: "searchCatalog non-integer limit", value: { action: "searchCatalog", query: "x", limit: 2.5 } },
  { label: "openRoute unknown route", value: { action: "openRoute", route: "explore" } },
  { label: "openRoute missing route", value: { action: "openRoute" } },
  { label: "playCatalogItem empty itemId", value: { action: "playCatalogItem", itemId: "" } },
  { label: "playCatalogItem negative start", value: { action: "playCatalogItem", itemId: "i", startAtSec: -1 } },
  { label: "openAccountConnection empty provider", value: { action: "openAccountConnection", providerId: "" } },
  { label: "toggleAgentPanel non-boolean", value: { action: "toggleAgentPanel", visible: "yes" } },
];

describe("actionTool — the webflix_ui input schema round-trips the frozen UiActionSchema", () => {
  it("every frozen action literal appears exactly once in the JSON schema oneOf", () => {
    const schema = WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA as unknown as JsonSchemaNode;
    expect(schema.oneOf).toHaveLength(7);
    const jsonLiterals = (schema.oneOf ?? []).map(
      (branch) => branch.properties?.action?.const,
    );
    const zodLiterals = UiActionSchema.options.map(
      (option) => (option.shape.action as { _def: { values: string[] } })._def.values[0],
    );
    expect(new Set(jsonLiterals)).toEqual(new Set(zodLiterals));
  });

  it("the media-route enum matches MediaRouteSchema.options exactly", () => {
    expect([...WEBFLIX_UI_MEDIA_ROUTES]).toEqual(MediaRouteSchema.options);
    const schema = WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA as unknown as JsonSchemaNode;
    const openRouteBranch = (schema.oneOf ?? []).find(
      (branch) => branch.properties?.action?.const === "openRoute",
    );
    expect(openRouteBranch?.properties?.route?.enum).toEqual(MediaRouteSchema.options);
  });

  it("valid frozen action samples validate under BOTH schemas", () => {
    for (const sample of validSamples) {
      expect(() => UiActionSchema.parse(sample.value)).not.toThrow();
      expect(() => jsonSchemaAccepts(sample.value)).not.toThrow();
    }
  });

  it("malformed samples are rejected by BOTH schemas (never forwarded to the bridge)", () => {
    for (const sample of invalidSamples) {
      expect(() => UiActionSchema.parse(sample.value)).toThrow();
      expect(() => jsonSchemaAccepts(sample.value)).toThrow();
    }
  });

  it("required keys mirror the frozen schema per action kind", () => {
    const schema = WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA as unknown as JsonSchemaNode;
    const requiredByAction = new Map(
      (schema.oneOf ?? []).map((branch) => [
        branch.properties?.action?.const as string,
        branch.required ?? [],
      ]),
    );
    expect(requiredByAction.get("searchCatalog")).toEqual(["action", "query"]);
    expect(requiredByAction.get("resolveChannel")).toEqual(["action", "query"]);
    expect(requiredByAction.get("openRoute")).toEqual(["action", "route"]);
    expect(requiredByAction.get("playCatalogItem")).toEqual(["action", "itemId"]);
    expect(requiredByAction.get("openAccountConnection")).toEqual(["action", "providerId"]);
    expect(requiredByAction.get("toggleAgentPanel")).toEqual(["action"]);
    expect(requiredByAction.get("getVisibleMediaContext")).toEqual(["action"]);
  });
});

describe("actionTool — dispatchWebflixUiToolInput routes through the live bridge", () => {
  function createBridgeWithSpy(): {
    bridge: ReturnType<typeof createUiActionBridge>;
    handler: ReturnType<typeof vi.fn>;
  } {
    const handler = vi.fn(async () => ({ kind: "ok", summary: "done" }));
    const handlers = {
      searchCatalog: handler,
      resolveChannel: handler,
      openRoute: handler,
      playCatalogItem: handler,
      openAccountConnection: handler,
      toggleAgentPanel: handler,
      getVisibleMediaContext: () => ({
        at: "2026-10-23T12:00:00.000Z",
        route: "home" as const,
        params: {},
        playingItem: null,
        watchPlanKind: null,
        visibleItemIds: [],
        connections: [],
        agentPanel: { visible: false, widthPx: null },
        pendingChoice: null,
      }),
    } as unknown as UiActionHandlers;
    return { bridge: createUiActionBridge(handlers), handler };
  }

  it("a valid LLM tool input dispatches through the bridge (typed ok result)", async () => {
    const { bridge, handler } = createBridgeWithSpy();
    const result = await dispatchWebflixUiToolInput(
      { action: "playCatalogItem", itemId: "item-1" },
      bridge,
    );
    expect(result).toMatchObject({ kind: "ok", summary: "done" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ action: "playCatalogItem", itemId: "item-1" });
    expect(bridge.trace.export()).toHaveLength(1);
  });

  it("invalid tool input answers a typed failure and never reaches a handler", async () => {
    const { bridge, handler } = createBridgeWithSpy();
    const unknown = await dispatchWebflixUiToolInput({ action: "likeVideo", itemId: "x" }, bridge);
    expect(unknown).toMatchObject({ kind: "failure", code: "unknown-action" });
    const invalid = await dispatchWebflixUiToolInput({ action: "playCatalogItem" }, bridge);
    expect(invalid).toMatchObject({ kind: "failure", code: "invalid-action" });
    expect(handler).not.toHaveBeenCalled();
    expect(bridge.trace.export()).toHaveLength(0);
  });
});

describe("actionTool — the consent law is encoded in the LLM-facing text", () => {
  it("the tool description carries the consent law verbatim", () => {
    expect(WEBFLIX_UI_TOOL_NAME).toBe("webflix_ui");
    const description = WEBFLIX_UI_TOOL_DESCRIPTION;
    expect(description).toContain("needs-user-choice");
    expect(description).toContain("Never choose for the user");
    expect(description).toMatch(/NEVER claim, promise or attempt account mutations/);
    expect(description).toContain("like, subscribe, comment, playlist writes");
    expect(description).toContain("never fabricate");
    expect(description).toContain("getVisibleMediaContext");
  });

  it("the skill markdown carries the consent law and the journey discipline", () => {
    const markdown = buildWebflixUiSkillMarkdown();
    expect(markdown).toContain("name: webflix-ui");
    expect(markdown).toContain("consent law");
    expect(markdown).toContain("needs-user-choice");
    expect(markdown).toContain("VERBATIM");
    expect(markdown).toContain("NEVER claim or attempt account mutations");
    expect(markdown).toContain("resolveChannel");
    expect(markdown).toContain("playCatalogItem");
  });
});

describe("actionTool — the registration artifacts (the TL2 wiring contract)", () => {
  const params = {
    command: "/opt/webflix/resources/webflix-ui-mcp.mjs",
    args: [] as string[],
    workspacePath: "/home/user/.webflix/agent-workspace",
    dataRoot: "/home/user/.webflix",
  };

  it("builds the stdio server record shared by both registration files (env-pinned rendezvous paths)", () => {
    const config = buildWebflixUiMcpServerConfig(params);
    expect(config.type).toBe("stdio");
    expect(config.command).toBe(params.command);
    expect(config.args).toEqual([]);
    expect(config.env).toEqual({
      WEBFLIX_UI_RENDEZVOUS_DIR: params.workspacePath,
      WEBFLIX_UI_RESPONSE_ROOT: params.dataRoot,
    });
    // The strict runtime-side cpStdioServerSchema shape (zcode-cli
    // adapters/src/config/schema.ts): exactly type/command/args[/cwd/env].
    expect(Object.keys(config).sort()).toEqual(["args", "command", "env", "type"]);
  });

  it("builds the full agent-workspace artifact set at the frozen paths", () => {
    const artifacts = buildWebflixUiAgentWorkspaceArtifacts(params);
    // The RUNTIME-native registration: <workspace>/.zcode/config.json mcp.servers.
    expect(artifacts.zcodeConfigJsonPath).toBe(
      "/home/user/.webflix/agent-workspace/.zcode/config.json",
    );
    expect(artifacts.zcodeConfigJson).toEqual({
      mcp: { servers: { [WEBFLIX_UI_TOOL_NAME]: buildWebflixUiMcpServerConfig(params) } },
    });
    // The desktop settings-surface mirror: <workspace>/.agents/mcp.json mcpServers.
    expect(artifacts.agentsMcpJsonPath).toBe(
      "/home/user/.webflix/agent-workspace/.agents/mcp.json",
    );
    expect(artifacts.agentsMcpJson.mcpServers[WEBFLIX_UI_TOOL_NAME]).toEqual(
      buildWebflixUiMcpServerConfig(params),
    );
    expect(artifacts.skillMarkdownPath).toBe(
      `/home/user/.webflix/agent-workspace/.zcode/skills/${WEBFLIX_UI_SKILL_DIR_NAME}/SKILL.md`,
    );
    expect(artifacts.skillMarkdown).toBe(buildWebflixUiSkillMarkdown());
  });

  it("every registration artifact lands under the agent workspace in the WEBFLIX data root, never the user-level ~/.zcode", () => {
    const artifacts = buildWebflixUiAgentWorkspaceArtifacts(params);
    for (const path of [
      artifacts.zcodeConfigJsonPath,
      artifacts.agentsMcpJsonPath,
      artifacts.skillMarkdownPath,
    ]) {
      // `.zcode/` here is the WORKSPACE-scoped config dir inside the agent
      // workspace (freeze §9.7: the workspace lives under the WebFlix data
      // root) — distinct from the user-level ~/.zcode, which nothing here
      // touches: no artifact path may escape the agent workspace prefix.
      expect(path.startsWith(params.workspacePath)).toBe(true);
      expect(path.startsWith(`${params.dataRoot}/agent-workspace`)).toBe(true);
    }
  });

  it("the bundled stdio entry source speaks MCP stdio JSON-RPC over the rendezvous", () => {
    const source = WEBFLIX_UI_MCP_ENTRY_REFERENCE_SOURCE;
    // The tool identity + frozen contract payloads are baked in.
    expect(source).toContain(`const TOOL_NAME = ${JSON.stringify(WEBFLIX_UI_TOOL_NAME)}`);
    expect(source).toContain(`const INPUT_SCHEMA = ${JSON.stringify(WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA)}`);
    // The rendezvous paths + schema version stay in lockstep with the responder.
    expect(source).toContain(`const REQUESTS_DIR = join(RENDEZVOUS_DIR, ${JSON.stringify(WEBFLIX_UI_RENDEZVOUS_DIR_NAME)}, "requests")`);
    expect(source).toContain(`const SCHEMA_VERSION = ${JSON.stringify(WEBFLIX_UI_REQUEST_SCHEMA_VERSION)}`);
    // The date-dir scan window covers local-vs-UTC skew ([-1, 0, +1]).
    expect(source).toContain("[-1, 0, 1].map((offset)");
    // The stdio JSON-RPC surface an MCP client expects.
    expect(source).toContain('message.method === "initialize"');
    expect(source).toContain('message.method === "tools/list"');
    expect(source).toContain('message.method === "tools/call"');
    // The honest timeout answer.
    expect(source).toContain("did not answer within 30s");
    expect(source).toContain("open the Agent panel");
  });
});
