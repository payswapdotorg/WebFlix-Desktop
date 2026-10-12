/**
 * ads.querySources — the transparency-source QUERY use case (P5-SOURCES
 * scope row 3), riding the frozen §2.6 JobDescriptor/JobState wrapper
 * (the ads.reviewSignals read-job precedent). Takes ONE source id + ONE
 * query and returns the typed honest state for that source: the result
 * IS the adapter's TransparencyQueryResult — the
 * unavailable/pending/blocked states are DATA, surfaced with their
 * honest reasons, never hidden and never thrown (the charter's
 * product-feature rule; the only rejections are CALLER DEFECTS, typed
 * ads/source-invalid, before the job exists).
 *
 * Semantics, stated honestly:
 *
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/source-invalid, never job failures): a blank source id; a query
 *   that fails the TransparencyQuery contract shape; a source id the
 *   registry does not know (the error names the registry's KNOWN ids —
 *   the honest recovery hint, never a bare "not found").
 * - THE STATE IS THE ANSWER: querying the blocked Google adapter
 *   SUCCEEDS with the blocked state + reason; querying a pending
 *   adapter SUCCEEDS with the pending state + reason naming the
 *   application path. A succeeded job carrying a non-ok state is the
 *   HONEST outcome — the Ad Center renders the state, it does not error
 *   on it.
 * - THE REPORT CARRIES THE CONTEXT: the source's manifest (the coverage
 *   declaration — coverage states ride WITH the access state) and the
 *   adapter version (the seam's own provenance) alongside the result.
 * - COUNTS are row tallies only: `observations` counts the ok result's
 *   observation rows (0 for every non-ok state — a count, never a
 *   fabricated completeness claim).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted
 *   signal transitions queued -> cancelled BEFORE the adapter is
 *   touched; MID-RUN the adapter honours the signal at its own boundary
 *   (the port contract) — an adapter rejection carrying common/cancelled
 *   transitions the job running -> cancelled (report null, the
 *   transcribe-media-file precedent; the honest-state adapters never
 *   reject this way, but the seam's cancellation contract is pinned by
 *   the labeled test double).
 * - INFRASTRUCTURE FAILURES (the adapter throwing a non-cancelled
 *   error) stamp the job FAILED and rethrow through
 *   AdsQuerySourcesJobError (the cause's code intact).
 * - NOTHING IS STORED, NOTHING MUTATED: a read over the registry (the
 *   deep-equal discipline is pinned by test on the caller's input).
 */
import {
  ErrorCode,
  JobDescriptorSchema,
  TransparencyQuerySchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  JobDescriptor,
  TransparencyQuery,
  TransparencyQueryResult,
  TransparencySourceManifest,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type { ClockPort, IdGenerator } from "./ports";
import type { TransparencySourceRegistry } from "./transparency-source-registry";

export const ADS_QUERY_SOURCES_JOB_KIND = "ads.query-sources";

/** The seam's own identity (§2.6 job provenance). */
export const ADS_QUERY_SOURCES_SEAM_ID = "webflix.ads-query-sources";
export const ADS_QUERY_SOURCES_SEAM_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** The query request: exactly ONE source id + ONE contract-shaped query. */
export interface QueryTransparencySourcesInput {
  /** The source id to query (a registry-known id — the manifest id space). */
  readonly sourceId: string;
  /** The query, in the TransparencyQuery contract shape. */
  readonly query: TransparencyQuery;
  /** Honoured at the job boundary AND passed through to the adapter's boundary. */
  readonly signal?: AbortSignal;
}

/**
 * The honest query report: the typed result (the STATE is the answer)
 * plus the context the Ad Center renders with it — the source's manifest
 * (coverage declaration) and the adapter version (seam provenance).
 */
export interface AdsQuerySourcesReport {
  /** Which source answered. */
  readonly source: string;
  /** The source's coverage + access declaration, as its own terms state it. */
  readonly manifest: TransparencySourceManifest;
  /** The adapter implementation's version (our code's). */
  readonly adapterVersion: string;
  /** The typed honest state — DATA, never a hidden failure. */
  readonly result: TransparencyQueryResult;
  /** Row tallies only: the ok result's observation count (0 for non-ok states). */
  readonly counts: {
    readonly observations: number;
  };
}

export interface QueryTransparencySourcesOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsQuerySourcesReport | null;
}

export interface QueryTransparencySourcesDeps {
  /** The source registry (the static default ships the three honest-state adapters). */
  readonly registry: TransparencySourceRegistry;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.querySources — one source, one query, the typed honest state back. */
export class QueryTransparencySources {
  constructor(private readonly deps: QueryTransparencySourcesDeps) {}

  async execute(input: QueryTransparencySourcesInput): Promise<QueryTransparencySourcesOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    validateQueryTransparencySourcesInput(input, this.deps.registry);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_QUERY_SOURCES_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_QUERY_SOURCES_SEAM_ID,
          connectorVersion: ADS_QUERY_SOURCES_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          sourceId: input.sourceId,
          searchTerms: input.query.searchTerms,
          ...(input.query.region !== undefined ? { region: input.query.region } : {}),
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsSourceInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, adapter never touched.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, report: null };
    }

    // 3. Run: queued -> running; one cooperative checkpoint, then the
    //    adapter call (the adapter honours the signal at ITS boundary —
    //    the port contract; a cancelled adapter rejection maps to the
    //    cancelled job, anything else to the failure machinery).
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const entry = this.deps.registry.get(input.sourceId)!; // validated above
    try {
      await Promise.resolve();
      if (input.signal?.aborted === true) {
        return { job: this.cancelledDescriptor(running), report: null };
      }
      let result: TransparencyQueryResult;
      try {
        result = await entry.adapter.query(input.query, { signal: input.signal });
      } catch (err) {
        // The adapter rejected: cancelled is the cooperative stop (the
        // port contract); anything else is an infrastructure failure.
        if (WebFlixError.is(err) && err.code === ErrorCode.Cancelled) {
          const cancelled = expectTransitioned(
            transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
            "running -> cancelled",
          );
          return { job: { ...cancelled, lastError: `cancelled: ${err.reason}` }, report: null };
        }
        throw err;
      }

      // 4. Assemble the honest report: the state IS the answer, the
      //    manifest + adapter version ride along as context.
      const report: AdsQuerySourcesReport = {
        source: input.sourceId,
        manifest: entry.manifest,
        adapterVersion: entry.adapter.descriptor.version,
        result,
        counts: {
          observations: result.status === "ok" ? result.observations.length : 0,
        },
      };
      const succeeded = expectTransitioned(
        transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
        "running -> succeeded",
      );
      return { job: succeeded, report };
    } catch (err) {
      throw queryJobFailure(this.deps, running, err);
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
// Input validation (caller defects — typed ads/source-invalid)
// ---------------------------------------------------------------------------

/**
 * Pre-job input validation: the source id is non-blank and
 * registry-known (the error names the KNOWN ids — the honest recovery
 * hint), and the query satisfies the TransparencyQuery contract shape.
 */
export function validateQueryTransparencySourcesInput(
  input: QueryTransparencySourcesInput,
  registry: TransparencySourceRegistry,
): void {
  if (typeof input.sourceId !== "string" || input.sourceId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "the source query must name a non-blank source id",
      retryable: false,
      context: { subject: "QueryTransparencySourcesInput.sourceId" },
    });
  }
  const known = registry.list().map((entry) => entry.manifest.source);
  if (!known.includes(input.sourceId)) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason:
        `unknown transparency source id "${input.sourceId}" — the registry knows: ` +
        `${known.join(", ")}`,
      retryable: false,
      context: { subject: "QueryTransparencySourcesInput.sourceId", known },
    });
  }
  const query = TransparencyQuerySchema.safeParse(input.query);
  if (!query.success) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason:
        "the source query's query fails the TransparencyQuery contract shape: " +
        query.error.issues.map((issue) => issue.message).join("; "),
      retryable: false,
      context: { subject: "QueryTransparencySourcesInput.query" },
    });
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
export class AdsQuerySourcesJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsQuerySourcesJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function queryJobFailure(
  deps: QueryTransparencySourcesDeps,
  running: JobDescriptor,
  err: unknown,
): AdsQuerySourcesJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads source query error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: `the ads source-query job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsQuerySourcesJobError({ job: { ...failed, lastError: described }, cause });
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
