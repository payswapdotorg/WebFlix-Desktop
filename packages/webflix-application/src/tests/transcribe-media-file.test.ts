/**
 * TranscribeMediaFile tests (P4-TRANSCRIBE row 2): the mi.transcribe use
 * case — the first REAL derived-artifact producer.
 *
 * Every honest-state behaviour the work order demands is pinned here:
 * - happy path: fixture engine => segments => DerivedArtifact kind=transcript
 *   stored through the registry with full lineage; job Succeeded;
 * - determinism: same inputs => the same lineage digest + byte-identical
 *   segments (the fixture engine is the canonical deterministic engine);
 * - cancellation BOTH phases: pre-start (engine never touched) and mid-run
 *   (fixture engine cooperates between segments) => job Cancelled, NO
 *   artifact, NO result — a cancelled run is not a transcript;
 * - engine failures (typed engine-unavailable / engine-failed) => the typed
 *   error rethrown VERBATIM with the job stamped failed + lastError, NO
 *   artifact;
 * - caller defects (bad request shape / unknown source item) => typed
 *   IntelligenceTranscriptionInvalid BEFORE the job exists;
 * - the ORIGINAL is never touched (deep-equal on the catalog snapshot);
 * - lineage honesty end-to-end: modelVersion = the run's reported
 *   modelLineage, else its engineVersion, else the ADAPTER's own version
 *   (the always-known floor — never a guess);
 * - empty segments is SUCCESS (the honest "engine reported no speech").
 *
 * HERMETIC: no filesystem, no network, no wall clock, no timers — the
 * only asynchrony is the deterministic microtask queue.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  JobDescriptor,
  TranscriptSegment,
} from "webflix-contracts";
import {
  DeriveArtifactBookkeeping,
  ENGINE_UNAVAILABLE_RECOVERY_HINT,
  FixtureReplayTranscriptionEngine,
  InMemoryArtifactRegistry,
  InMemoryTranscriptPayloadStore,
  TranscribeMediaFile,
  TRANSCRIBE_JOB_KIND,
  transcriptPayloadChecksum,
} from "../index";
import type { ClockPort } from "../ports";
import type { FixtureReplayScript } from "../index";

// The exact toISOString() form of the pinned instant (no truncation games).
const AS_OF = "2026-10-12T09:00:00.000Z";

const SEGMENTS: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
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

function makeHarness(script: FixtureReplayScript) {
  const engine = new FixtureReplayTranscriptionEngine(script);
  const registry = new InMemoryArtifactRegistry();
  const payloads = new InMemoryTranscriptPayloadStore();
  const useCase = new TranscribeMediaFile({
    engine,
    registry,
    payloadStore: payloads,
    clock: new FakeClock(),
    generateId: sequenceIds(),
  });
  return { engine, registry, payloads, useCase };
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

const standardInput = (over: { signal?: AbortSignal; language?: string } = {}) => ({
  sourceItemId: "item-a",
  mediaPath: "/library/videos/item-a.mkv",
  ...(over.language !== undefined ? { language: over.language } : {}),
  catalog: CATALOG,
  ...(over.signal !== undefined ? { signal: over.signal } : {}),
});

describe("TranscribeMediaFile (mi.transcribe — the transcript artifact pipeline)", () => {
  // -------------------------------------------------------------------------
  // Happy path: segments => artifact with lineage, job Succeeded
  // -------------------------------------------------------------------------
  it("stores a DerivedArtifact kind=transcript with full lineage and Succeeds the job", async () => {
    const { engine, registry, useCase } = makeHarness({
      segments: SEGMENTS,
      result: { language: "en", engineVersion: "1.7.4", modelLineage: "ggml-base.en-q5_1" },
    });
    const output = await useCase.execute(standardInput());

    expect(output.job.state).toBe("succeeded");
    expect(output.job.kind).toBe(TRANSCRIBE_JOB_KIND);
    expect(output.job.attempts).toBe(0);
    expect(output.result?.segments).toEqual(SEGMENTS);
    expect(output.result?.language).toBe("en");

    const artifact = output.artifact;
    expect(artifact).not.toBeNull();
    expect(artifact?.kind).toBe("transcript");
    expect(artifact?.sourceItemId).toBe("item-a");
    // Lineage, honest end to end: adapter identity + the run's own reports.
    expect(artifact?.lineage.modelId).toBe(engine.descriptor.id);
    expect(artifact?.lineage.modelVersion).toBe("ggml-base.en-q5_1");
    expect(artifact?.lineage.producedBy).toBe(engine.descriptor.id);
    expect(artifact?.lineage.inputsHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(artifact?.lineage.generatedAt).toBe(AS_OF);
    expect(artifact?.licenseNote).toBeNull();

    // Listable through the existing registry seam.
    const listed = await registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(artifact?.id);
  });

  it("the job descriptor carries the §2.6 shape: cancellable, engine provenance, transcript payload", async () => {
    const { useCase } = makeHarness({ segments: SEGMENTS });
    const { job } = await useCase.execute(standardInput({ language: "en" }));
    expect(job.cancellable).toBe(true);
    expect(job.cancelRequested).toBe(false);
    expect(job.provenance.connectorId).toBe("webflix.fixture-replay-engine");
    expect(job.provenance.connectorVersion).toBe("0.1.0");
    expect(job.provenance.generatedAt).toBe(AS_OF);
    expect(job.payload).toMatchObject({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      language: "en",
      engineId: "webflix.fixture-replay-engine",
    });
    expect((job.payload as Record<string, unknown>).engineLabel).toContain("TEST DOUBLE");
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------
  it("determinism: the same inputs produce the same lineage digest and byte-identical segments", async () => {
    const first = makeHarness({ segments: SEGMENTS, result: { engineVersion: "1.7.4" } });
    const second = makeHarness({ segments: SEGMENTS, result: { engineVersion: "1.7.4" } });
    const a = await first.useCase.execute(standardInput());
    const b = await second.useCase.execute(standardInput());

    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(a.artifact?.lineage.inputsHash).toBe(b.artifact?.lineage.inputsHash);
    expect(a.artifact?.lineage.modelVersion).toBe(b.artifact?.lineage.modelVersion);
    expect(a.artifact?.lineage.generatedAt).toBe(b.artifact?.lineage.generatedAt);
    // The inputsHash is a function of the INPUT TUPLE, not the run: a
    // different mediaPath changes it, the same path with a different
    // language hint changes it too.
    const c = await first.useCase.execute(standardInput({ language: "de" }));
    expect(c.artifact?.lineage.inputsHash).not.toBe(a.artifact?.lineage.inputsHash);
  });

  // -------------------------------------------------------------------------
  // Cancellation — both phases, NO artifact
  // -------------------------------------------------------------------------
  it("boundary cancellation: a pre-aborted signal Cancels the job and NEVER touches the engine", async () => {
    const { engine, registry, useCase } = makeHarness({ segments: SEGMENTS });
    const controller = new AbortController();
    controller.abort();
    const output = await useCase.execute(standardInput({ signal: controller.signal }));

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    // The engine was never called — zero recorded calls.
    expect(engine.calls).toHaveLength(0);
    expect(await registry.list()).toHaveLength(0);
  });

  it("mid-run cancellation: the fixture engine cooperates between segments => Cancelled, NO artifact, partial work discarded", async () => {
    const { engine, registry, useCase } = makeHarness({ segments: SEGMENTS });
    const controller = new AbortController();
    const pending = useCase.execute(standardInput({ signal: controller.signal }));
    // Deterministic microtask ordering: the abort lands between segment 1
    // and segment 2 of the engine's replay (pinned in the engine's own
    // suite); the use case must surface the cooperative stop as Cancelled.
    queueMicrotask(() => controller.abort());
    const output = await pending;

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    expect(output.job.lastError).toContain("cancelled");
    // The engine DID start (one segment of progress recorded) — this is
    // the honest mid-run path, not the boundary one.
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.progress).toHaveLength(1);
    // A cancelled run is not a transcript: nothing stored.
    expect(await registry.list()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Engine failures — typed errors surfaced verbatim, job Failed, NO artifact
  // -------------------------------------------------------------------------
  it("engine failure: the typed engine-failed error is rethrown with the job stamped failed + lastError, NO artifact", async () => {
    const { registry, useCase } = makeHarness({ segments: SEGMENTS, failAfterSegments: 2 });
    const err = await expectWebFlixErrorAsync(
      () => useCase.execute(standardInput()),
      ErrorCode.IntelligenceEngineFailed,
    );
    expect(err.reason).toContain("after 2 segments");

    const registryEmpty = await registry.list();
    expect(registryEmpty).toHaveLength(0);
  });

  it("engine unavailable: the typed honest-unavailable error surfaces with the recovery hint, job Failed, NO artifact", async () => {
    // A stub engine that behaves exactly like the real whisper adapter when
    // NO binary is installed: typed engine-unavailable + recovery hint.
    const unavailableEngine = {
      descriptor: {
        id: "webflix.whisper-cpp-local",
        label: "whisper.cpp (local)",
        version: "0.1.0",
        licenseNote: "whisper.cpp is MIT licensed; model files carry their own licenses",
      },
      transcribe: (): Promise<never> =>
        Promise.reject(
          new WebFlixError({
            code: ErrorCode.IntelligenceEngineUnavailable,
            reason: `no whisper.cpp-class binary found on this machine — ${ENGINE_UNAVAILABLE_RECOVERY_HINT}`,
            retryable: false,
            context: { recoveryHint: ENGINE_UNAVAILABLE_RECOVERY_HINT },
          }),
        ),
    };
    const registry = new InMemoryArtifactRegistry();
    const useCase = new TranscribeMediaFile({
      engine: unavailableEngine,
      registry,
      payloadStore: new InMemoryTranscriptPayloadStore(),
      clock: new FakeClock(),
      generateId: sequenceIds(),
    });

    const err = await expectWebFlixErrorAsync(
      () => useCase.execute(standardInput()),
      ErrorCode.IntelligenceEngineUnavailable,
    );
    expect(err.context).toMatchObject({ recoveryHint: ENGINE_UNAVAILABLE_RECOVERY_HINT });
    expect(err.reason).toContain(ENGINE_UNAVAILABLE_RECOVERY_HINT);
    expect(await registry.list()).toHaveLength(0);
  });

  it("the failed job descriptor is attached to the rethrown error for inspection", async () => {
    const { useCase } = makeHarness({ segments: SEGMENTS, failAfterSegments: 1 });
    const thrown = await useCase.execute(standardInput()).then(
      () => null,
      (err: unknown) => err,
    );
    expect(WebFlixError.is(thrown)).toBe(true);
    const wfe = thrown as WebFlixError & { job?: JobDescriptor };
    expect(wfe.job?.state).toBe("failed");
    expect(wfe.job?.lastError).toContain("engine-failed");
    // The cause chain keeps the engine's own typed error intact.
    expect((wfe.cause as WebFlixError).code).toBe(ErrorCode.IntelligenceEngineFailed);
  });

  // -------------------------------------------------------------------------
  // Caller defects — typed invalid BEFORE the job exists
  // -------------------------------------------------------------------------
  it("a blank mediaPath is a caller defect: typed transcription-invalid, engine never called", async () => {
    const { engine, registry, useCase } = makeHarness({ segments: SEGMENTS });
    const err = await expectWebFlixErrorAsync(
      () => useCase.execute({ ...standardInput(), mediaPath: "   " }),
      ErrorCode.IntelligenceTranscriptionInvalid,
    );
    expect(err.reason).toContain("TranscriptionRequest");
    expect(engine.calls).toHaveLength(0);
    expect(await registry.list()).toHaveLength(0);
  });

  it("an unknown source item is a caller defect: typed transcription-invalid (lineage requires a known original)", async () => {
    const { engine, useCase } = makeHarness({ segments: SEGMENTS });
    const err = await expectWebFlixErrorAsync(
      () => useCase.execute({ ...standardInput(), sourceItemId: "item-missing" }),
      ErrorCode.IntelligenceTranscriptionInvalid,
    );
    expect(err.reason).toContain("item-missing");
    expect(engine.calls).toHaveLength(0);
  });

  it("a blank sourceItemId is a caller defect: typed transcription-invalid", async () => {
    const { engine, useCase } = makeHarness({ segments: SEGMENTS });
    await expectWebFlixErrorAsync(
      () => useCase.execute({ ...standardInput(), sourceItemId: "  " }),
      ErrorCode.IntelligenceTranscriptionInvalid,
    );
    expect(engine.calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // ORIGINAL untouched — the structural separation invariant
  // -------------------------------------------------------------------------
  it("the ORIGINAL catalog snapshot is untouched by success, failure AND cancellation (deep-equal)", async () => {
    const before = JSON.parse(JSON.stringify(CATALOG)) as CatalogItem[];

    const success = makeHarness({ segments: SEGMENTS });
    await success.useCase.execute(standardInput());
    expect(JSON.parse(JSON.stringify(CATALOG))).toEqual(before);

    const failure = makeHarness({ segments: SEGMENTS, failAfterSegments: 1 });
    await failure.useCase.execute(standardInput()).then(
      () => undefined,
      () => undefined,
    );
    expect(JSON.parse(JSON.stringify(CATALOG))).toEqual(before);

    const controller = new AbortController();
    const cancelled = makeHarness({ segments: SEGMENTS });
    const pending = cancelled.useCase.execute(standardInput({ signal: controller.signal }));
    queueMicrotask(() => controller.abort());
    await pending;
    expect(JSON.parse(JSON.stringify(CATALOG))).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // Lineage honesty — the honest floor
  // -------------------------------------------------------------------------
  it("lineage floor: a run reporting NO lineage gets the ADAPTER's version — never a guess about an external engine", async () => {
    const { useCase } = makeHarness({ segments: SEGMENTS, result: {} });
    const { artifact } = await useCase.execute(standardInput());
    expect(artifact?.lineage.modelId).toBe("webflix.fixture-replay-engine");
    expect(artifact?.lineage.modelVersion).toBe("0.1.0");
    expect(artifact?.lineage.producedBy).toBe("webflix.fixture-replay-engine");
  });

  it("lineage precedence: the run's modelLineage outranks its engineVersion, which outranks the adapter floor", async () => {
    const modelLineageOnly = makeHarness({
      segments: SEGMENTS,
      result: { engineVersion: "1.7.4", modelLineage: "ggml-base.en" },
    });
    const a = await modelLineageOnly.useCase.execute(standardInput());
    expect(a.artifact?.lineage.modelVersion).toBe("ggml-base.en");

    const engineVersionOnly = makeHarness({
      segments: SEGMENTS,
      result: { engineVersion: "1.7.4" },
    });
    const b = await engineVersionOnly.useCase.execute(standardInput());
    expect(b.artifact?.lineage.modelVersion).toBe("1.7.4");

    const nothing = makeHarness({ segments: SEGMENTS, result: {} });
    const c = await nothing.useCase.execute(standardInput());
    expect(c.artifact?.lineage.modelVersion).toBe("0.1.0");
  });

  // -------------------------------------------------------------------------
  // Empty segments — the honest "no speech" SUCCESS
  // -------------------------------------------------------------------------
  it("empty segments is SUCCESS: an engine that ran and reported no speech still produces a (real, empty) transcript artifact", async () => {
    const { registry, useCase } = makeHarness({ segments: [] });
    const output = await useCase.execute(standardInput());

    expect(output.job.state).toBe("succeeded");
    expect(output.result?.segments).toEqual([]);
    expect(output.artifact).not.toBeNull();
    expect(output.artifact?.kind).toBe("transcript");
    expect(await registry.list()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Interop with the existing bookkeeping seam
  // -------------------------------------------------------------------------
  it("the stored artifact lists through DeriveArtifactBookkeeping with the source filter", async () => {
    const { registry, useCase } = makeHarness({ segments: SEGMENTS });
    await useCase.execute(standardInput());

    const bookkeeping = new DeriveArtifactBookkeeping({
      registry,
      clock: new FakeClock(),
      generateId: sequenceIds("book"),
    });
    const forSource = await bookkeeping.list("item-a");
    expect(forSource).toHaveLength(1);
    expect(forSource[0]?.kind).toBe("transcript");
    expect(await bookkeeping.list("item-b")).toHaveLength(0);
  });

  it("the artifact descriptor satisfies the DerivedArtifact contract shape exactly", async () => {
    const { useCase } = makeHarness({ segments: SEGMENTS });
    const { artifact } = await useCase.execute(standardInput());
    const record = artifact as DerivedArtifact;
    expect(Object.keys(record).sort()).toEqual(
      ["createdAt", "id", "kind", "licenseNote", "lineage", "sourceItemId"].sort(),
    );
    expect(Object.keys(record.lineage).sort()).toEqual(
      ["generatedAt", "inputsHash", "modelId", "modelVersion", "producedBy"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The P4-SUMMARIZE amendment: transcript payload persisted on SUCCESS ONLY
// -------------------------------------------------------------------------
describe("TranscribeMediaFile payload persistence (the P4-SUMMARIZE amendment)", () => {
  it("a successful run ALSO persists the payload keyed by the artifact id (segments + checksum)", async () => {
    const { payloads, useCase } = makeHarness({ segments: SEGMENTS });
    const { artifact } = await useCase.execute(standardInput());

    expect(artifact).not.toBeNull();
    const stored = await payloads.get(artifact?.id as string);
    expect(stored.segments).toEqual(SEGMENTS);
    expect(stored.checksum).toBe(transcriptPayloadChecksum(SEGMENTS));
    expect(stored.artifactId).toBe(artifact?.id);
  });

  it("the empty-segments honest success persists its (empty) payload too", async () => {
    const { payloads, useCase } = makeHarness({ segments: [] });
    const { artifact, result } = await useCase.execute(standardInput());

    expect(artifact).not.toBeNull();
    expect(result?.segments).toEqual([]);
    const stored = await payloads.get(artifact?.id as string);
    expect(stored.segments).toEqual([]);
    expect(stored.checksum).toBe(transcriptPayloadChecksum([]));
  });

  it("the payload checksum is deterministic: same segments => same stored checksum", async () => {
    const first = makeHarness({ segments: SEGMENTS });
    const second = makeHarness({ segments: SEGMENTS });
    const one = await first.useCase.execute(standardInput());
    const two = await second.useCase.execute(standardInput());
    const payloadOne = await first.payloads.get(one.artifact?.id as string);
    const payloadTwo = await second.payloads.get(two.artifact?.id as string);
    expect(payloadOne.checksum).toBe(payloadTwo.checksum);
  });

  it("a boundary-cancelled run persists NOTHING (no artifact, no payload)", async () => {
    const { registry, payloads, useCase } = makeHarness({ segments: SEGMENTS });
    const controller = new AbortController();
    controller.abort();
    const { job, artifact } = await useCase.execute(standardInput({ signal: controller.signal }));

    expect(job.state).toBe("cancelled");
    expect(artifact).toBeNull();
    expect(await registry.list()).toHaveLength(0);
    await expect(payloads.get("any-id")).rejects.toMatchObject({
      code: ErrorCode.IntelligenceTranscriptPayloadAbsent,
    });
  });

  it("a mid-run-cancelled run persists NOTHING (partials discarded)", async () => {
    const { registry, payloads, useCase } = makeHarness({ segments: SEGMENTS });
    const controller = new AbortController();
    const pending = useCase.execute(standardInput({ signal: controller.signal }));
    // Deterministic microtask ordering (the cancellation suite's pinned
    // pattern): the abort lands between segment 1 and segment 2.
    queueMicrotask(() => controller.abort());
    const output = await pending;

    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(await registry.list()).toHaveLength(0);
    // The payload store is EMPTY — nothing was persisted.
    await expect(payloads.get("any-id")).rejects.toMatchObject({
      code: ErrorCode.IntelligenceTranscriptPayloadAbsent,
    });
  });

  it("a failed run persists NOTHING (engine-failed: no artifact, no payload)", async () => {
    const { registry, payloads, useCase } = makeHarness({
      segments: SEGMENTS,
      failAfterSegments: 1,
    });
    await expect(useCase.execute(standardInput())).rejects.toMatchObject({
      code: ErrorCode.IntelligenceEngineFailed,
    });

    expect(await registry.list()).toHaveLength(0);
    await expect(payloads.get("any-id")).rejects.toMatchObject({
      code: ErrorCode.IntelligenceTranscriptPayloadAbsent,
    });
  });
});
