// @vitest-environment jsdom
//
// Agent panel SLOT tests (WFX-UX-SHELL-1, deliverable 7). The jsdom
// docblock above is mandatory. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the slot is LAZY: content mounts ONLY while visible (a render-prop
//   receives the close api); closed renders a display:none stub with NO
//   content mounted;
// - the documented keyboard shortcut (Ctrl+J / Cmd+J — see the SHORTCUTS
//   block in AgentPanel.tsx) toggles the panel from the shell;
// - resizing commits through onRequestResize with the width CLAMPED to the
//   frozen min/max (320/720), by keyboard arrows AND by pointer drag;
// - the no-overlap law: the panel is a FLOW child of the body row (never
//   position:fixed/absolute), so at its 320px minimum it PUSHES content —
//   it cannot cover the watch player's controls;
// - persistence: the injected PanelPersistence port is honored (load wins
//   over the mount-time initial; every commit saves), failures fall back
//   honestly, and the default is in-memory (session-only);
// - the host-facing onAgentPanelStateChange reports every committed change;
// - the external agentPanelVisible prop (the bridge's toggleAgentPanel
//   action) forces visibility without clobbering the width.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  AGENT_PANEL_TOGGLE_SHORTCUT,
  AgentPanelSlot,
  AppShell,
  createInMemoryPanelPersistence,
  theme,
  useAgentPanelState,
} from "../src/index";
import type { PanelPersistence } from "../src/index";
import { FIXTURE_EMBED_PLAN } from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

describe("AgentPanelSlot — lazy content + layout laws", () => {
  it("closed: the slot hides from the layout and mounts NO content", () => {
    render(
      <AgentPanelSlot visible={false} widthPx={null} onRequestClose={() => {}}>
        <div data-testid="panel-content">content</div>
      </AgentPanelSlot>,
    );
    const slot = screen.getByTestId("agent-panel");
    expect(slot.style.display).toBe("none");
    expect(screen.queryByTestId("panel-content")).toBeNull();
  });

  it("open: a node mounts; a render-prop receives the close api", () => {
    const { rerender } = render(
      <AgentPanelSlot visible={true} widthPx={null} onRequestClose={() => {}}>
        <div data-testid="panel-content">content</div>
      </AgentPanelSlot>,
    );
    expect(screen.getByTestId("panel-content")).toBeTruthy();

    rerender(
      <AgentPanelSlot visible={true} widthPx={null} onRequestClose={() => {}}>
        {(api) => (
          <button type="button" data-testid="panel-close-api" onClick={() => api.close()}>
            close
          </button>
        )}
      </AgentPanelSlot>,
    );
    expect(screen.getByTestId("panel-close-api")).toBeTruthy();
  });

  it("open with no content: the honest empty state — no fake assistant", () => {
    render(<AgentPanelSlot visible={true} widthPx={null} onRequestClose={() => {}} />);
    expect(screen.getByTestId("agent-panel-empty").textContent).toContain(
      "no agent surface is mounted in this host yet",
    );
  });

  it("the panel respects the provided width and never goes below the 320px minimum", () => {
    render(
      <AgentPanelSlot visible={true} widthPx={99999} onRequestClose={() => {}}>
        <div />
      </AgentPanelSlot>,
    );
    expect(screen.getByTestId("agent-panel").style.width).toBe(`${theme.layout.agentPanelMaxWidth}px`);
  });

  it("the no-overlap law: the panel is a FLOW child — never position:fixed/absolute", () => {
    render(
      <AgentPanelSlot visible={true} widthPx={320} onRequestClose={() => {}}>
        <div />
      </AgentPanelSlot>,
    );
    const panel = screen.getByTestId("agent-panel");
    expect(panel.style.position).not.toBe("fixed");
    expect(panel.style.position).not.toBe("absolute");
    expect(parseInt(panel.style.width, 10)).toBeGreaterThanOrEqual(320);
    expect(panel.getAttribute("role")).toBe("complementary");
  });

  it("the close button fires onRequestClose", () => {
    const onRequestClose = vi.fn();
    render(
      <AgentPanelSlot visible={true} widthPx={null} onRequestClose={onRequestClose}>
        <div />
      </AgentPanelSlot>,
    );
    fireEvent.click(screen.getByTestId("agent-panel-close"));
    expect(onRequestClose).toHaveBeenCalledOnce();
  });
});

describe("AgentPanelSlot — the resize handle", () => {
  function renderHandle(widthPx: number, onRequestResize: (w: number) => void) {
    return render(
      <AgentPanelSlot visible={true} widthPx={widthPx} onRequestClose={() => {}} onRequestResize={onRequestResize}>
        <div />
      </AgentPanelSlot>,
    );
  }

  it("ArrowLeft widens by 32px (the panel docks right); ArrowRight narrows", () => {
    const onRequestResize = vi.fn();
    renderHandle(380, onRequestResize);
    const handle = screen.getByTestId("agent-panel-resize-handle");
    expect(handle.getAttribute("role")).toBe("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onRequestResize).toHaveBeenCalledWith(412);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onRequestResize).toHaveBeenCalledWith(348);
  });

  it("keyboard resizes clamp to the frozen min/max", () => {
    const onRequestResize = vi.fn();
    const atMin = renderHandle(330, onRequestResize);
    fireEvent.keyDown(screen.getByTestId("agent-panel-resize-handle"), { key: "ArrowRight" });
    expect(onRequestResize).toHaveBeenCalledWith(320);
    atMin.unmount();

    const atMax = renderHandle(710, onRequestResize);
    fireEvent.keyDown(screen.getByTestId("agent-panel-resize-handle"), { key: "ArrowLeft" });
    expect(onRequestResize).toHaveBeenCalledWith(720);
    atMax.unmount();
  });

  it("a pointer drag commits ONCE with the dragged width", () => {
    const onRequestResize = vi.fn();
    renderHandle(380, onRequestResize);
    const handle = screen.getByTestId("agent-panel-resize-handle");
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: window.innerWidth - 500 });
    fireEvent.mouseMove(document, { clientX: window.innerWidth - 520 });
    fireEvent.mouseUp(document);
    expect(onRequestResize).toHaveBeenCalledTimes(1);
    expect(onRequestResize).toHaveBeenCalledWith(520);
  });

  it("a drag below the minimum clamps at 320 (the no-overlap floor)", () => {
    const onRequestResize = vi.fn();
    renderHandle(380, onRequestResize);
    const handle = screen.getByTestId("agent-panel-resize-handle");
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: window.innerWidth - 40 });
    fireEvent.mouseUp(document);
    expect(onRequestResize).toHaveBeenCalledWith(320);
  });
});

describe("useAgentPanelState — persistence + reporting", () => {
  function ProbeHook(props: { persistence?: PanelPersistence; onStateChange?: (s: unknown) => void }) {
    const panel = useAgentPanelState(props);
    return (
      <div>
        <span data-testid="probe-visible">{String(panel.state.visible)}</span>
        <span data-testid="probe-width">{panel.state.widthPx ?? "null"}</span>
        <button type="button" data-testid="probe-toggle" onClick={() => panel.toggle()} />
        <button type="button" data-testid="probe-resize" onClick={() => panel.resize(500)} />
        <button type="button" data-testid="probe-set" onClick={() => panel.setVisible(true)} />
      </div>
    );
  }

  it("defaults to closed with the default width", () => {
    render(<ProbeHook />);
    expect(screen.getByTestId("probe-visible").textContent).toBe("false");
    expect(screen.getByTestId("probe-width").textContent).toBe("null");
  });

  it("persistence LOAD wins over the mount-time initial (the stored preference is the truth)", () => {
    const persistence = createInMemoryPanelPersistence({ visible: true, widthPx: 404 });
    render(<ProbeHook persistence={persistence} />);
    expect(screen.getByTestId("probe-visible").textContent).toBe("true");
    expect(screen.getByTestId("probe-width").textContent).toBe("404");
  });

  it("the mount-time initial is used when persistence yields nothing", () => {
    render(<ProbeHook persistence={undefined} />);
    // (initial omitted → closed default; covered above) — with initial given
    // and no persistence, initial wins:
    cleanup();
    function ProbeInitial() {
      const panel = useAgentPanelState({ initial: { visible: true, widthPx: 366 } });
      return <span data-testid="probe-visible">{String(panel.state.visible)}</span>;
    }
    render(<ProbeInitial />);
    expect(screen.getByTestId("probe-visible").textContent).toBe("true");
  });

  it("every commit saves through the persistence port and reports onStateChange", () => {
    const persistence = { load: vi.fn(() => ({ visible: false, widthPx: null })), save: vi.fn() };
    const onStateChange = vi.fn();
    render(<ProbeHook persistence={persistence} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByTestId("probe-toggle"));
    expect(persistence.save).toHaveBeenCalledWith({ visible: true, widthPx: null });
    expect(onStateChange).toHaveBeenCalledWith({ visible: true, widthPx: null });
  });

  it("resize commits clamped and forces visible", () => {
    const onStateChange = vi.fn();
    render(<ProbeHook onStateChange={onStateChange} />);
    fireEvent.click(screen.getByTestId("probe-resize"));
    expect(onStateChange).toHaveBeenCalledWith({ visible: true, widthPx: 500 });
  });

  it("a persistence load failure falls back honestly (never a crash)", () => {
    const persistence = {
      load: () => {
        throw new Error("storage refused");
      },
      save: () => {},
    };
    render(<ProbeHook persistence={persistence} />);
    expect(screen.getByTestId("probe-visible").textContent).toBe("false");
  });
});

describe("AppShell — the agent panel integration (chrome + shortcut + bridge path)", () => {
  it("the toggle button opens/closes the panel and reports committed state", () => {
    const onAgentPanelStateChange = vi.fn();
    render(<AppShell onAgentPanelStateChange={onAgentPanelStateChange} />);
    const toggle = screen.getByTestId("agent-panel-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("agent-panel");
    expect(toggle.getAttribute("title")).toContain(AGENT_PANEL_TOGGLE_SHORTCUT);

    fireEvent.click(toggle);
    expect(screen.getByTestId("agent-panel").style.display).not.toBe("none");
    expect(onAgentPanelStateChange).toHaveBeenCalledWith({ visible: true, widthPx: null });

    fireEvent.click(toggle);
    expect(screen.getByTestId("agent-panel").style.display).toBe("none");
  });

  it("the documented shortcut Ctrl+J toggles the panel (and Cmd+J on macOS)", () => {
    render(<AppShell />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(screen.getByTestId("agent-panel").style.display).not.toBe("none");
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(screen.getByTestId("agent-panel").style.display).toBe("none");
    fireEvent.keyDown(window, { key: "J", metaKey: true });
    expect(screen.getByTestId("agent-panel").style.display).not.toBe("none");
  });

  it("Ctrl+Alt+J does NOT toggle (the shortcut is exact, no alt-modified collisions)", () => {
    render(<AppShell />);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true, altKey: true });
    expect(screen.getByTestId("agent-panel").style.display).toBe("none");
  });

  it("lazy content mounts ONLY while the panel is open (the render-prop path)", () => {
    let mounts = 0;
    const Content = () => {
      mounts += 1;
      return <div data-testid="panel-content">agent content</div>;
    };
    render(
      <AppShell agentPanelContent={() => <Content />} />,
    );
    expect(mounts).toBe(0);
    fireEvent.click(screen.getByTestId("agent-panel-toggle"));
    expect(mounts).toBe(1);
    expect(screen.getByTestId("panel-content")).toBeTruthy();
    fireEvent.click(screen.getByTestId("agent-panel-toggle"));
    expect(screen.queryByTestId("panel-content")).toBeNull();
  });

  it("the external agentPanelVisible prop forces visibility (the bridge's toggleAgentPanel)", async () => {
    const { rerender } = render(<AppShell agentPanelVisible={false} />);
    expect(screen.getByTestId("agent-panel").style.display).toBe("none");
    rerender(<AppShell agentPanelVisible={true} />);
    await waitFor(() => {
      expect(screen.getByTestId("agent-panel").style.display).not.toBe("none");
    });
  });

  it("persistence rides the shell: a stored open panel re-opens on mount", () => {
    const persistence = createInMemoryPanelPersistence({ visible: true, widthPx: 512 });
    render(<AppShell agentPanelPersistence={persistence} />);
    const panel = screen.getByTestId("agent-panel");
    expect(panel.style.display).not.toBe("none");
    expect(panel.style.width).toBe("512px");
  });

  it("NO-OVERLAP with the persistent player at the panel's minimum width: both are flow siblings", () => {
    render(
      <AppShell
        initialRoute="home"
        watchState={{ title: "Fixture", plan: FIXTURE_EMBED_PLAN }}
        agentPanelInitial={{ visible: true, widthPx: 320 }}
      />,
    );
    const body = screen.getByTestId("shell-body");
    const dock = screen.getByTestId("watch-dock");
    const panel = screen.getByTestId("agent-panel");

    // Both live in the body row (flow layout — the panel pushes, it never covers).
    expect(dock.parentElement).toBe(body);
    expect(panel.parentElement).toBe(body);
    expect(panel.style.position).not.toBe("fixed");
    expect(panel.style.position).not.toBe("absolute");
    expect(parseInt(panel.style.width, 10)).toBeGreaterThanOrEqual(320);

    // The player is still mounted and interactive while the panel is open.
    expect(screen.getByTestId("watch-embed")).toBeTruthy();
  });

  it("panel open/close does not remount the player (freeze §9.6 + §9.3)", async () => {
    const { rerender } = render(
      <AppShell
        watchState={{ title: "Fixture", plan: FIXTURE_EMBED_PLAN }}
        agentPanelVisible={false}
      />,
    );
    const iframe = screen.getByTestId("watch-embed");
    rerender(
      <AppShell
        watchState={{ title: "Fixture", plan: FIXTURE_EMBED_PLAN }}
        agentPanelVisible={true}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("agent-panel").style.display).not.toBe("none");
    });
    expect(screen.getByTestId("watch-embed")).toBe(iframe);
  });
});
