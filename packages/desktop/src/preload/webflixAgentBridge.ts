/**
 * WFX-AGENT-BRIDGE-1 integration (TL2 lane) — the narrowly scoped preload
 * bridge for the WebFlix agent-workspace bootstrap + the YouTube Data API
 * key source.
 *
 * Boundary rules (all binding, mirroring webflixAccountBridge.ts and the
 * main module webflixAgentWorkspaceIpc.ts):
 *   - EXPLICITLY PERMISSIONED surface: exactly three methods over exactly
 *     three namespaced channels. No generic invoke passthrough.
 *   - The renderer supplies artifact CONTENT (data from the frozen builder);
 *     the main process validates and writes. The key value crosses ONLY as
 *     the injected credential seam's value and is never logged here.
 *   - Flavor-gated: exposed ONLY in the baked webflix flavor.
 *   - The channel strings MUST equal the main module's exported constants.
 *
 * Registration is idempotent-safe: self-registers at import evaluation
 * (the preload bundle imports this module exactly once, from index.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

export const WEBFLIX_AGENT_WORKSPACE_ENSURE_CHANNEL = "webflix:agent-workspace:ensure";
export const WEBFLIX_AGENT_WORKSPACE_WRITE_CONFIGS_CHANNEL = "webflix:agent-workspace:write-configs";
export const WEBFLIX_YOUTUBE_KEY_GET_CHANNEL = "webflix:youtube-key:get";

export interface AgentWorkspaceFileSpec {
  readonly path: string;
  readonly content: string;
}

export interface WebFlixAgentWorkspaceEnsureResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly workspacePath?: string;
  readonly dataRoot?: string;
  readonly nodeCommand?: string;
  readonly nodeArgs?: readonly string[];
  readonly extraEnv?: Record<string, string>;
}

export interface WebFlixYouTubeKeyResult {
  readonly key: string | null;
  readonly source: "env" | "file" | null;
}

export interface WebFlixAgentWorkspaceBridge {
  ensureWorkspace(files: readonly AgentWorkspaceFileSpec[]): Promise<WebFlixAgentWorkspaceEnsureResult>;
  writeConfigs(files: readonly AgentWorkspaceFileSpec[]): Promise<{ ok: boolean; reason?: string }>;
  getYouTubeApiKey(): Promise<WebFlixYouTubeKeyResult>;
}

type ElectronLike = {
  contextBridge: { exposeInMainWorld: (apiKey: string, api: unknown) => void };
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
};

function registerWebFlixAgentPreloadBridge(electron: ElectronLike): void {
  if (ZCODE_PRODUCT_FLAVOR !== "webflix") {
    return;
  }
  const bridge: WebFlixAgentWorkspaceBridge = {
    async ensureWorkspace(files) {
      return (await electron.ipcRenderer.invoke(WEBFLIX_AGENT_WORKSPACE_ENSURE_CHANNEL, {
        files,
      })) as WebFlixAgentWorkspaceEnsureResult;
    },
    async writeConfigs(files) {
      return (await electron.ipcRenderer.invoke(WEBFLIX_AGENT_WORKSPACE_WRITE_CONFIGS_CHANNEL, {
        files,
      })) as { ok: boolean; reason?: string };
    },
    async getYouTubeApiKey() {
      return (await electron.ipcRenderer.invoke(WEBFLIX_YOUTUBE_KEY_GET_CHANNEL)) as WebFlixYouTubeKeyResult;
    },
  };
  electron.contextBridge.exposeInMainWorld("webflixAgent", bridge);
}

registerWebFlixAgentPreloadBridge({ contextBridge, ipcRenderer });
