import { z } from "zod";

/**
 * Stable, machine-readable error codes shared across every WebFlix layer.
 * Format: `<domain>/<kebab-reason>`. The set is additive-only: never
 * repurpose a code, only append new ones.
 */
export enum ErrorCode {
  // catalog
  CatalogMatchFailed = "catalog/match-failed",
  CatalogNotFound = "catalog/not-found",
  // playback
  PlaybackResolveFailed = "playback/resolve-failed",
  PlaybackPlanUnavailable = "playback/plan-unavailable",
  LocalFileMissing = "local/file-missing",
  LocalFileUnsupported = "local/file-unsupported",
  // library
  LibraryIndexFailed = "library/index-failed",
  LibraryCorrupt = "library/corrupt",
  // account / credentials
  AccountNotConnected = "account/not-connected",
  AccountExpired = "account/expired",
  CredentialUnavailable = "credential/unavailable",
  // capability
  CapabilityUnsupported = "capability/unsupported",
  // media intelligence (Phase 4, P4-CONTRACTS — appended per the enum's
  // additive-only rule; the §3 vocabulary carries MI failures)
  IntelligencePolicyUnsupported = "intelligence/policy-unsupported",
  IntelligenceObjectiveInvalid = "intelligence/objective-invalid",
  IntelligenceFeedbackInvalid = "intelligence/feedback-invalid",
  IntelligenceFeedbackConflict = "intelligence/feedback-conflict",
  IntelligenceRankingInvalid = "intelligence/ranking-invalid",
  IntelligenceArtifactInvalid = "intelligence/artifact-invalid",
  // P4-ADAPTERS: the ranker-adapter SELECTION is invalid — unknown adapter
  // id at set time (caller defect), registry drift at resolve time, or a
  // corrupt persisted selection row. Appended per the additive-only rule.
  IntelligenceAdapterSelectionInvalid = "intelligence/adapter-selection-invalid",
  // P4-TRANSCRIBE: the transcription lane's typed failures, appended per the
  // additive-only rule. `transcription-invalid` carries mi.transcribe caller
  // defects (bad request shape / job descriptor construction — validated
  // BEFORE the job exists, the generate-recommendations precedent);
  // `engine-unavailable` is the honest-absent state (the local engine is not
  // on this machine — surfaced with a recovery hint, never hidden);
  // `engine-failed` is a FOUND engine reporting its own failure (non-zero
  // exit), kept distinct from absent because the recovery differs. Typed
  // cancellation reuses the existing cross-cutting `common/cancelled` — no
  // new code is needed for it.
  IntelligenceTranscriptionInvalid = "intelligence/transcription-invalid",
  IntelligenceEngineUnavailable = "intelligence/engine-unavailable",
  IntelligenceEngineFailed = "intelligence/engine-failed",
  // P4-SUMMARIZE: the text-intelligence lane's typed failures, appended per
  // the additive-only rule. `summary-invalid` carries mi.summarize /
  // mi.overview / mi.qa caller defects (blank ids or questions, bad request
  // shapes, referenced artifacts that are not transcripts);
  // `transcript-payload-absent` is the honest state where a transcript
  // artifact exists but its segment payload was never persisted (a
  // pre-0004 transcript) — typed and SURFACED with re-transcription as the
  // recovery, never hidden and never an empty substitute. Typed cancellation
  // reuses the existing cross-cutting `common/cancelled` — no new code.
  IntelligenceSummaryInvalid = "intelligence/summary-invalid",
  IntelligenceTranscriptPayloadAbsent = "intelligence/transcript-payload-absent",
  // P4-TRANSLATE: the translation + TTS lane's typed failures, appended per
  // the additive-only rule. `translation-invalid` / `tts-invalid` carry the
  // mi.translate / mi.tts caller defects (blank artifact ids, language tags
  // or voice ids, bad request shapes, referenced artifacts that are not text
  // sources) — validated BEFORE the job exists where caller-controlled;
  // `translation-engine-unavailable` / `tts-engine-unavailable` are the
  // honest-absent states (the local engine — or, for TTS, the VOICE model —
  // is not on this machine, surfaced with a recovery hint, never hidden,
  // never a silent empty result); `translation-engine-failed` /
  // `tts-engine-failed` are FOUND engines reporting their own failures
  // (non-zero exit, no output), kept distinct from absent because the
  // recovery differs. `text-payload-absent` is the non-transcript analog of
  // `transcript-payload-absent`: a summary/overview/qa/translation artifact
  // whose text payload was never persisted — typed and surfaced, never an
  // empty substitute. (The work order listed the six engine/use-case codes
  // and directed trimming to what the implementation genuinely needs: all
  // six ARE genuinely needed — each maps to a distinct typed failure with
  // its own recovery — plus this one payload-absent code the four-kind text
  // read contract honestly requires.) Typed cancellation reuses the existing
  // cross-cutting `common/cancelled` — no new code is needed for it.
  IntelligenceTranslationInvalid = "intelligence/translation-invalid",
  IntelligenceTranslationEngineUnavailable = "intelligence/translation-engine-unavailable",
  IntelligenceTranslationEngineFailed = "intelligence/translation-engine-failed",
  IntelligenceTtsInvalid = "intelligence/tts-invalid",
  IntelligenceTtsEngineUnavailable = "intelligence/tts-engine-unavailable",
  IntelligenceTtsEngineFailed = "intelligence/tts-engine-failed",
  IntelligenceTextPayloadAbsent = "intelligence/text-payload-absent",
  // cross-cutting
  RateLimited = "common/rate-limited",
  Network = "common/network",
  Timeout = "common/timeout",
  Cancelled = "common/cancelled",
  NotImplemented = "common/not-implemented",
  Unknown = "common/unknown",
}

/**
 * Zod schema for {@link ErrorCode} values. Built via `Object.values` (not
 * `z.nativeEnum`) so the schema behaves identically on zod 3 and zod 4.
 */
export const ErrorCodeSchema = z.enum(Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]]);

/** Serializable, persistable shape of a {@link WebFlixError}. */
export const WebFlixErrorShapeSchema = z.object({
  code: ErrorCodeSchema,
  /** Human-readable, renderer-safe reason (no secrets in reason or context). */
  reason: z.string().min(1),
  /** True when the caller may retry the failed operation as-is. */
  retryable: z.boolean(),
  /** Structured, secret-free diagnostics bag. */
  context: z.record(z.string(), z.unknown()).default({}),
});
export type WebFlixErrorShape = z.infer<typeof WebFlixErrorShapeSchema>;

/** Constructor input for {@link WebFlixError}; `context` defaults to `{}`. */
export type WebFlixErrorInit = {
  code: ErrorCode;
  reason: string;
  retryable: boolean;
  context?: Record<string, unknown>;
};

/**
 * The typed error every WebFlix layer throws and every boundary serialises.
 * Carries a stable machine-readable `code`, a human-readable `reason`, a
 * `retryable` flag the scheduler can act on, and a secret-free `context`
 * bag for diagnostics.
 */
export class WebFlixError extends Error {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(init: WebFlixErrorInit) {
    super(init.reason);
    this.name = "WebFlixError";
    this.code = init.code;
    this.reason = init.reason;
    this.retryable = init.retryable;
    this.context = init.context ?? {};
  }

  /** Structural type guard (robust across bundle-duplicated classes). */
  static is(value: unknown): value is WebFlixError {
    return value instanceof WebFlixError;
  }

  /** IPC-safe, secret-free serialization of the error (frozen WebFlixErrorShape). */
  toJSON(): {
    code: ErrorCode;
    reason: string;
    retryable: boolean;
    context: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      reason: this.reason,
      retryable: this.retryable,
      context: this.context,
    };
  }
}
