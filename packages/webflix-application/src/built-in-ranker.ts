/**
 * The built-in DETERMINISTIC ranker — RankingPolicy v1 (P4-CONTRACTS row 4).
 *
 * Home note, updated at P4-ARTIFACTS row 0: the frozen application->domain
 * edge has landed (workspace dependency + root lockfile importers), so the
 * P4-FD1 mirror era is over — the parseIsoToEpochMs helper and the
 * contract-parse guard collapsed to webflix-domain imports. The engine
 * itself remains homed HERE per the charter's enumerated mirror collapse
 * (only the helper within this file was a mirror); it enforces the
 * reasons-mandatory rule through the locked schema (single source of
 * enforcement, shared with the domain guard).
 *
 * Contract (phase4-mi-plan §4/§5/§6): pure, LOCAL signals only, no ML, no
 * randomness, no network; every kept item carries reasons[] with evidence
 * pointers to the concrete signals that produced it; the same inputs +
 * the same policy version => byte-for-byte the same output.
 *
 * v1 signal families and formulas (constants live here or in the contracts'
 * RANKING_POLICY_V1_WEIGHTS; changing any of them is a v2):
 *
 * 1. library-affinity (w 0.25): in-library 0.6 + similarity 0.4. Similarity
 *    = supporting library items (an item sharing a title-token or tag term
 *    with the candidate), saturating at 3 supporters. The reason lists the
 *    first 3 supporters by item id; each is cited as a library-fact pointer.
 * 2. watch-history (w 0.30): internal 50/50 split. Fraction half: the
 *    candidate's own in-progress watchedFraction (0 for watched/unwatched —
 *    v1 does not re-recommend finished items via own-state). Recency half:
 *    other non-unwatched items sharing a term with the candidate, weighted
 *    by a 7-day linear decay of the state's updatedAt against the input's
 *    asOf; saturates at 2 full-fresh peers. The reason lists the 3
 *    highest-weight peers.
 * 3. explicit-feedback (w 0.30): a pin saturates the family at 0.8; without
 *    a pin, any thumbs-up gives 0.6. No stacking: once pinned, ups add
 *    nothing (a pin is already the strongest explicit expression).
 *    thumbs-down or not-interested SUPPRESSES the item entirely (absent
 *    from the output, never silently down-ranked). Implicit events are
 *    recorded with provenance but NOT consumed by v1 — honestly recorded
 *    here: the §2.4 WatchedState already carries watched fractions, so
 *    ranking on implicit watched-fraction events would double-count; a v2
 *    policy may revisit.
 * 4. objective-match (w 0.15): focus hits (a focus term present among the
 *    candidate's title tokens or library tags), saturating at 2; plus a
 *    per-session time-budget fit (0.4 of the family) ONLY when the budget
 *    is set AND the candidate's duration is known (library fact) AND it
 *    fits. An exclusion term hit SUPPRESSES the item entirely.
 *
 * Score = quantize4(sum of family weight * family score) over the families
 * that fired; reason order within an item follows the family declaration
 * order; evidence pointers sort by (kind, key); items sort by
 * (score DESC, itemId ASC). Sub-reason contributions are quantized to 4
 * decimals independently — their sum can differ from the item score by at
 * most one 0.0001 quantum per family; the corpus tests pin both exactly.
 *
 * Honest-empty priority: empty-catalog > no-local-signals (no library fact,
 * no non-unwatched watch state, no feedback event at all) >
 * no-ranked-candidates (signals existed but nothing earned a reason).
 */
import {
  ErrorCode,
  RANKING_POLICY_V1_WEIGHTS,
  RankingPolicySchema,
  RankingResultSchema,
  RankingWeightsSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  EvidencePointer,
  FeedbackEvent,
  LibraryFact,
  RankerInput,
  RankedItem,
  RankingPolicyVersion,
  RankingResult,
  RankingReason,
  WatchedState,
} from "webflix-contracts";
import { parseIsoToEpochMs, parseOrThrow } from "webflix-domain";

/** Identity of this implementation, for job provenance and (later) the adapter registry. */
export const BUILT_IN_RANKER_ID = "webflix.built-in-ranker";
/** Mirrors the policy version this implementation ranks with. */
export const BUILT_IN_RANKER_VERSION = "v1";

/** Adapter identity of the default ranker (P4-ADAPTERS binds to this). */
export interface BuiltInRankerInfo {
  readonly id: typeof BUILT_IN_RANKER_ID;
  readonly version: typeof BUILT_IN_RANKER_VERSION;
  readonly defaultPolicyVersion: "v1";
}

/** Fixed 4-decimal quantization — the only rounding in the score path. */
export function quantize4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Title tokens: lowercase, alphanumeric runs of length >= 3, deduplicated. */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) tokens.add(raw);
  }
  return tokens;
}

const DAY_MS = 86400000;

/** 7-day linear recency decay over epoch-ms distance; future timestamps clamp to full weight. */
function recencyDecay(asOfEpochMs: number, updatedAt: string): number {
  const updatedEpochMs = parseIsoToEpochMs(updatedAt);
  if (Number.isNaN(updatedEpochMs)) return 0;
  const days = (asOfEpochMs - updatedEpochMs) / DAY_MS;
  if (days <= 0) return 1;
  if (days >= 7) return 0;
  return 1 - days / 7;
}

/** Terms an item matches on: catalog title tokens plus library tags (whole, lowercased). */
function termsOf(
  itemId: string,
  catalogById: ReadonlyMap<string, CatalogItem>,
  libraryByItem: ReadonlyMap<string, LibraryFact>,
): Set<string> {
  const terms = new Set<string>();
  const item = catalogById.get(itemId);
  if (item !== undefined) {
    for (const token of titleTokens(item.title)) terms.add(token);
  }
  const fact = libraryByItem.get(itemId);
  if (fact !== undefined) {
    for (const tag of fact.tags) terms.add(tag.trim().toLowerCase());
  }
  return terms;
}

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const term of a) {
    if (b.has(term)) return true;
  }
  return false;
}

/** Deterministic evidence order: kind asc, then the pointer's key asc. */
function sortedEvidence(pointers: readonly EvidencePointer[]): EvidencePointer[] {
  return [...pointers].sort((x, y) => {
    if (x.kind !== y.kind) return x.kind < y.kind ? -1 : 1;
    const xKey = "eventId" in x ? x.eventId : "itemId" in x ? x.itemId : x.field;
    const yKey = "eventId" in y ? y.eventId : "itemId" in y ? y.itemId : y.field;
    return xKey < yKey ? -1 : xKey > yKey ? 1 : 0;
  });
}

/** Resolves the input policy to its version + canonical weights (v1 is the only version; schema rejects others). */
function resolvePolicy(policy: RankerInput["policy"]): {
  version: RankingPolicyVersion;
  weights: ReturnType<typeof RankingWeightsSchema.parse>;
} {
  const parsed = parseOrThrow(
    RankingPolicySchema,
    policy,
    ErrorCode.IntelligencePolicyUnsupported,
    "RankingPolicy",
  );
  if (parsed.version !== "v1") {
    // Unreachable while the version enum is closed at v1; kept so a future
    // version extension fails loudly here instead of ranking with v1.
    throw new WebFlixError({
      code: ErrorCode.IntelligencePolicyUnsupported,
      reason: `unsupported ranking policy version: ${parsed.version}`,
      retryable: false,
      context: { knownVersions: ["v1"] },
    });
  }
  return {
    version: parsed.version,
    weights: parseOrThrow(
      RankingWeightsSchema,
      RANKING_POLICY_V1_WEIGHTS,
      ErrorCode.IntelligencePolicyUnsupported,
      "canonical v1 weights",
    ),
  };
}

/**
 * The deterministic built-in ranking. Pure: validates its inputs through
 * the locked schemas (typed Intelligence errors), resolves the canonical
 * weights for the policy version, ranks, and self-checks the output through
 * RankingResultSchema (the reasons-mandatory enforcement — a reasonless
 * recommendation cannot escape this function).
 */
export function rankWithBuiltInPolicy(input: RankerInput): RankingResult {
  const asOfEpochMs = parseIsoToEpochMs(input.asOf);
  if (Number.isNaN(asOfEpochMs)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceRankingInvalid,
      reason: `asOf is not a contract ISO instant: ${input.asOf}`,
      retryable: false,
      context: { asOf: input.asOf },
    });
  }
  const { version, weights } = resolvePolicy(input.policy);

  // Deterministic indexes. Catalog: first occurrence wins on duplicate ids
  // (a §2.1 snapshot is unique by id; duplicates are a caller defect we
  // survive deterministically). Watch states: latest updatedAt wins.
  // Library facts: first occurrence wins.
  const catalogById = new Map<string, CatalogItem>();
  for (const item of input.catalog) {
    if (!catalogById.has(item.id)) catalogById.set(item.id, item);
  }
  const libraryByItem = new Map<string, LibraryFact>();
  for (const fact of input.library) {
    if (!libraryByItem.has(fact.itemId)) libraryByItem.set(fact.itemId, fact);
  }
  const watchByItem = new Map<string, WatchedState>();
  for (const state of [...input.watchHistory].sort((a, b) => {
    if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
    return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
  })) {
    watchByItem.set(state.itemId, state);
  }
  const feedbackByItem = new Map<string, FeedbackEvent[]>();
  for (const event of input.feedback) {
    const list = feedbackByItem.get(event.itemId);
    if (list === undefined) feedbackByItem.set(event.itemId, [event]);
    else list.push(event);
  }
  for (const list of feedbackByItem.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const usableSignals =
    input.library.length > 0 ||
    input.watchHistory.some((state) => state.status !== "unwatched") ||
    input.feedback.length > 0;

  if (input.catalog.length === 0) {
    return { kind: "empty", policyVersion: version, reason: "empty-catalog" };
  }
  if (!usableSignals) {
    return { kind: "empty", policyVersion: version, reason: "no-local-signals" };
  }

  const kept: RankedItem[] = [];
  const candidateIds = [...catalogById.keys()].sort();
  for (const candidateId of candidateIds) {
    const candidateTerms = termsOf(candidateId, catalogById, libraryByItem);
    const ownFact = libraryByItem.get(candidateId);
    const ownWatch = watchByItem.get(candidateId);
    const ownEvents = feedbackByItem.get(candidateId) ?? [];

    // Suppression: negative explicit feedback or an objective exclusion term.
    const negative = ownEvents.some(
      (event) =>
        event.channel === "explicit" &&
        (event.kind === "thumbs-down" || event.kind === "not-interested"),
    );
    const excluded =
      input.objectives !== null &&
      input.objectives.exclusions.some((term) => candidateTerms.has(term.trim().toLowerCase()));
    if (negative || excluded) continue;

    const reasons: RankingReason[] = [];
    let score = 0;

    // --- family 1: library-affinity --------------------------------------
    const supporters = [...libraryByItem.values()]
      .filter((fact) => fact.itemId !== candidateId)
      .filter((fact) => overlaps(candidateTerms, termsOf(fact.itemId, catalogById, libraryByItem)))
      .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    const supportSub = Math.min(1, supporters.length / 3);
    if (ownFact !== undefined) {
      reasons.push({
        family: "library-affinity",
        text: "In your library",
        contribution: quantize4(weights.libraryAffinity * 0.6),
        evidence: sortedEvidence([{ kind: "library-fact", itemId: candidateId }]),
      });
      score += weights.libraryAffinity * 0.6;
    }
    if (supporters.length > 0) {
      const listed = supporters.slice(0, 3);
      reasons.push({
        family: "library-affinity",
        text: `Similar to titles in your library: ${listed.map((fact) => fact.title).join(" | ")}`,
        contribution: quantize4(weights.libraryAffinity * 0.4 * supportSub),
        evidence: sortedEvidence(
          listed.map((fact) => ({ kind: "library-fact", itemId: fact.itemId })),
        ),
      });
      score += weights.libraryAffinity * 0.4 * supportSub;
    }

    // --- family 2: watch-history -----------------------------------------
    if (ownWatch !== undefined && ownWatch.status === "in-progress") {
      const percent = Math.round(ownWatch.watchedFraction * 100);
      reasons.push({
        family: "watch-history",
        text: `Continue watching — ${percent}% done`,
        contribution: quantize4(weights.watchHistory * 0.5 * ownWatch.watchedFraction),
        evidence: sortedEvidence([{ kind: "watched-state", itemId: candidateId }]),
      });
      score += weights.watchHistory * 0.5 * ownWatch.watchedFraction;
    }
    const peers = [...watchByItem.values()]
      .filter((state) => state.itemId !== candidateId && state.status !== "unwatched")
      .map((state) => ({
        state,
        weight: recencyDecay(asOfEpochMs, state.updatedAt),
        related: overlaps(candidateTerms, termsOf(state.itemId, catalogById, libraryByItem)),
      }))
      .filter((peer) => peer.related && peer.weight > 0);
    if (peers.length > 0) {
      peers.sort((a, b) =>
        b.weight !== a.weight ? b.weight - a.weight : a.state.itemId < b.state.itemId ? -1 : 1,
      );
      const recencySub = Math.min(1, peers.reduce((sum, peer) => sum + peer.weight, 0) / 2);
      const listedIds = peers.slice(0, 3).map((peer) => peer.state.itemId);
      const titles = listedIds.map(
        (id) => catalogById.get(id)?.title ?? libraryByItem.get(id)?.title ?? id,
      );
      reasons.push({
        family: "watch-history",
        text: `Recently watched related titles: ${titles.join(" | ")}`,
        contribution: quantize4(weights.watchHistory * 0.5 * recencySub),
        evidence: sortedEvidence(listedIds.map((id) => ({ kind: "watched-state", itemId: id }))),
      });
      score += weights.watchHistory * 0.5 * recencySub;
    }

    // --- family 3: explicit-feedback -------------------------------------
    const pins = ownEvents.filter((event) => event.channel === "explicit" && event.kind === "pin");
    const ups = ownEvents.filter(
      (event) => event.channel === "explicit" && event.kind === "thumbs-up",
    );
    if (pins.length > 0) {
      reasons.push({
        family: "explicit-feedback",
        text: "You pinned it",
        contribution: quantize4(weights.explicitFeedback * 0.8),
        evidence: sortedEvidence(
          pins.map((event) => ({ kind: "feedback-event", eventId: event.id })),
        ),
      });
      score += weights.explicitFeedback * 0.8;
    } else if (ups.length > 0) {
      reasons.push({
        family: "explicit-feedback",
        text: "You rated it up",
        contribution: quantize4(weights.explicitFeedback * 0.6),
        evidence: sortedEvidence(
          ups.map((event) => ({ kind: "feedback-event", eventId: event.id })),
        ),
      });
      score += weights.explicitFeedback * 0.6;
    }

    // --- family 4: objective-match ----------------------------------------
    if (input.objectives !== null) {
      const objective = input.objectives;
      const hitFocuses = objective.topicFocuses
        .map((term) => term.trim().toLowerCase())
        .filter((term) => candidateTerms.has(term))
        .sort();
      if (hitFocuses.length > 0) {
        const focusSub = Math.min(1, hitFocuses.length / 2);
        reasons.push({
          family: "objective-match",
          text: `Matches your focus: ${hitFocuses.slice(0, 2).join(" | ")}`,
          contribution: quantize4(weights.objectiveMatch * 0.6 * focusSub),
          evidence: sortedEvidence([{ kind: "objective", field: "topicFocuses" }]),
        });
        score += weights.objectiveMatch * 0.6 * focusSub;
      }
      const budget = objective.timeBudgets.perSessionMinutes;
      const durationMs = ownFact?.durationMs;
      if (budget !== undefined && durationMs !== undefined && durationMs <= budget * 60000) {
        const minutes = Math.round(durationMs / 60000);
        reasons.push({
          family: "objective-match",
          text: `Fits your ${budget}-minute session budget (${minutes} min)`,
          contribution: quantize4(weights.objectiveMatch * 0.4),
          evidence: sortedEvidence([
            { kind: "objective", field: "timeBudgets.perSessionMinutes" },
            { kind: "library-fact", itemId: candidateId },
          ]),
        });
        score += weights.objectiveMatch * 0.4;
      }
    }

    if (reasons.length === 0) continue; // reasons-mandatory: no signal, no recommendation
    kept.push({
      itemId: candidateId,
      score: quantize4(score),
      // length > 0 proven above; the assertion narrows to the non-empty tuple.
      reasons: reasons as [RankingReason, ...RankingReason[]],
    });
  }

  if (kept.length === 0) {
    return { kind: "empty", policyVersion: version, reason: "no-ranked-candidates" };
  }
  kept.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.itemId < b.itemId ? -1 : 1));
  // Self-check: the reasons-mandatory rule enforced through the locked
  // schema — a reasonless recommendation can never leave this function.
  return parseOrThrow(
    RankingResultSchema,
    { kind: "ranked", policyVersion: version, items: kept },
    ErrorCode.IntelligenceRankingInvalid,
    "RankingResult",
  );
}

/**
 * The default RankerPort implementation: the built-in deterministic ranker.
 * User-selected adapters (P4-ADAPTERS) implement the same port; every
 * implementation's output must satisfy the locked RankingResultSchema —
 * this one self-checks on every return.
 */
export const BUILT_IN_RANKER = {
  id: BUILT_IN_RANKER_ID,
  version: BUILT_IN_RANKER_VERSION,
  info: {
    id: BUILT_IN_RANKER_ID,
    version: BUILT_IN_RANKER_VERSION,
    defaultPolicyVersion: "v1",
  } satisfies BuiltInRankerInfo,
  rank(input: RankerInput): RankingResult {
    return rankWithBuiltInPolicy(input);
  },
};

/**
 * Canonical serialization of a ranking result: plain JSON.stringify over the
 * result object. Deterministic because every ranker (this one by
 * construction, adapters by contract) builds objects with fixed key order
 * and sorted arrays. This is the byte-for-byte determinism primitive the
 * corpus tests and future policy-replay tooling (P4-EVALLOOP) rely on.
 */
export function canonicalRankingJson(result: RankingResult): string {
  return JSON.stringify(result);
}
