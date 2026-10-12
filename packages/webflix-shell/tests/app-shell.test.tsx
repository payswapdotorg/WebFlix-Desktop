// @vitest-environment jsdom
//
// AppShell geometry tests (P6-SHELL-RESPONSIVE-1 — the shell's own
// responsive pass). The jsdom docblock above is mandatory: the package-local
// vitest.config.ts defaults to the node environment, and these tests need a
// DOM. Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly (style-props rendered to the DOM — computed-layout
// verification stays the device-emulated audit harness's job, in
// apps/web-client):
// - the primary nav is a WRAPPING container (flexWrap: "wrap" — the shell
//   sets it inline now; the host no longer composes it);
// - every nav button carries minHeight 44 (the touch-target bar);
// - the search form's input + submit carry minHeight 44;
// - the ranker option labels carry minHeight 44.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AppShell, NAV_ITEMS } from "../src/index";
import type { RankerAdapterDescriptor } from "webflix-application";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures (verbatim shape from the composition suite) ----------

const BUILT_IN_ADAPTER: RankerAdapterDescriptor = {
  id: "webflix.built-in-ranker",
  label: "Built-in ranker (v1)",
  description: "WebFlix's own deterministic ranking policy v1.",
  capabilities: ["deterministic", "local", "reasons-mandatory"],
};

describe("P6-SHELL-RESPONSIVE-1 — the shell's own geometry guarantee", () => {
  it("the primary nav renders a wrapping container (flexWrap wrap)", () => {
    render(<AppShell />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.style.flexWrap).toBe("wrap");
  });

  it("every nav button meets the 44px touch-target bar", () => {
    render(<AppShell />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const buttons = nav.querySelectorAll("button");
    expect(buttons).toHaveLength(NAV_ITEMS.length);
    buttons.forEach((button) => {
      expect(button.style.minHeight).toBe("44px");
    });
  });

  it("the search form's input and submit meet the 44px touch-target bar", () => {
    render(<AppShell initialScreen="search" />);
    const search = screen.getByRole("region", { name: "Search" });
    const input = search.querySelector<HTMLInputElement>('input[type="search"]');
    const submit = search.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(input).not.toBeNull();
    expect(submit).not.toBeNull();
    expect(input!.style.minHeight).toBe("44px");
    expect(submit!.style.minHeight).toBe("44px");
  });

  it("ranker option labels meet the 44px touch-target bar", () => {
    render(
      <AppShell initialScreen="evaluation" rankerAdapterEntries={[BUILT_IN_ADAPTER]} />,
    );
    const labels = document.querySelectorAll('label[for^="ranker-adapter-option-"]');
    expect(labels.length).toBeGreaterThan(0);
    labels.forEach((label) => {
      expect(label.style.minHeight).toBe("44px");
    });
  });
});
