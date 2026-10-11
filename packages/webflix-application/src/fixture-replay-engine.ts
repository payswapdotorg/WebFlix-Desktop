/**
 * FixtureReplayTranscriptionEngine — a DETERMINISTIC TEST DOUBLE implementing
 * TranscriptionEnginePort (P4-TRANSCRIBE scope row 3a).
 *
 * *** THIS IS A TEST DOUBLE — IT DOES NO REAL TRANSCRIPTION. ***
 *
 * It replays CANNED segments supplied by the test and surfaces them one at a
 * time, which is exactly what the pipeline needs to prove its honest-state
 * contract without bundling any engine:
 * - DETERMINISM: the same fixture => byte-for-byte the same segments, every
 *   run, forever (no randomness, no wall clock, no filesystem reads — the
 *   canonical deterministic-engine evidence);
 * - PROGRESS: onProgress fires after each segment with an honestly-known
 *   totalSegments (a replay engine knows its script up front);
 * - COOPERATIVE CANCELLATION: the signal is checked at entry AND between
 *   segments (the checkpoint the port's contract rules demand); a cancelled
 *   run rejects with the TYPED common/cancelled error and produces NO
 *   result. A THROWN onProgress callback is honoured as a stop request —
 *   the error propagates as-is so the caller (mi.transcribe) sees its own
 *   typed cancellation;
 * - FAILURE INJECTION: `failAfterSegments` makes the double reject with a
 *   typed engine-failed error AFTER N segments — the mid-run engine
 *   failure path;
 * - LINEAGE HONESTY: the descriptor and per-run result facts come from the
 *   fixture ONLY. A fixture that reports no engineVersion/modelLineage
 *   leaves them absent — the double never invents values.
 *
 * No network, no model weights, no media bytes: the request's mediaPath is
 * recorded verbatim for assertions and otherwise ignored.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TranscriptionEngineDescriptor,
  TranscriptionEnginePort,
  TranscriptionOptions,
  TranscriptionProgress,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptSegment,
} from "webflix-contracts";

/** The test double's adapter identity (OUR code's — always known). */
export const FIXTURE_REPLAY_ENGINE_ID = "webflix.fixture-replay-engine";
export const FIXTURE_REPLAY_ENGINE_VERSION = "0.1.0";

/** The descriptor every instance exposes unless the fixture overrides it. */
export const FIXTURE_REPLAY_ENGINE_DESCRIPTOR: TranscriptionEngineDescriptor = {
  id: FIXTURE_REPLAY_ENGINE_ID,
  label: "Fixture-replay transcription engine (TEST DOUBLE — no real ASR)",
  version: FIXTURE_REPLAY_ENGINE_VERSION,
  // engineVersion/modelLineage deliberately ABSENT: the double has no
  // external binary to read them from. Honest absence, never a guess.
  licenseNote: null,
};

/** What the double replays, supplied entirely by the test. */
export interface FixtureReplayScript {
  /** The canned segments, replayed in order. */
  readonly segments: readonly TranscriptSegment[];
  /** Per-run facts the "engine" reports; omit a field = it reported nothing. */
  readonly result?: {
    readonly language?: string;
    readonly engineVersion?: string;
    readonly modelLineage?: string;
  };
  /** Descriptor overrides (lineage honesty fixtures); defaults to the module descriptor. */
  readonly descriptor?: TranscriptionEngineDescriptor;
  /** Fail with the typed engine-failed error AFTER this many segments (undefined = never). */
  readonly failAfterSegments?: number;
}

/** Call facts recorded for assertions (deterministic — order of arrival). */
export interface FixtureReplayCall {
  readonly request: TranscriptionRequest;
  readonly signalAbortedAtEntry: boolean;
  readonly progress: readonly TranscriptionProgress[];
}

export class FixtureReplayTranscriptionEngine implements TranscriptionEnginePort {
  readonly descriptor: TranscriptionEngineDescriptor;
  /** Read-only snapshot of every recorded call (assertion evidence). */
  get calls(): readonly FixtureReplayCall[] {
    return this.recording.map((call) => ({
      request: call.request,
      signalAbortedAtEntry: call.signalAbortedAtEntry,
      progress: [...call.progress],
    }));
  }

  constructor(private readonly script: FixtureReplayScript) {
    this.descriptor = script.descriptor ?? FIXTURE_REPLAY_ENGINE_DESCRIPTOR;
  }

  async transcribe(
    request: TranscriptionRequest,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult> {
    const call: {
      request: TranscriptionRequest;
      signalAbortedAtEntry: boolean;
      progress: TranscriptionProgress[];
    } = {
      request: { ...request },
      signalAbortedAtEntry: options?.signal?.aborted === true,
      progress: [],
    };
    this.recording.push(call);

    // 1. Boundary cancellation: an already-aborted signal never starts work.
    if (options?.signal?.aborted === true) {
      throw cancellationError("fixture-replay engine cancelled at the boundary");
    }

    const total = this.script.segments.length;
    const completed: TranscriptSegment[] = [];
    for (const segment of this.script.segments) {
      // A yield point: a real engine takes wall time between segments; the
      // double takes one microtask so a caller that aborts DURING the run is
      // observable at the next checkpoint below (deterministic — the
      // microtask queue is drained in a fixed order, and no timer/wall
      // clock is involved).
      await Promise.resolve();
      // 2. Cooperative cancellation BETWEEN segments (the checkpoint). The
      //    re-read through signalAborted() defeats control-flow narrowing —
      //    the AbortSignal's flag is external mutable state.
      if (signalAborted(options)) {
        throw cancellationError(
          `fixture-replay engine cancelled cooperatively after ${completed.length} of ${total} segments`,
        );
      }
      completed.push({ ...segment });
      const progress: TranscriptionProgress = {
        completedSegments: completed.length,
        totalSegments: total,
        lastEndMs: segment.endMs,
      };
      call.progress.push(progress);
      // 3. A thrown onProgress callback is a stop request: honour it exactly
      //    like a signal abort (the caller's error propagates as-is).
      options?.onProgress?.(progress);
      // 4. Injected engine failure AFTER the completed segment (the "engine
      //    ran and itself reported failure" path — typed engine-failed).
      if (
        this.script.failAfterSegments !== undefined &&
        completed.length >= this.script.failAfterSegments
      ) {
        throw new WebFlixError({
          code: ErrorCode.IntelligenceEngineFailed,
          reason: `fixture-replay engine reported its own failure after ${completed.length} segments (injected)`,
          retryable: false,
          context: { engineId: this.descriptor.id, completedSegments: completed.length },
        });
      }
    }

    const reported = this.script.result ?? {};
    return {
      segments: completed,
      // Honest per-run facts: present only when the fixture reported them.
      ...(reported.language !== undefined ? { language: reported.language } : {}),
      ...(reported.engineVersion !== undefined ? { engineVersion: reported.engineVersion } : {}),
      ...(reported.modelLineage !== undefined ? { modelLineage: reported.modelLineage } : {}),
    };
  }

  /** Internal mutable recording list backing the public `calls` getter. */
  private readonly recording: {
    request: TranscriptionRequest;
    signalAbortedAtEntry: boolean;
    progress: TranscriptionProgress[];
  }[] = [];
}

/** True when the run's signal is (now) aborted — re-read at every checkpoint. */
function signalAborted(options: TranscriptionOptions | undefined): boolean {
  return options?.signal?.aborted === true;
}

/** The typed cancellation error both engine adapters reject with. */
function cancellationError(reason: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.Cancelled,
    reason,
    retryable: false,
    context: { phase: "engine-run" },
  });
}
