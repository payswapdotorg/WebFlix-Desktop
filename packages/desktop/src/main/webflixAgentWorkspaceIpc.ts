/**
 * WFX-AGENT-BRIDGE-1 integration (TL2 lane — WFX-DESKTOP-WEBFLIX-UX-1):
 * the main-process side of the agent-workspace bootstrap + the official
 * YouTube Data API key source.
 *
 * What this module is (the boundary law, mirroring webflixAccountIpc.ts):
 *   - EXPLICITLY PERMISSIONED surface: exactly three methods over exactly
 *     three namespaced IPC channels — agent-workspace ensure, agent-workspace
 *     config writes, and the YouTube API key read. Nothing else is exposed.
 *   - The RENDERER supplies the artifact CONTENT (built from the frozen
 *     builder in renderer/src/agent/actionTool.ts — data, never executed in
 *     the renderer); the MAIN process is the validated WRITER: every path is
 *     checked (relative, no traversal, within the frozen WebFlix data root,
 *     allow-listed filenames only). The renderer has no filesystem.
 *   - The Data API key (freeze §9.5): read from WEBFLIX_YOUTUBE_API_KEY
 *     (main-process env) or `<dataRoot>/youtube-api-key` (a user-managed
 *     plain text file, one line). NEVER baked into the binary, never logged,
 *     and only ever handed to the renderer as the injected credential seam's
 *     value (the same value the composition root already expects).
 *   - Flavor-gated like the account surface: a ZCode identity build never
 *     gains these channels (registerWebFlixAgentWorkspaceIpc no-ops).
 */
import { app, ipcMain } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { resolveWebFlixVaultDataRoot } from "./webflix/osVaultAccountStore.js";

/** The typed IPC channels — MUST equal the preload bridge's exported constants (battery-pinned). */
export const WEBFLIX_AGENT_WORKSPACE_ENSURE_CHANNEL = "webflix:agent-workspace:ensure";
export const WEBFLIX_AGENT_WORKSPACE_WRITE_CONFIGS_CHANNEL = "webflix:agent-workspace:write-configs";
export const WEBFLIX_YOUTUBE_KEY_GET_CHANNEL = "webflix:youtube-key:get";

/** The agent workspace directory name under the WebFlix data root (freeze §9.7). */
export const WEBFLIX_AGENT_WORKSPACE_DIR_NAME = "agent-workspace";

/** The bundled stdio MCP entry filename inside the workspace. */
export const WEBFLIX_AGENT_MCP_ENTRY_FILENAME = "webflix-ui-mcp.mjs";

/** The user-managed Data API key file (one line, no quotes) under the data root. */
export const WEBFLIX_YOUTUBE_KEY_FILENAME = "youtube-api-key";

/** The allow-listed relative paths the ensure call may write. */
const ENSURE_ALLOWED_FILES = new Set<string>([
  WEBFLIX_AGENT_MCP_ENTRY_FILENAME,
  ".zcode/skills/webflix-ui/SKILL.md",
]);

/** The allow-listed relative paths the config-write call may write. */
const WRITE_CONFIGS_ALLOWED_FILES = new Set<string>([".zcode/config.json", ".agents/mcp.json"]);

export interface AgentWorkspaceFileSpec {
  readonly path: string;
  readonly content: string;
}

export interface WebFlixAgentWorkspaceEnsureResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly workspacePath?: string;
  readonly dataRoot?: string;
  /**
   * The node command for the MCP server config: dev = ["node"], packaged =
   * the app binary itself with ELECTRON_RUN_AS_NODE=1 in extraEnv (Electron
   * then behaves as plain Node for the stdio entry).
   */
  readonly nodeCommand?: string;
  readonly nodeArgs?: readonly string[];
  readonly extraEnv?: Record<string, string>;
}

export interface WebFlixAgentWorkspaceWriteResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface WebFlixYouTubeKeyResult {
  readonly key: string | null;
  readonly source: "env" | "file" | null;
}

export interface RegisterWebFlixAgentWorkspaceIpcOptions {
  readonly logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  readonly flavor?: typeof ZCODE_PRODUCT_FLAVOR;
  /** Injectable for tests (defaults to the real resolver). */
  readonly resolveDataRoot?: () => string;
}

function noopLogger(): { info: () => void; warn: () => void } {
  return { info: () => undefined, warn: () => undefined };
}

/** Validates one file spec against the allow-list; returns the absolute path or null. */
function resolveAllowedFilePath(workspacePath: string, spec: unknown, allowed: Set<string>): string | null {
  if (typeof spec !== "object" || spec === null) {
    return null;
  }
  const { path, content } = spec as { path?: unknown; content?: unknown };
  if (typeof path !== "string" || typeof content !== "string") {
    return null;
  }
  if (!allowed.has(path)) {
    return null;
  }
  if (isAbsolute(path) || path.includes("..") || normalize(path) !== path) {
    return null;
  }
  return join(workspacePath, path);
}

/**
 * Registers the WebFlix agent-workspace IPC channels. NO-OP unless the baked
 * product flavor is "webflix" — a ZCode identity build never gains this surface.
 */
export function registerWebFlixAgentWorkspaceIpc(options: RegisterWebFlixAgentWorkspaceIpcOptions): void {
  const flavor = options.flavor ?? ZCODE_PRODUCT_FLAVOR;
  if (flavor !== "webflix") {
    return;
  }
  const logger = options.logger ?? noopLogger();

  const resolveDataRoot =
    options.resolveDataRoot ??
    ((): string => {
      // Fail-closed exactly like the OS vault: WEBFLIX_IDENTITY=1 +
      // WEBFLIX_DATA_ROOT are the frozen identity env contract the desktop
      // main exports at startup. A refusal here never touches a ZCode root.
      try {
        return resolveWebFlixVaultDataRoot();
      } catch (error) {
        throw new Error(
          `webflixAgentWorkspaceIpc: the WebFlix data root is unavailable — ${(error as Error).message}`,
        );
      }
    });

  ipcMain.handle(
    WEBFLIX_AGENT_WORKSPACE_ENSURE_CHANNEL,
    (_event, payload: unknown): WebFlixAgentWorkspaceEnsureResult => {
      let dataRoot: string;
      try {
        dataRoot = resolveDataRoot();
      } catch (error) {
        logger.warn(`[webflix-agent-workspace] data root refused: ${(error as Error).message}`);
        return { ok: false, reason: (error as Error).message };
      }
      const workspacePath = join(dataRoot, WEBFLIX_AGENT_WORKSPACE_DIR_NAME);
      const files = Array.isArray((payload as { files?: unknown })?.files)
        ? ((payload as { files: unknown[] }).files as unknown[])
        : [];

      try {
        mkdirSync(join(workspacePath, ".zcode", "skills", "webflix-ui"), { recursive: true });
        mkdirSync(join(workspacePath, ".agents"), { recursive: true });
        mkdirSync(join(workspacePath, ".webflix-ui", "requests"), { recursive: true });
        for (const spec of files) {
          const absolute = resolveAllowedFilePath(workspacePath, spec, ENSURE_ALLOWED_FILES);
          if (absolute === null) {
            return {
              ok: false,
              reason: `webflixAgentWorkspaceIpc: refusing a disallowed ensure file (${JSON.stringify(
                (spec as { path?: unknown })?.path ?? spec,
              )})`,
            };
          }
          writeFileSync(absolute, (spec as { content: string }).content, "utf8");
        }
      } catch (error) {
        logger.warn(`[webflix-agent-workspace] ensure failed: ${(error as Error).message}`);
        return { ok: false, reason: (error as Error).message };
      }

      const entryPath = join(workspacePath, WEBFLIX_AGENT_MCP_ENTRY_FILENAME);
      const packaged = app.isPackaged;
      // Dev: plain `node <entry>`. Packaged: the app binary itself with
      // ELECTRON_RUN_AS_NODE=1 (Electron then behaves as plain Node) — the
      // stdio entry never needs a system node install.
      const nodeCommand = packaged ? process.execPath : "node";
      const nodeArgs = [entryPath];
      const extraEnv = packaged ? { ELECTRON_RUN_AS_NODE: "1" } : {};
      logger.info(
        `[webflix-agent-workspace] ensured ${workspacePath} (${files.length} files, node=${nodeCommand}${packaged ? " (as-node)" : ""})`,
      );
      return { ok: true, workspacePath, dataRoot, nodeCommand, nodeArgs, extraEnv };
    },
  );

  ipcMain.handle(
    WEBFLIX_AGENT_WORKSPACE_WRITE_CONFIGS_CHANNEL,
    (_event, payload: unknown): WebFlixAgentWorkspaceWriteResult => {
      let dataRoot: string;
      try {
        dataRoot = resolveDataRoot();
      } catch (error) {
        logger.warn(`[webflix-agent-workspace] data root refused: ${(error as Error).message}`);
        return { ok: false, reason: (error as Error).message };
      }
      const workspacePath = join(dataRoot, WEBFLIX_AGENT_WORKSPACE_DIR_NAME);
      const files = Array.isArray((payload as { files?: unknown })?.files)
        ? ((payload as { files: unknown[] }).files as unknown[])
        : [];
      try {
        for (const spec of files) {
          const absolute = resolveAllowedFilePath(workspacePath, spec, WRITE_CONFIGS_ALLOWED_FILES);
          if (absolute === null) {
            return {
              ok: false,
              reason: `webflixAgentWorkspaceIpc: refusing a disallowed config file (${JSON.stringify(
                (spec as { path?: unknown })?.path ?? spec,
              )})`,
            };
          }
          writeFileSync(absolute, (spec as { content: string }).content, "utf8");
        }
      } catch (error) {
        logger.warn(`[webflix-agent-workspace] config write failed: ${(error as Error).message}`);
        return { ok: false, reason: (error as Error).message };
      }
      logger.info(`[webflix-agent-workspace] wrote ${files.length} config files`);
      return { ok: true };
    },
  );

  ipcMain.handle(WEBFLIX_YOUTUBE_KEY_GET_CHANNEL, (): WebFlixYouTubeKeyResult => {
    const envKey = process.env.WEBFLIX_YOUTUBE_API_KEY?.trim();
    if (envKey && envKey !== "") {
      return { key: envKey, source: "env" };
    }
    try {
      const keyFile = join(resolveDataRoot(), WEBFLIX_YOUTUBE_KEY_FILENAME);
      if (existsSync(keyFile)) {
        const fileKey = readFileSync(keyFile, "utf8").trim();
        if (fileKey !== "") {
          return { key: fileKey, source: "file" };
        }
      }
    } catch {
      // An unreadable data root / file is simply no key — the honest state.
    }
    return { key: null, source: null };
  });
}
