/**
 * The evaluation metrics (P4-EVALLOOP scope row 2) — PURE, DETERMINISTIC
 * computations over (a produced ranking, the replayed explicit feedback,
 * the universe under test, k). No network, no store reads, no writes, no
 * wall clock, no randomness — the same inputs always produce byte-for-byte
 * the same numbers.
 *
 * THE NO-FABRICATED-GROUND-TRUTH RULE (binding, stated in the contracts'
 * module docblock and enforced here by construction): every metric
 * measures agreement with the USER'S OWN explicit signals — their pins,
 * thumbs-ups, thumbs-downs and not-interesteds. There is no external
 * relevance model, no invented relevance judgements, nothing the user did
 * not themselves express. The metric names say so ("explicit-feedback
 * agreement") and so do these docblocks.
 *
 * THE POPULATION RULE (equally binding): every share travels beside the
 * counts it was computed from. A share over an empty population is null —
 * never a fabricated 0% and never a free 100% — so a 1/1 "100%" always
 * renders as "(1 of 1)" through its carried populations.
 */
import type {
  EvaluationOutcome,
  ExplicitFeedbackAgreement,
  FeedbackEvent,
  PairwiseTopKOverlap,
  RankingResult,
  ScoreDistributionStats,
} from "webflix-contracts";
import { quantize4 } from "./built-in-ranker";

/**
 * The explicit-rating direction of an event for agreement measurement —
 * the SAME polarity mapping the built-in v1 policy ranks on (pin and
 * thumbs-up are the liked directions; thumbs-down and not-interested are
 * the disliked directions). Implicit events carry no direction (null) —
 * v1 records them but does not consume them, and the agreement metric
 * counts only explicit signals.
 */
export function explicitDirection(event: FeedbackEvent): "liked" | "disliked" | null {
  if (event.channel !== "explicit") return null;
  return event.kind === "thumbs-up" || event.kind === "pin" ? "liked" : "disliked";
}

/** The top-k item ids of a ranked result, in rank order (empty when the ranking is empty). */
export function topKItemIds(ranking: RankingResult, k: number): readonly string[] {
  if (ranking.kind !== "ranked") return [];
  return ranking.items.slice(0, k).map((item) => item.itemId);
}

/** The bottom-k item-id SET of a ranked result (the last k positions). */
function bottomKItemIds(ranking: RankingResult, k: number): ReadonlySet<string> {
  if (ranking.kind !== "ranked") return new Set();
  const items = ranking.items;
  const start = Math.max(0, items.length - k);
  return new Set(items.slice(start).map((item) => item.itemId));
}

/** The set of item ids present in a ranked result. */
function rankedItemIds(ranking: RankingResult): ReadonlySet<string> {
  if (ranking.kind !== "ranked") return new Set();
  return new Set(ranking.items.map((item) => item.itemId));
}

/**
 * Computes the explicit-feedback agreement populations over ONE produced
 * ranking. Population semantics (documented identically on the contract
 * shape — the names are the work order's):
 * - likedTotal — universe items with at least one liked-direction explicit
 *   event (an item rated in both directions appears in BOTH direction
 *   populations: the user expressed both, honestly double-counted);
 * - likedInTopK — of those, ranked within the top-k positions;
 * - dislikedTotal — universe items with at least one disliked-direction
 *   event;
 * - dislikedInBottomK — of those, ranked within the bottom-k positions OR
 *   absent from the ranking entirely (suppression — the policy's
 *   strongest "not recommended" — counts as agreement with a dislike);
 * - abstained — the rated direction-populations the ranking did NOT agree
 *   with (liked-but-not-top-k, disliked-but-ranked-prominently).
 * Shares are quantized to 4 decimals; each is null when its denominator
 * is 0 (no population => no share).
 */
export function computeExplicitFeedbackAgreement(input: {
  readonly replayedFeedback: readonly FeedbackEvent[];
  readonly universeItemIds: ReadonlySet<string>;
  readonly ranking: RankingResult;
  readonly k: number;
}): ExplicitFeedbackAgreement {
  const likedItems = new Set<string>();
  const dislikedItems = new Set<string>();
  for (const event of input.replayedFeedback) {
    if (!input.universeItemIds.has(event.itemId)) continue;
    const direction = explicitDirection(event);
    if (direction === "liked") likedItems.add(event.itemId);
    else if (direction === "disliked") dislikedItems.add(event.itemId);
  }

  const ranked = rankedItemIds(input.ranking);
  const topK = new Set(topKItemIds(input.ranking, input.k));
  const bottomK = bottomKItemIds(input.ranking, input.k);

  let likedInTopK = 0;
  for (const itemId of likedItems) {
    if (topK.has(itemId)) likedInTopK += 1;
  }
  let dislikedInBottomK = 0;
  for (const itemId of dislikedItems) {
    // Suppressed (absent from the ranking) agrees with a dislike: the
    // policy declined to recommend the item at all.
    if (bottomK.has(itemId) || !ranked.has(itemId)) dislikedInBottomK += 1;
  }
  const likedTotal = likedItems.size;
  const dislikedTotal = dislikedItems.size;
  const abstained = likedTotal + dislikedTotal - likedInTopK - dislikedInBottomK;

  const agreedTotal = likedTotal + dislikedTotal;
  return {
    likedTotal,
    likedInTopK,
    dislikedTotal,
    dislikedInBottomK,
    abstained,
    likedShare: likedTotal === 0 ? null : quantize4(likedInTopK / likedTotal),
    dislikedShare: dislikedTotal === 0 ? null : quantize4(dislikedInBottomK / dislikedTotal),
    agreedShare:
      agreedTotal === 0 ? null : quantize4((likedInTopK + dislikedInBottomK) / agreedTotal),
  };
}

/**
 * Descriptive distribution stats over a produced ranking's item scores.
 * Every stat is null when count is 0 (the honest empty ranking — never
 * invented numbers); the median of an even-count population is the mean
 * of the two middle scores. Mean and median re-quantized to 4 decimals.
 */
export function computeScoreDistribution(ranking: RankingResult): ScoreDistributionStats {
  if (ranking.kind !== "ranked") {
    return { count: 0, min: null, max: null, mean: null, median: null };
  }
  const scores = ranking.items.map((item) => item.score).sort((a, b) => a - b);
  const count = scores.length;
  const min = scores[0]!;
  const max = scores[count - 1]!;
  const mean = quantize4(scores.reduce((sum, value) => sum + value, 0) / count);
  const middle = Math.floor(count / 2);
  const median =
    count % 2 === 1 ? scores[middle]! : quantize4((scores[middle - 1]! + scores[middle]!) / 2);
  return { count, min, max, mean, median };
}

/**
 * The pairwise overlap@k between every unordered pair of EVALUATED
 * outcomes (a < b by configuration index): |top-k(a) ∩ top-k(b)| with the
 * ACTUAL per-side top-k sizes (min(k, ranked count) — a ranking shorter
 * than k has an honestly shorter top-k) and share =
 * overlap / max(sizeA, sizeB), null when both sizes are 0 (two empty
 * rankings — nothing to compare, never a fabricated 0%). Failed sides are
 * skipped entirely: there is no top-k for a ranker that did not run, and
 * none is invented.
 */
export function computePairwiseOverlaps(
  outcomes: readonly EvaluationOutcome[],
  k: number,
): readonly PairwiseTopKOverlap[] {
  const evaluated = outcomes
    .filter(
      (outcome): outcome is Extract<EvaluationOutcome, { kind: "evaluated" }> =>
        outcome.kind === "evaluated",
    )
    .map((outcome) => ({
      index: outcome.configurationIndex,
      topK: topKItemIds(outcome.ranking, k),
    }));
  const overlaps: PairwiseTopKOverlap[] = [];
  for (let a = 0; a < evaluated.length; a += 1) {
    for (let b = a + 1; b < evaluated.length; b += 1) {
      const sideA = evaluated[a]!;
      const sideB = evaluated[b]!;
      const setB = new Set(sideB.topK);
      const overlap = sideA.topK.filter((itemId) => setB.has(itemId)).length;
      const sizeA = sideA.topK.length;
      const sizeB = sideB.topK.length;
      const denominator = Math.max(sizeA, sizeB);
      overlaps.push({
        a: sideA.index,
        b: sideB.index,
        overlap,
        sizeA,
        sizeB,
        share: denominator === 0 ? null : quantize4(overlap / denominator),
      });
    }
  }
  return overlaps;
}
