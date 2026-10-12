// @vitest-environment jsdom
//
// P6-PWA-1 — the install affordance component tests. The jsdom docblock
// above is mandatory (the app-local vitest.config.ts defaults to the node
// environment; these tests need a DOM). Run from the app:
// pnpm --filter web-client test
//
// Pins, honestly:
// - the affordance renders ALWAYS (visible control + the pinned claim,
//   byte-exact — the work order's string, never a paraphrase);
// - with NO deferred install prompt (the honest default in this test
//   context), clicking states that fact plainly — a no-op is honest, a
//   simulated install is not;
// - a beforeinstallprompt event is captured (preventDefault called per
//   the platform contract) and the click then opens the prompt, with the
//   outcome line reporting the browser's answer verbatim;
// - NO network, NO telemetry (the event + the prompt are browser APIs).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { InstallAffordance, INSTALL_CLAIM } from "../src/install-affordance";

afterEach(cleanup);

describe("P6-PWA-1 — the install affordance", () => {
  it("renders the visible control with the EXACT pinned claim", () => {
    render(<InstallAffordance />);
    expect(screen.getByTestId("install-affordance-button")).toBeTruthy();
    const claim = screen.getByTestId("install-claim");
    expect(claim.textContent).toBe(INSTALL_CLAIM);
    expect(INSTALL_CLAIM).toBe(
      "install the app shell — media and catalog need a session; nothing but the shell works offline",
    );
  });

  it("clicking with NO deferred prompt states the honest no-op (never a simulated install)", () => {
    render(<InstallAffordance />);
    fireEvent.click(screen.getByTestId("install-affordance-button"));
    const status = screen.getByTestId("install-status");
    expect(status.textContent).toBe("the browser has not offered installation for this context");
    // No prompt was fabricated: still no status beyond the honest line.
    expect(screen.queryByTestId("install-affordance-button")).toBeTruthy();
  });

  it("captures a beforeinstallprompt event (preventDefault per the platform contract) and prompts on click", () => {
    let captured: ((event: Event) => void) | undefined;
    const addSpy = vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
      if (type === "beforeinstallprompt") {
        captured = listener as (event: Event) => void;
      }
    });
    render(<InstallAffordance />);
    addSpy.mockRestore();
    expect(captured).toBeDefined();

    const deferred = new Event("beforeinstallprompt");
    const prompt = vi.fn(() => Promise.resolve());
    const userChoice = Promise.resolve({ outcome: "accepted" as const });
    Object.assign(deferred, { prompt, userChoice });
    const preventDefault = vi.fn();
    deferred.preventDefault = preventDefault;

    // Flush the listener's state update in its own act FIRST, so the
    // re-render lands and the click's handler sees the captured prompt.
    act(() => {
      captured!(deferred);
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.click(screen.getByTestId("install-affordance-button"));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
