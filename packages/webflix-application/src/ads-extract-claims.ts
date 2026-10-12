/**
 * ads.extractClaims — the deterministic claim-EXTRACTION use case (P5-CLAIMS
 * scope row 2), riding the frozen §2.6 JobDescriptor/JobState wrapper (the
 * ads.import / mi-evaluate precedent: ads jobs RIDE §2.6, never re-invent
 * it). Reads the STORED ad records by id batch, runs the injected
 * AdsClaimExtractor over each record's creative text, re-validates every
 * produced claim through the domain invariant `validateClaimOffsets` (the
 * extractive discipline — offsets within the source text, quote byte-equal
 * to the offset window), and persists through the P5-STORES claim store.
 *
 * Semantics, stated honestly:
 *
 * - THE VERSION RULE (the charter, made literal through the store's
 *   put-replaces semantics): the extractor's identity/version ride the
 *   minted claim ids (the Claim shape itself carries no provenance —
 *   0.9.0) and the §2.6 job provenance (connectorId/connectorVersion).
 *   SAME extractor version + same record => the same claim ids => an
 *   idempotent put-replace (a re-run leaves the store byte-identical);
 *   a DIFFERENT extractor version => different ids => a NEW provenance
 *   append — prior claims stay untouched (history is never silently
 *   overwritten). Claims whose ids this run does not re-produce (their
 *   sentence no longer matches after a record replacement) also stay:
 *   the claim store has no delete, and an honest claim outlives the text
 *   it was cut from (the 0004/0005 keyed-stores rule).
 * - PER-RECORD OUTCOMES, never batch-or-nothing: each record is read ->
 *   extracted -> validated -> persisted atomically-per-record; a record
 *   whose extraction violates the discipline fails THAT record typed
 *   (the ads/* code in the outcome) and NOTHING from it is stored. The
 *   report states the honest counts (extracted / rejected / claims).
 * - THE SOURCE RECORD IS NEVER MUTATED: records are read through the
 *   store's get and never re-put by this use case (pinned by a
 *   deep-equal test).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is stored; MID-RUN a
 *   cooperative checkpoint runs BEFORE EACH RECORD (a deterministic
 *   microtask yield + signal re-read — the charter's granularity:
 *   cancellable between records, so a record's claims are never torn).
 *   A cancelled run returns report null; records already completed stay
 *   persisted (per-record atomicity), and re-running is idempotent — the
 *   documented recovery.
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/claim-invalid, never job failures): a blank record id; duplicate
 *   record ids within the batch (a batch that names one record twice is
 *   ambiguous — the same record would double-count in the report).
 * - INFRASTRUCTURE FAILURES (a store or the extractor throwing mid-run)
 *   stamp the job FAILED and rethrow through AdsExtractClaimsJobError
 *   (the cause's code intact); validation REJECTIONS are never failures —
 *   they are the report's data.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type { AdRecord, Claim, JobDescriptor } from "webflix-contracts";
import { parseOrThrow, transitionJob, validateClaimOffsets } from "webflix-domain";
import type { AdRecordStore, AdsClaimExtractor, ClaimStore, ClockPort, IdGenerator } from "./ports";

export const ADS_EXTRACT_CLAIMS_JOB_KIND = "ads.extract-claims";
// (The §2.6 JobKind regex is lowercase dot-dash — `ads.extract-claims` is
// the descriptor's routing kind for the use case the charter names
// ads.extractClaims.)

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/** The extraction request: the stored ad records to extract claims from. */
export interface ExtractAdsClaimsInput {
  /** The stored ad record ids to process (unique, non-blank — validated). */
  readonly recordIds: readonly string[];
  /** Honoured at the job boundary AND at the checkpoint before each record. */
  readonly signal?: AbortSignal;
}

/**
 * The honest disposition of one record's persisted claims: all minted ids
 * were new ("inserted"), all were already stored ("replaced" — the
 * idempotent same-version re-run), some were new ("mixed" — the record's
 * text changed between runs), or the extractor found no claims at all
 * ("empty" — honest no-match, nothing stored).
 */
export type AdsClaimExtractionDisposition = "inserted" | "replaced" | "mixed" | "empty";

export interface AdsClaimExtractionAccepted {
  readonly outcome: "extracted";
  /** The record's index within the requested batch. */
  readonly index: number;
  readonly recordId: string;
  readonly disposition: AdsClaimExtractionDisposition;
  /** The minted claim ids, in extraction (sentence) order. */
  readonly claimIds: readonly string[];
  readonly claimCount: number;
  /** Claims the record already carried before this run (any extractor). */
  readonly priorClaimCount: number;
}

export interface AdsClaimExtractionRejected {
  readonly outcome: "rejected";
  readonly index: number;
  readonly recordId: string;
  /** The typed ads/* code the record failed with. */
  readonly code: ErrorCode;
  readonly reason: string;
}

export type AdsClaimExtractionItemOutcome = AdsClaimExtractionAccepted | AdsClaimExtractionRejected;

/** The honest batch report: per-record outcomes + counts that add up. */
export interface AdsClaimExtractionReport {
  readonly outcomes: readonly AdsClaimExtractionItemOutcome[];
  readonly counts: {
    readonly extracted: number;
    readonly rejected: number;
    readonly total: number;
    /** The claims this run persisted (sum of the extracted claimCounts). */
    readonly claims: number;
  };
}

export interface ExtractAdsClaimsOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsClaimExtractionReport | null;
}

export interface ExtractAdsClaimsDeps {
  readonly records: AdRecordStore;
  readonly claims: ClaimStore;
  readonly extractor: AdsClaimExtractor;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.extractClaims — the deterministic extractive engine's §2.6 ride. */
export class ExtractAdsClaims {
  constructor(private readonly deps: ExtractAdsClaimsDeps) {}

  async execute(input: ExtractAdsClaimsInput): Promise<ExtractAdsClaimsOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    validateExtractAdsClaimsInput(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_EXTRACT_CLAIMS_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          // THE EXTRACTOR'S identity/version ride the job provenance — every
          // extraction run states WHICH extractor produced its claims.
          connectorId: this.deps.extractor.id,
          connectorVersion: this.deps.extractor.version,
          generatedAt: createdAt,
        },
        payload: {
          extractorId: this.deps.extractor.id,
          extractorVersion: this.deps.extractor.version,
          recordIdsCount: input.recordIds.length,
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsClaimInvalid,
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

    // 3. Run: queued -> running; one cooperative checkpoint BEFORE EACH record.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const outcomes: AdsClaimExtractionItemOutcome[] = [];
    try {
      for (let index = 0; index < input.recordIds.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await extractClaimsForRecord(this.deps, input.recordIds[index]!, index));
      }
    } catch (err) {
      throw extractJobFailure(this.deps, running, err);
    }

    // 4. Assemble the honest report and self-check it (every record MUST
    //    have exactly one outcome and the counts MUST add up).
    const total = input.recordIds.length;
    const extracted = outcomes.filter((outcome) => outcome.outcome === "extracted");
    const claims = extracted.reduce((sum, outcome) => sum + outcome.claimCount, 0);
    if (
      outcomes.length !== total ||
      outcomes.some((outcome) => outcome.outcome !== "extracted" && outcome.outcome !== "rejected")
    ) {
      throw extractJobFailure(
        this.deps,
        running,
        new WebFlixError({
          code: ErrorCode.AdsClaimInvalid,
          reason:
            `internal invariant break: ${outcomes.length} outcomes for ${total} records — ` +
            "the report refuses to miscount",
          retryable: false,
          context: { outcomes: outcomes.length, total },
        }),
      );
    }
    const report: AdsClaimExtractionReport = {
      outcomes,
      counts: { extracted: extracted.length, rejected: total - extracted.length, total, claims },
    };

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, report };
  }

  /** The cooperative cancellation checkpoint (before EACH record). */
  private async cancelled(input: ExtractAdsClaimsInput): Promise<boolean> {
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
// Per-record step (validate -> extract -> discipline -> persist)
// ---------------------------------------------------------------------------

/** Extracts + persists ONE record's claims atomically, as typed data. */
async function extractClaimsForRecord(
  deps: ExtractAdsClaimsDeps,
  recordId: string,
  index: number,
): Promise<AdsClaimExtractionItemOutcome> {
  // 1. The record must be stored (typed absent surfaces as a rejection —
  //    absence is the honest pre-import state, never a failure).
  const record = await tryGetRecord(deps, recordId);
  if (record === undefined) {
    return rejectedRecord(
      index,
      recordId,
      ErrorCode.AdsRecordAbsent,
      adsRecordAbsentReason(recordId),
    );
  }

  // 2. Pure extraction (the engine may honestly find nothing).
  const priorClaimCount = (await deps.claims.listByAdRecordId(record.id)).length;
  const extracted: readonly Claim[] = deps.extractor.extract(record);

  // 3. Engine-honesty checks, per record: no duplicate minted ids (no
  //    silent merges), and every claim passes the EXTRACTIVE discipline
  //    through the domain invariant before anything is persisted.
  const seenIds = new Set<string>();
  for (const claim of extracted) {
    if (seenIds.has(claim.id)) {
      return rejectedRecord(
        index,
        record.id,
        ErrorCode.AdsClaimInvalid,
        `the extractor "${deps.extractor.id}" v${deps.extractor.version} minted duplicate claim id ` +
          `"${claim.id}" for record "${record.id}" — no silent merge of distinct spans`,
      );
    }
    seenIds.add(claim.id);
    const violations = validateClaimOffsets(claim, record);
    if (violations.length > 0) {
      const violation = violations[0]!;
      return rejectedRecord(
        index,
        record.id,
        ErrorCode.AdsClaimInvalid,
        `the extractor "${deps.extractor.id}" v${deps.extractor.version} produced a claim that ` +
          `violates the extractive discipline (${violation.code}): ${violation.message}`,
      );
    }
  }

  // 4. Persist through the put-replaces claim store; the disposition
  //    states honestly what the run did to the store.
  const storedBefore: boolean[] = [];
  for (const claim of extracted) {
    storedBefore.push((await tryGetClaim(deps, claim.id)) !== undefined);
  }
  for (const claim of extracted) {
    await deps.claims.put(claim);
  }
  const disposition: AdsClaimExtractionDisposition =
    extracted.length === 0
      ? "empty"
      : storedBefore.every((existed) => existed)
        ? "replaced"
        : storedBefore.some((existed) => existed)
          ? "mixed"
          : "inserted";
  return {
    outcome: "extracted",
    index,
    recordId: record.id,
    disposition,
    claimIds: extracted.map((claim) => claim.id),
    claimCount: extracted.length,
    priorClaimCount,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rejectedRecord(
  index: number,
  recordId: string,
  code: ErrorCode,
  reason: string,
): AdsClaimExtractionRejected {
  return { outcome: "rejected", index, recordId, code, reason };
}

function adsRecordAbsentReason(recordId: string): string {
  return (
    `no stored Ad Center record for id "${recordId}" — extraction runs over IMPORTED records; ` +
    "import the record first (ads.import)"
  );
}

/** Typed-absent-aware gets: undefined when the id is not stored. */
async function tryGetRecord(deps: ExtractAdsClaimsDeps, id: string): Promise<AdRecord | undefined> {
  return tryStored(deps.records.get(id));
}

async function tryGetClaim(deps: ExtractAdsClaimsDeps, id: string): Promise<Claim | undefined> {
  return tryStored(deps.claims.get(id));
}

/** Resolves a store get to undefined on the typed ads/*-absent codes. */
async function tryStored<T>(get: Promise<T>): Promise<T | undefined> {
  try {
    return await get;
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
    code === ErrorCode.AdsReviewSignalAbsent
  );
}

/**
 * Pre-job batch-shape validation (caller defects, typed ads/claim-invalid,
 * thrown BEFORE the job exists): every record id non-blank, none named
 * twice.
 */
export function validateExtractAdsClaimsInput(input: ExtractAdsClaimsInput): void {
  const seen = new Set<string>();
  for (const recordId of input.recordIds) {
    if (typeof recordId !== "string" || recordId.trim().length === 0) {
      throw new WebFlixError({
        code: ErrorCode.AdsClaimInvalid,
        reason: "every record id in an extraction batch must be a non-blank string",
        retryable: false,
        context: { subject: "ExtractAdsClaimsInput.recordIds" },
      });
    }
    if (seen.has(recordId)) {
      throw new WebFlixError({
        code: ErrorCode.AdsClaimInvalid,
        reason:
          `the extraction batch names record id "${recordId}" twice — a batch that names one ` +
          "record twice would double-count it in the report",
        retryable: false,
        context: { subject: "ExtractAdsClaimsInput.recordIds", duplicateId: recordId },
      });
    }
    seen.add(recordId);
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
export class AdsExtractClaimsJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsExtractClaimsJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function extractJobFailure(
  deps: ExtractAdsClaimsDeps,
  running: JobDescriptor,
  err: unknown,
): AdsExtractClaimsJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads claim extraction error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsClaimInvalid,
        reason: `the ads claim extraction job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsExtractClaimsJobError({ job: { ...failed, lastError: described }, cause });
}

/** Unwraps a domain transition result (typed ads/claim-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.AdsClaimInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
