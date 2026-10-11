/**
 * Evaluation replay + metrics unit tests (P4-EVALLOOP scope rows 2 + 5):
 * the PURE computations behind the honest-metrics contract. Every pin
 * states the population semantics it enforces:
 * - the agreement populations are the work order's NAMED ones
 *   (liked-in-top-k, disliked-in-bottom-k, abstained) with suppressed
 *   disliked items counting as agreeing;
 * - every share carries its denominator; empty populations => null
 *   shares, never 0%/100% fabrications;
 * - distribution stats are null at count 0 (honest empty ranking);
 * - pairwise overlaps carry the ACTUAL top-k sizes and skip failed sides;
 * - ranker resolution is the honest A/B seam (default/selected/drift);
 * - the universe builder filters + canonicalizes WITHOUT mutating the
 *   caller's arrays (pinned by frozen-input deep-equal).
 */
import { describe, expect, it } from "vitest";
import type {
  CatalogItem,
  FeedbackEvent,
  LibraryFact,
  RankingResult,
  UserObjective,
  WatchedState,
} from "webflix-contracts";
import {
  buildEvaluationUniverse,
  EVALUATION_DEFAULT_NOTE,
  EVALUATION_POLICY,
  resolveEvaluationRanker,
  replayOneConfiguration,
} from "../evaluation-replay";
import {
  computeExplicitFeedbackAgreement,
  computePairwiseOverlaps,
  computeScoreDistribution,
  explicitDirection,
  topKItemIds,
} from "../evaluation-metrics";
import { BUILT_IN_RANKER_ID } from "../built-in-ranker";
import { createStaticRankerAdapterRegistry } from "../ranker-adapter-registry";
import { FixtureReplayRanker, FIXTURE_REPLAY_RANKER_ID } from "../fixture-replay-ranker";

const AS_OF = "2026-10-11T08:00:00Z";

// ---------- fixtures ----------

const catalogItem = (id: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title: `Title ${id}`,
  mediaKind: "video",
  assets: [],
  matchEvidence: undefined,
  availability: undefined,
  metadata: {},
});

const CATALOG: readonly CatalogItem[] = [
  catalogItem("item-a"),
  catalogItem("item-b"),
  catalogItem("item-c"),
  catalogItem("item-d"),
];

const LIBRARY: readonly LibraryFact[] = [
  { itemId: "item-a", title: "Title item-a", tags: [], durationMs: 600000, addedAt: AS_OF },
];

const WATCH: readonly WatchedState[] = [
  {
    itemId: "item-b",
    status: "in-progress",
    watchedFraction: 0.5,
    lastPositionMs: 1000,
    updatedAt: AS_OF,
  },
];

const OBJECTIVES: UserObjective = {
  topicFocuses: [],
  exclusions: [],
  timeBudgets: {},
  declaredAt: AS_OF,
};

const explicit = (
  id: string,
  itemId: string,
  kind: "pin" | "thumbs-up" | "thumbs-down" | "not-interested",
): FeedbackEvent => ({
  id,
  itemId,
  channel: "explicit",
  kind,
  provenance: { surface: "recommendation-card", capturedAt: AS_OF },
});

const implicit = (id: string, itemId: string): FeedbackEvent => ({
  id,
  itemId,
  channel: "implicit",
  kind: "watched-fraction",
  value: 0.5,
  provenance: { surface: "watch-screen", capturedAt: AS_OF },
});

/** A minimal VALID ranked result over ordered (itemId, score) pairs. */
function cannedRanking(pairs: readonly [string, number][]): RankingResult {
  if (pairs.length === 0)
    return { kind: "empty", policyVersion: "v1", reason: "no-ranked-candidates" };
  return {
    kind: "ranked",
    policyVersion: "v1",
    items: pairs.map(([itemId, score]) => ({
      itemId,
      score,
      reasons: [
        {
          family: "library-affinity",
          text: "canned reason",
          contribution: 0.1,
          evidence: [{ kind: "library-fact", itemId }],
        },
      ],
    })),
  };
}

describe("explicitDirection — the v1 polarity mapping", () => {
  it("pin and thumbs-up are liked; thumbs-down and not-interested are disliked; implicit carries no direction", () => {
    expect(explicitDirection(explicit("e1", "item-a", "pin"))).toBe("liked");
    expect(explicitDirection(explicit("e2", "item-a", "thumbs-up"))).toBe("liked");
    expect(explicitDirection(explicit("e3", "item-a", "thumbs-down"))).toBe("disliked");
    expect(explicitDirection(explicit("e4", "item-a", "not-interested"))).toBe("disliked");
    expect(explicitDirection(implicit("e5", "item-a"))).toBeNull();
  });
});

describe("computeExplicitFeedbackAgreement — the NAMED populations", () => {
  const universe = new Set(["item-a", "item-b", "item-c", "item-d"]);
  // liked: a (top-1 -> agrees), b (ranked 3rd of 4, k=2 -> middle -> abstained)
  // disliked: c (bottom-1 -> agrees), d (ranked 2nd of 4, k=2 -> NOT bottom-k, present -> abstained)
  const feedback = [
    explicit("e1", "item-a", "pin"),
    explicit("e2", "item-b", "thumbs-up"),
    explicit("e3", "item-c", "thumbs-down"),
    explicit("e4", "item-d", "not-interested"),
    implicit("e5", "item-a"),
    explicit("e6", "item-z", "pin"), // out of universe — never counted
  ];
  const ranking = cannedRanking([
    ["item-a", 0.9],
    ["item-d", 0.7],
    ["item-b", 0.5],
    ["item-c", 0.1],
  ]);

  it("counts the named populations exactly (liked-in-top-k, disliked-in-bottom-k, abstained)", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: feedback,
      universeItemIds: universe,
      ranking,
      k: 2,
    });
    expect(agreement).toEqual({
      likedTotal: 2,
      likedInTopK: 1, // item-a is top-1 of 4 with k=2
      dislikedTotal: 2,
      dislikedInBottomK: 1, // item-c is bottom-1 of 4 with k=2
      abstained: 2, // item-b (middle) + item-d (ranked 2nd, not bottom-k)
      likedShare: 0.5,
      dislikedShare: 0.5,
      agreedShare: 0.5,
    });
  });

  it("a SUPPRESSED disliked item (absent from the ranking) counts as agreeing", () => {
    // Only disliked items: one ranked IN the bottom-k, one absent entirely.
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [
        explicit("e1", "item-a", "thumbs-down"),
        explicit("e2", "item-b", "not-interested"),
      ],
      universeItemIds: universe,
      ranking: cannedRanking([
        ["item-c", 0.9],
        ["item-a", 0.1],
      ]), // item-a bottom-1; item-b absent = suppressed
      k: 1,
    });
    expect(agreement.dislikedTotal).toBe(2);
    expect(agreement.dislikedInBottomK).toBe(2); // item-a bottom-1; item-b suppressed
    expect(agreement.agreedShare).toBe(1);
  });

  it("an ABSENT liked item does NOT agree (the policy refused to show it)", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [explicit("e1", "item-a", "pin")],
      universeItemIds: universe,
      ranking: cannedRanking([["item-b", 0.9]]), // item-a absent
      k: 1,
    });
    expect(agreement.likedInTopK).toBe(0);
    expect(agreement.abstained).toBe(1);
    expect(agreement.likedShare).toBe(0);
  });

  it("an item rated in BOTH directions appears in BOTH populations (the honest double-expression)", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [explicit("e1", "item-a", "pin"), explicit("e2", "item-a", "thumbs-down")],
      universeItemIds: universe,
      ranking: cannedRanking([
        ["item-a", 0.9],
        ["item-b", 0.1],
      ]),
      k: 2, // k covers the whole 2-item ranking: item-a is in top-k AND bottom-k
    });
    expect(agreement.likedTotal).toBe(1);
    expect(agreement.dislikedTotal).toBe(1);
    // top-k AND bottom-k simultaneously: agreed twice, 2/2.
    expect(agreement.likedInTopK).toBe(1);
    expect(agreement.dislikedInBottomK).toBe(1);
    expect(agreement.agreedShare).toBe(1);
  });

  it("zero rated population => null shares (never fabricated 0%/100%)", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [implicit("e1", "item-a")],
      universeItemIds: universe,
      ranking: cannedRanking([["item-a", 0.9]]),
      k: 1,
    });
    expect(agreement).toEqual({
      likedTotal: 0,
      likedInTopK: 0,
      dislikedTotal: 0,
      dislikedInBottomK: 0,
      abstained: 0,
      likedShare: null,
      dislikedShare: null,
      agreedShare: null,
    });
  });

  it("a 1/1 population share is exactly 1 — the carried counts keep it honest", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [explicit("e1", "item-a", "thumbs-up")],
      universeItemIds: universe,
      ranking: cannedRanking([
        ["item-a", 0.9],
        ["item-b", 0.1],
      ]),
      k: 1,
    });
    expect(agreement.likedInTopK).toBe(1);
    expect(agreement.likedTotal).toBe(1);
    expect(agreement.likedShare).toBe(1);
    expect(agreement.agreedShare).toBe(1);
  });

  it("shares are quantized to 4 decimals (2/3 -> 0.6667)", () => {
    const agreement = computeExplicitFeedbackAgreement({
      replayedFeedback: [
        explicit("e1", "item-a", "pin"),
        explicit("e2", "item-b", "pin"),
        explicit("e3", "item-c", "pin"),
      ],
      universeItemIds: universe,
      ranking: cannedRanking([
        ["item-a", 0.9],
        ["item-b", 0.8],
        ["item-c", 0.1],
      ]),
      k: 2,
    });
    expect(agreement.likedInTopK).toBe(2);
    expect(agreement.likedShare).toBe(0.6667);
    expect(agreement.agreedShare).toBe(0.6667);
  });
});

describe("computeScoreDistribution — descriptive stats with the population carried", () => {
  it("count 0 (empty ranking) => every stat null, never invented", () => {
    expect(
      computeScoreDistribution({ kind: "empty", policyVersion: "v1", reason: "empty-catalog" }),
    ).toEqual({
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
    });
  });

  it("odd count: the middle score; even count: the mean of the two middles (quantized)", () => {
    const odd = computeScoreDistribution(
      cannedRanking([
        ["a", 0.2],
        ["b", 0.5],
        ["c", 0.9],
      ]),
    );
    expect(odd).toEqual({ count: 3, min: 0.2, max: 0.9, mean: 0.5333, median: 0.5 });
    const even = computeScoreDistribution(
      cannedRanking([
        ["a", 0.2],
        ["b", 0.5],
        ["c", 0.9],
        ["d", 0.9],
      ]),
    );
    expect(even.median).toBe(0.7); // (0.5 + 0.9) / 2
    expect(even.mean).toBe(0.625);
  });

  it("the stats read the ranking's OWN order-independent scores", () => {
    const one = computeScoreDistribution(
      cannedRanking([
        ["a", 0.1],
        ["b", 0.3],
      ]),
    );
    const two = computeScoreDistribution(
      cannedRanking([
        ["b", 0.3],
        ["a", 0.1],
      ]),
    );
    expect(two).toEqual(one);
  });
});

describe("topKItemIds + computePairwiseOverlaps — the A/B overlap@k", () => {
  const ranking = cannedRanking([
    ["a", 0.9],
    ["b", 0.8],
    ["c", 0.7],
  ]);

  it("topKItemIds truncates to k and is empty for an empty ranking", () => {
    expect(topKItemIds(ranking, 2)).toEqual(["a", "b"]);
    expect(topKItemIds(ranking, 10)).toEqual(["a", "b", "c"]);
    expect(topKItemIds({ kind: "empty", policyVersion: "v1", reason: "empty-catalog" }, 2)).toEqual(
      [],
    );
  });

  const evaluated = (index: number, ids: readonly string[]) => ({
    kind: "evaluated" as const,
    configurationIndex: index,
    configuration: { kind: "built-in" as const },
    rankerId: `ranker-${index}`,
    rankerLabel: `Ranker ${index}`,
    resolutionNote: "note",
    ranking: cannedRanking(ids.map((id) => [id, 0.5] as [string, number])),
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
    scoreStats: { count: ids.length, min: 0.5, max: 0.5, mean: 0.5, median: 0.5 },
  });
  const failed = (index: number) => ({
    kind: "failed" as const,
    configurationIndex: index,
    configuration: { kind: "adapter" as const, adapterId: "gone" },
    rankerId: "gone",
    reason: "drift",
  });

  it("carries the ACTUAL per-side sizes (min(k, ranked count)) and the overlap", () => {
    const overlaps = computePairwiseOverlaps(
      [evaluated(0, ["a", "b", "c"]), evaluated(1, ["b", "c", "d"])],
      2,
    );
    expect(overlaps).toEqual([{ a: 0, b: 1, overlap: 1, sizeA: 2, sizeB: 2, share: 0.5 }]);
  });

  it("normalizes by the LARGER actual size — two identical short rankings are 100% similar", () => {
    const overlaps = computePairwiseOverlaps(
      [evaluated(0, ["a", "b"]), evaluated(1, ["a", "b"])],
      10,
    );
    expect(overlaps[0]).toEqual({ a: 0, b: 1, overlap: 2, sizeA: 2, sizeB: 2, share: 1 });
  });

  it("two EMPTY rankings => share null (nothing to compare, never a fabricated 0%)", () => {
    const overlaps = computePairwiseOverlaps([evaluated(0, []), evaluated(1, [])], 5);
    expect(overlaps[0]).toMatchObject({ overlap: 0, sizeA: 0, sizeB: 0, share: null });
  });

  it("FAILED sides are skipped entirely — no top-k is invented for a ranker that did not run", () => {
    const overlaps = computePairwiseOverlaps(
      [evaluated(0, ["a"]), failed(1), evaluated(2, ["a"])],
      1,
    );
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ a: 0, b: 2, overlap: 1 });
  });

  it("fewer than two evaluated sides => the empty list", () => {
    expect(computePairwiseOverlaps([evaluated(0, ["a"])], 1)).toEqual([]);
    expect(computePairwiseOverlaps([failed(0)], 1)).toEqual([]);
  });
});

describe("resolveEvaluationRanker — the honest A/B seam", () => {
  const double = new FixtureReplayRanker({ ranking: cannedRanking([["item-a", 0.5]]) });
  const entry = double.toRegistryEntry();
  const registry = createStaticRankerAdapterRegistry([entry]);

  it("built-in resolves the built-in ranker directly with its fixed note", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "built-in" },
      registry,
      selection: null,
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.rankerId).toBe(BUILT_IN_RANKER_ID);
    expect(resolution.resolutionNote).toBe("the built-in deterministic ranking policy (v1)");
  });

  it("a known adapter id resolves through the registry", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "adapter", adapterId: FIXTURE_REPLAY_RANKER_ID },
      registry,
      selection: null,
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.rankerId).toBe(FIXTURE_REPLAY_RANKER_ID);
    expect(resolution.resolutionNote).toBe("explicitly configured adapter");
  });

  it("an UNKNOWN adapter id fails honestly (registry drift — per-configuration fail-soft)", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "adapter", adapterId: "gone" },
      registry,
      selection: null,
    });
    expect(resolution).toMatchObject({ kind: "failed", rankerId: "gone" });
  });

  it("selected with NO stored selection resolves the documented default with the default note", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "selected" },
      registry,
      selection: null,
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.rankerId).toBe(BUILT_IN_RANKER_ID);
    expect(resolution.resolutionNote).toBe(EVALUATION_DEFAULT_NOTE);
  });

  it("selected with a KNOWN selection resolves that adapter with the selected-at note", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "selected" },
      registry,
      selection: { adapterId: FIXTURE_REPLAY_RANKER_ID, selectedAt: AS_OF },
    });
    expect(resolution.kind).toBe("resolved");
    if (resolution.kind !== "resolved") return;
    expect(resolution.rankerId).toBe(FIXTURE_REPLAY_RANKER_ID);
    expect(resolution.resolutionNote).toBe(
      `selected: ${FIXTURE_REPLAY_RANKER_ID} (selected at ${AS_OF})`,
    );
  });

  it("selected with a DRIFTED selection fails honestly — never a silent switch to the default", () => {
    const resolution = resolveEvaluationRanker({
      configuration: { kind: "selected" },
      registry,
      selection: { adapterId: "gone", selectedAt: AS_OF },
    });
    expect(resolution).toMatchObject({ kind: "failed", rankerId: "gone" });
    if (resolution.kind !== "failed") return;
    expect(resolution.reason).toContain("registry drift");
  });
});

describe("buildEvaluationUniverse — filtering + canonicalization without mutation", () => {
  it("filters the catalog to the requested universe and canonicalizes feedback by event id", () => {
    const catalog = [...CATALOG];
    const feedback = [explicit("e2", "item-b", "pin"), explicit("e1", "item-a", "pin")];
    const catalogBefore = JSON.stringify(catalog);
    const feedbackBefore = JSON.stringify(feedback);
    const universe = buildEvaluationUniverse({
      catalog,
      library: LIBRARY,
      watchHistory: WATCH,
      feedback,
      objectives: OBJECTIVES,
      request: {
        itemIds: ["item-a", "item-c"],
        configurations: [{ kind: "built-in" }],
        k: 1,
        asOf: AS_OF,
      },
    });
    expect(universe.catalog.map((item) => item.id)).toEqual(["item-a", "item-c"]);
    expect(universe.feedback.map((event) => event.id)).toEqual(["e1", "e2"]);
    expect(universe.objectives).toBe(OBJECTIVES);
    expect(universe.asOf).toBe(AS_OF);
    // READ-ONLY: the caller's arrays are untouched.
    expect(JSON.stringify(catalog)).toBe(catalogBefore);
    expect(JSON.stringify(feedback)).toBe(feedbackBefore);
  });

  it("an empty universe filters the catalog to nothing (the honest-empty universe)", () => {
    const universe = buildEvaluationUniverse({
      catalog: CATALOG,
      library: LIBRARY,
      watchHistory: WATCH,
      feedback: [],
      objectives: null,
      request: { itemIds: [], configurations: [{ kind: "built-in" }], k: 1, asOf: AS_OF },
    });
    expect(universe.catalog).toEqual([]);
    expect(universe.feedback).toEqual([]);
    expect(universe.objectives).toBeNull();
  });
});

describe("replayOneConfiguration — per-configuration fail-soft", () => {
  const universe = buildEvaluationUniverse({
    catalog: CATALOG,
    library: LIBRARY,
    watchHistory: WATCH,
    feedback: [explicit("e1", "item-a", "pin")],
    objectives: OBJECTIVES,
    request: {
      itemIds: ["item-a", "item-b"],
      configurations: [{ kind: "built-in" }],
      k: 1,
      asOf: AS_OF,
    },
  });
  const universeItemIds = new Set(["item-a", "item-b"]);

  it("a ranker that THROWS surfaces as a failed outcome carrying the error text (never a job failure)", () => {
    const outcome = replayOneConfiguration({
      configuration: { kind: "adapter", adapterId: "throwing" },
      configurationIndex: 3,
      universe,
      resolution: {
        kind: "resolved",
        ranker: {
          rank: () => {
            throw new Error("boom");
          },
        },
        rankerId: "throwing",
        rankerLabel: "Throwing",
        resolutionNote: "note",
      },
      universeItemIds,
      k: 1,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.configurationIndex).toBe(3);
    expect(outcome.rankerId).toBe("throwing");
    expect(outcome.reason).toContain("boom");
  });

  it("a failed resolution short-circuits to the failed outcome with the resolution's reason", () => {
    const outcome = replayOneConfiguration({
      configuration: { kind: "adapter", adapterId: "gone" },
      configurationIndex: 0,
      universe,
      resolution: { kind: "failed", rankerId: "gone", reason: "drifted" },
      universeItemIds,
      k: 1,
    });
    expect(outcome).toMatchObject({ kind: "failed", reason: "drifted" });
  });

  it("the replayed outcome carries the frozen policy v1 input and its metrics", () => {
    const double = new FixtureReplayRanker({ ranking: cannedRanking([["item-a", 0.9]]) });
    const outcome = replayOneConfiguration({
      configuration: { kind: "adapter", adapterId: double.toRegistryEntry().id },
      configurationIndex: 0,
      universe,
      resolution: {
        kind: "resolved",
        ranker: double,
        rankerId: FIXTURE_REPLAY_RANKER_ID,
        rankerLabel: "label",
        resolutionNote: "note",
      },
      universeItemIds,
      k: 1,
    });
    expect(outcome.kind).toBe("evaluated");
    if (outcome.kind !== "evaluated") return;
    // The ranker saw the UNIVERSE-filtered catalog + canonicalized feedback + v1 policy.
    expect(double.calls[0]?.input.catalog.map((item) => item.id)).toEqual(["item-a", "item-b"]);
    expect(double.calls[0]?.input.feedback.map((event) => event.id)).toEqual(["e1"]);
    expect(double.calls[0]?.input.policy).toEqual(EVALUATION_POLICY);
    expect(double.calls[0]?.input.asOf).toBe(AS_OF);
    expect(outcome.agreement.likedInTopK).toBe(1); // item-a pinned AND top-1
    expect(outcome.scoreStats.count).toBe(1);
  });
});
