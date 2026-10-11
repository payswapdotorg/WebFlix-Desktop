/**
 * mi.evaluate — the experiment/evaluation loop use case (P4-EVALLOOP
 * scope row 3), riding the frozen §2.6 JobDescriptor/JobState wrapper
 * (the mi-text-intelligence precedent: MI jobs RIDE §2.6, never re-invent
 * it).
 *
 * NOT A DerivedArtifact — a recorded decision (the charter's own words):
 * the evaluation result is returned in the JOB RESULT and persisted
 * nowhere. An evaluation is an experiment read-out, not a derived
 * artifact of a catalog item: it describes no catalog item (it compares
 * ranker configurations over a whole universe), it has no
 * original/derived relationship the artifact registry tracks, and its
 * lineage question ("what produced this?") is answered by the §2.6 job
 * descriptor itself. Consequently this module holds NO reference to the
 * artifact registry AT ALL — structurally incapable of writing one — and
 * writes NOTHING back into ranking state (offline means offline: the
 * loop informs the USER, never mutates the live ranker).
 *
 * READ-ONLY over every store (the charter's hard rule): the feedback
 * store's `list` (+ per-id lookup through the listed events), the
 * objective store's `get` and the ranker-selection store's `get` are the
 * ONLY store calls in the evaluation path — no put, no append, no clear
 * exists anywhere here, and the caller's catalog/library/watch arrays are
 * read without mutation (pinned by deep-equal tests).
 *
 * Semantics, stated honestly:
 * - CALLER DEFECTS validated BEFORE the job exists (typed
 *   IntelligenceEvaluationInvalid, never job failures): a malformed
 *   request (duplicate universe/filter ids, literal-duplicate
 *   configurations, an empty configuration list, k < 1, a non-ISO asOf —
 *   the schema's own refinements) and universe ids ABSENT from the
 *   supplied catalog snapshot (the request and the snapshot disagree).
 * - READ-TIME STATE: a feedbackEventIds entry the store does not know is
 *   a caller defect discovered at read time — the job is stamped FAILED
 *   and the typed error rethrown through EvaluationJobError (cause's code
 *   intact), the mi-text-intelligence pattern.
 * - CANCELLATION, BOTH PHASES: at the BOUNDARY an already-aborted signal
 *   transitions queued -> cancelled BEFORE anything is read or run; MID-
 *   RUN there is a cooperative checkpoint BEFORE each ranker
 *   configuration (a deterministic microtask yield + signal re-read —
 *   the rank calls themselves are synchronous pure computations, exactly
 *   like generate-recommendations' "nothing to interrupt" note). A
 *   cancelled run returns Cancelled with result null — NO partial result
 *   (the loop's partial outcomes are discarded, never surfaced as if
 *   complete).
 * - PER-CONFIGURATION FAIL-SOFT: a configuration that cannot run (an
 *   unknown adapter id — registry drift — or a ranker that threw) does
 *   NOT fail the job: the outcome honestly reports the failure as data
 *   and the OTHER sides still evaluate (the honest comparison never
 *   throws away the sides that could run).
 * - HONEST EMPTIES: zero stored feedback, or an empty item universe,
 *   evaluates normally to population-0 results with null shares — typed
 *   honest results, never errors, never invented numbers.
 */
import {
  ErrorCode,
  EvaluationRequestSchema,
  EvaluationResultSchema,
  JobDescriptorSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  EvaluationOutcome,
  EvaluationRequest,
  EvaluationResult,
  JobDescriptor,
  LibraryFact,
  RankerAdapterSelection,
  UserObjective,
  WatchedState,
} from "webflix-contracts";
import { parseOrThrow, transitionJob } from "webflix-domain";
import type { ClockPort, FeedbackStore, IdGenerator, ObjectiveStore } from "./ports";
import type { RankerAdapterRegistry } from "./ranker-adapter-registry";
import { DEFAULT_RANKER_ADAPTER_REGISTRY } from "./ranker-adapter-registry";
import type { RankerSelectionStore } from "./ranker-adapter-selection";
import {
  EVALUATION_REPLAY_ID,
  EVALUATION_REPLAY_VERSION,
  buildEvaluationUniverse,
  canonicalEvaluationJson,
  replayOneConfiguration,
  resolveEvaluationRanker,
} from "./evaluation-replay";
import { computePairwiseOverlaps } from "./evaluation-metrics";

export const EVALUATE_JOB_KIND = "mi.evaluate";

// ---------------------------------------------------------------------------
// Inputs / outputs / deps
// ---------------------------------------------------------------------------

/**
 * The evaluation input: the caller's replay snapshot (the §2.1 catalog
 * snapshot + library facts + §2.4 watch states — the GenerateRecommendations
 * input shapes, the ADR-0003 caller-supplied rule) plus the
 * profile-scoped request (universe, configurations, k, asOf, optional
 * feedback scope). The stored feedback, objectives and selection are read
 * READ-ONLY from the per-profile stores by this use case.
 */
export interface EvaluateInput {
  readonly catalog: readonly CatalogItem[];
  readonly library: readonly LibraryFact[];
  readonly watchHistory: readonly WatchedState[];
  readonly request: EvaluationRequest;
  /** Honoured at the job boundary AND at the checkpoint before each configuration. */
  readonly signal?: AbortSignal;
}

export interface EvaluateOutput {
  /** Terminal descriptor: succeeded (with result) / cancelled / failed-stamped-on-throw. */
  readonly job: JobDescriptor;
  /** The evaluation read-out on success; null on cancellation AND failure. */
  readonly result: EvaluationResult | null;
  /** Canonical JSON of the read-out — byte-for-byte reproducible for the same inputs. */
  readonly canonical: string | null;
}

export interface EvaluateDeps {
  readonly feedback: FeedbackStore;
  readonly objectives: ObjectiveStore;
  /** The per-profile ranker selection (READ ONCE per run; never written here). */
  readonly selection: RankerSelectionStore;
  /** Defaults to the static default registry (the documented default). */
  readonly registry?: RankerAdapterRegistry;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** mi.evaluate — the offline experiment/evaluation loop. */
export class RunEvaluation {
  private readonly registry: RankerAdapterRegistry;

  constructor(private readonly deps: EvaluateDeps) {
    this.registry = deps.registry ?? DEFAULT_RANKER_ADAPTER_REGISTRY;
  }

  async execute(input: EvaluateInput): Promise<EvaluateOutput> {
    // 1. Caller defects validated BEFORE the job exists (typed errors,
    //    never job failures). The schema's refinements carry the request
    //    shape rules (duplicates, empty sides, k, asOf).
    const request = parseOrThrow(
      EvaluationRequestSchema,
      input.request,
      ErrorCode.IntelligenceEvaluationInvalid,
      "EvaluationRequest",
    );
    const catalogIds = new Set(input.catalog.map((item) => item.id));
    const unknownItemIds = request.itemIds.filter((id) => !catalogIds.has(id));
    if (unknownItemIds.length > 0) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceEvaluationInvalid,
        reason: `request.itemIds names ids absent from the supplied catalog snapshot: ${unknownItemIds
          .slice()
          .sort()
          .join(", ")}`,
        retryable: false,
        context: { unknownItemIds: [...unknownItemIds].sort(), jobKind: EVALUATE_JOB_KIND },
      });
    }
    const signalState: "aborted" | "live" = input.signal?.aborted === true ? "aborted" : "live";

    const createdAt = this.deps.clock.now().toISOString();
    const job: JobDescriptor = parseOrThrow(
      JobDescriptorSchema,
      {
        id: this.deps.generateId(),
        kind: EVALUATE_JOB_KIND,
        state: "queued",
        priority: 0,
        cancellable: true,
        cancelRequested: false,
        retry: { maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] },
        provenance: {
          connectorId: EVALUATION_REPLAY_ID,
          connectorVersion: EVALUATION_REPLAY_VERSION,
          generatedAt: createdAt,
        },
        payload: {
          configurationCount: request.configurations.length,
          itemsUnderTest: request.itemIds.length,
          k: request.k,
          feedbackScope: request.feedbackEventIds === undefined ? "all" : "filtered",
          ...(request.feedbackEventIds !== undefined
            ? { feedbackEventIdsCount: request.feedbackEventIds.length }
            : {}),
          signalState,
        },
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
      ErrorCode.IntelligenceEvaluationInvalid,
      "JobDescriptor",
    );

    // 2. Boundary cancellation: queued -> cancelled, nothing read, nothing run.
    if (signalState === "aborted") {
      const cancelled = expectTransitioned(
        transitionJob(job, "cancelled", createdAt),
        "queued -> cancelled",
      );
      return { job: cancelled, result: null, canonical: null };
    }

    // 3. Run: queued -> running; READ the stored feedback + objective +
    //    selection (read-only; read-time failures stamp the job failed).
    const startInstant = this.deps.clock.now().toISOString();
    const running = expectTransitioned(
      transitionJob(job, "running", startInstant),
      "queued -> running",
    );

    let replayedFeedback;
    let feedbackTotalStored: number;
    let objective: UserObjective | null;
    let selection: RankerAdapterSelection | null;
    try {
      const stored = await this.deps.feedback.list();
      feedbackTotalStored = stored.length;
      if (request.feedbackEventIds === undefined) {
        replayedFeedback = stored;
      } else {
        // The scope filter: replay exactly the named events. An unknown id
        // is a caller defect discovered at read time — typed, job failed.
        const byId = new Map(stored.map((event) => [event.id, event] as const));
        const scoped = [];
        for (const id of request.feedbackEventIds) {
          const event = byId.get(id);
          if (event === undefined) {
            throw new WebFlixError({
              code: ErrorCode.IntelligenceEvaluationInvalid,
              reason: `feedback event "${id}" is not in the store — the replay scope names unknown events`,
              retryable: false,
              context: { feedbackEventId: id, jobKind: EVALUATE_JOB_KIND },
            });
          }
          scoped.push(event);
        }
        replayedFeedback = scoped;
      }
      objective = await this.deps.objectives.get();
      selection = await this.deps.selection.get();
    } catch (err) {
      throw jobFailure(this.deps, running, err);
    }

    // 4. The replay loop — one configuration per iteration, a cooperative
    //    cancellation checkpoint BEFORE each (a deterministic microtask
    //    yield + signal re-read; the rank calls are synchronous and pure).
    //    A cancelled loop discards its partial outcomes: NO partial result.
    const universe = buildEvaluationUniverse({
      catalog: input.catalog,
      library: input.library,
      watchHistory: input.watchHistory,
      feedback: replayedFeedback,
      objectives: objective,
      request,
    });
    const universeItemIds = new Set(request.itemIds);
    const outcomes: EvaluationOutcome[] = [];
    for (let index = 0; index < request.configurations.length; index += 1) {
      await Promise.resolve();
      if (input.signal?.aborted === true) {
        const cancelled = expectTransitioned(
          transitionJob(running, "cancelled", this.deps.clock.now().toISOString()),
          "running -> cancelled",
        );
        return { job: cancelled, result: null, canonical: null };
      }
      const configuration = request.configurations[index]!;
      const resolution = resolveEvaluationRanker({
        configuration,
        registry: this.registry,
        selection,
      });
      outcomes.push(
        replayOneConfiguration({
          configuration,
          configurationIndex: index,
          universe,
          resolution,
          universeItemIds,
          k: request.k,
        }),
      );
    }

    // 5. Assemble the read-out (populations named; canonical itemIds) and
    //    self-check it through the locked schema — a malformed result can
    //    never leave this use case (the built-in ranker's self-check
    //    discipline, applied to the whole result).
    let explicitUnderTest = 0;
    let implicitUnderTest = 0;
    for (const event of universe.feedback) {
      if (!universeItemIds.has(event.itemId)) continue;
      if (event.channel === "explicit") explicitUnderTest += 1;
      else implicitUnderTest += 1;
    }
    let result: EvaluationResult;
    try {
      result = parseOrThrow(
        EvaluationResultSchema,
        {
          k: request.k,
          asOf: request.asOf,
          itemIds: [...request.itemIds].sort(),
          replay: {
            feedbackTotalStored,
            feedbackReplayed: universe.feedback.length,
            explicitUnderTest,
            implicitUnderTest,
            objectivesApplied: objective !== null,
            itemsUnderTest: request.itemIds.length,
          },
          outcomes,
          pairwiseOverlaps: computePairwiseOverlaps(outcomes, request.k),
        },
        ErrorCode.IntelligenceEvaluationInvalid,
        "EvaluationResult",
      );
    } catch (err) {
      throw jobFailure(this.deps, running, err);
    }

    const succeeded = expectTransitioned(
      transitionJob(running, "succeeded", this.deps.clock.now().toISOString()),
      "running -> succeeded",
    );
    return { job: succeeded, result, canonical: canonicalEvaluationJson(result) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The typed error every in-job failure rethrows as: the cause's own typed
 * error (code/reason/context intact) plus the FAILED JobDescriptor for
 * inspection. `code` mirrors the cause's so generic handlers see the honest
 * code without unwrapping (the TextIntelligenceJobError pattern, verbatim).
 */
export class EvaluationJobError extends WebFlixError {
  readonly job: JobDescriptor;
  constructor(init: { job: JobDescriptor; cause: WebFlixError }) {
    super({
      code: init.cause.code,
      reason: init.cause.reason,
      retryable: init.cause.retryable,
      context: init.cause.context,
    });
    this.name = "EvaluationJobError";
    this.job = init.job;
    this.cause = init.cause;
  }
}

/** Stamps the running job FAILED with the error's description and wraps it. */
function jobFailure(deps: EvaluateDeps, running: JobDescriptor, err: unknown): EvaluationJobError {
  const failed = expectTransitioned(
    transitionJob(running, "failed", deps.clock.now().toISOString()),
    "running -> failed",
  );
  return new EvaluationJobError({
    job: { ...failed, lastError: describeError(err) },
    cause: asWebFlixErrorOrWrap(err),
  });
}

/** Human-readable, secret-free description of an error for lastError. */
function describeError(err: unknown): string {
  if (WebFlixError.is(err)) {
    return `${err.code}: ${err.reason}`;
  }
  return `evaluation error: ${err instanceof Error ? err.message : String(err)}`;
}

/** Rethrows the error as a WebFlixError (wrapping unknown shapes, code intact). */
function asWebFlixErrorOrWrap(err: unknown): WebFlixError {
  if (WebFlixError.is(err)) return err;
  return new WebFlixError({
    code: ErrorCode.IntelligenceEvaluationInvalid,
    reason: `the evaluation replay reported an unrecognized failure: ${
      err instanceof Error ? err.message : String(err)
    }`,
    retryable: false,
    context: {},
  });
}

/** Unwraps a domain transition result (typed evaluation-invalid on break). */
function expectTransitioned(
  transition: ReturnType<typeof transitionJob>,
  what: string,
): JobDescriptor {
  if (transition.outcome !== "transitioned") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceEvaluationInvalid,
      reason: `job transition ${what} was rejected by the domain state machine: ${transition.reason}`,
      retryable: false,
      context: { transition: what },
    });
  }
  return transition.job;
}
