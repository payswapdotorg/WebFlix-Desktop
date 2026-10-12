/**
 * Ad Center domain invariants (Phase 5 opener, P5-CONTRACTS scope row 3).
 *
 * Pure rules over the ads contract shapes
 * (webflix-contracts/src/ads.ts): the extractive-claim discipline
 * (offsets within the source text + quote byte-equal to the offset
 * window — the Phase-4 Q&A-span precedent), the evidence-edge
 * referential shape checks, and the offer-verification state-machine
 * legality (unchecked records are bare; checked records carry their
 * full evidence list; only unchecked -> checked transitions are legal).
 * No I/O, no clock, no globals (house rule for this package).
 *
 * These are the violation-returning validators (the
 * validateObjectiveInvariants / validateDerivedArtifactLineage pattern):
 * they state defects as DATA. The ads/* error codes are the typed
 * vocabulary boundary callers (the P5 stores / import seam / verification
 * orders) surface these violations through — no machinery lives here.
 *
 * Offset semantics: Claim offsets are UTF-16 code-unit indices into the
 * ad record's `creativeText` (JS string indices); "byte-equal" means the
 * quote equals `creativeText.slice(startOffset, endOffset)` exactly.
 */
import {
  AdRecordSchema,
  ClaimSchema,
  EvidenceLinkSchema,
  OfferVerificationSchema,
} from "webflix-contracts";
import type { Claim, EvidenceLink, OfferVerification } from "webflix-contracts";

// ---------------------------------------------------------------------------
// Claim — the extractive discipline (offsets + quote byte-equality)
// ---------------------------------------------------------------------------

export type ClaimViolation =
  | { code: "invalid-claim-shape"; message: string }
  | { code: "invalid-record-shape"; message: string }
  | { code: "wrong-record"; claimId: string; recordId: string; message: string }
  | { code: "no-creative-text"; recordId: string; message: string }
  | {
      code: "offsets-out-of-bounds";
      startOffset: number;
      endOffset: number;
      textLength: number;
      message: string;
    }
  | { code: "quote-not-byte-equal"; startOffset: number; endOffset: number; message: string };

/**
 * The extractive-claim discipline: a claim's offsets must lie within the
 * referenced ad record's creative text, and its quote must be BYTE-EQUAL
 * to `creativeText.slice(startOffset, endOffset)` — a claim the source
 * did not state is a defect (phase5-ad-plan §6). The referenced record
 * must be the claim's own (`adRecordId === record.id`) and must carry
 * creative text (a claim against a textless record cannot be extractive
 * — it is a defect, never a pass-by-default).
 */
export function validateClaimOffsets(claim: unknown, record: unknown): ClaimViolation[] {
  const parsedClaim = ClaimSchema.safeParse(claim);
  if (!parsedClaim.success) {
    return [
      { code: "invalid-claim-shape", message: `not a valid Claim: ${parsedClaim.error.message}` },
    ];
  }
  const parsedRecord = AdRecordSchema.safeParse(record);
  if (!parsedRecord.success) {
    return [
      {
        code: "invalid-record-shape",
        message: `not a valid AdRecord: ${parsedRecord.error.message}`,
      },
    ];
  }
  if (parsedClaim.data.adRecordId !== parsedRecord.data.id) {
    return [
      {
        code: "wrong-record",
        claimId: parsedClaim.data.adRecordId,
        recordId: parsedRecord.data.id,
        message: `claim ${parsedClaim.data.id} references record ${parsedClaim.data.adRecordId} but was checked against record ${parsedRecord.data.id}`,
      },
    ];
  }
  const text = parsedRecord.data.creativeText;
  if (text === undefined) {
    return [
      {
        code: "no-creative-text",
        recordId: parsedRecord.data.id,
        message: `record ${parsedRecord.data.id} carries no creative text; an extractive claim cannot be validated against it`,
      },
    ];
  }
  const { startOffset, endOffset, quote } = parsedClaim.data;
  if (startOffset >= text.length || endOffset > text.length) {
    return [
      {
        code: "offsets-out-of-bounds",
        startOffset,
        endOffset,
        textLength: text.length,
        message: `claim ${parsedClaim.data.id} offsets [${startOffset}, ${endOffset}) exceed the creative text length ${text.length}`,
      },
    ];
  }
  if (text.slice(startOffset, endOffset) !== quote) {
    return [
      {
        code: "quote-not-byte-equal",
        startOffset,
        endOffset,
        message: `claim ${parsedClaim.data.id} quote is not byte-equal to creativeText[${startOffset}, ${endOffset})`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// EvidenceLink — referential shape checks
// ---------------------------------------------------------------------------

export type EvidenceLinkViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "unknown-claim"; claimId: string; message: string }
  | { code: "unknown-review-signal"; reviewSignalId: string; message: string };

/**
 * The evidence-edge referential shape checks: the edge's claim must
 * resolve among the known claim ids, and an `independent-review` edge
 * must point at a KNOWN review signal (the node IS that signal). The
 * other node kinds carry external locators (a source URL, the offer's
 * declared terms URL, the user's own document reference) that this
 * module cannot and does not resolve — referential honesty stops at
 * what is locally knowable, and the locators remain the source-reported
 * strings the shapes carry.
 */
export function validateEvidenceLinkReferential(
  link: unknown,
  knownClaimIds: readonly string[],
  knownReviewSignalIds: readonly string[],
): EvidenceLinkViolation[] {
  const parsed = EvidenceLinkSchema.safeParse(link);
  if (!parsed.success) {
    return [
      { code: "invalid-shape", message: `not a valid EvidenceLink: ${parsed.error.message}` },
    ];
  }
  const edge = parsed.data;
  if (!knownClaimIds.includes(edge.claimId)) {
    return [
      {
        code: "unknown-claim",
        claimId: edge.claimId,
        message: `evidence link ${edge.id} references claim ${edge.claimId}, which is not among the known claims`,
      },
    ];
  }
  if (edge.kind === "independent-review" && !knownReviewSignalIds.includes(edge.reviewSignalId)) {
    return [
      {
        code: "unknown-review-signal",
        reviewSignalId: edge.reviewSignalId,
        message: `evidence link ${edge.id} references review signal ${edge.reviewSignalId}, which is not among the known review signals`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// OfferVerification — the state-machine legality
// ---------------------------------------------------------------------------

export type OfferVerificationViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "unchecked-carries-evidence"; verificationId: string; message: string }
  | { code: "checked-missing-evidence"; verificationId: string; outcome: string; message: string };

/**
 * The single-record state-machine legality: an `unchecked` verification
 * is BARE — no `checkedAt`, no declared sources (nothing has been
 * checked, so nothing may be implied); every CHECKED state
 * (verified-against-declared-source / not-verifiable / contradicted)
 * carries the full evidence list (at least one declared source) AND the
 * check instant. A bare "verified" badge without its evidence list is
 * structurally impossible through this invariant.
 */
export function validateOfferVerificationState(
  verification: unknown,
): OfferVerificationViolation[] {
  const parsed = OfferVerificationSchema.safeParse(verification);
  if (!parsed.success) {
    return [
      {
        code: "invalid-shape",
        message: `not a valid OfferVerification: ${parsed.error.message}`,
      },
    ];
  }
  const record = parsed.data;
  const hasEvidence = record.declaredSources !== undefined && record.declaredSources.length > 0;
  const hasWhen = record.checkedAt !== undefined;
  if (record.outcome === "unchecked") {
    if (hasEvidence || hasWhen) {
      return [
        {
          code: "unchecked-carries-evidence",
          verificationId: record.id,
          message: `verification ${record.id} is unchecked but carries check evidence (checkedAt or declared sources); an unchecked record must be bare`,
        },
      ];
    }
    return [];
  }
  if (!hasEvidence || !hasWhen) {
    return [
      {
        code: "checked-missing-evidence",
        verificationId: record.id,
        outcome: record.outcome,
        message: `verification ${record.id} has outcome ${record.outcome} but lacks its evidence list or check instant; a checked record states WHAT was checked, against WHICH sources, WHEN`,
      },
    ];
  }
  return [];
}

export type OfferVerificationTransitionViolation =
  | { code: "invalid-before-shape"; message: string }
  | { code: "invalid-after-shape"; message: string }
  | { code: "different-records"; beforeId: string; afterId: string; message: string }
  | { code: "different-claims"; claimId: string; message: string }
  | { code: "transition-from-checked"; beforeOutcome: string; message: string }
  | { code: "transition-to-unchecked"; message: string };

/**
 * The transition legality: `unchecked -> checked states ONLY`. A checked
 * record never transitions again — a re-verification is a NEW record
 * with its own id and its own evidence list (records are immutable
 * read-outs); a transition landing on `unchecked` is never legal. The
 * pair must be the same record (`id`) verifying the same claim
 * (`claimId`) — the state machine of ONE verification record.
 */
export function validateOfferVerificationTransition(
  before: unknown,
  after: unknown,
): OfferVerificationTransitionViolation[] {
  const parsedBefore = OfferVerificationSchema.safeParse(before);
  if (!parsedBefore.success) {
    return [
      {
        code: "invalid-before-shape",
        message: `not a valid OfferVerification (before): ${parsedBefore.error.message}`,
      },
    ];
  }
  const parsedAfter = OfferVerificationSchema.safeParse(after);
  if (!parsedAfter.success) {
    return [
      {
        code: "invalid-after-shape",
        message: `not a valid OfferVerification (after): ${parsedAfter.error.message}`,
      },
    ];
  }
  const from = parsedBefore.data;
  const to = parsedAfter.data;
  if (from.id !== to.id) {
    return [
      {
        code: "different-records",
        beforeId: from.id,
        afterId: to.id,
        message: `a transition is within one verification record; got before ${from.id} and after ${to.id}`,
      },
    ];
  }
  if (from.claimId !== to.claimId) {
    return [
      {
        code: "different-claims",
        claimId: to.claimId,
        message: `verification ${from.id} changed its claim from ${from.claimId} to ${to.claimId}; a record verifies one claim`,
      },
    ];
  }
  if (from.outcome !== "unchecked") {
    return [
      {
        code: "transition-from-checked",
        beforeOutcome: from.outcome,
        message: `verification ${from.id} transitions from ${from.outcome}; only unchecked -> checked transitions are legal (a re-verification is a new record)`,
      },
    ];
  }
  if (to.outcome === "unchecked") {
    return [
      {
        code: "transition-to-unchecked",
        message: `verification ${from.id} transitions to unchecked; no transition lands on unchecked`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Convenience re-exports for callers of the invariant layer
// ---------------------------------------------------------------------------

export type { Claim, EvidenceLink, OfferVerification };
