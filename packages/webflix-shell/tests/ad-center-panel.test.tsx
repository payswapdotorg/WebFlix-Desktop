// @vitest-environment jsdom
//
// AdCenterPanel component tests (P5-QUALIFY scope row 2).
// The jsdom docblock above is mandatory: the package-local vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the factual "No qualification results yet." empty state (null — no
//   fake data);
// - the DISPLAY-STANDING disclaimer renders with every result set (not a
//   promise of ad quality, never affects organic recommendations);
// - per-record standings + the counted populations (the NO-100%-WITHOUT-N
//   rule: every count renders WITH its claim population N — never a bare
//   percentage, never a bare count);
// - reasons rendered verbatim with their evidence pointers (claim id /
//   offer-verification id / review-signal id);
// - PER-SOURCE signal counts rendered separately, never merged (two
//   sources are two counts);
// - the honest no-data record renders its statement — never a
//   zero-dressed-as-signal standing;
// - a rejected (record-absent) row renders its honest reason;
// - aria labelling (the section + the per-record articles);
// - NO network (fetch untouched), NO telemetry (console untouched).
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AdCenterPanel } from "../src/components/AdCenterPanel";
import { ErrorCode } from "webflix-contracts";
import type { AdsQualificationItemOutcome } from "webflix-application";

afterEach(cleanup);

// ---------- fixtures ----------

const QUALIFIED: AdsQualificationItemOutcome = {
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
      {
        text: "1 of 3 claims have no completed verification check",
        evidence: [{ kind: "claim", claimId: "c-3" }],
      },
      {
        text: "review source trustpilot.example reports 1 stored signal(s) attached to this ad's claims, as reported — never merged",
        evidence: [{ kind: "review-signal", reviewSignalId: "s-1" }],
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

const NOT_QUALIFIED: AdsQualificationItemOutcome = {
  outcome: "explained",
  index: 1,
  adRecordId: "ad-contradicted",
  explanation: {
    policyVersion: "v1",
    qualified: false,
    reasons: [
      {
        text: "1 of 2 claims are currently contradicted by declared evidence",
        evidence: [{ kind: "offer-verification", verificationId: "v-9" }],
      },
    ],
  },
  facts: {
    claimsTotal: 2,
    currentByOutcome: { verified: 1, notVerifiable: 0, contradicted: 1, unchecked: 0 },
    signalsBySource: [],
    danglingSignalRefs: 0,
  },
};

const NO_DATA: AdsQualificationItemOutcome = {
  outcome: "no-data",
  index: 2,
  adRecordId: "ad-empty",
  statement:
    "no stored claims for this record — no verification or review data to explain yet " +
    "(ads.import + ads.extractClaims + ads.linkEvidence + ads.verify produce the data)",
};

const REJECTED: AdsQualificationItemOutcome = {
  outcome: "rejected",
  index: 3,
  adRecordId: "ad-ghost",
  code: ErrorCode.AdsRecordAbsent,
  reason: 'no stored Ad Center record for id "ad-ghost" — run ads.import over the record first',
};

describe("AdCenterPanel", () => {
  it("null renders the factual empty state — no fake data, no record cards", () => {
    render(<AdCenterPanel results={null} />);
    expect(screen.getByTestId("ad-center-panel-empty").textContent).toBe(
      "No qualification results yet.",
    );
    expect(screen.queryAllByTestId(/^ad-center-record-/)).toHaveLength(0);
  });

  it("the DISPLAY-STANDING disclaimer renders with every result set — not a promise of ad quality, never organic", () => {
    render(<AdCenterPanel results={[QUALIFIED]} />);
    const disclaimer = screen.getByTestId("ad-center-panel-disclaimer");
    expect(disclaimer.textContent).toContain("standing in the Ad Center view");
    expect(disclaimer.textContent).toContain("not a promise of ad quality");
    expect(disclaimer.textContent).toContain("never affects organic recommendations");
  });

  it("a qualified record renders its standing + record id + populations WITH their N (no bare percentages)", () => {
    render(<AdCenterPanel results={[QUALIFIED]} />);
    const card = screen.getByTestId("ad-center-record-0");
    expect(card.textContent).toContain("Qualified for the Ad Center view");
    expect(card.textContent).toContain("ad-qualified");
    const facts = screen.getByTestId("ad-center-facts-0");
    // THE NO-100%-WITHOUT-N PIN: every count carries the population.
    expect(facts.textContent).toContain("Claims: 3");
    expect(facts.textContent).toContain("currently verified 2");
    expect(facts.textContent).toContain("unchecked 1");
    expect(facts.textContent).not.toContain("%");
  });

  it("reasons render verbatim with their evidence pointers (claim id, verification id, signal id)", () => {
    render(<AdCenterPanel results={[QUALIFIED]} />);
    const reasons = screen.getByTestId("ad-center-reasons-0");
    expect(reasons.textContent).toContain(
      "2 of 3 claims are currently verified against a declared source",
    );
    expect(reasons.textContent).toContain("offer-verification v-1");
    expect(reasons.textContent).toContain("offer-verification v-2");
    expect(reasons.textContent).toContain("claim c-3");
    expect(reasons.textContent).toContain("review-signal s-1");
  });

  it("PER-SOURCE signal counts render separately, never merged — two sources are two counts", () => {
    const twoSources: AdsQualificationItemOutcome = {
      ...QUALIFIED,
      explanation: {
        ...QUALIFIED.explanation,
        reasons: [
          QUALIFIED.explanation.reasons[0]!,
          {
            text: "review source which.example reports 1 stored signal(s) attached to this ad's claims, as reported — never merged",
            evidence: [{ kind: "review-signal", reviewSignalId: "s-2" }],
          },
        ],
      },
      facts: {
        ...QUALIFIED.facts,
        signalsBySource: [
          { source: "trustpilot.example", count: 1 },
          { source: "which.example", count: 1 },
        ],
      },
    };
    render(<AdCenterPanel results={[twoSources]} />);
    const facts = screen.getByTestId("ad-center-facts-0");
    expect(facts.textContent).toContain(
      "trustpilot.example: 1 (as reported, per source — never merged)",
    );
    expect(facts.textContent).toContain(
      "which.example: 1 (as reported, per source — never merged)",
    );
    // Two separate counts — never one merged number.
    expect(facts.textContent).not.toContain("trustpilot.example: 2");
    expect(facts.textContent).not.toMatch(/2 \(as reported/);
  });

  it("a record with NO signals renders the factual no-signals text (population 0, stated)", () => {
    render(<AdCenterPanel results={[NOT_QUALIFIED]} />);
    expect(screen.getByTestId("ad-center-facts-1").textContent).toContain(
      "review signals — no stored review signals attached",
    );
  });

  it("a NOT-qualified record renders its honest standing + its reasons (both directions carry reasons)", () => {
    render(<AdCenterPanel results={[NOT_QUALIFIED]} />);
    const card = screen.getByTestId("ad-center-record-1");
    expect(card.textContent).toContain("Not qualified for the Ad Center view");
    expect(screen.getByTestId("ad-center-reasons-1").textContent).toContain(
      "1 of 2 claims are currently contradicted by declared evidence",
    );
    // The population renders with the count — no bare count.
    expect(screen.getByTestId("ad-center-facts-1").textContent).toContain("Claims: 2");
    expect(screen.getByTestId("ad-center-facts-1").textContent).toContain("contradicted 1");
  });

  it("the honest NO-DATA record renders its statement — never a zero-dressed-as-signal standing", () => {
    render(<AdCenterPanel results={[NO_DATA]} />);
    const card = screen.getByTestId("ad-center-record-2");
    expect(card.textContent).toContain("No data");
    expect(card.textContent).toContain("ad-empty");
    expect(screen.getByTestId("ad-center-no-data-2").textContent).toContain("no stored claims");
    // NEVER a qualified/not-qualified standing for a dataless record.
    expect(card.textContent).not.toContain("Qualified for the Ad Center view");
    expect(card.textContent).not.toContain("Not qualified for the Ad Center view");
  });

  it("a rejected (record-absent) row renders its honest reason — no fabricated standing", () => {
    render(<AdCenterPanel results={[REJECTED]} />);
    const card = screen.getByTestId("ad-center-record-3");
    expect(card.textContent).toContain("Not qualified — record absent");
    expect(screen.getByTestId("ad-center-rejected-3").textContent).toContain(
      "run ads.import over the record first",
    );
  });

  it("a mixed result set renders every record card in order", () => {
    render(<AdCenterPanel results={[QUALIFIED, NOT_QUALIFIED, NO_DATA, REJECTED]} />);
    expect(screen.getByTestId("ad-center-record-0")).toBeTruthy();
    expect(screen.getByTestId("ad-center-record-1")).toBeTruthy();
    expect(screen.getByTestId("ad-center-record-2")).toBeTruthy();
    expect(screen.getByTestId("ad-center-record-3")).toBeTruthy();
  });

  it("an empty results array renders the disclaimer with no record cards (honest, not an error)", () => {
    render(<AdCenterPanel results={[]} />);
    expect(screen.getByTestId("ad-center-panel-disclaimer")).toBeTruthy();
    expect(screen.queryAllByTestId(/^ad-center-record-/)).toHaveLength(0);
  });

  it("aria labelling: the section and the per-record articles carry accessible names", () => {
    render(<AdCenterPanel results={[QUALIFIED]} />);
    expect(screen.getByRole("region", { name: "Ad Center qualification" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Qualification for ad-qualified" })).toBeTruthy();
  });

  it("renders with NO network and NO telemetry (fetch and console untouched)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch" as never).mockReturnValue(undefined as never);
    const consoleSpy = vi.spyOn(console, "log");
    const consoleInfo = vi.spyOn(console, "info");
    const consoleWarn = vi.spyOn(console, "warn");
    try {
      render(<AdCenterPanel results={[QUALIFIED, NOT_QUALIFIED]} />);
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
