// @vitest-environment jsdom
//
// P6-DURABLE-WEB-1 — the durable persistence COMPONENT tests. The jsdom
// docblock above is mandatory (these tests need a DOM). Each test injects
// a FRESH fake-indexeddb factory through the bootstrap deps — the real
// adapter code paths run against the real test double; nothing global is
// touched.
//
// Pins, honestly:
// - the notice states the ACTUAL active mode: session-only first-run (no
//   "saved" claims), durable when the stored setting says durable (the
//   durable statement, and the session-only statement is ABSENT);
// - the explicit user control: the opt-in writes the setting into IndexedDB
//   itself and flips the notice; the current live ranker selection migrates
//   into durable storage on opt-in (an explicit, stated carry-over);
// - the restore path: a fresh session over the same database re-enters the
//   persisted selection through the REAL resolve use case ("Restored from
//   durable storage");
// - graceful degradation: no IndexedDB → the typed degraded reason surfaces,
//   the control disables, the session-only fallback is stated;
// - the leftover-data honesty line: session-only mode + records from an
//   earlier durable period → the leftover note renders (no "stores nothing"
//   claim while records exist);
// - FORGET (WF-029): Clear durable data wipes both records and resets the
//   host to the first-run session-only default;
// - ZERO web-storage writes: localStorage/sessionStorage setItem is never
//   called during any flow (the runtime complement of the rg evidence gate).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";

import { App } from "../src/App";
import {
  DURABLE_MODE_NOTICE,
  LEFTOVER_DURABLE_NOTE,
  SESSION_ONLY_NOTICE,
  SETTING_FIRST_RUN_NOTE,
  SETTING_STORED_SESSION_ONLY_NOTE,
  bootstrapPersistence,
} from "../src/persistence";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

/** Boots a fresh first-run (session-only) App over a fresh fake IndexedDB. */
async function renderFirstRunApp() {
  const persistence = await bootstrapPersistence({ indexedDB: new IDBFactory() });
  if (persistence.status !== "ok") {
    throw new Error("test bootstrap unexpectedly degraded");
  }
  return { persistence, ...render(<App persistence={persistence} />) };
}

/** Boots an App whose stored setting already says durable. */
async function renderDurableApp() {
  const factory = new IDBFactory();
  const setup = await bootstrapPersistence({ indexedDB: factory });
  if (setup.status !== "ok") throw new Error("setup bootstrap degraded");
  await setup.durable.modeStore.put("durable");
  const persistence = await bootstrapPersistence({ indexedDB: factory });
  if (persistence.status !== "ok") {
    throw new Error("test bootstrap unexpectedly degraded");
  }
  return { factory, persistence };
}

describe("the mode notice states the ACTUAL active mode", () => {
  it("session-only first run: the session-only statement + first-run line, no durable claim", async () => {
    await renderFirstRunApp();
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain(SESSION_ONLY_NOTICE);
    expect(notice.textContent).toContain(SETTING_FIRST_RUN_NOTE);
    expect(notice.textContent).toContain("persistence mode: session-only");
    expect(notice.textContent).not.toContain(DURABLE_MODE_NOTICE);
    expect(notice.textContent).not.toContain("saved to this browser");
  });

  it("durable (stored setting): the durable statement, and the session-only statement is ABSENT", async () => {
    const { persistence } = await renderDurableApp();
    render(<App persistence={persistence} />);
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain(DURABLE_MODE_NOTICE);
    expect(notice.textContent).toContain("persistence mode: durable");
    expect(notice.textContent).not.toContain(SESSION_ONLY_NOTICE);
  });

  it("session-only with a STORED setting: the choice-sticks line (what is stored is said)", async () => {
    const factory = new IDBFactory();
    const setup = await bootstrapPersistence({ indexedDB: factory });
    if (setup.status !== "ok") throw new Error("setup bootstrap degraded");
    await setup.durable.modeStore.put("session-only");
    const persistence = await bootstrapPersistence({ indexedDB: factory });
    render(<App persistence={persistence} />);
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain(SETTING_STORED_SESSION_ONLY_NOTE);
    expect(notice.textContent).toContain("persistence mode: session-only");
  });

  it("session-only with leftover durable data: the leftover note renders (no stores-nothing claim)", async () => {
    const factory = new IDBFactory();
    const setup = await bootstrapPersistence({ indexedDB: factory });
    if (setup.status !== "ok") throw new Error("setup bootstrap degraded");
    await setup.durable.selectionStore.put({
      adapterId: "webflix.built-in-ranker",
      selectedAt: "2026-10-12T12:00:00.000Z",
    });
    // No setting stored → first-run session-only WITH a leftover record.
    const persistence = await bootstrapPersistence({ indexedDB: factory });
    render(<App persistence={persistence} />);
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain(LEFTOVER_DURABLE_NOTE);
    expect(notice.textContent).toContain("persistence mode: session-only");
  });
});

describe("the explicit user control (opt-in / opt-out)", () => {
  it("is a discoverable, enabled select defaulting to session-only", async () => {
    await renderFirstRunApp();
    const control = screen.getByTestId("persistence-mode-control") as HTMLSelectElement;
    expect(control.value).toBe("session-only");
    expect(control.disabled).toBe(false);
    expect(screen.getByTestId("persistence-setting-label").textContent).toBe("Persistence setting");
    expect(screen.getByTestId("clear-durable-data")).toBeDefined();
  });

  it("opts into durable: the setting is WRITTEN to IndexedDB itself and the notice flips", async () => {
    const { persistence } = await renderFirstRunApp();
    fireEvent.change(screen.getByTestId("persistence-mode-control"), {
      target: { value: "durable" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: durable",
      );
    });
    expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
      DURABLE_MODE_NOTICE,
    );
    // The persisted setting itself — read straight from the store.
    const read = await persistence.durable.modeStore.read();
    expect(read.kind).toBe("stored");
    if (read.kind === "stored") {
      expect(read.setting.value).toBe("durable");
    }
  });

  it("carries the CURRENT live selection into durable storage on opt-in (a stated migration)", async () => {
    const { persistence } = await renderFirstRunApp();
    // Select a ranker while session-only (the real selection use case).
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker"));
    await waitFor(() => {
      expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
        "Selected Built-in ranker (v1)",
      );
    });

    fireEvent.change(screen.getByTestId("persistence-mode-control"), {
      target: { value: "durable" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: durable",
      );
    });
    // The migration wrote the live choice into the durable store.
    expect(await persistence.durable.selectionStore.get()).toEqual({
      adapterId: "webflix.built-in-ranker",
      selectedAt: expect.any(String),
    });
    // And the status note rewords to the TRUE durable claim.
    expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
      "saved to this browser's durable storage",
    );
  });

  it("opts back out to session-only: the choice persists, new saves stop, the note rewords", async () => {
    const { persistence } = await renderDurableApp();
    render(<App persistence={persistence} />);

    fireEvent.change(screen.getByTestId("persistence-mode-control"), {
      target: { value: "session-only" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: session-only",
      );
    });
    expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
      SETTING_STORED_SESSION_ONLY_NOTE,
    );
    const read = await persistence.durable.modeStore.read();
    expect(read.kind).toBe("stored");
    if (read.kind === "stored") {
      expect(read.setting.value).toBe("session-only");
    }
  });
});

describe("the durable restore path (the visible benefit, honestly worded)", () => {
  it("re-enters the persisted selection in a FRESH session over the same database", async () => {
    const { factory } = await renderDurableApp();
    // The earlier durable period saved a selection.
    const setup = await bootstrapPersistence({ indexedDB: factory });
    if (setup.status !== "ok") throw new Error("setup bootstrap degraded");
    await setup.durable.selectionStore.put({
      adapterId: "webflix.built-in-ranker",
      selectedAt: "2026-10-12T12:00:00.000Z",
    });

    // A brand-new session (fresh bootstrap + fresh App) over the same DB.
    const persistence = await bootstrapPersistence({ indexedDB: factory });
    render(<App persistence={persistence} />);
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    await waitFor(() => {
      expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
        "Restored from durable storage",
      );
    });
    expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
      "Selected Built-in ranker (v1)",
    );
  });
});

describe("graceful degradation (typed, surfaced)", () => {
  it("no IndexedDB: the reason surfaces, the control disables, session-only is stated", async () => {
    const persistence = await bootstrapPersistence({ indexedDB: undefined });
    render(<App persistence={persistence} />);
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain("Durable storage is unavailable in this browser");
    expect(notice.textContent).toContain("IndexedDB is not available");
    expect(notice.textContent).toContain("persistence mode: session-only");
    expect((screen.getByTestId("persistence-mode-control") as HTMLSelectElement).disabled).toBe(
      true,
    );
    // No clear control when nothing durable can exist.
    expect(screen.queryByTestId("clear-durable-data")).toBeNull();
  });
});

describe("forget (the WF-029 retention control)", () => {
  it("clears both records and resets to the first-run session-only default", async () => {
    const { persistence } = await renderDurableApp();
    // Save a selection too (durable mode active).
    await persistence.durable.selectionStore.put({
      adapterId: "webflix.built-in-ranker",
      selectedAt: "2026-10-12T12:00:00.000Z",
    });
    render(<App persistence={persistence} />);
    // The selector's status note lives on the evaluation screen.
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    await waitFor(() => {
      expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
        "Restored from durable storage",
      );
    });

    fireEvent.click(screen.getByTestId("clear-durable-data"));
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: session-only",
      );
    });
    expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
      SETTING_FIRST_RUN_NOTE,
    );
    expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
      "Durable data cleared",
    );
    // Both stores are actually empty — read straight from the seam.
    expect(await persistence.durable.selectionStore.get()).toBeNull();
    const read = await persistence.durable.modeStore.read();
    expect(read.kind).toBe("first-run");
  });
});

describe("web-storage honesty (the runtime complement of the rg gate)", () => {
  it("never writes localStorage or sessionStorage during the persistence flows", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { persistence } = await renderFirstRunApp();

    // The full flow: opt in, select a ranker, opt out, clear.
    fireEvent.change(screen.getByTestId("persistence-mode-control"), {
      target: { value: "durable" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: durable",
      );
    });
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker"));
    await waitFor(() => {
      expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
        "saved to this browser's durable storage",
      );
    });
    fireEvent.change(screen.getByTestId("persistence-mode-control"), {
      target: { value: "session-only" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("persistence-mode-notice").textContent).toContain(
        "persistence mode: session-only",
      );
    });
    fireEvent.click(screen.getByTestId("clear-durable-data"));
    await waitFor(() => {
      expect(screen.getByTestId("ranker-selector-status").textContent).toContain(
        "Durable data cleared",
      );
    });

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(await persistence.durable.selectionStore.get()).toBeNull();
    setItemSpy.mockRestore();
  });
});
