// @vitest-environment jsdom
//
// WFX-AGENT-BRIDGE-1 — the agent panel composition battery (freeze §9.3 +
// §9.4). The REAL chat surface module (agentChatSurface.tsx, which
// statically imports @zcode/ui + styles.css) is far too heavy for the
// hermetic renderer battery — and the composition law is exactly that it
// stays OUT of the media-first graph — so these tests mount AgentPanel with
// an injected FAKE surface module that mirrors the real module's contract
// (same props, same theme-root classes), plus source-level pins that the
// REAL lazy module carries the stylesheet import and never touches the
// document root.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AgentPanel, AGENT_ZCODE_THEME_ROOT_CLASSNAMES } from "../AgentPanel.js";
import type { AgentChatSurfaceProps } from "../AgentPanel.js";
import { __resetAgentRuntimeAdmissionForTest } from "../runtimeAdmission.js";
import type { AgentRuntimeHandle } from "../runtimeAdmission.js";
import { startWebflixUiActionRendezvous } from "../uiActionRendezvous.js";
import type { UiActionHandlers } from "../uiActionBridge.js";

afterEach(() => {
  cleanup();
  __resetAgentRuntimeAdmissionForTest();
});

/** A minimal fake runtime handle (the panel only forwards it). */
function fakeRuntime(): AgentRuntimeHandle {
  return {
    services: {
      fileService: {
        readdir: async () => [],
        readTextFile: async () => ({ content: "" }),
      },
    } as unknown as AgentRuntimeHandle["services"],
    startupId: "startup-A",
    connectedAt: 1,
  };
}

function fakeHandlers(): UiActionHandlers {
  const ok = { kind: "ok" as const, summary: "handled", items: [], channels: [], evidence: [] };
  return {
    searchCatalog: async () => ok,
    resolveChannel: async () => ok,
    openRoute: async () => ok,
    playCatalogItem: async () => ok,
    openAccountConnection: async () => ok,
    toggleAgentPanel: async () => ok,
    getVisibleMediaContext: () => ({
      at: "2026-10-23T12:00:00.000Z",
      route: "home" as const,
      params: {},
      playingItem: null,
      watchPlanKind: null,
      visibleItemIds: [],
      connections: [],
      agentPanel: { visible: true, widthPx: null },
      pendingChoice: null,
    }),
  };
}

/**
 * A fake chat-surface module mirroring the real agentChatSurface contract:
 * renders a container carrying the ZCode theme root classes (freeze §9.4)
 * and echoes the mount props for assertions.
 */
function createFakeSurfaceModule(seen: AgentChatSurfaceProps[]) {
  return {
    AgentChatSurface: (props: AgentChatSurfaceProps) => {
      seen.push(props);
      return (
        <div
          className={AGENT_ZCODE_THEME_ROOT_CLASSNAMES.join(" ")}
          data-testid="agent-zcode-surface-root"
          data-workspace={props.workspacePath}
        >
          <div data-testid="agent-fake-chat">real V4ChatPane would mount here</div>
        </div>
      );
    },
  };
}

function readModuleSource(relativePath: string): string {
  const url = new URL(relativePath, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

describe("AgentPanel — the honest unavailable states", () => {
  it("renders the connecting state while the admission wait is pending", () => {
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={() => new Promise(() => {})}
      />,
    );
    expect(screen.getByTestId("agent-panel-connecting")).toBeTruthy();
    expect(screen.getByTestId("agent-panel-connecting").textContent).toContain(
      "Nothing is simulated",
    );
  });

  it("renders the typed unavailable state with retry on admission timeout (null)", async () => {
    const getRuntime = vi.fn(async () => null);
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={getRuntime}
      />,
    );
    const unavailable = await screen.findByTestId("agent-panel-unavailable");
    expect(unavailable.textContent).toContain("Agent runtime unavailable");
    expect(unavailable.textContent).toContain("did not deliver its service port");
    expect(screen.getByTestId("agent-panel-retry")).toBeTruthy();
    expect(getRuntime).toHaveBeenCalledTimes(1);
  });

  it("retry re-arms the admission and waits again", async () => {
    const getRuntime = vi.fn(async () => null);
    const retryAdmission = vi.fn();
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={getRuntime}
        retryAdmission={retryAdmission}
      />,
    );
    await screen.findByTestId("agent-panel-unavailable");
    fireEvent.click(screen.getByTestId("agent-panel-retry"));
    expect(retryAdmission).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getRuntime).toHaveBeenCalledTimes(2));
    await screen.findByTestId("agent-panel-unavailable");
  });

  it("the close affordance delegates visibility to the shell", async () => {
    const onClose = vi.fn();
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={onClose}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => null}
      />,
    );
    await screen.findByTestId("agent-panel-unavailable");
    fireEvent.click(screen.getByTestId("agent-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("AgentPanel — the lazy REAL-chat mount contract (freeze §9.3)", () => {
  it("loads the surface module ONLY after admission and mounts it with the runtime + workspace", async () => {
    const seenProps: AgentChatSurfaceProps[] = [];
    const loadChatSurface = vi.fn(() => Promise.resolve(createFakeSurfaceModule(seenProps)));
    const runtime = fakeRuntime();
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => runtime}
        loadChatSurface={loadChatSurface}
      />,
    );
    // The loading-surface state shows while the lazy module resolves.
    expect(await screen.findByTestId("agent-panel-loading-surface")).toBeTruthy();
    await waitFor(() => expect(loadChatSurface).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("agent-fake-chat")).toBeTruthy();
    expect(seenProps).toHaveLength(1);
    expect(seenProps[0]?.workspacePath).toBe("/data/agent-workspace");
    expect(seenProps[0]?.runtime).toBe(runtime);
    expect(seenProps[0]?.header).toBeTruthy();
  });

  it("a failing lazy surface load renders the typed error with a retry", async () => {
    let attempts = 0;
    const loadChatSurface = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("bundle chunk missing"))
        : Promise.resolve(createFakeSurfaceModule([]));
    });
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => fakeRuntime()}
        loadChatSurface={loadChatSurface}
      />,
    );
    const error = await screen.findByTestId("agent-panel-surface-error");
    expect(error.textContent).toContain("bundle chunk missing");
    fireEvent.click(screen.getByTestId("agent-panel-surface-retry"));
    await screen.findByTestId("agent-fake-chat");
    expect(loadChatSurface).toHaveBeenCalledTimes(2);
  });

  it("onBridgeReady hands the host the live bridge (dispatch + the exportable trace buffer)", async () => {
    const seen: Array<{ dispatch: unknown; trace: unknown }> = [];
    const onBridgeReady = vi.fn((bridge: unknown) => {
      seen.push({ dispatch: bridge, trace: (bridge as { trace: unknown }).trace });
    });
    const handlers = fakeHandlers();
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={handlers}
        onBridgeReady={onBridgeReady as (bridge: unknown) => void}
        getRuntime={async () => null}
      />,
    );
    await screen.findByTestId("agent-panel-unavailable");
    expect(onBridgeReady).toHaveBeenCalledTimes(1);
    // The handed-over bridge is the REAL frozen dispatcher surface: it can
    // dispatch typed actions (routed to the host handlers) and its trace
    // buffer records the evidence rows the acceptance run exports.
    const bridge = seen[0]?.dispatch as {
      dispatch: (action: { action: string }) => Promise<unknown>;
      trace: { export: () => Array<{ action: { action: string } }> };
    };
    const result = (await bridge.dispatch({ action: "toggleAgentPanel" })) as {
      kind: string;
      summary: string;
    };
    expect(result.kind).toBe("ok");
    expect(bridge.trace.export()).toHaveLength(1);
    expect(bridge.trace.export()[0]?.action.action).toBe("toggleAgentPanel");
  });

  it("starts the webflix_ui rendezvous with the admitted services and stops it on unmount", async () => {
    const stops: string[] = [];
    const startRendezvous = vi.fn(
      (deps: { workspacePath: string; bridge: unknown; fileService: unknown }) => {
        expect(deps.workspacePath).toBe("/data/agent-workspace");
        expect(deps.fileService).toBeTruthy();
        expect(deps.bridge).toBeTruthy();
        return {
          stop: () => stops.push("stopped"),
          stats: () => ({ running: false, scannedDirs: 0, dispatched: 0, responded: 0, lastError: null }),
        };
      },
    );
    const runtime = fakeRuntime();
    const { unmount } = render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => runtime}
        loadChatSurface={() => Promise.resolve(createFakeSurfaceModule([]))}
        startRendezvous={startRendezvous as unknown as typeof startWebflixUiActionRendezvous}
      />,
    );
    await waitFor(() => expect(startRendezvous).toHaveBeenCalledTimes(1));
    expect(stops).toHaveLength(0);
    unmount();
    expect(stops).toEqual(["stopped"]);
  });
});

describe("AgentPanel — CSS isolation (freeze §9.4)", () => {
  it("the ZCode theme root classes live on the panel-scoped container, never the document root", async () => {
    expect(document.documentElement.className).toBe("");
    const bodyClassBefore = document.body.className;
    const seenProps: AgentChatSurfaceProps[] = [];
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => fakeRuntime()}
        loadChatSurface={() => Promise.resolve(createFakeSurfaceModule(seenProps))}
      />,
    );
    await screen.findByTestId("agent-fake-chat");
    // The theme classes are INSIDE the panel subtree…
    const themed = document.querySelector(".dark.theme-zai-dark");
    expect(themed).toBeTruthy();
    expect(themed?.getAttribute("data-testid")).toBe("agent-zcode-surface-root");
    // …and the document root / body are UNTOUCHED across the whole mount.
    expect(document.documentElement.className).toBe("");
    expect(document.body.className).toBe(bodyClassBefore);
    expect(AGENT_ZCODE_THEME_ROOT_CLASSNAMES).toEqual(["dark", "theme-zai-dark"]);
    cleanup();
    // Still untouched after unmount.
    expect(document.documentElement.className).toBe("");
  });

  it("the panel chrome itself carries no ZCode theme classes", async () => {
    render(
      <AgentPanel
        workspacePath="/data/agent-workspace"
        onClose={() => {}}
        uiActionHandlers={fakeHandlers()}
        getRuntime={async () => null}
      />,
    );
    await screen.findByTestId("agent-panel-unavailable");
    const root = screen.getByTestId("agent-panel-root");
    expect(root.className.trim()).toBe("");
    expect(document.querySelector(".theme-zai-dark")).toBeNull();
  });
});

describe("AgentPanel — the lazy boundary is structural (source pins)", () => {
  it("AgentPanel.tsx never statically imports @zcode/ui (the media-first shell stays clean)", () => {
    const source = readModuleSource("../AgentPanel.tsx");
    expect(source).not.toMatch(/from "@zcode\/ui/);
    expect(source).not.toMatch(/import "@zcode\/ui/);
    // The only @zcode/ui reachability is the dynamic import of the lazy module.
    expect(source).toMatch(/import\("\.\/agentChatSurface\.js"\)/);
  });

  it("runtimeAdmission.ts pulls zero @zcode/ui code at module scope (lazy registration only)", () => {
    const source = readModuleSource("../runtimeAdmission.ts");
    expect(source).not.toMatch(/from "@zcode\/ui/);
    expect(source).toMatch(/import\("@zcode\/ui"\)/); // the lazy loader inside connect()
  });

  it("the REAL lazy surface module imports the ZCode stylesheet and never touches the document root", () => {
    const source = readModuleSource("../agentChatSurface.tsx");
    // styles.css loads WITH the panel (freeze §9.4 — lazy, panel-scoped).
    expect(source).toContain('import "@zcode/ui/styles.css"');
    // The full provider stack (the closest supported composition).
    for (const provider of ["AppErrorBoundary", "ZCodeIntlProvider", "ServiceProvider", "PlatformProvider", "StoreProvider", "TabStoreProvider", "V4ChatPane"]) {
      expect(source).toContain(provider);
    }
    // The theme classes are applied to the PANEL container via the shared constant.
    expect(source).toContain("AGENT_ZCODE_THEME_ROOT_CLASSNAMES.join");
    // …and the document root is never written programmatically (zcodeBoot's
    // move is deliberately absent — no classList manipulation anywhere; the
    // theme classes ride the JSX className of the panel container only).
    expect(source).not.toMatch(/classList/);
    expect(source).not.toMatch(/document\.body\./);
    expect(source).not.toMatch(/querySelector/);
  });

  it("the shared theme-root constant matches the ZCode boot's theme classes", () => {
    // zcodeBoot.tsx applies `dark` + `theme-zai-dark` for the default Zai dark
    // theme; the panel scopes THE SAME pair to its container.
    const bootSource = readModuleSource("../../zcodeBoot.tsx");
    expect(bootSource).toContain('classList.add("dark")');
    expect(bootSource).toContain('"theme-zai-dark"');
    expect([...AGENT_ZCODE_THEME_ROOT_CLASSNAMES]).toEqual(["dark", "theme-zai-dark"]);
  });
});
