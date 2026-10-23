/*
 * WFX-AGENT-BRIDGE-1 — the renderer-side `webflix_ui` rendezvous responder.
 *
 * WHY THIS EXISTS (the transport gap, investigated across apps/zcode-cli +
 * packages/services, every claim re-verified against source): the ZCode agent
 * runtime is the external `apps/zcode-cli` app-server (spawned as
 * `app-server --stdio`). Its sanctioned agent-callable extension surfaces:
 *
 *   - RUNTIME-NATIVE workspace MCP: `<workspace>/.zcode/config.json`
 *     (`mcp.servers`) — the app-server's own project-config discovery
 *     (adapters/src/config project-config.adapter.ts discovers exactly
 *     `zcode.json` + `.zcode/config.json`; bootstrap/src/app/runtime-config.ts
 *     merges `configResult.config.mcp.servers` and auto-connects
 *     workspace-scoped servers under the default-trusted policy). The
 *     desktop-continuous session/create ALSO accepts `mcpServers` params the
 *     UI resolves via the host mcp-sync mirror (`mcpSyncService.ts`
 *     AGENTS_MCP_DESCRIPTOR reads `<workspace>/.agents/mcp.json`
 *     `mcpServers` + `<workspace>/.zcode/config.json` `mcp.servers`).
 *   - workspace skills under `<workspace>/.zcode/skills/<name>/SKILL.md`
 *     (adapters/src/skills/roots.ts project-scope roots).
 *
 * An MCP stdio server is a CHILD of the agent process and has no sanctioned
 * channel into the renderer (all renderer-reachable RPC lives on the host's
 * MessagePort services). The rendezvous below closes that gap with ZERO
 * main-process changes, using ONLY existing sanctioned renderer services:
 *
 *   1. The bundled `webflix_ui` stdio MCP entry (TL2 wiring — see
 *      actionTool.ts) writes a request file into
 *      `<agent-workspace>/.webflix-ui/requests/<requestId>.json`.
 *   2. THIS responder (started when the agent bridge is live) polls that
 *      directory through the admitted runtime's `fileService` (readdir +
 *      readTextFile — read-only, host-side fs access), validates the action
 *      against the FROZEN UiActionSchema, and dispatches it through the
 *      UiActionBridge (the same use cases the UI buttons use).
 *   3. The typed UiActionResult JSON is written back through the preload's
 *      `createTempTextAttachment` bridge (the renderer's one sanctioned
 *      arbitrary-text-to-disk primitive), using the deterministic filename
 *      prefix `webflix-ui-response-<requestId>` inside
 *      `<webflix-data-root>/tmp/paste-attachments/<YYYY-MM-DD>/`.
 *   4. The MCP entry discovers the response by scanning that deterministic
 *      date directory for the prefix (today ± 1, midnight-rollover safe),
 *      reads the typed result JSON, and answers the LLM's tool call.
 *
 * Everything here is renderer code and testable with service doubles. The
 * response write is deliberately NOT a settings/file-config mutation: temp
 * attachments are the app's designed throwaway-text channel; nothing in
 * `~/.zcode` is ever touched (the WebFlix data root is the frozen root —
 * packages/services/src/paths.ts resolves the flavor-isolated
 * `~/.webflix[-dev]` root for createTempTextAttachment).
 */
import {
  parseUiActionInput,
  type UiActionBridge,
} from "./uiActionBridge.js";
import type { UiActionResult } from "../../../../../webflix-contracts/src/ui-actions.js";

/** The rendezvous directory (inside the agent workspace — freeze §9.7 root). */
export const WEBFLIX_UI_RENDEZVOUS_DIR_NAME = ".webflix-ui";
export const WEBFLIX_UI_REQUESTS_DIR_NAME = "requests";
/** Request file: `<requestId>.json`; response filename prefix (temp attachments). */
export const WEBFLIX_UI_RESPONSE_FILENAME_PREFIX = "webflix-ui-response-";
export const WEBFLIX_UI_REQUEST_SCHEMA_VERSION = 1;
/** Scan cadence — LLM tool-call latency dominates; this stays well under it. */
export const WEBFLIX_UI_RENDEZVOUS_POLL_INTERVAL_MS = 1_500;

/** The request file envelope the MCP entry writes. */
export interface WebflixUiActionRequestFile {
  schemaVersion: number;
  requestId: string;
  action: unknown;
}

/** The response envelope this responder writes (the tool's output payload). */
export interface WebflixUiActionResponseFile {
  schemaVersion: number;
  requestId: string;
  result: UiActionResult;
  respondedAt: string;
}

/** The read-only host file surface the admitted runtime provides. */
export interface RendezvousFileService {
  readdir(params: { path: string }): Promise<Array<{ name: string; type: "file" | "directory" }>>;
  readTextFile(params: { path: string }): Promise<{ content: string }>;
}

/** The renderer's sanctioned text-to-disk primitive (preload bridge). */
export interface TempTextFileWriter {
  (text: string, filename: string): Promise<{ localPath: string }>;
}

export interface WebflixUiActionRendezvousHandle {
  /** Stops polling (panel/bridge teardown). In-flight dispatches settle. */
  stop(): void;
  /** Honest counters for the panel strip / diagnostics. */
  stats(): {
    running: boolean;
    scannedDirs: number;
    dispatched: number;
    responded: number;
    lastError: string | null;
  };
}

export interface WebflixUiActionRendezvousDependencies {
  /** The agent workspace directory (freeze §9.7 — `<dataRoot>/agent-workspace`). */
  workspacePath: string;
  /** Read-only file access from the admitted runtime (fileService). */
  fileService: RendezvousFileService;
  /** The bridge dispatcher (typed actions → typed results). */
  bridge: UiActionBridge;
  /** createTempTextAttachment-bound writer (default: the preload bridge). */
  createTempTextFile?: TempTextFileWriter;
  /** Poll cadence (tests shrink it). */
  pollIntervalMs?: number;
  /** Clock/sleep injection (tests). */
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

function defaultTempTextFileWriter(): TempTextFileWriter | null {
  const bridge = (
    globalThis as {
      window?: {
        zcode?: {
          createTempTextAttachment?: (payload: {
            text: string;
            filename?: string;
          }) => Promise<{ localPath: string }>;
        };
      };
    }
  ).window?.zcode;
  if (typeof bridge?.createTempTextAttachment !== "function") return null;
  return (text, filename) => bridge.createTempTextAttachment!({ text, filename });
}

function joinDir(...segments: string[]): string {
  // Forward slashes are valid path separators on every supported host fs
  // (including win32 Node); the host resolves them against its own root.
  return segments.join("/");
}
/**
 * Starts the responder. Polls `<workspace>/.webflix-ui/requests`, dispatches
 * every valid request through the bridge, and answers with the typed result
 * JSON via the temp-attachment channel. Malformed requests get a typed
 * `invalid-action`/`unknown-action` failure response — a tool call never
 * hangs on a bad payload.
 */
export function startWebflixUiActionRendezvous(
  deps: WebflixUiActionRendezvousDependencies,
): WebflixUiActionRendezvousHandle {
  const {
    workspacePath,
    fileService,
    bridge,
    createTempTextFile = defaultTempTextFileWriter(),
    pollIntervalMs = WEBFLIX_UI_RENDEZVOUS_POLL_INTERVAL_MS,
    schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    cancel = (timer) => clearTimeout(timer),
  } = deps;

  const requestsDir = joinDir(
    workspacePath,
    WEBFLIX_UI_RENDEZVOUS_DIR_NAME,
    WEBFLIX_UI_REQUESTS_DIR_NAME,
  );
  const processedRequestIds = new Set<string>();
  const stats = {
    running: true,
    scannedDirs: 0,
    dispatched: 0,
    responded: 0,
    lastError: null as string | null,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scanInFlight = false;

  const respond = async (requestId: string, result: UiActionResult): Promise<void> => {
    if (createTempTextFile === null) {
      stats.lastError =
        "temp-attachment bridge unavailable — the WebFlix renderer cannot answer webflix_ui tool calls in this runtime";
      return;
    }
    const response: WebflixUiActionResponseFile = {
      schemaVersion: WEBFLIX_UI_REQUEST_SCHEMA_VERSION,
      requestId,
      result,
      respondedAt: new Date().toISOString(),
    };
    await createTempTextFile(
      JSON.stringify(response),
      `${WEBFLIX_UI_RESPONSE_FILENAME_PREFIX}${requestId}`,
    );
    stats.responded += 1;
  };

  const scan = async (): Promise<void> => {
    if (scanInFlight || !stats.running) return;
    scanInFlight = true;
    try {
      const entries = await fileService.readdir({ path: requestsDir });
      stats.scannedDirs += 1;
      stats.lastError = null;
      const requestFiles = entries.filter(
        (entry) => entry.type === "file" && entry.name.endsWith(".json"),
      );
      for (const entry of requestFiles) {
        const requestId = entry.name.slice(0, -".json".length);
        if (requestId.length === 0 || processedRequestIds.has(requestId)) continue;
        processedRequestIds.add(requestId);
        try {
          const slice = await fileService.readTextFile({
            path: joinDir(requestsDir, entry.name),
          });
          let request: WebflixUiActionRequestFile | null = null;
          try {
            request = JSON.parse(slice.content) as WebflixUiActionRequestFile;
          } catch {
            request = null;
          }
          if (
            request === null ||
            request.schemaVersion !== WEBFLIX_UI_REQUEST_SCHEMA_VERSION ||
            typeof request.requestId !== "string" ||
            request.requestId !== requestId
          ) {
            await respond(requestId, {
              kind: "failure",
              code: "invalid-action",
              message: `The rendezvous request file "${entry.name}" is not a conforming webflix_ui request envelope.`,
              retryable: false,
            });
            continue;
          }
          const parsedAction = parseUiActionInput(request.action);
          stats.dispatched += 1;
          const result = parsedAction.ok
            ? await bridge.dispatch(parsedAction.action)
            : parsedAction.result;
          await respond(requestId, result);
        } catch (error) {
          stats.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } catch (error) {
      // The directory not existing yet (the MCP entry has not run) is normal;
      // anything else is recorded honestly and polling continues.
      stats.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      scanInFlight = false;
    }
  };

  const tick = (): void => {
    if (!stats.running) return;
    void scan();
    timer = schedule(tick, pollIntervalMs);
  };
  timer = schedule(tick, 0);

  return {
    stop(): void {
      stats.running = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    stats(): typeof stats {
      return { ...stats };
    },
  };
}
