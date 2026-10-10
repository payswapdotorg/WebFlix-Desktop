import { z } from "zod";
import { IsoDateTimeSchema, SecretFreeRecordSchema } from "./internal/primitives";
import { FailureModeSchema, ProvenanceSchema } from "./capability";

/** Lifecycle states of a background job. */
export const JobStateSchema = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobState = z.infer<typeof JobStateSchema>;

/**
 * Dot-namespaced job kind, e.g. `library.index`. An open set: the scheduler
 * routes any well-formed kind by prefix.
 */
export const JobKindSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/,
    "must be a dot-namespaced job kind such as library.index",
  );
export type JobKind = z.infer<typeof JobKindSchema>;

/** Retry behaviour for a job; `maxAttempts > 1` makes the job retryable. */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(3),
  backoffMs: z.number().int().min(0).default(1000),
  /** Exponential backoff multiplier. */
  multiplier: z.number().min(1).default(2),
  /** Only retry these failure modes; empty means retry every retryable error. */
  on: z.array(FailureModeSchema).default([]),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/**
 * A unit of background work. JobDescriptors are:
 * - cancellable — `cancellable` advertises checkpoint support and
 *   `cancelRequested` is the scheduler's stop handshake;
 * - retryable — `retry` bounds attempts and backoff;
 * - provenance-preserving — `provenance` travels with the job so every
 *   artifact it produces remains auditable back to its inputs.
 */
export const JobDescriptorSchema = z.object({
  id: z.string().min(1),
  kind: JobKindSchema,
  state: JobStateSchema,
  /** Lower values run first. */
  priority: z.number().int().min(0).default(0),
  /** Whether the job honors cancellation between steps. */
  cancellable: z.boolean(),
  /** Set by the scheduler; the job must stop at its next checkpoint. */
  cancelRequested: z.boolean().default(false),
  retry: RetryPolicySchema,
  /** Provenance of the inputs this job was derived from. */
  provenance: ProvenanceSchema,
  /** Kind-specific parameters. Secret-free by contract. */
  payload: SecretFreeRecordSchema.default({}),
  attempts: z.number().int().min(0).default(0),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.optional(),
  finishedAt: IsoDateTimeSchema.optional(),
  lastError: z.string().min(1).optional(),
});
export type JobDescriptor = z.infer<typeof JobDescriptorSchema>;
