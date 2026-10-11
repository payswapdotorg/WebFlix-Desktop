/**
 * The offline evaluation replay core (P4-EVALLOOP scope row 2) — the
 * DETERMINISTIC, PURE half of the experiment loop. Given the caller's
 * replay snapshot (catalog / library / watch history), the stored feedback
 * + objectives (read READ-ONLY by the mi.evaluate use case), and the
 * resolved rankers, it produces per-configuration outcomes with honest
 * metrics. There is NO network, NO store access, NO wall clock, NO
 * randomness and NO writes anywhere in this module: the same inputs
 * always produce a byte-for-byte identical result (the corpus test pins
 * the sha256).
 *
 * READ-ONLY BY CONSTRUCTION: this module receives ARRAYS it never mutates
 * (every sort is over a copy — the built-in ranker's own discipline); it
 * holds no store references at all. The use case (./mi-evaluate.ts) is
 * the only code that touches the feedback/objective/selection stores, and
 * it only ever calls their READ methods.
 *
 * The ranker-resolution rules (the A/B seam, phase4-mi-plan §6):
 * - `built-in` runs the built-in deterministic ranker directly — the
 *   policy resolves through the domain layer inside
 *   rankWithBuiltInPolicy (the charter's "the built-in policy through the
 *   domain resolver"), v1 being the only version (the closed enum);
 * - `adapter` resolves the id through the injected registry: unknown id
 *   (registry drift) is a PER-CONFIGURATION honest failure — the
 *   evaluation continues with the other sides and nothing is fabricated
 *   for the side that could not run;
 * - `selected` resolves the profile's CURRENT stored selection: no
 *   selection stored => the documented default (the built-in v1) with the
 *   default note stated in the outcome; a known selection => that
 *   adapter; a DRIFTED selection (registry drift) => a per-configuration
 *   honest failure carrying the surfaced reason — never a silent switch
 *   to the default, which would mislabel the comparison.
 */
import type {
  CatalogItem,
  EvaluationConfiguration,
  EvaluationOutcome,
  EvaluationRequest,
  EvaluationResult,
  FeedbackEvent,
  LibraryFact,
  RankingPolicy,
  RankerPort,
  RankerAdapterSelection,
  UserObjective,
  WatchedState,
} from "webflix-contracts";
import { BUILT_IN_RANKER, BUILT_IN_RANKER_ID } from "./built-in-ranker";
import { BUILT_IN_RANKER_V1_ENTRY } from "./ranker-adapter-registry";
import type { RankerAdapterRegistry } from "./ranker-adapter-registry";
import { computeExplicitFeedbackAgreement, computeScoreDistribution } from "./evaluation-metrics";

/** Identity of the replay engine itself, for the mi.evaluate job provenance. */
export const EVALUATION_REPLAY_ID = "webflix.evaluation-replay";
export const EVALUATION_REPLAY_VERSION = "0.1.0";

/**
 * The policy every replay ranks under: v1 — the ONLY version (the closed
 * enum; the loop compares RANKERS, not policy versions, and a v2 ships
 * additively only when a real v2 design exists).
 */
export const EVALUATION_POLICY: RankingPolicy = { version: "v1" };

/** The note carried when `selected` found no stored selection (the documented default). */
export const EVALUATION_DEFAULT_NOTE =
  "No ranker adapter is selected — the documented default (the built-in deterministic ranker v1) is active.";

/**
 * The replay universe: the caller's snapshot filtered to the request's
 * item universe (the catalog the rankers rank over), with the caller's
 * FULL library facts and watch history (peer signals — production parity:
 * the whole library informs affinity even when only the universe is
 * rankable), the replayed feedback events (sorted by event id — the
 * canonical order that makes store insertion order irrelevant), and the
 * stored objective.
 */
export interface EvaluationUniverse {
  readonly catalog: readonly CatalogItem[];
  readonly library: readonly LibraryFact[];
  readonly watchHistory: readonly WatchedState[];
  readonly feedback: readonly FeedbackEvent[];
  readonly objectives: UserObjective | null;
  readonly asOf: string;
}

/**
 * Builds the canonical replay universe: the catalog filtered to the
 * request's itemIds (first occurrence wins on duplicate catalog ids — the
 * built-in ranker's own deterministic survival rule), the feedback sorted
 * by event id. The caller's arrays are READ ONLY — nothing is mutated.
 */
export function buildEvaluationUniverse(input: {
  readonly catalog: readonly CatalogItem[];
  readonly library: readonly LibraryFact[];
  readonly watchHistory: readonly WatchedState[];
  readonly feedback: readonly FeedbackEvent[];
  readonly objectives: UserObjective | null;
  readonly request: EvaluationRequest;
}): EvaluationUniverse {
  const wanted = new Set(input.request.itemIds);
  const catalog = input.catalog.filter((item) => wanted.has(item.id));
  const feedback = [...input.feedback].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    catalog,
    library: input.library,
    watchHistory: input.watchHistory,
    feedback,
    objectives: input.objectives,
    asOf: input.request.asOf,
  };
}

/**
 * Why one ranker (and not another) ran a configuration — the resolved
 * identity plus the honest note, or the honest failure.
 */
export type RankerResolution =
  | {
      readonly kind: "resolved";
      readonly ranker: RankerPort;
      readonly rankerId: string;
      readonly rankerLabel: string;
      readonly resolutionNote: string;
    }
  | {
      readonly kind: "failed";
      readonly rankerId: string;
      readonly reason: string;
    };

/**
 * Resolves one configuration to the ranker that will run it (see the
 * module docblock for the three resolution rules). PURE over its inputs —
 * the stored selection is handed IN (the use case reads the store once);
 * no store is touched here.
 */
export function resolveEvaluationRanker(input: {
  readonly configuration: EvaluationConfiguration;
  readonly registry: RankerAdapterRegistry;
  readonly selection: RankerAdapterSelection | null;
}): RankerResolution {
  const configuration = input.configuration;
  if (configuration.kind === "built-in") {
    return {
      kind: "resolved",
      ranker: BUILT_IN_RANKER,
      rankerId: BUILT_IN_RANKER_ID,
      rankerLabel: BUILT_IN_RANKER_V1_ENTRY.label,
      resolutionNote: "the built-in deterministic ranking policy (v1)",
    };
  }
  if (configuration.kind === "adapter") {
    const entry = input.registry.get(configuration.adapterId);
    if (entry === null) {
      return {
        kind: "failed",
        rankerId: configuration.adapterId,
        reason: `the configured ranker adapter "${configuration.adapterId}" is not in the registry — nothing was ranked for this configuration`,
      };
    }
    return {
      kind: "resolved",
      ranker: entry.ranker,
      rankerId: entry.id,
      rankerLabel: entry.label,
      resolutionNote: "explicitly configured adapter",
    };
  }
  // kind === "selected": resolve the profile's CURRENT stored selection.
  if (input.selection === null) {
    return {
      kind: "resolved",
      ranker: BUILT_IN_RANKER,
      rankerId: BUILT_IN_RANKER_ID,
      rankerLabel: BUILT_IN_RANKER_V1_ENTRY.label,
      resolutionNote: EVALUATION_DEFAULT_NOTE,
    };
  }
  const entry = input.registry.get(input.selection.adapterId);
  if (entry === null) {
    return {
      kind: "failed",
      rankerId: input.selection.adapterId,
      reason: `the selected ranker adapter "${input.selection.adapterId}" is no longer available (registry drift) — this configuration could not run`,
    };
  }
  return {
    kind: "resolved",
    ranker: entry.ranker,
    rankerId: entry.id,
    rankerLabel: entry.label,
    resolutionNote: `selected: ${entry.id} (selected at ${input.selection.selectedAt})`,
  };
}

/**
 * Replays ONE configuration: runs the resolved ranker synchronously over
 * the universe (the pure rank call — the frozen RankerInput shape) and
 * computes the metrics over what it produced. A ranker that THROWS is a
 * per-configuration honest failure (fail-soft: the error is described in
 * the outcome's reason, never swallowed and never fabricated around).
 */
export function replayOneConfiguration(input: {
  readonly configuration: EvaluationConfiguration;
  readonly configurationIndex: number;
  readonly universe: EvaluationUniverse;
  readonly resolution: RankerResolution;
  readonly universeItemIds: ReadonlySet<string>;
  readonly k: number;
}): EvaluationOutcome {
  const { configuration, configurationIndex, universe, resolution } = input;
  if (resolution.kind === "failed") {
    return {
      kind: "failed",
      configurationIndex,
      configuration,
      rankerId: resolution.rankerId,
      reason: resolution.reason,
    };
  }
  let ranking;
  try {
    ranking = resolution.ranker.rank({
      catalog: universe.catalog,
      library: universe.library,
      watchHistory: universe.watchHistory,
      feedback: universe.feedback,
      objectives: universe.objectives,
      policy: EVALUATION_POLICY,
      asOf: universe.asOf,
    });
  } catch (err) {
    return {
      kind: "failed",
      configurationIndex,
      configuration,
      rankerId: resolution.rankerId,
      reason: `the ranker "${resolution.rankerId}" threw during replay: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  return {
    kind: "evaluated",
    configurationIndex,
    configuration,
    rankerId: resolution.rankerId,
    rankerLabel: resolution.rankerLabel,
    resolutionNote: resolution.resolutionNote,
    ranking,
    agreement: computeExplicitFeedbackAgreement({
      replayedFeedback: universe.feedback,
      universeItemIds: input.universeItemIds,
      ranking,
      k: input.k,
    }),
    scoreStats: computeScoreDistribution(ranking),
  };
}

/**
 * Canonical serialization of an evaluation result: plain JSON.stringify
 * over the result object — deterministic because the result is built with
 * fixed key order and deterministically ordered arrays (outcomes in
 * request order, overlaps a<b, itemIds sorted, feedback canonicalized
 * into the metrics). This is the byte-for-byte determinism primitive the
 * corpus test pins (the canonicalRankingJson precedent).
 */
export function canonicalEvaluationJson(result: EvaluationResult): string {
  return JSON.stringify(result);
}
