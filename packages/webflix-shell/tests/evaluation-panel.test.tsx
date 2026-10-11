// @vitest-environment jsdom
//
// EvaluationPanel component tests (P4-EVALLOOP scope row 4).
// The jsdom docblock above is mandatory: the package-local vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the factual "No evaluation run yet." empty state (null — no fake data);
// - per-configuration outcomes rendered verbatim (label, id, resolution
//   note) with their metrics AND population sizes;
// - THE NO-100%-WITHOUT-N RULE: every share renders with its counts
//   ("1 of 1 (100%)"), and null shares render the factual no-population
//   text — never a bare percentage;
// - the replay populations in the summary line (replayed of stored,
//   explicit/implicit under test, objectives, items, k);
// - failed configurations render their honest reason — no fabricated
//   metrics for a side that did not run;
// - pairwise overlaps with side sizes; the honest empty/no-overlap states;
// - aria labelling (section + per-outcome articles);
// - NO network (fetch untouched), NO telemetry (console untouched).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { EvaluationPanel } from "../src/components/EvaluationPanel";
import type { EvaluationResult, RankingResult } from "webflix-contracts";

afterEach(cleanup);

// ---------- fixtures ----------

const AS_OF = "2026-10-11T08:00:00Z";

const AGREEMENT = {
  likedTotal: 2,
  likedInTopK: 1,
  dislikedTotal: 1,
  dislikedInBottomK: 1,
  abstained: 1,
  likedShare: 0.5,
  dislikedShare: 1,
  agreedShare: 0.75,
};

const STATS = { count: 4, min: 0.12, max: 0.84, mean: 0.4, median: 0.38 };

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

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    k: 2,
    asOf: AS_OF,
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
        agreement: AGREEMENT,
        scoreStats: STATS,
      },
    ],
    pairwiseOverlaps: [],
    ...overrides,
  } as EvaluationResult;
}

describe("EvaluationPanel", () => {
  it("null renders the factual empty state — no fake data, no outcome cards", () => {
    render(<EvaluationPanel result={null} />);
    expect(screen.getByTestId("evaluation-panel-empty").textContent).toBe("No evaluation run yet.");
    expect(screen.queryAllByTestId(/^evaluation-outcome-/)).toHaveLength(0);
  });

  it("renders per-configuration outcomes verbatim — label, id, resolution note", () => {
    render(<EvaluationPanel result={makeResult()} />);
    const card = screen.getByTestId("evaluation-outcome-0");
    expect(card.textContent).toContain("Built-in ranker (v1)");
    expect(card.textContent).toContain("webflix.built-in-ranker");
    expect(card.textContent).toContain("the built-in deterministic ranking policy (v1)");
  });

  it("the summary line carries the replay populations + k + the echoed asOf", () => {
    render(<EvaluationPanel result={makeResult()} />);
    const summary = screen.getByTestId("evaluation-panel-summary");
    expect(summary.textContent).toContain("Replayed 3 of 5 stored feedback events");
    expect(summary.textContent).toContain("2 explicit · 1 implicit under test");
    expect(summary.textContent).toContain("objectives applied");
    expect(summary.textContent).toContain("2 items under test");
    expect(summary.textContent).toContain("k=2");
    expect(summary.textContent).toContain(AS_OF);
  });

  it("agreement metrics render WITH their populations — never a bare percentage", () => {
    render(<EvaluationPanel result={makeResult()} />);
    const agreement = screen.getByTestId("evaluation-agreement-0");
    expect(agreement.textContent).toContain("Liked in top-2: 1 of 2 (50%)");
    expect(agreement.textContent).toContain("disliked in bottom-2: 1 of 1 (100%)");
    expect(agreement.textContent).toContain("abstained: 1");
    expect(agreement.textContent).toContain("agreement: 2 of 3 (75%)");
  });

  it('THE NO-100%-WITHOUT-N PIN: a 1/1 share renders as "1 of 1 (100%)"', () => {
    render(
      <EvaluationPanel
        result={makeResult({
          outcomes: [
            {
              kind: "evaluated",
              configurationIndex: 0,
              configuration: { kind: "built-in" },
              rankerId: "webflix.built-in-ranker",
              rankerLabel: "Built-in ranker (v1)",
              resolutionNote: "note",
              ranking: RANKED,
              agreement: {
                likedTotal: 1,
                likedInTopK: 1,
                dislikedTotal: 0,
                dislikedInBottomK: 0,
                abstained: 0,
                likedShare: 1,
                dislikedShare: null,
                agreedShare: 1,
              },
              scoreStats: STATS,
            },
          ],
        })}
      />,
    );
    const agreement = screen.getByTestId("evaluation-agreement-0");
    expect(agreement.textContent).toContain("Liked in top-2: 1 of 1 (100%)");
    // A 0-population side renders the factual no-share text — never "0%".
    expect(agreement.textContent).toContain(
      "disliked in bottom-2: 0 of 0 (no population — no share)",
    );
    expect(agreement.textContent).toContain("agreement: 1 of 1 (100%)");
  });

  it('null agreedShare renders "no rated items" — the honest zero-feedback case', () => {
    render(
      <EvaluationPanel
        result={makeResult({
          outcomes: [
            {
              kind: "evaluated",
              configurationIndex: 0,
              configuration: { kind: "built-in" },
              rankerId: "webflix.built-in-ranker",
              rankerLabel: "Built-in ranker (v1)",
              resolutionNote: "note",
              ranking: RANKED,
              agreement: {
                likedTotal: 0,
                likedInTopK: 0,
                dislikedTotal: 0,
                dislikedInBottomK: 0,
                abstained: 0,
                likedShare: null,
                dislikedShare: null,
                agreedShare: null,
              },
              scoreStats: STATS,
            },
          ],
        })}
      />,
    );
    const agreement = screen.getByTestId("evaluation-agreement-0");
    expect(agreement.textContent).toContain("agreement: no rated items");
    expect(agreement.textContent).toContain("Liked in top-2: 0 of 0 (no population — no share)");
  });

  it("score stats render with the population; an empty ranking renders the honest empties", () => {
    render(
      <EvaluationPanel
        result={makeResult({
          outcomes: [
            {
              kind: "evaluated",
              configurationIndex: 0,
              configuration: { kind: "built-in" },
              rankerId: "webflix.built-in-ranker",
              rankerLabel: "Built-in ranker (v1)",
              resolutionNote: "note",
              ranking: { kind: "empty", policyVersion: "v1", reason: "no-ranked-candidates" },
              agreement: AGREEMENT,
              scoreStats: { count: 0, min: null, max: null, mean: null, median: null },
            },
          ],
        })}
      />,
    );
    const card = screen.getByTestId("evaluation-outcome-0");
    expect(card.textContent).toContain("Empty ranking — no-ranked-candidates");
    expect(screen.getByTestId("evaluation-scores-0").textContent).toBe(
      "Scores: no ranked items (population 0)",
    );
  });

  it("a FAILED configuration renders its honest reason — never fabricated metrics", () => {
    render(
      <EvaluationPanel
        result={makeResult({
          outcomes: [
            {
              kind: "failed",
              configurationIndex: 1,
              configuration: { kind: "adapter", adapterId: "gone-adapter" },
              rankerId: "gone-adapter",
              reason: 'the configured ranker adapter "gone-adapter" is not in the registry',
            },
          ],
        })}
      />,
    );
    const card = screen.getByTestId("evaluation-outcome-1");
    expect(card.textContent).toContain("Could not run: gone-adapter");
    expect(screen.getByTestId("evaluation-failed-reason-1").textContent).toContain(
      "not in the registry",
    );
    expect(screen.queryByTestId("evaluation-agreement-1")).toBeNull();
    expect(screen.queryByTestId("evaluation-scores-1")).toBeNull();
  });

  it("pairwise overlaps render with the actual side sizes and the share", () => {
    render(
      <EvaluationPanel
        result={makeResult({
          outcomes: [
            {
              kind: "evaluated",
              configurationIndex: 0,
              configuration: { kind: "built-in" },
              rankerId: "webflix.built-in-ranker",
              rankerLabel: "Built-in ranker (v1)",
              resolutionNote: "note",
              ranking: RANKED,
              agreement: AGREEMENT,
              scoreStats: STATS,
            },
            {
              kind: "evaluated",
              configurationIndex: 1,
              configuration: { kind: "adapter", adapterId: "fixture" },
              rankerId: "fixture",
              rankerLabel: "Fixture-replay ranker (TEST DOUBLE — no real ranking)",
              resolutionNote: "explicitly configured adapter",
              ranking: RANKED,
              agreement: AGREEMENT,
              scoreStats: STATS,
            },
          ],
          pairwiseOverlaps: [{ a: 0, b: 1, overlap: 1, sizeA: 2, sizeB: 2, share: 0.5 }],
        })}
      />,
    );
    const overlaps = screen.getByTestId("evaluation-overlaps");
    expect(overlaps.textContent).toContain(
      "Built-in ranker (v1) vs Fixture-replay ranker (TEST DOUBLE — no real ranking):",
    );
    expect(overlaps.textContent).toContain("top-2 overlap 1 (side sizes 2, 2) — 50%");
  });

  it("an all-empty pairwise overlap renders the nothing-to-compare text, never a fabricated 0%", () => {
    render(
      <EvaluationPanel
        result={makeResult({
          pairwiseOverlaps: [{ a: 0, b: 1, overlap: 0, sizeA: 0, sizeB: 0, share: null }],
        })}
      />,
    );
    expect(screen.getByTestId("evaluation-overlaps").textContent).toContain(
      "both top-k lists empty — nothing to compare",
    );
  });

  it("fewer than two evaluated sides renders the honest no-overlaps note", () => {
    render(<EvaluationPanel result={makeResult()} />);
    expect(screen.getByTestId("evaluation-overlaps").textContent).toBe(
      "No pairwise overlaps — fewer than two configurations evaluated.",
    );
  });

  it("aria labelling: the section and the per-outcome articles carry accessible names", () => {
    render(<EvaluationPanel result={makeResult()} />);
    expect(screen.getByRole("region", { name: "Evaluation results" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Outcome for Built-in ranker (v1)" })).toBeTruthy();
  });

  it("renders with NO network and NO telemetry (fetch and console untouched)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockReturnValue(undefined as never);
    const consoleSpy = vi.spyOn(console, "log");
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    try {
      render(<EvaluationPanel result={makeResult()} />);
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
