/**
 * FixtureReplayTtsEngine — a DETERMINISTIC TEST DOUBLE implementing
 * TtsEnginePort (P4-TRANSLATE scope row 4).
 *
 * *** THIS IS A TEST DOUBLE — IT DOES NO REAL SPEECH SYNTHESIS. ***
 *
 * It replays CANNED results supplied by the test and ticks a canned number
 * of work units, which is exactly what the pipeline needs to prove its
 * honest-state contract without any engine:
 * - DETERMINISM: the same fixture => byte-for-byte the same results, every
 *   run, forever (no randomness, no wall clock, no filesystem reads);
 * - PROGRESS: onProgress fires after each unit with an honestly-known
 *   totalUnits (a replay engine knows its script up front);
 * - COOPERATIVE CANCELLATION: the signal is checked at entry AND between
 *   units; a cancelled run rejects with the TYPED common/cancelled error
 *   and produces NO result. A THROWN onProgress callback is a stop
 *   request — the error propagates as-is so the caller sees its own typed
 *   cancellation;
 * - FAILURE INJECTION: `failAfterUnits` makes the double reject with a
 *   typed tts-engine-failed error AFTER N units — the mid-run engine
 *   failure path;
 * - HONEST CONFIGURATION: a script with no canned result makes
 *   synthesize() reject with the typed common/not-implemented error (a
 *   test bug, surfaced — never a fabricated TtsResult);
 * - LINEAGE HONESTY: the descriptor comes from the fixture ONLY. A fixture
 *   that reports no engineVersion/modelLineage leaves them absent — the
 *   double never invents values.
 *
 * No network, no engine, no storage: the request's text and voice id are
 * recorded verbatim for assertions and otherwise ignored. The canned audio
 * bytes are returned as a FRESH copy per call (callers may mutate their
 * copy without corrupting the script).
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TtsEngineDescriptor,
  TtsEngineOptions,
  TtsEnginePort,
  TtsEngineProgress,
  TtsRequest,
  TtsResult,
} from "webflix-contracts";

/** The test double's adapter identity (OUR code's — always known). */
export const FIXTURE_REPLAY_TTS_ENGINE_ID = "webflix.fixture-replay-tts-engine";
export const FIXTURE_REPLAY_TTS_ENGINE_VERSION = "0.1.0";

/** The descriptor every instance exposes unless the fixture overrides it. */
export const FIXTURE_REPLAY_TTS_ENGINE_DESCRIPTOR: TtsEngineDescriptor = {
  id: FIXTURE_REPLAY_TTS_ENGINE_ID,
  label: "Fixture-replay TTS engine (TEST DOUBLE — no real speech synthesis)",
  version: FIXTURE_REPLAY_TTS_ENGINE_VERSION,
  // engineVersion/modelLineage deliberately ABSENT: the double has no
  // external engine to read them from. Honest absence, never a guess.
  licenseNote: null,
};

/** What the double replays, supplied entirely by the test. */
export interface FixtureReplayTtsScript {
  /** The canned synthesize result (absent => synthesize() rejects typed not-implemented). */
  readonly synthesize?: TtsResult;
  /** Work units replayed per operation (progress ticks); default 3. */
  readonly units?: number;
  /** Fail with the typed tts-engine-failed error AFTER this many units (undefined = never). */
  readonly failAfterUnits?: number;
  /** Descriptor overrides (lineage honesty fixtures); defaults to the module descriptor. */
  readonly descriptor?: TtsEngineDescriptor;
}

/** Call facts recorded for assertions (deterministic — order of arrival). */
export interface FixtureReplayTtsCall {
  /** The request verbatim (text + the requested voice id). */
  readonly request: TtsRequest;
  readonly signalAbortedAtEntry: boolean;
  readonly progress: readonly TtsEngineProgress[];
}

export class FixtureReplayTtsEngine implements TtsEnginePort {
  readonly descriptor: TtsEngineDescriptor;
  /** Read-only snapshot of every recorded call (assertion evidence). */
  get calls(): readonly FixtureReplayTtsCall[] {
    return this.recording.map((call) => ({
      request: call.request,
      signalAbortedAtEntry: call.signalAbortedAtEntry,
      progress: [...call.progress],
    }));
  }

  constructor(private readonly script: FixtureReplayTtsScript) {
    this.descriptor = script.descriptor ?? FIXTURE_REPLAY_TTS_ENGINE_DESCRIPTOR;
  }

  async synthesize(request: TtsRequest, options?: TtsEngineOptions): Promise<TtsResult> {
    const canned = this.script.synthesize;
    if (canned === undefined) {
      throw notImplemented("synthesize");
    }
    const call: {
      request: TtsRequest;
      signalAbortedAtEntry: boolean;
      progress: TtsEngineProgress[];
    } = {
      request: { text: request.text, voice: { id: request.voice.id } },
      signalAbortedAtEntry: options?.signal?.aborted === true,
      progress: [],
    };
    this.recording.push(call);

    // 1. Boundary cancellation: an already-aborted signal never starts work.
    if (options?.signal?.aborted === true) {
      throw cancellationError("fixture-replay TTS engine cancelled at the boundary");
    }

    const total = this.script.units ?? 3;
    for (let unit = 1; unit <= total; unit += 1) {
      // A yield point: one deterministic microtask per unit so a caller
      // that aborts DURING the run is observable at the next checkpoint
      // (the summary-double precedent, proven deterministic).
      await Promise.resolve();
      // 2. Cooperative cancellation BETWEEN units (the checkpoint). The
      //    re-read through signalAborted() defeats control-flow narrowing —
      //    the AbortSignal's flag is external mutable state.
      if (signalAborted(options)) {
        throw cancellationError(
          `fixture-replay TTS engine cancelled cooperatively after ${unit - 1} of ${total} units`,
        );
      }
      const progress: TtsEngineProgress = { completedUnits: unit, totalUnits: total };
      call.progress.push(progress);
      // 3. A thrown onProgress callback is a stop request: honour it exactly
      //    like a signal abort (the caller's error propagates as-is).
      options?.onProgress?.(progress);
      // 4. Injected engine failure AFTER the completed unit (the "engine
      //    ran and itself reported failure" path — typed tts-engine-failed).
      if (this.script.failAfterUnits !== undefined && unit >= this.script.failAfterUnits) {
        throw new WebFlixError({
          code: ErrorCode.IntelligenceTtsEngineFailed,
          reason: `fixture-replay TTS engine reported its own failure after ${unit} of ${total} units (injected)`,
          retryable: false,
          context: { engineId: this.descriptor.id, completedUnits: unit },
        });
      }
    }

    // The canned result, replayed with a FRESH audio copy per call —
    // byte-stable for the caller, mutation-safe for the script.
    return {
      audio: new Uint8Array(canned.audio),
      contentType: canned.contentType,
      ...(canned.engineVersion !== undefined ? { engineVersion: canned.engineVersion } : {}),
      ...(canned.modelLineage !== undefined ? { modelLineage: canned.modelLineage } : {}),
    };
  }

  /** Internal mutable recording list backing the public `calls` getter. */
  private readonly recording: {
    request: TtsRequest;
    signalAbortedAtEntry: boolean;
    progress: TtsEngineProgress[];
  }[] = [];
}

/** True when the run's signal is (now) aborted — re-read at every checkpoint. */
function signalAborted(options: TtsEngineOptions | undefined): boolean {
  return options?.signal?.aborted === true;
}

/** The typed cancellation error the double rejects with. */
function cancellationError(reason: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.Cancelled,
    reason,
    retryable: false,
    context: { phase: "engine-run" },
  });
}

/** The honest rejection for an unconfigured operation — a test bug, never a fabricated result. */
function notImplemented(operation: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.NotImplemented,
    reason: `fixture-replay TTS engine has no canned ${operation} result — supply one in the script (a test double never fabricates results)`,
    retryable: false,
    context: { engineId: FIXTURE_REPLAY_TTS_ENGINE_ID, operation },
  });
}
