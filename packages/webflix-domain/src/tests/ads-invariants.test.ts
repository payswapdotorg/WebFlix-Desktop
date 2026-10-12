/**
 * Tests for the Ad Center domain invariants (P5-CONTRACTS scope row 3):
 * the extractive-claim discipline (offsets within the source text + the
 * quote byte-equal to the offset window), the evidence-edge referential
 * shape checks, and the offer-verification state machine (bare
 * unchecked / full-evidence checked; unchecked -> checked transitions
 * only). Pure functions — every case is data in, violations out.
 */
import { describe, expect, it } from "vitest";
import {
  validateClaimOffsets,
  validateEvidenceLinkReferential,
  validateOfferVerificationState,
  validateOfferVerificationTransition,
} from "../index";

const ISO_LATER = "2026-10-20T12:30:00Z";

const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months!";

const adRecord = {
  id: "ad-1",
  advertiserIdentityId: "adv-1",
  creativeText: CREATIVE_TEXT,
  provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-001" },
};

const validClaim = {
  id: "claim-1",
  adRecordId: "ad-1",
  quote: "50% off your first 3 months",
  startOffset: CREATIVE_TEXT.indexOf("50% off your first 3 months"),
  endOffset:
    CREATIVE_TEXT.indexOf("50% off your first 3 months") + "50% off your first 3 months".length,
};

const provenance = { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-001" };

describe("validateClaimOffsets (the extractive discipline)", () => {
  it("accepts a claim whose quote is byte-equal to the offset window", () => {
    expect(validateClaimOffsets(validClaim, adRecord)).toEqual([]);
  });

  it("rejects a quote the source did not state (not byte-equal)", () => {
    const violations = validateClaimOffsets(
      { ...validClaim, quote: "90% off your first 3 months" },
      adRecord,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe("quote-not-byte-equal");
  });

  it("rejects offsets beyond the creative text", () => {
    const violations = validateClaimOffsets(
      { ...validClaim, startOffset: CREATIVE_TEXT.length - 2, endOffset: CREATIVE_TEXT.length + 5 },
      adRecord,
    );
    expect(violations[0]?.code).toBe("offsets-out-of-bounds");
  });

  it("rejects a claim checked against the wrong record", () => {
    const violations = validateClaimOffsets(validClaim, { ...adRecord, id: "ad-999" });
    expect(violations[0]?.code).toBe("wrong-record");
  });

  it("rejects a claim against a textless record (no pass-by-default)", () => {
    const textless = { ...adRecord, creativeText: undefined };
    const violations = validateClaimOffsets(validClaim, textless);
    expect(violations[0]?.code).toBe("no-creative-text");
  });

  it("rejects malformed inputs as invalid shapes", () => {
    expect(validateClaimOffsets({ id: "x" }, adRecord)[0]?.code).toBe("invalid-claim-shape");
    expect(validateClaimOffsets(validClaim, { id: "ad-1" })[0]?.code).toBe("invalid-record-shape");
    expect(validateClaimOffsets(null, adRecord)[0]?.code).toBe("invalid-claim-shape");
  });

  it("the discipline is exact: a quote shifted by one character fails", () => {
    const violations = validateClaimOffsets(
      {
        ...validClaim,
        startOffset: validClaim.startOffset + 1,
        endOffset: validClaim.endOffset + 1,
      },
      adRecord,
    );
    expect(violations[0]?.code).toBe("quote-not-byte-equal");
  });
});

describe("validateEvidenceLinkReferential", () => {
  const knownClaims = ["claim-1", "claim-2"];
  const knownReviewSignals = ["rev-1"];

  it("accepts edges whose claim and review signal resolve", () => {
    expect(
      validateEvidenceLinkReferential(
        {
          id: "edge-1",
          claimId: "claim-1",
          kind: "independent-review",
          relationship: "supports",
          reviewSignalId: "rev-1",
          provenance,
        },
        knownClaims,
        knownReviewSignals,
      ),
    ).toEqual([]);
    expect(
      validateEvidenceLinkReferential(
        {
          id: "edge-2",
          claimId: "claim-2",
          kind: "source-reported-fact",
          relationship: "contradicts",
          url: "https://acme.example/pricing",
          provenance,
        },
        knownClaims,
        knownReviewSignals,
      ),
    ).toEqual([]);
  });

  it("rejects an edge whose claim is unknown", () => {
    const violations = validateEvidenceLinkReferential(
      {
        id: "edge-1",
        claimId: "claim-404",
        kind: "source-reported-fact",
        relationship: "supports",
        url: "https://x.example",
        provenance,
      },
      knownClaims,
      knownReviewSignals,
    );
    expect(violations[0]?.code).toBe("unknown-claim");
  });

  it("rejects an independent-review edge whose review signal does not resolve", () => {
    const violations = validateEvidenceLinkReferential(
      {
        id: "edge-1",
        claimId: "claim-1",
        kind: "independent-review",
        relationship: "contextualizes",
        reviewSignalId: "rev-404",
        provenance,
      },
      knownClaims,
      knownReviewSignals,
    );
    expect(violations[0]?.code).toBe("unknown-review-signal");
  });

  it("does NOT resolve external locators it cannot know (offer-terms, user documents)", () => {
    // Referential honesty stops at what is locally knowable: an offer-terms
    // URL and a user document id are external locators, not local ids.
    expect(
      validateEvidenceLinkReferential(
        {
          id: "edge-3",
          claimId: "claim-1",
          kind: "offer-terms",
          relationship: "supports",
          url: "https://terms.example/x",
          provenance,
        },
        knownClaims,
        knownReviewSignals,
      ),
    ).toEqual([]);
    expect(
      validateEvidenceLinkReferential(
        {
          id: "edge-4",
          claimId: "claim-1",
          kind: "user-imported-document",
          relationship: "supports",
          documentId: "doc-42",
          provenance,
        },
        knownClaims,
        knownReviewSignals,
      ),
    ).toEqual([]);
  });

  it("rejects malformed edges as invalid shapes", () => {
    expect(
      validateEvidenceLinkReferential({ id: "x" }, knownClaims, knownReviewSignals)[0]?.code,
    ).toBe("invalid-shape");
    expect(
      validateEvidenceLinkReferential("not-an-object", knownClaims, knownReviewSignals)[0]?.code,
    ).toBe("invalid-shape");
  });
});

describe("validateOfferVerificationState (the bare-unchecked / full-evidence pairing)", () => {
  const fullChecked = {
    id: "ver-1",
    claimId: "claim-1",
    declaredSources: [{ source: "acme.example pricing page", url: "https://acme.example/pricing" }],
    checkedAt: ISO_LATER,
  };

  it("accepts a BARE unchecked record", () => {
    expect(
      validateOfferVerificationState({ id: "ver-1", claimId: "claim-1", outcome: "unchecked" }),
    ).toEqual([]);
  });

  it("accepts every checked state carrying its full evidence list + instant", () => {
    for (const outcome of [
      "verified-against-declared-source",
      "not-verifiable",
      "contradicted",
    ] as const) {
      expect(validateOfferVerificationState({ ...fullChecked, outcome })).toEqual([]);
    }
  });

  it("rejects an unchecked record that carries check evidence", () => {
    const withWhen = validateOfferVerificationState({
      id: "ver-1",
      claimId: "claim-1",
      outcome: "unchecked",
      checkedAt: ISO_LATER,
    });
    expect(withWhen[0]?.code).toBe("unchecked-carries-evidence");
    const withSources = validateOfferVerificationState({
      id: "ver-1",
      claimId: "claim-1",
      outcome: "unchecked",
      declaredSources: [{ source: "x" }],
    });
    expect(withSources[0]?.code).toBe("unchecked-carries-evidence");
  });

  it("rejects a checked record without its evidence list (no bare badges)", () => {
    const noEvidence = validateOfferVerificationState({
      id: "ver-1",
      claimId: "claim-1",
      checkedAt: ISO_LATER,
      outcome: "verified-against-declared-source",
    });
    expect(noEvidence[0]?.code).toBe("checked-missing-evidence");
    const noWhen = validateOfferVerificationState({
      id: "ver-1",
      claimId: "claim-1",
      declaredSources: [{ source: "x" }],
      outcome: "contradicted",
    });
    expect(noWhen[0]?.code).toBe("checked-missing-evidence");
    // An EMPTY evidence list is not "missing evidence" — it is a malformed
    // record (the honest-absent discipline: absent means absent, an array
    // present must be non-empty), so the schema rejects it first.
    const emptyEvidence = validateOfferVerificationState({
      id: "ver-1",
      claimId: "claim-1",
      declaredSources: [],
      checkedAt: ISO_LATER,
      outcome: "not-verifiable",
    });
    expect(emptyEvidence[0]?.code).toBe("invalid-shape");
  });

  it("rejects malformed records as invalid shapes", () => {
    expect(validateOfferVerificationState({ id: "v" })[0]?.code).toBe("invalid-shape");
    expect(validateOfferVerificationState(undefined)[0]?.code).toBe("invalid-shape");
  });
});

describe("validateOfferVerificationTransition (unchecked -> checked only)", () => {
  const before = { id: "ver-1", claimId: "claim-1", outcome: "unchecked" };
  const after = {
    id: "ver-1",
    claimId: "claim-1",
    declaredSources: [{ source: "acme.example terms", url: "https://acme.example/terms" }],
    checkedAt: ISO_LATER,
    outcome: "verified-against-declared-source",
  };

  it("accepts unchecked -> each checked state (same record, same claim)", () => {
    for (const outcome of [
      "verified-against-declared-source",
      "not-verifiable",
      "contradicted",
    ] as const) {
      expect(validateOfferVerificationTransition(before, { ...after, outcome })).toEqual([]);
    }
  });

  it("rejects a re-transition FROM a checked state (a re-verification is a new record)", () => {
    const violations = validateOfferVerificationTransition(after, {
      ...after,
      declaredSources: [{ source: "a fresher source" }],
    });
    expect(violations[0]?.code).toBe("transition-from-checked");
  });

  it("rejects a transition TO unchecked", () => {
    const violations = validateOfferVerificationTransition(before, before);
    expect(violations[0]?.code).toBe("transition-to-unchecked");
  });

  it("rejects transitions across different records or claims", () => {
    const differentRecord = validateOfferVerificationTransition(before, { ...after, id: "ver-2" });
    expect(differentRecord[0]?.code).toBe("different-records");
    const differentClaim = validateOfferVerificationTransition(before, {
      ...after,
      claimId: "claim-2",
    });
    expect(differentClaim[0]?.code).toBe("different-claims");
  });

  it("rejects malformed pair members as invalid shapes", () => {
    expect(validateOfferVerificationTransition({ id: "x" }, after)[0]?.code).toBe(
      "invalid-before-shape",
    );
    expect(validateOfferVerificationTransition(before, { id: "x" })[0]?.code).toBe(
      "invalid-after-shape",
    );
  });
});
