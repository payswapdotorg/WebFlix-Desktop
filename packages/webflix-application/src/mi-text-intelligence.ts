/**
 * The text-intelligence use cases (P4-SUMMARIZE scope row 4): mi.summarize,
 * mi.overview and mi.qa — each a derived-artifact producer riding the frozen
 * §2.6 JobDescriptor/JobState wrapper (the transcribe-media-file precedent,
 * phase4-mi-plan §2: MI jobs RIDE §2.6, never re-invent it).
 *
 * Semantics, stated honestly (identical shape for all three operations):
 *
 * - INPUT: a transcript ARTIFACT id (the source), the current catalog
 *   snapshot (READ once for the new artifact's lineage check) and a signal.
 *   mi.qa additionally carries the user's question.
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   IntelligenceSummaryInvalid, never job failures): a blank artifact id; a
 *   blank question. Everything discovered later (unknown artifact id, a
 *   non-transcript artifact, a missing payload, a lineage violation against
 *   the supplied catalog) is read-time state: the job is stamped FAILED and
 *   the typed error rethrown through TextIntelligenceJobError (cause's code
 *   intact — the TranscribeJobError pattern).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is read or run (no
 *   artifact, no result); MID-RUN the signal is forwarded to the engine,
 *   which cooperates between units — a cancelled engine rejects with typed
 *   common/cancelled, the job transitions running -> cancelled, NO artifact
 *   is stored (a cancelled run is not a summary/overview/answer) and the
 *   result is null.
 * - SOURCE UNTOUCHED, structurally: the SOURCE transcript artifact is READ
 *   (registry get) and its payload READ (payload store get); nothing in
 *   this module can write either back. The original catalog snapshot is
 *   read for the lineage check only. Pinned by deep-equal tests.
 * - PAYLOAD-BACKED INPUTS: the segments the engine sees come from the
 *   durable transcript payload store keyed by the transcript artifact id —
 *   a transcript without a stored payload (pre-0004) is the TYPED
 *   intelligence/transcript-payload-absent error, surfaced with
 *   re-transcription as the recovery (never an empty substitute).
 * - LINEAGE, honest end to end: modelId/modelVersion resolve from the
 *   ENGINE descriptor — for the built-in engine the model IS our extractive
 *   algorithm (modelId webflix.extractive.v1, modelVersion "v1", per the
 *   work order); for a later user-selected adapter, the descriptor's own
 *   reported modelLineage/engineVersion with the adapter id/version as the
 *   always-known floor (the resolveModelVersion precedent). producedBy =
 *   the engine descriptor's id. inputsHash = FNV-1a 32-bit over
 *   (transcript artifact id + payload checksum + engine id + engine
 *   version [+ question for mi.qa]) — deterministic, no wall clock, no
 *   randomness, and honest about WHAT varied: a different question or a
 *   different payload produces a different digest. licenseNote = the
 *   engine descriptor's (null honest for the built-in — our own code).
 * - ARTIFACT ONLY ON SUCCESS: created through DeriveArtifactBookkeeping
 *   (schema + domain lineage validation + registry put) AFTER the engine
 *   returns. An empty summary/overview/no-match answer is SUCCESS (the
 *   honest extractive outcome over an empty or unmatched source) and still
 *   records its artifact.
 *
 * P4-TRANSLATE AMENDMENT (sanctioned by that order's read contract — "mi.translate
 * reads a stored text payload by artifact id (transcript/summary/overview/qa …)"):
 * on SUCCESS the use cases ALSO persist the artifact's TEXT PROJECTION in the
 * text payload store, keyed by an UPFRONT-generated artifact id, PUT BEFORE the
 * descriptor creation (the mi.transcribe amendment ordering — a put failure
 * leaves NO artifact). The projection rule per kind is FIXED and documented in
 * text-payload.ts: summary = sentence texts joined " ", overview = chapter
 * titles joined " ", qa = span quotes joined " ". Cancelled and failed runs
 * persist NOTHING (unchanged). The SOURCE transcript artifact and its payload
 * remain read-only.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  JobDescriptor,
  OverviewResult,
  QaAnswer,
  SummaryEngineDescriptor,
  SummaryEngineOptions,
  SummaryEnginePort,
  SummaryResult,
  TranscriptSegment,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type {
  ArtifactRegistry,
  ClockPort,
  IdGenerator,
  TextPayloadStore,
  TranscriptPayloadStore,
} from "./ports";
import { DeriveArtifactBookkeeping } from "./derive-artifact-bookkeeping";
import {
  BUILT_IN_SUMMARY_ENGINE_ID,
  EXTRACTIVE_MODEL_ID,
  EXTRACTIVE_MODEL_VERSION,
} from "./built-in-summary-engine";
import { textPayloadChecksum } from "./text-payload";

export const SUMMARIZE_JOB_KIND = "mi.summarize";
export const OVERVIEW_JOB_KIND = "mi.overview";
export const QA_JOB_KIND = "mi.qa";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** Shared input shape (mi.qa adds the question). */
export interface TextIntelligenceInput {
  /** The SOURCE transcript artifact id (its stored payload is the input). */
  readonly transcriptArtifactId: string;
  /** The current catalog snapshot (READ once for the lineage check). */
  readonly catalog: readonly CatalogItem[];
  /** Honoured at the job boundary AND forwarded to the engine mid-run. */
  readonly signal?: AbortSignal;
}

/** mi.qa's input: the shared shape plus the user's question. */
export interface AnswerFromTranscriptInput extends TextIntelligenceInput {
  readonly question: string;
}

/** Shared output shape (the transcribe output precedent). */
export interface TextIntelligenceOutput<T> {
  /** Terminal descriptor: succeeded (with artifact) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The stored artifact on success; null on cancellation AND failure. */
  readonly artifact: DerivedArtifact | null;
  /** The engine's result on success; null otherwise. */
  readonly result: T | null;
}

export type SummarizeTranscriptOutput = TextIntelligenceOutput<SummaryResult>;
export type BuildTranscriptOverviewOutput = TextIntelligenceOutput<OverviewResult>;
export type AnswerFromTranscriptOutput = TextIntelligenceOutput<QaAnswer>;

export interface TextIntelligenceDeps {
  /** The text-intelligence engine (the built-in extractive engine by default; a test double in tests). */
  readonly engine: SummaryEnginePort;
  readonly registry: ArtifactRegistry;
  readonly payloads: TranscriptPayloadStore;
  /** The text payload store (P4-TRANSLATE amendment: success persists the artifact's text projection). */
  readonly textPayloads: TextPayloadStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use cases
// ---------------------------------------------------------------------------

/** mi.summarize — the extractive summary derived artifact. */
export class SummarizeTranscript {
  constructor(private readonly deps: TextIntelligenceDeps) {}

  async execute(input: TextIntelligenceInput): Promise<SummarizeTranscriptOutput> {
    return runTextIntelligence(this.deps, {
      jobKind: SUMMARIZE_JOB_KIND,
      artifactKind: "summary",
      input,
      projection: (result) => result.sentences.map((sentence) => sentence.text).join(" "),
      engineCall: (segments, options) => this.deps.engine.summarize({ segments }, options),
    });
  }
}

/** mi.overview — the timeline-chapters derived artifact. */
export class BuildTranscriptOverview {
  constructor(private readonly deps: TextIntelligenceDeps) {}

  async execute(input: TextIntelligenceInput): Promise<BuildTranscriptOverviewOutput> {
    return runTextIntelligence(this.deps, {
      jobKind: OVERVIEW_JOB_KIND,
      artifactKind: "overview",
      input,
      projection: (result) => result.chapters.map((chapter) => chapter.title).join(" "),
      engineCall: (segments, options) => this.deps.engine.overview({ segments }, options),
    });
  }
}

/** mi.qa — the extractive quoted-spans derived artifact. */
export class AnswerFromTranscript {
  constructor(private readonly deps: TextIntelligenceDeps) {}

  async execute(input: AnswerFromTranscriptInput): Promise<AnswerFromTranscriptOutput> {
    return runTextIntelligence(this.deps, {
      jobKind: QA_JOB_KIND,
      artifactKind: "qa",
      input,
      question: input.question,
      projection: (result) => result.spans.map((span) => span.quote).join(" "),
      engineCall: (segments, options) =>
        this.deps.engine.answer({ segments, question: input.question }, options),
    });
  }
}

// ---------------------------------------------------------------------------
// The shared §2.6 runner
// ---------------------------------------------------------------------------

interface TextIntelligenceRun<T> {
  readonly jobKind: string;
  readonly artifactKind: "summary" | "overview" | "qa";
  readonly input: TextIntelligenceInput;
  /** Present for mi.qa — part of the engine request AND the inputsHash. */
  readonly question?: string;
  /** The artifact's TEXT PROJECTION (P4-TRANSLATE amendment; the rule is documented per kind in text-payload.ts). */
  readonly projection: (result: T) => string;
  readonly engineCall: (
    segments: readonly TranscriptSegment[],
    options: SummaryEngineOptions,
  ) => Promise<T>;
}

async function runTextIntelligence<T>(
  deps: TextIntelligenceDeps,
  run: TextIntelligenceRun<T>,
): Promise<TextIntelligenceOutput<T>> {
  // 1. Caller defects validated BEFORE the job exists — typed errors, never
  //    job failures (the generate-recommendations precedent).
  if (
    typeof run.input.transcriptArtifactId !== "string" ||
    run.input.transcriptArtifactId.trim().length === 0
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceSummaryInvalid,
      reason: "transcriptArtifactId must be a non-empty artifact id",
      retryable: false,
      context: { subject: "TextIntelligenceInput", jobKind: run.jobKind },
    });
  }
  if (run.question !== undefined && run.question.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceSummaryInvalid,
      reason: "question must be a non-blank string (mi.qa)",
      retryable: false,
      context: { subject: "AnswerFromTranscriptInput", jobKind: run.jobKind },
    });
  }

  const createdAt = deps.clock.now().toISOString();
  const engineDescriptor = deps.engine.descriptor;
  const job: JobDescriptor = parseOrThrow(
    JobDescriptorSchema,
    {
      id: deps.generateId(),
      kind: run.jobKind,
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
        transcriptArtifactId: run.input.transcriptArtifactId,
        engineId: engineDescriptor.id,
        engineLabel: engineDescriptor.label,
        ...(run.question !== undefined ? { question: run.question } : {}),
      },
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    },
    ErrorCode.IntelligenceSummaryInvalid,
    "JobDescriptor",
  );

  // 2. Boundary cancellation: queued -> cancelled, nothing read, nothing run.
  if (run.input.signal?.aborted === true) {
    const cancelled = expectTransitioned(
      transitionJob(job, "cancelled", deps.clock.now().toISOString()),
      "queued -> cancelled",
    );
    return { job: cancelled, artifact: null, result: null };
  }

  // 3. Run: queued -> running; resolve the source transcript + its payload
  //    (read-time state — typed failures stamp the job failed), then run
  //    the engine with the forwarded signal.
  const startInstant = deps.clock.now().toISOString();
  const running = expectTransitioned(
    transitionJob(job, "running", startInstant),
    "queued -> running",
  );

  let source: DerivedArtifact;
  let payloadChecksum: string;
  let segments: readonly TranscriptSegment[];
  try {
    const resolved = await deps.registry.get(run.input.transcriptArtifactId);
    if (resolved === null) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceSummaryInvalid,
        reason: `transcript artifact "${run.input.transcriptArtifactId}" is not in the registry — ${run.jobKind} requires a known transcript artifact`,
        retryable: false,
        context: { transcriptArtifactId: run.input.transcriptArtifactId, jobKind: run.jobKind },
      });
    }
    if (resolved.kind !== "transcript") {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceSummaryInvalid,
        reason: `artifact "${run.input.transcriptArtifactId}" has kind "${resolved.kind}", not "transcript" — ${run.jobKind} derives from transcripts only`,
        retryable: false,
        context: {
          transcriptArtifactId: run.input.transcriptArtifactId,
          kind: resolved.kind,
          jobKind: run.jobKind,
        },
      });
    }
    source = resolved;
    const payload = await deps.payloads.get(run.input.transcriptArtifactId);
    payloadChecksum = payload.checksum;
    segments = payload.segments;
  } catch (err) {
    // Read-time typed failures: job FAILED + the typed error rethrown
    // through the job error (cause's code intact — never swallowed).
    throw jobFailure(deps, running, err);
  }

  let result: T;
  try {
    result = await run.engineCall(segments, {
      signal: run.input.signal,
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
        transitionJob(running, "cancelled", deps.clock.now().toISOString()),
        "running -> cancelled",
      );
      return { job: { ...cancelled, lastError: described.text }, artifact: null, result: null };
    }
    throw jobFailure(deps, running, err);
  }

  // 4. Success: persist the artifact's TEXT PROJECTION keyed by an
  //    UPFRONT-generated artifact id FIRST (a put failure leaves NO
  //    artifact — the mi.transcribe amendment ordering), then create the
  //    DerivedArtifact through the durable registry with full lineage; job
  //    succeeded. The SOURCE transcript artifact and its payload were READ
  //    — never written back.
  const model = resolveEngineModelLineage(engineDescriptor);
  const artifactId = deps.generateId();
  const projection = run.projection(result);
  try {
    await deps.textPayloads.put({
      artifactId,
      kind: run.artifactKind,
      text: projection,
      checksum: textPayloadChecksum(projection),
    });
  } catch (err) {
    throw jobFailure(deps, running, err);
  }
  const bookkeeping = new DeriveArtifactBookkeeping({
    registry: deps.registry,
    clock: deps.clock,
    generateId: deps.generateId,
  });
  let artifact: DerivedArtifact;
  try {
    artifact = await bookkeeping.create({
      id: artifactId,
      sourceItemId: source.sourceItemId,
      kind: run.artifactKind,
      lineage: {
        modelId: model.modelId,
        modelVersion: model.modelVersion,
        producedBy: engineDescriptor.id,
        inputsHash: textIntelligenceInputsHash(run, engineDescriptor, payloadChecksum),
      },
      licenseNote: engineDescriptor.licenseNote,
      catalog: run.input.catalog,
    });
  } catch (err) {
    // A lineage violation against the supplied catalog is read-time state
    // too (the caller's snapshot may be stale) — job failed + typed cause.
    throw jobFailure(deps, running, err);
  }
  const succeeded = expectTransitioned(
    transitionJob(running, "succeeded", deps.clock.now().toISOString()),
    "running -> succeeded",
  );
  return { job: succeeded, artifact, result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection. `code` mirrors the cause's so generic handlers see the honest
 * code without unwrapping (the TranscribeJobError pattern, verbatim).
 */
export class TextIntelligenceJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "TextIntelligenceJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function jobFailure(
  deps: TextIntelligenceDeps,
  running: JobDescriptor,
  err: unknown,
): TextIntelligenceJobError {
  const described = describeEngineError(err);
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  return new TextIntelligenceJobError({
    job: { ...failed, lastError: described.text },
    cause: asWebFlixErrorOrWrap(err),
  });
}

/**
 * The model identity in the produced artifact's lineage, resolved honestly:
 * the BUILT-IN engine's model IS our extractive algorithm (fixed identity
 * webflix.extractive.v1 / "v1", per the work order); any other engine's
 * modelLineage (read from the model's own output) with its engineVersion,
 * falling back to the adapter's own id/version — the always-known floor,
 * never a guess (the resolveModelVersion precedent).
 */
function resolveEngineModelLineage(descriptor: SummaryEngineDescriptor): {
  modelId: string;
  modelVersion: string;
} {
  if (descriptor.id === BUILT_IN_SUMMARY_ENGINE_ID) {
    return { modelId: EXTRACTIVE_MODEL_ID, modelVersion: EXTRACTIVE_MODEL_VERSION };
  }
  if (descriptor.modelLineage !== undefined && descriptor.modelLineage.length > 0) {
    return {
      modelId: descriptor.modelLineage,
      modelVersion:
        descriptor.engineVersion !== undefined && descriptor.engineVersion.length > 0
          ? descriptor.engineVersion
          : descriptor.version,
    };
  }
  return { modelId: descriptor.id, modelVersion: descriptor.version };
}

/**
 * Deterministic digest of the operation's inputs: FNV-1a 32-bit over the
 * exact tuple (transcript artifact id + payload checksum + engine id +
 * engine version [+ question]) — no wall clock, no randomness. NOT a
 * cryptographic claim — a stable identity for the artifact lineage's
 * inputsHash (same inputs => same hash, forever; a different question or
 * payload => a different hash).
 */
function textIntelligenceInputsHash(
  run: { readonly input: TextIntelligenceInput; readonly question?: string },
  engineDescriptor: SummaryEngineDescriptor,
  payloadChecksum: string,
): string {
  const parts = [
    run.input.transcriptArtifactId,
    payloadChecksum,
    engineDescriptor.id,
    engineDescriptor.version,
    run.question ?? "",
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

/** Unwraps a domain transition result (typed summary-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceSummaryInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
