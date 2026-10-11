/**
 * Use-case + engine tests for the MI application layer (P4-CONTRACTS):
 * in-memory store defaults, objectives, feedback idempotency, the §2.6 job
 * wrapper around generate-recommendations, the built-in deterministic
 * ranker v1 (pinned corpus + order-independence + honest-empty matrix),
 * and derived-artifact bookkeeping with lineage checks.
 *
 * FIXTURE-ONLY / HERMETIC: no filesystem, no network, no wall clock, no
 * timers. The pinned strings below are the canonical JSON bytes produced
 * by the ranker over the corpus in ./mi-corpus.ts, frozen at development
 * time — the determinism contract is: the same inputs + the same policy
 * version => byte-for-byte the same output, forever.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { CatalogItem, DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import {
  DeriveArtifactBookkeeping,
  GenerateRecommendations,
  GetObjectives,
  InMemoryArtifactRegistry,
  InMemoryFeedbackStore,
  InMemoryObjectiveStore,
  RecordFeedback,
  SetObjectives,
  canonicalRankingJson,
  rankWithBuiltInPolicy,
} from "../index";
import type { ClockPort } from "../ports";
import {
  ALL_EXCLUDED_OBJECTIVES,
  AS_OF,
  IMPLICIT_ONLY_FEEDBACK,
  MAIN_CATALOG,
  MAIN_FEEDBACK,
  MAIN_LIBRARY,
  MAIN_OBJECTIVES,
  MAIN_WATCH,
  NO_SIGNALS_FEEDBACK,
  NO_SIGNALS_LIBRARY,
  NO_SIGNALS_WATCH,
  POLICY_V1,
  SHUFFLED_CATALOG,
  SHUFFLED_FEEDBACK,
  SHUFFLED_LIBRARY,
  SHUFFLED_WATCH,
} from "./mi-corpus";

// ---------------------------------------------------------------------------
// Pinned canonical bytes (frozen from the ranker at development time)
// ---------------------------------------------------------------------------

const PINNED_MAIN =
  '{"kind":"ranked","policyVersion":"v1","items":[{"itemId":"item-a","score":0.4016,"reasons":[{"family":"library-affinity","text":"In your library","contribution":0.15,"evidence":[{"kind":"library-fact","itemId":"item-a"}]},{"family":"watch-history","text":"Continue watching — 62% done","contribution":0.093,"evidence":[{"kind":"watched-state","itemId":"item-a"}]},{"family":"watch-history","text":"Recently watched related titles: Rust Compiler Deep Dive","contribution":0.0536,"evidence":[{"kind":"watched-state","itemId":"item-c"}]},{"family":"objective-match","text":"Matches your focus: rust","contribution":0.045,"evidence":[{"kind":"objective","field":"topicFocuses"}]},{"family":"objective-match","text":"Fits your 30-minute session budget (25 min)","contribution":0.06,"evidence":[{"kind":"library-fact","itemId":"item-a"},{"kind":"objective","field":"timeBudgets.perSessionMinutes"}]}]},{"itemId":"item-b","score":0.3183,"reasons":[{"family":"library-affinity","text":"Similar to titles in your library: Advanced Pasta Making","contribution":0.0333,"evidence":[{"kind":"library-fact","itemId":"item-e"}]},{"family":"explicit-feedback","text":"You pinned it","contribution":0.24,"evidence":[{"kind":"feedback-event","eventId":"fb-001"}]},{"family":"objective-match","text":"Matches your focus: cooking","contribution":0.045,"evidence":[{"kind":"objective","field":"topicFocuses"}]}]},{"itemId":"item-e","score":0.255,"reasons":[{"family":"library-affinity","text":"In your library","contribution":0.15,"evidence":[{"kind":"library-fact","itemId":"item-e"}]},{"family":"objective-match","text":"Matches your focus: cooking","contribution":0.045,"evidence":[{"kind":"objective","field":"topicFocuses"}]},{"family":"objective-match","text":"Fits your 30-minute session budget (22 min)","contribution":0.06,"evidence":[{"kind":"library-fact","itemId":"item-e"},{"kind":"objective","field":"timeBudgets.perSessionMinutes"}]}]},{"itemId":"item-c","score":0.1212,"reasons":[{"family":"library-affinity","text":"Similar to titles in your library: Rust Systems Programming","contribution":0.0333,"evidence":[{"kind":"library-fact","itemId":"item-a"}]},{"family":"watch-history","text":"Recently watched related titles: Rust Systems Programming","contribution":0.0429,"evidence":[{"kind":"watched-state","itemId":"item-a"}]},{"family":"objective-match","text":"Matches your focus: rust","contribution":0.045,"evidence":[{"kind":"objective","field":"topicFocuses"}]}]}]}';

const PINNED_NO_SIGNALS = '{"kind":"empty","policyVersion":"v1","reason":"no-local-signals"}';
const PINNED_ALL_EXCLUDED = '{"kind":"empty","policyVersion":"v1","reason":"no-ranked-candidates"}';
const PINNED_IMPLICIT_ONLY =
  '{"kind":"empty","policyVersion":"v1","reason":"no-ranked-candidates"}';
const PINNED_EMPTY_CATALOG = '{"kind":"empty","policyVersion":"v1","reason":"empty-catalog"}';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

class FakeClock implements ClockPort {
  private instant: Date;
  constructor(iso = AS_OF) {
    this.instant = new Date(iso);
  }
  now(): Date {
    return new Date(this.instant);
  }
}

function sequenceIds(prefix = "id"): () => string {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
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

/** Async variant for use cases that reject: await-and-catch. */
async function expectWebFlixErrorAsync(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

// ---------------------------------------------------------------------------
// In-memory store defaults
// ---------------------------------------------------------------------------

describe("in-memory MI store defaults", () => {
  it("ObjectiveStore: null before any set, wholesale replace after", async () => {
    const store = new InMemoryObjectiveStore();
    expect(await store.get()).toBeNull();
    const first = MAIN_OBJECTIVES;
    await store.put(first);
    expect(await store.get()).toBe(first);
    const second: UserObjective = { ...first, topicFocuses: ["cooking"] };
    await store.put(second);
    expect(await store.get()).toBe(second);
  });

  it("FeedbackStore: append is idempotent by event id", async () => {
    const store = new InMemoryFeedbackStore();
    const event = MAIN_FEEDBACK[0]!;
    const first = await store.append(event);
    expect(first.outcome).toBe("appended");
    const second = await store.append(event);
    expect(second.outcome).toBe("duplicate");
    if (second.outcome === "duplicate") expect(second.existing).toEqual(event);
    expect((await store.list()).length).toBe(1);
    expect(await store.get(event.id)).toEqual(event);
    expect(await store.get("missing")).toBeNull();
  });

  it("ArtifactRegistry: put/get/list", async () => {
    const registry = new InMemoryArtifactRegistry();
    const descriptor: DerivedArtifact = {
      id: "art-1",
      sourceItemId: "item-a",
      kind: "summary",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p", generatedAt: AS_OF },
      licenseNote: null,
      createdAt: AS_OF,
    };
    await registry.put(descriptor);
    expect(await registry.get("art-1")).toBe(descriptor);
    expect((await registry.list()).length).toBe(1);
    expect(await registry.get("missing")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SetObjectives / GetObjectives
// ---------------------------------------------------------------------------

describe("SetObjectives / GetObjectives", () => {
  it("stores a validated objective with declaredAt from the clock", async () => {
    const store = new InMemoryObjectiveStore();
    const useCase = new SetObjectives({ store, clock: new FakeClock() });
    const stored = await useCase.set({
      topicFocuses: ["rust", "cooking"],
      exclusions: ["yoga"],
      timeBudgets: { perSessionMinutes: 30, weeklyMinutes: 300 },
    });
    // toISOString emits milliseconds; both forms are contract IsoDateTime instants.
    expect(stored.declaredAt).toBe("2026-10-11T08:00:00.000Z");
    expect(await new GetObjectives({ store }).get()).toEqual(stored);
  });

  it("stores the documented empty objective (all fields empty = no constraints)", async () => {
    const store = new InMemoryObjectiveStore();
    await new SetObjectives({ store, clock: new FakeClock() }).set({});
    const stored = await new GetObjectives({ store }).get();
    expect(stored).not.toBeNull();
    expect(stored!.topicFocuses).toEqual([]);
    expect(stored!.exclusions).toEqual([]);
    expect(stored!.timeBudgets).toEqual({});
  });

  it("rejects a negative time budget with the typed objective-invalid error", async () => {
    const useCase = new SetObjectives({
      store: new InMemoryObjectiveStore(),
      clock: new FakeClock(),
    });
    const wfe = await expectWebFlixErrorAsync(
      () => useCase.set({ timeBudgets: { perSessionMinutes: -5 } as never }),
      ErrorCode.IntelligenceObjectiveInvalid,
    );
    expect(wfe.reason).toContain("UserObjective");
  });

  it("surfaces domain objective-rule violations as the typed objective-invalid error (rule matrix pinned directly in webflix-domain tests)", async () => {
    const useCase = new SetObjectives({
      store: new InMemoryObjectiveStore(),
      clock: new FakeClock(),
    });
    const wfe = await expectWebFlixErrorAsync(
      () => useCase.set({ topicFocuses: ["rust", "Rust", "yoga"], exclusions: ["yoga"] }),
      ErrorCode.IntelligenceObjectiveInvalid,
    );
    expect(wfe.reason).toContain("duplicate entries");
    expect(wfe.reason).toContain("both a focus and an exclusion");
  });

  it("GetObjectives returns null when never set", async () => {
    expect(await new GetObjectives({ store: new InMemoryObjectiveStore() }).get()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RecordFeedback — idempotent append + conflict
// ---------------------------------------------------------------------------

describe("RecordFeedback", () => {
  it("appends a valid event once; a retry with the same event is a duplicate no-op", async () => {
    const store = new InMemoryFeedbackStore();
    const useCase = new RecordFeedback({ store });
    const event = MAIN_FEEDBACK[0]!;
    const first = await useCase.record(event);
    expect(first.outcome).toBe("appended");
    const retry = await useCase.record(event);
    expect(retry.outcome).toBe("duplicate");
    expect((await store.list()).length).toBe(1);
  });

  it("rejects the same id with a different payload (integrity conflict)", async () => {
    const store = new InMemoryFeedbackStore();
    const useCase = new RecordFeedback({ store });
    await useCase.record(MAIN_FEEDBACK[0]!);
    const conflicting: FeedbackEvent = {
      id: "fb-001",
      itemId: "item-b",
      channel: "explicit",
      kind: "thumbs-down",
      provenance: { surface: "recommendation-card", capturedAt: AS_OF },
    };
    const wfe = await expectWebFlixErrorAsync(
      () => useCase.record(conflicting),
      ErrorCode.IntelligenceFeedbackConflict,
    );
    expect(wfe.reason).toContain("already stored with a different payload");
  });

  it("rejects schema-invalid events with the typed feedback-invalid error", async () => {
    const useCase = new RecordFeedback({ store: new InMemoryFeedbackStore() });
    const bad: FeedbackEvent = {
      id: "fb-bad",
      itemId: "item-a",
      channel: "implicit",
      kind: "watched-fraction",
      value: 2,
      provenance: { surface: "watch-screen", capturedAt: AS_OF },
    } as FeedbackEvent;
    await expectWebFlixErrorAsync(() => useCase.record(bad), ErrorCode.IntelligenceFeedbackInvalid);
  });
});

// ---------------------------------------------------------------------------
// GenerateRecommendations — the §2.6 job wrapper
// ---------------------------------------------------------------------------

describe("GenerateRecommendations (§2.6 job wrapper)", () => {
  const baseDeps = { clock: new FakeClock(), generateId: sequenceIds("job") };

  it("runs to succeeded with a reasoned payload and stamps startedAt/finishedAt", async () => {
    const output = await new GenerateRecommendations(baseDeps).execute({
      catalog: MAIN_CATALOG,
      library: MAIN_LIBRARY,
      watchHistory: MAIN_WATCH,
      feedback: MAIN_FEEDBACK,
      objectives: MAIN_OBJECTIVES,
      policy: POLICY_V1,
    });
    expect(output.job.state).toBe("succeeded");
    expect(output.job.kind).toBe("mi.generate-recommendations");
    expect(output.job.cancellable).toBe(true);
    expect(output.job.startedAt).toBeDefined();
    expect(output.job.finishedAt).toBeDefined();
    expect(output.job.provenance.connectorId).toBe("webflix.built-in-ranker");
    expect(output.ranking!.kind).toBe("ranked");
    const ranking = output.ranking!;
    if (ranking.kind !== "ranked") throw new Error("expected ranked");
    expect(ranking.items.length).toBe(4);
    for (const item of ranking.items) {
      expect(item.reasons.length).toBeGreaterThan(0);
      for (const reason of item.reasons) {
        expect(reason.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("payload is byte-for-byte reproducible for the same inputs; job ids never leak into it", async () => {
    const first = await new GenerateRecommendations(baseDeps).execute({
      catalog: MAIN_CATALOG,
      library: MAIN_LIBRARY,
      watchHistory: MAIN_WATCH,
      feedback: MAIN_FEEDBACK,
      objectives: MAIN_OBJECTIVES,
      policy: POLICY_V1,
    });
    const second = await new GenerateRecommendations({
      clock: new FakeClock(),
      generateId: sequenceIds("other"),
    }).execute({
      catalog: MAIN_CATALOG,
      library: MAIN_LIBRARY,
      watchHistory: MAIN_WATCH,
      feedback: MAIN_FEEDBACK,
      objectives: MAIN_OBJECTIVES,
      policy: POLICY_V1,
    });
    expect(first.canonical).toBe(second.canonical);
    expect(first.canonical).toBe(PINNED_MAIN);
    expect(first.job.id).not.toBe(second.job.id);
    expect(first.canonical).not.toContain(first.job.id);
  });

  it("an already-aborted signal yields a Cancelled job with results discarded", async () => {
    const controller = new AbortController();
    controller.abort();
    const output = await new GenerateRecommendations(baseDeps).execute({
      catalog: MAIN_CATALOG,
      library: MAIN_LIBRARY,
      watchHistory: MAIN_WATCH,
      feedback: MAIN_FEEDBACK,
      objectives: MAIN_OBJECTIVES,
      policy: POLICY_V1,
      signal: controller.signal,
    });
    expect(output.job.state).toBe("cancelled");
    expect(output.job.finishedAt).toBeDefined();
    expect(output.ranking).toBeNull();
    expect(output.canonical).toBeNull();
  });

  it("rejects an unknown policy version before the job exists (typed, never a job failure)", async () => {
    const wfe = await expectWebFlixErrorAsync(
      () =>
        new GenerateRecommendations(baseDeps).execute({
          catalog: MAIN_CATALOG,
          library: MAIN_LIBRARY,
          watchHistory: MAIN_WATCH,
          feedback: MAIN_FEEDBACK,
          objectives: null,
          policy: { version: "v2" as "v1" },
        }),
      ErrorCode.IntelligencePolicyUnsupported,
    );
    expect(wfe.reason).toContain("RankingPolicy");
  });

  it("honors an injected ranker override (user-selected adapter seam)", async () => {
    const pinnedEcho = {
      kind: "empty",
      policyVersion: "v1",
      reason: "no-ranked-candidates",
    } as const;
    const output = await new GenerateRecommendations({
      clock: new FakeClock(),
      generateId: sequenceIds("job"),
      ranker: { rank: () => pinnedEcho },
    }).execute({
      catalog: MAIN_CATALOG,
      library: MAIN_LIBRARY,
      watchHistory: MAIN_WATCH,
      feedback: MAIN_FEEDBACK,
      objectives: MAIN_OBJECTIVES,
      policy: POLICY_V1,
    });
    expect(output.job.state).toBe("succeeded");
    expect(output.ranking).toBe(pinnedEcho);
  });
});

// ---------------------------------------------------------------------------
// Built-in ranker v1 — determinism corpus + honest-empty + spot checks
// ---------------------------------------------------------------------------

describe("built-in deterministic ranker v1", () => {
  const mainInput = {
    catalog: MAIN_CATALOG,
    library: MAIN_LIBRARY,
    watchHistory: MAIN_WATCH,
    feedback: MAIN_FEEDBACK,
    objectives: MAIN_OBJECTIVES,
    policy: POLICY_V1,
    asOf: AS_OF,
  };

  it("pins the main corpus byte-for-byte (fixture corpus + pinned output)", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    expect(canonicalRankingJson(result)).toBe(PINNED_MAIN);
  });

  it("is order-independent: reversed input arrays produce identical bytes", () => {
    const result = rankWithBuiltInPolicy({
      ...mainInput,
      catalog: SHUFFLED_CATALOG,
      library: SHUFFLED_LIBRARY,
      watchHistory: SHUFFLED_WATCH,
      feedback: SHUFFLED_FEEDBACK,
    });
    const main = rankWithBuiltInPolicy(mainInput);
    expect(canonicalRankingJson(result)).toBe(canonicalRankingJson(main));
  });

  it("double-run equality: two runs deep-equal with identical canonical bytes", () => {
    const first = rankWithBuiltInPolicy(mainInput);
    const second = rankWithBuiltInPolicy(mainInput);
    expect(second).toEqual(first);
    expect(canonicalRankingJson(second)).toBe(canonicalRankingJson(first));
  });

  it("spot-checks the v1 arithmetic (in-library, fraction, recency, pin, focus, fit)", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    expect(result.kind).toBe("ranked");
    if (result.kind !== "ranked") return;
    const a = result.items.find((item) => item.itemId === "item-a")!;
    expect(a.score).toBe(0.4016);
    expect(a.reasons.map((reason) => reason.text)).toEqual([
      "In your library",
      "Continue watching — 62% done",
      "Recently watched related titles: Rust Compiler Deep Dive",
      "Matches your focus: rust",
      "Fits your 30-minute session budget (25 min)",
    ]);
    expect(a.reasons.map((reason) => reason.contribution)).toEqual([
      0.15, 0.093, 0.0536, 0.045, 0.06,
    ]);
    const b = result.items.find((item) => item.itemId === "item-b")!;
    expect(b.reasons.find((reason) => reason.family === "explicit-feedback")!.text).toBe(
      "You pinned it",
    );
    const e = result.items.find((item) => item.itemId === "item-e")!;
    expect(e.reasons.find((reason) => reason.text.startsWith("Fits your"))!.text).toBe(
      "Fits your 30-minute session budget (22 min)",
    );
  });

  it("sorts items by (score desc, item id asc) — the corpus order is a > b > e > c", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    if (result.kind !== "ranked") throw new Error("expected ranked");
    expect(result.items.map((item) => item.itemId)).toEqual([
      "item-a",
      "item-b",
      "item-e",
      "item-c",
    ]);
  });

  it("suppresses negative-feedback and exclusion-term items entirely (absent, not down-ranked)", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    if (result.kind !== "ranked") throw new Error("expected ranked");
    const ids = result.items.map((item) => item.itemId);
    expect(ids).not.toContain("item-d"); // thumbs-down + exclusion term
    expect(ids).not.toContain("item-f"); // zero-signal: no reason could be produced
  });

  it("drops zero-signal items (reasons-mandatory: no signal, no recommendation)", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    if (result.kind !== "ranked") throw new Error("expected ranked");
    for (const item of result.items) {
      expect(item.reasons.length).toBeGreaterThan(0);
      expect(item.score).toBeGreaterThan(0);
    }
  });

  it("every evidence pointer resolves to a concrete input signal", () => {
    const result = rankWithBuiltInPolicy(mainInput);
    if (result.kind !== "ranked") throw new Error("expected ranked");
    const feedbackIds = new Set(MAIN_FEEDBACK.map((event) => event.id));
    const libraryIds = new Set(MAIN_LIBRARY.map((fact) => fact.itemId));
    const watchIds = new Set(MAIN_WATCH.map((state) => state.itemId));
    const objectiveFields = new Set([
      "topicFocuses",
      "exclusions",
      "timeBudgets.perSessionMinutes",
      "timeBudgets.weeklyMinutes",
    ]);
    for (const item of result.items) {
      for (const reason of item.reasons) {
        for (const pointer of reason.evidence) {
          if (pointer.kind === "feedback-event")
            expect(feedbackIds.has(pointer.eventId)).toBe(true);
          if (pointer.kind === "library-fact") expect(libraryIds.has(pointer.itemId)).toBe(true);
          if (pointer.kind === "watched-state") expect(watchIds.has(pointer.itemId)).toBe(true);
          if (pointer.kind === "objective") expect(objectiveFields.has(pointer.field)).toBe(true);
        }
      }
    }
  });

  it("honest-empty matrix: empty-catalog / no-local-signals / no-ranked-candidates", () => {
    expect(
      canonicalRankingJson(
        rankWithBuiltInPolicy({
          ...mainInput,
          catalog: [],
        }),
      ),
    ).toBe(PINNED_EMPTY_CATALOG);

    expect(
      canonicalRankingJson(
        rankWithBuiltInPolicy({
          ...mainInput,
          library: NO_SIGNALS_LIBRARY,
          watchHistory: NO_SIGNALS_WATCH,
          feedback: NO_SIGNALS_FEEDBACK,
          objectives: null,
        }),
      ),
    ).toBe(PINNED_NO_SIGNALS);

    expect(
      canonicalRankingJson(
        rankWithBuiltInPolicy({
          ...mainInput,
          objectives: ALL_EXCLUDED_OBJECTIVES,
          feedback: [],
        }),
      ),
    ).toBe(PINNED_ALL_EXCLUDED);

    expect(
      canonicalRankingJson(
        rankWithBuiltInPolicy({
          ...mainInput,
          library: NO_SIGNALS_LIBRARY,
          watchHistory: NO_SIGNALS_WATCH,
          feedback: IMPLICIT_ONLY_FEEDBACK,
          objectives: null,
        }),
      ),
    ).toBe(PINNED_IMPLICIT_ONLY);
  });

  it("implicit feedback is recorded but not consumed by v1 (no double-counting)", () => {
    const result = rankWithBuiltInPolicy({
      ...mainInput,
      library: NO_SIGNALS_LIBRARY,
      watchHistory: NO_SIGNALS_WATCH,
      feedback: IMPLICIT_ONLY_FEEDBACK,
      objectives: null,
    });
    expect(result.kind).toBe("empty");
    if (result.kind === "empty") expect(result.reason).toBe("no-ranked-candidates");
  });

  it("rejects unknown policy versions with the typed policy-unsupported error", () => {
    expectWebFlixError(
      () => rankWithBuiltInPolicy({ ...mainInput, policy: { version: "v2" as "v1" } }),
      ErrorCode.IntelligencePolicyUnsupported,
    );
  });
});

// ---------------------------------------------------------------------------
// DeriveArtifactBookkeeping
// ---------------------------------------------------------------------------

describe("DeriveArtifactBookkeeping", () => {
  const deps = {
    registry: new InMemoryArtifactRegistry(),
    clock: new FakeClock(),
    generateId: sequenceIds("art"),
  };

  it("creates a descriptor whose source exists; originals are never mutated", async () => {
    const catalog: readonly CatalogItem[] = [catalogItem("item-a", "Rust Systems Programming")];
    const before = JSON.stringify(catalog);
    const bookkeeping = new DeriveArtifactBookkeeping(deps);
    const descriptor = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "transcript",
      lineage: {
        modelId: "whisper-small",
        modelVersion: "2026-09",
        producedBy: "webflix.transcribe.adapter",
      },
      licenseNote: "model output; check the model license",
      catalog,
    });
    expect(descriptor.kind).toBe("transcript");
    expect(descriptor.licenseNote).toBe("model output; check the model license");
    expect(await deps.registry.get(descriptor.id)).toBe(descriptor);
    // structural separation: the caller's catalog snapshot is untouched
    expect(JSON.stringify(catalog)).toBe(before);
  });

  it("surfaces a domain lineage violation as the typed artifact-invalid error (dangling source)", async () => {
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: new InMemoryArtifactRegistry(),
      clock: new FakeClock(),
      generateId: sequenceIds("art"),
    });
    const wfe = await expectWebFlixErrorAsync(
      () =>
        bookkeeping.create({
          sourceItemId: "item-missing",
          kind: "summary",
          lineage: { modelId: "m", modelVersion: "1", producedBy: "p" },
          catalog: [catalogItem("item-a", "Rust Systems Programming")],
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    expect(wfe.reason).toContain("not present in the catalog snapshot");
  });

  it("rejects a kind outside the closed enum (tts is honestly not a kind this order)", async () => {
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: new InMemoryArtifactRegistry(),
      clock: new FakeClock(),
      generateId: sequenceIds("art"),
    });
    await expectWebFlixErrorAsync(
      () =>
        bookkeeping.create({
          sourceItemId: "item-a",
          kind: "tts" as never,
          lineage: { modelId: "m", modelVersion: "1", producedBy: "p" },
          catalog: [catalogItem("item-a", "Rust Systems Programming")],
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  it("lists deterministically by (createdAt, id) and filters by source", async () => {
    const registry = new InMemoryArtifactRegistry();
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry,
      clock: new FakeClock(),
      generateId: sequenceIds("art"),
    });
    const catalog: readonly CatalogItem[] = [
      catalogItem("item-a", "Rust Systems Programming"),
      catalogItem("item-b", "Cooking Pasta 101"),
    ];
    await bookkeeping.create({
      sourceItemId: "item-b",
      kind: "qa",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p" },
      catalog,
    });
    await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "overview",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p" },
      catalog,
    });
    await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "translation",
      lineage: { modelId: "m", modelVersion: "1", producedBy: "p" },
      catalog,
    });
    const all = await bookkeeping.list();
    expect(all.map((descriptor) => descriptor.kind)).toEqual(["qa", "overview", "translation"]);
    const ofA = await bookkeeping.list("item-a");
    expect(ofA.map((descriptor) => descriptor.kind)).toEqual(["overview", "translation"]);
    expect((await bookkeeping.list("item-missing")).length).toBe(0);
  });
});
