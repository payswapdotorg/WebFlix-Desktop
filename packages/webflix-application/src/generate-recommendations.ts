/**
 * GenerateRecommendations — pure, deterministic, LOCAL-signal ranking behind
 * a §2.6 job wrapper (P4-CONTRACTS scope row 3; phase4-mi-plan §2: jobs RIDE
 * the frozen JobDescriptor/JobState, never re-invent it).
 *
 * Semantics, stated honestly:
 * - LOCAL SIGNALS ONLY (phase4-mi-plan §5): the caller supplies the catalog
 *   snapshot, the library facts, the §2.4 watch states, the feedback
 *   history and the objective — nothing is read from providers, no network
 *   exists anywhere in this path. Per-user/per-profile isolation is the
 *   caller's construction rule (ADR-0003): one profile's data per call.
 * - Inputs are validated BEFORE the job exists (typed Intelligence errors;
 *   invalid input is a caller defect, not a job failure).
 * - Job kind `mi.generate-recommendations`, cancellable: true. Cancellation
 *   is honoured at the boundary: an already-aborted signal (checked before
 *   execution starts) transitions the job straight to Cancelled and
 *   DISCARDS the results (documented choice — partial results are
 *   discarded, never marked as complete). Once the synchronous pure
 *   computation starts it runs to completion (sub-millisecond; no await
 *   point inside), so a mid-run cancel cannot occur — there is nothing to
 *   interrupt.
 * - `asOf` for recency signals is stamped from the job's start instant and
 *   is part of the ranked INPUTS: the ranked payload itself carries no
 *   timestamps, so the same inputs (including asOf) always produce
 *   byte-for-byte the same payload (canonicalRankingJson). Job metadata
 *   (ids, timestamps) lives ONLY in the descriptor, never in the payload.
 * - The default ranker is the built-in deterministic v1 (./built-in-ranker);
 *   `deps.ranker` overrides it for tests and, later, user-selected adapters
 *   (P4-ADAPTERS) — never a hidden LLM, no network in any implementation.
 *
 * The three job transitions used here ride webflix-domain's transitionJob
 * (P4-ARTIFACTS row 0 collapse: the frozen §2.6 table rows `queued ->
 * cancelled`, `queued -> running`, `running -> succeeded` were inlined
 * while the application->domain edge was missing; the edge landed, so the
 * stamps now come from the domain authority — startedAt on entering
 * running, finishedAt on any terminal state — with identical descriptor
 * results, pinned by the corpus and wrapper tests).
 */
import { JobDescriptorSchema, RankingPolicySchema, WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";
import type {
  CatalogItem,
  FeedbackEvent,
  JobDescriptor,
  LibraryFact,
  RankerPort,
  RankingPolicy,
  RankingResult,
  UserObjective,
  WatchedState,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type { ClockPort, IdGenerator } from "./ports";
import {
  BUILT_IN_RANKER,
  BUILT_IN_RANKER_ID,
  BUILT_IN_RANKER_VERSION,
  canonicalRankingJson,
} from "./built-in-ranker";

export const MI_JOB_KIND = "mi.generate-recommendations";

export interface GenerateRecommendationsInput {
  readonly catalog: readonly CatalogItem[];
  readonly library: readonly LibraryFact[];
  readonly watchHistory: readonly WatchedState[];
  readonly feedback: readonly FeedbackEvent[];
  readonly objectives: UserObjective | null;
  readonly policy: RankingPolicy;
  /** Honoured at the job boundary: an already-aborted signal yields a Cancelled job with no results. */
  readonly signal?: AbortSignal;
}

export interface GenerateRecommendationsOutput {
  /** Terminal descriptor: state `succeeded` (with ranking) or `cancelled` (ranking null). */
  readonly job: JobDescriptor;
  /** The ranked payload; null iff the job was cancelled (results discarded). */
  readonly ranking: RankingResult | null;
  /** Canonical JSON of the payload — byte-for-byte reproducible for the same inputs. */
  readonly canonical: string | null;
}

export interface GenerateRecommendationsDeps {
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
  /** Defaults to the built-in deterministic ranker (v1); overridable for tests and user-selected adapters. */
  readonly ranker?: RankerPort;
}

export class GenerateRecommendations {
  constructor(private readonly deps: GenerateRecommendationsDeps) {}

  async execute(input: GenerateRecommendationsInput): Promise<GenerateRecommendationsOutput> {
    // 1. Validate inputs BEFORE the job exists — caller defects are typed
    //    Intelligence errors, never job failures.
    parseOrThrow(
      RankingPolicySchema,
      input.policy,
      ErrorCode.IntelligencePolicyUnsupported,
      "RankingPolicy",
    );
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: MI_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: BUILT_IN_RANKER_ID,
          connectorVersion: BUILT_IN_RANKER_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          policyVersion: input.policy.version,
          catalogCount: input.catalog.length,
          libraryCount: input.library.length,
          watchHistoryCount: input.watchHistory.length,
          feedbackCount: input.feedback.length,
          objectivesSet: input.objectives !== null,
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.IntelligenceRankingInvalid,
      "JobDescriptor",
    );

    // 2. Cancellation at the boundary: queued -> cancelled, results discarded.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, ranking: null, canonical: null };
    }

    // 3. Run: queued -> running -> succeeded; synchronous pure computation.
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );

    const ranker = this.deps.ranker ?? BUILT_IN_RANKER;
    const ranking = ranker.rank({
      catalog: input.catalog,
      library: input.library,
      watchHistory: input.watchHistory,
      feedback: input.feedback,
      objectives: input.objectives,
      policy: input.policy,
      asOf: running.startedAt ?? startInstant,
    });

    const finishedInstant = this.deps.clock.now().toISOString();
    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", finishedInstant),
      "running -> succeeded",
    );
    return { job: succeeded, ranking, canonical: canonicalRankingJson(ranking) };
  }
}

/**
 * Unwraps a domain transition result. The three rows used above are
 * structurally legal (a freshly-constructed queued job; the running job it
 * becomes), so a rejection is an internal invariant break — surfaced as a
 * typed IntelligenceRankingInvalid instead of being swallowed.
 */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceRankingInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
