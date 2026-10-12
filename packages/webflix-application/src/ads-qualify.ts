/**
 * ads.qualify — the EXPLAINABLE QUALIFICATION use case (P5-QUALIFY scope
 * row 1), riding the frozen §2.6 JobDescriptor/JobState wrapper as a READ
 * job (the ads.reviewSignals precedent: nothing is stored, nothing is
 * mutated — qualification is recomputed from the CURRENT stored data every
 * run, which is the honest semantics for a display-standing read-out).
 * Takes ad-record ids, resolves each record's claims, stored
 * OfferVerifications (P5-VERIFY), and review-signal attachments, and runs
 * the DETERMINISTIC v1 policy (./ads-qualify-policy.ts — its FIXED POLICY
 * PARAMETERS are documented there as constants, the built-in-ranker house
 * style) producing per record a QualificationExplanation (the P5-CONTRACTS
 * shape: policyVersion + qualified + reasons[] with evidence pointers) and
 * the raw counted facts (AdQualificationFacts — the no-opaque-score other
 * half: the output IS the reasons list + the raw counted facts).
 *
 * Semantics, stated honestly:
 *
 * - PER-RECORD OUTCOMES, never batch-or-nothing: each record resolves ->
 *   counts -> explains atomically; an id with no stored record fails THAT
 *   record typed (ads/record-absent in the outcome — run ads.import first)
 *   and nothing else is affected. The report states the honest counts
 *   (explained / no-data / rejected, adding up to the batch total).
 * - THE HONEST NO-DATA OUTCOME: a record with NO stored claims has
 *   nothing to explain — the outcome is `no-data` with its statement, NOT
 *   an explanation. The 0.10.0 shape makes this structural:
 *   QualificationExplanation requires reasons.min(1) with evidence
 *   min(1) each, and there is NO honest evidence pointer for absence — a
 *   zero-dressed-as-signal explanation cannot even be constructed. Claims
 *   are the attachment substrate for verifications AND signals, so a
 *   claimless record has no data of any kind to count.
 * - EVERY MINTED EXPLANATION IS SCHEMA-VALIDATED before it is returned
 *   (parseOrThrow over QualificationExplanationSchema — the ads.verify
 *   discipline pattern: an invariant break is a typed internal failure,
 *   never a silently-mangled read-out).
 * - QUALIFICATION IS DISPLAY-STANDING: it explains an ad's standing in
 *   the AD CENTER view; it is NOT a promise of ad quality and NEVER feeds
 *   the organic ranking path (phase5-ad-plan §3 — the architecture rule
 *   pins the separation; this module is outside the ranking lane and
 *   imports nothing ranking).
 * - NO AGGREGATION OF REVIEW SIGNALS (rg-provable: no scoring, no
 *   averaging, no normalization vocabulary): per-source counts are facts,
 *   never merged ratings. The only counts are the facts' tallies and the
 *   report's row tallies.
 * - THE SOURCES NEVER MUTATED: the stored records, claims, verifications,
 *   edges, and signals are READ, never re-put (pinned by deep-equal
 *   tests). Nothing is stored — a re-run recomputes from current data.
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is read; MID-RUN a
 *   cooperative checkpoint runs BEFORE EACH RECORD (a record's read-out
 *   is never torn). A cancelled run returns report null.
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/record-invalid — the record-selector family code, the
 *   ads.reviewSignals precedent): a blank record id; a record id named
 *   twice (a batch that names one record twice would double-count it).
 * - INFRASTRUCTURE FAILURES (a store throwing mid-run) stamp the job
 *   FAILED and rethrow through AdsQualifyJobError (the cause's code
 *   intact).
 */
import {
  ErrorCode,
  JobDescriptorSchema,
  QualificationExplanationSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  AdRecord,
  Claim,
  JobDescriptor,
  OfferVerification,
  QualificationExplanation,
  ReviewSignal,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import { qualifyAdRecord } from "./ads-qualify-policy";
import type {
  AdQualificationFacts,
  AdsQualificationDanglingRef,
  AdsQualificationSignalRef,
} from "./ads-qualify-policy";
import type {
  AdRecordStore,
  ClaimStore,
  ClockPort,
  EvidenceEdgeStore,
  IdGenerator,
  OfferVerificationStore,
  ReviewSignalStore,
} from "./ports";

export const ADS_QUALIFY_JOB_KIND = "ads.qualify";
// (Same JobKind rule: the charter's ads.qualify use case rides the
// descriptor as the lowercase dot-dash kind.)

/** The seam's own identity (§2.6 job provenance) — the POLICY's version rides the explanation. */
export const ADS_QUALIFY_SEAM_ID = "webflix.ads-qualify";
export const ADS_QUALIFY_SEAM_VERSION = "1.0.0";

/**
 * The fixed no-data statement (never a zero-dressed-as-signal): names what
 * is absent and the honest path that produces data — a hint, not a
 * judgment.
 */
export const ADS_QUALIFY_NO_DATA_STATEMENT =
  "no stored claims for this record — no verification or review data to explain yet " +
  "(ads.import + ads.extractClaims + ads.linkEvidence + ads.verify produce the data)";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/**
 * The qualification request: the ad-record ids to qualify (unique,
 * non-blank — validated before the job exists). An empty batch is the
 * honest empty report.
 */
export interface QualifyAdsRecordsInput {
  /** The stored ad-record ids to qualify. */
  readonly adRecordIds: readonly string[];
  /** Honoured at the job boundary AND at the checkpoint before each record. */
  readonly signal?: AbortSignal;
}

/** A record that WAS explained: the QualificationExplanation + the raw counted facts. */
export interface AdsQualificationExplained {
  readonly outcome: "explained";
  /** The record's index within the requested batch. */
  readonly index: number;
  readonly adRecordId: string;
  /** The deterministic v1 policy's read-out (reasons[] with evidence pointers). */
  readonly explanation: QualificationExplanation;
  /** The raw counted facts the explanation rests on (the populations). */
  readonly facts: AdQualificationFacts;
}

/** The honest no-data outcome: a claimless record, stated — never a zero-dressed explanation. */
export interface AdsQualificationNoData {
  readonly outcome: "no-data";
  readonly index: number;
  readonly adRecordId: string;
  /** The fixed no-data statement (ADS_QUALIFY_NO_DATA_STATEMENT). */
  readonly statement: string;
}

/** A record id that failed honestly (not stored — absence, never invalidity). */
export interface AdsQualificationRejected {
  readonly outcome: "rejected";
  readonly index: number;
  readonly adRecordId: string;
  /** The typed ads/* code the record failed with. */
  readonly code: ErrorCode;
  readonly reason: string;
}

export type AdsQualificationItemOutcome =
  | AdsQualificationExplained
  | AdsQualificationNoData
  | AdsQualificationRejected;

/** The honest batch report: per-record outcomes + counts that add up. */
export interface AdsQualificationReport {
  readonly outcomes: readonly AdsQualificationItemOutcome[];
  readonly counts: {
    readonly explained: number;
    readonly noData: number;
    readonly rejected: number;
    readonly total: number;
  };
}

export interface QualifyAdsRecordsOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsQualificationReport | null;
}

export interface QualifyAdsRecordsDeps {
  readonly records: AdRecordStore;
  readonly claims: ClaimStore;
  readonly edges: EvidenceEdgeStore;
  readonly reviewSignals: ReviewSignalStore;
  readonly verifications: OfferVerificationStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.qualify — the deterministic explainable qualification READ job. */
export class QualifyAdsRecords {
  constructor(private readonly deps: QualifyAdsRecordsDeps) {}

  async execute(input: QualifyAdsRecordsInput): Promise<QualifyAdsRecordsOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    validateQualifyAdsRecordsInput(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_QUALIFY_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_QUALIFY_SEAM_ID,
          connectorVersion: ADS_QUALIFY_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          policyVersion: "v1",
          requestedAdRecordIdsCount: input.adRecordIds.length,
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

    // 3. Run: queued -> running; one cooperative checkpoint BEFORE EACH
    //    record (a record's read-out is never torn).
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const outcomes: AdsQualificationItemOutcome[] = [];
    let total = 0;
    try {
      total = input.adRecordIds.length;
      for (let index = 0; index < total; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await qualifyOneRecord(this.deps, input.adRecordIds[index]!, index));
      }
    } catch (err) {
      throw qualifyJobFailure(this.deps, running, err);
    }

    // 4. Assemble the honest report and self-check it (every record MUST
    //    have exactly one known outcome and the counts MUST add up).
    const explained = outcomes.filter(
      (outcome): outcome is AdsQualificationExplained => outcome.outcome === "explained",
    );
    const noData = outcomes.filter(
      (outcome): outcome is AdsQualificationNoData => outcome.outcome === "no-data",
    );
    if (
      outcomes.length !== total ||
      outcomes.some(
        (outcome) =>
          outcome.outcome !== "explained" &&
          outcome.outcome !== "no-data" &&
          outcome.outcome !== "rejected",
      )
    ) {
      throw qualifyJobFailure(
        this.deps,
        running,
        new WebFlixError({
          code: ErrorCode.AdsRecordInvalid,
          reason:
            `internal invariant break: ${outcomes.length} outcomes for ${total} records — ` +
            "the report refuses to miscount",
          retryable: false,
          context: { outcomes: outcomes.length, total },
        }),
      );
    }
    const report: AdsQualificationReport = {
      outcomes,
      counts: {
        explained: explained.length,
        noData: noData.length,
        rejected: total - explained.length - noData.length,
        total,
      },
    };

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, report };
  }

  /** The cooperative cancellation checkpoint (before EACH record). */
  private async cancelled(input: QualifyAdsRecordsInput): Promise<boolean> {
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
// Per-record step (resolve -> count -> explain -> validate)
// ---------------------------------------------------------------------------

/** Qualifies ONE record atomically, as typed data (a pure read — no writes). */
async function qualifyOneRecord(
  deps: QualifyAdsRecordsDeps,
  adRecordId: string,
  index: number,
): Promise<AdsQualificationItemOutcome> {
  // 1. The record must be stored (typed absent surfaces as a rejection —
  //    absence is the honest not-yet-imported state, never a failure).
  const record = await tryGetRecord(deps, adRecordId);
  if (record === undefined) {
    return {
      outcome: "rejected",
      index,
      adRecordId,
      code: ErrorCode.AdsRecordAbsent,
      reason: adsRecordAbsentReason(adRecordId),
    };
  }

  // 2. The record's claims — the attachment substrate for verifications
  //    AND signals: a claimless record has no data of any kind (the
  //    honest no-data outcome, never a zero-dressed explanation).
  const claims: readonly Claim[] = await deps.claims.listByAdRecordId(adRecordId);
  if (claims.length === 0) {
    return { outcome: "no-data", index, adRecordId, statement: ADS_QUALIFY_NO_DATA_STATEMENT };
  }

  // 3. Resolve each claim's verification history + the independent-review
  //    attachments (deterministic store orders throughout — the counts,
  //    the reasons, and their evidence pointers ride them).
  const verificationsByClaim = new Map<string, readonly OfferVerification[]>();
  const signals: AdsQualificationSignalRef[] = [];
  const danglingSignalRefs: AdsQualificationDanglingRef[] = [];
  for (const claim of claims) {
    verificationsByClaim.set(claim.id, await deps.verifications.listByClaim(claim.id));
    const edges = (await deps.edges.listByClaim(claim.id)).filter(
      (edge) => edge.kind === "independent-review",
    );
    for (const edge of edges) {
      const signal = await tryGetReviewSignal(deps, edge.reviewSignalId);
      if (signal === undefined) {
        danglingSignalRefs.push({
          claimId: claim.id,
          edgeId: edge.id,
          reviewSignalId: edge.reviewSignalId,
        });
        continue;
      }
      if (!signals.some((ref) => ref.signal.id === signal.id)) {
        signals.push({ signal, claimId: claim.id, edgeId: edge.id });
      }
    }
  }

  // 4. Run the deterministic v1 policy, then schema-validate the minted
  //    explanation (the ads.verify discipline pattern).
  const { explanation, facts } = qualifyAdRecord({
    claims,
    verificationsByClaim,
    signals,
    danglingSignalRefs,
  });
  parseOrThrow(
    QualificationExplanationSchema,
    explanation,
    ErrorCode.AdsRecordInvalid,
    "QualificationExplanation",
  );
  return { outcome: "explained", index, adRecordId, explanation, facts };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function adsRecordAbsentReason(adRecordId: string): string {
  return (
    `no stored Ad Center record for id "${adRecordId}" — qualification runs over IMPORTED records; ` +
    "run ads.import over the record first"
  );
}

/** Typed-absent-aware get: undefined when the id is not stored. */
async function tryGetRecord(
  deps: QualifyAdsRecordsDeps,
  id: string,
): Promise<AdRecord | undefined> {
  try {
    return await deps.records.get(id);
  } catch (err) {
    if (WebFlixError.is(err) && isAdsAbsentCode(err.code)) return undefined;
    throw err;
  }
}

/** Typed-absent-aware get: undefined when the id is not stored. */
async function tryGetReviewSignal(
  deps: QualifyAdsRecordsDeps,
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
 * Pre-job batch-shape validation (caller defects, typed ads/record-invalid,
 * thrown BEFORE the job exists): every record id non-blank, no id named
 * twice. An empty batch is NOT a defect (the honest empty report).
 */
export function validateQualifyAdsRecordsInput(input: QualifyAdsRecordsInput): void {
  if (input.adRecordIds === undefined || !Array.isArray(input.adRecordIds)) {
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason: "the qualification request must carry its ad-record ids as an array",
      retryable: false,
      context: { subject: "QualifyAdsRecordsInput.adRecordIds" },
    });
  }
  const seen = new Set<string>();
  for (const adRecordId of input.adRecordIds) {
    if (typeof adRecordId !== "string" || adRecordId.trim().length === 0) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: "every record id in a qualification batch must be a non-blank string",
        retryable: false,
        context: { subject: "QualifyAdsRecordsInput.adRecordIds" },
      });
    }
    if (seen.has(adRecordId)) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason:
          `the qualification batch names record id "${adRecordId}" twice — a batch that names ` +
          "one record twice would double-count it in the report",
        retryable: false,
        context: { subject: "QualifyAdsRecordsInput.adRecordIds", duplicateId: adRecordId },
      });
    }
    seen.add(adRecordId);
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
export class AdsQualifyJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsQualifyJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function qualifyJobFailure(
  deps: QualifyAdsRecordsDeps,
  running: JobDescriptor,
  err: unknown,
): AdsQualifyJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads qualify error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `the ads qualify job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsQualifyJobError({ job: { ...failed, lastError: described }, cause });
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
