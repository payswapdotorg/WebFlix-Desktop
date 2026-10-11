/**
 * Round-trip + rejection tests for the media-intelligence contract shapes
 * (P4-CONTRACTS) — same house pattern as contracts.test.ts: known-good
 * instances parse and round-trip unchanged (including through JSON), and
 * known-bad instances are rejected by safeParse. The reasons-mandatory
 * rule is additionally proven at the type level (NonEmptyArray) via the
 * @ts-expect-error block at the bottom, checked by the tsc gate.
 */
import { describe, expect, it } from "vitest";
import * as contracts from "../index";
import {
  DerivedArtifactKindSchema,
  DerivedArtifactSchema,
  ErrorCode,
  ErrorCodeSchema,
  EvidencePointerSchema,
  FeedbackEventSchema,
  LibraryFactSchema,
  NonEmptyArray,
  RANKING_POLICY_V1_WEIGHTS,
  RankedItem,
  RankerAdapterSelectionSchema,
  RankingPolicySchema,
  RankingPolicyVersionSchema,
  RankingResultSchema,
  RankingSignalFamilySchema,
  RankingWeightsSchema,
  TimeBudgetsSchema,
  UserObjectiveSchema,
} from "../index";
import type { RankedItem as RankedItemType } from "../index";

const ISO_NOW = "2026-10-11T08:00:00Z";

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

describe("intelligence contract schemas", () => {
  it("re-exports the MI value surface", () => {
    const miValueExports = [
      "TimeBudgetsSchema",
      "UserObjectiveSchema",
      "FeedbackProvenanceSchema",
      "ExplicitFeedbackKindSchema",
      "ImplicitFeedbackKindSchema",
      "FeedbackEventSchema",
      "LibraryFactSchema",
      "RankingSignalFamilySchema",
      "RankingWeightsSchema",
      "RANKING_POLICY_V1_WEIGHTS",
      "RankingPolicyVersionSchema",
      "RankingPolicySchema",
      "EvidencePointerSchema",
      "RankingReasonSchema",
      "RankingEmptyReasonSchema",
      "RankingResultSchema",
      "RankerAdapterSelectionSchema",
      "DerivedArtifactKindSchema",
      "ArtifactLineageSchema",
      "DerivedArtifactSchema",
    ];
    for (const name of miValueExports) {
      expect(contracts, `missing MI export: ${name}`).toHaveProperty(name);
    }
    expect(typeof contracts.RANKING_POLICY_V1_WEIGHTS).toBe("object");
  });

  it("UserObjective round-trips and rejects invalid time budgets", () => {
    expectRoundTrip(UserObjectiveSchema, {
      topicFocuses: ["rust", "cooking"],
      exclusions: ["yoga"],
      timeBudgets: { perSessionMinutes: 30, weeklyMinutes: 300 },
      declaredAt: ISO_NOW,
    });
    expectRoundTrip(UserObjectiveSchema, {
      topicFocuses: [],
      exclusions: [],
      timeBudgets: {},
      declaredAt: ISO_NOW,
    });
    expectRejected(UserObjectiveSchema, {
      topicFocuses: ["rust"],
      exclusions: [],
      timeBudgets: { perSessionMinutes: -5 },
      declaredAt: ISO_NOW,
    });
    expectRejected(UserObjectiveSchema, {
      topicFocuses: [],
      exclusions: [],
      timeBudgets: { perSessionMinutes: 0 },
      declaredAt: ISO_NOW,
    });
    expectRejected(UserObjectiveSchema, {
      topicFocuses: [],
      exclusions: [],
      timeBudgets: { weeklyMinutes: 1.5 },
      declaredAt: ISO_NOW,
    });
    expectRejected(UserObjectiveSchema, {
      topicFocuses: [],
      exclusions: [],
      timeBudgets: {},
      declaredAt: "2026-10-11 08:00:00",
    });
    expectRejected(UserObjectiveSchema, {
      topicFocuses: [""],
      exclusions: [],
      timeBudgets: {},
      declaredAt: ISO_NOW,
    });
    expectRejected(TimeBudgetsSchema, { perSessionMinutes: -1 });
    expect(TimeBudgetsSchema.parse({}).perSessionMinutes).toBeUndefined();
  });

  it("FeedbackEvent round-trips every explicit kind and rejects bad implicit payloads", () => {
    for (const kind of ["thumbs-up", "thumbs-down", "pin", "not-interested"] as const) {
      expectRoundTrip(FeedbackEventSchema, {
        id: `fb-${kind}`,
        itemId: "item-a",
        channel: "explicit",
        kind,
        provenance: { surface: "recommendation-card", capturedAt: ISO_NOW },
      });
    }
    expectRoundTrip(FeedbackEventSchema, {
      id: "fb-wf",
      itemId: "item-a",
      channel: "implicit",
      kind: "watched-fraction",
      value: 0.62,
      provenance: { surface: "watch-screen", capturedAt: ISO_NOW },
    });
    expectRoundTrip(FeedbackEventSchema, {
      id: "fb-skip",
      itemId: "item-a",
      channel: "implicit",
      kind: "skipped-at",
      value: 120,
      provenance: { surface: "watch-screen", capturedAt: ISO_NOW },
    });
    expectRejected(FeedbackEventSchema, {
      id: "fb-bad",
      itemId: "item-a",
      channel: "implicit",
      kind: "watched-fraction",
      value: 1.5,
      provenance: { surface: "watch-screen", capturedAt: ISO_NOW },
    });
    expectRejected(FeedbackEventSchema, {
      id: "fb-bad",
      itemId: "item-a",
      channel: "implicit",
      kind: "skipped-at",
      value: -3,
      provenance: { surface: "watch-screen", capturedAt: ISO_NOW },
    });
    expectRejected(FeedbackEventSchema, {
      id: "fb-bad",
      itemId: "item-a",
      channel: "explicit",
      kind: "watched-fraction",
      provenance: { surface: "watch-screen", capturedAt: ISO_NOW },
    });
    expectRejected(FeedbackEventSchema, {
      id: "",
      itemId: "item-a",
      channel: "implicit",
      kind: "skipped-at",
      value: 10,
      provenance: { surface: "", capturedAt: ISO_NOW },
    });
  });

  it("LibraryFact round-trips and rejects empty titles and negative durations", () => {
    expectRoundTrip(LibraryFactSchema, {
      itemId: "item-a",
      title: "Rust Systems Programming",
      tags: ["programming"],
      durationMs: 1500000,
      addedAt: ISO_NOW,
    });
    expectRoundTrip(LibraryFactSchema, { itemId: "item-b", title: "Cooking Pasta 101", tags: [] });
    expectRejected(LibraryFactSchema, { itemId: "item-b", title: "", tags: [] });
    expectRejected(LibraryFactSchema, {
      itemId: "item-b",
      title: "Cooking Pasta 101",
      durationMs: -1,
    });
  });

  it("RankingPolicy is version-only and v1 is the closed version set", () => {
    expectRoundTrip(RankingPolicySchema, { version: "v1" });
    expectRejected(RankingPolicySchema, { version: "v2" });
    expectRejected(RankingPolicySchema, {});
    expect(RankingPolicyVersionSchema.safeParse("v1").success).toBe(true);
    expect(RankingPolicyVersionSchema.safeParse("v2").success).toBe(false);
  });

  it("RANKING_POLICY_V1_WEIGHTS is a valid RankingWeights table summing to 1", () => {
    expect(RankingWeightsSchema.parse(RANKING_POLICY_V1_WEIGHTS)).toEqual(
      RANKING_POLICY_V1_WEIGHTS,
    );
    const sum =
      RANKING_POLICY_V1_WEIGHTS.libraryAffinity +
      RANKING_POLICY_V1_WEIGHTS.watchHistory +
      RANKING_POLICY_V1_WEIGHTS.explicitFeedback +
      RANKING_POLICY_V1_WEIGHTS.objectiveMatch;
    expect(sum).toBe(1);
    expectRejected(RankingWeightsSchema, { ...RANKING_POLICY_V1_WEIGHTS, libraryAffinity: 1.5 });
  });

  it("RankingResult enforces reasons-mandatory and non-empty items", () => {
    const goodItem: RankedItemType = {
      itemId: "item-a",
      score: 0.42,
      reasons: [
        {
          family: "library-affinity",
          text: "In your library",
          contribution: 0.15,
          evidence: [{ kind: "library-fact", itemId: "item-a" }],
        },
      ],
    };
    expectRoundTrip(RankingResultSchema, {
      kind: "ranked",
      policyVersion: "v1",
      items: [goodItem],
    });
    // reasonless recommendation — the contract violation
    expectRejected(RankingResultSchema, {
      kind: "ranked",
      policyVersion: "v1",
      items: [{ itemId: "item-a", score: 0.42, reasons: [] }],
    });
    // reason without evidence
    expectRejected(RankingResultSchema, {
      kind: "ranked",
      policyVersion: "v1",
      items: [
        {
          itemId: "item-a",
          score: 0.42,
          reasons: [{ family: "library-affinity", text: "x", contribution: 0.1, evidence: [] }],
        },
      ],
    });
    // empty ranked list must use the honest-empty variant instead
    expectRejected(RankingResultSchema, { kind: "ranked", policyVersion: "v1", items: [] });
    expectRejected(RankingResultSchema, {
      kind: "ranked",
      policyVersion: "v1",
      items: [{ itemId: "item-a", score: 1.5, reasons: goodItem.reasons }],
    });
    for (const reason of ["empty-catalog", "no-local-signals", "no-ranked-candidates"] as const) {
      expectRoundTrip(RankingResultSchema, { kind: "empty", policyVersion: "v1", reason });
    }
    expectRejected(RankingResultSchema, { kind: "empty", policyVersion: "v1", reason: "made-up" });
  });

  it("EvidencePointer covers all four pointer kinds and rejects unknown ones", () => {
    expectRoundTrip(EvidencePointerSchema, { kind: "feedback-event", eventId: "fb-001" });
    expectRoundTrip(EvidencePointerSchema, { kind: "library-fact", itemId: "item-a" });
    expectRoundTrip(EvidencePointerSchema, { kind: "watched-state", itemId: "item-a" });
    expectRoundTrip(EvidencePointerSchema, { kind: "objective", field: "topicFocuses" });
    expectRoundTrip(EvidencePointerSchema, {
      kind: "objective",
      field: "timeBudgets.perSessionMinutes",
    });
    expectRejected(EvidencePointerSchema, { kind: "objective", field: "made-up" });
    expectRejected(EvidencePointerSchema, { kind: "catalog-item", itemId: "item-a" });
    expectRejected(EvidencePointerSchema, { kind: "feedback-event", eventId: "" });
  });

  it("RankingSignalFamily is the closed four-family set", () => {
    for (const family of [
      "library-affinity",
      "watch-history",
      "explicit-feedback",
      "objective-match",
    ] as const) {
      expect(RankingSignalFamilySchema.safeParse(family).success).toBe(true);
    }
    expect(RankingSignalFamilySchema.safeParse("provider-ml").success).toBe(false);
  });

  it("DerivedArtifact round-trips all six kinds and rejects the closed set violations", () => {
    for (const kind of [
      "transcript",
      "summary",
      "overview",
      "translation",
      "dubbing",
      "qa",
    ] as const) {
      expectRoundTrip(DerivedArtifactSchema, {
        id: `art-${kind}`,
        sourceItemId: "item-a",
        kind,
        lineage: {
          modelId: "whisper-small",
          modelVersion: "2026-09",
          producedBy: "webflix.transcribe.adapter",
          generatedAt: ISO_NOW,
          inputsHash: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        },
        licenseNote: "model output; check the model license before redistribution",
        createdAt: ISO_NOW,
      });
      expect(DerivedArtifactKindSchema.safeParse(kind).success).toBe(true);
    }
    // TTS is honestly NOT a derived-artifact kind this order (work-order kind list)
    expect(DerivedArtifactKindSchema.safeParse("tts").success).toBe(false);
    expect(DerivedArtifactKindSchema.safeParse("remix").success).toBe(false);
    expectRoundTrip(DerivedArtifactSchema, {
      id: "art-null",
      sourceItemId: "item-a",
      kind: "summary",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p", generatedAt: ISO_NOW },
      licenseNote: null,
      createdAt: ISO_NOW,
    });
    expectRejected(DerivedArtifactSchema, {
      id: "art-bad",
      sourceItemId: "",
      kind: "summary",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p", generatedAt: ISO_NOW },
      licenseNote: null,
      createdAt: ISO_NOW,
    });
    expectRejected(DerivedArtifactSchema, {
      id: "art-bad",
      sourceItemId: "item-a",
      kind: "summary",
      lineage: { modelVersion: "1", producedBy: "p", generatedAt: ISO_NOW },
      licenseNote: null,
      createdAt: ISO_NOW,
    });
  });

  it("ErrorCode carries the seven MI codes and they parse through the schema", () => {
    const miCodes = [
      ErrorCode.IntelligencePolicyUnsupported,
      ErrorCode.IntelligenceObjectiveInvalid,
      ErrorCode.IntelligenceFeedbackInvalid,
      ErrorCode.IntelligenceFeedbackConflict,
      ErrorCode.IntelligenceRankingInvalid,
      ErrorCode.IntelligenceArtifactInvalid,
      // P4-ADAPTERS (0.3.0) — the additive selection code.
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    ] as const;
    expect(miCodes).toEqual([
      "intelligence/policy-unsupported",
      "intelligence/objective-invalid",
      "intelligence/feedback-invalid",
      "intelligence/feedback-conflict",
      "intelligence/ranking-invalid",
      "intelligence/artifact-invalid",
      "intelligence/adapter-selection-invalid",
    ]);
    for (const code of miCodes) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("RankerAdapterSelection round-trips and rejects empty ids / non-ISO instants (P4-ADAPTERS)", () => {
    expectRoundTrip(RankerAdapterSelectionSchema, {
      adapterId: "webflix.built-in-ranker",
      selectedAt: ISO_NOW,
    });
    // The record is deliberately tiny: no silent defaults; empty ids and
    // non-ISO instants are rejected (unknown keys strip, per zod house default).
    expectRejected(RankerAdapterSelectionSchema, { adapterId: "", selectedAt: ISO_NOW });
    expectRejected(RankerAdapterSelectionSchema, {
      adapterId: "webflix.built-in-ranker",
      selectedAt: "2026-10-11 08:00:00",
    });
  });
});

describe("NonEmptyArray type-level enforcement (checked by tsc)", () => {
  it("accepts a tuple and rejects an empty array at compile time", () => {
    const one: NonEmptyArray<string> = ["head", "tail"];
    expect(one.length).toBeGreaterThan(0);
    // @ts-expect-error — an empty array is not a NonEmptyArray; the reasons
    // field of RankedItem cannot be constructed empty without a cast.
    const empty: NonEmptyArray<string> = [];
    expect(empty.length).toBe(0);
    // The RankedItem reasons field is NonEmptyArray-typed: constructing an
    // item with empty reasons is a compile error (see @ts-expect-error below).
    // @ts-expect-error
    const reasonless: RankedItem = { itemId: "x", score: 0.5, reasons: [] };
    expect(reasonless).toBeTruthy();
  });
});
