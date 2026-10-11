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
 * - The default ranker is the built-in deterministic v1 (./built-in-ranker,
 *   contracts-only); `deps.ranker` overrides it for tests and, later,
 *   user-selected adapters (P4-ADAPTERS) — never a hidden LLM, no network
 *   in any implementation.
 *
 * The three job transitions used here are the frozen §2.6 table rows
 * `queued -> cancelled`, `queued -> running`, `running -> succeeded`
 * (webflix-domain's JOB_TRANSITIONS is the authority; the stamps follow its
 * transitionJob rules: startedAt on entering running, finishedAt on any
 * terminal state — inlined because application cannot import webflix-domain
 * this order, see the P4-FD1 proposal).
 */
import { JobDescriptorSchema, RankingPolicySchema } from "webflix-contracts";
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
import type { ClockPort, IdGenerator } from "./ports";
import { parseContractOrThrow } from "./contract-parse";
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
    parseContractOrThrow(
      RankingPolicySchema,
      input.policy,
      ErrorCode.IntelligencePolicyUnsupported,
      "RankingPolicy",
    );
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseContractOrThrow(
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
      const cancelled = stampTerminal(job, "cancelled", createdAt);
      return { job: cancelled, ranking: null, canonical: null };
    }

    // 3. Run: queued -> running -> succeeded; synchronous pure computation.
    const startInstant = this.deps.clock.now().toISOString();
    const running: JobDescriptor = {
      ...job,
      state: "running",
      startedAt: job.startedAt ?? startInstant,
      updatedAt: startInstant,
    };
    parseContractOrThrow(
      JobDescriptorSchema,
      running,
      ErrorCode.IntelligenceRankingInvalid,
      "JobDescriptor(running)",
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
    const succeeded = stampTerminal(running, "succeeded", finishedInstant);
    return { job: succeeded, ranking, canonical: canonicalRankingJson(ranking) };
  }
}

/** Terminal stamp per the frozen transitionJob rules (finishedAt on terminal states). */
function stampTerminal(
  job: JobDescriptor,
  state: "cancelled" | "succeeded",
  at: string,
): JobDescriptor {
  const next: JobDescriptor = { ...job, state, updatedAt: at, finishedAt: at };
  parseContractOrThrow(
    JobDescriptorSchema,
    next,
    ErrorCode.IntelligenceRankingInvalid,
    `JobDescriptor(${state})`,
  );
  return next;
}
