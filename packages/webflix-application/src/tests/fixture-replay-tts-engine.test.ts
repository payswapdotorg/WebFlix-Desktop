/**
 * FixtureReplayTtsEngine tests (P4-TRANSLATE row 4): the DETERMINISTIC TEST
 * DOUBLE for the TTS seam — canned results (with FRESH audio copies per
 * call), honest progress totals, both-phase cooperative cancellation,
 * failure injection, and the never-fabricates configuration honesty.
 * Mirrors the fixture-replay-summary-engine suite (the established double
 * contract).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TtsEngineProgress } from "webflix-contracts";
import {
  FIXTURE_REPLAY_TTS_ENGINE_DESCRIPTOR,
  FIXTURE_REPLAY_TTS_ENGINE_ID,
  FIXTURE_REPLAY_TTS_ENGINE_VERSION,
  FixtureReplayTtsEngine,
} from "../index";
import type { FixtureReplayTtsScript } from "../index";

const REQUEST = {
  text: "welcome to the brave new world",
  voice: { id: "en_US-amy-medium" },
} as const;

const CANNED_AUDIO = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const CANNED_RESULT = {
  audio: CANNED_AUDIO,
  contentType: "audio/wav",
} as const;

async function expectTypedError(
  fn: () => Promise<unknown> | unknown,
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

describe("fixture-replay TTS engine (TEST DOUBLE)", () => {
  it("is clearly labelled a TEST DOUBLE in its runtime descriptor", () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT });
    expect(engine.descriptor.id).toBe(FIXTURE_REPLAY_TTS_ENGINE_ID);
    expect(engine.descriptor.version).toBe(FIXTURE_REPLAY_TTS_ENGINE_VERSION);
    expect(engine.descriptor.label).toContain("TEST DOUBLE");
    expect(engine.descriptor.label).toContain("no real speech synthesis");
    // Honest absence: the double has no external engine to read facts from.
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();
    expect(engine.descriptor).toEqual(FIXTURE_REPLAY_TTS_ENGINE_DESCRIPTOR);
  });

  it("replays the canned audio byte-for-byte, as a FRESH copy per call", async () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT, units: 1 });
    const first = await engine.synthesize({ ...REQUEST });
    const second = await engine.synthesize({ ...REQUEST });
    expect(Array.from(first.audio)).toEqual(Array.from(CANNED_AUDIO));
    expect(first.contentType).toBe("audio/wav");
    expect(first.audio).not.toBe(CANNED_AUDIO);
    expect(first.audio).not.toBe(second.audio);
    // Mutation safety: a caller corrupting its copy never corrupts the script.
    first.audio[0] = 0;
    const third = await engine.synthesize({ ...REQUEST });
    expect(third.audio[0]).toBe(0x52);
    expect(engine.calls.length).toBe(3);
    expect(engine.calls[0]?.request).toEqual(REQUEST);
  });

  it("replays per-run lineage facts ONLY when the fixture volunteers them", async () => {
    const withLineage = new FixtureReplayTtsEngine({
      synthesize: { ...CANNED_RESULT, engineVersion: "1.2.0", modelLineage: "amy" },
      units: 1,
    });
    const result = await withLineage.synthesize({ ...REQUEST });
    expect(result.engineVersion).toBe("1.2.0");
    expect(result.modelLineage).toBe("amy");
    const withoutLineage = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT, units: 1 });
    const bare = await withoutLineage.synthesize({ ...REQUEST });
    expect(bare.engineVersion).toBeUndefined();
    expect(bare.modelLineage).toBeUndefined();
  });

  it("ticks honest progress: one event per unit, totals known up front", async () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT, units: 3 });
    const seen: TtsEngineProgress[] = [];
    await engine.synthesize({ ...REQUEST }, { onProgress: (progress) => seen.push(progress) });
    expect(seen).toEqual([
      { completedUnits: 1, totalUnits: 3 },
      { completedUnits: 2, totalUnits: 3 },
      { completedUnits: 3, totalUnits: 3 },
    ]);
    expect(engine.calls[0]?.progress).toEqual(seen);
  });

  it("boundary cancellation: an already-aborted signal rejects typed Cancelled, no units ticked", async () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT });
    const controller = new AbortController();
    controller.abort();
    const err = await expectTypedError(
      () => engine.synthesize({ ...REQUEST }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.reason).toContain("boundary");
  });

  it("mid-run cancellation: the cooperative checkpoint rejects typed Cancelled between units", async () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT, units: 4 });
    const controller = new AbortController();
    const seen: TtsEngineProgress[] = [];
    const promise = engine.synthesize(
      { ...REQUEST },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          seen.push(progress);
          if (progress.completedUnits === 2) controller.abort();
        },
      },
    );
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      expect(WebFlixError.is(err)).toBe(true);
      expect((err as WebFlixError).code).toBe(ErrorCode.Cancelled);
      expect((err as WebFlixError).reason).toContain("cooperatively after 2 of 4 units");
      return true;
    });
    expect(seen.map((progress) => progress.completedUnits)).toEqual([1, 2]);
  });

  it("a THROWN onProgress callback is a stop request — the caller's error propagates as-is", async () => {
    const engine = new FixtureReplayTtsEngine({ synthesize: CANNED_RESULT, units: 3 });
    const stop = new Error("caller-mandated stop");
    await expect(
      engine.synthesize(
        { ...REQUEST },
        {
          onProgress: () => {
            throw stop;
          },
        },
      ),
    ).rejects.toBe(stop);
  });

  it("failAfterUnits: the typed tts-engine-failed error AFTER N units (the engine-reported-failure path)", async () => {
    const engine = new FixtureReplayTtsEngine({
      synthesize: CANNED_RESULT,
      units: 3,
      failAfterUnits: 2,
    });
    await expect(engine.synthesize({ ...REQUEST })).rejects.toSatisfy((err: unknown) => {
      expect(WebFlixError.is(err)).toBe(true);
      expect((err as WebFlixError).code).toBe(ErrorCode.IntelligenceTtsEngineFailed);
      expect((err as WebFlixError).reason).toContain("after 2 of 3 units");
      return true;
    });
  });

  it("no canned result => typed not-implemented — a test double NEVER fabricates a result", async () => {
    const engine = new FixtureReplayTtsEngine({});
    const err = await expectTypedError(
      () => engine.synthesize({ ...REQUEST }),
      ErrorCode.NotImplemented,
    );
    expect(err.reason).toContain("never fabricates results");
  });

  it("the descriptor comes from the fixture ONLY (lineage honesty fixtures)", () => {
    const script: FixtureReplayTtsScript = {
      synthesize: CANNED_RESULT,
      descriptor: {
        id: "webflix.test-tts-adapter-identity",
        label: "Test TTS adapter",
        version: "9.9.9",
        engineVersion: "1.0.0",
        licenseNote: null,
      },
    };
    const engine = new FixtureReplayTtsEngine(script);
    expect(engine.descriptor.id).toBe("webflix.test-tts-adapter-identity");
    expect(engine.descriptor.version).toBe("9.9.9");
    expect(engine.descriptor.engineVersion).toBe("1.0.0");
  });
});
