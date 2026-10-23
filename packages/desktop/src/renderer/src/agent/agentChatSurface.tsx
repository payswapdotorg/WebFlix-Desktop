/**
 * WFX-AGENT-BRIDGE-1 — the LAZY ZCode chat surface (freeze §9.3 + §9.4).
 *
 * THIS MODULE IS THE ONLY @zcode/ui IMPORT BOUNDARY. It statically imports
 * `@zcode/ui` (V4ChatPane + the full provider stack) AND
 * `@zcode/ui/styles.css`; it is reachable ONLY through the dynamic import in
 * `AgentPanel.tsx` (`defaultLoadChatSurface`). The media-first WebFlix boot
 * never imports this module — the ZCode UI bundle + stylesheet load exactly
 * when the user first opens the agent panel, never before (freeze §9.3).
 *
 * CSS ISOLATION (freeze §9.4): the ZCode theme root classes (`dark` +
 * `theme-zai-dark`) are applied to the PANEL-SCOPED CONTAINER below — never
 * to `document.documentElement` (zcodeBoot.tsx does that for the ZCode
 * flavor; this surface deliberately does NOT). The ZCode sheet's theme
 * variables therefore resolve inside the panel subtree only, and the
 * media shell keeps its own tokens. Pinned by the panel DOM test:
 * `agent/__tests__/AgentPanel.test.tsx` asserts the document root class
 * list is untouched across panel mount/unmount.
 *
 * Composition (the closest supported composition of the REAL chat surface —
 * the same provider nesting Root.tsx uses, scoped to the pane):
 *
 *   AppErrorBoundary
 *     > ZCodeIntlProvider (settingService + broadcastService + system locale)
 *       > ServiceProvider(services from the admitted runtime)
 *         > PlatformProvider(createDesktopPlatform())
 *           > StoreProvider(broadcastService)
 *             > TabStoreProvider
 *               > AgentTaskStrip (the honest minimal task/session surface)
 *               > V4ChatPane(workspacePath, sessionId, isDesktop,
 *                            onSessionCreated/onSessionDeleted selection)
 *
 * Model/provider switching: the composer's own model picker renders inside
 * V4ChatPane's composer toolbar (V4ComposerToolbar reads the host
 * ModelSelectionView through `useServices` → ServiceProvider — the same
 * modelSelectionService/providerSettingsService services the ZCode
 * workspace uses). No second picker is implemented here; switching flows
 * through the existing services exactly as in the ZCode product.
 *
 * The task/session strip (honest minimal surface): recent tasks for the
 * agent workspace via the sanctioned `useWorkspaceTaskLists` hook, active
 * runtime status + running background jobs (elapsed via
 * BackgroundTaskElapsedLabel) from `useZCodeSessionStore`. Selection =
 * clicking a row hands that session to V4ChatPane; the stop/queue controls
 * for the OPEN conversation are the ones the V4 surface itself renders —
 * nothing is reimplemented here.
 */
import "@zcode/ui/styles.css";
import { useCallback, useMemo, useState } from "react";
import {
  AppErrorBoundary,
  BackgroundTaskElapsedLabel,
  PlatformProvider,
  ServiceProvider,
  StoreProvider,
  TabStoreProvider,
  useWorkspaceTaskLists,
  useZCodeSessionStore,
  V4ChatPane,
  ZCodeIntlProvider,
} from "@zcode/ui";
import { createDesktopPlatform } from "../desktopPlatform.js";
import {
  AGENT_ZCODE_THEME_ROOT_CLASSNAMES,
  type AgentChatSurfaceProps,
} from "./AgentPanel.js";

/** The one synthesized workspace tab the strip queries (the agent workspace). */
const AGENT_WORKSPACE_TAB_ID = "webflix-agent-workspace";

/** How many recent tasks the strip shows (bounded, honest minimal surface). */
const AGENT_TASK_STRIP_LIMIT = 8;

const surfaceStyles: Record<string, import("react").CSSProperties> = {
  root: {
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    // Contain the ZCode sheet's effects to this subtree (stacking contexts,
    // variable resolution scope is the class-scoped container below).
    isolation: "isolate",
    background: "#161616",
    color: "#e7e7ea",
  },
  strip: {
    flex: "0 0 auto",
    maxHeight: 168,
    overflowY: "auto",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    padding: "4px 8px",
    fontSize: 11.5,
    lineHeight: 1.45,
  },
  stripHeader: { color: "#9a9aa3", letterSpacing: 0.2, marginBottom: 2 },
  stripRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    borderRadius: 4,
    color: "#c9c9d1",
    cursor: "pointer",
    padding: "3px 6px",
  },
  stripRowActive: { background: "rgba(255,255,255,0.08)", color: "#ffffff" },
  stripTitle: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  stripStatus: { flex: "0 0 auto", color: "#9a9aa3" },
  chat: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" },
};

function readLocalDevelopmentRuntimeFlag(): boolean {
  return (
    (globalThis as typeof globalThis & { __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__?: boolean })
      .__ZCODE_LOCAL_DEVELOPMENT_RUNTIME__ === true
  );
}

/**
 * The lazy chat surface — mounted by AgentPanel only after the ZCode runtime
 * is admitted. `runtime.services` are the SAME connected services the ZCode
 * boot would use (connectViaMessagePort + registerBaseWorkspaceServices were
 * run by the admission handshake).
 */
export function AgentChatSurface({ workspacePath, runtime, header }: AgentChatSurfaceProps) {
  const platform = useMemo(
    () => createDesktopPlatform({ isLocalDevelopmentRuntime: readLocalDevelopmentRuntimeFlag() }),
    [],
  );
  // Draft initially (null) — the FIRST sent message creates the session and
  // selects it (onSessionCreated); deleting it returns to draft.
  const [sessionId, setSessionId] = useState<string | null>(null);

  const handleSessionCreated = useCallback((createdSessionId: string) => {
    setSessionId(createdSessionId);
  }, []);
  const handleSessionDeleted = useCallback(() => {
    setSessionId(null);
  }, []);

  return (
    <div
      className={AGENT_ZCODE_THEME_ROOT_CLASSNAMES.join(" ")}
      style={surfaceStyles.root}
      data-testid="agent-zcode-surface-root"
    >
      <AppErrorBoundary isDesktop>
        <ZCodeIntlProvider
          settingService={runtime.services.settingService}
          broadcastService={runtime.services.broadcastService}
          resolveSystemLocale={platform.getSystemLocale}
        >
          <ServiceProvider services={runtime.services}>
            <PlatformProvider platform={platform}>
              <StoreProvider broadcastService={runtime.services.broadcastService}>
                <TabStoreProvider>
                  {header ?? null}
                  <AgentTaskStrip
                    workspacePath={workspacePath}
                    selectedSessionId={sessionId}
                    onSelectSession={setSessionId}
                  />
                  <div style={surfaceStyles.chat}>
                    <V4ChatPane
                      workspacePath={workspacePath}
                      sessionId={sessionId}
                      isDesktop
                      onSessionCreated={handleSessionCreated}
                      onSessionDeleted={handleSessionDeleted}
                    />
                  </div>
                </TabStoreProvider>
              </StoreProvider>
            </PlatformProvider>
          </ServiceProvider>
        </ZCodeIntlProvider>
      </AppErrorBoundary>
    </div>
  );
}

/**
 * The honest minimal task/session strip: recent tasks (sanctioned
 * useWorkspaceTaskLists hook over the agent workspace), the active runtime
 * status and its running background jobs with live elapsed labels. The
 * stop/queue/close controls for the open conversation are the V4 surface's
 * own (ConversationStatusPanel) — this strip never reimplements them.
 */
function AgentTaskStrip({
  workspacePath,
  selectedSessionId,
  onSelectSession,
}: {
  workspacePath: string;
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}) {
  // The single synthesized workspace tab — structural WorkspaceTabState.
  const workspaceTabs = useMemo(
    () => [
      {
        id: AGENT_WORKSPACE_TAB_ID,
        kind: "workspace" as const,
        workspacePath,
        label: "Agent",
      },
    ],
    [workspacePath],
  );
  const { groups, loadingByWorkspaceKey } = useWorkspaceTaskLists({
    workspaceTabs,
    activeWorkspacePath: workspacePath,
    sortBy: "updated",
    visibleLimitByWorkspaceKey: {},
    defaultVisibleLimit: AGENT_TASK_STRIP_LIMIT,
  });
  // Stable bucket reference (getDefaultWorkspaceState returns a stable
  // singleton), so this selector never thrashes.
  const workspaceState = useZCodeSessionStore((state) =>
    state.getWorkspaceState(workspacePath),
  );
  const activeTaskId = workspaceState.activeTaskId;
  const draftSessionId = workspaceState.draftSessionId;
  const activeRuntime =
    activeTaskId != null ? workspaceState.taskRuntimeByTaskId[activeTaskId] : undefined;
  const runningJobs = activeRuntime?.backgroundTaskControls.filter(
    (job) => job.status === "running",
  );
  const tasks = groups.find((group) => group.workspacePath === workspacePath)?.items ?? [];
  const loading = loadingByWorkspaceKey[workspacePath] === true;

  return (
    <div style={surfaceStyles.strip} data-testid="agent-task-strip">
      <div style={surfaceStyles.stripHeader} data-testid="agent-task-strip-header">
        Tasks{loading ? " — loading…" : tasks.length > 0 ? ` (${tasks.length})` : " — none yet"}
        {runningJobs != null && runningJobs.length > 0
          ? ` · ${runningJobs.length} running`
          : ""}
      </div>
      {runningJobs != null &&
        runningJobs.map((job) => (
          <div
            key={job.jobId}
            style={surfaceStyles.stripRow}
            data-testid="agent-task-strip-running-job"
          >
            <span style={surfaceStyles.stripTitle}>{job.title ?? job.command}</span>
            <BackgroundTaskElapsedLabel job={job} />
          </div>
        ))}
      {tasks.slice(0, AGENT_TASK_STRIP_LIMIT).map((task) => {
        const isActive =
          selectedSessionId === task.taskId ||
          (selectedSessionId == null && activeTaskId === task.taskId);
        return (
          <button
            key={task.taskId}
            type="button"
            style={isActive ? { ...surfaceStyles.stripRow, ...surfaceStyles.stripRowActive } : surfaceStyles.stripRow}
            onClick={() => onSelectSession(task.taskId)}
            data-testid="agent-task-strip-task"
            aria-current={isActive ? "true" : undefined}
          >
            <span style={surfaceStyles.stripTitle}>{task.title || "Untitled task"}</span>
            <span style={surfaceStyles.stripStatus}>
              {task.status ?? "—"}
            </span>
          </button>
        );
      })}
      {draftSessionId == null && tasks.length === 0 && !loading ? (
        <div style={{ color: "#9a9aa3" }}>
          No sessions yet — the first message creates one.
        </div>
      ) : null}
    </div>
  );
}
