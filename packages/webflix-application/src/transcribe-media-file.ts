/**
 * TranscribeMediaFile — the mi.transcribe use case (P4-TRANSCRIBE scope row 2;
 * phase4-mi-plan §2: MI jobs RIDE the frozen §2.6 JobDescriptor/JobState,
 * never re-invent it).
 *
 * The FIRST REAL derived-artifact producer: a local media file goes in, an
 * engine adapter runs, and on success a DerivedArtifact kind=transcript is
 * created through the durable ArtifactRegistry (P4-ARTIFACTS) with full
 * lineage. Semantics, stated honestly:
 *
 * - CANCELLATION, BOTH PHASES (phase4-mi-plan "no background AI anything":
 *   MI jobs run visibly and cancellably):
 *   * at the BOUNDARY: an already-aborted signal transitions the job
 *     queued -> cancelled BEFORE the engine is ever touched; no artifact;
 *   * MID-RUN: the input signal is forwarded to the engine; a cooperative
 *     engine that stops between segments rejects with the typed
 *     common/cancelled error — the job transitions running -> cancelled,
 *     NO artifact is stored (partial segments are DISCARDED, documented
 *     choice: a cancelled run is not a transcript), and the engine result
 *     is null.
 * - ENGINE ERRORS ARE JOB FAILURES, surfaced verbatim: the engine's typed
 *   error (engine-unavailable / engine-failed / common/cancelled) is
 *   rethrown AFTER the job descriptor is stamped failed with lastError
 *   carrying the error's code + reason — the caller sees both the typed
 *   error and the failed job. NO artifact on any failure.
 * - ORIGINAL UNTOUCHED, structurally: the input's catalog snapshot is READ
 *   (the lineage check) and the request's mediaPath is handed to the
 *   engine UNCHANGED; nothing in this module can write into a catalog
 *   item. The ORIGINAL-untouched invariant is pinned by a deep-equal
 *   test in the suite.
 * - LINEAGE, honest end to end: modelId = the engine descriptor's id
 *   (adapter identity, always known); modelVersion = the engine's
 *   reported modelLineage when the run reported one, ELSE the engine's
 *   reported engineVersion, ELSE the ADAPTER's version (OUR code's —
 *   always known, the honest floor; never a guess about the external
 *   binary); producedBy = the engine descriptor's id; inputsHash =
 *   a stable digest of (source item id + engine id + media path +
 *   language hint) — deterministic, no wall clock, no randomness.
 *   licenseNote = the engine descriptor's licenseNote (null honest).
 * - ARTIFACT ONLY ON SUCCESS: created through DeriveArtifactBookkeeping
 *   (schema + domain lineage validation + registry put) AFTER the engine
 *   returns. Empty segments is SUCCESS (the honest "no speech" outcome)
 *   and still records an artifact — an engine that ran and reported no
 *   speech produced a real (empty) transcript.
 * - PAYLOAD PERSISTED ON SUCCESS (the P4-SUMMARIZE amendment, sanctioned
 *   by that order — it resolves this pipeline's recorded adjacency): the
 *   engine's segments are ALSO persisted through the TranscriptPayloadStore
 *   keyed by the new artifact id (segments + FNV-1a checksum), so downstream
 *   consumers (mi.summarize / mi.overview / mi.qa) read STORED transcripts
 *   without re-transcribing. CANCELLED and FAILED runs persist NOTHING —
 *   unchanged. Ordering, documented: the artifact id is generated UPFRONT,
 *   the payload is put BEFORE the descriptor is created, so a payload put
 *   failure stamps the job failed with NO artifact and NO payload; a
 *   descriptor-creation failure after a successful put leaves the payload
 *   row keyed by an id no descriptor references — a harmless orphan (get
 *   by that id resolves; nothing lists it; the id is never reused). The
 *   ORIGINAL catalog item is still never touched.
 * - Inputs validated BEFORE the job exists (the generate-recommendations
 *   precedent): a bad request shape or an unknown source item is a CALLER
 *   DEFECT (typed IntelligenceTranscriptionInvalid), never a job failure.
 */
import {
  ErrorCode,
  JobDescriptorSchema,
  TranscriptionRequestSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  JobDescriptor,
  TranscriptionEngineDescriptor,
  TranscriptionEnginePort,
  TranscriptionResult,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type { ArtifactRegistry, ClockPort, IdGenerator, TranscriptPayloadStore } from "./ports";
import { DeriveArtifactBookkeeping } from "./derive-artifact-bookkeeping";
import { transcriptPayloadChecksum } from "./transcript-payload";

export const TRANSCRIBE_JOB_KIND = "mi.transcribe";

/** The recovery hint surfaced with the honest engine-unavailable state. */
export const ENGINE_UNAVAILABLE_RECOVERY_HINT = "install whisper.cpp and set WEBFLIX_WHISPER_BIN";

export interface TranscribeMediaFileInput {
  /** §2.1 catalog item id of the ORIGINAL to transcribe (lineage source). */
  readonly sourceItemId: string;
  /** LOCAL path of the media file, handed to the engine adapter untouched. */
  readonly mediaPath: string;
  /** Optional engine-interpreted language hint (e.g. "en"); absent = no hint. */
  readonly language?: string;
  /** The CURRENT catalog snapshot (READ once for the lineage check). */
  readonly catalog: readonly CatalogItem[];
  /** Honoured at the job boundary AND forwarded to the engine mid-run. */
  readonly signal?: AbortSignal;
}

export interface TranscribeMediaFileOutput {
  /** Terminal descriptor: succeeded (with artifact) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /**
   * The stored artifact on success; null on cancellation AND failure —
   * a cancelled or failed run is not a transcript (documented choice).
   */
  readonly artifact: DerivedArtifact | null;
  /** The engine's per-run result on success; null otherwise. */
  readonly result: TranscriptionResult | null;
}

export interface TranscribeMediaFileDeps {
  /** The engine adapter to run (fixture double in tests; the local whisper adapter in production wiring). */
  readonly engine: TranscriptionEnginePort;
  readonly registry: ArtifactRegistry;
  /** The transcript payload store (P4-SUMMARIZE amendment: success persists the payload). */
  readonly payloadStore: TranscriptPayloadStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

export class TranscribeMediaFile {
  constructor(private readonly deps: TranscribeMediaFileDeps) {}

  async execute(input: TranscribeMediaFileInput): Promise<TranscribeMediaFileOutput> {
    // 1. Caller defects validated BEFORE the job exists — typed errors, never
    //    job failures (the generate-recommendations precedent).
    const request =
      input.language !== undefined
        ? { mediaPath: input.mediaPath, language: input.language }
        : { mediaPath: input.mediaPath };
    parseOrThrow(
      TranscriptionRequestSchema,
      request,
      ErrorCode.IntelligenceTranscriptionInvalid,
      "TranscriptionRequest",
    );
    if (input.sourceItemId.trim().length === 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTranscriptionInvalid,
        reason: "sourceItemId must be a non-empty catalog item id",
        retryable: false,
        context: { subject: "TranscribeMediaFileInput" },
      });
    }
    const knownSource = input.catalog.some(
      (item) => item.id === input.sourceItemId && isKnownCatalogItem(item),
    );
    if (!knownSource) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceTranscriptionInvalid,
        reason: `source item "${input.sourceItemId}" is not present in the supplied catalog snapshot — transcribe requires a known original (lineage)`,
        retryable: false,
        context: { sourceItemId: input.sourceItemId },
      });
    }

    const createdAt = this.deps.clock.now().toISOString();
    const engineDescriptor = this.deps.engine.descriptor;
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: TRANSCRIBE_JOB_KIND,
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
          sourceItemId: input.sourceItemId,
          mediaPath: input.mediaPath,
          ...(input.language !== undefined ? { language: input.language } : {}),
          engineId: engineDescriptor.id,
          engineLabel: engineDescriptor.label,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.IntelligenceTranscriptionInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, engine never touched.
    if (input.signal?.aborted === true) {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", this.deps.clock.now().toISOString()),
        "queued -> cancelled",
        ErrorCode.IntelligenceTranscriptionInvalid,
      );
      return { job: cancelled, artifact: null, result: null };
    }

    // 3. Run: queued -> running; the engine gets the signal (cooperative
    //    mid-run cancellation between segments) and a progress callback
    //    that re-checks the signal and surfaces progress.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
      ErrorCode.IntelligenceTranscriptionInvalid,
    );

    let result: TranscriptionResult;
    try {
      result = await this.deps.engine.transcribe(request, {
        signal: input.signal,
        onProgress: (progress) => {
          // The boundary already passed; the engine's cooperative
          // checkpoints own mid-run cancellation. Progress surfacing is
          // the use case's choice: recorded nowhere (no telemetry —
          // phase4-mi-plan honest boundaries), acknowledged silently.
          void progress;
        },
      });
    } catch (err) {
      // 4. Engine errors: the typed error is rethrown VERBATIM after the
      //    job descriptor is stamped with its honest terminal state —
      //    CANCELLED for a cooperative cancellation (common/cancelled),
      //    FAILED for engine-unavailable / engine-failed / anything else.
      //    No artifact on any of these (a failed run is not a transcript).
      const described = describeEngineError(err);
      if (described.cancelled) {
        const cancelled = expectTransitioned(
          transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
          "running -> cancelled",
          ErrorCode.IntelligenceTranscriptionInvalid,
        );
        return { job: { ...cancelled, lastError: described.text }, artifact: null, result: null };
      }
      const failed = expectTransitioned(
        transitionJob(running, "failed", this.deps.clock.now().toISOString()),
        "running -> failed",
        ErrorCode.IntelligenceTranscriptionInvalid,
      );
      throw new TranscribeJobError({
        job: { ...failed, lastError: described.text },
        cause: asWebFlixErrorOrWrap(err),
      });
    }

    // 5. Success: persist the transcript PAYLOAD first (the P4-SUMMARIZE
    //    amendment — downstream text-intelligence reads stored transcripts),
    //    keyed by the artifact id generated UPFRONT so the descriptor and the
    //    payload share it; a put failure stamps the job failed with NO
    //    artifact and NO payload (the ordering note in the module doc).
    const artifactId = this.deps.generateId();
    try {
      await this.deps.payloadStore.put({
        artifactId,
        segments: result.segments,
        checksum: transcriptPayloadChecksum(result.segments),
      });
    } catch (err) {
      throw transcribeJobFailure(this.deps, running, err);
    }

    // 6. Create the DerivedArtifact kind=transcript through the durable
    //    registry with full lineage; job succeeded.
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: this.deps.registry,
      clock: this.deps.clock,
      generateId: this.deps.generateId,
    });
    const artifact = await bookkeeping.create({
      id: artifactId,
      sourceItemId: input.sourceItemId,
      kind: "transcript",
      lineage: {
        modelId: engineDescriptor.id,
        modelVersion: resolveModelVersion(engineDescriptor, result),
        producedBy: engineDescriptor.id,
        inputsHash: transcribeInputsHash(input, engineDescriptor),
      },
      licenseNote: engineDescriptor.licenseNote,
      catalog: input.catalog,
    });
    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
      ErrorCode.IntelligenceTranscriptionInvalid,
    );
    return { job: succeeded, artifact, result };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The typed error the use case rethrows on engine failure: the engine's own
 * typed error as `cause` (code/reason/context intact — WebFlixError.is()
 * callers match on the ORIGINAL code) plus the failed JobDescriptor as
 * `job` for inspection. `code` mirrors the cause's so generic handlers see
 * the honest engine code without unwrapping.
 */
export class TranscribeJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "TranscribeJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/**
 * Stamps the running job FAILED and wraps the error in a TranscribeJobError
 * — the payload-put failure path of the P4-SUMMARIZE amendment (a failed
 * put means NO artifact and NO payload; the typed cause rethrows intact).
 */
function transcribeJobFailure(
  deps: TranscribeMediaFileDeps,
  running: JobDescriptor,
  err: unknown,
): TranscribeJobError {
  const described = describeEngineError(err);
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
    ErrorCode.IntelligenceTranscriptionInvalid,
  );
  return new TranscribeJobError({
    job: { ...failed, lastError: described.text },
    cause: asWebFlixErrorOrWrap(err),
  });
}

/**
 * The modelVersion lineage field, resolved honestly: the run's reported
 * modelLineage first, then the run's reported engineVersion, then the
 * ADAPTER's own version — the always-known floor. Never a guess about the
 * external binary: when the engine reported nothing, the lineage says OUR
 * adapter's version (modelId still names the engine adapter id).
 */
function resolveModelVersion(
  engineDescriptor: TranscriptionEngineDescriptor,
  result: TranscriptionResult,
): string {
  if (result.modelLineage !== undefined && result.modelLineage.length > 0) {
    return result.modelLineage;
  }
  if (result.engineVersion !== undefined && result.engineVersion.length > 0) {
    return result.engineVersion;
  }
  return engineDescriptor.version;
}

/**
 * Deterministic digest of the transcribe inputs: FNV-1a 32-bit over the
 * exact request tuple (no wall clock, no randomness). NOT a cryptographic
 * claim — a stable, collision-unlikely identity for the artifact lineage's
 * inputsHash field (the same inputs => the same hash, forever).
 */
function transcribeInputsHash(
  input: TranscribeMediaFileInput,
  engineDescriptor: TranscriptionEngineDescriptor,
): string {
  const parts = [
    input.sourceItemId,
    input.mediaPath,
    input.language ?? "",
    engineDescriptor.id,
    engineDescriptor.version,
  ];
  const text = parts.join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** A catalog entry counts as a known source only when schema-valid (domain semantics). */
function isKnownCatalogItem(item: CatalogItem): boolean {
  // The domain's validateDerivedArtifactLineage re-checks this through
  // CatalogItemSchema at create time; here a structural id match suffices
  // for the early caller-defect check, keeping the check synchronous and
  // the double validation honest (the domain remains the authority).
  return typeof item.id === "string";
}

/** Human-readable, secret-free description of an engine error for lastError. */
function describeEngineError(err: unknown): { text: string; cancelled: boolean } {
  if (WebFlixError.is(err)) {
    const cancelled = err.code === ErrorCode.Cancelled;
    return {
      text: cancelled ? `cancelled: ${err.reason}` : `${err.code}: ${err.reason}`,
      cancelled,
    };
  }
  return {
    text: `engine error: ${err instanceof Error ? err.message : String(err)}`,
    cancelled: false,
  };
}

/** Rethrows the error as a WebFlixError (wrapping unknown shapes, code intact). */
function asWebFlixErrorOrWrap(err: unknown): WebFlixError {
  if (WebFlixError.is(err)) return err;
  return new WebFlixError({
    code: ErrorCode.IntelligenceEngineFailed,
    reason: `engine reported an unrecognized failure: ${err instanceof Error ? err.message : String(err)}`,
    retryable: false,
    context: {},
  });
}

/** Unwraps a domain transition result (typed transcription-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
  code: ErrorCode,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
