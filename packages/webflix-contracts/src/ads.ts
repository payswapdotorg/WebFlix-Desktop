/**
 * Ad Center contract shapes (Phase 5 opener, P5-CONTRACTS).
 *
 * ADDITIVE module (semver minor 0.7.0 -> 0.8.0 per the §3 method): the
 * frozen §2.1–2.6 shapes, the intelligence modules and every earlier
 * additive sibling are untouched. This module deliberately imports ONLY
 * the shared primitives (`./internal/primitives`) — nothing from the
 * intelligence/ranking modules, in either direction: separation starts
 * in the shapes (phase5-ad-plan §3) and is PINNED by the
 * architecture-check `ads-separation` rule added in this order.
 *
 * Honesty rules encoded here (phase5-ad-plan §1–§6, AUDIT-SOURCES §6
 * finding 13 + §11):
 * - SOURCE-REPORTED ONLY: every identity/verification fact is what a
 *   transparency source or review source REPORTS — never our own
 *   judgment; absent means absent (honest-absent optionals throughout —
 *   no fabricated defaults, no empty-array stand-ins for "unknown").
 * - EXTRACTIVE claims: a Claim is a verbatim quoted span of an ad's own
 *   text with its character offsets; a claim the source did not state is
 *   a defect (the Phase-4 Q&A span discipline; offsets + byte-equality
 *   are enforced by the domain invariants in webflix-domain).
 * - NO bare "verified" badges: an OfferVerification states WHAT was
 *   checked (the claim), against WHICH declared sources, WHEN, and the
 *   OUTCOME as a typed state — the state-machine legality (unchecked
 *   records are bare; checked records carry the full evidence list) is
 *   a domain invariant.
 * - AS-REPORTED review signals: no aggregation into scores this order —
 *   the shapes carry the source's own vocabulary verbatim.
 * - NO ranking signals, NO user data in any shape: the Ad Center lane
 *   never feeds the organic ranking path (structural separation).
 */
import { z } from "zod";
import { AbsoluteUrlSchema, IsoDateTimeSchema, RegionCodeSchema } from "./internal/primitives";

// ---------------------------------------------------------------------------
// Provenance — every ads-lane record states where it came from
// ---------------------------------------------------------------------------

/**
 * The import provenance shared by ads-lane records: WHICH source or
 * import path produced the record, when the source exposed it, when we
 * imported it, and the import batch it arrived in. `observedAt` is the
 * source's own exposure instant (absent when the source reports none);
 * `importedAt` and `importBatchId` are always ours and always known —
 * every import, including a single manual user import, mints a batch id.
 */
export const AdProvenanceSchema = z.object({
  /** The transparency source or import path, e.g. `user-import`, `meta-ad-library`. */
  source: z.string().min(1),
  /** When the source exposed the record, as reported by it (absent when unreported). */
  observedAt: IsoDateTimeSchema.optional(),
  /** When this record was imported into the Ad Center. */
  importedAt: IsoDateTimeSchema,
  /** The import batch this record arrived in (ours; minted per import). */
  importBatchId: z.string().min(1),
});
export type AdProvenance = z.infer<typeof AdProvenanceSchema>;

// ---------------------------------------------------------------------------
// AdvertiserIdentity — source-reported identity facts, never our judgment
// ---------------------------------------------------------------------------

/**
 * The advertiser's verification state AS REPORTED by the transparency
 * source that this identity record came from — the enum names say whose
 * verdict it is. We never compute or upgrade a verification state
 * ourselves; absent means the source reported no verification state.
 */
export const AdvertiserVerificationStateSchema = z.enum([
  "source-reported-verified",
  "source-reported-unverified",
  "source-reported-revoked",
]);
export type AdvertiserVerificationState = z.infer<typeof AdvertiserVerificationStateSchema>;

/**
 * Verified-identity facts a transparency source reports about an
 * advertiser. Every field except `id` and `source` is honest-absent
 * optional: the source reports what it reports (ids, names, regions, its
 * own verification verdict) and nothing is invented on its behalf. This
 * is an identity REFERENCE target — `AdRecord.advertiserIdentityId`
 * points here; the record's own provenance (import batch etc.) lives on
 * the records that carry it through the Ad Center.
 */
export const AdvertiserIdentitySchema = z.object({
  /** The Ad Center's id for this identity (the reference target). */
  id: z.string().min(1),
  /** Which transparency source reported this identity. */
  source: z.string().min(1),
  /** The advertiser's id AS REPORTED by that source (absent when it reports none). */
  sourceAdvertiserId: z.string().min(1).optional(),
  /** The names the source reports (display and/or legal), as reported. */
  names: z.array(z.string().min(1)).min(1).optional(),
  /** Regions the source reports the advertiser as reaching/operating in. */
  regions: z.array(RegionCodeSchema).min(1).optional(),
  /** The source's OWN verification verdict — never our judgment; absent when unreported. */
  verificationState: AdvertiserVerificationStateSchema.optional(),
  /** When the source last reported this identity, as reported by it. */
  reportedAt: IsoDateTimeSchema.optional(),
});
export type AdvertiserIdentity = z.infer<typeof AdvertiserIdentitySchema>;

// ---------------------------------------------------------------------------
// AdRecord — one observed ad; NO ranking signals, NO user data
// ---------------------------------------------------------------------------

/**
 * A serving period the source reports for an ad. Half-open
 * `[start, end)`; an absent `end` means the source reports the ad as
 * still running. Both instants are the SOURCE's report, never ours.
 */
export const AdServingPeriodSchema = z
  .object({
    start: IsoDateTimeSchema,
    /** Period end (exclusive); absent = still running, as reported. */
    end: IsoDateTimeSchema.optional(),
  })
  .refine((period) => period.end === undefined || period.end >= period.start, {
    message: "serving period end must not precede its start",
  });
export type AdServingPeriod = z.infer<typeof AdServingPeriodSchema>;

/**
 * One observed ad: the creative text/urls the source exposed, the
 * regions/periods it reported, the advertiser identity it belongs to,
 * and the provenance of the import. The record carries NO ranking
 * signals and NO user data — nothing here feeds the organic ranking
 * path (phase5-ad-plan §3; the architecture rule pins it). Creative
 * fields are honest-absent: a source that exposes no creative text
 * yields a record with `creativeText` absent, never a fabricated
 * placeholder.
 */
export const AdRecordSchema = z.object({
  /** The Ad Center's id for this record. */
  id: z.string().min(1),
  /** The ad's id AS REPORTED by its source (absent for sources without one). */
  sourceAdId: z.string().min(1).optional(),
  /** The advertiser identity this ad is reported to belong to. */
  advertiserIdentityId: z.string().min(1),
  /** The creative text the source exposed — the claim-extraction substrate. */
  creativeText: z.string().min(1).optional(),
  /** Creative/landing URLs the source exposed. */
  creativeUrls: z.array(AbsoluteUrlSchema).min(1).optional(),
  /** Regions the source reports the ad as reaching. */
  regions: z.array(RegionCodeSchema).min(1).optional(),
  /** Serving periods the source reports for the ad. */
  periods: z.array(AdServingPeriodSchema).min(1).optional(),
  /** Where this record came from and when it was imported. */
  provenance: AdProvenanceSchema,
});
export type AdRecord = z.infer<typeof AdRecordSchema>;

// ---------------------------------------------------------------------------
// Claim — an EXTRACTIVE quoted span of an ad's own text
// ---------------------------------------------------------------------------

/**
 * One extractive claim: a VERBATIM span of an ad record's own creative
 * text, with its UTF-16 character offsets. The quote must be
 * byte-equal to `creativeText.slice(startOffset, endOffset)` and the
 * offsets must lie within the text — the domain invariant
 * (`validateClaimOffsets`) enforces both against the referenced record;
 * a claim the source did not state is a defect. No trim, no
 * normalization: extractive discipline is structural.
 */
export const ClaimSchema = z
  .object({
    id: z.string().min(1),
    /** The ad record this claim is quoted from. */
    adRecordId: z.string().min(1),
    /** The verbatim quoted span (byte-equal to the offset window). */
    quote: z.string().min(1),
    /** Character offset of the span's start within the ad's creative text. */
    startOffset: z.number().int().min(0),
    /** Character offset of the span's end (exclusive). */
    endOffset: z.number().int().min(1),
  })
  .refine((claim) => claim.endOffset > claim.startOffset, {
    message:
      "claim endOffset must be greater than startOffset (a claim spans at least one character)",
  });
export type Claim = z.infer<typeof ClaimSchema>;

// ---------------------------------------------------------------------------
// EvidenceLink — one evidence-graph edge off a claim
// ---------------------------------------------------------------------------

/** The evidence node kinds an edge can attach (the charter's four). */
export const EvidenceNodeKindSchema = z.enum([
  "source-reported-fact",
  "independent-review",
  "offer-terms",
  "user-imported-document",
]);
export type EvidenceNodeKind = z.infer<typeof EvidenceNodeKindSchema>;

/** How the evidence node relates to the claim it is attached to. */
export const EvidenceRelationshipSchema = z.enum(["supports", "contradicts", "contextualizes"]);
export type EvidenceRelationship = z.infer<typeof EvidenceRelationshipSchema>;

/**
 * One evidence-graph edge: a claim linked to an evidence node. The node's
 * kind determines what the edge can honestly carry — a source-reported
 * fact names the URL it is reported at (and optionally the reported
 * statement, quoted); an independent-review edge points at the
 * `ReviewSignal` that IS the node; offer-terms name where the terms are
 * declared; a user-imported document names the user's own imported
 * document reference. Every variant carries the import provenance. The
 * referential shape (claim exists; review signals resolve) is a domain
 * invariant.
 */
export const EvidenceLinkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("source-reported-fact"),
    id: z.string().min(1),
    claimId: z.string().min(1),
    relationship: EvidenceRelationshipSchema,
    /** Where the fact is reported. */
    url: AbsoluteUrlSchema,
    /** The reported statement, quoted as the source states it (absent when not quoted). */
    asReportedText: z.string().min(1).optional(),
    provenance: AdProvenanceSchema,
  }),
  z.object({
    kind: z.literal("independent-review"),
    id: z.string().min(1),
    claimId: z.string().min(1),
    relationship: EvidenceRelationshipSchema,
    /** The review signal that IS this evidence node (a ReviewSignal id). */
    reviewSignalId: z.string().min(1),
    provenance: AdProvenanceSchema,
  }),
  z.object({
    kind: z.literal("offer-terms"),
    id: z.string().min(1),
    claimId: z.string().min(1),
    relationship: EvidenceRelationshipSchema,
    /** Where the offer's terms are declared. */
    url: AbsoluteUrlSchema,
    /** The declared terms, quoted (absent when the declaration is not excerpted). */
    declaredTermsExcerpt: z.string().min(1).optional(),
    provenance: AdProvenanceSchema,
  }),
  z.object({
    kind: z.literal("user-imported-document"),
    id: z.string().min(1),
    claimId: z.string().min(1),
    relationship: EvidenceRelationshipSchema,
    /** The user's imported document this evidence node is (their reference id). */
    documentId: z.string().min(1),
    provenance: AdProvenanceSchema,
  }),
]);
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

// ---------------------------------------------------------------------------
// ReviewSignal — an independent review, AS REPORTED ONLY
// ---------------------------------------------------------------------------

/**
 * One independent review signal: what a review source REPORTS — its
 * rating and/or classification in its own vocabulary, verbatim, plus the
 * region/scope it covers and the import provenance. There is
 * deliberately NO score, NO normalized grade, NO aggregation: this order
 * carries the as-reported signal only (the charter's honest non-goal).
 * At least one of `asReportedRating` / `asReportedClassification` must
 * be present — a review that reports neither is not a review signal.
 */
export const ReviewSignalSchema = z
  .object({
    id: z.string().min(1),
    /** Who published the review (the reviewing source). */
    source: z.string().min(1),
    /** The rating AS REPORTED, verbatim scale value (e.g. `4.2/5`, `A+`). */
    asReportedRating: z.string().min(1).optional(),
    /** The classification AS REPORTED, the source's own vocabulary. */
    asReportedClassification: z.string().min(1).optional(),
    /** The region the review covers, as reported (absent when global/unscoped). */
    region: RegionCodeSchema.optional(),
    /** The freeform scope the review covers, as reported (e.g. `EU-wide`). */
    scope: z.string().min(1).optional(),
    /** How this signal reached the Ad Center. */
    provenance: AdProvenanceSchema,
  })
  .superRefine((signal, ctx) => {
    if (signal.asReportedRating === undefined && signal.asReportedClassification === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a review signal must carry at least one of asReportedRating / asReportedClassification (as reported by its source)",
      });
    }
  });
export type ReviewSignal = z.infer<typeof ReviewSignalSchema>;

// ---------------------------------------------------------------------------
// OfferVerification — WHAT was checked, against WHAT, WHEN, with which OUTCOME
// ---------------------------------------------------------------------------

/** The typed verification outcomes (never a bare "verified" badge). */
export const OfferVerificationStateSchema = z.enum([
  "unchecked",
  "verified-against-declared-source",
  "not-verifiable",
  "contradicted",
]);
export type OfferVerificationState = z.infer<typeof OfferVerificationStateSchema>;

/**
 * One entry of the verification evidence list: a declared source the
 * check ran against — who/what it is, where it lives (when it lives
 * somewhere linkable), and what it reported (the finding, quoted).
 * `url` and `asReported` are honest-absent: a named source that is
 * neither linkable nor quoted is still an honestly-declared source.
 */
export const VerificationSourceSchema = z.object({
  /** The declared source's name/identity as the check consulted it. */
  source: z.string().min(1),
  /** Where the source lives, when it is linkable. */
  url: AbsoluteUrlSchema.optional(),
  /** What the source reported (the finding, as reported). */
  asReported: z.string().min(1).optional(),
});
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

/**
 * The honest verification record: WHAT was checked (the offer claim),
 * against WHICH declared sources (the evidence list), WHEN the check
 * ran, and the OUTCOME as a typed state. The state-machine legality is
 * a domain invariant: `unchecked` records are BARE (no `checkedAt`, no
 * declared sources — nothing has been checked, so nothing may be
 * implied); every checked state carries the full evidence list and the
 * check instant. The `not-verifiable` outcome still names the sources
 * it tried — an honest failure states what was attempted. No bare
 * "verified" badge can be constructed from these shapes.
 */
export const OfferVerificationSchema = z.object({
  id: z.string().min(1),
  /** WHAT was checked: the offer claim (a Claim id). */
  claimId: z.string().min(1),
  /** WHICH declared sources the check ran against (required for checked states). */
  declaredSources: z.array(VerificationSourceSchema).min(1).optional(),
  /** WHEN the check ran (required for checked states; absent for unchecked). */
  checkedAt: IsoDateTimeSchema.optional(),
  /** The typed outcome. */
  outcome: OfferVerificationStateSchema,
});
export type OfferVerification = z.infer<typeof OfferVerificationSchema>;

// ---------------------------------------------------------------------------
// QualificationExplanation — reasons[] with evidence pointers + the policy pin
// ---------------------------------------------------------------------------

/**
 * The qualification policy version — its own closed enum, the
 * RankingPolicyVersion pattern: the version alone pins the deterministic
 * qualification semantics; v2+ arrives additively with its own design.
 */
export const AdQualificationPolicyVersionSchema = z.enum(["v1"]);
export type AdQualificationPolicyVersion = z.infer<typeof AdQualificationPolicyVersionSchema>;

/**
 * Pointer to the concrete ads-lane evidence a qualification reason rests
 * on — which claim, which evidence-graph edge, which review signal,
 * which offer-verification record, or which per-source coverage manifest
 * entry (the no-global-coverage honesty: a coverage-based reason points
 * at the source whose manifest declared that coverage).
 */
export const AdEvidencePointerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("claim"), claimId: z.string().min(1) }),
  z.object({ kind: z.literal("evidence-link"), evidenceLinkId: z.string().min(1) }),
  z.object({ kind: z.literal("review-signal"), reviewSignalId: z.string().min(1) }),
  z.object({ kind: z.literal("offer-verification"), verificationId: z.string().min(1) }),
  z.object({ kind: z.literal("source-coverage"), source: z.string().min(1) }),
]);
export type AdEvidencePointer = z.infer<typeof AdEvidencePointerSchema>;

/**
 * One qualification reason: human-readable text PLUS at least one
 * evidence pointer — the §4 explainability pattern carried into the ads
 * lane (a reasonless qualification decision is a contract violation).
 */
export const QualificationReasonSchema = z.object({
  /** The human-readable reason text. */
  text: z.string().min(1),
  /** The concrete evidence this reason rests on (at least one pointer). */
  evidence: z.array(AdEvidencePointerSchema).min(1),
});
export type QualificationReason = z.infer<typeof QualificationReasonSchema>;

/**
 * The explainable qualification read-out: the outcome being explained
 * (`qualified`), the deterministic policy version that produced it, and
 * the reasons with their evidence pointers — mandatory in BOTH
 * directions (an honest "not qualified" carries its reasons too). This
 * order defines the shape only; the scoring policy itself is P5-QUALIFY.
 */
export const QualificationExplanationSchema = z.object({
  /** The policy version whose deterministic semantics produced this explanation. */
  policyVersion: AdQualificationPolicyVersionSchema,
  /** The qualification outcome being explained. */
  qualified: z.boolean(),
  /** Why — at least one reason, whichever way the outcome went. */
  reasons: z.array(QualificationReasonSchema).min(1),
});
export type QualificationExplanation = z.infer<typeof QualificationExplanationSchema>;
