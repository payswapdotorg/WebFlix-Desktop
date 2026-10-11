/**
 * mi.evaluate use-case tests (P4-EVALLOOP scope row 3) — the §2.6 wrapper
 * contract, the honest-metrics read-out, READ-ONLY evidence over every
 * store, both-phase cancellation, per-configuration fail-soft, and the
 * DETERMINISM CORPUS (same feedback + objectives + items + selection =>
 * byte-identical evaluation result, sha256-pinned).
 *
 * The corpus pin provenance: the sha256 below was computed by running
 * THIS test's corpus once through the real use case and freezing the
 * digest into the file (the built-in-ranker PINNED_MAIN precedent). Any
 * change to the metric arithmetic, the ranker, or the result construction
 * breaks the pin — by design.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { FeedbackEvent, RankingResult } from "webflix-contracts";
import { InMemoryFeedbackStore, InMemoryObjectiveStore } from "../in-memory-intelligence-stores";
import { InMemoryRankerSelectionStore } from "../ranker-adapter-selection";
import { createStaticRankerAdapterRegistry } from "../ranker-adapter-registry";
import { FixtureReplayRanker, FIXTURE_REPLAY_RANKER_ID } from "../fixture-replay-ranker";
import { EVALUATE_JOB_KIND, EvaluationJobError, RunEvaluation } from "../mi-evaluate";
import { EVALUATION_REPLAY_ID, EVALUATION_REPLAY_VERSION } from "../evaluation-replay";
import { canonicalEvaluationJson } from "../evaluation-replay";
import type { ClockPort } from "../ports";
import {
  AS_OF,
  MAIN_CATALOG,
  MAIN_FEEDBACK,
  MAIN_LIBRARY,
  MAIN_OBJECTIVES,
  MAIN_WATCH,
} from "./mi-corpus";

// The corpus pin — see the file docblock for provenance.
const CORPUS_SHA256 = "dbe4455b3ed100f99a150cc1b2a912ecaa32e63788a30c398d2a2c6e027c1ff9";

/** Deterministic clock: fixed instants, indexed per call. */
class FixedClock implements ClockPort {
  private call = 0;
  now(): Date {
    this.call += 1;
    // job createdAt, running startedAt, terminal finishedAt — all fixed.
    return new Date("2026-10-11T09:00:00Z");
  }
}

/** Deterministic id source. */
function idSource(): () => string {
  let n = 0;
  return () => `eval-job-${(n += 1)}`;
}

/** A canned valid ranking over ordered (itemId, score) pairs. */
function cannedRanking(pairs: readonly [string, number][]): RankingResult {
  if (pairs.length === 0) {
    return { kind: "empty", policyVersion: "v1", reason: "no-ranked-candidates" };
  }
  return {
    kind: "ranked",
    policyVersion: "v1",
    items: pairs.map(([itemId, score]) => ({
      itemId,
      score,
      reasons: [
        {
          family: "library-affinity",
          text: `canned reason for ${itemId}`,
          contribution: 0.1,
          evidence: [{ kind: "library-fact", itemId }],
        },
      ],
    })),
  };
}

/** The fixture double's canned ranking for the corpus comparison. */
const FIXTURE_RANKING: RankingResult = cannedRanking([
  ["item-b", 0.8],
  ["item-e", 0.6],
  ["item-a", 0.4],
]);

/** Read-counting wrappers — the "nothing was read" boundary evidence. */
class CountingFeedbackStore extends InMemoryFeedbackStore {
  listCalls = 0;
  override async list(): Promise<readonly FeedbackEvent[]> {
    this.listCalls += 1;
    return super.list();
  }
}
class CountingObjectiveStore extends InMemoryObjectiveStore {
  getCalls = 0;
  override async get(): Promise<null> {
    this.getCalls += 1;
    return super.get() as Promise<null>;
  }
}

interface HarnessOverrides {
  readonly feedback?: readonly FeedbackEvent[];
  readonly objectivesSet?: boolean;
  readonly selectionAdapterId?: string | null;
  readonly failOnCall?: number;
}

async function makeHarness(overrides: HarnessOverrides = {}) {
  const feedback = new CountingFeedbackStore();
  for (const event of overrides.feedback ?? MAIN_FEEDBACK) {
    await feedback.append(event);
  }
  const objectives = new CountingObjectiveStore();
  if (overrides.objectivesSet !== false) {
    await objectives.put(MAIN_OBJECTIVES);
  }
  const selection = new InMemoryRankerSelectionStore();
  const wantedSelection =
    overrides.selectionAdapterId === undefined
      ? FIXTURE_REPLAY_RANKER_ID
      : overrides.selectionAdapterId;
  if (wantedSelection !== null) {
    await selection.put({ adapterId: wantedSelection, selectedAt: AS_OF });
  }
  const double = new FixtureReplayRanker({
    ranking: FIXTURE_RANKING,
    ...(overrides.failOnCall !== undefined ? { failOnCall: overrides.failOnCall } : {}),
  });
  const registry = createStaticRankerAdapterRegistry([double.toRegistryEntry()]);
  const run = new RunEvaluation({
    feedback,
    objectives,
    selection,
    registry,
    clock: new FixedClock(),
    generateId: idSource(),
  });
  return { run, feedback, objectives, selection, registry, double };
}

/** The corpus request: all six corpus items, k=2, three sides. */
const CORPUS_REQUEST = {
  itemIds: ["item-a", "item-b", "item-c", "item-d", "item-e", "item-f"],
  configurations: [
    { kind: "built-in" },
    { kind: "adapter", adapterId: FIXTURE_REPLAY_RANKER_ID },
    { kind: "selected" },
  ],
  k: 2,
  asOf: AS_OF,
} as const;

const CORPUS_INPUT = {
  catalog: MAIN_CATALOG,
  library: MAIN_LIBRARY,
  watchHistory: MAIN_WATCH,
  request: CORPUS_REQUEST,
};

describe("mi.evaluate — the §2.6 wrapper", () => {
  it("the job descriptor shape is exact (cancellable, single-attempt, provenance, counts payload)", async () => {
    const h = await makeHarness();
    const output = await h.run.execute(CORPUS_INPUT);
    const job = output.job;
    expect(job.kind).toBe(EVALUATE_JOB_KIND);
    expect(job.state).toBe("succeeded");
    expect(job.cancellable).toBe(true);
    expect(job.retry).toEqual({ maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] });
    expect(job.provenance.connectorId).toBe(EVALUATION_REPLAY_ID);
    expect(job.provenance.connectorVersion).toBe(EVALUATION_REPLAY_VERSION);
    expect(job.payload).toEqual({
      configurationCount: 3,
      itemsUnderTest: 6,
      k: 2,
      feedbackScope: "all",
      signalState: "live",
    });
    expect(job.startedAt).toBeTypeOf("string");
    expect(job.finishedAt).toBeTypeOf("string");
  });

  it("happy path: three sides, each with its resolved identity + honest note + metrics", async () => {
    const h = await makeHarness();
    const output = await h.run.execute(CORPUS_INPUT);
    expect(output.result).not.toBeNull();
    const result = output.result!;
    expect(result.k).toBe(2);
    expect(result.asOf).toBe(AS_OF);
    expect(result.itemIds).toEqual([...CORPUS_REQUEST.itemIds].sort());
    expect(result.replay).toEqual({
      feedbackTotalStored: 3,
      feedbackReplayed: 3,
      explicitUnderTest: 2, // pin item-b + thumbs-down item-d
      implicitUnderTest: 1, // watched-fraction item-f
      objectivesApplied: true,
      itemsUnderTest: 6,
    });
    expect(result.outcomes).toHaveLength(3);
    const [builtIn, adapterSide, selectedSide] = result.outcomes;
    // Side 0 — the built-in through the domain resolver.
    expect(builtIn).toMatchObject({
      kind: "evaluated",
      configurationIndex: 0,
      configuration: { kind: "built-in" },
      rankerId: "webflix.built-in-ranker",
      resolutionNote: "the built-in deterministic ranking policy (v1)",
    });
    // Side 1 — the fixture double through the registry.
    expect(adapterSide).toMatchObject({
      kind: "evaluated",
      configurationIndex: 1,
      rankerId: FIXTURE_REPLAY_RANKER_ID,
      resolutionNote: "explicitly configured adapter",
    });
    // Side 2 — the stored selection resolved to the same double.
    expect(selectedSide).toMatchObject({
      kind: "evaluated",
      configurationIndex: 2,
      rankerId: FIXTURE_REPLAY_RANKER_ID,
      resolutionNote: `selected: ${FIXTURE_REPLAY_RANKER_ID} (selected at ${AS_OF})`,
    });
    // The built-in side ranked the corpus (a > b > e > c, d/f suppressed).
    if (builtIn?.kind !== "evaluated") throw new Error("expected evaluated");
    expect(builtIn.ranking.kind).toBe("ranked");
    expect(builtIn.agreement).toEqual({
      likedTotal: 1,
      likedInTopK: 1, // pinned item-b is top-2
      dislikedTotal: 1,
      dislikedInBottomK: 1, // thumbs-down item-d suppressed = agrees
      abstained: 0,
      likedShare: 1,
      dislikedShare: 1,
      agreedShare: 1,
    });
    // The fixture side replayed its canned ranking verbatim.
    if (adapterSide?.kind !== "evaluated") throw new Error("expected evaluated");
    expect(adapterSide.ranking).toEqual(FIXTURE_RANKING);
    // Pairwise overlaps: built-in top-2 {a,b} vs fixture top-2 {b,e} => 1/2.
    expect(result.pairwiseOverlaps).toEqual([
      { a: 0, b: 1, overlap: 1, sizeA: 2, sizeB: 2, share: 0.5 },
      { a: 0, b: 2, overlap: 1, sizeA: 2, sizeB: 2, share: 0.5 },
      { a: 1, b: 2, overlap: 2, sizeA: 2, sizeB: 2, share: 1 }, // identical sides
    ]);
  });

  it("READ-ONLY over every store + the caller's arrays (deep-equal untouched)", async () => {
    const h = await makeHarness();
    const feedbackBefore = JSON.stringify(await h.feedback.list());
    const objectiveBefore = JSON.stringify(await h.objectives.get());
    const selectionBefore = JSON.stringify(await h.selection.get());
    const catalogBefore = JSON.stringify(MAIN_CATALOG);
    const libraryBefore = JSON.stringify(MAIN_LIBRARY);
    const watchBefore = JSON.stringify(MAIN_WATCH);
    await h.run.execute(CORPUS_INPUT);
    expect(JSON.stringify(await h.feedback.list())).toBe(feedbackBefore);
    expect(JSON.stringify(await h.objectives.get())).toBe(objectiveBefore);
    expect(JSON.stringify(await h.selection.get())).toBe(selectionBefore);
    expect(JSON.stringify(MAIN_CATALOG)).toBe(catalogBefore);
    expect(JSON.stringify(MAIN_LIBRARY)).toBe(libraryBefore);
    expect(JSON.stringify(MAIN_WATCH)).toBe(watchBefore);
  });

  it("the result is an experiment READ-OUT, not a DerivedArtifact — no artifact id, nothing persisted", async () => {
    const h = await makeHarness();
    const output = await h.run.execute(CORPUS_INPUT);
    const result = output.result!;
    // No artifact identity fields exist on the read-out.
    for (const field of ["id", "sourceItemId", "kind", "lineage", "createdAt", "licenseNote"]) {
      expect(Object.hasOwn(result, field)).toBe(false);
    }
    // And nothing was written anywhere: the store populations are unchanged
    // (pinned by the READ-ONLY test) — an evaluation persists NOTHING, not
    // even into a store it could write to (it holds no such reference).
  });

  it("boundary cancellation: a pre-aborted signal Cancels the job, NOTHING is read or run", async () => {
    const h = await makeHarness();
    const controller = new AbortController();
    controller.abort();
    const output = await h.run.execute({ ...CORPUS_INPUT, signal: controller.signal });
    expect(output.job.state).toBe("cancelled");
    expect(output.result).toBeNull();
    expect(output.canonical).toBeNull();
    // Nothing was read: zero store reads.
    expect(h.feedback.listCalls).toBe(0);
    expect(h.objectives.getCalls).toBe(0);
    // Nothing was run: the fixture ranker never saw a call.
    expect(h.double.calls).toHaveLength(0);
  });

  it("mid-run cooperative cancellation: Cancelled BEFORE the first configuration (flip after the boundary read)", async () => {
    const h = await makeHarness();
    const flip = flipAfterReads(1);
    const output = await h.run.execute({ ...CORPUS_INPUT, signal: flip });
    expect(output.job.state).toBe("cancelled");
    expect(output.result).toBeNull();
    expect(output.canonical).toBeNull();
    // The stores WERE read (the checkpoint sits between the reads and the
    // first configuration) but NO ranker ran.
    expect(h.feedback.listCalls).toBe(1);
    expect(h.double.calls).toHaveLength(0);
  });

  it("mid-run cooperative cancellation BETWEEN configurations: partial outcomes are DISCARDED", async () => {
    const h = await makeHarness();
    // Boundary read (1) + checkpoint 1 (2) pass => configuration 0 (the
    // built-in) runs; checkpoint 2 flips => cancelled before side 1.
    const flip = flipAfterReads(2);
    const output = await h.run.execute({ ...CORPUS_INPUT, signal: flip });
    expect(output.job.state).toBe("cancelled");
    expect(output.result).toBeNull();
    expect(output.canonical).toBeNull();
    // The built-in ran (its outcome existed) but the fixture never did —
    // and NO partial result escaped.
    expect(h.double.calls).toHaveLength(0);
  });

  it("caller defects are typed evaluation-invalid BEFORE the job exists (no job, plain typed errors)", async () => {
    const h = await makeHarness();
    const cases: readonly unknown[] = [
      { ...CORPUS_REQUEST, itemIds: ["item-a", "item-a"] }, // duplicate universe ids
      { ...CORPUS_REQUEST, feedbackEventIds: ["fb-001", "fb-001"] }, // duplicate filter ids
      { ...CORPUS_REQUEST, configurations: [] }, // no sides
      { ...CORPUS_REQUEST, k: 0 }, // bad k
      { ...CORPUS_REQUEST, asOf: "not-an-instant" }, // bad asOf
      {
        ...CORPUS_REQUEST,
        configurations: [
          { kind: "adapter", adapterId: "x" },
          { kind: "adapter", adapterId: "x" },
        ],
      }, // literal duplicate sides
    ];
    for (const request of cases) {
      let threw: unknown;
      try {
        await h.run.execute({
          catalog: MAIN_CATALOG,
          library: MAIN_LIBRARY,
          watchHistory: MAIN_WATCH,
          request: request as never,
        });
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(WebFlixError);
      expect((threw as WebFlixError).code).toBe(ErrorCode.IntelligenceEvaluationInvalid);
      expect(threw).not.toBeInstanceOf(EvaluationJobError);
    }
    // Nothing was read by any of them.
    expect(h.feedback.listCalls).toBe(0);
  });

  it("a universe id ABSENT from the supplied catalog snapshot is a pre-job caller defect", async () => {
    const h = await makeHarness();
    await expect(
      h.run.execute({
        catalog: MAIN_CATALOG,
        library: MAIN_LIBRARY,
        watchHistory: MAIN_WATCH,
        request: { ...CORPUS_REQUEST, itemIds: ["item-a", "item-not-in-catalog"] },
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return (
        WebFlixError.is(err) &&
        err.code === ErrorCode.IntelligenceEvaluationInvalid &&
        err.reason.includes("item-not-in-catalog")
      );
    });
  });

  it("an unknown feedbackEventIds entry is a READ-TIME failure: job FAILED + the typed cause rethrown", async () => {
    const h = await makeHarness();
    let threw: unknown;
    try {
      await h.run.execute({
        ...CORPUS_INPUT,
        request: { ...CORPUS_REQUEST, feedbackEventIds: ["fb-001", "fb-404"] },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(EvaluationJobError);
    const jobError = threw as EvaluationJobError;
    expect(jobError.code).toBe(ErrorCode.IntelligenceEvaluationInvalid);
    expect(jobError.reason).toContain("fb-404");
    expect(jobError.job.state).toBe("failed");
    expect(jobError.job.lastError).toContain("fb-404");
  });

  it("the feedback scope filter replays exactly the named events", async () => {
    const h = await makeHarness();
    const output = await h.run.execute({
      ...CORPUS_INPUT,
      request: { ...CORPUS_REQUEST, feedbackEventIds: ["fb-001", "fb-003"] },
    });
    const result = output.result!;
    expect(result.replay.feedbackTotalStored).toBe(3);
    expect(result.replay.feedbackReplayed).toBe(2);
    expect(result.replay.explicitUnderTest).toBe(1); // only the pin (fb-001)
    expect(result.replay.implicitUnderTest).toBe(1); // the watched-fraction (fb-003)
    // The rankers saw exactly the scoped, id-sorted events.
    if (h.double.calls[0] === undefined) throw new Error("expected a fixture call");
    expect(h.double.calls[0]?.input.feedback.map((event) => event.id)).toEqual([
      "fb-001",
      "fb-003",
    ]);
  });

  it("per-configuration FAIL-SOFT: a drifted adapter and a THROWING ranker never fail the job — the other sides still evaluate", async () => {
    const h = await makeHarness({ failOnCall: 1 });
    const output = await h.run.execute({
      ...CORPUS_INPUT,
      request: {
        ...CORPUS_REQUEST,
        configurations: [
          { kind: "built-in" },
          { kind: "adapter", adapterId: "gone-adapter" }, // registry drift
          { kind: "adapter", adapterId: FIXTURE_REPLAY_RANKER_ID }, // throws on call 1
        ],
      },
    });
    expect(output.job.state).toBe("succeeded");
    const result = output.result!;
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes[0]?.kind).toBe("evaluated");
    const drifted = result.outcomes[1];
    expect(drifted?.kind).toBe("failed");
    if (drifted?.kind !== "failed") return;
    expect(drifted.rankerId).toBe("gone-adapter");
    expect(drifted.reason).toContain("not in the registry");
    const throwing = result.outcomes[2];
    expect(throwing?.kind).toBe("failed");
    if (throwing?.kind !== "failed") return;
    expect(throwing.reason).toContain("threw during replay");
    // The built-in side still carries full metrics; overlaps skip the failed sides.
    expect(result.pairwiseOverlaps).toEqual([]);
  });

  it("honest-empty: ZERO feedback and an EMPTY universe still succeed with population-0 results", async () => {
    const h = await makeHarness({ feedback: [], objectivesSet: false, selectionAdapterId: null });
    const output = await h.run.execute({
      ...CORPUS_INPUT,
      request: { ...CORPUS_REQUEST, itemIds: [] },
    });
    expect(output.job.state).toBe("succeeded");
    const result = output.result!;
    expect(result.itemIds).toEqual([]);
    expect(result.replay).toEqual({
      feedbackTotalStored: 0,
      feedbackReplayed: 0,
      explicitUnderTest: 0,
      implicitUnderTest: 0,
      objectivesApplied: false,
      itemsUnderTest: 0,
    });
    // The BUILT-IN sides over an empty universe: the honest empty ranking
    // (empty-catalog) with population-0 metrics and null shares.
    for (const index of [0, 2]) {
      const outcome = result.outcomes[index];
      if (outcome?.kind !== "evaluated") throw new Error("expected evaluated");
      if (outcome.ranking.kind !== "empty") throw new Error("expected an empty ranking");
      expect(outcome.ranking.reason).toBe("empty-catalog");
      expect(outcome.agreement).toEqual({
        likedTotal: 0,
        likedInTopK: 0,
        dislikedTotal: 0,
        dislikedInBottomK: 0,
        abstained: 0,
        likedShare: null,
        dislikedShare: null,
        agreedShare: null,
      });
      expect(outcome.scoreStats).toEqual({
        count: 0,
        min: null,
        max: null,
        mean: null,
        median: null,
      });
    }
    // The fixture side replays its CANNED ranking verbatim (a TEST DOUBLE
    // returns exactly what it was given — its documented behavior); its
    // agreement is still population-0 (the universe is empty, no event
    // counts) and the stats describe the canned scores honestly.
    const fixtureSide = result.outcomes[1];
    if (fixtureSide?.kind !== "evaluated") throw new Error("expected evaluated");
    expect(fixtureSide.ranking).toEqual(FIXTURE_RANKING);
    expect(fixtureSide.agreement.agreedShare).toBeNull();
    expect(fixtureSide.scoreStats.count).toBe(3);
    // `selected` with no stored selection honestly ran the documented default.
    const selectedSide = result.outcomes[2];
    expect(selectedSide).toMatchObject({
      rankerId: "webflix.built-in-ranker",
      resolutionNote:
        "No ranker adapter is selected — the documented default (the built-in deterministic ranker v1) is active.",
    });
  });

  it("a drifted SELECTION fails that configuration honestly — never a silent switch to the default", async () => {
    const h = await makeHarness({ selectionAdapterId: "gone-selection" });
    const output = await h.run.execute({
      ...CORPUS_INPUT,
      request: {
        ...CORPUS_REQUEST,
        configurations: [{ kind: "built-in" }, { kind: "selected" }],
      },
    });
    expect(output.job.state).toBe("succeeded");
    const result = output.result!;
    expect(result.outcomes[0]?.kind).toBe("evaluated");
    const selectedSide = result.outcomes[1];
    expect(selectedSide?.kind).toBe("failed");
    if (selectedSide?.kind !== "failed") return;
    expect(selectedSide.rankerId).toBe("gone-selection");
    expect(selectedSide.reason).toContain("registry drift");
  });
});

describe("mi.evaluate — the determinism corpus (sha256-pinned)", () => {
  it("the corpus result is byte-identical across runs and matches the pinned sha256", async () => {
    const first = await makeHarness();
    const second = await makeHarness();
    const outA = await first.run.execute(CORPUS_INPUT);
    const outB = await second.run.execute(CORPUS_INPUT);
    expect(outB.canonical).toBe(outA.canonical);
    expect(outB.result).toEqual(outA.result);
    const digest = createHash("sha256").update(outA.canonical!, "utf8").digest("hex");
    expect(digest).toBe(CORPUS_SHA256);
  });

  it("order-independence: reversed STORE INSERTION ORDER produces identical canonical bytes", async () => {
    const forward = await makeHarness();
    const reversed = await makeHarness({ feedback: [...MAIN_FEEDBACK].reverse() });
    const outForward = await forward.run.execute(CORPUS_INPUT);
    const outReversed = await reversed.run.execute(CORPUS_INPUT);
    expect(outReversed.canonical).toBe(outForward.canonical);
  });

  it("the canonical serialization is plain JSON over the result (no timestamps of the run)", async () => {
    const h = await makeHarness();
    const output = await h.run.execute(CORPUS_INPUT);
    expect(output.canonical).toBe(canonicalEvaluationJson(output.result!));
    expect(output.canonical).not.toContain("startedAt");
    expect(output.canonical).not.toContain("finishedAt");
    expect(output.canonical).not.toContain("eval-job-1");
  });
});

/**
 * A deterministic mid-run abort: `aborted` returns true once it has been
 * READ more than `reads` times (the mi-translate-tts precedent — the
 * getter counts accesses, so the flip lands at an exact checkpoint).
 */
function flipAfterReads(reads: number): AbortSignal {
  let count = 0;
  return {
    get aborted() {
      count += 1;
      return count > reads;
    },
  } as unknown as AbortSignal;
}
