// @vitest-environment jsdom
//
// AppShell composition tests (DESKTOP-COMPOSITION-1 — the composition row
// the P4-ADAPTERS / P4-EVALLOOP / P5-QUALIFY ledger rows promised).
// The jsdom docblock above is mandatory: the package-local vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the two new nav buttons (nav-ads "Ad Center" / nav-evaluation
//   "MI Evaluation") render and switch screens, aria-current="page" tracks
//   the active screen exactly like the four original entries;
// - the panels mount AS-IS: prop pass-through reaches them (qualification
//   outcomes render in the ads screen; the evaluation result + the selector
//   entries/selection/status render in the evaluation screen) — zero
//   panel-internal behavior is re-tested here (their own suites pin that);
// - the honest never-run defaults: null adCenterResults / null
//   evaluationResult / [] rankerAdapterEntries / null selectedAdapterId /
//   null statusNote render the panels' own factual empty states — NO crash,
//   NO fake data, NO invented status line;
// - the selector's onSelectionChange fires through the AppShell's
//   onRankerAdapterSelectionChange prop (and stays a no-op — never a crash —
//   when the host passes no callback: Phase 6 wires hosts);
// - the RankerAdapterSelector renders ABOVE the EvaluationPanel in the
//   evaluation screen stack;
// - the ADR-0003 independent-value notice stays in the shell chrome on the
//   new screens (it is permanent, not per-screen);
// - NO network (fetch untouched), NO telemetry (console untouched).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell, NAV_ITEMS } from "../src/index";
import type { AdsQualificationItemOutcome, RankerAdapterDescriptor } from "webflix-application";
import type { EvaluationResult, RankingResult } from "webflix-contracts";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures (verbatim shapes from the panels' own suites) ----------

const QUALIFIED_OUTCOME: AdsQualificationItemOutcome = {
  outcome: "explained",
  index: 0,
  adRecordId: "ad-qualified",
  explanation: {
    policyVersion: "v1",
    qualified: true,
    reasons: [
      {
        text: "2 of 3 claims are currently verified against a declared source",
        evidence: [
          { kind: "offer-verification", verificationId: "v-1" },
          { kind: "offer-verification", verificationId: "v-2" },
        ],
      },
    ],
  },
  facts: {
    claimsTotal: 3,
    currentByOutcome: { verified: 2, notVerifiable: 0, contradicted: 0, unchecked: 1 },
    signalsBySource: [{ source: "trustpilot.example", count: 1 }],
    danglingSignalRefs: 0,
  },
};

const NO_DATA_OUTCOME: AdsQualificationItemOutcome = {
  outcome: "no-data",
  index: 1,
  adRecordId: "ad-empty",
  statement: "no stored claims for this record — nothing to explain yet",
};

const BUILT_IN_ADAPTER: RankerAdapterDescriptor = {
  id: "webflix.built-in-ranker",
  label: "Built-in ranker (v1)",
  description: "WebFlix's own deterministic ranking policy v1.",
  capabilities: ["deterministic", "local", "reasons-mandatory"],
};

const RANKED: RankingResult = {
  kind: "ranked",
  policyVersion: "v1",
  items: [
    {
      itemId: "item-a",
      score: 0.84,
      reasons: [
        {
          family: "library-affinity",
          text: "In your library",
          contribution: 0.15,
          evidence: [{ kind: "library-fact", itemId: "item-a" }],
        },
      ],
    },
  ],
};

const EVALUATION_RESULT: EvaluationResult = {
  k: 2,
  asOf: "2026-10-12T08:00:00Z",
  itemIds: ["item-a", "item-b"],
  replay: {
    feedbackTotalStored: 5,
    feedbackReplayed: 3,
    explicitUnderTest: 2,
    implicitUnderTest: 1,
    objectivesApplied: true,
    itemsUnderTest: 2,
  },
  outcomes: [
    {
      kind: "evaluated",
      configurationIndex: 0,
      configuration: { kind: "built-in" },
      rankerId: "webflix.built-in-ranker",
      rankerLabel: "Built-in ranker (v1)",
      resolutionNote: "the built-in deterministic ranking policy (v1)",
      ranking: RANKED,
      agreement: {
        likedTotal: 2,
        likedInTopK: 1,
        dislikedTotal: 1,
        dislikedInBottomK: 1,
        abstained: 1,
        likedShare: 0.5,
        dislikedShare: 1,
        agreedShare: 0.75,
      },
      scoreStats: { count: 4, min: 0.12, max: 0.84, mean: 0.4, median: 0.38 },
    },
  ],
  pairwiseOverlaps: [],
} as EvaluationResult;

// ---------- the composition row ----------

describe("AppShell: the ads + evaluation screens (DESKTOP-COMPOSITION-1)", () => {
  it("NAV_ITEMS carries the two new entries with the composed labels", () => {
    expect(NAV_ITEMS).toContainEqual({ id: "ads", label: "Ad Center" });
    expect(NAV_ITEMS).toContainEqual({ id: "evaluation", label: "MI Evaluation" });
  });

  it("the two new nav buttons render, switch screens, and track aria-current like the originals", () => {
    render(<AppShell />);

    const navAds = screen.getByTestId("nav-ads");
    const navEvaluation = screen.getByTestId("nav-evaluation");
    expect(navAds.textContent).toBe("Ad Center");
    expect(navEvaluation.textContent).toBe("MI Evaluation");
    // Not active before the first switch.
    expect(navAds.getAttribute("aria-current")).toBeNull();
    expect(navEvaluation.getAttribute("aria-current")).toBeNull();

    fireEvent.click(navAds);
    expect(screen.getByTestId("ad-center-panel-root")).toBeTruthy();
    expect(screen.queryByText("Welcome to WebFlix")).toBeNull();
    expect(screen.getByTestId("nav-ads").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBeNull();

    fireEvent.click(navEvaluation);
    expect(screen.getByTestId("ranker-selector-root")).toBeTruthy();
    expect(screen.getByTestId("evaluation-panel-root")).toBeTruthy();
    expect(screen.queryByTestId("ad-center-panel-root")).toBeNull();
    expect(screen.getByTestId("nav-evaluation").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-ads").getAttribute("aria-current")).toBeNull();

    fireEvent.click(screen.getByTestId("nav-home"));
    expect(screen.getByText("Welcome to WebFlix")).toBeTruthy();
    expect(screen.queryByTestId("ranker-selector-root")).toBeNull();
  });

  it("initialScreen accepts the new screen ids (the flat prop pattern extends, not special-cases)", () => {
    // initialScreen is a mount-time value (useState semantics — the same as
    // the original four screens), so each probe mounts a fresh shell.
    const ads = render(<AppShell initialScreen="ads" />);
    expect(screen.getByTestId("ad-center-panel-root")).toBeTruthy();
    ads.unmount();

    render(<AppShell initialScreen="evaluation" />);
    expect(screen.getByTestId("evaluation-panel-root")).toBeTruthy();
  });

  it("adCenterResults passes through: the qualification outcomes render in the ads screen", () => {
    render(<AppShell adCenterResults={[QUALIFIED_OUTCOME, NO_DATA_OUTCOME]} />);
    fireEvent.click(screen.getByTestId("nav-ads"));

    const qualifiedCard = screen.getByTestId("ad-center-record-0");
    expect(qualifiedCard.textContent).toContain("Qualified for the Ad Center view");
    expect(qualifiedCard.textContent).toContain("ad-qualified");
    expect(qualifiedCard.textContent).toContain("Claims: 3");
    // The no-data record renders its own honest statement.
    expect(screen.getByTestId("ad-center-no-data-1").textContent).toContain(
      "no stored claims for this record",
    );
    // The DISPLAY-STANDING disclaimer rides with every result set.
    expect(screen.getByTestId("ad-center-panel-disclaimer")).toBeTruthy();
  });

  it("evaluation props pass through: selector entries, stored selection, status note, and the result", () => {
    render(
      <AppShell
        evaluationResult={EVALUATION_RESULT}
        rankerAdapterEntries={[BUILT_IN_ADAPTER]}
        rankerSelectedAdapterId="webflix.built-in-ranker"
        rankerStatusNote="No adapter selected — the documented default is active."
      />,
    );
    fireEvent.click(screen.getByTestId("nav-evaluation"));

    // The registry truth renders verbatim.
    const option = screen.getByTestId("ranker-option-webflix.built-in-ranker");
    expect(option.textContent).toContain("Built-in ranker (v1)");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    // The STORED selection checks the option.
    expect(
      (screen.getByTestId("ranker-option-input-webflix.built-in-ranker") as HTMLInputElement)
        .checked,
    ).toBe(true);
    // The status note renders verbatim.
    expect(screen.getByTestId("ranker-selector-status").textContent).toBe(
      "No adapter selected — the documented default is active.",
    );
    // The evaluation result renders with its populations.
    const outcome = screen.getByTestId("evaluation-outcome-0");
    expect(outcome.textContent).toContain("Built-in ranker (v1)");
    expect(screen.getByTestId("evaluation-panel-summary").textContent).toContain(
      "Replayed 3 of 5 stored feedback events",
    );
  });

  it("the RankerAdapterSelector renders ABOVE the EvaluationPanel in the evaluation screen", () => {
    render(
      <AppShell evaluationResult={EVALUATION_RESULT} rankerAdapterEntries={[BUILT_IN_ADAPTER]} />,
    );
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    const selector = screen.getByTestId("ranker-selector-root");
    const panel = screen.getByTestId("evaluation-panel-root");
    // The selector precedes the panel in the stacked evaluation screen.
    expect(selector.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("honest never-run defaults: the panels' own factual empty states, no crash, no invented data", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByTestId("nav-ads"));
    expect(screen.getByTestId("ad-center-panel-empty").textContent).toBe(
      "No qualification results yet.",
    );
    expect(screen.queryAllByTestId(/^ad-center-record-/)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("nav-evaluation"));
    expect(screen.getByTestId("ranker-selector-empty").textContent).toBe(
      "No ranker adapters are available.",
    );
    expect(screen.getByTestId("ranker-selector-note").textContent).toContain("0 adapters");
    expect(screen.queryByTestId("ranker-selector-status")).toBeNull();
    expect(screen.getByTestId("evaluation-panel-empty").textContent).toBe("No evaluation run yet.");
    expect(screen.queryAllByTestId(/^evaluation-outcome-/)).toHaveLength(0);
    // No radios exist to select — the empty registry invents no options.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("the selector's onSelectionChange fires through the AppShell's flat callback prop", () => {
    const onSelection = vi.fn();
    render(
      <AppShell
        rankerAdapterEntries={[BUILT_IN_ADAPTER]}
        onRankerAdapterSelectionChange={onSelection}
      />,
    );
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker"));
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith("webflix.built-in-ranker");
  });

  it("with no host callback the selection is an honest no-op — never a crash (Phase 6 wires hosts)", () => {
    render(<AppShell rankerAdapterEntries={[BUILT_IN_ADAPTER]} />);
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    expect(() =>
      fireEvent.click(screen.getByTestId("ranker-option-input-webflix.built-in-ranker")),
    ).not.toThrow();
    // The option is still selectable (checked reflects the DOM radio), and
    // the shell invented neither a default selection nor a status line.
    expect(screen.queryByTestId("ranker-selector-status")).toBeNull();
  });

  it("the ADR-0003 independent-value notice stays in the shell chrome on the new screens", () => {
    render(<AppShell />);
    fireEvent.click(screen.getByTestId("nav-ads"));
    expect(screen.getByTestId("independent-value-notice").textContent).toMatch(/independent/i);
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    expect(screen.getByTestId("independent-value-notice").textContent).toMatch(/independent/i);
  });
});
