/**
 * Media-intelligence domain invariants (Phase 4 opener, P4-CONTRACTS).
 *
 * Pure rules over the MI contract shapes (webflix-contracts/src/intelligence.ts):
 * objective validation beyond the schema, feedback provenance + list rules,
 * policy-version resolution (weights are a function of the version — that is
 * the determinism invariant), the reasons-mandatory runtime guard for ranker
 * adapters, and derived-artifact lineage integrity. No I/O, no clock, no
 * globals (house rule for this package).
 *
 * Sources: docs/plans/phase4-mi-plan.md §3/§4/§8, work order
 * docs/plans/work-orders/P4-CONTRACTS.md scope rows 2.
 */
import {
  ErrorCode,
  RANKING_POLICY_V1_WEIGHTS,
  RankingPolicySchema,
  RankingResultSchema,
  RankingWeightsSchema,
  UserObjectiveSchema,
  WebFlixError,
  DerivedArtifactSchema,
  FeedbackEventSchema,
  CatalogItemSchema,
} from "webflix-contracts";
import type {
  CatalogItem,
  FeedbackEvent,
  RankingPolicyVersion,
  RankingResult,
  RankingWeights,
  UserObjective,
} from "webflix-contracts";
import { parseOrThrow } from "./internal/parse";

// ---------------------------------------------------------------------------
// UserObjective — validation beyond the schema
// ---------------------------------------------------------------------------

export type ObjectiveViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "duplicate-focuses"; focuses: string[]; message: string }
  | { code: "duplicate-exclusions"; exclusions: string[]; message: string }
  | { code: "focus-excluded-overlap"; terms: string[]; message: string };

/**
 * Invariants beyond the contract schema (negative/zero time budgets are
 * already schema-rejected with typed errors; these are the list rules):
 * - topicFocuses contains no duplicates;
 * - exclusions contains no duplicates;
 * - a term can never be both a focus and an exclusion (the ranker must never
 *   face a contradictory objective).
 */
export function validateObjectiveInvariants(objective: UserObjective): ObjectiveViolation[] {
  const parsed = UserObjectiveSchema.safeParse(objective);
  if (!parsed.success) {
    return [
      { code: "invalid-shape", message: `not a valid UserObjective: ${parsed.error.message}` },
    ];
  }
  const violations: ObjectiveViolation[] = [];
  const normalizedFocuses = parsed.data.topicFocuses.map((term) => term.trim().toLowerCase());
  const normalizedExclusions = parsed.data.exclusions.map((term) => term.trim().toLowerCase());
  const focuses = findDuplicates(normalizedFocuses);
  if (focuses.length > 0) {
    violations.push({
      code: "duplicate-focuses",
      focuses,
      message: `topicFocuses contains duplicate entries: ${focuses.join(", ")}`,
    });
  }
  const exclusions = findDuplicates(normalizedExclusions);
  if (exclusions.length > 0) {
    violations.push({
      code: "duplicate-exclusions",
      exclusions,
      message: `exclusions contains duplicate entries: ${exclusions.join(", ")}`,
    });
  }
  const overlap = normalizedFocuses.filter((term) => normalizedExclusions.includes(term));
  if (overlap.length > 0) {
    const terms = [...new Set(overlap)].sort();
    violations.push({
      code: "focus-excluded-overlap",
      terms,
      message: `a topic cannot be both a focus and an exclusion: ${terms.join(", ")}`,
    });
  }
  return violations;
}

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    else seen.add(value);
  }
  return [...duplicated].sort();
}

// ---------------------------------------------------------------------------
// Feedback — provenance rules + list invariants
// ---------------------------------------------------------------------------

export type FeedbackViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "duplicate-event-ids"; eventIds: string[]; message: string };

/**
 * Invariants beyond the contract schema. Per-event provenance (surface,
 * capturedAt), explicit/implicit channel payload bounds and the secret-free
 * guarantees are schema-level; the list rule is: a feedback history never
 * carries two events with the same id (the id is the idempotency key — a
 * duplicate would corrupt append semantics).
 */
export function validateFeedbackHistoryInvariants(
  events: readonly FeedbackEvent[],
): FeedbackViolation[] {
  const parsed = events.map((event) => FeedbackEventSchema.safeParse(event));
  const firstBad = parsed.find((result) => !result.success);
  if (firstBad !== undefined && !firstBad.success) {
    return [
      { code: "invalid-shape", message: `not a valid FeedbackEvent: ${firstBad.error.message}` },
    ];
  }
  const eventIds = findDuplicates(events.map((event) => event.id));
  if (eventIds.length > 0) {
    return [
      {
        code: "duplicate-event-ids",
        eventIds,
        message: `feedback history carries duplicate event ids: ${eventIds.join(", ")}`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// RankingPolicy — weights are a function of the version (determinism)
// ---------------------------------------------------------------------------

export interface ResolvedRankingPolicy {
  readonly version: RankingPolicyVersion;
  readonly weights: RankingWeights;
}

/**
 * Resolves a policy to its canonical weights. The version alone pins the
 * weight table (v1 => RANKING_POLICY_V1_WEIGHTS, verbatim from the
 * contracts); an unknown version is a typed error — that is the domain
 * statement of "determinism given policy version": the same inputs and the
 * same policy version always rank with exactly these weights, so the output
 * is byte-for-byte reproducible (see the ranking corpus tests).
 */
export function resolveRankingPolicy(policy: unknown): ResolvedRankingPolicy {
  const parsed = parseOrThrow(
    RankingPolicySchema,
    policy,
    ErrorCode.IntelligencePolicyUnsupported,
    "RankingPolicy",
  );
  switch (parsed.version) {
    case "v1":
      return {
        version: "v1",
        weights: parseOrThrow(
          RankingWeightsSchema,
          RANKING_POLICY_V1_WEIGHTS,
          ErrorCode.IntelligencePolicyUnsupported,
          "canonical v1 weights",
        ),
      };
  }
  // Unreachable while the version enum is closed; kept so a future version
  // extension fails loudly here instead of silently ranking with v1.
  throw new WebFlixError({
    code: ErrorCode.IntelligencePolicyUnsupported,
    reason: `unsupported ranking policy version: ${JSON.stringify((parsed as { version: string }).version)}`,
    retryable: false,
    context: { knownVersions: ["v1"] },
  });
}

// ---------------------------------------------------------------------------
// Reasons-mandatory — the runtime guard for ranker adapters
// ---------------------------------------------------------------------------

/**
 * Parses a ranker output through the locked schema and asserts the
 * reasons-mandatory rule explicitly: every ranked item carries at least one
 * reason and every reason carries at least one evidence pointer. A
 * reasonless recommendation is a contract violation
 * (phase4-mi-plan §4) — this guard is the belt-and-braces layer for ranker
 * ADAPTERS that build output dynamically (the schema's `.min(1)` already
 * enforces it at parse time). Throws `IntelligenceRankingInvalid` on any
 * violation; returns the parsed result otherwise.
 */
export function assertReasonedRanking(value: unknown): RankingResult {
  const parsed = parseOrThrow(
    RankingResultSchema,
    value,
    ErrorCode.IntelligenceRankingInvalid,
    "RankingResult",
  );
  if (parsed.kind === "empty") {
    return parsed;
  }
  for (const item of parsed.items) {
    if (item.reasons.length === 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceRankingInvalid,
        reason: `ranked item ${item.itemId} carries no reasons; a reasonless recommendation is a contract violation`,
        retryable: false,
        context: { itemId: item.itemId },
      });
    }
    item.reasons.forEach((reason, index) => {
      if (reason.evidence.length === 0) {
        throw new WebFlixError({
          code: ErrorCode.IntelligenceRankingInvalid,
          reason: `reason ${index} (${reason.family}) of item ${item.itemId} carries no evidence pointers`,
          retryable: false,
          context: { itemId: item.itemId, family: reason.family },
        });
      }
    });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// DerivedArtifact — lineage integrity
// ---------------------------------------------------------------------------

export type ArtifactViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "source-not-found"; sourceItemId: string; message: string };

/**
 * Lineage integrity beyond the schema: a derived artifact MUST reference an
 * existing original — `sourceItemId` has to resolve to an item present in
 * the catalog snapshot the caller is bookkeeping against. The kind enum is
 * closed at the schema level (unknown kinds are invalid-shape); a dangling
 * source is this check's violation. Originals are never mutated anywhere in
 * this module — separation is structural (the registry port stores
 * descriptors; nothing writes back into catalog items).
 */
export function validateDerivedArtifactLineage(
  artifact: unknown,
  catalog: readonly CatalogItem[],
): ArtifactViolation[] {
  const parsedArtifact = DerivedArtifactSchema.safeParse(artifact);
  if (!parsedArtifact.success) {
    return [
      {
        code: "invalid-shape",
        message: `not a valid DerivedArtifact: ${parsedArtifact.error.message}`,
      },
    ];
  }
  const knownIds = new Set<string>();
  for (const item of catalog) {
    const parsedItem = CatalogItemSchema.safeParse(item);
    if (parsedItem.success) knownIds.add(parsedItem.data.id);
  }
  if (!knownIds.has(parsedArtifact.data.sourceItemId)) {
    return [
      {
        code: "source-not-found",
        sourceItemId: parsedArtifact.data.sourceItemId,
        message: `derived artifact ${parsedArtifact.data.id} references source item ${parsedArtifact.data.sourceItemId}, which is not present in the catalog snapshot`,
      },
    ];
  }
  return [];
}
