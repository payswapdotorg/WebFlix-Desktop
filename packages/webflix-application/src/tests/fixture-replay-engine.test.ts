/**
 * FixtureReplayTranscriptionEngine tests (P4-TRANSCRIBE row 3a): the
 * DETERMINISTIC TEST DOUBLE for the transcription-engine port.
 *
 * These tests pin the double's own honest-state contract — the exact
 * properties the pipeline's tests rely on:
 * - determinism: the same script => byte-for-byte the same segments, forever;
 * - progress with an honestly-known totalSegments;
 * - cancellation at the boundary AND cooperatively between segments (both
 *   rejecting with the TYPED common/cancelled error, no result);
 * - a THROWN onProgress callback is honoured as a stop request (the caller's
 *   error propagates as-is);
 * - typed engine-failure injection after N segments;
 * - lineage honesty: absent per-run facts stay absent — the double never
 *   invents engineVersion/modelLineage values.
 *
 * HERMETIC: no filesystem, no network, no wall clock, no timers — the only
 * asynchrony is the microtask queue, whose drain order is deterministic.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranscriptSegment } from "webflix-contracts";
import {
  FIXTURE_REPLAY_ENGINE_DESCRIPTOR,
  FIXTURE_REPLAY_ENGINE_ID,
  FIXTURE_REPLAY_ENGINE_VERSION,
  FixtureReplayTranscriptionEngine,
} from "../index";
import type { FixtureReplayScript } from "../index";

const SEGMENTS: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
];

const script = (over: Partial<FixtureReplayScript> = {}): FixtureReplayScript => ({
  segments: SEGMENTS,
  ...over,
});

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

describe("FixtureReplayTranscriptionEngine (the labelled TEST DOUBLE)", () => {
  // -------------------------------------------------------------------------
  // Identity + descriptor honesty
  // -------------------------------------------------------------------------
  it("exposes a descriptor that LABELS itself a test double and omits lineage it cannot know", () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    expect(engine.descriptor.id).toBe(FIXTURE_REPLAY_ENGINE_ID);
    expect(engine.descriptor.version).toBe(FIXTURE_REPLAY_ENGINE_VERSION);
    expect(engine.descriptor.label).toContain("TEST DOUBLE");
    // Honest absence: the double has no external binary to read lineage from.
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();
    expect(engine.descriptor.licenseNote).toBeNull();
    expect(FIXTURE_REPLAY_ENGINE_DESCRIPTOR.label).toContain("TEST DOUBLE");
  });

  // -------------------------------------------------------------------------
  // Determinism + replay semantics
  // -------------------------------------------------------------------------
  it("replays the canned segments verbatim — the same script is byte-for-byte the same output", async () => {
    const first = new FixtureReplayTranscriptionEngine(script());
    const second = new FixtureReplayTranscriptionEngine(script());
    const a = await first.transcribe({ mediaPath: "/media/a.mkv" });
    const b = await second.transcribe({ mediaPath: "/media/a.mkv" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.segments).toEqual(SEGMENTS);
  });

  it("records the request verbatim (mediaPath + language hint) for assertions", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    await engine.transcribe({ mediaPath: "/media/a.mkv", language: "en" });
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.request).toEqual({ mediaPath: "/media/a.mkv", language: "en" });
    expect(engine.calls[0]?.signalAbortedAtEntry).toBe(false);
  });

  it("an empty script is the honest no-speech result: empty segments, no progress events", async () => {
    const engine = new FixtureReplayTranscriptionEngine({ segments: [] });
    const result = await engine.transcribe({ mediaPath: "/media/a.mkv" });
    expect(result.segments).toEqual([]);
    expect(engine.calls[0]?.progress).toEqual([]);
    // Per-run facts absent when the script reports none.
    expect(result.language).toBeUndefined();
    expect(result.engineVersion).toBeUndefined();
    expect(result.modelLineage).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Progress
  // -------------------------------------------------------------------------
  it("surfaces progress after each segment with the honestly-known totalSegments", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    await engine.transcribe({ mediaPath: "/media/a.mkv" });
    expect(engine.calls[0]?.progress).toEqual([
      { completedSegments: 1, totalSegments: 3, lastEndMs: 1500 },
      { completedSegments: 2, totalSegments: 3, lastEndMs: 3000 },
      { completedSegments: 3, totalSegments: 3, lastEndMs: 4500 },
    ]);
  });

  // -------------------------------------------------------------------------
  // Cancellation — boundary + cooperative mid-run
  // -------------------------------------------------------------------------
  it("boundary cancellation: an already-aborted signal rejects with the typed cancelled error, engine never starts work", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    const controller = new AbortController();
    controller.abort();
    const err = await expectWebFlixErrorAsync(
      () => engine.transcribe({ mediaPath: "/media/a.mkv" }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.context).toMatchObject({ phase: "engine-run" });
    // The call WAS recorded (assertion evidence) with its entry fact…
    expect(engine.calls[0]?.signalAbortedAtEntry).toBe(true);
    // …but zero segments were replayed: no progress, no partial result.
    expect(engine.calls[0]?.progress).toEqual([]);
  });

  it("cooperative mid-run cancellation: an abort between segments rejects typed-cancelled after exactly the completed prefix", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    const controller = new AbortController();
    const pending = engine.transcribe({ mediaPath: "/media/a.mkv" }, { signal: controller.signal });
    // Queued AFTER the engine's first in-run microtask and BEFORE its second
    // segment checkpoint: the drain order is deterministic, so the abort
    // lands between segment 1 and segment 2 every time.
    queueMicrotask(() => controller.abort());
    const err = await expectWebFlixErrorAsync(() => pending, ErrorCode.Cancelled);
    expect(err.reason).toContain("after 1 of 3 segments");
    expect(err.context).toMatchObject({ phase: "engine-run" });
    // One segment completed before the cooperative stop.
    expect(engine.calls[0]?.progress).toHaveLength(1);
  });

  it("a THROWN onProgress callback is honoured as a stop request: the caller's error propagates as-is", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script());
    const stop = new WebFlixError({
      code: ErrorCode.Cancelled,
      reason: "caller requested stop from onProgress",
      retryable: false,
      context: { phase: "engine-run" },
    });
    await expect(
      engine.transcribe({ mediaPath: "/media/a.mkv" }, { onProgress: () => void 0 }),
    ).resolves.toBeDefined();
    const rejected = engine.transcribe(
      { mediaPath: "/media/a.mkv" },
      {
        onProgress: () => {
          throw stop;
        },
      },
    );
    await expect(rejected).rejects.toBe(stop);
  });

  // -------------------------------------------------------------------------
  // Failure injection
  // -------------------------------------------------------------------------
  it("failAfterSegments injects the typed engine-failed error after N segments", async () => {
    const engine = new FixtureReplayTranscriptionEngine(script({ failAfterSegments: 2 }));
    const err = await expectWebFlixErrorAsync(
      () => engine.transcribe({ mediaPath: "/media/a.mkv" }),
      ErrorCode.IntelligenceEngineFailed,
    );
    expect(err.reason).toContain("after 2 segments");
    expect(err.context).toMatchObject({ engineId: FIXTURE_REPLAY_ENGINE_ID, completedSegments: 2 });
    expect(engine.calls[0]?.progress).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Per-run fact honesty
  // -------------------------------------------------------------------------
  it("per-run facts appear ONLY when the script reports them — never invented", async () => {
    const engine = new FixtureReplayTranscriptionEngine(
      script({ result: { language: "en", engineVersion: "1.7.4", modelLineage: "ggml-base.en" } }),
    );
    const result = await engine.transcribe({ mediaPath: "/media/a.mkv" });
    expect(result.language).toBe("en");
    expect(result.engineVersion).toBe("1.7.4");
    expect(result.modelLineage).toBe("ggml-base.en");

    const silent = new FixtureReplayTranscriptionEngine(script({ result: {} }));
    const silentResult = await silent.transcribe({ mediaPath: "/media/a.mkv" });
    expect(silentResult.language).toBeUndefined();
    expect(silentResult.engineVersion).toBeUndefined();
    expect(silentResult.modelLineage).toBeUndefined();
  });

  it("a descriptor override is exposed verbatim (lineage-honesty fixtures)", async () => {
    const engine = new FixtureReplayTranscriptionEngine({
      segments: SEGMENTS,
      descriptor: {
        id: "fixture.custom",
        label: "Custom fixture engine",
        version: "9.9.9",
        engineVersion: "reported-by-fixture",
        modelLineage: "fixture-model",
        licenseNote: "fixture license note",
      },
    });
    expect(engine.descriptor).toEqual({
      id: "fixture.custom",
      label: "Custom fixture engine",
      version: "9.9.9",
      engineVersion: "reported-by-fixture",
      modelLineage: "fixture-model",
      licenseNote: "fixture license note",
    });
  });
});
