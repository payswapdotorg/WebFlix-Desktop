/**
 * mi.tts — the audio RENDITION use case (P4-TRANSLATE scope row 2, the
 * TTS side), riding the frozen §2.6 JobDescriptor/JobState wrapper (the
 * transcribe-media-file / mi-text-intelligence precedents). The shared
 * machinery (the stored-text reading seam, the typed job error, the
 * failure-stamping helpers) lives in ./mi-translate.ts — the two files
 * were one module until the repo's 400-effective-line max-lines limit;
 * the split is structural only.
 *
 * AUDIO-AS-RENDITION, binding: synthesized audio is NOT a derived
 * artifact — the DerivedArtifact kind enum is CLOSED at six kinds and this
 * order adds none. A rendition is a SIDE record keyed BY the source
 * artifact id, carrying its OWN lineage (the engine adapter's identity,
 * the run-reported engine facts, the voice, the deterministic inputsHash)
 * plus the engine-produced bytes and content type. The SOURCE artifact's
 * descriptor is never read-mutated-written by this path (the source is
 * fetched for validation only) — pinned by deep-equal tests.
 *
 * Semantics, stated honestly (the load-bearing half; the full statement
 * lives in the P4-TRANSLATE charter):
 *
 * - INPUT: a SOURCE derived-artifact id whose stored TEXT payload is the
 *   input — the order's clause is the unqualified "a stored text payload
 *   by artifact id": the four translate kinds PLUS translation, because
 *   speaking a translation is the honest dubbing precursor and a
 *   translation IS this order's own persisted text payload (the reading
 *   is recorded here and in TTS_SOURCE_KINDS).
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   intelligence/tts-invalid, never job failures): blank artifact ids,
 *   blank voice ids. Read-time state (unknown artifact, a non-text-source
 *   kind, a missing payload, an EMPTY projection) stamps the job FAILED
 *   and rethrows through TranslateTtsJobError (cause's code intact).
 * - CANCELLATION, BOTH PHASES: boundary (queued -> cancelled before
 *   anything is read or run) and mid-run (the engine cooperates between
 *   units; a spawn-based engine kills its child) — a cancelled run
 *   leaves NO rendition.
 * - RENDITION ONLY ON SUCCESS: persisted keyed by an upfront-generated
 *   rendition id, attached to the SOURCE artifact id (listable by
 *   source); a put failure leaves NO rendition.
 */
import { ErrorCode, JobDescriptorSchema } from "webflix-contracts";
import type { JobDescriptor, TtsEnginePort, TtsRequest, TtsResult } from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type {
  ArtifactRegistry,
  AudioRenditionStore,
  ClockPort,
  IdGenerator,
  TextPayloadStore,
  TranscriptPayloadStore,
} from "./ports";
import type { AudioRendition } from "./audio-rendition";
import { ttsRenditionInputsHash } from "./audio-rendition";
import {
  callerDefect,
  describeEngineError,
  expectTransitioned,
  jobFailure,
  readSourceText,
  TTS_JOB_KIND,
  TTS_SOURCE_KINDS,
} from "./mi-translate";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

export interface SynthesizeSpeechInput {
  /** The SOURCE artifact id (any text-bearing kind — see TTS_SOURCE_KINDS). */
  readonly sourceArtifactId: string;
  /** The voice identity the engine resolves against its discovered voices. */
  readonly voiceId: string;
  /** Honoured at the job boundary AND forwarded to the engine mid-run. */
  readonly signal?: AbortSignal;
}

/** mi.translate's output (the shared output precedent). */

export interface SynthesizeSpeechOutput {
  /** Terminal descriptor: succeeded (with rendition) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The persisted rendition on success; null on cancellation AND failure. */
  readonly rendition: AudioRendition | null;
}

export interface SynthesizeSpeechDeps {
  /** The TTS engine adapter (a test double in tests; a local engine in production wiring). */
  readonly engine: TtsEnginePort;
  readonly registry: ArtifactRegistry;
  readonly transcriptPayloads: TranscriptPayloadStore;
  readonly textPayloads: TextPayloadStore;
  /** The audio rendition store (mi.tts's ONLY write surface — no artifact is created). */
  readonly audioRenditions: AudioRenditionStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** mi.tts — the audio RENDITION over a stored text payload (NO artifact). */
export class SynthesizeSpeech {
  constructor(private readonly deps: SynthesizeSpeechDeps) {}

  async execute(input: SynthesizeSpeechInput): Promise<SynthesizeSpeechOutput> {
    // 1. Caller defects validated BEFORE the job exists.
    if (typeof input.sourceArtifactId !== "string" || input.sourceArtifactId.trim().length === 0) {
      throw callerDefect(
        ErrorCode.IntelligenceTtsInvalid,
        "sourceArtifactId must be a non-empty artifact id",
        "SynthesizeSpeechInput",
      );
    }
    if (typeof input.voiceId !== "string" || input.voiceId.trim().length === 0) {
      throw callerDefect(
        ErrorCode.IntelligenceTtsInvalid,
        "voiceId must be a non-blank voice id",
        "SynthesizeSpeechInput",
      );
    }

    const createdAt = this.deps.clock.now().toISOString();
    const engineDescriptor = this.deps.engine.descriptor;
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: TTS_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: engineDescriptor.id,
          connectorVersion: engineDescriptor.version,
          generatedAt: createdAt,
        },
        payload: {
          sourceArtifactId: input.sourceArtifactId,
          engineId: engineDescriptor.id,
          engineLabel: engineDescriptor.label,
          voiceId: input.voiceId,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.IntelligenceTtsInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, nothing read, nothing run.
    if (input.signal?.aborted === true) {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", this.deps.clock.now().toISOString()),
        "queued -> cancelled",
      );
      return { job: cancelled, rendition: null };
    }

    // 3. Run: queued -> running; resolve the source text, run the engine.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );

    let sourceText: string;
    let textChecksum: string;
    try {
      const resolved = await readSourceText(this.deps, {
        sourceArtifactId: input.sourceArtifactId,
        allowedKinds: TTS_SOURCE_KINDS,
        jobKind: TTS_JOB_KIND,
        invalidCode: ErrorCode.IntelligenceTtsInvalid,
        emptyReason:
          "the source artifact's text projection is empty — there is nothing to synthesize (an empty summary/overview/answer is honest, but it cannot be spoken)",
      });
      sourceText = resolved.text;
      textChecksum = resolved.textChecksum;
    } catch (err) {
      throw jobFailure(this.deps, running, err);
    }

    let result: TtsResult;
    try {
      const request: TtsRequest = { text: sourceText, voice: { id: input.voiceId } };
      result = await this.deps.engine.synthesize(request, {
        signal: input.signal,
        onProgress: (progress) => {
          void progress;
        },
      });
    } catch (err) {
      const described = describeEngineError(err);
      if (described.cancelled) {
        const cancelled = expectTransitioned(
          transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
          "running -> cancelled",
        );
        return { job: { ...cancelled, lastError: described.text }, rendition: null };
      }
      throw jobFailure(this.deps, running, err);
    }

    // 4. Success: persist the audio RENDITION attached to the SOURCE
    //    artifact id — the rendition's OWN lineage (engine, voice,
    //    inputsHash), the engine-produced content type + bytes. NO
    //    descriptor is created or written: audio is a payload rendition,
    //    not a derived-artifact kind (the enum stays closed); the source
    //    artifact was READ only — never mutated.
    const renditionId = this.deps.generateId();
    const rendition: AudioRendition = {
      renditionId,
      sourceArtifactId: input.sourceArtifactId,
      engine: {
        id: engineDescriptor.id,
        label: engineDescriptor.label,
        version: engineDescriptor.version,
      },
      ...(result.engineVersion !== undefined ? { engineVersion: result.engineVersion } : {}),
      ...(result.modelLineage !== undefined ? { modelLineage: result.modelLineage } : {}),
      voiceId: input.voiceId,
      inputsHash: ttsRenditionInputsHash({
        sourceArtifactId: input.sourceArtifactId,
        textChecksum,
        engineId: engineDescriptor.id,
        engineVersion: engineDescriptor.version,
        voiceId: input.voiceId,
      }),
      contentType: result.contentType,
      audio: result.audio,
      createdAt: this.deps.clock.now().toISOString(),
    };
    try {
      await this.deps.audioRenditions.put(rendition);
    } catch (err) {
      // A put failure (e.g. a store rejecting empty audio) leaves NO
      // rendition — the no-rendition-on-failure contract.
      throw jobFailure(this.deps, running, err);
    }
    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, rendition };
  }
}
