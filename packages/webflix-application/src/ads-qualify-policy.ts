/**
 * The built-in DETERMINISTIC Ad Center qualification policy — v1
 * (P5-QUALIFY scope row 1) — the fixed rules the ads.qualify use case
 * (./ads-qualify.ts) runs over each record's RESOLVED STORED DATA, the
 * built-in-ranker / ads-verify-comparison house style: fixed documented
 * parameters, PURE functions over the data the system HOLDS (no fetch, no
 * http, no network of any kind — the policy counts what the user imported
 * and what the P5-VERIFY engine checked, and says so), byte-identical
 * outputs forever (pinned by the sha256-stated determinism corpus test in
 * ads-qualify.test.ts).
 *
 * FIXED POLICY PARAMETERS (changing any of them is a v2 — they are
 * constants, never inputs, never tunables):
 *
 * - POLICY VERSION: "v1" — the closed AdQualificationPolicyVersion enum
 *   (the RankingPolicyVersion pattern): the version alone pins the
 *   semantics below; v2+ arrives additively with its own design.
 * - THE POPULATIONS (what gets counted, and from where — every count
 *   carries its population, the no-bare-percentages discipline):
 *   1. CLAIMS (N): every stored claim of the record, in the claim
 *      store's deterministic (stored_at, id) listing order — the record's
 *      whole claim population, never a sample.
 *   2. CURRENT VERIFICATION PER CLAIM: the LAST record of the claim's
 *      verification history under the verification store's own
 *      deterministic (stored_at, id) listing order (id breaks ties —
 *      re-verification mints a NEW record, so the newest read-out IS the
 *      claim's current state). A claim with an EMPTY history counts as
 *      unchecked-never-verified (no verification record exists at all —
 *      counted in the same unchecked bucket as a stored bare `unchecked`
 *      record, but its evidence pointer is the CLAIM id, not a
 *      verification id: the honest never-checked distinction).
 *   3. SIGNALS: the independent-review signals attached to the record's
 *      claims through independent-review evidence edges, DEDUPLICATED BY
 *      SIGNAL ID in first-attachment order (the ads.reviewSignals
 *      resolution rule: one signal attached to two claims of the same ad
 *      is ONE signal). DANGLING edge references (an edge whose signal no
 *      longer resolves — impossible through ads.linkEvidence, possible
 *      only through a torn store) are SURFACED as their own reason with
 *      evidence-link pointers, never counted, never dropped.
 * - THE STANDING RULE (qualified — DISPLAY-STANDING in the Ad Center
 *   view; NEVER a promise of ad quality, NEVER an organic-ranking input —
 *   the architecture rule pins the separation):
 *     qualified := N >= 1 AND no current-contradicted claim AND
 *                  current-verified count >= 1
 *   A contradiction anywhere is a standing problem, honesty first (the
 *   P5-VERIFY precedence carried over: a declared contradiction outweighs
 *   any verified claim); nothing verified means there is nothing to show
 *   FOR — the record is not qualified and the reasons say exactly why.
 * - NO SCORE, NO WEIGHTS, NO THRESHOLDS OVER RATIOS: the output IS the
 *   reasons list + the raw counted facts (AdQualificationFacts). There is
 *   no numeric score field anywhere, no weighting of one count against
 *   another, and NO aggregation of review signals into scores — counts
 *   per source are FACTS, never merged ratings (two sources' signals are
 *   two rows, never one number).
 * - THE REASONS (fixed mint order — every reason names the evidence
 *   pointers it derives from, one per counted record; a reason is minted
 *   only when its count is > 0; with N >= 1 at least one bucket is
 *   non-zero, so an explanation ALWAYS carries at least one reason — the
 *   0.10.0 shape's min(1) made structural):
 *   1. contradicted: "W of N claims are currently contradicted by declared
 *      evidence" — one offer-verification pointer per contradicted claim's
 *      current record.
 *   2. verified: "X of N claims are currently verified against a declared
 *      source" — one offer-verification pointer per verified claim's
 *      current record.
 *   3. not-verifiable: "Y of N claims could not be verified against any
 *      declared source (the checks name what was tried)" — one
 *      offer-verification pointer per not-verifiable claim's current
 *      record.
 *   4. unchecked: "Z of N claims have no completed verification check" —
 *      per unchecked claim, its bare `unchecked` verification pointer when
 *      one is stored, else the claim's own claim pointer.
 *   5. PER-SOURCE signal counts, one reason PER SOURCE, sources in
 *      first-attachment order: "review source <S> reports <K> stored
 *      signal(s) attached to this ad's claims, as reported — never
 *      merged" — one review-signal pointer per counted signal. Signals
 *      NEVER flip the standing in v1 (documented): they are as-reported
 *      context counts, carried because the Ad Center shows them, scored
 *      never.
 *   6. dangling references: "K independent-review edge(s) reference
 *      signals that are no longer stored (surfaced, never counted)" —
 *      one evidence-link pointer per dangling edge.
 * - HONEST NO-DATA: a record with NO stored claims has nothing to explain
 *   — the USE CASE (never this policy) emits the typed no-data outcome
 *   with its statement; this policy is never called with an empty claim
 *   population and refuses to fabricate one (a typed internal-invariant
 *   break instead). Never a zero-dressed-as-signal explanation.
 * - DETERMINISM: the same resolved data => the byte-identical explanation
 *   + facts (reason texts, pointer order, count order all fixed above).
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  AdEvidencePointer,
  Claim,
  OfferVerification,
  QualificationExplanation,
  QualificationReason,
  ReviewSignal,
} from "webflix-contracts";

/** The policy version this module implements (the closed enum's only value). */
export const AD_QUALIFICATION_POLICY_VERSION = "v1";

// ---------------------------------------------------------------------------
// The resolved record data (the use case resolves, the policy counts)
// ---------------------------------------------------------------------------

/**
 * ONE resolved independent-review signal attachment: the signal verbatim,
 * plus the claim/edge that attached it (the resolution path's provenance;
 * deduplication by signal id happens over these, first attachment first).
 */
export interface AdsQualificationSignalRef {
  readonly signal: ReviewSignal;
  readonly claimId: string;
  readonly edgeId: string;
}

/** A dangling independent-review edge reference, surfaced as data. */
export interface AdsQualificationDanglingRef {
  readonly claimId: string;
  readonly edgeId: string;
  readonly reviewSignalId: string;
}

/**
 * Everything the policy needs for ONE record, already resolved from the
 * stores in their deterministic listing orders (the use case's job — this
 * module performs no I/O, no clock, no randomness).
 */
export interface AdsQualificationRecordData {
  /** The record's stored claims (N >= 1 — the use case guards no-data). */
  readonly claims: readonly Claim[];
  /** Each claim's verification history, in the store's listing order. */
  readonly verificationsByClaim: ReadonlyMap<string, readonly OfferVerification[]>;
  /** The resolved signal attachments, first-attachment order, deduped by id. */
  readonly signals: readonly AdsQualificationSignalRef[];
  /** Dangling independent-review edge references (surfaced, never counted). */
  readonly danglingSignalRefs: readonly AdsQualificationDanglingRef[];
}

// ---------------------------------------------------------------------------
// The raw counted facts (the no-opaque-score output half)
// ---------------------------------------------------------------------------

/**
 * The raw counted facts a qualification rests on — NO score, NO weight,
 * NO merged rating: counts with their populations, per source. The panel
 * renders these (the no-100%-without-N rule reads them straight off).
 */
export interface AdQualificationFacts {
  /** The record's whole claim population (N — every ratio's denominator). */
  readonly claimsTotal: number;
  /** Current-outcome counts over the claim population (sum = claimsTotal). */
  readonly currentByOutcome: {
    readonly verified: number;
    readonly notVerifiable: number;
    readonly contradicted: number;
    readonly unchecked: number;
  };
  /** Per-source signal counts (first-attachment order; never merged). */
  readonly signalsBySource: readonly {
    readonly source: string;
    readonly count: number;
  }[];
  /** How many dangling independent-review references were surfaced. */
  readonly danglingSignalRefs: number;
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/** One claim's current verification state, as the policy resolves it. */
interface ClaimCurrent {
  readonly claim: Claim;
  /** The current verification record; undefined when none was ever stored. */
  readonly verification: OfferVerification | undefined;
  /** The outcome that counts (never-verified resolves to "unchecked"). */
  readonly outcome:
    | "verified-against-declared-source"
    | "not-verifiable"
    | "contradicted"
    | "unchecked";
}

/**
 * Qualifies ONE ad record: the deterministic v1 policy over the resolved
 * data. PURE — same data in, byte-identical explanation + facts out.
 */
export function qualifyAdRecord(data: AdsQualificationRecordData): {
  explanation: QualificationExplanation;
  facts: AdQualificationFacts;
} {
  if (data.claims.length === 0) {
    // The no-data guard belongs to the use case; reaching here with an
    // empty population is an internal invariant break — never a fabricated
    // zero-dressed-as-signal explanation.
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason:
        "internal invariant break: the qualification policy was called with an empty claim " +
        "population — a record with no claims is the use case's typed no-data outcome, never " +
        "an explanation",
      retryable: false,
      context: { subject: "AdsQualificationRecordData.claims" },
    });
  }

  // 1. Resolve each claim's CURRENT verification (the last record of its
  //    history under the store's deterministic listing order).
  const currents: ClaimCurrent[] = data.claims.map((claim) => {
    const history = data.verificationsByClaim.get(claim.id) ?? [];
    const verification = history.length === 0 ? undefined : history[history.length - 1];
    return {
      claim,
      verification,
      outcome: verification === undefined ? "unchecked" : verification.outcome,
    };
  });

  const contradicted = currents.filter((current) => current.outcome === "contradicted");
  const verified = currents.filter(
    (current) => current.outcome === "verified-against-declared-source",
  );
  const notVerifiable = currents.filter((current) => current.outcome === "not-verifiable");
  const unchecked = currents.filter((current) => current.outcome === "unchecked");

  // 2. The standing rule (fixed, documented above).
  const qualified = contradicted.length === 0 && verified.length >= 1;

  // 3. The reasons (fixed mint order; every reason carries its evidence).
  const total = currents.length;
  const reasons: QualificationReason[] = [];
  if (contradicted.length > 0) {
    reasons.push(
      reason(
        `${contradicted.length} of ${total} claims are currently contradicted by declared evidence`,
        contradicted.map((current) => verificationPointer(current.verification!.id)),
      ),
    );
  }
  if (verified.length > 0) {
    reasons.push(
      reason(
        `${verified.length} of ${total} claims are currently verified against a declared source`,
        verified.map((current) => verificationPointer(current.verification!.id)),
      ),
    );
  }
  if (notVerifiable.length > 0) {
    reasons.push(
      reason(
        `${notVerifiable.length} of ${total} claims could not be verified against any declared ` +
          "source (the checks name what was tried)",
        notVerifiable.map((current) => verificationPointer(current.verification!.id)),
      ),
    );
  }
  if (unchecked.length > 0) {
    reasons.push(
      reason(
        `${unchecked.length} of ${total} claims have no completed verification check`,
        unchecked.map((current) =>
          current.verification === undefined
            ? claimPointer(current.claim.id)
            : verificationPointer(current.verification.id),
        ),
      ),
    );
  }
  for (const [source, count] of signalsBySource(data.signals)) {
    reasons.push(
      reason(
        `review source ${source} reports ${count} stored signal(s) attached to this ad's ` +
          "claims, as reported — never merged",
        data.signals
          .filter((ref) => ref.signal.source === source)
          .map((ref) => signalPointer(ref.signal.id)),
      ),
    );
  }
  if (data.danglingSignalRefs.length > 0) {
    reasons.push(
      reason(
        `${data.danglingSignalRefs.length} independent-review edge(s) reference signals that ` +
          "are no longer stored (surfaced, never counted)",
        data.danglingSignalRefs.map((ref) => edgePointer(ref.edgeId)),
      ),
    );
  }

  // 4. The raw counted facts (the output's other half).
  const facts: AdQualificationFacts = {
    claimsTotal: total,
    currentByOutcome: {
      verified: verified.length,
      notVerifiable: notVerifiable.length,
      contradicted: contradicted.length,
      unchecked: unchecked.length,
    },
    signalsBySource: [...signalsBySource(data.signals)].map(([source, count]) => ({
      source,
      count,
    })),
    danglingSignalRefs: data.danglingSignalRefs.length,
  };

  return {
    explanation: { policyVersion: AD_QUALIFICATION_POLICY_VERSION, qualified, reasons },
    facts,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (fixed formats — changing one is a v2)
// ---------------------------------------------------------------------------

/** Builds one reason: text + at least one evidence pointer. */
function reason(text: string, evidence: readonly AdEvidencePointer[]): QualificationReason {
  return { text, evidence: [...evidence] };
}

/** A claim evidence pointer. */
function claimPointer(claimId: string): AdEvidencePointer {
  return { kind: "claim", claimId };
}

/** An offer-verification evidence pointer. */
function verificationPointer(verificationId: string): AdEvidencePointer {
  return { kind: "offer-verification", verificationId };
}

/** A review-signal evidence pointer. */
function signalPointer(reviewSignalId: string): AdEvidencePointer {
  return { kind: "review-signal", reviewSignalId };
}

/** An evidence-link evidence pointer. */
function edgePointer(evidenceLinkId: string): AdEvidencePointer {
  return { kind: "evidence-link", evidenceLinkId };
}

/**
 * Groups the deduped signal attachments per source, sources in
 * first-attachment order (deterministic given the resolution order; NEVER
 * a cross-source merge — one entry per source, counts only).
 */
function signalsBySource(signals: readonly AdsQualificationSignalRef[]): Map<string, number> {
  const bySource = new Map<string, number>();
  for (const ref of signals) {
    bySource.set(ref.signal.source, (bySource.get(ref.signal.source) ?? 0) + 1);
  }
  return bySource;
}
