/**
 * Unit tests for the MI domain invariants (webflix-domain/src/intelligence.ts,
 * P4-CONTRACTS scope row 2): objective list rules, feedback history rules,
 * policy-version resolution (the determinism invariant), the reasons-
 * mandatory runtime guard, and derived-artifact lineage integrity.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import {
  assertReasonedRanking,
  resolveRankingPolicy,
  validateDerivedArtifactLineage,
  validateFeedbackHistoryInvariants,
  validateObjectiveInvariants,
} from "../index";
import type { CatalogItem, FeedbackEvent, UserObjective } from "webflix-contracts";

const ISO_NOW = "2026-10-11T08:00:00Z";

function expectWebFlixError(fn: () => unknown, code: ErrorCode): WebFlixError {
  try {
    fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

const catalogItem = (id: string, title: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title,
  mediaKind: "video",
  assets: [],
  matchEvidence: undefined,
  availability: undefined,
  metadata: {},
});

const objective = (over: Partial<UserObjective> = {}): UserObjective =>
  ({
    topicFocuses: ["rust", "cooking"],
    exclusions: ["yoga"],
    timeBudgets: { perSessionMinutes: 30 },
    declaredAt: ISO_NOW,
    ...over,
  }) as UserObjective;

const feedback = (id: string, itemId: string): FeedbackEvent =>
  ({
    id,
    itemId,
    channel: "explicit",
    kind: "pin",
    provenance: { surface: "recommendation-card", capturedAt: ISO_NOW },
  }) as FeedbackEvent;

describe("objective invariants", () => {
  it("accepts a clean objective (no violations)", () => {
    expect(validateObjectiveInvariants(objective())).toEqual([]);
  });

  it("rejects duplicate focuses (case-insensitive)", () => {
    const violations = validateObjectiveInvariants(
      objective({ topicFocuses: ["Rust", "rust", "cooking"] }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.code).toBe("duplicate-focuses");
  });

  it("rejects duplicate exclusions", () => {
    const violations = validateObjectiveInvariants(objective({ exclusions: ["yoga", "Yoga"] }));
    expect(violations[0]!.code).toBe("duplicate-exclusions");
  });

  it("rejects a term that is both focus and exclusion", () => {
    const violations = validateObjectiveInvariants(
      objective({ topicFocuses: ["rust", "cooking", "yoga"], exclusions: ["yoga"] }),
    );
    const overlap = violations.find((violation) => violation.code === "focus-excluded-overlap");
    expect(overlap).toBeDefined();
  });

  it("reports invalid-shape for schema-invalid objectives", () => {
    const violations = validateObjectiveInvariants(
      objective({ timeBudgets: { perSessionMinutes: -5 } } as Partial<UserObjective>),
    );
    expect(violations[0]!.code).toBe("invalid-shape");
  });
});

describe("feedback history invariants", () => {
  it("accepts a clean history", () => {
    expect(validateFeedbackHistoryInvariants([feedback("fb-1", "item-a")])).toEqual([]);
  });

  it("rejects duplicate event ids", () => {
    const violations = validateFeedbackHistoryInvariants([
      feedback("fb-1", "item-a"),
      feedback("fb-1", "item-b"),
    ]);
    expect(violations[0]!.code).toBe("duplicate-event-ids");
    const first = violations[0]!;
    if (first.code === "duplicate-event-ids") {
      expect(first.eventIds).toEqual(["fb-1"]);
    }
  });

  it("reports invalid-shape for schema-invalid events", () => {
    const bad = { ...feedback("fb-1", "item-a"), provenance: { surface: "", capturedAt: ISO_NOW } };
    const violations = validateFeedbackHistoryInvariants([bad]);
    expect(violations[0]!.code).toBe("invalid-shape");
  });
});

describe("policy resolution (determinism given policy version)", () => {
  it("resolves v1 to the canonical weights, verbatim", () => {
    const resolved = resolveRankingPolicy({ version: "v1" });
    expect(resolved.version).toBe("v1");
    expect(resolved.weights).toEqual({
      libraryAffinity: 0.25,
      watchHistory: 0.3,
      explicitFeedback: 0.3,
      objectiveMatch: 0.15,
    });
  });

  it("rejects unknown versions with the typed policy-unsupported error", () => {
    const wfe = expectWebFlixError(
      () => resolveRankingPolicy({ version: "v2" as "v1" }),
      ErrorCode.IntelligencePolicyUnsupported,
    );
    expect(wfe.reason).toContain("RankingPolicy");
  });

  it("resolving twice yields the identical weight object (weights are a function of the version)", () => {
    const first = resolveRankingPolicy({ version: "v1" });
    const second = resolveRankingPolicy({ version: "v1" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("reasons-mandatory runtime guard", () => {
  const goodResult = {
    kind: "ranked",
    policyVersion: "v1",
    items: [
      {
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
      },
    ],
  } as const;

  it("passes a reasoned result through unchanged", () => {
    expect(assertReasonedRanking(goodResult)).toEqual(goodResult);
  });

  it("passes the honest-empty variant through unchanged", () => {
    const empty = { kind: "empty", policyVersion: "v1", reason: "no-local-signals" } as const;
    expect(assertReasonedRanking(empty)).toEqual(empty);
  });

  it("rejects a reasonless item with the typed ranking-invalid error", () => {
    const reasonless = {
      kind: "ranked",
      policyVersion: "v1",
      items: [{ itemId: "item-a", score: 0.42, reasons: [] }],
    };
    expectWebFlixError(
      () => assertReasonedRanking(reasonless),
      ErrorCode.IntelligenceRankingInvalid,
    );
  });

  it("rejects an evidence-less reason with the typed ranking-invalid error", () => {
    const evidenceless = {
      kind: "ranked",
      policyVersion: "v1",
      items: [
        {
          itemId: "item-a",
          score: 0.42,
          reasons: [{ family: "library-affinity", text: "x", contribution: 0.1, evidence: [] }],
        },
      ],
    };
    expectWebFlixError(
      () => assertReasonedRanking(evidenceless),
      ErrorCode.IntelligenceRankingInvalid,
    );
  });
});

describe("derived-artifact lineage integrity", () => {
  const artifact = {
    id: "art-1",
    sourceItemId: "item-a",
    kind: "summary",
    lineage: { modelId: "m", modelVersion: "1", producedBy: "p", generatedAt: ISO_NOW },
    licenseNote: null,
    createdAt: ISO_NOW,
  } as const;

  it("accepts an artifact whose source exists in the snapshot", () => {
    expect(validateDerivedArtifactLineage(artifact, [catalogItem("item-a", "Some Title")])).toEqual(
      [],
    );
  });

  it("rejects a dangling source with source-not-found", () => {
    const violations = validateDerivedArtifactLineage(artifact, [
      catalogItem("item-b", "Another Title"),
    ]);
    expect(violations[0]!.code).toBe("source-not-found");
    const first = violations[0]!;
    if (first.code === "source-not-found") {
      expect(first.sourceItemId).toBe("item-a");
    }
  });

  it("rejects an unknown kind with invalid-shape (closed enum)", () => {
    const badKind = { ...artifact, kind: "tts" } as const;
    const violations = validateDerivedArtifactLineage(badKind, [catalogItem("item-a", "T")]);
    expect(violations[0]!.code).toBe("invalid-shape");
  });

  it("does not resolve sources through schema-invalid catalog entries", () => {
    const brokenItem = {
      ...catalogItem("item-a", "Some Title"),
      mediaKind: "hologram",
    } as unknown as CatalogItem;
    const violations = validateDerivedArtifactLineage(artifact, [brokenItem]);
    expect(violations[0]!.code).toBe("source-not-found");
  });
});
