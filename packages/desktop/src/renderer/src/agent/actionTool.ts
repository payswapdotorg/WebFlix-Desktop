/*
 * WFX-AGENT-BRIDGE-1 — the agent-side `webflix_ui` ACTION TOOL (freeze §9.1).
 *
 * This module is the LLM-facing contract of the typed UI-action bridge:
 * a tool whose input schema round-trips the FROZEN `UiActionSchema`
 * (webflix-contracts v0.14.0) and whose output is the typed
 * `UiActionResult` JSON. The tool's EXECUTION path in the renderer is real:
 * `dispatchWebflixUiToolInput()` validates against the frozen schema and
 * routes through the live `UiActionBridge` (the same use cases the visible
 * WebFlix buttons use — never a DOM scrape, never a fabricated CatalogItem).
 *
 * REGISTRATION MECHANISM (investigated across apps/zcode-cli +
 * packages/services — every line re-verified against source):
 *
 *   1. RUNTIME-NATIVE: the agent runtime (apps/zcode-cli app-server) itself
 *      merges project-scoped MCP from `<workspace>/.zcode/config.json`
 *      (`mcp.servers` key) — `adapters/src/config/project-config.adapter.ts` →
 *      `loadProjectConfigs` discovers exactly `zcode.json` +
 *      `.zcode/config.json`, and `bootstrap/src/app/runtime-config.ts` merges
 *      `configResult.config.mcp.servers` with the pinned policy “workspace
 *      MCP 开箱即用：project 作用域 MCP 默认 trusted，并自动连接”. A stdio
 *      record `{type:"stdio", command, args, env}` passes the CLI's strict
 *      `cpStdioServerSchema` (schema.ts:75). The agent session in the agent
 *      workspace therefore auto-connects the tool with ZERO desktop-UI
 *      involvement.
 *   2. DESKTOP SETTINGS MIRROR: `<workspace>/.agents/mcp.json`
 *      (`mcpServers` key) is the host-side mcp-sync read
 *      (`packages/services/src/mcp-sync/mcpSyncService.ts`
 *      AGENTS_MCP_DESCRIPTOR — read for the settings surface + import;
 *      `readDirectoryServersFromPreferredSources` prefers the zcode file,
 *      so the two never double-register).
 *   3. WORKSPACE SKILL: `<workspace>/.zcode/skills/<name>/SKILL.md`
 *      (`adapters/src/skills/roots.ts` — project-scope `.zcode/skills` +
 *      `.agents/skills` roots) teaches the consent law.
 *
 * Chosen path: ALL of the above as pure data builders
 * (`buildWebflixUiAgentWorkspaceArtifacts`) + the stdio entry reference
 * source (TL2 bundles the entry; the renderer-side rendezvous responder is
 * already implemented in uiActionRendezvous.ts).
 *
 * THE CONSENT LAW, encoded in the tool description (freeze §9.1 / parent
 * order §3.9): read/navigation/play ONLY. Ask via needs-user-choice on
 * ambiguity. NEVER claim account actions (like/subscribe/comment/playlist
 * writes) — those require the user's express intent through their own
 * consented surfaces and are absent from the frozen action set.
 */
import type { McpServerConfig } from "@zcode/shared";
import { parseUiActionInput, type UiActionBridge } from "./uiActionBridge.js";
import {
  WEBFLIX_UI_RENDEZVOUS_DIR_NAME,
  WEBFLIX_UI_REQUESTS_DIR_NAME,
  WEBFLIX_UI_REQUEST_SCHEMA_VERSION,
  WEBFLIX_UI_RESPONSE_FILENAME_PREFIX,
} from "./uiActionRendezvous.js";
import type { UiActionResult } from "../../../../../webflix-contracts/src/ui-actions.js";

export const WEBFLIX_UI_TOOL_NAME = "webflix_ui";

/**
 * The frozen media routes — duplicated for the JSON Schema and pinned
 * against `MediaRouteSchema.options` by the round-trip test.
 */
export const WEBFLIX_UI_MEDIA_ROUTES = [
  "home",
  "search",
  "watch",
  "channel",
  "shorts",
  "trending",
  "subscriptions",
  "library",
  "history",
  "settings",
  "accounts",
  "ads",
  "evaluation",
  // WFX-NETFLIX-SOURCE-1: the second source's hub (navigation only — its
  // titles are NOT playable catalog items, so no playCatalogItem rides this).
  "netflix",
] as const;

/** The consent law, verbatim in the tool description the LLM reads. */
export const WEBFLIX_UI_TOOL_DESCRIPTION = `Operate the visible WebFlix media interface through TYPED, consent-lawful actions.

CONSENT LAW (binding):
- Allowed: searching the catalog, resolving channels, opening routes, playing catalog items by itemId, opening the account-connection surface, toggling this agent panel, reading the visible media context.
- Reference media ONLY by itemId/channelId you obtained from this tool's results or the visible context — never fabricate items or ids; a hallucinated id fails typed.
- When the request is ambiguous (multiple candidate channels/videos, unclear target), the tool returns needs-user-choice: relay the prompt and labeled choices to the user verbatim and let THEM pick. Never choose for the user.
- NEVER claim, promise or attempt account mutations (like, subscribe, comment, playlist writes, uploads, downloads). Those are deliberately absent from this tool; the user performs them through their own consented surfaces. openAccountConnection only OPENS the connection settings surface.
- Prefer getVisibleMediaContext first when you need to know the current route, playing item, visible items or connection states — the answer comes from the app's own state, never from guessing.

Result kinds: ok (summary + items/channels + evidence + post-action context), failure (typed code, retryable), needs-user-choice (prompt + choices), unsupported (capability + reason).`;

/**
 * The tool's input JSON Schema (MCP-compatible), hand-derived from the
 * FROZEN UiActionSchema. The round-trip test pins it against the zod schema:
 * every frozen action sample validates under both; the action literals and
 * media-route enums match exactly; malformed samples are rejected by both.
 * Unknown keys are ALLOWED here because the frozen zod objects STRIP them
 * (zod default) — keeping `additionalProperties: false` would make the MCP
 * boundary stricter than the contract it mirrors and break the round-trip.
 */
export const WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "WebFlixUiToolInput",
  description:
    "One frozen WebFlix UI action. Discriminated by `action`; payload fields per action kind.",
  oneOf: [
    {
      type: "object",
      properties: {
        action: { const: "searchCatalog" },
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["action", "query"],
    },
    {
      type: "object",
      properties: {
        action: { const: "resolveChannel" },
        query: { type: "string", minLength: 1 },
      },
      required: ["action", "query"],
    },
    {
      type: "object",
      properties: {
        action: { const: "openRoute" },
        route: { enum: [...WEBFLIX_UI_MEDIA_ROUTES] },
        params: {
          type: "object",
          properties: {
            query: { type: "string" },
            itemId: { type: "string" },
            channelId: { type: "string" },
            handle: { type: "string" },
            channelTab: { type: "string" },
            category: { type: "string" },
            region: { type: "string" },
          },
        },
      },
      required: ["action", "route"],
    },
    {
      type: "object",
      properties: {
        action: { const: "playCatalogItem" },
        itemId: { type: "string", minLength: 1 },
        startAtSec: { type: "number", minimum: 0 },
      },
      required: ["action", "itemId"],
    },
    {
      type: "object",
      properties: {
        action: { const: "openAccountConnection" },
        providerId: { type: "string", minLength: 1 },
      },
      required: ["action", "providerId"],
    },
    {
      type: "object",
      properties: {
        action: { const: "toggleAgentPanel" },
        visible: { type: "boolean" },
      },
      required: ["action"],
    },
    {
      type: "object",
      properties: {
        action: { const: "getVisibleMediaContext" },
      },
      required: ["action"],
    },
  ],
} as const;

/**
 * The renderer-side tool execution: validate the unknown LLM input against
 * the FROZEN UiActionSchema, then dispatch through the live bridge. Invalid
 * input answers a typed failure (unknown-action / invalid-action) — the tool
 * never forwards a malformed payload and never invents an action.
 */
export function dispatchWebflixUiToolInput(
  input: unknown,
  bridge: UiActionBridge,
): Promise<UiActionResult> {
  const parsed = parseUiActionInput(input);
  if (!parsed.ok) return Promise.resolve(parsed.result);
  return bridge.dispatch(parsed.action);
}

// ---------------------------------------------------------------------------
// Registration surface — the agent workspace artifacts (pure data builders)
// ---------------------------------------------------------------------------

export interface WebflixUiMcpServerConfigParams {
  /** Absolute path of the bundled stdio MCP entry (TL2's packaging supplies it). */
  command: string;
  args?: string[];
  /** The agent workspace directory (freeze §9.7). */
  workspacePath: string;
  /** The WebFlix data root (response discovery: `<root>/tmp/paste-attachments`). */
  dataRoot: string;
  /**
   * TL2 integration (additive): extra env merged into the server record —
   * the packaged build runs the entry through the app binary itself with
   * ELECTRON_RUN_AS_NODE=1 (plain-Node behavior) instead of a system node.
   */
  extraEnv?: Record<string, string>;
}

/**
 * The MCP server config record shared by BOTH registration files — the
 * runtime-native `<workspace>/.zcode/config.json` (`mcp.servers` shape:
 * `{type:"stdio", command, args, env}` passes the CLI's strict
 * cpStdioServerSchema) and the desktop-settings mirror
 * `<workspace>/.agents/mcp.json` (`mcpServers` key, McpServerConfig).
 * The env pins the rendezvous paths explicitly (no cwd assumptions).
 */
export function buildWebflixUiMcpServerConfig(
  params: WebflixUiMcpServerConfigParams,
): McpServerConfig {
  return {
    type: "stdio",
    command: params.command,
    args: params.args ?? [],
    env: {
      WEBFLIX_UI_RENDEZVOUS_DIR: params.workspacePath,
      WEBFLIX_UI_RESPONSE_ROOT: params.dataRoot,
      ...(params.extraEnv ?? {}),
    },
  };
}

/** The workspace skill directory name (`<workspace>/.zcode/skills/<name>/SKILL.md`). */
export const WEBFLIX_UI_SKILL_DIR_NAME = "webflix-ui";
/**
 * The SKILL.md content for the agent workspace — teaches the consent law and
 * the tool discipline. Pure markdown (frontmatter + body); pinned by tests.
 */
export function buildWebflixUiSkillMarkdown(): string {
  return `---
name: webflix-ui
description: Operate the visible WebFlix media interface through the webflix_ui tool — typed, consent-lawful actions only (search/resolve/navigate/play/read-context). Ask the user on ambiguity; never claim account mutations.
---

# WebFlix interface operation

Use the \`webflix_ui\` tool to operate the visible WebFlix interface on the user's behalf.

## When to use it

- The user asks to find, search, open or play media ("find and play the latest video from X").
- You need to know what is currently visible (route, playing item, visible items, connection states) — call \`getVisibleMediaContext\` FIRST instead of guessing.

## The consent law (binding)

1. Reference media ONLY by \`itemId\`/\`channelId\` obtained from tool results or the visible context. Never fabricate items or ids — a hallucinated id fails typed (\`item-not-found\`), it never plays something invented.
2. On ambiguity the tool returns \`needs-user-choice\`: relay the prompt and the labeled choices to the user VERBATIM, then act on their answer. Never pick for the user.
3. NEVER claim or attempt account mutations (like, subscribe, comment, playlist writes, uploads, downloads). They are absent from the tool by design. \`openAccountConnection\` only opens the connection settings surface for the user to act themselves.
4. Playback uses the approved player path via the same use case the UI buttons use — the visible interface reflects the action.

## Typical journey (MrBeast example)

1. \`resolveChannel\` with the user's channel reference → channel summary + newest uploads.
2. If multiple candidates: forward the \`needs-user-choice\` prompt to the user.
3. \`playCatalogItem\` with the chosen upload's \`itemId\`.
4. \`getVisibleMediaContext\` to verify the Watch surface now shows the selected item (the ok result carries the post-action context as evidence).

Report exactly what the typed results say — never summarize a failure as success.
`;
}

/**
 * The reference source of the bundled stdio MCP entry (`webflix-ui-mcp.mjs`)
 * TL2 packages next to the app. Plain Node, zero dependencies: speaks the
 * MCP stdio JSON-RPC framing (initialize / tools/list / tools/call), writes
 * request files into the rendezvous directory, and discovers the typed
 * response through the deterministic temp-attachment date directory
 * (today ± 1 — the main process dates that directory in LOCAL time while
 * the entry computes UTC, so the window covers every skew). This is DATA —
 * the renderer never executes it.
 */
export const WEBFLIX_UI_MCP_ENTRY_REFERENCE_SOURCE = `#!/usr/bin/env node
// webflix-ui-mcp.mjs — the bundled stdio MCP entry for the webflix_ui tool.
// Transport: file rendezvous with the WebFlix renderer (see WFX-AGENT-BRIDGE-1).
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TOOL_NAME = ${JSON.stringify(WEBFLIX_UI_TOOL_NAME)};
const TOOL_DESCRIPTION = ${JSON.stringify(WEBFLIX_UI_TOOL_DESCRIPTION)};
const INPUT_SCHEMA = ${JSON.stringify(WEBFLIX_UI_TOOL_INPUT_JSON_SCHEMA)};
const RENDEZVOUS_DIR = process.env.WEBFLIX_UI_RENDEZVOUS_DIR ?? ".";
const RESPONSE_ROOT = process.env.WEBFLIX_UI_RESPONSE_ROOT ?? "";
const REQUESTS_DIR = join(RENDEZVOUS_DIR, ${JSON.stringify(WEBFLIX_UI_RENDEZVOUS_DIR_NAME)}, ${JSON.stringify(WEBFLIX_UI_REQUESTS_DIR_NAME)});
const RESPONSE_PREFIX = ${JSON.stringify(WEBFLIX_UI_RESPONSE_FILENAME_PREFIX)};
const SCHEMA_VERSION = ${JSON.stringify(WEBFLIX_UI_REQUEST_SCHEMA_VERSION)};
const RESPONSE_TIMEOUT_MS = 30_000;
const RESPONSE_POLL_MS = 400;

function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
function dateDirName(offsetDays = 0) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - offsetDays);
  return \`\${d.getUTCFullYear()}-\${String(d.getUTCMonth() + 1).padStart(2, "0")}-\${String(d.getUTCDate()).padStart(2, "0")}\`;
}
function responseDirs() {
  // The renderer-side writer (tempTextAttachment.ts) dates the directory in
  // the MAIN process's LOCAL timezone, while this entry computes UTC dates.
  // Scanning [-1, 0, +1] covers every local-vs-UTC skew (up to ±14h) so the
  // typed response is never missed at a midnight boundary.
  if (!RESPONSE_ROOT) return [];
  const base = join(RESPONSE_ROOT, "tmp", "paste-attachments");
  return [-1, 0, 1].map((offset) => join(base, dateDirName(offset)));
}
async function findResponse(requestId) {
  for (const dir of responseDirs()) {
    let names; try { names = await readdir(dir); } catch { continue; }
    const match = names.find((name) => name.startsWith(RESPONSE_PREFIX + requestId) && name.endsWith(".txt"));
    if (match) {
      const raw = await readFile(join(dir, match), "utf8");
      return JSON.parse(raw);
    }
  }
  return null;
}
async function callTool(input) {
  const requestId = randomUUID();
  await mkdir(REQUESTS_DIR, { recursive: true });
  const requestFile = join(REQUESTS_DIR, requestId + ".json");
  await writeFile(requestFile, JSON.stringify({ schemaVersion: SCHEMA_VERSION, requestId, action: input }), { flag: "wx" });
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await findResponse(requestId);
    if (response && response.requestId === requestId) {
      void rm(requestFile, { force: true }).catch(() => {});
      return { content: [{ type: "text", text: JSON.stringify(response.result) }], isError: response.result.kind === "failure" };
    }
    await new Promise((resolve) => setTimeout(resolve, RESPONSE_POLL_MS));
  }
  void rm(requestFile, { force: true }).catch(() => {});
  const failure = { kind: "failure", code: "bridge-unavailable", message: "The WebFlix renderer did not answer within 30s — open the Agent panel (the bridge responder runs with it) and retry.", retryable: true };
  return { content: [{ type: "text", text: JSON.stringify(failure) }], isError: true };
}

let nextId = 0;
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message; try { message = JSON.parse(line); } catch { continue; }
    void handleMessage(message);
  }
});
async function handleMessage(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "webflix-ui", version: "1.0.0" } } });
    return;
  }
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA }] } });
    return;
  }
  if (message.method === "tools/call") {
    const input = message.params?.arguments ?? {};
    send({ jsonrpc: "2.0", id: message.id, result: await callTool(input) });
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found: " + String(message.method) } });
  }
}
process.stdin.on("end", () => process.exit(0));
`;

/**
 * The agent-workspace bootstrap manifest TL2 applies once (per profile):
 * the exact file set that registers the tool with the agent runtime.
 * Documented here as data so tests can pin the wiring contract.
 *
 * TWO MCP registration files, by consumer:
 *   - `.zcode/config.json` (`mcp.servers`) — the RUNTIME's own project-config
 *     discovery: the app-server merges it into runtimeConfig.mcp and
 *     auto-connects workspace-scoped servers (default-trusted policy).
 *   - `.agents/mcp.json` (`mcpServers`) — the desktop settings/import surface
 *     (host mcp-sync AGENTS_MCP_DESCRIPTOR); same server record, no
 *     double-registration (the host read prefers the zcode file).
 */
export interface WebflixUiAgentWorkspaceArtifacts {
  /** `<workspace>/.zcode/config.json` — the RUNTIME-native MCP registration. */
  readonly zcodeConfigJsonPath: string;
  readonly zcodeConfigJson: { mcp: { servers: Record<string, McpServerConfig> } };
  /** `<workspace>/.agents/mcp.json` — the desktop settings-surface mirror. */
  readonly agentsMcpJsonPath: string;
  readonly agentsMcpJson: { mcpServers: Record<string, McpServerConfig> };
  /** `<workspace>/.zcode/skills/webflix-ui/SKILL.md` — the workspace skill. */
  readonly skillMarkdownPath: string;
  readonly skillMarkdown: string;
}

export function buildWebflixUiAgentWorkspaceArtifacts(
  params: WebflixUiMcpServerConfigParams,
): WebflixUiAgentWorkspaceArtifacts {
  return {
    zcodeConfigJsonPath: joinPaths(
      params.workspacePath,
      ".zcode",
      "config.json",
    ),
    zcodeConfigJson: {
      mcp: { servers: { [WEBFLIX_UI_TOOL_NAME]: buildWebflixUiMcpServerConfig(params) } },
    },
    agentsMcpJsonPath: joinPaths(
      params.workspacePath,
      ".agents",
      "mcp.json",
    ),
    agentsMcpJson: { mcpServers: { [WEBFLIX_UI_TOOL_NAME]: buildWebflixUiMcpServerConfig(params) } },
    skillMarkdownPath: joinPaths(
      params.workspacePath,
      ".zcode",
      "skills",
      WEBFLIX_UI_SKILL_DIR_NAME,
      "SKILL.md",
    ),
    skillMarkdown: buildWebflixUiSkillMarkdown(),
  };
}

function joinPaths(...segments: string[]): string {
  return segments.join("/");
}
