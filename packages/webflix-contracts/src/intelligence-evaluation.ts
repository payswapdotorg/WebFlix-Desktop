/**
 * The experiment/evaluation loop shapes — the §2.7 intelligence module's
 * ADDITIVE continuation for P4-EVALLOOP (0.6.0 -> 0.7.0), a sibling module
 * in the intelligence-translate-tts.ts precedent (the parent
 * intelligence.ts stays untouched; index.ts re-exports this module beside
 * it, so the public surface is byte-identical to a single-file section —
 * consumers import contracts ONLY from the package entrypoint). Frozen
 * §2.1–2.6 module files untouched; the RankingPolicyVersion enum stays
 * CLOSED at ["v1"] (the loop compares the built-in v1 against SELECTED
 * adapters — never an invented v2); the DerivedArtifact kind enum stays
 * CLOSED at six kinds (an evaluation is an experiment READ-OUT returned in
 * the job result, NOT a derived artifact of a catalog item — the decision
 * is documented in the use case's module docblock, and no shape here
 * references DerivedArtifact).
 *
 * THE HONEST-METRICS RULES, binding on every consumer of these shapes:
 * - NO FABRICATED GROUND TRUTH: the agreement metric measures agreement
 *   with the USER'S OWN explicit signals (their pins, ups, downs,
 *   not-interesteds) — there is no external relevance model anywhere in
 *   these shapes, and the metric names say so ("explicit-feedback
 *   agreement", never "quality" or "accuracy");
 * - EVERY METRIC CARRIES ITS POPULATION: each share travels beside the
 *   counts it was computed from, so a 1/1 "100%" can never masquerade as
 *   strong evidence — a share over an empty population is null (no
 *   population => no share), never a fabricated 0% or 100%;
 * - HONEST EMPTIES: zero feedback or an empty item universe produces
 *   population-0 results with null shares — typed honest results, never
 *   errors, never invented numbers.
 */
import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";
import { RankingResultSchema } from "./intelligence";

// ---------------------------------------------------------------------------
// EvaluationConfiguration — one side of the comparison (phase4-mi-plan §6:
// the built-in deterministic policy vs the user's selected adapter)
// ---------------------------------------------------------------------------

/**
 * One ranker configuration to replay. Exactly three kinds, honest by
 * construction:
 * - `built-in` — the built-in deterministic policy (v1; the ONLY version —
 *   the enum stays closed);
 * - `adapter` — an explicit registry-known adapter id (the typical source
 *   is the selection store's stored `adapterId`, read by the caller);
 * - `selected` — resolve the profile's CURRENT selection at run time (no
 *   selection stored => the documented default, the built-in v1, stated so
 *   in the outcome's resolution note; a drifted selection is a per-
 *   configuration HONEST FAILURE, never a silent switch to the default).
 */
export const EvaluationConfigurationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("built-in") }),
  z.object({ kind: z.literal("adapter"), adapterId: z.string().trim().min(1) }),
  z.object({ kind: z.literal("selected") }),
]);
export type EvaluationConfiguration = z.infer<typeof EvaluationConfigurationSchema>;

// ---------------------------------------------------------------------------
// EvaluationRequest — profile-scoped: what to replay, over which items,
// through which configurations, with which yardstick
// ---------------------------------------------------------------------------

/**
 * What to evaluate, stated by the caller:
 * - `itemIds` — the catalog item ids under test (the replay universe). MAY
 *   be empty: that is the honest-empty case, population 0 everywhere. Each
 *   id must exist in the catalog snapshot the caller supplies alongside
 *   (a request naming an unknown id is a caller defect, typed
 *   evaluation-invalid);
 * - `feedbackEventIds` — OPTIONAL scope filter over the profile's stored
 *   feedback: absent = replay ALL stored events; present = replay exactly
 *   these events (an unknown id is read-time state, surfaced typed);
 * - `configurations` — at least one (a comparison with zero sides is a
 *   caller defect); literal duplicates are rejected as caller defects (a
 *   comparison needs distinct sides — runtime-resolved duplication, e.g.
 *   `selected` resolving to the built-in while `built-in` also runs, is NOT
 *   a defect and reports honestly with a 100% overlap);
 * - `k` — the metrics' yardstick (top-k / bottom-k window size). One k for
 *   every configuration — the whole point is comparability;
 * - `asOf` — the reference instant for recency signals (the RankerInput
 *   precedent: an explicit input so the same request always replays
 *   byte-identically; job metadata lives ONLY in the §2.6 descriptor).
 */
export const EvaluationRequestSchema = z
  .object({
    itemIds: z.array(z.string().min(1)),
    feedbackEventIds: z.array(z.string().min(1)).optional(),
    configurations: z.array(EvaluationConfigurationSchema).min(1),
    k: z.number().int().min(1),
    asOf: IsoDateTimeSchema,
  })
  .superRefine((request, ctx) => {
    const duplicates = findDuplicates(request.itemIds);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `itemIds contains duplicate ids (a comparison universe is a set): ${duplicates.join(", ")}`,
      });
    }
    const duplicatedEvents = findDuplicates(request.feedbackEventIds ?? []);
    if (duplicatedEvents.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `feedbackEventIds contains duplicate ids: ${duplicatedEvents.join(", ")}`,
      });
    }
    const seen = new Set<string>();
    for (const configuration of request.configurations) {
      const key = JSON.stringify(configuration);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `configurations contains a literal duplicate (${key}) — a comparison needs distinct sides`,
        });
        break;
      }
      seen.add(key);
    }
  });
/**
 * Hand-declared readonly view over the schema (the SummaryRequest
 * precedent): requests are read-only data handed to a pure replay.
 */
export type EvaluationRequest = {
  readonly itemIds: readonly string[];
  readonly feedbackEventIds?: readonly string[];
  readonly configurations: readonly EvaluationConfiguration[];
  readonly k: number;
  readonly asOf: string;
};

/** Duplicate finder over an optional-id list (kept allocation-light). */
function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

// ---------------------------------------------------------------------------
// The metrics — every shape carries its populations
// ---------------------------------------------------------------------------

/**
 * Explicit-feedback AGREEMENT (never "accuracy" — there is no ground truth
 * but the user's own ratings): the share of explicitly-rated items whose
 * policy ranking agrees with the rating direction, with the counted
 * populations NAMED:
 * - `likedTotal` — items under test the user explicitly LIKED (a pin or a
 *   thumbs-up event; an item rated in both directions appears in BOTH
 *   direction populations — the honest double-expression);
 * - `likedInTopK` — of those, ranked within the top-k positions of the
 *   produced ranking (agreement with a like);
 * - `dislikedTotal` — items under test the user explicitly DISLIKED (a
 *   thumbs-down or a not-interested);
 * - `dislikedInBottomK` — of those, ranked within the bottom-k positions
 *   OR absent from the ranking entirely (suppression — the policy's
 *   strongest statement of "not recommended" — counts as agreement with a
 *   dislike; documented here, visible in the counts);
 * - `abstained` — the rated direction-populations the ranking did NOT
 *   agree with (liked-but-not-top-k, disliked-but-ranked-prominently).
 * Shares: `likedShare` = likedInTopK/likedTotal, `dislikedShare` =
 * dislikedInBottomK/dislikedTotal, `agreedShare` =
 * (likedInTopK + dislikedInBottomK)/(likedTotal + dislikedTotal) — each
 * NULL when its denominator is 0 (no population => no share, never a
 * fabricated 0%/100%). All shares quantized to 4 decimals.
 */
export const ExplicitFeedbackAgreementSchema = z.object({
  likedTotal: z.number().int().min(0),
  likedInTopK: z.number().int().min(0),
  dislikedTotal: z.number().int().min(0),
  dislikedInBottomK: z.number().int().min(0),
  abstained: z.number().int().min(0),
  likedShare: z.number().min(0).max(1).nullable(),
  dislikedShare: z.number().min(0).max(1).nullable(),
  agreedShare: z.number().min(0).max(1).nullable(),
});
export type ExplicitFeedbackAgreement = z.infer<typeof ExplicitFeedbackAgreementSchema>;

/**
 * Descriptive distribution stats over the produced ranking's item scores.
 * `count` is the population (the number of ranked items); every stat is
 * null when count is 0 (the honest empty ranking — never invented
 * numbers). The median of an even-count population is the mean of the two
 * middle scores. All stats quantized to 4 decimals.
 */
export const ScoreDistributionStatsSchema = z.object({
  count: z.number().int().min(0),
  min: z.number().min(0).max(1).nullable(),
  max: z.number().min(0).max(1).nullable(),
  mean: z.number().min(0).max(1).nullable(),
  median: z.number().min(0).max(1).nullable(),
});
export type ScoreDistributionStats = z.infer<typeof ScoreDistributionStatsSchema>;

/**
 * Pairwise overlap@k between two EVALUATED configurations' top-k lists —
 * the A/B "are these rankers actually different?" metric. `a`/`b` are
 * indices into the result's outcomes (a < b, request order); `sizeA`/
 * `sizeB` are the ACTUAL top-k sizes compared (min(k, ranked count) per
 * side — an honest ranking shorter than k has a shorter top-k); `share` =
 * overlap / max(sizeA, sizeB), NULL when both sizes are 0 (two empty
 * rankings — nothing to compare, never a fabricated 0%).
 */
export const PairwiseTopKOverlapSchema = z.object({
  a: z.number().int().min(0),
  b: z.number().int().min(0),
  overlap: z.number().int().min(0),
  sizeA: z.number().int().min(0),
  sizeB: z.number().int().min(0),
  share: z.number().min(0).max(1).nullable(),
});
export type PairwiseTopKOverlap = z.infer<typeof PairwiseTopKOverlapSchema>;

// ---------------------------------------------------------------------------
// EvaluationOutcome — one per request configuration, in request order
// ---------------------------------------------------------------------------

const EvaluatedOutcomeSchema = z.object({
  kind: z.literal("evaluated"),
  /** Index into the result's outcomes == the configuration's request position. */
  configurationIndex: z.number().int().min(0),
  /** The request configuration, echoed verbatim. */
  configuration: EvaluationConfigurationSchema,
  /** The resolved ranker's registry id (e.g. `webflix.built-in-ranker`). */
  rankerId: z.string().min(1),
  /** The resolved ranker's human label, rendered verbatim by the panel. */
  rankerLabel: z.string().min(1),
  /**
   * The honest WHY this ranker ran: "the built-in deterministic ranking
   * policy (v1)" / "explicitly configured adapter" / "selected: <id>
   * (selected at <instant>)" / the documented-default note when `selected`
   * found no stored selection.
   */
  resolutionNote: z.string().min(1),
  /** The ranking the configuration produced (the frozen shape, verbatim). */
  ranking: RankingResultSchema,
  agreement: ExplicitFeedbackAgreementSchema,
  scoreStats: ScoreDistributionStatsSchema,
});

/**
 * The fail-soft outcome: this configuration could NOT run (an unknown
 * adapter id — registry drift — or a ranker that threw). Surfaced per
 * configuration as DATA (the evaluation continues with the other sides);
 * `reason` states the honest cause; NO ranking and NO metrics are
 * fabricated for a side that did not run.
 */
export const EvaluationOutcomeSchema = z.discriminatedUnion("kind", [
  EvaluatedOutcomeSchema,
  z.object({
    kind: z.literal("failed"),
    configurationIndex: z.number().int().min(0),
    configuration: EvaluationConfigurationSchema,
    /** The requested ranker identity (the adapter id asked for). */
    rankerId: z.string().min(1),
    reason: z.string().min(1),
  }),
]);
export type EvaluationOutcome = z.infer<typeof EvaluationOutcomeSchema>;

// ---------------------------------------------------------------------------
// The replay summary + the result
// ---------------------------------------------------------------------------

/**
 * The populations of what was replayed — the honest denominators every
 * metric names itself against: how much feedback the store held, how much
 * was replayed (the scope filter's selection), how many replayed events
 * were explicit/implicit ABOUT items under test, whether the stored
 * objective was applied, and the size of the item universe.
 */
export const EvaluationReplaySummarySchema = z.object({
  feedbackTotalStored: z.number().int().min(0),
  feedbackReplayed: z.number().int().min(0),
  explicitUnderTest: z.number().int().min(0),
  implicitUnderTest: z.number().int().min(0),
  objectivesApplied: z.boolean(),
  itemsUnderTest: z.number().int().min(0),
});
export type EvaluationReplaySummary = z.infer<typeof EvaluationReplaySummarySchema>;

/**
 * The evaluation read-out. Carries NO timestamps of the run itself (`asOf`
 * is the echoed deterministic INPUT) and NO job metadata (that lives ONLY
 * in the §2.6 descriptor) — the same inputs + the same stored feedback +
 * the same stored objectives + the same stored selection always produce a
 * byte-identical result. `itemIds` is the canonical SORTED universe
 * (duplicates were rejected as caller defects). NOT a DerivedArtifact and
 * never written to the artifact registry — an evaluation is an experiment
 * read-out, not a derived artifact of a catalog item.
 */
export const EvaluationResultSchema = z.object({
  /** The metrics' k, echoed (the yardstick every population names itself against). */
  k: z.number().int().min(1),
  /** The replay's reference instant (echoed input). */
  asOf: IsoDateTimeSchema,
  /** The universe under test, sorted canonical. */
  itemIds: z.array(z.string().min(1)),
  replay: EvaluationReplaySummarySchema,
  /** One outcome per request configuration, in request order. */
  outcomes: z.array(EvaluationOutcomeSchema),
  /**
   * Every unordered pair of EVALUATED outcomes (a < b by configuration
   * index); empty when fewer than two sides evaluated.
   */
  pairwiseOverlaps: z.array(PairwiseTopKOverlapSchema),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
