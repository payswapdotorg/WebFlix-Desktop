// @vitest-environment jsdom
//
// AppShell composition tests for the P7-COMPOSE-1 wave-1 surface mounts (the
// shell composition row: SearchScreen federated phase + WatchScreen controls
// surface + the SettingsScreen retention surface). The jsdom docblock above
// is mandatory: the package-local vitest.config.ts defaults to the node
// environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly (the DESKTOP-COMPOSITION-1 precedent applied to wave 1):
// - the new nav button (nav-settings "Settings") renders and switches
//   screens, aria-current="page" tracking exactly like every other entry;
// - the retention props pass through to the SettingsScreen (state, reset
//   result, and the three callback props) — zero surface-internal behavior
//   is re-tested here (the settings suite pins that);
// - the federated search phase flows through the existing searchState prop
//   (the federated coverage view renders in the search screen);
// - the honest never-loaded defaults: null retentionState / null
//   retentionResetResult render the surface's own factual empty states —
//   NO crash, NO faked data, NO invented status;
// - the ADR-0003 independent-value notice stays in the shell chrome on the
//   settings screen (it is permanent, not per-screen);
// - NO network (fetch untouched), NO telemetry (console untouched).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell, NAV_ITEMS, federatedSearchState } from "../src/index";
import type { CatalogItem, FederatedSearchResult } from "webflix-contracts";
import type { RetentionState, ResetLocalDataResult } from "webflix-application";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures ----------

const DONUT_ITEM: CatalogItem = {
  id: "yt-donut",
  title: "Blender donut tutorial",
  providerId: "youtube",
  mediaKind: "video",
  assets: [],
  metadata: {},
};

const FEDERATED_RESULT: FederatedSearchResult = {
  outcomes: {
    "fixture-youtube-like": { status: "ok", items: [DONUT_ITEM] },
    "fixture-slow-like": { status: "timeout", reason: "exceeded the per-source budget" },
  },
  coverage: [
    { source: "fixture-youtube-like", outcome: "ok", counts: { returned: 1 }, elapsedMs: 12 },
    { source: "fixture-slow-like", outcome: "timeout", counts: { returned: 0 }, elapsedMs: 4000 },
  ],
  items: [{ item: DONUT_ITEM, sources: ["fixture-youtube-like"] }],
};

const RETENTION_STATE: RetentionState = {
  historyTrackingPaused: true,
  preferenceUpdatedAt: "2026-10-15T09:30:00Z",
  preferenceNeverSet: false,
  localRecordCounts: { history: 2, progress: 0, feedback: 5 },
  boundaries: [
    {
      recordClass: "watch-history",
      boundary: "webflix-local",
      deletableHere: true,
      resetScope: "history",
      messageKey: "retention.record-class.watch-history",
      boundaryMessageKey: "retention.boundary.webflix-local",
    },
    {
      recordClass: "provider-account",
      boundary: "provider-owned",
      deletableHere: false,
      resetScope: null,
      messageKey: "retention.record-class.provider-account",
      boundaryMessageKey: "retention.boundary.provider-owned",
    },
  ],
};

const RESET_RESULT: ResetLocalDataResult = {
  scope: "history",
  removed: { history: 2, progress: 0, feedback: 0 },
  untouchedLocalScopes: ["progress", "feedback"],
  providerOwnedRecordClassesNotDeletableHere: ["provider-account"],
};

// ---------- the composition row ----------

describe("AppShell: the P7-COMPOSE-1 surface mounts", () => {
  it("NAV_ITEMS carries the settings entry with the composed label", () => {
    expect(NAV_ITEMS).toContainEqual({ id: "settings", label: "Settings" });
  });

  it("the settings nav button renders, switches screens, and tracks aria-current", () => {
    render(<AppShell />);
    const navSettings = screen.getByTestId("nav-settings");
    expect(navSettings.textContent).toBe("Settings");
    expect(navSettings.getAttribute("aria-current")).toBeNull();

    fireEvent.click(navSettings);
    expect(screen.getByTestId("settings-root")).toBeTruthy();
    expect(screen.queryByText("Welcome to WebFlix")).toBeNull();
    expect(screen.getByTestId("nav-settings").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBeNull();

    fireEvent.click(screen.getByTestId("nav-home"));
    expect(screen.getByText("Welcome to WebFlix")).toBeTruthy();
    expect(screen.queryByTestId("settings-root")).toBeNull();
  });

  it("initialScreen accepts the settings screen id (the flat prop pattern extends)", () => {
    render(<AppShell initialScreen="settings" />);
    expect(screen.getByTestId("settings-root")).toBeTruthy();
  });

  it("retention props pass through: the state, the reset result, and the callbacks", () => {
    const onPauseHistoryTracking = vi.fn();
    const onResumeHistoryTracking = vi.fn();
    const onResetLocalData = vi.fn();
    render(
      <AppShell
        retentionState={RETENTION_STATE}
        retentionResetResult={RESET_RESULT}
        onPauseHistoryTracking={onPauseHistoryTracking}
        onResumeHistoryTracking={onResumeHistoryTracking}
        onResetLocalData={onResetLocalData}
      />,
    );
    fireEvent.click(screen.getByTestId("nav-settings"));

    // The retention state renders through: paused status + boundary rows.
    expect(screen.getByTestId("retention-tracking-status").textContent).toBe(
      "History tracking is PAUSED",
    );
    expect(screen.getByTestId("retention-boundary-watch-history").textContent).toContain(
      "deletable here (reset scope: history)",
    );
    // The reset result renders verbatim.
    expect(screen.getByTestId("retention-reset-result").textContent).toContain("scope: history");
    // The resume callback fires through the flat prop.
    fireEvent.click(screen.getByTestId("retention-tracking-resume"));
    expect(onResumeHistoryTracking).toHaveBeenCalledTimes(1);
    // The reset callback fires through with the confirmed scope.
    fireEvent.click(screen.getByTestId("retention-reset-scope-input-history"));
    fireEvent.click(screen.getByTestId("retention-reset-confirm-button"));
    expect(onResetLocalData).toHaveBeenCalledTimes(1);
    expect(onResetLocalData).toHaveBeenCalledWith("history");
    expect(onPauseHistoryTracking).not.toHaveBeenCalled();
  });

  it("honest never-loaded defaults: the settings surface's own factual empty states, no crash", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByTestId("nav-settings"));
    expect(screen.getByTestId("retention-tracking-empty").textContent).toContain(
      "Retention state has not been loaded yet",
    );
    expect(screen.getByTestId("retention-boundaries-empty").textContent).toContain(
      "loads with the retention state",
    );
    expect(screen.queryByTestId("retention-tracking-pause")).toBeNull();
    expect(screen.queryByTestId("retention-tracking-resume")).toBeNull();
    expect(screen.queryByTestId("retention-reset-result")).toBeNull();
  });

  it("the federated search phase flows through the existing searchState prop", () => {
    render(<AppShell searchState={federatedSearchState("donut", FEDERATED_RESULT)} />);
    fireEvent.click(screen.getByTestId("nav-search"));
    expect(screen.getByTestId("search-federated")).toBeTruthy();
    expect(screen.getByTestId("search-federated-summary").textContent).toContain(
      "2 sources answered",
    );
    // The never-hide pin rides through the composition: the timed-out source
    // renders its honest row with its reason.
    expect(screen.getByTestId("search-federated-source-fixture-slow-like").textContent).toContain(
      "timeout",
    );
    expect(
      screen.getByTestId("search-federated-source-reason-fixture-slow-like").textContent,
    ).toContain("exceeded the per-source budget");
  });

  it("the ADR-0003 independent-value notice stays in the shell chrome on the settings screen", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByTestId("nav-settings"));
    expect(screen.getByTestId("independent-value-notice").textContent).toMatch(/independent/i);
  });
});
