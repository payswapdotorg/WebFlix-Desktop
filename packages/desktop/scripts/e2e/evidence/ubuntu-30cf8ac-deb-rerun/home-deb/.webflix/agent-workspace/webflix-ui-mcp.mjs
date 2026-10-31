#!/usr/bin/env node
// webflix-ui-mcp.mjs — the bundled stdio MCP entry for the webflix_ui tool.
// Transport: file rendezvous with the WebFlix renderer (see WFX-AGENT-BRIDGE-1).
import { readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TOOL_NAME = "webflix_ui";
const TOOL_DESCRIPTION = "Operate the visible WebFlix media interface through TYPED, consent-lawful actions.\n\nCONSENT LAW (binding):\n- Allowed: searching the catalog, resolving channels, opening routes, playing catalog items by itemId, opening the account-connection surface, toggling this agent panel, reading the visible media context.\n- Reference media ONLY by itemId/channelId you obtained from this tool's results or the visible context — never fabricate items or ids; a hallucinated id fails typed.\n- When the request is ambiguous (multiple candidate channels/videos, unclear target), the tool returns needs-user-choice: relay the prompt and labeled choices to the user verbatim and let THEM pick. Never choose for the user.\n- NEVER claim, promise or attempt account mutations (like, subscribe, comment, playlist writes, uploads, downloads). Those are deliberately absent from this tool; the user performs them through their own consented surfaces. openAccountConnection only OPENS the connection settings surface.\n- Prefer getVisibleMediaContext first when you need to know the current route, playing item, visible items or connection states — the answer comes from the app's own state, never from guessing.\n\nResult kinds: ok (summary + items/channels + evidence + post-action context), failure (typed code, retryable), needs-user-choice (prompt + choices), unsupported (capability + reason).";
const INPUT_SCHEMA = {"$schema":"https://json-schema.org/draft/2020-12/schema","title":"WebFlixUiToolInput","description":"One frozen WebFlix UI action. Discriminated by `action`; payload fields per action kind.","oneOf":[{"type":"object","properties":{"action":{"const":"searchCatalog"},"query":{"type":"string","minLength":1},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["action","query"]},{"type":"object","properties":{"action":{"const":"resolveChannel"},"query":{"type":"string","minLength":1}},"required":["action","query"]},{"type":"object","properties":{"action":{"const":"openRoute"},"route":{"enum":["home","search","watch","channel","shorts","trending","subscriptions","library","history","settings","accounts","ads","evaluation","netflix"]},"params":{"type":"object","properties":{"query":{"type":"string"},"itemId":{"type":"string"},"channelId":{"type":"string"},"handle":{"type":"string"},"channelTab":{"type":"string"},"category":{"type":"string"},"region":{"type":"string"}}}},"required":["action","route"]},{"type":"object","properties":{"action":{"const":"playCatalogItem"},"itemId":{"type":"string","minLength":1},"startAtSec":{"type":"number","minimum":0}},"required":["action","itemId"]},{"type":"object","properties":{"action":{"const":"openAccountConnection"},"providerId":{"type":"string","minLength":1}},"required":["action","providerId"]},{"type":"object","properties":{"action":{"const":"toggleAgentPanel"},"visible":{"type":"boolean"}},"required":["action"]},{"type":"object","properties":{"action":{"const":"getVisibleMediaContext"}},"required":["action"]}]};
const RENDEZVOUS_DIR = process.env.WEBFLIX_UI_RENDEZVOUS_DIR ?? ".";
const RESPONSE_ROOT = process.env.WEBFLIX_UI_RESPONSE_ROOT ?? "";
const REQUESTS_DIR = join(RENDEZVOUS_DIR, ".webflix-ui", "requests");
const RESPONSE_PREFIX = "webflix-ui-response-";
const SCHEMA_VERSION = 1;
const RESPONSE_TIMEOUT_MS = 30_000;
const RESPONSE_POLL_MS = 400;

function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
function dateDirName(offsetDays = 0) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - offsetDays);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
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
  while ((index = buffer.indexOf("\n")) >= 0) {
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
