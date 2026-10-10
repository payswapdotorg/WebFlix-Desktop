import { ErrorCode, IsoDateTimeSchema, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type {
  FailureMode,
  IsoDateTime,
  JobDescriptor,
  JobState,
  Provenance,
  RetryPolicy,
} from "webflix-contracts";
import { deepEqual } from "./internal/objects";
import { parseOrThrow } from "./internal/parse";

/**
 * Pure job semantics: retry-with-backoff decisions, cancellation
 * handshakes, lifecycle transitions, and provenance preservation. Jobs are
 * cancellable, retryable and provenance-preserving; every transformation
 * below returns a NEW descriptor and never touches `provenance`.
 */

/* ------------------------------------------------------------------ */
/* Retry with backoff                                                   */
/* ------------------------------------------------------------------ */

/**
 * Failure modes that are safe to retry automatically. `auth`, `region`,
 * `parse` and `unknown` need human or policy intervention; a retry policy
 * may still explicitly list them to override this default.
 */
export const INHERENTLY_RETRYABLE_FAILURE_MODES: readonly FailureMode[] = [
  "network",
  "timeout",
  "rate-limit",
  "upstream",
];

export function isRetryableFailureMode(mode: FailureMode): boolean {
  return (INHERENTLY_RETRYABLE_FAILURE_MODES as readonly string[]).includes(mode);
}

export const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

export interface BackoffOptions {
  /** Upper bound for a single delay (default 5 minutes). */
  maxBackoffMs?: number;
}

/**
 * Exponential backoff for the NEXT attempt after `failedAttempts` failures:
 * backoffMs * multiplier^failedAttempts, clamped to [0, maxBackoffMs].
 * Deterministic — jitter is a scheduler concern, not a domain one.
 */
export function computeBackoffMs(
  retry: RetryPolicy,
  failedAttempts: number,
  options: BackoffOptions = {},
): number {
  const cap = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  if (!Number.isFinite(cap) || cap < 0) {
    throw new WebFlixError({
      code: ErrorCode.Unknown,
      reason: `maxBackoffMs must be a non-negative finite number, got ${cap}`,
      retryable: false,
      context: { maxBackoffMs: options.maxBackoffMs },
    });
  }
  const base = Number.isFinite(retry.backoffMs) && retry.backoffMs > 0 ? retry.backoffMs : 0;
  const multiplier =
    Number.isFinite(retry.multiplier) && retry.multiplier >= 1 ? retry.multiplier : 1;
  const attempts = Number.isInteger(failedAttempts) && failedAttempts > 0 ? failedAttempts : 0;
  const raw = base * Math.pow(multiplier, attempts);
  return Math.min(Math.max(raw, 0), cap);
}

export interface JobFailure {
  mode: FailureMode;
  message?: string;
}

export type JobRetryDecision =
  | { outcome: "retry"; nextAttempt: number; delayMs: number; reason: string }
  | {
      outcome: "exhausted";
      attemptsUsed: number;
      maxAttempts: number;
      reason: string;
    }
  | { outcome: "no-retry"; reason: string };

/**
 * Decides what happens after a job failure.
 *
 * Semantics (`job.attempts` counts COMPLETED, i.e. failed, attempts):
 * - cancelled / non-failed jobs, or jobs with a pending cancellation
 *   request, never retry;
 * - a non-empty `retry.on` is an explicit allow-list (an operator listing
 *   e.g. `parse` overrides the inherent-retryability default); an empty
 *   `retry.on` retries every inherently retryable failure mode;
 * - the next attempt number is attempts + 1; beyond maxAttempts the budget
 *   is exhausted;
 * - the delay is computed from the attempts already spent.
 */
export function decideRetry(
  job: JobDescriptor,
  failure: JobFailure,
  options: BackoffOptions = {},
): JobRetryDecision {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  if (parsed.state === "cancelled") {
    return {
      outcome: "no-retry",
      reason: "job was cancelled; cancelled jobs never retry",
    };
  }
  if (parsed.state !== "failed") {
    return {
      outcome: "no-retry",
      reason: `retry decisions apply to failed jobs, not ${parsed.state}`,
    };
  }
  if (parsed.cancelRequested) {
    return {
      outcome: "no-retry",
      reason: "cancellation was requested; the job will not retry",
    };
  }
  const policy = parsed.retry;
  if (policy.on.length > 0 && !policy.on.includes(failure.mode)) {
    return {
      outcome: "no-retry",
      reason: `failure mode ${failure.mode} is excluded by the retry policy (on: ${policy.on.join(", ")})`,
    };
  }
  if (policy.on.length === 0 && !isRetryableFailureMode(failure.mode)) {
    return {
      outcome: "no-retry",
      reason: `failure mode ${failure.mode} is not automatically retryable`,
    };
  }
  const nextAttempt = parsed.attempts + 1;
  if (nextAttempt > policy.maxAttempts) {
    return {
      outcome: "exhausted",
      attemptsUsed: parsed.attempts,
      maxAttempts: policy.maxAttempts,
      reason: `retry budget exhausted after ${parsed.attempts} of ${policy.maxAttempts} attempts`,
    };
  }
  return {
    outcome: "retry",
    nextAttempt,
    delayMs: computeBackoffMs(policy, parsed.attempts, options),
    reason: `attempt ${nextAttempt} of ${policy.maxAttempts} scheduled after ${failure.mode} failure`,
  };
}

function lastErrorOf(failure: JobFailure): string {
  return failure.message !== undefined && failure.message.length > 0
    ? failure.message
    : `job failed: ${failure.mode}`;
}

/**
 * Applies a retry decision to a descriptor (provenance untouched):
 * - retry → requeued with attempts set to nextAttempt and lastError recorded;
 * - exhausted / no-retry → stays failed with lastError recorded for inspection.
 */
export function applyRetryDecision(
  job: JobDescriptor,
  decision: JobRetryDecision,
  failure: JobFailure,
  at: IsoDateTime,
): JobDescriptor {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  const instant = parseOrThrow(IsoDateTimeSchema, at, ErrorCode.Unknown, "job timestamp");
  const lastError = lastErrorOf(failure);
  if (decision.outcome === "retry") {
    return {
      ...parsed,
      state: "queued",
      attempts: decision.nextAttempt,
      updatedAt: instant,
      lastError,
    };
  }
  return { ...parsed, state: "failed", updatedAt: instant, lastError };
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                         */
/* ------------------------------------------------------------------ */

export const TERMINAL_JOB_STATES: readonly JobState[] = ["succeeded", "failed", "cancelled"];

export function isTerminalJobState(state: JobState): boolean {
  return (TERMINAL_JOB_STATES as readonly string[]).includes(state);
}

export type JobCancellation =
  | { outcome: "requested" | "cancelled"; job: JobDescriptor }
  | { outcome: "unchanged"; job: JobDescriptor; reason: string }
  | { outcome: "rejected"; reason: string };

/**
 * First half of the cancellation handshake: sets `cancelRequested` on a
 * live job. Idempotent; terminal jobs are unchanged. The job must stop at
 * its next checkpoint.
 */
export function requestCancellation(job: JobDescriptor, at: IsoDateTime): JobCancellation {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  const instant = parseOrThrow(IsoDateTimeSchema, at, ErrorCode.Unknown, "job timestamp");
  if (isTerminalJobState(parsed.state)) {
    return {
      outcome: "unchanged",
      job: parsed,
      reason: `job is already ${parsed.state}`,
    };
  }
  if (parsed.cancelRequested) {
    return {
      outcome: "unchanged",
      job: parsed,
      reason: "cancellation was already requested",
    };
  }
  return {
    outcome: "requested",
    job: { ...parsed, cancelRequested: true, updatedAt: instant },
  };
}

/**
 * Second half of the handshake: honours a pending cancellation request.
 * Queued jobs are always dequeueable; running/paused jobs honour the
 * request only when they advertise `cancellable`. Rejected when no
 * cancellation was requested; unchanged when already terminal.
 */
export function acknowledgeCancellation(job: JobDescriptor, at: IsoDateTime): JobCancellation {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  const instant = parseOrThrow(IsoDateTimeSchema, at, ErrorCode.Unknown, "job timestamp");
  if (!parsed.cancelRequested) {
    return {
      outcome: "rejected",
      reason: "no cancellation has been requested for this job",
    };
  }
  if (isTerminalJobState(parsed.state)) {
    return {
      outcome: "unchanged",
      job: parsed,
      reason: `job is already ${parsed.state}`,
    };
  }
  if (parsed.state !== "queued" && !parsed.cancellable) {
    return {
      outcome: "rejected",
      reason: `job does not support cancellation while ${parsed.state} (cancellable=false)`,
    };
  }
  return {
    outcome: "cancelled",
    job: { ...parsed, state: "cancelled", updatedAt: instant, finishedAt: instant },
  };
}

/* ------------------------------------------------------------------ */
/* Lifecycle transitions                                                */
/* ------------------------------------------------------------------ */

export const JOB_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ["running", "cancelled"],
  running: ["paused", "succeeded", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export type JobTransition =
  | { outcome: "transitioned"; job: JobDescriptor }
  | { outcome: "rejected"; reason: string };

/**
 * Moves a job along its lifecycle, stamping startedAt on entering `running`
 * and finishedAt on any terminal state. Requeues after failure go through
 * applyRetryDecision, not through this table. Provenance is preserved.
 */
export function transitionJob(job: JobDescriptor, next: JobState, at: IsoDateTime): JobTransition {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  const instant = parseOrThrow(IsoDateTimeSchema, at, ErrorCode.Unknown, "job timestamp");
  if (!JOB_TRANSITIONS[parsed.state].includes(next)) {
    return {
      outcome: "rejected",
      reason: `illegal job transition ${parsed.state} → ${next}`,
    };
  }
  const patch: Partial<JobDescriptor> = { state: next, updatedAt: instant };
  if (next === "running" && parsed.startedAt === undefined) {
    patch.startedAt = instant;
  }
  if (next === "succeeded" || next === "failed" || next === "cancelled") {
    patch.finishedAt = instant;
  }
  return { outcome: "transitioned", job: { ...parsed, ...patch } };
}

/* ------------------------------------------------------------------ */
/* Provenance preservation                                              */
/* ------------------------------------------------------------------ */

/**
 * The provenance every artifact produced by this job must carry, verbatim.
 */
export function jobArtifactProvenance(job: JobDescriptor): Provenance {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  return { ...parsed.provenance };
}

export interface ProvenanceOverrides {
  buildId?: string;
  inputsHash?: string;
}

/**
 * Derives artifact provenance from a job, optionally attaching build/input
 * digests. Connector identity and generation time are preserved
 * unconditionally — that is what keeps derived artifacts auditable.
 */
export function deriveArtifactProvenance(
  job: JobDescriptor,
  overrides: ProvenanceOverrides = {},
): Provenance {
  const parsed = parseOrThrow(JobDescriptorSchema, job, ErrorCode.Unknown, "JobDescriptor");
  const derived: Provenance = { ...parsed.provenance };
  if (overrides.buildId !== undefined) derived.buildId = overrides.buildId;
  if (overrides.inputsHash !== undefined) {
    derived.inputsHash = overrides.inputsHash;
  }
  return derived;
}

/** True when derived provenance is byte-for-byte the original (deep equality). */
export function isProvenancePreserved(original: Provenance, derived: Provenance): boolean {
  return deepEqual(original, derived);
}
