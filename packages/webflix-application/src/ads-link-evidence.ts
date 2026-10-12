/**
 * ads.linkEvidence — the evidence-graph CONSTRUCTION use case (P5-CLAIMS
 * scope row 3), riding the frozen §2.6 JobDescriptor/JobState wrapper (the
 * ads.import precedent). Takes EXPLICIT input only: fully-formed
 * EvidenceLink edges (the 0.9.0 discriminated union — claim id + typed node
 * kind + relationship + the node's own data + import provenance), validates
 * each edge's referential shape through the domain invariant
 * `validateEvidenceLinkReferential` (the claim must be STORED; an
 * independent-review edge's review signal must be STORED), and persists
 * through the P5-STORES evidence-edge store — APPEND-ONLY, idempotent by
 * edge identity (a stored id re-appends as a duplicate returning the
 * STORED edge; never a second row).
 *
 * NO INFERENCE, rg-provable: this module links EXACTLY what the input
 * provides — it never derives an evidence node from a claim's text, never
 * consults a claim's quote to build an edge, never invents an id, a
 * relationship, or a locator. The only reads are EXISTENCE checks (the
 * claim store's get, the review signal store's get); the only writes are
 * the edge store's append of the CALLER's edge. Fabricating evidence here
 * would be the exact defect phase5-ad-plan §6 forbids.
 *
 * Semantics, stated honestly:
 * - PER-EDGE OUTCOMES, never batch-or-nothing: each edge is validated and
 *   appended atomically-per-edge; a bad edge fails THAT edge typed (the
 *   ads/* code in the outcome) and the report states the honest counts.
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   ads/evidence-invalid): duplicate edge ids within the batch (a batch
 *   that names one id twice is ambiguous — the store's idempotency would
 *   silently swallow the second, and the report refuses to miscount).
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is stored; MID-RUN a
 *   cooperative checkpoint runs BEFORE EACH EDGE. A cancelled run returns
 *   report null; edges already appended stay (append-only idempotency is
 *   the documented recovery — re-running the same input appends nothing).
 * - INFRASTRUCTURE FAILURES (a store throwing mid-batch) stamp the job
 *   FAILED and rethrow through AdsLinkEvidenceJobError (the cause's code
 *   intact); validation REJECTIONS are never failures — they are the
 *   report's data.
 * - ORIGINALS UNTOUCHED: the caller's edge array is read, never mutated.
 */
import { ErrorCode, JobDescriptorSchema, WebFlixError } from "webflix-contracts";
import type { Claim, EvidenceLink, JobDescriptor, ReviewSignal } from "webflix-contracts";
import { EvidenceLinkSchema } from "webflix-contracts";
import { parseOrThrow, transitionJob, validateEvidenceLinkReferential } from "webflix-domain";
import type {
  ClaimStore,
  ClockPort,
  EvidenceEdgeStore,
  IdGenerator,
  ReviewSignalStore,
} from "./ports";

export const ADS_LINK_EVIDENCE_JOB_KIND = "ads.link-evidence";
// (Same JobKind rule: the charter's ads.linkEvidence use case rides the
// descriptor as the lowercase dot-dash kind.)

/** The seam's own identity (§2.6 job provenance). */
export const ADS_LINK_EVIDENCE_SEAM_ID = "webflix.ads-link-evidence";
export const ADS_LINK_EVIDENCE_SEAM_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/**
 * The link request: the fully-formed evidence edges to attach. Every edge
 * carries its OWN data + provenance (the 0.9.0 shape) — the engine links
 * exactly these, nothing more.
 */
export interface LinkAdsEvidenceInput {
  readonly edges: readonly EvidenceLink[];
  /** Honoured at the job boundary AND at the checkpoint before each edge. */
  readonly signal?: AbortSignal;
}

export interface AdsEvidenceLinkAccepted {
  readonly outcome: "accepted";
  /** The edge's index within the requested batch. */
  readonly index: number;
  readonly edgeId: string;
  /** First append of the id, or the idempotent duplicate (stored one won). */
  readonly disposition: "appended" | "duplicate";
}

export interface AdsEvidenceLinkRejected {
  readonly outcome: "rejected";
  readonly index: number;
  /** The edge's id when the shape carried one; null when it did not parse. */
  readonly edgeId: string | null;
  /** The typed ads/* code the edge failed with. */
  readonly code: ErrorCode;
  readonly reason: string;
}

export type AdsEvidenceLinkItemOutcome = AdsEvidenceLinkAccepted | AdsEvidenceLinkRejected;

/** The honest batch report: per-edge outcomes + counts that add up. */
export interface AdsEvidenceLinkReport {
  readonly outcomes: readonly AdsEvidenceLinkItemOutcome[];
  readonly counts: {
    readonly accepted: number;
    readonly rejected: number;
    readonly total: number;
  };
}

export interface LinkAdsEvidenceOutput {
  /** Terminal descriptor: succeeded (with report) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The report on success; null on cancellation AND failure. */
  readonly report: AdsEvidenceLinkReport | null;
}

export interface LinkAdsEvidenceDeps {
  readonly claims: ClaimStore;
  readonly reviewSignals: ReviewSignalStore;
  readonly edges: EvidenceEdgeStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** ads.linkEvidence — the explicit-input-only evidence-graph seam. */
export class LinkAdsEvidence {
  constructor(private readonly deps: LinkAdsEvidenceDeps) {}

  async execute(input: LinkAdsEvidenceInput): Promise<LinkAdsEvidenceOutput> {
    // 1. Caller defects validated BEFORE the job exists.
    validateLinkAdsEvidenceInput(input);
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: ADS_LINK_EVIDENCE_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: ADS_LINK_EVIDENCE_SEAM_ID,
          connectorVersion: ADS_LINK_EVIDENCE_SEAM_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          edgesCount: input.edges.length,
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.AdsEvidenceInvalid,
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

    // 3. Run: queued -> running; one cooperative checkpoint BEFORE EACH edge.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );
    const outcomes: AdsEvidenceLinkItemOutcome[] = [];
    try {
      for (let index = 0; index < input.edges.length; index += 1) {
        if (await this.cancelled(input)) {
          return { job: this.cancelledDescriptor(running), report: null };
        }
        outcomes.push(await linkOneEdge(this.deps, input.edges[index]!, index));
      }
    } catch (err) {
      throw linkJobFailure(this.deps, running, err);
    }

    // 4. Assemble the honest report and self-check it.
    const total = input.edges.length;
    const accepted = outcomes.filter((outcome) => outcome.outcome === "accepted").length;
    if (
      outcomes.length !== total ||
      outcomes.some((outcome) => outcome.outcome !== "accepted" && outcome.outcome !== "rejected")
    ) {
      throw linkJobFailure(
        this.deps,
        running,
        new WebFlixError({
          code: ErrorCode.AdsEvidenceInvalid,
          reason:
            `internal invariant break: ${outcomes.length} outcomes for ${total} edges — ` +
            "the report refuses to miscount",
          retryable: false,
          context: { outcomes: outcomes.length, total },
        }),
      );
    }
    const report: AdsEvidenceLinkReport = {
      outcomes,
      counts: { accepted, rejected: total - accepted, total },
    };

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, report };
  }

  /** The cooperative cancellation checkpoint (before EACH edge). */
  private async cancelled(input: LinkAdsEvidenceInput): Promise<boolean> {
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
// Per-edge step (shape -> referential invariant -> idempotent append)
// ---------------------------------------------------------------------------

/** Validates + appends ONE edge, as typed data (the only write is append). */
async function linkOneEdge(
  deps: LinkAdsEvidenceDeps,
  edge: EvidenceLink,
  index: number,
): Promise<AdsEvidenceLinkItemOutcome> {
  // 1. Shape validation through the 0.9.0 schema.
  const parsed = EvidenceLinkSchema.safeParse(edge);
  if (!parsed.success) {
    return rejectedEdge(index, edgeIdOf(edge), ErrorCode.AdsEvidenceInvalid, parsed.error.message);
  }
  const valid = parsed.data;

  // 2. The referential shape through the DOMAIN INVARIANT: the claim must
  //    resolve among the STORED claims; an independent-review edge's review
  //    signal must resolve among the STORED signals. Existence checks only —
  //    the edge's own data is never consulted or derived from anything.
  const claimStored = (await tryGetClaim(deps, valid.claimId)) !== undefined;
  const signalStored =
    valid.kind === "independent-review"
      ? (await tryGetReviewSignal(deps, valid.reviewSignalId)) !== undefined
      : true; // other node kinds carry external locators — honestly unresolved
  const violations = validateEvidenceLinkReferential(
    valid,
    claimStored ? [valid.claimId] : [],
    valid.kind === "independent-review" && signalStored ? [valid.reviewSignalId] : [],
  );
  if (violations.length > 0) {
    const violation = violations[0]!;
    return rejectedEdge(
      index,
      valid.id,
      ErrorCode.AdsEvidenceInvalid,
      `edge "${valid.id}" violates the referential shape (${violation.code}): ${violation.message}`,
    );
  }

  // 3. Append-only persistence, idempotent by edge identity.
  const appended = await deps.edges.append(valid);
  return {
    outcome: "accepted",
    index,
    edgeId: valid.id,
    disposition: appended.outcome,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rejectedEdge(
  index: number,
  edgeId: string | null,
  code: ErrorCode,
  reason: string,
): AdsEvidenceLinkRejected {
  return { outcome: "rejected", index, edgeId, code, reason };
}

/** The best-effort id of a malformed edge (null when unreadable). */
function edgeIdOf(edge: unknown): string | null {
  if (typeof edge !== "object" || edge === null) return null;
  const id = (edge as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Typed-absent-aware gets: undefined when the id is not stored. */
async function tryGetClaim(deps: LinkAdsEvidenceDeps, id: string): Promise<Claim | undefined> {
  return tryStored(deps.claims.get(id));
}

async function tryGetReviewSignal(
  deps: LinkAdsEvidenceDeps,
  id: string,
): Promise<ReviewSignal | undefined> {
  return tryStored(deps.reviewSignals.get(id));
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
 * Pre-job batch-shape validation (caller defects, typed
 * ads/evidence-invalid, thrown BEFORE the job exists): no duplicate edge
 * ids within the batch (the append-only store's idempotency would silently
 * swallow a second row under the same id — the report refuses the
 * ambiguity up front).
 */
export function validateLinkAdsEvidenceInput(input: LinkAdsEvidenceInput): void {
  const seen = new Set<string>();
  for (const edge of input.edges) {
    const id = edgeIdOf(edge);
    if (id === null) continue; // malformed shapes fail per-edge, typed
    if (seen.has(id)) {
      throw new WebFlixError({
        code: ErrorCode.AdsEvidenceInvalid,
        reason:
          `the evidence batch names edge id "${id}" twice — the append-only store would silently ` +
          "swallow the second edge under the same id; a batch that names one id twice is ambiguous",
        retryable: false,
        context: { subject: "LinkAdsEvidenceInput.edges", duplicateId: id },
      });
    }
    seen.add(id);
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
export class AdsLinkEvidenceJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "AdsLinkEvidenceJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function linkJobFailure(
  deps: LinkAdsEvidenceDeps,
  running: JobDescriptor,
  err: unknown,
): AdsLinkEvidenceJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  const described = WebFlixError.is(err)
    ? `${err.code}: ${err.reason}`
    : `ads evidence link error: ${err instanceof Error ? err.message : String(err)}`;
  const cause = WebFlixError.is(err)
    ? err
    : new WebFlixError({
        code: ErrorCode.AdsEvidenceInvalid,
        reason: `the ads evidence link job reported an unrecognized failure: ${
          err instanceof Error ? err.message : String(err)
        }`,
        retryable: false,
        context: {},
      });
  return new AdsLinkEvidenceJobError({ job: { ...failed, lastError: described }, cause });
}

/** Unwraps a domain transition result (typed ads/evidence-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.AdsEvidenceInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
