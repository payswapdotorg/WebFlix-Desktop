/**
 * ads.sourceManifests — the manifest-listing READ use case (P5-SOURCES
 * scope row 3), riding the frozen §2.6 JobDescriptor/JobState wrapper
 * as a read job (the ads.reviewSignals precedent). Returns the coverage
 * declarations of every registered source for the Ad Center's honest
 * display: the manifests in the registry's stable order, plus row-tally
 * counts by access state (how many sources are available /
 * pending-authorization / blocked — counted facts, never a coverage
 * promise; the no-global-ad-coverage rule rides the manifests' own
 * notes).
 *
 * The blocked/pending counts are PRODUCT facts: the Ad Center renders
 * "1 blocked, 2 pending-authorization" as the state of the world, not
 * as failures. Nothing is stored, nothing is mutated; a read over the
 * static registry.
 *
 * CANCELLATION at the boundary (queued -> cancelled before anything is
 * listed); one cooperative checkpoint before the registry read.
 * INFRASTRUCTURE FAILURES (the registry read throwing — impossible for
 * the static default, possible for a wired double) stamp the job FAILED
 * and rethrow through AdsSourceManifestsJobError. NO input to validate
 * (the read takes no parameters beyond the signal) — there are no
 * caller defects on this surface.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type { JobDescriptor, TransparencySourceManifest } from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type { ClockPort, IdGenerator } from "./ports";
import type { TransparencySourceRegistry } from "./transparency-source-registry";

export const ADS_SOURCE_MANIFESTS_JOB_KIND = "ads.source-manifests";

/** The seam's own identity (§2.6 job provenance). */
export const ADS_SOURCE_MANIFESTS_SEAM_ID = "webflix.ads-source-manifests";
export const ADS_SOURCE_MANIFESTS_SEAM_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** The read request: no parameters — the whole registry's declarations. */
export interface ReadTransparencySourceManifestsInput {
  /** Honoured at the job boundary AND at the checkpoint before the read. */
  readonly signal?: AbortSignal;
}

/**
 * The honest manifest listing: every registered source's coverage
 * declaration in the registry's stable order, plus the access-state row
 * tallies (counted facts for the Ad Center's honest display).
 */
export interface AdsSourceManifestsReport {
  /** The coverage declarations, registry order, one per source. */
  readonly manifests: readonly TransparencySourceManifest[];
  /** Row tallies only: how many sources per access state (facts, never promises). */
  readonly counts: {
    readonly sources: number;
    readonly available: number;
    readonly pendingAuthorization: number;
    readonly blocked: number;
  };
}

export interface ReadTransparencySourceManifestsOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsSourceManifestsReport | null;
}

export interface ReadTransparencySourceManifestsDeps {
  /** The source registry (the static default ships the three honest-state adapters). */
  readonly registry: TransparencySourceRegistry;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.sourceManifests — the coverage declarations for honest display. */
export class ReadTransparencySourceManifests {
  constructor(private readonly deps: ReadTransparencySourceManifestsDeps) {}

  async execute(
    input: ReadTransparencySourceManifestsInput = {},
  ): Promise<ReadTransparencySourceManifestsOutput> {
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";
    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_SOURCE_MANIFESTS_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_SOURCE_MANIFESTS_SEAM_ID,
          connectorVersion: ADS_SOURCE_MANIFESTS_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: { signalState },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsSourceInvalid,
      "JobDescriptor",
    );

    // Boundary cancellation: queued -> cancelled, nothing listed.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, report: null };
    }

    // Run: queued -> running; one cooperative checkpoint, then the read.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    try {
      await Promise.resolve();
      if (input.signal?.aborted === true) {
        return { job: this.cancelledDescriptor(running), report: null };
      }
      const manifests = this.deps.registry.list().map((entry) => entry.manifest);
      const report: AdsSourceManifestsReport = {
        manifests,
        counts: {
          sources: manifests.length,
          available: manifests.filter((manifest) => manifest.accessState === "available").length,
          pendingAuthorization: manifests.filter(
            (manifest) => manifest.accessState === "pending-authorization",
          ).length,
          blocked: manifests.filter((manifest) => manifest.accessState === "blocked").length,
        },
      };
      const succeeded = expectTransitioned(
        transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
        "running -> succeeded",
      );
      return { job: succeeded, report };
    } catch (err) {
      throw manifestsJobFailure(this.deps, running, err);
    }
  }

  private cancelledDescriptor(running: JobDescriptor): JobDescriptor {
    return expectTransitioned(
      transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
      "running -> cancelled",
    );
  }
}

// ---------------------------------------------------------------------------
// Job-failure machinery
// ---------------------------------------------------------------------------

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection (the AdsReviewSignalsJobError pattern, verbatim).
 */
export class AdsSourceManifestsJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsSourceManifestsJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function manifestsJobFailure(
  deps: ReadTransparencySourceManifestsDeps,
  running: JobDescriptor,
  err: unknown,
): AdsSourceManifestsJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads source-manifests read error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: `the ads source-manifests read job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsSourceManifestsJobError({ job: { ...failed, lastError: described }, cause });
}

/** Unwraps a domain transition result (typed ads/source-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
