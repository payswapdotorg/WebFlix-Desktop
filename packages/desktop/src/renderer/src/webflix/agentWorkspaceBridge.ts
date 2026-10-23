/**
 * WFX-AGENT-BRIDGE-1 integration (TL2 lane) — the renderer-side fail-closed
 * client for the agent-workspace bootstrap + YouTube Data API key bridge
 * (mirrors accountsBridge.ts exactly; see preload/webflixAgentBridge.ts
 * and main/webflixAgentWorkspaceIpc.ts for the boundary law).
 */

/** One validated file the main process writes into the agent workspace. */
export interface AgentWorkspaceFileSpec {
  readonly path: string;
  readonly content: string;
}

/** The ensure outcome: paths + the resolved node command for the MCP config. */
export interface WebFlixAgentWorkspaceEnsureResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly workspacePath?: string;
  readonly dataRoot?: string;
  readonly nodeCommand?: string;
  readonly nodeArgs?: readonly string[];
  readonly extraEnv?: Record<string, string>;
}

/** The official Data API key result (null key = the honest unconfigured state). */
export interface WebFlixYouTubeKeyResult {
  readonly key: string | null;
  readonly source: "env" | "file" | null;
}

export interface WebFlixAgentWorkspaceBridge {
  ensureWorkspace(files: readonly AgentWorkspaceFileSpec[]): Promise<WebFlixAgentWorkspaceEnsureResult>;
  writeConfigs(files: readonly AgentWorkspaceFileSpec[]): Promise<{ ok: boolean; reason?: string }>;
  getYouTubeApiKey(): Promise<WebFlixYouTubeKeyResult>;
}

declare global {
  interface Window {
    readonly webflixAgent?: WebFlixAgentWorkspaceBridge;
  }
}

/**
 * The live bridge, or null when absent (fail-closed — the honest typed
 * "agent workspace bootstrap unavailable" state; nothing is invented).
 */
export function getWebFlixAgentWorkspaceBridge(): WebFlixAgentWorkspaceBridge | null {
  const candidate = (globalThis as { window?: { webflixAgent?: unknown } }).window?.webflixAgent;
  if (candidate == null || typeof candidate !== "object") {
    return null;
  }
  const bridge = candidate as Partial<WebFlixAgentWorkspaceBridge>;
  if (
    typeof bridge.ensureWorkspace !== "function" ||
    typeof bridge.writeConfigs !== "function" ||
    typeof bridge.getYouTubeApiKey !== "function"
  ) {
    return null;
  }
  return bridge as WebFlixAgentWorkspaceBridge;
}
