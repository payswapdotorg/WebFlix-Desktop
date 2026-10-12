/**
 * Round-trip + rejection tests for the Ad Center contract shapes
 * (P5-CONTRACTS) — same house pattern as intelligence.test.ts:
 * known-good instances parse and round-trip unchanged (including
 * through JSON), known-bad instances are rejected by safeParse, and the
 * honest-absent optionals round-trip ABSENT (a source that reports
 * nothing yields a record without the field — never a fabricated
 * default). The state-machine pairing (bare unchecked / full-evidence
 * checked) and the offset discipline live in the DOMAIN invariants and
 * are tested in webflix-domain (ads-invariants.test.ts).
 */
import { describe, expect, it } from "vitest";
import * as contracts from "../index";
import {
  ErrorCode,
  ErrorCodeSchema,
  AdProvenanceSchema,
  AdvertiserVerificationStateSchema,
  AdvertiserIdentitySchema,
  AdServingPeriodSchema,
  AdRecordSchema,
  ClaimSchema,
  EvidenceNodeKindSchema,
  EvidenceRelationshipSchema,
  EvidenceLinkSchema,
  ReviewSignalSchema,
  OfferVerificationStateSchema,
  VerificationSourceSchema,
  OfferVerificationSchema,
  AdQualificationPolicyVersionSchema,
  AdEvidencePointerSchema,
  QualificationReasonSchema,
  QualificationExplanationSchema,
} from "../index";

const ISO = "2026-10-12T00:00:00Z";
const ISO_LATER = "2026-10-20T12:30:00Z";

function expectRoundTrip(schema: { parse(value: unknown): unknown }, valid: unknown): void {
  const parsed = schema.parse(valid);
  expect(parsed).toEqual(valid);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(valid);
}

function expectRejected(
  schema: { safeParse(value: unknown): { success: boolean } },
  invalid: unknown,
): void {
  expect(schema.safeParse(invalid).success).toBe(false);
}

const provenance = {
  source: "meta-ad-library",
  observedAt: ISO,
  importedAt: ISO_LATER,
  importBatchId: "batch-001",
};

const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months!";

const adRecord = {
  id: "ad-1",
  sourceAdId: "999123",
  advertiserIdentityId: "adv-1",
  creativeText: CREATIVE_TEXT,
  creativeUrls: ["https://acme.example/offer"],
  regions: ["US", "DE"],
  periods: [{ start: ISO, end: ISO_LATER }],
  provenance,
};

const claim = {
  id: "claim-1",
  adRecordId: "ad-1",
  quote: "50% off your first 3 months",
  startOffset: CREATIVE_TEXT.indexOf("50% off your first 3 months"),
  endOffset:
    CREATIVE_TEXT.indexOf("50% off your first 3 months") + "50% off your first 3 months".length,
};

const reviewSignal = {
  id: "rev-1",
  source: "streaming-reviews.example",
  asReportedRating: "3.1/5",
  asReportedClassification: "mixed",
  region: "US",
  scope: "streaming services",
  provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
};

describe("ads contract schemas", () => {
  it("re-exports the ads value surface", () => {
    const adsValueExports = [
      "AdProvenanceSchema",
      "AdvertiserVerificationStateSchema",
      "AdvertiserIdentitySchema",
      "AdServingPeriodSchema",
      "AdRecordSchema",
      "ClaimSchema",
      "EvidenceNodeKindSchema",
      "EvidenceRelationshipSchema",
      "EvidenceLinkSchema",
      "ReviewSignalSchema",
      "OfferVerificationStateSchema",
      "VerificationSourceSchema",
      "OfferVerificationSchema",
      "AdQualificationPolicyVersionSchema",
      "AdEvidencePointerSchema",
      "QualificationReasonSchema",
      "QualificationExplanationSchema",
    ];
    for (const name of adsValueExports) {
      expect(contracts, `missing ads export: ${name}`).toHaveProperty(name);
    }
  });

  it("the ads/* error codes are part of the ErrorCode vocabulary", () => {
    for (const code of [
      "ads/record-invalid",
      "ads/claim-invalid",
      "ads/evidence-invalid",
      "ads/verification-invalid",
    ]) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(ErrorCode.AdsRecordInvalid).toBe("ads/record-invalid");
    expect(ErrorCode.AdsClaimInvalid).toBe("ads/claim-invalid");
    expect(ErrorCode.AdsEvidenceInvalid).toBe("ads/evidence-invalid");
    expect(ErrorCode.AdsVerificationInvalid).toBe("ads/verification-invalid");
  });

  describe("AdProvenance", () => {
    it("round-trips a full provenance and an honest-absent observation", () => {
      expectRoundTrip(AdProvenanceSchema, provenance);
      expectRoundTrip(AdProvenanceSchema, {
        source: "user-import",
        importedAt: ISO_LATER,
        importBatchId: "batch-002",
      });
    });

    it("rejects a missing source, instant or batch id", () => {
      expectRejected(AdProvenanceSchema, { importedAt: ISO, importBatchId: "b" });
      expectRejected(AdProvenanceSchema, { source: "s", importBatchId: "b" });
      expectRejected(AdProvenanceSchema, { source: "s", importedAt: ISO });
      expectRejected(AdProvenanceSchema, {
        source: "s",
        importedAt: "yesterday",
        importBatchId: "b",
      });
    });
  });

  describe("AdvertiserIdentity", () => {
    it("round-trips a full identity AND a bare id+source (absent means absent)", () => {
      expectRoundTrip(AdvertiserIdentitySchema, {
        id: "adv-1",
        source: "meta-ad-library",
        sourceAdvertiserId: "12345",
        names: ["Acme Streaming GmbH", "Acme"],
        regions: ["US", "DE"],
        verificationState: "source-reported-verified",
        reportedAt: ISO,
      });
      expectRoundTrip(AdvertiserIdentitySchema, { id: "adv-2", source: "user-import" });
    });

    it("rejects empty arrays, bad regions, foreign verification states, bad instants", () => {
      expectRejected(AdvertiserIdentitySchema, { id: "a", source: "s", names: [] });
      expectRejected(AdvertiserIdentitySchema, { id: "a", source: "s", regions: ["usa"] });
      expectRejected(AdvertiserIdentitySchema, {
        id: "a",
        source: "s",
        verificationState: "verified",
      });
      expectRejected(AdvertiserIdentitySchema, { id: "a", source: "s", reportedAt: "2026" });
    });

    it("the verification-state enum is source-reported only", () => {
      expect(AdvertiserVerificationStateSchema.options).toEqual([
        "source-reported-verified",
        "source-reported-unverified",
        "source-reported-revoked",
      ]);
    });
  });

  describe("AdServingPeriod + AdRecord", () => {
    it("round-trips an open period (absent end = still running)", () => {
      expectRoundTrip(AdServingPeriodSchema, { start: ISO });
      expectRoundTrip(AdServingPeriodSchema, { start: ISO, end: ISO_LATER });
    });

    it("rejects a period ending before it starts", () => {
      expectRejected(AdServingPeriodSchema, { start: ISO_LATER, end: ISO });
    });

    it("round-trips a full record AND a minimal one (honest-absent creatives)", () => {
      expectRoundTrip(AdRecordSchema, adRecord);
      expectRoundTrip(AdRecordSchema, {
        id: "ad-2",
        advertiserIdentityId: "adv-1",
        provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
      });
    });

    it("rejects empty arrays, bad URLs and a missing provenance", () => {
      expectRejected(AdRecordSchema, { ...adRecord, creativeUrls: [] });
      expectRejected(AdRecordSchema, { ...adRecord, regions: [] });
      expectRejected(AdRecordSchema, { ...adRecord, periods: [] });
      expectRejected(AdRecordSchema, { ...adRecord, creativeUrls: ["not-a-url"] });
      expectRejected(AdRecordSchema, { id: "ad-1", advertiserIdentityId: "adv-1" });
    });
  });

  describe("Claim", () => {
    it("round-trips an extractive claim (offsets computed from the source text)", () => {
      expectRoundTrip(ClaimSchema, claim);
    });

    it("rejects empty spans, non-integer and negative offsets, missing refs", () => {
      expectRejected(ClaimSchema, { ...claim, startOffset: claim.endOffset });
      expectRejected(ClaimSchema, { ...claim, endOffset: claim.startOffset });
      expectRejected(ClaimSchema, { ...claim, startOffset: -1 });
      expectRejected(ClaimSchema, { ...claim, startOffset: 1.5 });
      expectRejected(ClaimSchema, { ...claim, quote: "" });
      expectRejected(ClaimSchema, { id: "claim-1", quote: "x", startOffset: 0, endOffset: 1 });
    });
  });

  describe("EvidenceLink", () => {
    const base = { id: "edge-1", claimId: "claim-1", relationship: "supports", provenance };

    it("round-trips all four node kinds", () => {
      expectRoundTrip(EvidenceLinkSchema, {
        ...base,
        kind: "source-reported-fact",
        url: "https://acme.example/pricing",
        asReportedText: "First 3 months at 50% discount for new subscribers.",
      });
      expectRoundTrip(EvidenceLinkSchema, {
        ...base,
        kind: "independent-review",
        reviewSignalId: "rev-1",
      });
      expectRoundTrip(EvidenceLinkSchema, {
        ...base,
        kind: "offer-terms",
        url: "https://acme.example/terms",
        declaredTermsExcerpt: "Discount applies to new subscribers only.",
      });
      expectRoundTrip(EvidenceLinkSchema, {
        ...base,
        kind: "user-imported-document",
        documentId: "doc-42",
      });
    });

    it("rejects unknown kinds, unknown relationships, and per-kind missing locators", () => {
      expectRejected(EvidenceLinkSchema, { ...base, kind: "hearsay" });
      expectRejected(EvidenceLinkSchema, { ...base, relationship: "proves" });
      expectRejected(EvidenceLinkSchema, {
        ...base,
        kind: "source-reported-fact",
        asReportedText: "x",
      });
      expectRejected(EvidenceLinkSchema, { ...base, kind: "independent-review" });
      expectRejected(EvidenceLinkSchema, { ...base, kind: "offer-terms", url: "not-a-url" });
      expectRejected(EvidenceLinkSchema, { ...base, kind: "user-imported-document" });
    });

    it("the enums are the charter's closed sets", () => {
      expect(EvidenceNodeKindSchema.options).toEqual([
        "source-reported-fact",
        "independent-review",
        "offer-terms",
        "user-imported-document",
      ]);
      expect(EvidenceRelationshipSchema.options).toEqual([
        "supports",
        "contradicts",
        "contextualizes",
      ]);
    });
  });

  describe("ReviewSignal", () => {
    it("round-trips a full signal, a rating-only one and a classification-only one", () => {
      expectRoundTrip(ReviewSignalSchema, reviewSignal);
      expectRoundTrip(ReviewSignalSchema, {
        id: "rev-2",
        source: "bbb.example",
        asReportedRating: "A+",
        provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
      });
      expectRoundTrip(ReviewSignalSchema, {
        id: "rev-3",
        source: "regulator-registry.example",
        asReportedClassification: "not-accredited",
        region: "DE",
        provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
      });
    });

    it("rejects a signal reporting neither rating nor classification (not a review)", () => {
      expectRejected(ReviewSignalSchema, {
        id: "rev-4",
        source: "s.example",
        provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
      });
    });

    it("rejects empty-string reports and bad regions", () => {
      expectRejected(ReviewSignalSchema, { ...reviewSignal, asReportedRating: "" });
      expectRejected(ReviewSignalSchema, { ...reviewSignal, region: "DEU" });
    });
  });

  describe("OfferVerification", () => {
    const checkedBase = {
      id: "ver-1",
      claimId: "claim-1",
      declaredSources: [
        {
          source: "acme.example pricing page",
          url: "https://acme.example/pricing",
          asReported: "50% off the first 3 months for new subscribers",
        },
      ],
      checkedAt: ISO_LATER,
    };

    it("round-trips a BARE unchecked record and all three checked states (full evidence)", () => {
      expectRoundTrip(OfferVerificationSchema, {
        id: "ver-1",
        claimId: "claim-1",
        outcome: "unchecked",
      });
      expectRoundTrip(OfferVerificationSchema, {
        ...checkedBase,
        outcome: "verified-against-declared-source",
      });
      expectRoundTrip(OfferVerificationSchema, { ...checkedBase, outcome: "not-verifiable" });
      expectRoundTrip(OfferVerificationSchema, { ...checkedBase, outcome: "contradicted" });
    });

    it("round-trips a verification source that is neither linkable nor quoted (honest-absent)", () => {
      expectRoundTrip(VerificationSourceSchema, { source: "a named printed catalogue" });
      expectRoundTrip(VerificationSourceSchema, {
        source: "acme.example",
        url: "https://acme.example/pricing",
        asReported: "the discount is real",
      });
    });

    it("rejects a bare verified badge, unknown outcomes, and empty evidence lists", () => {
      expectRejected(OfferVerificationSchema, { id: "v", claimId: "c", outcome: "verified" });
      expectRejected(OfferVerificationSchema, { id: "v", claimId: "c" });
      expectRejected(OfferVerificationSchema, {
        ...checkedBase,
        declaredSources: [],
        outcome: "contradicted",
      });
      expectRejected(OfferVerificationSchema, {
        id: "v",
        claimId: "c",
        declaredSources: [{ source: "" }],
        checkedAt: ISO_LATER,
        outcome: "unchecked",
      });
    });

    it("the outcome enum is the charter's four states, verbatim", () => {
      expect(OfferVerificationStateSchema.options).toEqual([
        "unchecked",
        "verified-against-declared-source",
        "not-verifiable",
        "contradicted",
      ]);
    });
  });

  describe("QualificationExplanation", () => {
    it("round-trips an unqualified explanation with claim + verification pointers", () => {
      expectRoundTrip(QualificationExplanationSchema, {
        policyVersion: "v1",
        qualified: false,
        reasons: [
          {
            text: "The offer's central discount claim is contradicted by the advertiser's own terms page.",
            evidence: [
              { kind: "offer-verification", verificationId: "ver-1" },
              { kind: "claim", claimId: "claim-1" },
            ],
          },
        ],
      });
    });

    it("round-trips a qualified explanation with review + coverage + evidence-link pointers", () => {
      expectRoundTrip(QualificationExplanationSchema, {
        policyVersion: "v1",
        qualified: true,
        reasons: [
          {
            text: "The discount claim matches the declared offer terms, an independent review corroborates it, and the source's coverage manifest declares this region.",
            evidence: [
              { kind: "evidence-link", evidenceLinkId: "edge-1" },
              { kind: "review-signal", reviewSignalId: "rev-1" },
              { kind: "source-coverage", source: "meta-ad-library" },
            ],
          },
        ],
      });
    });

    it("rejects unknown policy versions, empty reasons, and reasonless evidence", () => {
      expectRejected(QualificationExplanationSchema, {
        policyVersion: "v2",
        qualified: true,
        reasons: [{ text: "x", evidence: [{ kind: "claim", claimId: "claim-1" }] }],
      });
      expectRejected(QualificationExplanationSchema, {
        policyVersion: "v1",
        qualified: true,
        reasons: [],
      });
      expectRejected(QualificationExplanationSchema, {
        policyVersion: "v1",
        qualified: true,
        reasons: [{ text: "a reason without evidence", evidence: [] }],
      });
      expectRejected(QualificationExplanationSchema, {
        policyVersion: "v1",
        qualified: true,
        reasons: [{ text: "x", evidence: [{ kind: "claim" }] }],
      });
    });

    it("the policy version enum is closed at v1 (its own RankingPolicyVersion-style pin)", () => {
      expect(AdQualificationPolicyVersionSchema.options).toEqual(["v1"]);
    });

    it("the evidence-pointer union covers exactly the five ads-lane pointer kinds", () => {
      for (const pointer of [
        { kind: "claim", claimId: "claim-1" },
        { kind: "evidence-link", evidenceLinkId: "edge-1" },
        { kind: "review-signal", reviewSignalId: "rev-1" },
        { kind: "offer-verification", verificationId: "ver-1" },
        { kind: "source-coverage", source: "meta-ad-library" },
      ]) {
        expectRoundTrip(AdEvidencePointerSchema, pointer);
      }
      expectRejected(AdEvidencePointerSchema, { kind: "artifact", artifactId: "a-1" });
      expectRejected(QualificationReasonSchema, {
        text: "x",
        evidence: [{ kind: "claim", claimId: "" }],
      });
    });
  });
});
