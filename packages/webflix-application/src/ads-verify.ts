/**
 * ads.verify — the offer-VERIFICATION use case (P5-VERIFY scope row 2),
 * riding the frozen §2.6 JobDescriptor/JobState wrapper (the ads.import /
 * ads.extractClaims / ads.linkEvidence precedent). Takes claim ids (or an
 * ad-record id => its claims), RESOLVES the evidence stored for each claim
 * (the P5-CLAIMS evidence edges + their review signals), runs the
 * DETERMINISTIC comparison engine (./ads-verify-comparison.ts — its FIXED
 * COMPARISON PARAMETERS are documented there as constants, the
 * built-in-summary-engine house style), and appends one typed
 * OfferVerification per claim through the P5-VERIFY verification store
 * (migration 0007 — append-only by verification id: a verification is an
 * immutable read-out of ONE check instant).
 *
 * VERIFICATION RUNS OVER STORED EVIDENCE ONLY (the charter's honest
 * non-goal, rg-provable: no fetch, no http, no network of any kind — the
 * engine compares what the user IMPORTED, and says so). Every minted
 * record is re-validated through the domain invariant
 * `validateOfferVerificationState` BEFORE it is appended (the
 * ads.extractClaims discipline pattern): an unchecked record is BARE (no
 * checkedAt, no declared sources), every checked record carries its full
 * checks list + the check instant — an empty checks list can NEVER yield
 * verified, structurally.
 *
 * Semantics, stated honestly:
 *
 * - PER-CLAIM OUTCOMES, never batch-or-nothing: each claim is resolved ->
 *   compared -> validated -> appended atomically-per-claim; a claim that
 *   is not stored fails THAT claim typed (ads/claim-absent in the
 *   outcome) and nothing from it is stored. The report states the honest
 *   counts (checked / rejected + the outcome-typed tallies).
 * - THE RECORD-ID SELECTOR resolves its claims through the claim store's
 *   `listByAdRecordId` — this seam's honest resolution surface: an
 *   unknown record id and a record with no stored claims BOTH yield the
 *   honest empty report (nothing to verify; no invented distinction
 *   between them).
 * - THE SOURCES NEVER MUTATED: the stored claims, evidence edges, and
 *   review signals are READ, never re-put (pinned by deep-equal tests).
 *   The only writes are the verification store's appends of THIS engine's
 *   own read-outs.
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is stored; MID-RUN a
 *   cooperative checkpoint runs BEFORE EACH CLAIM (a claim's verification
 *   is never torn). A cancelled run returns report null; verifications
 *   already appended stay (append-only records of check instants — the
 *   documented recovery is the honest history itself).
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/verification-invalid, never job failures): both selectors given
 *   or neither; a blank selector id; duplicate claim ids within the
 *   batch.
 * - INFRASTRUCTURE FAILURES (a store throwing mid-run) stamp the job
 *   FAILED and rethrow through AdsVerifyOffersJobError (the cause's code
 *   intact); the domain-invariant self-check on a minted record is an
 *   internal invariant break, stamped FAILED and thrown typed — never a
 *   silently-mangled verification.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type { Claim, JobDescriptor, OfferVerification } from "webflix-contracts";
import { parseOrThrow, transitionJob, validateOfferVerificationState } from "webflix-domain";
import { deriveOutcome, runCheck } from "./ads-verify-comparison";
import type {
  ClaimStore,
  ClockPort,
  EvidenceEdgeStore,
  IdGenerator,
  OfferVerificationStore,
  ReviewSignalStore,
} from "./ports";

export const ADS_VERIFY_JOB_KIND = "ads.verify";
// (Same JobKind rule: the charter's ads.verify use case rides the
// descriptor as the lowercase dot-dash kind.)

/** The seam's own identity (§2.6 job provenance) — the ENGINE's version. */
export const ADS_VERIFY_SEAM_ID = "webflix.ads-verify";
export const ADS_VERIFY_SEAM_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/**
 * The verification request: the claim ids to verify, OR one ad-record id
 * (=> every claim the claim store holds for that record). Exactly one
 * selector — both or neither is a caller defect, typed, thrown BEFORE the
 * job exists.
 */
export interface VerifyAdsOffersInput {
  /** The stored claim ids to verify (unique, non-blank — validated). */
  readonly claimIds?: readonly string[];
  /** One ad-record id: verify every stored claim of that record. */
  readonly adRecordId?: string;
  /** Honoured at the job boundary AND at the checkpoint before each claim. */
  readonly signal?: AbortSignal;
}

/**
 * The honest disposition of one claim's minted verification: first append
 * of the id ("appended") or the idempotent duplicate (a stored id from an
 * earlier run won — the immutable read-out stands).
 */
export interface AdsVerifyAccepted {
  readonly outcome: "checked";
  /** The claim's index within the resolved batch. */
  readonly index: number;
  readonly claimId: string;
  /** The minted (or already-stored) verification record, in full. */
  readonly verification: OfferVerification;
  readonly disposition: "appended" | "duplicate";
}

export interface AdsVerifyRejected {
  readonly outcome: "rejected";
  readonly index: number;
  readonly claimId: string;
  /** The typed ads/* code the claim failed with. */
  readonly code: ErrorCode;
  readonly reason: string;
}

export type AdsVerifyItemOutcome = AdsVerifyAccepted | AdsVerifyRejected;

/** The honest batch report: per-claim outcomes + counts that add up. */
export interface AdsVerificationReport {
  readonly outcomes: readonly AdsVerifyItemOutcome[];
  readonly counts: {
    readonly checked: number;
    readonly rejected: number;
    readonly total: number;
    /** Outcome-typed tallies of the CHECKED records (the report's own data). */
    readonly verified: number;
    readonly notVerifiable: number;
    readonly contradicted: number;
    readonly unchecked: number;
  };
}

export interface VerifyAdsOffersOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsVerificationReport | null;
}

export interface VerifyAdsOffersDeps {
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

/** ads.verify — the deterministic evidence-resolution verification engine. */
export class VerifyAdsOffers {
  constructor(private readonly deps: VerifyAdsOffersDeps) {}

  async execute(input: VerifyAdsOffersInput): Promise<VerifyAdsOffersOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures).
    validateVerifyAdsOffersInput(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";
    const selector = describeSelector(input);

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_VERIFY_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_VERIFY_SEAM_ID,
          connectorVersion: ADS_VERIFY_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          engineId: ADS_VERIFY_SEAM_ID,
          engineVersion: ADS_VERIFY_SEAM_VERSION,
          selectorKind: selector.kind,
          selectorId: selector.id,
          requestedClaimIdsCount: input.claimIds?.length ?? 0,
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsVerificationInvalid,
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

    // 3. Run: queued -> running; resolve the claim batch ONCE, then one
    //    cooperative checkpoint BEFORE EACH claim.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const outcomes: AdsVerifyItemOutcome[] = [];
    let total = 0;
    try {
      const claimIds = await resolveClaimIds(this.deps, input);
      total = claimIds.length;
      for (let index = 0; index < claimIds.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await verifyOneClaim(this.deps, claimIds[index]!, index));
      }
    } catch (err) {
      throw verifyJobFailure(this.deps, running, err);
    }

    // 4. Assemble the honest report and self-check it (every claim MUST
    //    have exactly one outcome and the counts MUST add up).
    const checked = outcomes.filter(
      (outcome): outcome is AdsVerifyAccepted => outcome.outcome === "checked",
    );
    if (
      outcomes.length !== total ||
      outcomes.some((outcome) => outcome.outcome !== "checked" && outcome.outcome !== "rejected")
    ) {
      throw verifyJobFailure(
        this.deps,
        running,
        new WebFlixError({
          code: ErrorCode.AdsVerificationInvalid,
          reason:
            `internal invariant break: ${outcomes.length} outcomes for ${total} claims — ` +
            "the report refuses to miscount",
          retryable: false,
          context: { outcomes: outcomes.length, total },
        }),
      );
    }
    const report: AdsVerificationReport = {
      outcomes,
      counts: {
        checked: checked.length,
        rejected: total - checked.length,
        total,
        verified: countOutcome(checked, "verified-against-declared-source"),
        notVerifiable: countOutcome(checked, "not-verifiable"),
        contradicted: countOutcome(checked, "contradicted"),
        unchecked: countOutcome(checked, "unchecked"),
      },
    };

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, report };
  }

  /** The cooperative cancellation checkpoint (before EACH claim). */
  private async cancelled(input: VerifyAdsOffersInput): Promise<boolean> {
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
// Per-claim step (resolve evidence -> compare -> mint -> validate -> append)
// ---------------------------------------------------------------------------

/** Verifies ONE claim atomically, as typed data (the only write is append). */
async function verifyOneClaim(
  deps: VerifyAdsOffersDeps,
  claimId: string,
  index: number,
): Promise<AdsVerifyItemOutcome> {
  // 1. The claim must be stored (typed absent surfaces as a rejection —
  //    absence is the honest not-yet-extracted state, never a failure).
  const claim = await tryGetClaim(deps, claimId);
  if (claim === undefined) {
    return rejectedClaim(index, claimId, ErrorCode.AdsClaimAbsent, adsClaimAbsentReason(claimId));
  }

  // 2. Resolve the stored evidence for the claim (deterministic
  //    (stored_at, id) edge order — the checks list rides it).
  const edges = await deps.edges.listByClaim(claim.id);

  // 3. No evidence => the honest bare UNCHECKED record (nothing was
  //    checked, so nothing may be implied — an empty checks list can
  //    never yield verified, structurally).
  if (edges.length === 0) {
    const bare: OfferVerification = {
      id: deps.generateId(),
      claimId: claim.id,
      outcome: "unchecked",
    };
    return appendValidated(deps, bare, index, claim.id);
  }

  // 4. Run the deterministic comparison engine over every resolved edge,
  //    then derive the typed outcome from the resolved evidence ONLY.
  const checks = await Promise.all(edges.map((edge) => runCheck(deps.reviewSignals, claim, edge)));
  const outcome = deriveOutcome(checks);
  const checkedAt = deps.clock.now().toISOString();
  const record: OfferVerification = {
    id: deps.generateId(),
    claimId: claim.id,
    declaredSources: checks.map((check) => check.source),
    checkedAt,
    outcome,
  };
  return appendValidated(deps, record, index, claim.id);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Runs the domain state-machine invariant over the minted record BEFORE it
 * is appended (the extractClaims discipline pattern), then appends through
 * the append-only store. An invariant break is an internal defect: it
 * throws typed (surfacing as a FAILED job), never a silently-mangled
 * verification.
 */
async function appendValidated(
  deps: VerifyAdsOffersDeps,
  record: OfferVerification,
  index: number,
  claimId: string,
): Promise<AdsVerifyAccepted> {
  const violations = validateOfferVerificationState(record);
  if (violations.length > 0) {
    const violation = violations[0]!;
    throw new WebFlixError({
      code: ErrorCode.AdsVerificationInvalid,
      reason:
        `the verification engine minted a record that violates the state machine ` +
        `(${violation.code}): ${violation.message}`,
      retryable: false,
      context: { claimId, violation: violation.code },
    });
  }
  const appended = await deps.verifications.append(record);
  return {
    outcome: "checked",
    index,
    claimId,
    verification: appended.outcome === "appended" ? appended.verification : appended.existing,
    disposition: appended.outcome === "appended" ? "appended" : "duplicate",
  };
}

/** Resolves the input's claim-id batch (the record selector's honest surface). */
async function resolveClaimIds(
  deps: VerifyAdsOffersDeps,
  input: VerifyAdsOffersInput,
): Promise<readonly string[]> {
  if (input.claimIds !== undefined) {
    return input.claimIds;
  }
  const claims = await deps.claims.listByAdRecordId(input.adRecordId!);
  return claims.map((claim) => claim.id);
}

/** The report's selector summary (payload + validation messages). */
function describeSelector(input: VerifyAdsOffersInput): { kind: string; id: string } {
  if (input.claimIds !== undefined) {
    return { kind: "claim-ids", id: `${input.claimIds.length} claims` };
  }
  return { kind: "ad-record-id", id: input.adRecordId! };
}

function rejectedClaim(
  index: number,
  claimId: string,
  code: ErrorCode,
  reason: string,
): AdsVerifyRejected {
  return { outcome: "rejected", index, claimId, code, reason };
}

function adsClaimAbsentReason(claimId: string): string {
  return (
    `no stored Ad Center claim for id "${claimId}" — verification runs over EXTRACTED claims; ` +
    "run ads.extractClaims over the record first (ads.import + ads.extractClaims + ads.linkEvidence)"
  );
}

/** Typed-absent-aware get: undefined when the id is not stored. */
async function tryGetClaim(deps: VerifyAdsOffersDeps, id: string): Promise<Claim | undefined> {
  try {
    return await deps.claims.get(id);
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

/** Tallies the checked records by their typed outcome. */
function countOutcome(
  checked: readonly AdsVerifyAccepted[],
  outcome: OfferVerification["outcome"],
): number {
  return checked.filter((item) => item.verification.outcome === outcome).length;
}

/**
 * Pre-job batch-shape validation (caller defects, typed
 * ads/verification-invalid, thrown BEFORE the job exists): exactly ONE
 * selector (claimIds XOR adRecordId), every id non-blank, no claim id
 * named twice.
 */
export function validateVerifyAdsOffersInput(input: VerifyAdsOffersInput): void {
  const hasClaimIds = input.claimIds !== undefined;
  const hasRecordId = input.adRecordId !== undefined;
  if (hasClaimIds && hasRecordId) {
    throw new WebFlixError({
      code: ErrorCode.AdsVerificationInvalid,
      reason:
        "the verification request names BOTH claim ids and an ad-record id — exactly one selector; " +
        "split them into two runs",
      retryable: false,
      context: { subject: "VerifyAdsOffersInput" },
    });
  }
  if (!hasClaimIds && !hasRecordId) {
    throw new WebFlixError({
      code: ErrorCode.AdsVerificationInvalid,
      reason:
        "the verification request names NEITHER claim ids nor an ad-record id — exactly one selector",
      retryable: false,
      context: { subject: "VerifyAdsOffersInput" },
    });
  }
  if (
    hasRecordId &&
    (typeof input.adRecordId !== "string" || input.adRecordId.trim().length === 0)
  ) {
    throw new WebFlixError({
      code: ErrorCode.AdsVerificationInvalid,
      reason: "the ad-record id selector must be a non-blank string",
      retryable: false,
      context: { subject: "VerifyAdsOffersInput.adRecordId" },
    });
  }
  if (hasClaimIds) {
    const seen = new Set<string>();
    for (const claimId of input.claimIds!) {
      if (typeof claimId !== "string" || claimId.trim().length === 0) {
        throw new WebFlixError({
          code: ErrorCode.AdsVerificationInvalid,
          reason: "every claim id in a verification batch must be a non-blank string",
          retryable: false,
          context: { subject: "VerifyAdsOffersInput.claimIds" },
        });
      }
      if (seen.has(claimId)) {
        throw new WebFlixError({
          code: ErrorCode.AdsVerificationInvalid,
          reason:
            `the verification batch names claim id "${claimId}" twice — a batch that names one ` +
            "claim twice would double-count it in the report",
          retryable: false,
          context: { subject: "VerifyAdsOffersInput.claimIds", duplicateId: claimId },
        });
      }
      seen.add(claimId);
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
export class AdsVerifyOffersJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsVerifyOffersJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function verifyJobFailure(
  deps: VerifyAdsOffersDeps,
  running: JobDescriptor,
  err: unknown,
): AdsVerifyOffersJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads verify error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsVerificationInvalid,
        reason: `the ads verify job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsVerifyOffersJobError({ job: { ...failed, lastError: described }, cause });
}

/** Unwraps a domain transition result (typed ads/verification-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.AdsVerificationInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
