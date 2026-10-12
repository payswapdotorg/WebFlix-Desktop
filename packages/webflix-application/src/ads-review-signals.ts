/**
 * ads.reviewSignals — the AS-REPORTED review-signal reading use case
 * (P5-VERIFY scope row 3), riding the frozen §2.6 JobDescriptor/JobState
 * wrapper as a READ job (the ads.verify precedent). Lists the stored
 * independent-review signals for one advertiser or one ad — resolved
 * through the evidence graph (the ad's claims -> their independent-review
 * evidence edges -> the referenced signals) — carrying each signal's own
 * vocabulary VERBATIM with its full import provenance (source + as-of).
 *
 * NO AGGREGATION, rg-provable (the charter's honest non-goal, the
 * roadmap's "independent" = per-source independence, preserved by never
 * merging): the report carries ONE ROW PER SIGNAL — two sources' ratings
 * are two rows, never merged into one number; there is NO scoring, NO
 * normalization across sources, NO averaging, NO word-list re-interpretation
 * of any source's vocabulary, and NO cross-source arithmetic anywhere in
 * this module. The only counts in the report are ROW tallies (how many
 * signal rows, how many dangling edge references) — the honest §2.6
 * report-count pattern, never a statistic over the signals' contents.
 *
 * Resolution, stated honestly:
 * - THE AD SELECTOR (`adRecordId`): the claim store's `listByAdRecordId`
 *   is the surface — the record's claims' independent-review edges name
 *   the signals. An unknown record id and a record with no claims BOTH
 *   yield the honest empty report (no invented distinction).
 * - THE ADVERTISER SELECTOR (`advertiserIdentityId`): every stored record
 *   of that advertiser (records.list(), filtered by advertiser identity)
 *   -> the same claim -> edge -> signal path. An unknown advertiser id
 *   yields the honest empty report.
 * - ONE ROW PER SIGNAL, deduplicated BY SIGNAL ID: the same signal
 *   attached to two claims of the same ad is ONE row (one source, one
 *   report) carrying BOTH attachments; two DIFFERENT sources are always
 *   two rows. The row carries the signal VERBATIM (byte-equal to the
 *   stored shape — pinned by a deep-equal test) plus its attachments
 *   (claim id + edge id + declared relationship: the honest WHY-IS-THIS-
 *   HERE provenance of the resolution path, not a judgment).
 * - DANGLING EDGE REFERENCES surface as DATA: an edge whose review signal
 *   no longer resolves among the stored signals (impossible through
 *   ads.linkEvidence's validation, possible only through a torn store)
 *   is listed in the report's `unresolved` entries — never a failure,
 *   never silently dropped.
 * - ORDER is deterministic: the stores' (stored_at, id) claim/edge order,
 *   first attachment first — byte-identical listings across runs over the
 *   same store state.
 *
 * A READ JOB: nothing is stored, nothing is mutated (deep-equal pinned).
 * CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 * transitions queued -> cancelled before anything is read; MID-RUN a
 * cooperative checkpoint runs BEFORE EACH CLAIM's edge resolution.
 * CALLER DEFECTS (both selectors, neither, a blank id) are typed
 * ads/record-invalid errors thrown BEFORE the job exists (the
 * review-signal family's invalid code). INFRASTRUCTURE FAILURES stamp the
 * job FAILED and rethrow through AdsReviewSignalsJobError.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type { AdRecord, JobDescriptor, ReviewSignal } from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type {
  AdRecordStore,
  ClaimStore,
  ClockPort,
  EvidenceEdgeStore,
  IdGenerator,
  ReviewSignalStore,
} from "./ports";

export const ADS_REVIEW_SIGNALS_JOB_KIND = "ads.review-signals";
// (Same JobKind rule: the charter's ads.reviewSignals use case rides the
// descriptor as the lowercase dot-dash kind.)

/** The seam's own identity (§2.6 job provenance). */
export const ADS_REVIEW_SIGNALS_SEAM_ID = "webflix.ads-review-signals";
export const ADS_REVIEW_SIGNALS_SEAM_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/**
 * The read request: exactly ONE selector — the advertiser identity whose
 * ads' review signals to list, or one ad-record id. Both or neither is a
 * caller defect, typed, thrown BEFORE the job exists.
 */
export interface ReadAdsReviewSignalsInput {
  /** The advertiser identity id: list the signals of its ads' claims. */
  readonly advertiserIdentityId?: string;
  /** One ad-record id: list the signals attached to that record's claims. */
  readonly adRecordId?: string;
  /** Honoured at the job boundary AND at the checkpoint before each claim. */
  readonly signal?: AbortSignal;
}

/**
 * ONE as-reported row: the signal VERBATIM (the stored shape, byte-equal)
 * plus the attachments that resolved it into this listing — the claim id,
 * the evidence edge id, and the edge's declared relationship (the
 * resolution path's own provenance, never a judgment about the signal).
 */
export interface AdsReviewSignalRow {
  readonly signal: ReviewSignal;
  readonly attachments: readonly {
    readonly claimId: string;
    readonly edgeId: string;
    readonly relationship: string;
  }[];
}

/** A dangling independent-review edge reference, surfaced as data. */
export interface AdsReviewSignalUnresolved {
  readonly claimId: string;
  readonly edgeId: string;
  readonly reviewSignalId: string;
}

/** The honest as-reported report: one row per signal + the dangling refs. */
export interface AdsReviewSignalsReport {
  readonly rows: readonly AdsReviewSignalRow[];
  readonly unresolved: readonly AdsReviewSignalUnresolved[];
  readonly counts: {
    /** How many signal rows (one per distinct signal — never merged). */
    readonly signals: number;
    /** How many dangling edge references (surfaced, never dropped). */
    readonly unresolved: number;
  };
}

export interface ReadAdsReviewSignalsOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsReviewSignalsReport | null;
}

export interface ReadAdsReviewSignalsDeps {
  readonly records: AdRecordStore;
  readonly claims: ClaimStore;
  readonly edges: EvidenceEdgeStore;
  readonly reviewSignals: ReviewSignalStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.reviewSignals — the as-reported, no-aggregation reading path. */
export class ReadAdsReviewSignals {
  constructor(private readonly deps: ReadAdsReviewSignalsDeps) {}

  async execute(input: ReadAdsReviewSignalsInput): Promise<ReadAdsReviewSignalsOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    validateReadAdsReviewSignalsInput(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";
    const selector =
      input.adRecordId !== undefined
        ? { kind: "ad-record-id", id: input.adRecordId }
        : { kind: "advertiser-identity-id", id: input.advertiserIdentityId! };

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_REVIEW_SIGNALS_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_REVIEW_SIGNALS_SEAM_ID,
          connectorVersion: ADS_REVIEW_SIGNALS_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          selectorKind: selector.kind,
          selectorId: selector.id,
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsRecordInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, nothing read.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, report: null };
    }

    // 3. Run: queued -> running; resolve the claim batch, then one
    //    cooperative checkpoint BEFORE EACH claim's edge resolution.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    try {
      const claims = await resolveClaims(this.deps, input);
      const collected = new Map<
        string,
        {
          signal: ReviewSignal;
          attachments: { claimId: string; edgeId: string; relationship: string }[];
        }
      >();
      const unresolved: AdsReviewSignalUnresolved[] = [];
      for (const claim of claims) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        const edges = (await this.deps.edges.listByClaim(claim.id)).filter(
          (edge) => edge.kind === "independent-review",
        );
        for (const edge of edges) {
          const signal = await tryGetReviewSignal(this.deps, edge.reviewSignalId);
          if (signal === undefined) {
            unresolved.push({
              claimId: claim.id,
              edgeId: edge.id,
              reviewSignalId: edge.reviewSignalId,
            });
            continue;
          }
          const existing = collected.get(signal.id);
          const attachment = {
            claimId: claim.id,
            edgeId: edge.id,
            relationship: edge.relationship,
          };
          if (existing !== undefined) {
            existing.attachments.push(attachment);
          } else {
            collected.set(signal.id, { signal, attachments: [attachment] });
          }
        }
      }

      // 4. Assemble the honest as-reported report (one row per signal,
      //    first-attachment order — the deterministic resolution order).
      const rows: AdsReviewSignalRow[] = [...collected.values()].map((entry) => ({
        signal: entry.signal,
        attachments: [...entry.attachments],
      }));
      const report: AdsReviewSignalsReport = {
        rows,
        unresolved,
        counts: { signals: rows.length, unresolved: unresolved.length },
      };
      const succeeded = expectTransitioned(
        transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
        "running -> succeeded",
      );
      return { job: succeeded, report };
    } catch (err) {
      throw readJobFailure(this.deps, running, err);
    }
  }

  /** The cooperative cancellation checkpoint (before EACH claim). */
  private async cancelled(input: ReadAdsReviewSignalsInput): Promise<boolean> {
    await Promise.resolve();
    return input.signal?.aborted === true;
  }

  private cancelledDescriptor(running: JobDescriptor): JobDescriptor {
    return expectTransitioned(
      transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
      "running -> cancelled",
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the claims the selector covers (deterministic order): the ad
 * record's claims, or every stored record of the advertiser -> their
 * claims. Unknown ids honestly resolve to NO claims (the empty report).
 */
async function resolveClaims(
  deps: ReadAdsReviewSignalsDeps,
  input: ReadAdsReviewSignalsInput,
): Promise<readonly { id: string }[]> {
  if (input.adRecordId !== undefined) {
    return deps.claims.listByAdRecordId(input.adRecordId);
  }
  const advertiserRecords: readonly AdRecord[] = (await deps.records.list()).filter(
    (record) => record.advertiserIdentityId === input.advertiserIdentityId,
  );
  const claims: { id: string }[] = [];
  for (const record of advertiserRecords) {
    const recordClaims = await deps.claims.listByAdRecordId(record.id);
    claims.push(...recordClaims);
  }
  return claims;
}

/** Typed-absent-aware get: undefined when the id is not stored. */
async function tryGetReviewSignal(
  deps: ReadAdsReviewSignalsDeps,
  id: string,
): Promise<ReviewSignal | undefined> {
  try {
    return await deps.reviewSignals.get(id);
  } catch (err) {
    if (WebFlixError.is(err) && isAdsAbsentCode(err.code)) return undefined;
    throw err;
  }
}

/** True for the ads/*-absent codes (the typed-absent family). */
function isAdsAbsentCode(code: ErrorCode): boolean {
  return (
    code === ErrorCode.AdsIdentityAbsent ||
    code === ErrorCode.AdsRecordAbsent ||
    code === ErrorCode.AdsClaimAbsent ||
    code === ErrorCode.AdsEvidenceAbsent ||
    code === ErrorCode.AdsReviewSignalAbsent ||
    code === ErrorCode.AdsVerificationAbsent
  );
}

/**
 * Pre-job input validation (caller defects, typed ads/record-invalid — the
 * review-signal family's invalid code — thrown BEFORE the job exists):
 * exactly ONE selector, every id non-blank.
 */
export function validateReadAdsReviewSignalsInput(input: ReadAdsReviewSignalsInput): void {
  const hasAdvertiser = input.advertiserIdentityId !== undefined;
  const hasRecord = input.adRecordId !== undefined;
  if (hasAdvertiser && hasRecord) {
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason:
        "the review-signal request names BOTH an advertiser identity id and an ad-record id — " +
        "exactly one selector; split them into two reads",
      retryable: false,
      context: { subject: "ReadAdsReviewSignalsInput" },
    });
  }
  if (!hasAdvertiser && !hasRecord) {
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason:
        "the review-signal request names NEITHER an advertiser identity id nor an ad-record id — " +
        "exactly one selector",
      retryable: false,
      context: { subject: "ReadAdsReviewSignalsInput" },
    });
  }
  for (const [name, id] of [
    ["advertiserIdentityId", input.advertiserIdentityId],
    ["adRecordId", input.adRecordId],
  ] as const) {
    if (id !== undefined && (typeof id !== "string" || id.trim().length === 0)) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `the ${name} selector must be a non-blank string`,
        retryable: false,
        context: { subject: `ReadAdsReviewSignalsInput.${name}` },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Job-failure machinery
// ---------------------------------------------------------------------------

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection (the AdsImportJobError pattern, verbatim).
 */
export class AdsReviewSignalsJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsReviewSignalsJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function readJobFailure(
  deps: ReadAdsReviewSignalsDeps,
  running: JobDescriptor,
  err: unknown,
): AdsReviewSignalsJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads review signals read error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `the ads review-signals read job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsReviewSignalsJobError({ job: { ...failed, lastError: described }, cause });
}

/** Unwraps a domain transition result (typed ads/record-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
