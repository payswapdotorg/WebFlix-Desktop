/**
 * mi.translate — the translation derived artifact (P4-TRANSLATE scope row
 * 2), riding the frozen §2.6 JobDescriptor/JobState wrapper (the
 * transcribe-media-file / mi-text-intelligence precedents, phase4-mi-plan
 * §2: MI jobs RIDE §2.6, never re-invent it).
 *
 * This module also owns the SHARED machinery of this order's two use
 * cases — the stored-text reading seam (readSourceText), the typed job
 * error (TranslateTtsJobError) and the failure-stamping helpers — which
 * mi.tts (./mi-tts.ts) imports. The two files were one module until it
 * reached the repo's 400-effective-line max-lines limit; the split is
 * structural only — the public surface is byte-identical.
 *
 * Semantics, stated honestly (the full order-level statement lives in the
 * P4-TRANSLATE charter; the load-bearing half):
 *
 * - INPUT: a SOURCE derived-artifact id whose stored TEXT payload is the
 *   input — exactly the order's four kinds (transcript / summary /
 *   overview / qa): a transcript's text is its 0004 segment payload
 *   joined; the other three are 0005 text projections.
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   intelligence/translation-invalid, never job failures): blank artifact
 *   ids, blank language tags. Everything discovered later (unknown
 *   artifact, a non-text-source kind, a missing payload, an EMPTY text
 *   projection) is read-time state: the job is stamped FAILED and the
 *   typed error rethrown through TranslateTtsJobError (cause's code
 *   intact — the TranscribeJobError pattern).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is read or run; MID-RUN
 *   the signal is forwarded to the engine, which cooperates between units
 *   (a spawn-based engine kills its child) — a cancelled engine rejects
 *   with typed common/cancelled, the job transitions running -> cancelled,
 *   NO artifact and NO payload are stored and the result is null.
 * - SOURCE UNTOUCHED, structurally: the SOURCE artifact is READ (registry
 *   get) and its payload READ (payload store get); nothing in this module
 *   can write either back.
 * - PAYLOAD-BACKED INPUTS: the text the engine sees comes from the DURABLE
 *   stores keyed by the source artifact id — a source without a stored
 *   payload is the TYPED absent error (intelligence/transcript-payload-
 *   absent / intelligence/text-payload-absent), surfaced with re-running
 *   the producing use case as the recovery (never an empty substitute).
 * - LINEAGE, honest end to end: the artifact lineage resolves from the
 *   ENGINE-REPORTED facts when volunteered (the result's own
 *   engineVersion / modelLineage, read from the engine's own output),
 *   falling back to the adapter descriptor's, with the adapter's
 *   id/version as the always-known floor — never a guess. producedBy =
 *   the engine descriptor's id. inputsHash = FNV-1a 32-bit over
 *   (source artifact id + the source text's checksum + engine id + engine
 *   version + source/target language tags) — deterministic, no wall
 *   clock, no randomness.
 * - ARTIFACT ONLY ON SUCCESS: the translated-text payload is persisted
 *   keyed by an UPFRONT-generated artifact id — payload put BEFORE
 *   descriptor creation, so a put failure leaves NO artifact (the
 *   no-artifact-on-failure contract, the mi.transcribe amendment
 *   ordering) — then the kind=translation artifact is created through
 *   DeriveArtifactBookkeeping. Cancelled and failed runs persist NOTHING.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  DerivedArtifactKind,
  JobDescriptor,
  TranslationEngineDescriptor,
  TranslationEnginePort,
  TranslationRequest,
  TranslationResult,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type {
  ArtifactRegistry,
  ClockPort,
  IdGenerator,
  TextPayloadStore,
  TranscriptPayloadStore,
} from "./ports";
import { textPayloadChecksum } from "./text-payload";
import { DeriveArtifactBookkeeping } from "./derive-artifact-bookkeeping";

export const TRANSLATE_JOB_KIND = "mi.translate";
export const TTS_JOB_KIND = "mi.tts";

/** The artifact kinds mi.translate reads (the work order's explicit list). */
export const TRANSLATE_SOURCE_KINDS: readonly DerivedArtifactKind[] = [
  "transcript",
  "summary",
  "overview",
  "qa",
];

/**
 * The artifact kinds mi.tts reads: the order's clause is the unqualified
 * "a stored text payload by artifact id" — the four translate kinds PLUS
 * translation (this order's own persisted text kind; speaking a
 * translation is the dubbing precursor a LATER order builds on).
 */
export const TTS_SOURCE_KINDS: readonly DerivedArtifactKind[] = [
  "transcript",
  "summary",
  "overview",
  "qa",
  "translation",
];

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** mi.translate's input. */
export interface TranslateArtifactInput {
  /** The SOURCE artifact id (transcript / summary / overview / qa). */
  readonly sourceArtifactId: string;
  /** The source language tag (engine-interpreted, e.g. "en"). */
  readonly sourceLanguageTag: string;
  /** The target language tag (engine-interpreted, e.g. "es"). */
  readonly targetLanguageTag: string;
  /** The current catalog snapshot (READ once for the new artifact's lineage check). */
  readonly catalog: readonly CatalogItem[];
  /** Honoured at the job boundary AND forwarded to the engine mid-run. */
  readonly signal?: AbortSignal;
}

/** mi.tts's input. */

export interface TranslateArtifactOutput {
  /** Terminal descriptor: succeeded (with artifact) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The stored translation artifact on success; null on cancellation AND failure. */
  readonly artifact: DerivedArtifact | null;
  /** The engine's result on success; null otherwise. */
  readonly result: TranslationResult | null;
}

export interface TranslateArtifactDeps {
  /** The translation engine adapter (a test double in tests; a local engine in production wiring). */
  readonly engine: TranslationEnginePort;
  readonly registry: ArtifactRegistry;
  /** The transcript payload store (the transcript kind's text source). */
  readonly transcriptPayloads: TranscriptPayloadStore;
  /** The text payload store (summary/overview/qa/translation kinds' text source + the translation write). */
  readonly textPayloads: TextPayloadStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use cases
// ---------------------------------------------------------------------------

/** mi.translate — the translation derived artifact over a stored text payload. */
export class TranslateArtifact {
  constructor(private readonly deps: TranslateArtifactDeps) {}

  async execute(input: TranslateArtifactInput): Promise<TranslateArtifactOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures — the generate-recommendations precedent).
    if (typeof input.sourceArtifactId !== "string" || input.sourceArtifactId.trim().length === 0) {
      throw callerDefect(
        ErrorCode.IntelligenceTranslationInvalid,
        "sourceArtifactId must be a non-empty artifact id",
        "TranslateArtifactInput",
      );
    }
    if (
      typeof input.sourceLanguageTag !== "string" ||
      input.sourceLanguageTag.trim().length === 0
    ) {
      throw callerDefect(
        ErrorCode.IntelligenceTranslationInvalid,
        "sourceLanguageTag must be a non-blank language tag",
        "TranslateArtifactInput",
      );
    }
    if (
      typeof input.targetLanguageTag !== "string" ||
      input.targetLanguageTag.trim().length === 0
    ) {
      throw callerDefect(
        ErrorCode.IntelligenceTranslationInvalid,
        "targetLanguageTag must be a non-blank language tag",
        "TranslateArtifactInput",
      );
    }

    const createdAt = this.deps.clock.now().toISOString();
    const engineDescriptor = this.deps.engine.descriptor;
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: TRANSLATE_JOB_KIND,
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
          sourceLanguageTag: input.sourceLanguageTag,
          targetLanguageTag: input.targetLanguageTag,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.IntelligenceTranslationInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, nothing read, nothing run.
    if (input.signal?.aborted === true) {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", this.deps.clock.now().toISOString()),
        "queued -> cancelled",
      );
      return { job: cancelled, artifact: null, result: null };
    }

    // 3. Run: queued -> running; resolve the source artifact + its text
    //    (read-time state — typed failures stamp the job failed), then run
    //    the engine with the forwarded signal.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );

    let source: DerivedArtifact;
    let sourceText: string;
    let textChecksum: string;
    try {
      const resolved = await readSourceText(this.deps, {
        sourceArtifactId: input.sourceArtifactId,
        allowedKinds: TRANSLATE_SOURCE_KINDS,
        jobKind: TRANSLATE_JOB_KIND,
        invalidCode: ErrorCode.IntelligenceTranslationInvalid,
        emptyReason:
          "the source artifact's text projection is empty — there is nothing to translate (an empty summary/overview/answer is honest, but it cannot be translated)",
      });
      source = resolved.source;
      sourceText = resolved.text;
      textChecksum = resolved.textChecksum;
    } catch (err) {
      throw jobFailure(this.deps, running, err);
    }

    let result: TranslationResult;
    try {
      const request: TranslationRequest = {
        text: sourceText,
        sourceLanguageTag: input.sourceLanguageTag,
        targetLanguageTag: input.targetLanguageTag,
      };
      result = await this.deps.engine.translate(request, {
        signal: input.signal,
        onProgress: (progress) => {
          // The boundary already passed; the engine's cooperative
          // checkpoints own mid-run cancellation. Progress surfacing is
          // recorded nowhere (no telemetry — the transcribe precedent),
          // acknowledged silently.
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
        return { job: { ...cancelled, lastError: described.text }, artifact: null, result: null };
      }
      throw jobFailure(this.deps, running, err);
    }

    // 4. Success: persist the translated-text payload keyed by an
    //    UPFRONT-generated artifact id FIRST (a put failure leaves NO
    //    artifact — the mi.transcribe amendment ordering), then create the
    //    kind=translation DerivedArtifact through the durable registry
    //    with full lineage. The SOURCE artifact and its payload were READ
    //    — never written back.
    const artifactId = this.deps.generateId();
    try {
      await this.deps.textPayloads.put({
        artifactId,
        kind: "translation",
        text: result.translatedText,
        languageTag: input.targetLanguageTag,
        checksum: textPayloadChecksum(result.translatedText),
      });
    } catch (err) {
      throw jobFailure(this.deps, running, err);
    }

    const model = resolveTranslationModelLineage(result, engineDescriptor);
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: this.deps.registry,
      clock: this.deps.clock,
      generateId: this.deps.generateId,
    });
    let artifact: DerivedArtifact;
    try {
      artifact = await bookkeeping.create({
        id: artifactId,
        sourceItemId: source.sourceItemId,
        kind: "translation",
        lineage: {
          modelId: model.modelId,
          modelVersion: model.modelVersion,
          producedBy: engineDescriptor.id,
          inputsHash: translateInputsHash(input, engineDescriptor, textChecksum),
        },
        licenseNote: engineDescriptor.licenseNote,
        catalog: input.catalog,
      });
    } catch (err) {
      // A lineage violation against the supplied catalog is read-time state
      // too (the caller's snapshot may be stale) — job failed + typed cause.
      throw jobFailure(this.deps, running, err);
    }
    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, artifact, result };
  }
}

// ---------------------------------------------------------------------------
// The shared text-source reading seam
// ---------------------------------------------------------------------------

interface ReadSourceTextSpec {
  readonly sourceArtifactId: string;
  readonly allowedKinds: readonly DerivedArtifactKind[];
  readonly jobKind: string;
  /** The caller-defect-family code read-time source failures carry. */
  readonly invalidCode: ErrorCode.IntelligenceTranslationInvalid | ErrorCode.IntelligenceTtsInvalid;
  readonly emptyReason: string;
}

/**
 * Resolves the source artifact and its TEXT — the read seam both use cases
 * share:
 * - unknown artifact id => typed invalid (read-time, job-stamped upstream);
 * - a kind outside `allowedKinds` => typed invalid naming the allowed set;
 * - kind=transcript => the 0004 segment payload (typed
 *   intelligence/transcript-payload-absent when never persisted), text =
 *   its segment texts joined with single spaces;
 * - every other kind => the 0005 text payload (typed
 *   intelligence/text-payload-absent when never persisted), text = the
 *   stored projection verbatim;
 * - a BLANK projection => typed invalid (nothing to translate/synthesize —
 *   honest source state, surfaced, never an empty substitute);
 * - the returned textChecksum is the FNV-1a checksum of the RESOLVED text
 *   (the translation lineage's inputsHash input — uniform across kinds).
 */
export async function readSourceText(
  deps: Pick<TranslateArtifactDeps, "registry" | "transcriptPayloads" | "textPayloads">,
  spec: ReadSourceTextSpec,
): Promise<{ source: DerivedArtifact; text: string; textChecksum: string }> {
  const source = await deps.registry.get(spec.sourceArtifactId);
  if (source === null) {
    throw new WebFlixError({
      code: spec.invalidCode,
      reason: `artifact "${spec.sourceArtifactId}" is not in the registry — ${spec.jobKind} requires a known text-source artifact`,
      retryable: false,
      context: { sourceArtifactId: spec.sourceArtifactId, jobKind: spec.jobKind },
    });
  }
  if (!spec.allowedKinds.includes(source.kind)) {
    throw new WebFlixError({
      code: spec.invalidCode,
      reason: `artifact "${spec.sourceArtifactId}" has kind "${source.kind}", not one of ${spec.allowedKinds.join(", ")} — ${spec.jobKind} reads stored text payloads only`,
      retryable: false,
      context: {
        sourceArtifactId: spec.sourceArtifactId,
        kind: source.kind,
        allowedKinds: [...spec.allowedKinds],
        jobKind: spec.jobKind,
      },
    });
  }
  let text: string;
  if (source.kind === "transcript") {
    const payload = await deps.transcriptPayloads.get(spec.sourceArtifactId);
    text = payload.segments.map((segment) => segment.text).join(" ");
  } else {
    const payload = await deps.textPayloads.get(spec.sourceArtifactId);
    text = payload.text;
  }
  if (text.trim().length === 0) {
    throw new WebFlixError({
      code: spec.invalidCode,
      reason: spec.emptyReason,
      retryable: false,
      context: {
        sourceArtifactId: spec.sourceArtifactId,
        kind: source.kind,
        jobKind: spec.jobKind,
      },
    });
  }
  return { source, text, textChecksum: textPayloadChecksum(text) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The typed caller-defect error thrown before any job exists. */
export function callerDefect(code: ErrorCode, reason: string, subject: string): WebFlixError {
  return new WebFlixError({
    code,
    reason,
    retryable: false,
    context: { subject },
  });
}

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection. `code` mirrors the cause's so generic handlers see the honest
 * code without unwrapping (the TranscribeJobError pattern, verbatim).
 */
export class TranslateTtsJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "TranslateTtsJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
export function jobFailure(
  deps: Pick<TranslateArtifactDeps, "clock">,
  running: JobDescriptor,
  err: unknown,
): TranslateTtsJobError {
  const described = describeEngineError(err);
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  return new TranslateTtsJobError({
    job: { ...failed, lastError: described.text },
    cause: asWebFlixErrorOrWrap(err),
  });
}

/**
 * The model identity in the translation artifact's lineage, resolved
 * honestly: the ENGINE-REPORTED facts from THIS run's result when
 * volunteered (the engine's own output), falling back to the descriptor's
 * volunteered facts, with the adapter's own id/version as the
 * always-known floor — never a guess (the resolveEngineModelLineage
 * precedent).
 */
function resolveTranslationModelLineage(
  result: TranslationResult,
  descriptor: TranslationEngineDescriptor,
): { modelId: string; modelVersion: string } {
  const modelId =
    result.modelLineage ??
    (descriptor.modelLineage !== undefined && descriptor.modelLineage.length > 0
      ? descriptor.modelLineage
      : descriptor.id);
  const modelVersion =
    result.engineVersion ??
    (descriptor.engineVersion !== undefined && descriptor.engineVersion.length > 0
      ? descriptor.engineVersion
      : descriptor.version);
  return { modelId, modelVersion };
}

/**
 * Deterministic digest of mi.translate's inputs: FNV-1a 32-bit over the
 * exact tuple (source artifact id + the source text's checksum + engine id
 * + engine version + source language tag + target language tag) — no wall
 * clock, no randomness. NOT a cryptographic claim — a stable identity for
 * the artifact lineage's inputsHash (same inputs => same hash, forever; a
 * different target language or a different source text => a different
 * hash).
 */
function translateInputsHash(
  input: TranslateArtifactInput,
  engineDescriptor: TranslationEngineDescriptor,
  textChecksum: string,
): string {
  const parts = [
    input.sourceArtifactId,
    textChecksum,
    engineDescriptor.id,
    engineDescriptor.version,
    input.sourceLanguageTag,
    input.targetLanguageTag,
  ];
  const text = parts.join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** Human-readable, secret-free description of an error for lastError. */
export function describeEngineError(err: unknown): { text: string; cancelled: boolean } {
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
    code: ErrorCode.IntelligenceTranslationEngineFailed,
    reason: `engine reported an unrecognized failure: ${err instanceof Error ? err.message : String(err)}`,
    retryable: false,
    context: {},
  });
}

/** Unwraps a domain transition result (typed invalid on break). */
export function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceTranslationInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
