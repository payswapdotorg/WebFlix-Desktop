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
