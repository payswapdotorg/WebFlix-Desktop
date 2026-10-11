/**
 * FixtureReplayTranslationEngine tests (P4-TRANSLATE row 4): the
 * DETERMINISTIC TEST DOUBLE for the translation seam — canned results,
 * honest progress totals, both-phase cooperative cancellation, failure
 * injection, and the never-fabricates configuration honesty. Mirrors the
 * fixture-replay-summary-engine suite (the established double contract).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranslationEngineProgress } from "webflix-contracts";
import {
  FIXTURE_REPLAY_TRANSLATION_ENGINE_DESCRIPTOR,
  FIXTURE_REPLAY_TRANSLATION_ENGINE_ID,
  FIXTURE_REPLAY_TRANSLATION_ENGINE_VERSION,
  FixtureReplayTranslationEngine,
} from "../index";
import type { FixtureReplayTranslationScript } from "../index";

const REQUEST = {
  text: "the deployment failed on staging",
  sourceLanguageTag: "en",
  targetLanguageTag: "es",
} as const;

const CANNED_RESULT = {
  translatedText: "el despliegue falló en staging",
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

describe("fixture-replay translation engine (TEST DOUBLE)", () => {
  it("is clearly labelled a TEST DOUBLE in its runtime descriptor", () => {
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT });
    expect(engine.descriptor.id).toBe(FIXTURE_REPLAY_TRANSLATION_ENGINE_ID);
    expect(engine.descriptor.version).toBe(FIXTURE_REPLAY_TRANSLATION_ENGINE_VERSION);
    expect(engine.descriptor.label).toContain("TEST DOUBLE");
    expect(engine.descriptor.label).toContain("no real translation");
    // Honest absence: the double has no external engine to read facts from.
    expect(engine.descriptor.engineVersion).toBeUndefined();
    expect(engine.descriptor.modelLineage).toBeUndefined();
    expect(engine.descriptor).toEqual(FIXTURE_REPLAY_TRANSLATION_ENGINE_DESCRIPTOR);
  });

  it("replays the canned result byte-for-byte and records the request verbatim", async () => {
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT, units: 2 });
    const result = await engine.translate({ ...REQUEST });
    expect(result).toEqual(CANNED_RESULT);
    expect(engine.calls.length).toBe(1);
    expect(engine.calls[0]?.request).toEqual(REQUEST);
  });

  it("replays per-run lineage facts ONLY when the fixture volunteers them", async () => {
    const withLineage = new FixtureReplayTranslationEngine({
      translate: { ...CANNED_RESULT, engineVersion: "1.9.6", modelLineage: "en→es" },
      units: 1,
    });
    const result = await withLineage.translate({ ...REQUEST });
    expect(result.engineVersion).toBe("1.9.6");
    expect(result.modelLineage).toBe("en→es");
    const withoutLineage = new FixtureReplayTranslationEngine({
      translate: CANNED_RESULT,
      units: 1,
    });
    const bare = await withoutLineage.translate({ ...REQUEST });
    expect(bare.engineVersion).toBeUndefined();
    expect(bare.modelLineage).toBeUndefined();
  });

  it("ticks honest progress: one event per unit, totals known up front", async () => {
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT, units: 3 });
    const seen: TranslationEngineProgress[] = [];
    await engine.translate({ ...REQUEST }, { onProgress: (progress) => seen.push(progress) });
    expect(seen).toEqual([
      { completedUnits: 1, totalUnits: 3 },
      { completedUnits: 2, totalUnits: 3 },
      { completedUnits: 3, totalUnits: 3 },
    ]);
    expect(engine.calls[0]?.progress).toEqual(seen);
  });

  it("boundary cancellation: an already-aborted signal rejects typed Cancelled, no units ticked", async () => {
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT });
    const controller = new AbortController();
    controller.abort();
    const err = await expectTypedError(
      () => engine.translate({ ...REQUEST }, { signal: controller.signal }),
      ErrorCode.Cancelled,
    );
    expect(err.reason).toContain("boundary");
  });

  it("mid-run cancellation: the cooperative checkpoint rejects typed Cancelled between units", async () => {
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT, units: 4 });
    const controller = new AbortController();
    const seen: TranslationEngineProgress[] = [];
    const promise = engine.translate(
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
    const engine = new FixtureReplayTranslationEngine({ translate: CANNED_RESULT, units: 3 });
    const stop = new Error("caller-mandated stop");
    await expect(
      engine.translate(
        { ...REQUEST },
        {
          onProgress: () => {
            throw stop;
          },
        },
      ),
    ).rejects.toBe(stop);
  });

  it("failAfterUnits: the typed translation-engine-failed error AFTER N units (the engine-reported-failure path)", async () => {
    const engine = new FixtureReplayTranslationEngine({
      translate: CANNED_RESULT,
      units: 3,
      failAfterUnits: 2,
    });
    await expect(engine.translate({ ...REQUEST })).rejects.toSatisfy((err: unknown) => {
      expect(WebFlixError.is(err)).toBe(true);
      expect((err as WebFlixError).code).toBe(ErrorCode.IntelligenceTranslationEngineFailed);
      expect((err as WebFlixError).reason).toContain("after 2 of 3 units");
      return true;
    });
  });

  it("no canned result => typed not-implemented — a test double NEVER fabricates a result", async () => {
    const engine = new FixtureReplayTranslationEngine({});
    const err = await expectTypedError(
      () => engine.translate({ ...REQUEST }),
      ErrorCode.NotImplemented,
    );
    expect(err.reason).toContain("never fabricates results");
  });

  it("the descriptor comes from the fixture ONLY (lineage honesty fixtures)", () => {
    const script: FixtureReplayTranslationScript = {
      translate: CANNED_RESULT,
      descriptor: {
        id: "webflix.test-adapter-identity",
        label: "Test adapter",
        version: "9.9.9",
        engineVersion: "1.0.0",
        licenseNote: null,
      },
    };
    const engine = new FixtureReplayTranslationEngine(script);
    expect(engine.descriptor.id).toBe("webflix.test-adapter-identity");
    expect(engine.descriptor.version).toBe("9.9.9");
    expect(engine.descriptor.engineVersion).toBe("1.0.0");
  });
});
