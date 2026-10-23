/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the producers + the
 * agent-workspace bootstrap hooks, extracted from boot.tsx for the
 * max-lines law. Behavior is byte-equivalent:
 *   - the producers build (the real live composition via the key IPC, or
 *     the injected test factory; honest null on failure);
 *   - the once-per-session workspace bootstrap (the frozen artifacts
 *     through the main-process validated writer, then the MCP registration).
 */
import { useEffect, useRef, useState } from "react";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { MediaWatchHistorySource } from "../../../../../webflix-application/src/media/media-history-port.js";
import type { getWebFlixAgentWorkspaceBridge } from "./agentWorkspaceBridge.js";
import { createDefaultMediaProducers } from "./mediaHostSupport.js";
import {
  buildWebflixUiAgentWorkspaceArtifacts,
  buildWebflixUiSkillMarkdown,
  WEBFLIX_UI_MCP_ENTRY_REFERENCE_SOURCE,
} from "../agent/actionTool.js";

export interface ProducersAndWorkspaceDeps {
  readonly agentWorkspaceBridge: ReturnType<typeof getWebFlixAgentWorkspaceBridge>;
  readonly createMediaProducers?: () => Promise<YouTubeMediaProducers | null>;
  readonly historySource: MediaWatchHistorySource;
}

export interface ProducersAndWorkspaceState {
  readonly getProducers: () => YouTubeMediaProducers | null;
  readonly producersReady: boolean;
  readonly agentWorkspacePath: string | null;
}

/** The producers build + the workspace bootstrap (one combined hook). */
export function useProducersAndWorkspace(
  deps: ProducersAndWorkspaceDeps,
): ProducersAndWorkspaceState {
  const { agentWorkspaceBridge, createMediaProducers, historySource } = deps;
  const producersRef = useRef<YouTubeMediaProducers | null>(null);
  const [producersReady, setProducersReady] = useState(false);
  const [agentWorkspacePath, setAgentWorkspacePath] = useState<string | null>(null);

  // The producers: the real live composition (key IPC → live client or the
  // honest requires-auth handle), or a test double.
  useEffect(() => {
    let active = true;
    const build = async (): Promise<YouTubeMediaProducers | null> => {
      if (createMediaProducers !== undefined) {
        return createMediaProducers();
      }
      return createDefaultMediaProducers(agentWorkspaceBridge, historySource);
    };
    void build()
      .then((producers) => {
        if (!active) return;
        producersRef.current = producers;
        setProducersReady(true);
      })
      .catch(() => {
        if (!active) return;
        producersRef.current = null;
        setProducersReady(true);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createMediaProducers]);

  // The agent-workspace bootstrap (once per session): the frozen artifacts
  // through the main-process validated writer, then the MCP registration.
  useEffect(() => {
    let active = true;
    const workspaceBridge = agentWorkspaceBridge;
    if (workspaceBridge === null) {
      return;
    }
    void (async () => {
      try {
        const ensure = await workspaceBridge.ensureWorkspace([
          { path: "webflix-ui-mcp.mjs", content: WEBFLIX_UI_MCP_ENTRY_REFERENCE_SOURCE },
          { path: ".zcode/skills/webflix-ui/SKILL.md", content: buildWebflixUiSkillMarkdown() },
        ]);
        if (!active || !ensure.ok || ensure.workspacePath === undefined) {
          return;
        }
        const artifacts = buildWebflixUiAgentWorkspaceArtifacts({
          command: ensure.nodeCommand ?? "node",
          ...(ensure.nodeArgs !== undefined ? { args: [...ensure.nodeArgs] } : {}),
          workspacePath: ensure.workspacePath,
          dataRoot: ensure.dataRoot ?? "",
          ...(ensure.extraEnv !== undefined ? { extraEnv: ensure.extraEnv } : {}),
        });
        const write = await workspaceBridge.writeConfigs([
          {
            path: ".zcode/config.json",
            content: JSON.stringify(artifacts.zcodeConfigJson, null, 2),
          },
          {
            path: ".agents/mcp.json",
            content: JSON.stringify(artifacts.agentsMcpJson, null, 2),
          },
        ]);
        if (active && write.ok) {
          setAgentWorkspacePath(ensure.workspacePath);
        }
      } catch {
        /* the panel renders its honest unavailable state; nothing invented */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentWorkspaceBridge]);

  return {
    getProducers: () => producersRef.current,
    producersReady,
    agentWorkspacePath,
  };
}
