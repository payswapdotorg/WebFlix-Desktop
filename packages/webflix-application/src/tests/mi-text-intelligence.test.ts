/**
 * The text-intelligence use case tests (P4-SUMMARIZE row 4): mi.summarize,
 * mi.overview and mi.qa — the derived-artifact producers over STORED
 * transcripts, riding the frozen §2.6 job wrapper.
 *
 * Every honest-state behaviour the work order demands is pinned here:
 * - the happy path through a REAL seeded transcript (mi.transcribe ran
 *   first — the payload amendment feeds the pipeline end to end): artifact
 *   kinds summary/overview/qa through the durable registry seam with full
 *   lineage, the engine reading the STORED payload by artifact id;
 * - the charter lineage for the BUILT-IN engine: modelId
 *   webflix.extractive.v1, modelVersion "v1", producedBy
 *   webflix.built-in-summary-engine, the source transcript artifact id in
 *   the inputsHash inputs, licenseNote null — and the honest
 *   descriptor-based resolution for NON-built-in engines;
 * - cancellation BOTH phases (boundary: engine never touched; mid-run:
 *   cooperative between units) => Cancelled + NO artifact;
 * - engine failures => the failed job stamped + the typed error rethrown
 *   through TextIntelligenceJobError (cause's code intact);
 * - the typed payload-absent state (pre-0004 transcripts), unknown-artifact
 *   and non-transcript-artifact caller defects surfaced as job failures;
 * - pre-job caller defects (blank ids/questions) typed BEFORE the job
 *   exists;
 * - the SOURCE transcript artifact NEVER mutated (deep-equal across
 *   success, cancellation and failure);
 * - determinism: same inputs => same inputsHash + byte-identical result.
 *
 * HERMETIC: no filesystem, no network, no wall clock, no timers — the only
 * asynchrony is the deterministic microtask queue.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  JobDescriptor,
  SummaryEngineDescriptor,
  TranscriptSegment,
} from "webflix-contracts";
import {
  AnswerFromTranscript,
  BuildTranscriptOverview,
  BUILT_IN_SUMMARY_ENGINE,
  DeriveArtifactBookkeeping,
  FixtureReplayTranscriptionEngine,
  FixtureReplaySummaryEngine,
  InMemoryArtifactRegistry,
  InMemoryTranscriptPayloadStore,
  InMemoryTextPayloadStore,
  SummarizeTranscript,
  TextIntelligenceJobError,
  TranscribeMediaFile,
  textPayloadChecksum,
  transcriptPayloadChecksum,
  OVERVIEW_JOB_KIND,
  QA_JOB_KIND,
  SUMMARIZE_JOB_KIND,
  type FixtureReplaySummaryScript,
} from "../index";
import type { ClockPort } from "../ports";

// The exact toISOString() form of the pinned instant (no truncation games).
const AS_OF = "2026-10-12T09:00:00.000Z";

const SEGMENTS: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
];

/** A content-rich transcript for the built-in engine end-to-end path. */
const LECTURE: readonly TranscriptSegment[] = [
  {
    startMs: 0,
    endMs: 6000,
    text: "Good morning everyone. Today we are going to talk about the deployment pipeline.",
  },
  {
    startMs: 6000,
    endMs: 12000,
    text: "A deployment pipeline takes your commit from review all the way to production.",
  },
  {
    startMs: 12000,
    endMs: 18000,
    text: "The first stage is testing. Unit tests run on every single commit.",
  },
  {
    startMs: 18000,
    endMs: 24000,
    text: "Integration tests follow. They exercise the whole system together.",
  },
  {
    startMs: 24000,
    endMs: 30000,
    text: "Once testing passes, the build artifact is packaged and stamped with a checksum.",
  },
  {
    startMs: 30000,
    endMs: 36000,
    text: "The second stage is rollout. We deploy to staging first, never straight to production.",
  },
  {
    startMs: 36000,
    endMs: 42000,
    text: "Staging runs for an hour while monitoring collects error rates and latency.",
  },
  {
    startMs: 42000,
    endMs: 48000,
    text: "If the error budget holds, promotion to production happens automatically.",
  },
  {
    startMs: 48000,
    endMs: 54000,
    text: "Database changes are the risky part. Migrations must be backwards compatible.",
  },
  {
    startMs: 54000,
    endMs: 60000,
    text: "A failed migration means rollback, and rollback plans must be rehearsed.",
  },
  {
    startMs: 60000,
    endMs: 66000,
    text: "Finally, observability. Dashboards tell you the pipeline is actually healthy.",
  },
  { startMs: 66000, endMs: 72000, text: "Thank you for listening. Questions are welcome now." },
];

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

const CATALOG: readonly CatalogItem[] = [
  catalogItem("item-a", "Rust Compiler Deep Dive"),
  catalogItem("item-b", "Advanced Pasta Making"),
];

class FakeClock implements ClockPort {
  now(): Date {
    return new Date(AS_OF);
  }
}

/** Deterministic id source: same prefix + same call count => same ids. */
function sequenceIds(prefix = "id"): () => string {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

/**
 * A deterministic, timer-free test signal: `aborted` reads FALSE for the
 * first `reads` accesses and TRUE afterwards — the cooperative-mid-run
 * cancellation probe (see the mid-run test for the exact read sequence).
 * Structural cast: only the `aborted` read matters to the engines' signal
 * checkpoints (no listener is ever attached on this path).
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

const CANNED: FixtureReplaySummaryScript = {
  summarize: { sentences: [{ text: "hello", segmentIndex: 0, startMs: 0, endMs: 1500 }] },
  overview: { chapters: [{ title: "chapter 1", startMs: 0, endMs: 4500, segmentCount: 3 }] },
  answer: { spans: [{ quote: "brave", segmentIndex: 1, startMs: 1500, endMs: 3000 }] },
  units: 3,
};

interface Harness {
  readonly engine: FixtureReplaySummaryEngine;
  readonly registry: InMemoryArtifactRegistry;
  readonly payloads: InMemoryTranscriptPayloadStore;
  readonly textPayloads: InMemoryTextPayloadStore;
  readonly summarize: SummarizeTranscript;
  readonly overview: BuildTranscriptOverview;
  readonly answer: AnswerFromTranscript;
  readonly transcript: DerivedArtifact;
}

/**
 * Seeds a REAL transcript artifact (mi.transcribe with the transcription
 * fixture double) and builds the three text-intelligence use cases over the
 * SAME registry + payload store — the pipeline's own amendment feeds them.
 */
async function makeHarness(
  script: FixtureReplaySummaryScript = CANNED,
  segments: readonly TranscriptSegment[] = SEGMENTS,
): Promise<Harness> {
  const engine = new FixtureReplaySummaryEngine(script);
  const registry = new InMemoryArtifactRegistry();
  const payloads = new InMemoryTranscriptPayloadStore();
  const textPayloads = new InMemoryTextPayloadStore();
  const clock = new FakeClock();
  const transcribe = new TranscribeMediaFile({
    engine: new FixtureReplayTranscriptionEngine({ segments }),
    registry,
    payloadStore: payloads,
    clock,
    generateId: sequenceIds("seed"),
  });
  const { artifact } = await transcribe.execute({
    sourceItemId: "item-a",
    mediaPath: "/library/videos/item-a.mkv",
    catalog: CATALOG,
  });
  if (artifact === null) {
    throw new Error("transcript seeding failed — the fixture engine never fails unprompted");
  }
  const deps = {
    engine,
    registry,
    payloads,
    textPayloads,
    clock,
    generateId: sequenceIds("job"),
  };
  return {
    engine,
    registry,
    payloads,
    textPayloads,
    summarize: new SummarizeTranscript(deps),
    overview: new BuildTranscriptOverview(deps),
    answer: new AnswerFromTranscript(deps),
    transcript: artifact,
  };
}

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

const input = (h: Harness, over: { signal?: AbortSignal } = {}) => ({
  transcriptArtifactId: h.transcript.id,
  catalog: CATALOG,
  ...(over.signal !== undefined ? { signal: over.signal } : {}),
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------
describe("mi.summarize / mi.overview / mi.qa (the §2.6 job wrapper happy paths)", () => {
  it("mi.summarize: Succeeded job + DerivedArtifact kind=summary + the canned result", async () => {
    const h = await makeHarness();
    const output = await h.summarize.execute(input(h));

    expect(output.job.state).toBe("succeeded");
    expect(output.job.kind).toBe(SUMMARIZE_JOB_KIND);
    expect(output.job.attempts).toBe(0);
    expect(output.job.cancellable).toBe(true);
    expect(output.result).toEqual(CANNED.summarize);

    const artifact = output.artifact;
    expect(artifact).not.toBeNull();
    expect(artifact?.kind).toBe("summary");
    expect(artifact?.sourceItemId).toBe("item-a");
    // Lineage for a NON-built-in engine: the descriptor's own identity.
    expect(artifact?.lineage.modelId).toBe(h.engine.descriptor.id);
    expect(artifact?.lineage.modelVersion).toBe(h.engine.descriptor.version);
    expect(artifact?.lineage.producedBy).toBe(h.engine.descriptor.id);
    expect(artifact?.lineage.inputsHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(artifact?.lineage.generatedAt).toBe(AS_OF);
    expect(artifact?.licenseNote).toBeNull();
  });

  it("mi.overview: Succeeded job + DerivedArtifact kind=overview", async () => {
    const h = await makeHarness();
    const output = await h.overview.execute(input(h));

    expect(output.job.state).toBe("succeeded");
    expect(output.job.kind).toBe(OVERVIEW_JOB_KIND);
    expect(output.result).toEqual(CANNED.overview);
    expect(output.artifact?.kind).toBe("overview");
    expect(output.artifact?.sourceItemId).toBe("item-a");
  });

  it("mi.qa: Succeeded job + DerivedArtifact kind=qa; the question rides the job payload", async () => {
    const h = await makeHarness();
    const output = await h.answer.execute({ ...input(h), question: "which word is brave?" });

    expect(output.job.state).toBe("succeeded");
    expect(output.job.kind).toBe(QA_JOB_KIND);
    expect(output.result).toEqual(CANNED.answer);
    expect(output.artifact?.kind).toBe("qa");
    // The job payload records the question + the source transcript id + the engine.
    const payload = output.job.payload as Record<string, unknown>;
    expect(payload["transcriptArtifactId"]).toBe(h.transcript.id);
    expect(payload["question"]).toBe("which word is brave?");
    expect(payload["engineId"]).toBe(h.engine.descriptor.id);
    expect(payload["engineLabel"]).toBe(h.engine.descriptor.label);
  });

  it("the engine read the STORED payload by artifact id (the seeded transcript's segments)", async () => {
    const h = await makeHarness();
    await h.summarize.execute(input(h));
    await h.answer.execute({ ...input(h), question: "which word?" });

    expect(h.engine.calls).toHaveLength(2);
    expect(h.engine.calls[0]?.request).toEqual({ segments: SEGMENTS });
    expect(h.engine.calls[1]?.request).toEqual({ segments: SEGMENTS, question: "which word?" });
  });

  it("the §2.6 job descriptor shape is exact (cancellable, single-attempt, provenance)", async () => {
    const h = await makeHarness();
    const { job } = await h.summarize.execute(input(h));
    expect(Object.keys(job).sort()).toEqual(
      [
        "attempts",
        "cancelRequested",
        "cancellable",
        "createdAt",
        "finishedAt",
        "id",
        "kind",
        "payload",
        "priority",
        "provenance",
        "retry",
        "startedAt",
        "state",
        "updatedAt",
      ].sort(),
    );
    expect(job.retry).toEqual({ maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] });
    expect(job.provenance).toEqual({
      connectorId: h.engine.descriptor.id,
      connectorVersion: h.engine.descriptor.version,
      generatedAt: AS_OF,
    });
  });

  it("the artifacts list through the registry next to their source transcript", async () => {
    const h = await makeHarness();
    await h.summarize.execute(input(h));
    await h.overview.execute(input(h));
    await h.answer.execute({ ...input(h), question: "which word?" });

    const listed = await h.registry.list();
    expect(listed.map((a) => a.kind).sort()).toEqual(["overview", "qa", "summary", "transcript"]);
    // All derived from the SAME original.
    for (const artifact of listed) {
      expect(artifact.sourceItemId).toBe("item-a");
    }
  });

  it("an EMPTY engine result is still SUCCESS with its artifact (honest empty)", async () => {
    const h = await makeHarness({ ...CANNED, summarize: { sentences: [] } });
    const output = await h.summarize.execute(input(h));
    expect(output.job.state).toBe("succeeded");
    expect(output.result).toEqual({ sentences: [] });
    expect(output.artifact?.kind).toBe("summary");
  });
});

// ---------------------------------------------------------------------------
// The charter lineage + the built-in engine end to end
// ---------------------------------------------------------------------------
describe("the built-in extractive engine through the pipeline (charter lineage)", () => {
  async function makeBuiltInHarness(): Promise<{
    summarize: SummarizeTranscript;
    overview: BuildTranscriptOverview;
    answer: AnswerFromTranscript;
    transcript: DerivedArtifact;
    payloads: InMemoryTranscriptPayloadStore;
    textPayloads: InMemoryTextPayloadStore;
  }> {
    const registry = new InMemoryArtifactRegistry();
    const payloads = new InMemoryTranscriptPayloadStore();
    const textPayloads = new InMemoryTextPayloadStore();
    const clock = new FakeClock();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: LECTURE }),
      registry,
      payloadStore: payloads,
      clock,
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const deps = {
      engine: BUILT_IN_SUMMARY_ENGINE,
      registry,
      payloads,
      textPayloads,
      clock,
      generateId: sequenceIds("job"),
    };
    return {
      summarize: new SummarizeTranscript(deps),
      overview: new BuildTranscriptOverview(deps),
      answer: new AnswerFromTranscript(deps),
      transcript: artifact as DerivedArtifact,
      payloads,
      textPayloads,
    };
  }

  it("lineage pins the charter values: webflix.extractive.v1 by webflix.built-in-summary-engine", async () => {
    const h = await makeBuiltInHarness();
    const output = await h.summarize.execute({
      transcriptArtifactId: h.transcript.id,
      catalog: CATALOG,
    });
    expect(output.job.state).toBe("succeeded");
    expect(output.artifact?.lineage.modelId).toBe("webflix.extractive.v1");
    expect(output.artifact?.lineage.modelVersion).toBe("v1");
    expect(output.artifact?.lineage.producedBy).toBe("webflix.built-in-summary-engine");
    expect(output.artifact?.licenseNote).toBeNull();
  });

  it("the REAL extractive result flows through: sentences cite the stored segments", async () => {
    const h = await makeBuiltInHarness();
    const output = await h.summarize.execute({
      transcriptArtifactId: h.transcript.id,
      catalog: CATALOG,
    });
    expect(output.result?.sentences.length).toBeGreaterThan(0);
    for (const sentence of output.result?.sentences ?? []) {
      const segment = LECTURE[sentence.segmentIndex] as TranscriptSegment;
      expect(segment.text.includes(sentence.text)).toBe(true);
    }
  });

  it("QUOTE DISCIPLINE through the pipeline: every qa span quotes the STORED segment verbatim", async () => {
    const h = await makeBuiltInHarness();
    const output = await h.answer.execute({
      transcriptArtifactId: h.transcript.id,
      catalog: CATALOG,
      question: "what happens to the database during a failed migration?",
    });
    expect(output.result?.spans.length).toBeGreaterThan(0);
    const stored = await h.payloads.get(h.transcript.id);
    for (const span of output.result?.spans ?? []) {
      const segment = stored.segments[span.segmentIndex] as TranscriptSegment;
      expect(span.quote).toBe(segment.text);
    }
  });

  it("a NON-built-in engine reporting modelLineage/engineVersion resolves its model identity honestly", async () => {
    const descriptor: SummaryEngineDescriptor = {
      id: "webflix.some-model-adapter",
      label: "Some local model (user-selected)",
      version: "0.2.1",
      engineVersion: "2.0.7",
      modelLineage: "some-model-instruct-v2",
      licenseNote: "check the model license before redistribution",
    };
    const registry = new InMemoryArtifactRegistry();
    const payloads = new InMemoryTranscriptPayloadStore();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
      registry,
      payloadStore: payloads,
      clock: new FakeClock(),
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const useCase = new SummarizeTranscript({
      engine: new FixtureReplaySummaryEngine({ ...CANNED, descriptor }),
      registry,
      payloads,
      textPayloads: new InMemoryTextPayloadStore(),
      clock: new FakeClock(),
      generateId: sequenceIds("job"),
    });
    const output = await useCase.execute({
      transcriptArtifactId: (artifact as DerivedArtifact).id,
      catalog: CATALOG,
    });
    expect(output.artifact?.lineage.modelId).toBe("some-model-instruct-v2");
    expect(output.artifact?.lineage.modelVersion).toBe("2.0.7");
    expect(output.artifact?.lineage.producedBy).toBe("webflix.some-model-adapter");
    expect(output.artifact?.licenseNote).toBe("check the model license before redistribution");
  });
});

// ---------------------------------------------------------------------------
// Determinism + inputsHash honesty
// ---------------------------------------------------------------------------
describe("determinism and inputsHash honesty", () => {
  it("same inputs => byte-identical result + the SAME inputsHash (two runs, two artifacts)", async () => {
    const h = await makeHarness();
    const one = await h.summarize.execute(input(h));
    const two = await h.summarize.execute(input(h));
    expect(JSON.stringify(one.result)).toBe(JSON.stringify(two.result));
    expect(one.artifact?.lineage.inputsHash).toBe(two.artifact?.lineage.inputsHash);
    // Two DISTINCT artifacts (re-running the job derives anew).
    expect(one.artifact?.id).not.toBe(two.artifact?.id);
  });

  it("a DIFFERENT question => a DIFFERENT inputsHash (the question is an input)", async () => {
    const h = await makeHarness();
    const one = await h.answer.execute({ ...input(h), question: "which word?" });
    const two = await h.answer.execute({ ...input(h), question: "another question entirely?" });
    expect(one.artifact?.lineage.inputsHash).not.toBe(two.artifact?.lineage.inputsHash);
  });

  it("a DIFFERENT stored payload => a DIFFERENT inputsHash (the payload checksum is an input)", async () => {
    const one = await makeHarness(); // SEGMENTS payload
    const two = await makeHarness(CANNED, [
      { startMs: 0, endMs: 1500, text: "completely different transcript" },
    ]);
    const a = await one.summarize.execute(input(one));
    const b = await two.summarize.execute(input(two));
    expect(a.artifact?.lineage.inputsHash).not.toBe(b.artifact?.lineage.inputsHash);
    expect(transcriptPayloadChecksum(SEGMENTS)).not.toBe(
      transcriptPayloadChecksum([
        { startMs: 0, endMs: 1500, text: "completely different transcript" },
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Failure states (typed, job stamped failed)
// ---------------------------------------------------------------------------
describe("failure states — typed errors with the job stamped failed", () => {
  it("payload-absent: a transcript artifact WITHOUT a stored payload is the typed absent state", async () => {
    const h = await makeHarness();
    // Craft a pre-0004-style transcript: descriptor in the registry, no payload.
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: h.registry,
      clock: new FakeClock(),
      generateId: sequenceIds("old"),
    });
    const oldTranscript = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "transcript",
      lineage: {
        modelId: "webflix.whisper-cpp-local",
        modelVersion: "0.1.0",
        producedBy: "webflix.whisper-cpp-local",
      },
      catalog: CATALOG,
    });

    const err = await expectWebFlixErrorAsync(
      () => h.summarize.execute({ transcriptArtifactId: oldTranscript.id, catalog: CATALOG }),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
    expect(err.reason).toContain("re-run mi.transcribe");
    // The error carries the FAILED job for inspection (the job-error pattern).
    expect(err).toBeInstanceOf(TextIntelligenceJobError);
    const jobErr = err as TextIntelligenceJobError;
    expect(jobErr.job.state).toBe("failed");
    expect(jobErr.job.lastError).toContain("transcript-payload-absent");
    // NO artifact was created.
    const listed = await h.registry.list();
    expect(listed.filter((a) => a.kind === "summary")).toHaveLength(0);
  });

  it("artifact-absent: an unknown transcript artifact id is a job failure with the typed caller defect", async () => {
    const h = await makeHarness();
    const err = await expectWebFlixErrorAsync(
      () => h.summarize.execute({ transcriptArtifactId: "art-never-existed", catalog: CATALOG }),
      ErrorCode.IntelligenceSummaryInvalid,
    );
    expect(err).toBeInstanceOf(TextIntelligenceJobError);
    expect((err as TextIntelligenceJobError).job.state).toBe("failed");
    expect(err.reason).toContain("not in the registry");
  });

  it("kind-mismatch: referencing a SUMMARY artifact as the transcript is a typed caller defect", async () => {
    const h = await makeHarness();
    const { artifact } = await h.summarize.execute(input(h));
    const err = await expectWebFlixErrorAsync(
      () =>
        h.overview.execute({
          transcriptArtifactId: (artifact as DerivedArtifact).id,
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceSummaryInvalid,
    );
    expect(err.reason).toContain('"summary"');
    expect(err.reason).toContain("transcripts only");
  });

  it("engine failure: failAfterUnits => job failed + the typed engine error rethrown through the job error", async () => {
    const h = await makeHarness({ ...CANNED, failAfterUnits: 2 });
    const err = await expectWebFlixErrorAsync(
      () => h.overview.execute(input(h)),
      ErrorCode.IntelligenceEngineFailed,
    );
    expect(err).toBeInstanceOf(TextIntelligenceJobError);
    const jobErr = err as TextIntelligenceJobError;
    expect(jobErr.job.state).toBe("failed");
    expect(jobErr.job.lastError).toContain("engine-failed");
    const listed = await h.registry.list();
    expect(listed.filter((a) => a.kind === "overview")).toHaveLength(0);
  });

  it("pre-job caller defects (blank ids/questions) throw typed summary-invalid with NO job at all", async () => {
    const h = await makeHarness();
    for (const blank of ["", "   "]) {
      const err = await expectWebFlixErrorAsync(
        () => h.summarize.execute({ transcriptArtifactId: blank, catalog: CATALOG }),
        ErrorCode.IntelligenceSummaryInvalid,
      );
      // NOT a job error: no job descriptor exists (validated before creation).
      expect(err).not.toBeInstanceOf(TextIntelligenceJobError);
    }
    const blankQuestion = await expectWebFlixErrorAsync(
      () => h.answer.execute({ ...input(h), question: "   " }),
      ErrorCode.IntelligenceSummaryInvalid,
    );
    expect(blankQuestion).not.toBeInstanceOf(TextIntelligenceJobError);
    // The engine was never touched by any of the rejected calls.
    expect(h.engine.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cancellation — both phases, NO artifact
// ---------------------------------------------------------------------------
describe("cancellation — both phases, NO artifact", () => {
  it("boundary: a pre-aborted signal Cancels the job and NEVER touches the engine or stores", async () => {
    const h = await makeHarness();
    const controller = new AbortController();
    controller.abort();
    const output = await h.summarize.execute(input(h, { signal: controller.signal }));

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    expect(h.engine.calls).toHaveLength(0);
    // Only the seeded transcript exists.
    expect(await h.registry.list()).toHaveLength(1);
  });

  it("mid-run: a cooperative engine stop surfaces as Cancelled, NO artifact, partial work discarded", async () => {
    const h = await makeHarness({ ...CANNED, units: 3 });
    // A signal that flips to aborted after its 4th read — deterministic,
    // timer-free. Read sequence through this use case + the double:
    // 1 = the use case's boundary check, 2 = the double's entry recording,
    // 3 = the double's boundary check, 4 = the unit-1 checkpoint (still
    // live — unit 1 completes and ticks progress), 5 = the unit-2
    // checkpoint => the cooperative stop fires there.
    const signal = flipAfterReads(4);
    const output = await h.answer.execute({ ...input(h), question: "which word?", signal });

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    expect(output.job.lastError).toContain("cooperatively after 1 of 3");
    // The engine RAN (the honest mid-run path — one unit of progress), and
    // the partial work was discarded: no qa artifact.
    expect(h.engine.calls).toHaveLength(1);
    expect(h.engine.calls[0]?.progress).toHaveLength(1);
    expect((await h.registry.list()).filter((a) => a.kind === "qa")).toHaveLength(0);
  });

  it("an abort landing DURING the store reads is caught at the engine boundary => Cancelled, NO artifact", async () => {
    const h = await makeHarness({ ...CANNED, units: 3 });
    const controller = new AbortController();
    const pending = h.answer.execute({
      ...input(h),
      question: "which word?",
      signal: controller.signal,
    });
    // The abort microtask lands while the use case awaits its store reads
    // (before the engine call); the forwarded signal is then caught at the
    // ENGINE's boundary checkpoint — still a cancelled job, still no artifact.
    queueMicrotask(() => controller.abort());
    const output = await pending;

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    expect(h.engine.calls).toHaveLength(1);
    expect(h.engine.calls[0]?.progress).toHaveLength(0);
    expect((await h.registry.list()).filter((a) => a.kind === "qa")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The source transcript is NEVER mutated
// ---------------------------------------------------------------------------
describe("source-transcript-untouched (deep-equal across every outcome)", () => {
  it("success, cancellation and failure all leave the source transcript artifact and payload deep-equal", async () => {
    const h = await makeHarness();
    const before = await h.registry.get(h.transcript.id);
    const payloadBefore = await h.payloads.get(h.transcript.id);

    await h.summarize.execute(input(h)); // success

    const controller = new AbortController();
    controller.abort();
    await h.overview.execute(input(h, { signal: controller.signal })); // boundary cancellation

    const failing = await makeHarness({ ...CANNED, failAfterUnits: 1 });
    await failing.answer.execute({ ...input(failing), question: "which word?" }).then(
      () => null,
      () => null,
    ); // failure — rethrow shape pinned elsewhere

    const after = await h.registry.get(h.transcript.id);
    const payloadAfter = await h.payloads.get(h.transcript.id);
    expect(after).toEqual(before);
    expect(payloadAfter).toEqual(payloadBefore);
    expect(payloadAfter.checksum).toBe(transcriptPayloadChecksum(SEGMENTS));
  });
});

// ---------------------------------------------------------------------------
// The in-memory payload store default (the pure-test seam)
// ---------------------------------------------------------------------------
describe("InMemoryTranscriptPayloadStore (the pure-test default)", () => {
  it("put/get round-trips; same-id put replaces; absence is typed", async () => {
    const store = new InMemoryTranscriptPayloadStore();
    const payload = {
      artifactId: "art-1",
      segments: SEGMENTS,
      checksum: transcriptPayloadChecksum(SEGMENTS),
    };
    await store.put(payload);
    expect(await store.get("art-1")).toEqual(payload);
    const replacement = SEGMENTS.slice(0, 1);
    await store.put({
      ...payload,
      segments: replacement,
      checksum: transcriptPayloadChecksum(replacement),
    });
    expect((await store.get("art-1")).segments).toEqual(replacement);
    await expectWebFlixErrorAsync(
      () => store.get("art-missing"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
  });

  it("put validates defensively: bad checksum / blank id / invalid segments are typed rejections", async () => {
    const store = new InMemoryTranscriptPayloadStore();
    await expectWebFlixErrorAsync(
      () =>
        store.put({
          artifactId: "art-1",
          segments: SEGMENTS,
          checksum: "fnv1a32:deadbeef",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.put({
          artifactId: "  ",
          segments: SEGMENTS,
          checksum: transcriptPayloadChecksum(SEGMENTS),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.put({
          artifactId: "art-1",
          segments: [{ startMs: 500, endMs: 100, text: "backwards" }],
          checksum: transcriptPayloadChecksum([{ startMs: 500, endMs: 100, text: "backwards" }]),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    // Nothing was stored by any rejected put.
    await expectWebFlixErrorAsync(
      () => store.get("art-1"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
  });
});

// ---------------------------------------------------------------------------
// Job-error surface
// ---------------------------------------------------------------------------
describe("TextIntelligenceJobError (the rethrow shape)", () => {
  it("mirrors the cause's code/reason and carries the failed job descriptor", async () => {
    const h = await makeHarness({ ...CANNED, failAfterUnits: 1 });
    const err = await h.summarize.execute(input(h)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TextIntelligenceJobError);
    const jobErr = err as TextIntelligenceJobError;
    expect(jobErr.code).toBe(ErrorCode.IntelligenceEngineFailed);
    expect(jobErr.job).toBeDefined();
    expect((jobErr.job as JobDescriptor).state).toBe("failed");
    // The cause stays attached for callers that unwrap.
    expect(WebFlixError.is(jobErr.cause)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P4-TRANSLATE amendment: the text projections persist on success ONLY
// ---------------------------------------------------------------------------
describe("the P4-TRANSLATE text-projection amendment (payload put BEFORE the descriptor)", () => {
  it("mi.summarize success persists the sentence-text projection under the SAME upfront artifact id", async () => {
    const h = await makeHarness();
    const output = await h.summarize.execute(input(h));
    expect(output.artifact).not.toBeNull();
    const stored = await h.textPayloads.get(output.artifact!.id);
    expect(stored).toEqual({
      artifactId: output.artifact!.id,
      kind: "summary",
      text: "hello",
      checksum: textPayloadChecksum("hello"),
    });
  });

  it("mi.overview success persists the chapter-title projection (titles joined ' ')", async () => {
    const h = await makeHarness();
    const output = await h.overview.execute(input(h));
    const stored = await h.textPayloads.get(output.artifact!.id);
    expect(stored.kind).toBe("overview");
    expect(stored.text).toBe("chapter 1");
  });

  it("mi.qa success persists the span-quote projection (quotes joined ' ')", async () => {
    const h = await makeHarness();
    const output = await h.answer.execute({ ...input(h), question: "which word?" });
    const stored = await h.textPayloads.get(output.artifact!.id);
    expect(stored.kind).toBe("qa");
    expect(stored.text).toBe("brave");
  });

  it("an EMPTY summary is still success and persists its EMPTY projection honestly", async () => {
    const h = await makeHarness({ ...CANNED, summarize: { sentences: [] } });
    const output = await h.summarize.execute(input(h));
    expect(output.job.state).toBe("succeeded");
    const stored = await h.textPayloads.get(output.artifact!.id);
    expect(stored.text).toBe("");
    expect(stored.checksum).toBe(textPayloadChecksum(""));
  });

  it("cancelled and failed runs persist NO text projection (the amendment's unchanged half)", async () => {
    const cancelledHarness = await makeHarness();
    const controller = new AbortController();
    controller.abort();
    const cancelled = await cancelledHarness.summarize.execute(
      input(cancelledHarness, { signal: controller.signal }),
    );
    expect(cancelled.job.state).toBe("cancelled");
    expect(cancelled.artifact).toBeNull();
    await expect(
      cancelledHarness.textPayloads.get(cancelled.artifact?.id ?? "id-none"),
    ).rejects.toSatisfy((err: unknown) => {
      return WebFlixError.is(err) && err.code === ErrorCode.IntelligenceTextPayloadAbsent;
    });

    const failedHarness = await makeHarness({ ...CANNED, failAfterUnits: 1 });
    await failedHarness.summarize.execute(input(failedHarness)).then(
      () => {
        throw new Error("the injected failure must reject");
      },
      () => undefined,
    );
    // No payload rows exist at all.
    expect((await failedHarness.registry.list()).length).toBe(1);
    await expect(failedHarness.textPayloads.get(failedHarness.transcript.id)).rejects.toSatisfy(
      (err: unknown) => {
        return WebFlixError.is(err) && err.code === ErrorCode.IntelligenceTextPayloadAbsent;
      },
    );
  });

  it("a text-payload PUT failure leaves NO artifact (put-before-descriptor ordering)", async () => {
    const engine = new FixtureReplaySummaryEngine(CANNED);
    const registry = new InMemoryArtifactRegistry();
    const payloads = new InMemoryTranscriptPayloadStore();
    const textPayloads = new InMemoryTextPayloadStore();
    const clock = new FakeClock();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
      registry,
      payloadStore: payloads,
      clock,
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const failing = {
      async put(): Promise<void> {
        throw new WebFlixError({
          code: ErrorCode.IntelligenceArtifactInvalid,
          reason: "injected put failure (test)",
          retryable: false,
          context: {},
        });
      },
      async get(id: string) {
        return textPayloads.get(id);
      },
    };
    const summarize = new SummarizeTranscript({
      engine,
      registry,
      payloads,
      textPayloads: failing,
      clock,
      generateId: sequenceIds("job"),
    });
    const err = await summarize
      .execute({ transcriptArtifactId: artifact!.id, catalog: CATALOG })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(TextIntelligenceJobError);
    expect((err as TextIntelligenceJobError).job.state).toBe("failed");
    // The registry holds ONLY the seed transcript — no artifact existed.
    expect((await registry.list()).length).toBe(1);
  });
});
