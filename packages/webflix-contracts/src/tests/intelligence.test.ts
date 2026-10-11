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
  TranscriptSegmentSchema,
  TranscriptionEngineDescriptorSchema,
  TranscriptionRequestSchema,
  TranscriptionResultSchema,
  UserObjectiveSchema,
  OverviewChapterSchema,
  OverviewRequestSchema,
  OverviewResultSchema,
  QaAnswerSchema,
  QaRequestSchema,
  QaSpanSchema,
  SummaryEngineDescriptorSchema,
  SummaryRequestSchema,
  SummaryResultSchema,
  SummarySentenceSchema,
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
      // P4-TRANSCRIBE (0.4.0) — the transcription-engine seam's value surface.
      "TranscriptionEngineDescriptorSchema",
      "TranscriptionRequestSchema",
      "TranscriptSegmentSchema",
      "TranscriptionResultSchema",
      // P4-SUMMARIZE (0.5.0) — the text-intelligence seam's value surface.
      "SummaryEngineDescriptorSchema",
      "SummaryRequestSchema",
      "SummaryResultSchema",
      "OverviewRequestSchema",
      "OverviewResultSchema",
      "QaRequestSchema",
      "QaAnswerSchema",
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

  it("ErrorCode carries the twelve MI codes and they parse through the schema", () => {
    const miCodes = [
      ErrorCode.IntelligencePolicyUnsupported,
      ErrorCode.IntelligenceObjectiveInvalid,
      ErrorCode.IntelligenceFeedbackInvalid,
      ErrorCode.IntelligenceFeedbackConflict,
      ErrorCode.IntelligenceRankingInvalid,
      ErrorCode.IntelligenceArtifactInvalid,
      // P4-ADAPTERS (0.3.0) — the additive selection code.
      ErrorCode.IntelligenceAdapterSelectionInvalid,
      // P4-TRANSCRIBE (0.4.0) — the additive transcription lane codes.
      ErrorCode.IntelligenceTranscriptionInvalid,
      ErrorCode.IntelligenceEngineUnavailable,
      ErrorCode.IntelligenceEngineFailed,
      // P4-SUMMARIZE (0.5.0) — the additive text-intelligence lane codes.
      ErrorCode.IntelligenceSummaryInvalid,
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    ] as const;
    expect(miCodes).toEqual([
      "intelligence/policy-unsupported",
      "intelligence/objective-invalid",
      "intelligence/feedback-invalid",
      "intelligence/feedback-conflict",
      "intelligence/ranking-invalid",
      "intelligence/artifact-invalid",
      "intelligence/adapter-selection-invalid",
      "intelligence/transcription-invalid",
      "intelligence/engine-unavailable",
      "intelligence/engine-failed",
      "intelligence/summary-invalid",
      "intelligence/transcript-payload-absent",
    ]);
    for (const code of miCodes) {
      expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    }
    // Typed cancellation reuses the cross-cutting common/cancelled — the
    // transcription and text-intelligence lanes deliberately add NO
    // cancelled code of their own.
    expect(ErrorCode.Cancelled).toBe("common/cancelled");
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

  it("re-exports the transcription value surface (P4-TRANSCRIBE)", () => {
    const transcriptionExports = [
      "TranscriptionEngineDescriptorSchema",
      "TranscriptionRequestSchema",
      "TranscriptSegmentSchema",
      "TranscriptionResultSchema",
    ];
    for (const name of transcriptionExports) {
      expect(contracts, `missing transcription export: ${name}`).toHaveProperty(name);
    }
  });

  it("TranscriptionEngineDescriptor round-trips honest lineage and rejects blanks (P4-TRANSCRIBE)", () => {
    // Fully populated: adapter identity + every engine-reported fact present.
    expectRoundTrip(TranscriptionEngineDescriptorSchema, {
      id: "webflix.whisper-cpp-local",
      label: "whisper.cpp (local)",
      version: "0.1.0",
      engineVersion: "1.7.4",
      modelLineage: "ggml-base.en-q5_1",
      licenseNote: "whisper.cpp is MIT licensed (model licenses vary)",
    });
    // The honest minimum: adapter identity known; every engine-reported fact
    // ABSENT (the engine reported nothing — absent means absent) + null license.
    expectRoundTrip(TranscriptionEngineDescriptorSchema, {
      id: "webflix.whisper-cpp-local",
      label: "whisper.cpp (local)",
      version: "0.1.0",
      licenseNote: null,
    });
    // Blank identity fields are caller defects.
    expectRejected(TranscriptionEngineDescriptorSchema, {
      id: "",
      label: "x",
      version: "0.1.0",
      licenseNote: null,
    });
    expectRejected(TranscriptionEngineDescriptorSchema, {
      id: "webflix.whisper-cpp-local",
      label: "  ",
      version: "0.1.0",
      licenseNote: null,
    });
    // engineVersion/modelLineage are min(1): an engine that reports an EMPTY
    // string reported nothing — the honest value is ABSENT, not "".
    expectRejected(TranscriptionEngineDescriptorSchema, {
      id: "webflix.whisper-cpp-local",
      label: "whisper.cpp (local)",
      version: "0.1.0",
      engineVersion: "",
      licenseNote: null,
    });
  });

  it("TranscriptionRequest round-trips with/without the language hint (P4-TRANSCRIBE)", () => {
    expectRoundTrip(TranscriptionRequestSchema, {
      mediaPath: "/home/z/media/rust-talk.mp4",
    });
    expectRoundTrip(TranscriptionRequestSchema, {
      mediaPath: "/home/z/media/rust-talk.mp4",
      language: "en",
    });
    expectRejected(TranscriptionRequestSchema, { mediaPath: "" });
    // Whitespace-only strings are BLANKS: trim-then-min(1) rejects them
    // (the same anti-blank guarantee the descriptor schema carries).
    expectRejected(TranscriptionRequestSchema, { mediaPath: "   " });
    expectRejected(TranscriptionRequestSchema, { mediaPath: "/x.mp4", language: "" });
    expectRejected(TranscriptionRequestSchema, { mediaPath: "/x.mp4", language: "  " });
    expectRejected(TranscriptionRequestSchema, {});
  });

  it("TranscriptSegment enforces integer ms, non-negative, non-empty text, endMs >= startMs (P4-TRANSCRIBE)", () => {
    expectRoundTrip(TranscriptSegmentSchema, {
      startMs: 0,
      endMs: 1500,
      text: "Hello, and welcome back.",
    });
    expectRoundTrip(TranscriptSegmentSchema, { startMs: 1500, endMs: 1500, text: "— pause —" });
    // Padded text normalizes to the trimmed canonical form (whitespace
    // around a segment's text is not transcript content).
    expect(TranscriptSegmentSchema.parse({ startMs: 0, endMs: 1500, text: " hi " })).toEqual({
      startMs: 0,
      endMs: 1500,
      text: "hi",
    });
    expectRejected(TranscriptSegmentSchema, { startMs: -1, endMs: 100, text: "x" });
    expectRejected(TranscriptSegmentSchema, { startMs: 0.5, endMs: 100, text: "x" });
    expectRejected(TranscriptSegmentSchema, { startMs: 0, endMs: 1500.5, text: "x" });
    expectRejected(TranscriptSegmentSchema, { startMs: 100, endMs: 99, text: "x" });
    expectRejected(TranscriptSegmentSchema, { startMs: 0, endMs: 100, text: "" });
    expectRejected(TranscriptSegmentSchema, { startMs: 0, endMs: 100, text: "   " });
    expectRejected(TranscriptSegmentSchema, { startMs: 0, endMs: 100 });
  });

  it("TranscriptionResult accepts the honest empty and rejects per-run lineage violations (P4-TRANSCRIBE)", () => {
    // Zero segments is the honest "engine reported no speech" outcome.
    expectRoundTrip(TranscriptionResultSchema, { segments: [] });
    // Per-run facts all present (the engine reported them for THIS run).
    expectRoundTrip(TranscriptionResultSchema, {
      segments: [
        { startMs: 0, endMs: 1200, text: "one" },
        { startMs: 1200, endMs: 2400, text: "two" },
      ],
      language: "en",
      engineVersion: "1.7.4",
      modelLineage: "ggml-base.en-q5_1",
    });
    // Bad segments are rejected through composition.
    expectRejected(TranscriptionResultSchema, {
      segments: [{ startMs: 500, endMs: 100, text: "backwards" }],
    });
    expectRejected(TranscriptionResultSchema, {
      segments: [{ startMs: 0, endMs: 100, text: "x" }],
      language: "",
    });
    expectRejected(TranscriptionResultSchema, {
      segments: [],
      engineVersion: "",
    });
    expectRejected(TranscriptionResultSchema, {
      segments: [],
      modelLineage: "",
    });
    // A whitespace-only lineage report reported nothing: blank, rejected.
    expectRejected(TranscriptionResultSchema, {
      segments: [],
      engineVersion: "   ",
    });
  });

  it("SummaryEngineDescriptor round-trips honest lineage and rejects blanks (P4-SUMMARIZE)", () => {
    // Fully populated: adapter identity + every model-reported fact present.
    expectRoundTrip(SummaryEngineDescriptorSchema, {
      id: "webflix.built-in-summary-engine",
      label: "Built-in extractive engine (deterministic)",
      version: "0.1.0",
      licenseNote: null,
    });
    // An adapter wrapping an external model: identity ours, lineage honestly
    // read from the model's own output, license note carried.
    expectRoundTrip(SummaryEngineDescriptorSchema, {
      id: "webflix.some-model-adapter",
      label: "Some local model (user-selected)",
      version: "0.2.1",
      engineVersion: "2.0.7",
      modelLineage: "some-model-instruct-v2",
      licenseNote: "check the model license before redistribution",
    });
    // Blank identity fields are caller defects (trim-then-min(1)).
    expectRejected(SummaryEngineDescriptorSchema, {
      id: "  ",
      label: "x",
      version: "0.1.0",
      licenseNote: null,
    });
    expectRejected(SummaryEngineDescriptorSchema, {
      id: "webflix.built-in-summary-engine",
      label: "Built-in extractive engine (deterministic)",
      version: "",
      licenseNote: null,
    });
    // An EMPTY engineVersion is an absent fact reported as "" — blank, rejected.
    expectRejected(SummaryEngineDescriptorSchema, {
      id: "webflix.built-in-summary-engine",
      label: "Built-in extractive engine (deterministic)",
      version: "0.1.0",
      engineVersion: "",
      licenseNote: null,
    });
  });

  it("SummaryRequest/Result round-trip source-ordered sentences and reject citation defects (P4-SUMMARIZE)", () => {
    const segments = [
      { startMs: 0, endMs: 1500, text: "hello" },
      { startMs: 1500, endMs: 3000, text: "brave world" },
    ];
    expectRoundTrip(SummaryRequestSchema, { segments });
    // The honest empty request: a no-speech transcript.
    expectRoundTrip(SummaryRequestSchema, { segments: [] });
    // Bad segments are rejected through composition.
    expectRejected(SummaryRequestSchema, { segments: [{ startMs: 500, endMs: 100, text: "x" }] });

    expectRoundTrip(SummaryResultSchema, {
      sentences: [
        { text: "brave world", segmentIndex: 1, startMs: 1500, endMs: 3000 },
        { text: "hello", segmentIndex: 0, startMs: 0, endMs: 1500 },
      ],
    });
    // The honest empty summary is representable (never an error upstream).
    expectRoundTrip(SummaryResultSchema, { sentences: [] });
    // Quote discipline at the schema floor: blank sentence text is a defect.
    expectRejected(SummaryResultSchema, {
      sentences: [{ text: "   ", segmentIndex: 0, startMs: 0, endMs: 1500 }],
    });
    // Negative citations / fractional ms are defects.
    expectRejected(SummaryResultSchema, {
      sentences: [{ text: "x", segmentIndex: -1, startMs: 0, endMs: 1500 }],
    });
    expectRejected(SummaryResultSchema, {
      sentences: [{ text: "x", segmentIndex: 0, startMs: 0.5, endMs: 1500 }],
    });
    // Padded sentence text normalizes to the trimmed canonical form.
    expect(
      SummaryResultSchema.parse({
        sentences: [{ text: " hi ", segmentIndex: 0, startMs: 0, endMs: 1500 }],
      }),
    ).toEqual({ sentences: [{ text: "hi", segmentIndex: 0, startMs: 0, endMs: 1500 }] });
    // The sentence schema is exported surface too.
    expectRoundTrip(SummarySentenceSchema, {
      text: "hello",
      segmentIndex: 0,
      startMs: 0,
      endMs: 1500,
    });
  });

  it("OverviewRequest/Result round-trip timeline chapters and reject range defects (P4-SUMMARIZE)", () => {
    expectRoundTrip(OverviewRequestSchema, {
      segments: [{ startMs: 0, endMs: 1500, text: "hello" }],
    });
    expectRoundTrip(OverviewRequestSchema, { segments: [] });

    expectRoundTrip(OverviewResultSchema, {
      chapters: [
        { title: "deployment · testing", startMs: 0, endMs: 300000, segmentCount: 10 },
        { title: "chapter 2", startMs: 300000, endMs: 600000, segmentCount: 8 },
      ],
    });
    expectRoundTrip(OverviewResultSchema, { chapters: [] });
    expectRejected(OverviewResultSchema, {
      chapters: [{ title: "", startMs: 0, endMs: 300000, segmentCount: 10 }],
    });
    expectRejected(OverviewResultSchema, {
      chapters: [{ title: "   ", startMs: 0, endMs: 300000, segmentCount: 10 }],
    });
    // endMs < startMs is a range defect (the TranscriptSegment rule).
    expectRejected(OverviewResultSchema, {
      chapters: [{ title: "x", startMs: 300000, endMs: 0, segmentCount: 10 }],
    });
    // An empty chapter is never emitted — segmentCount >= 1.
    expectRejected(OverviewResultSchema, {
      chapters: [{ title: "x", startMs: 0, endMs: 300000, segmentCount: 0 }],
    });
    expectRejected(OverviewResultSchema, {
      chapters: [{ title: "x", startMs: 0, endMs: 300000, segmentCount: 1.5 }],
    });
    expectRoundTrip(OverviewChapterSchema, {
      title: "deployment",
      startMs: 0,
      endMs: 0,
      segmentCount: 1,
    });
  });

  it("QaRequest/QaAnswer round-trip quoted spans and enforce the blank-question floor (P4-SUMMARIZE)", () => {
    const segments = [
      { startMs: 0, endMs: 1500, text: "the deployment failed on staging" },
      { startMs: 1500, endMs: 3000, text: "we rolled back the database" },
    ];
    expectRoundTrip(QaRequestSchema, { segments, question: "what happened to the deployment?" });
    expectRejected(QaRequestSchema, { segments, question: "" });
    // Whitespace-only questions are BLANKS (trim-then-min(1)).
    expectRejected(QaRequestSchema, { segments, question: "   " });
    expectRejected(QaRequestSchema, { segments });
    // Padded questions normalize to the trimmed canonical form.
    expect(QaRequestSchema.parse({ segments, question: " why? " })).toEqual({
      segments,
      question: "why?",
    });

    expectRoundTrip(QaAnswerSchema, {
      spans: [
        {
          quote: "the deployment failed on staging",
          segmentIndex: 0,
          startMs: 0,
          endMs: 1500,
        },
      ],
    });
    // The honest no-match answer is the EMPTY span list — representable,
    // and there is NO free-text field to fabricate an answer into.
    expectRoundTrip(QaAnswerSchema, { spans: [] });
    expectRejected(QaAnswerSchema, {
      spans: [{ quote: "", segmentIndex: 0, startMs: 0, endMs: 1500 }],
    });
    expectRejected(QaAnswerSchema, {
      spans: [{ quote: "  ", segmentIndex: 0, startMs: 0, endMs: 1500 }],
    });
    expectRejected(QaAnswerSchema, {
      spans: [{ quote: "x", segmentIndex: -1, startMs: 0, endMs: 1500 }],
    });
    expectRoundTrip(QaSpanSchema, {
      quote: "we rolled back the database",
      segmentIndex: 1,
      startMs: 1500,
      endMs: 3000,
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
