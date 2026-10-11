// @vitest-environment jsdom
//
// RankerAdapterSelector component tests (P4-ADAPTERS row 3).
// The jsdom docblock above is mandatory: the package-local vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - single-option render of the registry truth (label, description,
//   capabilities, the raw id — verbatim, no invented copy);
// - the factual "more adapters arrive with later Phase-4 orders" note and
//   the available-today count;
// - the selection event (onSelectionChange fires with the selected id);
// - the stored-selection state model (null = never-set = NOTHING checked,
//   distinctly honest from a checked explicit choice);
// - the optional status note (rendered verbatim when provided, absent when
//   not — nothing is invented);
// - keyboard operability (native radio in a named group, focusable);
// - NO network (fetch untouched), NO telemetry (console untouched).

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RankerAdapterSelector } from "../src/components/RankerAdapterSelector";
import type { RankerAdapterDescriptor } from "webflix-application";
import { BUILT_IN_RANKER_V1_ENTRY } from "webflix-application";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures ----------

const builtInDescriptor: RankerAdapterDescriptor = {
  id: "webflix.built-in-ranker",
  label: "Built-in ranker (v1)",
  description:
    "WebFlix's own deterministic ranking policy v1: local signals only (library, watch history, explicit feedback, objectives), fixed weights, and a reason with evidence on every recommendation.",
  capabilities: ["deterministic", "local", "reasons-mandatory"],
};

const onChange = vi.fn();

interface SelectorOverrides {
  entries?: readonly RankerAdapterDescriptor[];
  selectedAdapterId?: string | null;
  statusNote?: string | null;
}

function renderSelector(overrides: SelectorOverrides = {}) {
  const { entries = [builtInDescriptor], selectedAdapterId = null, statusNote = null } = overrides;
  return render(
    <RankerAdapterSelector
      entries={entries}
      selectedAdapterId={selectedAdapterId}
      onSelectionChange={onChange}
      statusNote={statusNote}
    />,
  );
}

describe("RankerAdapterSelector", () => {
  it("renders the single registry option truthfully — label, description, capabilities and raw id, verbatim", () => {
    renderSelector();
    const option = screen.getByTestId("ranker-option-webflix.built-in-ranker");
    expect(option.textContent).toContain("Built-in ranker (v1)");
    expect(option.textContent).toContain("deterministic ranking policy v1");
    expect(screen.getByTestId("ranker-option-caps-webflix.built-in-ranker").textContent).toBe(
      "deterministic · local · reasons-mandatory",
    );
    expect(option.textContent).toContain("webflix.built-in-ranker");
    // Exactly ONE option — no fake entries, no placeholder rows.
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("renders the REAL seeded registry entry from webflix-application (continuity with the default registry)", () => {
    render(
      <RankerAdapterSelector
        entries={[BUILT_IN_RANKER_V1_ENTRY]}
        selectedAdapterId={null}
        onSelectionChange={onChange}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByTestId("ranker-option-webflix.built-in-ranker").textContent).toContain(
      "Built-in ranker (v1)",
    );
    expect(screen.getByTestId("ranker-option-desc-webflix.built-in-ranker").textContent).toBe(
      BUILT_IN_RANKER_V1_ENTRY.description,
    );
  });

  it("carries the factual availability note — the count today and the Phase-4 roadmap fact, never a promise", () => {
    renderSelector();
    const note = screen.getByTestId("ranker-selector-note");
    expect(note.textContent).toBe(
      "1 adapter available today. More adapters arrive with later Phase-4 orders.",
    );
  });

  it("no selection set => NOTHING is checked (never-set is visibly distinct from a stored choice)", () => {
    renderSelector({ selectedAdapterId: null });
    const radio = screen.getByTestId(
      "ranker-option-input-webflix.built-in-ranker",
    ) as HTMLInputElement;
    expect(radio.checked).toBe(false);
  });

  it("a stored selection renders that option checked", () => {
    renderSelector({ selectedAdapterId: "webflix.built-in-ranker" });
    const radio = screen.getByTestId(
      "ranker-option-input-webflix.built-in-ranker",
    ) as HTMLInputElement;
    expect(radio.checked).toBe(true);
  });

  it("selecting the option fires onSelectionChange with the selected id", () => {
    onChange.mockClear();
    renderSelector({ selectedAdapterId: null });
    fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("webflix.built-in-ranker");
  });

  it("statusNote renders verbatim when provided (the honest default/fallback surface)", () => {
    const { rerender } = renderSelector({
      statusNote:
        "No ranker adapter is selected — the documented default (the built-in deterministic ranker v1) is active.",
    });
    expect(screen.getByTestId("ranker-selector-status").textContent).toBe(
      "No ranker adapter is selected — the documented default (the built-in deterministic ranker v1) is active.",
    );

    rerender(
      <RankerAdapterSelector
        entries={[builtInDescriptor]}
        selectedAdapterId={null}
        onSelectionChange={onChange}
        statusNote={null}
      />,
    );
    expect(screen.queryByTestId("ranker-selector-status")).toBeNull();
  });

  it("keyboard operability: native radios in one named group, focusable, aria-labelled", () => {
    renderSelector({ selectedAdapterId: null });
    const radio = screen.getByTestId(
      "ranker-option-input-webflix.built-in-ranker",
    ) as HTMLInputElement;
    expect(radio.type).toBe("radio");
    expect(radio.getAttribute("name")).toBe("webflix-ranker-adapter");
    // Accessible name resolves through the explicit label association.
    expect(screen.getByRole("radio", { name: "Built-in ranker (v1)" })).toBe(radio);
    // The description is programmatically associated.
    expect(radio.getAttribute("aria-describedby")).toContain(
      "ranker-adapter-option-webflix.built-in-ranker-description",
    );
    // Focus works — the control is keyboard-reachable.
    radio.focus();
    expect(document.activeElement).toBe(radio);
  });

  it("an empty entries list renders the honest empty state — zero radios, zero placeholders", () => {
    renderSelector({ entries: [] });
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByTestId("ranker-selector-empty").textContent).toBe(
      "No ranker adapters are available.",
    );
    // The note still counts honestly.
    expect(screen.getByTestId("ranker-selector-note").textContent).toContain(
      "0 adapters available today",
    );
  });

  it("renders and selects with NO network and NO telemetry (fetch and console untouched)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockReturnValue(undefined as never);
    const consoleSpy = vi.spyOn(console, "log");
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    try {
      onChange.mockClear();
      renderSelector({ selectedAdapterId: null });
      fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker"));
      expect(onChange).toHaveBeenCalledWith("webflix.built-in-ranker");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(consoleInfo).not.toHaveBeenCalled();
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      consoleSpy.mockRestore();
      consoleInfo.mockRestore();
      consoleWarn.mockRestore();
    }
  });
});
