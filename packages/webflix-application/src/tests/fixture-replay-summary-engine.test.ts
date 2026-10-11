/**
 * FixtureReplaySummaryEngine tests (P4-SUMMARIZE row 5): the DETERMINISTIC
 * TEST DOUBLE for the summary engine port — canned replay, honest progress
 * totals, both-phase cancellation (boundary + cooperative between units),
 * thrown-onProgress stop requests, failure injection, honest
 * not-implemented for unconfigured operations, and the labelled-test-double
 * identity (the label IS the disclosure).
 *
 * HERMETIC: no filesystem, no network, no wall clock, no timers — the only
 * asynchrony is the deterministic microtask queue.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { SummaryEngineDescriptor, TranscriptSegment } from "webflix-contracts";
import {
  FIXTURE_REPLAY_SUMMARY_ENGINE_DESCRIPTOR,
  FIXTURE_REPLAY_SUMMARY_ENGINE_ID,
  FixtureReplaySummaryEngine,
  type FixtureReplaySummaryScript,
} from "../index";

const SEGMENTS: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
];

const SCRIPT: FixtureReplaySummaryScript = {
  summarize: { sentences: [{ text: "hello", segmentIndex: 0, startMs: 0, endMs: 1500 }] },
  overview: { chapters: [{ title: "chapter 1", startMs: 0, endMs: 4500, segmentCount: 3 }] },
  answer: { spans: [{ quote: "brave", segmentIndex: 1, startMs: 1500, endMs: 3000 }] },
};

async function expectTypedError(
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

describe("FixtureReplaySummaryEngine (the labelled test double)", () => {
  it("replays the canned results STRUCTURALLY unchanged, deterministically across runs", async () => {
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    const one = await engine.summarize({ segments: SEGMENTS });
    const two = await engine.summarize({ segments: SEGMENTS });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one).toEqual(SCRIPT.summarize);
    expect(await engine.overview({ segments: SEGMENTS })).toEqual(SCRIPT.overview);
    expect(await engine.answer({ segments: SEGMENTS, question: "which word?" })).toEqual(
      SCRIPT.answer,
    );
  });

  it("records requests verbatim (segments AND the question) with per-operation tags", async () => {
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    await engine.summarize({ segments: SEGMENTS });
    await engine.answer({ segments: SEGMENTS, question: "which word?" });
    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[0]?.operation).toBe("summarize");
    expect(engine.calls[0]?.request).toEqual({ segments: SEGMENTS });
    expect(engine.calls[1]?.operation).toBe("answer");
    expect(engine.calls[1]?.request).toEqual({ segments: SEGMENTS, question: "which word?" });
  });

  it("progress fires once per unit with the honestly-known total (default 3, custom honoured)", async () => {
    const engine = new FixtureReplaySummaryEngine({ ...SCRIPT, units: 5 });
    const events: { completedUnits: number; totalUnits?: number }[] = [];
    await engine.overview(
      { segments: SEGMENTS },
      {
        onProgress: (progress) => {
          events.push({ completedUnits: progress.completedUnits, totalUnits: progress.totalUnits });
        },
      },
    );
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual({ completedUnits: 1, totalUnits: 5 });
    expect(events.at(-1)).toEqual({ completedUnits: 5, totalUnits: 5 });

    const defaults = new FixtureReplaySummaryEngine(SCRIPT);
    const defaultEvents: number[] = [];
    await defaults.summarize(
      { segments: SEGMENTS },
      {
        onProgress: (progress) => {
          defaultEvents.push(progress.completedUnits);
        },
      },
    );
    expect(defaultEvents).toEqual([1, 2, 3]);
  });

  it("boundary cancellation: an already-aborted signal rejects typed Cancelled, no units ticked", async () => {
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    const controller = new AbortController();
    controller.abort();
    const err = await expectTypedError(
      () => engine.answer({ segments: SEGMENTS, question: "what?" }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.reason).toContain("boundary");
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.signalAbortedAtEntry).toBe(true);
    expect(engine.calls[0]?.progress).toHaveLength(0);
  });

  it("mid-run cancellation (deterministic queueMicrotask ordering): typed Cancelled between units", async () => {
    const engine = new FixtureReplaySummaryEngine({ ...SCRIPT, units: 3 });
    const controller = new AbortController();
    const pending = engine.summarize({ segments: SEGMENTS }, { signal: controller.signal });
    queueMicrotask(() => controller.abort());
    const err = await expectTypedError(() => pending, ErrorCode.Cancelled);
    expect(err.reason).toContain("cooperatively after 1 of 3");
    // One unit of progress had ticked before the checkpoint caught the abort.
    expect(engine.calls[0]?.progress).toHaveLength(1);
  });

  it("a THROWN onProgress is a stop request: the caller's error propagates AS-IS", async () => {
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    const stop = new WebFlixError({
      code: ErrorCode.Cancelled,
      reason: "caller stop request",
      retryable: false,
      context: {},
    });
    let ticks = 0;
    const err = await engine
      .overview(
        { segments: SEGMENTS },
        {
          onProgress: () => {
            ticks += 1;
            throw stop;
          },
        },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBe(stop);
    expect(ticks).toBe(1);
  });

  it("failAfterUnits injects the typed engine-failed error AFTER N units", async () => {
    const engine = new FixtureReplaySummaryEngine({ ...SCRIPT, units: 4, failAfterUnits: 2 });
    const err = await expectTypedError(
      () => engine.answer({ segments: SEGMENTS, question: "what?" }),
      ErrorCode.IntelligenceEngineFailed,
    );
    expect(err.reason).toContain("after 2 of 4 units");
    expect(err.context).toMatchObject({ engineId: engine.descriptor.id, completedUnits: 2 });
    expect(engine.calls[0]?.progress).toHaveLength(2);
  });

  it("an UNCONFIGURED operation rejects typed not-implemented — a test double never fabricates results", async () => {
    const engine = new FixtureReplaySummaryEngine({ summarize: SCRIPT.summarize });
    const err = await expectTypedError(
      () => engine.overview({ segments: SEGMENTS }),
      ErrorCode.NotImplemented,
    );
    expect(err.reason).toContain("no canned overview result");
    // The rejected call was never recorded (no replay happened).
    expect(engine.calls).toHaveLength(0);
    // The configured operation still works.
    expect(await engine.summarize({ segments: SEGMENTS })).toEqual(SCRIPT.summarize);
  });

  it("the default descriptor is the LABELLED test-double identity; overrides are honoured", () => {
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    expect(engine.descriptor).toEqual(FIXTURE_REPLAY_SUMMARY_ENGINE_DESCRIPTOR);
    expect(engine.descriptor.id).toBe(FIXTURE_REPLAY_SUMMARY_ENGINE_ID);
    // The label IS the disclosure — it says TEST DOUBLE in plain words.
    expect(engine.descriptor.label).toContain("TEST DOUBLE");
    expect(engine.descriptor.licenseNote).toBeNull();
    // engineVersion/modelLineage honestly absent (no external model).
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();

    const override: SummaryEngineDescriptor = {
      id: "webflix.test-override",
      label: "Override engine (lineage honesty fixture)",
      version: "9.9.9",
      engineVersion: "1.2.3",
      modelLineage: "some-model-v2",
      licenseNote: "test license note",
    };
    expect(new FixtureReplaySummaryEngine({ ...SCRIPT, descriptor: override }).descriptor).toEqual(
      override,
    );
  });

  it("satisfies the SummaryEnginePort interface structurally (the seam compiles)", async () => {
    // Type-level: the double implements the port (checked by tsc); the
    // runtime fact pinned here is simply that all three methods exist.
    const engine = new FixtureReplaySummaryEngine(SCRIPT);
    expect(typeof engine.summarize).toBe("function");
    expect(typeof engine.overview).toBe("function");
    expect(typeof engine.answer).toBe("function");
    expect(typeof engine.descriptor).toBe("object");
  });
});
