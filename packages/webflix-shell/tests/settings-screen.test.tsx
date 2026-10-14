// @vitest-environment jsdom
//
// SettingsScreen retention-surface tests (P7-COMPOSE-1 — the WF-021 surface
// half, mounting the MERGED P7-RETENTION-1 view models AS-IS). The jsdom
// docblock above is mandatory: the package-local vitest.config.ts defaults
// to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the surface composes from the RetentionState view model PASSED IN
//   (GetRetentionState's output shape): pause status, the never-set state
//   surfaced DISTINCTLY, the three local record counts, and the boundary
//   table rendered verbatim;
// - pause/resume buttons render ONLY with a real wired handler — no dead
//   buttons, ever;
// - a scoped reset ALWAYS takes two explicit steps: selecting a scope arms
//   a confirm panel that states exactly what the scope clears (from the
//   boundary table AS DATA) and what it never touches — one click never
//   deletes; the confirm fires onResetLocalData with the chosen scope;
// - `all` is stated as the UNION of the three local scopes, never
//   "everything on disk";
// - the ResetLocalDataResult renders verbatim: removed counts, untouched
//   scopes, and the provider-owned classes named as NOT deleted here;
// - FIXTURE-ONLY: the boundary fixture reuses the engine's own fixed
//   DATA_BOUNDARY_DESCRIPTIONS table (a declared shell dependency) for the
//   rendering pins, and a minimal local table for the scope-coverage logic;
//   no stores, no network, no clock — the surface renders what it is handed.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SettingsScreen } from "../src/index";
import { DATA_BOUNDARY_DESCRIPTIONS } from "webflix-application";
import type { RetentionState, ResetLocalDataResult } from "webflix-application";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures ----------

const ISO = "2026-10-15T09:30:00Z";

const NEVER_SET_STATE: RetentionState = {
  historyTrackingPaused: false,
  preferenceUpdatedAt: null,
  preferenceNeverSet: true,
  localRecordCounts: { history: 2, progress: 0, feedback: 5 },
  boundaries: DATA_BOUNDARY_DESCRIPTIONS,
};

const PAUSED_STATE: RetentionState = {
  historyTrackingPaused: true,
  preferenceUpdatedAt: ISO,
  preferenceNeverSet: false,
  localRecordCounts: { history: 2, progress: 0, feedback: 5 },
  boundaries: DATA_BOUNDARY_DESCRIPTIONS,
};

/** A minimal local boundary table for the scope-coverage pins (3 classes). */
const MINIMAL_BOUNDARIES = DATA_BOUNDARY_DESCRIPTIONS.filter((row) =>
  ["watch-history", "playback-progress", "feedback-events", "provider-account"].includes(
    row.recordClass,
  ),
);

const MINIMAL_STATE: RetentionState = {
  ...NEVER_SET_STATE,
  boundaries: MINIMAL_BOUNDARIES,
};

const ALL_RESET_RESULT: ResetLocalDataResult = {
  scope: "all",
  removed: { history: 2, progress: 0, feedback: 5 },
  untouchedLocalScopes: [],
  providerOwnedRecordClassesNotDeletableHere: [
    "provider-account",
    "provider-catalog",
    "provider-watch-history",
  ],
};

const HISTORY_RESET_RESULT: ResetLocalDataResult = {
  scope: "history",
  removed: { history: 2, progress: 0, feedback: 0 },
  untouchedLocalScopes: ["progress", "feedback"],
  providerOwnedRecordClassesNotDeletableHere: [
    "provider-account",
    "provider-catalog",
    "provider-watch-history",
  ],
};

// ---------- the tracking pause/resume control ----------

describe("SettingsScreen: history tracking (pause/resume)", () => {
  it("renders the honest not-loaded state when no retention state is passed", () => {
    render(<SettingsScreen />);
    expect(screen.getByTestId("retention-tracking-empty").textContent).toContain(
      "Retention state has not been loaded yet",
    );
    expect(screen.getByTestId("retention-boundaries-empty").textContent).toContain(
      "loads with the retention state",
    );
    // No pause/resume buttons without state AND handlers — never dead.
    expect(screen.queryByTestId("retention-tracking-pause")).toBeNull();
    expect(screen.queryByTestId("retention-tracking-resume")).toBeNull();
  });

  it("never-set renders tracking ACTIVE with the DISTINCT never-set statement", () => {
    render(<SettingsScreen retentionState={NEVER_SET_STATE} />);
    expect(screen.getByTestId("retention-tracking-status").textContent).toBe(
      "History tracking is ACTIVE",
    );
    expect(screen.getByTestId("retention-tracking-neverset").textContent).toContain(
      "No preference has been set yet",
    );
    expect(screen.queryByTestId("retention-tracking-updated")).toBeNull();
  });

  it("an explicit paused preference renders PAUSED with its stamp", () => {
    render(<SettingsScreen retentionState={PAUSED_STATE} />);
    expect(screen.getByTestId("retention-tracking-status").textContent).toBe(
      "History tracking is PAUSED",
    );
    expect(screen.queryByTestId("retention-tracking-neverset")).toBeNull();
    expect(screen.getByTestId("retention-tracking-updated").textContent).toContain(ISO);
  });

  it("the pause control fires the wired handler only when tracking is active", () => {
    const onPauseHistoryTracking = vi.fn();
    render(
      <SettingsScreen
        retentionState={NEVER_SET_STATE}
        onPauseHistoryTracking={onPauseHistoryTracking}
      />,
    );
    fireEvent.click(screen.getByTestId("retention-tracking-pause"));
    expect(onPauseHistoryTracking).toHaveBeenCalledTimes(1);
  });

  it("the resume control fires the wired handler when paused", () => {
    const onResumeHistoryTracking = vi.fn();
    render(
      <SettingsScreen
        retentionState={PAUSED_STATE}
        onResumeHistoryTracking={onResumeHistoryTracking}
      />,
    );
    fireEvent.click(screen.getByTestId("retention-tracking-resume"));
    expect(onResumeHistoryTracking).toHaveBeenCalledTimes(1);
  });

  it("no dead buttons: without handlers, neither action control renders", () => {
    render(<SettingsScreen retentionState={PAUSED_STATE} />);
    expect(screen.queryByTestId("retention-tracking-pause")).toBeNull();
    expect(screen.queryByTestId("retention-tracking-resume")).toBeNull();
  });
});

// ---------- the scoped reset (select → read → confirm) ----------

describe("SettingsScreen: scoped reset with the confirm step", () => {
  it("the local record counts render when the state is loaded", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} />);
    expect(screen.getByTestId("retention-reset-counts").textContent).toContain("history: 2");
    expect(screen.getByTestId("retention-reset-counts").textContent).toContain("progress: 0");
    expect(screen.getByTestId("retention-reset-counts").textContent).toContain("feedback: 5");
  });

  it("one click NEVER deletes: the confirm panel appears only after selecting a scope", () => {
    const onResetLocalData = vi.fn();
    render(<SettingsScreen retentionState={MINIMAL_STATE} onResetLocalData={onResetLocalData} />);
    expect(screen.queryByTestId("retention-reset-confirm")).toBeNull();
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-history"));
    expect(screen.getByTestId("retention-reset-confirm")).toBeTruthy();
    expect(onResetLocalData).not.toHaveBeenCalled();
  });

  it("the confirm panel states exactly what the history scope clears and what it never touches", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} />);
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-history"));
    const confirm = screen.getByTestId("retention-reset-confirm");
    expect(confirm.textContent).toContain("This will delete: watch-history");
    expect(confirm.textContent).not.toContain("playback-progress");
    expect(confirm.textContent).toContain("Never deletable from WebFlix: provider-account");
    expect(confirm.textContent).toContain(
      "the local library, objectives, derived artifacts and cached provider field sets",
    );
  });

  it("the `all` scope states the UNION truth — never everything on disk", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} />);
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-all"));
    const confirm = screen.getByTestId("retention-reset-confirm");
    expect(confirm.textContent).toContain(
      "the union of the three local scopes — NOT everything on disk",
    );
    expect(confirm.textContent).toContain(
      "This will delete: watch-history, playback-progress, feedback-events",
    );
  });

  it("the confirm control fires onResetLocalData with the CONFIRMED scope", () => {
    const onResetLocalData = vi.fn();
    render(<SettingsScreen retentionState={MINIMAL_STATE} onResetLocalData={onResetLocalData} />);
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-progress"));
    fireEvent.click(screen.getByTestId("retention-reset-confirm-button"));
    expect(onResetLocalData).toHaveBeenCalledTimes(1);
    expect(onResetLocalData).toHaveBeenCalledWith("progress");
  });

  it("cancel disarms the confirm panel without firing anything", () => {
    const onResetLocalData = vi.fn();
    render(<SettingsScreen retentionState={MINIMAL_STATE} onResetLocalData={onResetLocalData} />);
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-history"));
    fireEvent.click(screen.getByTestId("retention-reset-cancel"));
    expect(screen.queryByTestId("retention-reset-confirm")).toBeNull();
    expect(onResetLocalData).not.toHaveBeenCalled();
  });

  it("no dead confirm: without a reset handler the confirm control is not rendered", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} />);
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-history"));
    expect(screen.queryByTestId("retention-reset-confirm-button")).toBeNull();
    expect(screen.getByTestId("retention-reset-confirm").textContent).toContain(
      "No reset handler is wired",
    );
  });

  it("the reset result renders verbatim — counts, untouched scopes, provider-owned boundary", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} resetResult={HISTORY_RESET_RESULT} />);
    const result = screen.getByTestId("retention-reset-result");
    expect(result.textContent).toContain("scope: history");
    expect(result.textContent).toContain("history 2");
    expect(result.textContent).toContain("Untouched local scopes: progress, feedback");
    expect(result.textContent).toContain(
      "Provider-owned record classes NOT deleted here: provider-account, provider-catalog, provider-watch-history",
    );
  });

  it("an all-scope result names every local scope it cleared and keeps the boundary line", () => {
    render(<SettingsScreen retentionState={MINIMAL_STATE} resetResult={ALL_RESET_RESULT} />);
    const result = screen.getByTestId("retention-reset-result");
    expect(result.textContent).toContain("history 2 · progress 0 · feedback 5");
    expect(result.textContent).toContain("none — every local scope was in the confirmed reset");
    expect(result.textContent).toContain("provider-watch-history");
  });
});

// ---------- the data-boundary explanation view ----------

describe("SettingsScreen: the data-boundary explanation view", () => {
  it("renders every record class with its boundary label and deletability, verbatim", () => {
    render(<SettingsScreen retentionState={NEVER_SET_STATE} />);
    expect(screen.getAllByTestId(/^retention-boundary-/)).toHaveLength(11);
    // WebFlix-local + covered by a reset scope.
    const history = screen.getByTestId("retention-boundary-watch-history");
    expect(history.textContent).toContain("WebFlix-local");
    expect(history.textContent).toContain("deletable here (reset scope: history)");
    // WebFlix-local but NOT covered by any reset scope.
    const library = screen.getByTestId("retention-boundary-local-library");
    expect(library.textContent).toContain("its own management surface owns it");
    // Provider-owned — never deletable from WebFlix.
    const account = screen.getByTestId("retention-boundary-provider-account");
    expect(account.textContent).toContain("Provider-owned");
    expect(account.textContent).toContain("not deletable from WebFlix");
    // Derived — held locally, the provider-side source remains.
    const fieldSets = screen.getByTestId("retention-boundary-provider-field-sets");
    expect(fieldSets.textContent).toContain("Derived");
    expect(fieldSets.textContent).toContain("its own management surface owns it");
  });

  it("the three local retention scopes' classes map to their reset scopes exactly", () => {
    render(<SettingsScreen retentionState={NEVER_SET_STATE} />);
    expect(screen.getByTestId("retention-boundary-watch-history").textContent).toContain(
      "reset scope: history",
    );
    expect(screen.getByTestId("retention-boundary-playback-progress").textContent).toContain(
      "reset scope: progress",
    );
    expect(screen.getByTestId("retention-boundary-feedback-events").textContent).toContain(
      "reset scope: feedback",
    );
  });
});
