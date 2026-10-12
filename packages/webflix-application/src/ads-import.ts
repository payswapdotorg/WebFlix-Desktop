/**
 * ads.import — the Ad Center IMPORT SEAM (P5-STORES row 3, Phase-5 row 2),
 * riding the frozen §2.6 JobDescriptor/JobState wrapper (the mi-evaluate
 * precedent: MI/ads jobs RIDE §2.6, never re-invent it). The pure decision
 * core lives in ./ads-import-rules.ts (the evaluation-replay precedent:
 * rules as data, no I/O); this module is the job wrapper + the store
 * orchestration.
 *
 * THE HONEST PATH ad data enters the system until transparency connectors
 * are authorized (P5-SOURCES): the batch arrives as DATA — ad records +
 * advertiser identities + claims AS EXTRACTED SPANS + optional review
 * signals, all in the 0.8.0 contract shapes with their provenance. This
 * seam does NOT extract claims (P5-CLAIMS builds the engine ON these
 * stores), does NOT verify offers (P5-VERIFY), does NOT touch any network
 * (no connector exists), and aggregates NOTHING.
 *
 * Semantics, stated honestly:
 *
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/record-invalid, never job failures): a blank importBatchId;
 *   duplicate ids within any one batch array; a record or review signal
 *   whose own provenance.importBatchId does not match the batch's (every
 *   import — one batch id). The rules module throws these.
 * - PER-RECORD OUTCOMES, never batch-or-nothing: each item is validated
 *   and persisted atomically-per-record — a bad item fails THAT item
 *   typed (the ads/* code carried in the outcome) and the batch REPORT
 *   states the honest counts: accepted / rejected-with-reason. A claim
 *   whose record was rejected in this same batch fails referentially
 *   (the record was never stored) — the honest cascade, item by item.
 * - NO SILENT MERGES, NO DEDUP MAGIC: the record version decision is the
 *   PURE rule decideRecordImport (same source id + same batch = replace,
 *   superseded ids deleted EXPLICITLY through the store; different batch
 *   = a NEW version appended; an id naming another batch's record or
 *   another ad = rejected — history is never silently overwritten).
 * - SEAM-LEVEL REFERENTIAL CHECKS (mirroring the domain invariant style,
 *   stated as data in the outcomes): a record's advertiserIdentityId must
 *   resolve (batch identities already processed + stored ones); a claim's
 *   adRecordId must resolve to a STORED record (this batch's accepted
 *   records are already stored when claims process). The EXTRACTIVE
 *   discipline itself is the domain invariant validateClaimOffsets —
 *   offsets within the referenced record's creative text, quote
 *   byte-equal to the offset window — run HERE, before persisting.
 * - ID STABILITY: an identity id never migrates between sources, and a
 *   claim id never re-points at a different record — re-puts that try
 *   are rejected typed (the same never-silently-overwrite rule).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *     transitions queued -> cancelled BEFORE anything is stored; MID-RUN
 *     there is a cooperative checkpoint BEFORE EACH ITEM (a deterministic
 *     microtask yield + signal re-read — the mi-evaluate precedent). A
 *     cancelled run returns report null (no partial report is surfaced as
 *     if complete); items already persisted STAY persisted — persistence
 *     is atomic PER RECORD, and re-running the same batch is idempotent
 *     (the replace rule), which is the documented recovery.
 * - INFRASTRUCTURE FAILURES (a store throwing a non-ads error mid-batch)
 *     stamp the job FAILED and rethrow through AdsImportJobError (the
 *     cause's code intact); validation REJECTIONS are never failures —
 *     they are the report's data.
 * - ORIGINALS UNTOUCHED: the caller's batch arrays are read, never
 *     mutated (pinned by a deep-equal test); the only stamps are the
 *     injected clock's instants on the job descriptor.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type {
  AdRecord,
  AdvertiserIdentity,
  Claim,
  JobDescriptor,
  ReviewSignal,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type {
  AdRecordStore,
  AdvertiserIdentityStore,
  ClaimStore,
  ClockPort,
  IdGenerator,
  ReviewSignalStore,
} from "./ports";
import { validateAdsImportBatch } from "./ads-import-rules";
import type { AdsImportItemOutcome, AdsImportReport } from "./ads-import-rules";
import {
  importAdsClaim,
  importAdsIdentity,
  importAdsRecord,
  importAdsReviewSignal,
} from "./ads-import-items";

export const ADS_IMPORT_JOB_KIND = "ads.import";

/** The seam's own identity (§2.6 job provenance). */
export const ADS_IMPORT_SEAM_ID = "webflix.ads-import";
export const ADS_IMPORT_SEAM_VERSION = "1.0.0";

// The pure rules + report types are the module's public surface too (the
// evaluation-replay precedent: one import site for every consumer).
export type {
  AdsImportAccepted,
  AdsImportDisposition,
  AdsImportItemKind,
  AdsImportItemOutcome,
  AdsImportRejected,
  AdsImportReport,
  RecordImportDecision,
} from "./ads-import-rules";
export { decideRecordImport, validateAdsImportBatch } from "./ads-import-rules";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** The import batch: every item in its 0.8.0 contract shape. */
export interface ImportAdsInput {
  /** The batch id every record's and signal's provenance must carry. */
  readonly importBatchId: string;
  readonly identities: readonly AdvertiserIdentity[];
  readonly records: readonly AdRecord[];
  /** Claims AS DATA — extracted spans with their offsets (P5-CLAIMS extracts). */
  readonly claims: readonly Claim[];
  /** Optional as-reported review signals (never aggregated). */
  readonly reviewSignals?: readonly ReviewSignal[];
  /** Honoured at the job boundary AND at the checkpoint before each item. */
  readonly signal?: AbortSignal;
}

export interface ImportAdsOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The batch report on success; null on cancellation AND failure. */
  readonly report: AdsImportReport | null;
}

export interface ImportAdsDeps {
  readonly identities: AdvertiserIdentityStore;
  readonly records: AdRecordStore;
  readonly claims: ClaimStore;
  readonly reviewSignals: ReviewSignalStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.import — the honest interim path ad data enters the Ad Center. */
export class ImportAds {
  constructor(private readonly deps: ImportAdsDeps) {}

  async execute(input: ImportAdsInput): Promise<ImportAdsOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    const batchId = validateAdsImportBatch(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_IMPORT_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_IMPORT_SEAM_ID,
          connectorVersion: ADS_IMPORT_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          importBatchId: batchId,
          identitiesCount: input.identities.length,
          recordsCount: input.records.length,
          claimsCount: input.claims.length,
          ...(input.reviewSignals !== undefined
            ? { reviewSignalsCount: input.reviewSignals.length }
            : {}),
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsRecordInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, nothing stored.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, report: null };
    }

    // 3. Run: queued -> running; process identities -> records -> claims ->
    //    review signals, a cooperative checkpoint BEFORE EACH ITEM.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const outcomes: AdsImportItemOutcome[] = [];
    try {
      for (let index = 0; index < input.identities.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await importAdsIdentity(this.deps, input.identities[index]!, index));
      }
      for (let index = 0; index < input.records.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await importAdsRecord(this.deps, input.records[index]!, index, batchId));
      }
      for (let index = 0; index < input.claims.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await importAdsClaim(this.deps, input.claims[index]!, index));
      }
      const signals = input.reviewSignals ?? [];
      for (let index = 0; index < signals.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await importAdsReviewSignal(this.deps, signals[index]!, index, batchId));
      }
    } catch (err) {
      throw importJobFailure(this.deps, running, err);
    }

    // 4. Assemble the honest report and self-check it (every item MUST have
    //    exactly one outcome and the counts MUST add up — an internal break
    //    is a job failure, never a silently-miscounted report).
    const total =
      input.identities.length +
      input.records.length +
      input.claims.length +
      (input.reviewSignals ?? []).length;
    const accepted = outcomes.filter((outcome) => outcome.outcome === "accepted").length;
    const rejectedCount = outcomes.length - accepted;
    if (
      outcomes.length !== total ||
      outcomes.some((outcome) => outcome.outcome !== "accepted" && outcome.outcome !== "rejected")
    ) {
      throw importJobFailure(
        this.deps,
        running,
        new WebFlixError({
          code: ErrorCode.AdsRecordInvalid,
          reason:
            `internal invariant break: ${outcomes.length} outcomes for ${total} items — ` +
            "the report refuses to miscount",
          retryable: false,
          context: { outcomes: outcomes.length, total },
        }),
      );
    }
    const report: AdsImportReport = {
      importBatchId: batchId,
      outcomes,
      counts: { accepted, rejected: rejectedCount, total },
    };

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, report };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** The cooperative cancellation checkpoint (before EACH item). */
  private async cancelled(input: ImportAdsInput): Promise<boolean> {
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
// Job-failure machinery
// ---------------------------------------------------------------------------

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection. `code` mirrors the cause's so generic handlers see the honest
 * code without unwrapping (the EvaluationJobError pattern, verbatim).
 */
export class AdsImportJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsImportJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function importJobFailure(
  deps: ImportAdsDeps,
  running: JobDescriptor,
  err: unknown,
): AdsImportJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads import error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `the ads import seam reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsImportJobError({
    job: { ...failed, lastError: described },
    cause,
  });
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
