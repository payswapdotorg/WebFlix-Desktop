/**
 * The built-in DETERMINISTIC offer-verification comparison engine (P5-VERIFY
 * scope row 2) — the fixed rules the ads.verify use case (./ads-verify.ts)
 * runs over each claim's RESOLVED evidence, the built-in-summary-engine /
 * ads-claim-extractor house style: fixed documented parameters, pure
 * functions over the evidence the system HOLDS (no fetch, no http, no
 * network of any kind — the engine compares what the user IMPORTED, and
 * says so), byte-identical outputs forever (pinned by the sha256-stated
 * determinism corpus test in ads-verify.test.ts).
 *
 * FIXED COMPARISON PARAMETERS (changing any of them is a new engine
 * version — they are constants, never inputs, never tunables):
 *
 * - TEXT-COMPARABLE EVIDENCE KINDS: `offer-terms` (the declared terms
 *   excerpt) and `source-reported-fact` (the reported statement) — the
 *   kinds whose text states the offer's own facts. `independent-review`
 *   and `user-imported-document` edges are NEVER text-compared: a review
 *   source's rating vocabulary is not an offer declaration (comparing a
 *   "5" inside a "4.2/5" rating against a "5" inside a price would
 *   FABRICATE a verification), and a user-imported-document edge carries
 *   a document REFERENCE, no text. Honest limit: an `independent-review`
 *   or `user-imported-document` check can therefore never verify — it
 *   contributes the declared polarity or context only.
 * - NUMERIC TOKEN MATCHER (reused verbatim from the claim extractor's
 *   own fixed matcher): the digit-run-with-optional-decimal/thousands
 *   pattern, written without delimiters as \d+(?:[.,]\d+)* (a slash pair
 *   would end this comment) — extracted from BOTH the claim's quote and
 *   the evidence text, compared BYTE-EQUAL as literal strings. NO
 *   currency conversion, NO separator normalization ("9,99" and "9.99"
 *   are different tokens), NO unit semantics, NO rounding.
 * - THE VERIFIES RULE (a text-comparable check verifies when EITHER
 *   holds):
 *   (a) NUMERIC: the claim quote AND the evidence text BOTH carry at
 *       least one numeric token AND every claim token appears among the
 *       evidence text's tokens (set inclusion, byte-equal);
 *   (b) TEXT: the boundary-trimmed claim quote is a byte-equal substring
 *       of the evidence text.
 * - CONTRADICTION IS DECLARED, NEVER DERIVED: a check contradicts iff
 *   its edge's declared `relationship` is "contradicts" (the importer
 *   said so; for an independent-review edge the contradicting signal's
 *   id rides the check's source string). Text comparison can VERIFY or
 *   fail-to-verify; it can NEVER contradict — the absence of a number
 *   from a partial excerpt is not a denial, and deriving one would be
 *   truth invention (phase5-ad-plan §5).
 * - REVIEW-SIGNAL POLARITY MAPPING: an independent-review check's
 *   polarity IS its edge's declared relationship (supports -> supporting,
 *   contradicts -> contradicting, contextualizes -> contextual). The
 *   signal's own as-reported rating/classification vocabulary is carried
 *   in the check's `asReported` VERBATIM and never re-interpreted — NO
 *   word list flips a declared polarity, NO normalization across sources
 *   (the charter's honest non-goal, held on the verification side too).
 * - OUTCOME DERIVATION (fixed precedence, reading ONLY the resolved
 *   evidence — the edges' declared relationships and the comparison
 *   findings, never the display strings):
 *   1. NO resolved evidence edges => `unchecked` (the bare record — the
 *      honest nothing-checked state; minted by the USE CASE, which never
 *      reaches this engine without edges);
 *   2. ANY edge whose declared relationship is "contradicts" =>
 *      `contradicted` (honesty first: a declared contradiction outweighs
 *      any matching excerpt);
 *   3. ANY verifying check (numeric/text match on text-comparable
 *      evidence) => `verified-against-declared-source`;
 *   4. Otherwise (edges exist, none contradict, none verify) =>
 *      `not-verifiable` — the record still carries its full checks list
 *      naming everything consulted: the honest tried-and-could-not.
 *
 * THE CHECKS LIST (the record's `declaredSources`): one VerificationSource
 * per resolved evidence edge, each naming the evidence node id + kind +
 * what was compared (+ the finding) in `source` (the declared source's
 * identity AS THE CHECK CONSULTED IT — the fixed per-kind formats in
 * `runCheck`), the node's own url in `url` when the kind carries one, and
 * the evidence text VERBATIM in `asReported` (the terms excerpt / the
 * reported statement / the signal's as-reported vocabulary — the fixed
 * " / " join when a signal reports both a rating and a classification).
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  Claim,
  EvidenceLink,
  EvidenceRelationship,
  OfferVerification,
  ReviewSignal,
  VerificationSource,
} from "webflix-contracts";
import type { ReviewSignalStore } from "./ports";

// ---------------------------------------------------------------------------
// The resolved check — the evidence-side finding the derivation reads
// ---------------------------------------------------------------------------

/**
 * ONE resolved check, as the engine holds it: the FULL checks-list entry
 * the record carries (`source` — the VerificationSource with its url and
 * asReported when the kind carries them), the edge's DECLARED relationship
 * (the polarity the derivation reads — never re-parsed from display
 * strings), and the deterministic comparison's finding (`verifies` — false
 * for the kinds the fixed rules never text-compare).
 */
export interface ResolvedCheck {
  readonly source: VerificationSource;
  readonly relationship: EvidenceRelationship;
  readonly verifies: boolean;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * One check: resolve the edge's evidence (reading ONLY the review-signal
 * store an `independent-review` edge names — an existence read, never a
 * mutation), run the deterministic comparison, name what was compared.
 * Pure over its inputs; deterministic over the store's state.
 */
export async function runCheck(
  reviewSignals: ReviewSignalStore,
  claim: Claim,
  edge: EvidenceLink,
): Promise<ResolvedCheck> {
  switch (edge.kind) {
    case "offer-terms": {
      const evidenceText = edge.declaredTermsExcerpt;
      const verifies =
        evidenceText !== undefined && textComparisonVerifies(claim.quote, evidenceText);
      const described =
        `offer-terms evidence node "${edge.id}" — ` +
        (evidenceText !== undefined
          ? `numeric/text comparison of the claim quote against the declared terms excerpt (${verifiesLabel(verifies)})`
          : "terms location declared, no excerpt to compare (not comparable)");
      const source: VerificationSource = {
        source: described,
        url: edge.url,
        ...(evidenceText !== undefined ? { asReported: evidenceText } : {}),
      };
      return { source, relationship: edge.relationship, verifies };
    }
    case "source-reported-fact": {
      const evidenceText = edge.asReportedText;
      const verifies =
        evidenceText !== undefined && textComparisonVerifies(claim.quote, evidenceText);
      const described =
        `source-reported-fact evidence node "${edge.id}" — ` +
        (evidenceText !== undefined
          ? `numeric/text comparison of the claim quote against the reported statement (${verifiesLabel(verifies)})`
          : "fact location declared, no quoted statement to compare (not comparable)");
      const source: VerificationSource = {
        source: described,
        url: edge.url,
        ...(evidenceText !== undefined ? { asReported: evidenceText } : {}),
      };
      return { source, relationship: edge.relationship, verifies };
    }
    case "independent-review": {
      const signal = await tryGetReviewSignal(reviewSignals, edge.reviewSignalId);
      if (signal === undefined) {
        return {
          source: {
            source:
              `independent-review evidence node "${edge.id}" — review-signal polarity mapping from ` +
              `the declared relationship (${edge.relationship}); signal "${edge.reviewSignalId}" ` +
              "did not resolve among the stored signals (not comparable)",
          },
          relationship: edge.relationship,
          verifies: false,
        };
      }
      const asReported =
        signal.asReportedRating !== undefined && signal.asReportedClassification !== undefined
          ? `${signal.asReportedRating} / ${signal.asReportedClassification}`
          : (signal.asReportedRating ?? signal.asReportedClassification);
      const source: VerificationSource = {
        source:
          `independent-review evidence node "${edge.id}" (review signal "${signal.id}" from ` +
          `"${signal.source}") — review-signal polarity mapping from the declared relationship ` +
          `(${edge.relationship}); the signal's own vocabulary is carried as-reported, never ` +
          "re-interpreted",
        ...(asReported !== undefined ? { asReported } : {}),
      };
      return { source, relationship: edge.relationship, verifies: false };
    }
    case "user-imported-document": {
      return {
        source: {
          source:
            `user-imported-document evidence node "${edge.id}" (document "${edge.documentId}") — ` +
            `document reference declared (${edge.relationship}); the edge carries no comparable text ` +
            "(not comparable)",
        },
        relationship: edge.relationship,
        verifies: false,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// The deterministic comparison (fixed parameters — see the module docblock)
// ---------------------------------------------------------------------------

/** The fixed verifies/does-not-verify label (the source string's finding). */
function verifiesLabel(verifies: boolean): string {
  return verifies ? "verifies" : "does not verify";
}

/**
 * THE VERIFIES RULE: (a) NUMERIC — both texts carry >= 1 numeric token and
 * every claim token appears byte-equal among the evidence text's tokens; or
 * (b) TEXT — the boundary-trimmed claim quote is a byte-equal substring of
 * the evidence text. Pure, allocation-bounded, deterministic. Exported for
 * the engine's own tests (the fixed-rule corpus).
 */
export function textComparisonVerifies(claimQuote: string, evidenceText: string): boolean {
  const claimTokens = numericTokens(claimQuote);
  const evidenceTokens = numericTokens(evidenceText);
  if (claimTokens.length > 0 && evidenceTokens.length > 0) {
    const evidenceSet = new Set(evidenceTokens);
    return claimTokens.every((token) => evidenceSet.has(token));
  }
  return evidenceText.includes(claimQuote.trim());
}

/**
 * The fixed numeric-token matcher (the claim extractor's own, reused
 * verbatim, global for `match`): digit runs with optional decimal/thousands
 * parts. `String.match` with a global regex always starts at index 0 —
 * no lastIndex state can leak between calls.
 */
const NUMERIC_TOKEN_MATCHER: RegExp = /\d+(?:[.,]\d+)*/g;

/** The numeric tokens of a text, in order (the fixed matcher, global). */
function numericTokens(text: string): string[] {
  return text.match(NUMERIC_TOKEN_MATCHER) ?? [];
}

/**
 * The OUTCOME DERIVATION (fixed precedence, reading ONLY the resolved
 * evidence — the declared relationships and the comparison findings):
 * any declared contradiction => contradicted; any verifying check =>
 * verified-against-declared-source; otherwise not-verifiable. (The
 * no-edges case never reaches here — the use case minted the bare
 * unchecked record before the engine was consulted.)
 */
export function deriveOutcome(checks: readonly ResolvedCheck[]): OfferVerification["outcome"] {
  if (checks.some((check) => check.relationship === "contradicts")) {
    return "contradicted";
  }
  if (checks.some((check) => check.verifies)) {
    return "verified-against-declared-source";
  }
  return "not-verifiable";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Typed-absent-aware get: undefined when the id is not stored. */
async function tryGetReviewSignal(
  reviewSignals: ReviewSignalStore,
  id: string,
): Promise<ReviewSignal | undefined> {
  try {
    return await reviewSignals.get(id);
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
