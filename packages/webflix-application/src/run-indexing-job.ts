/**
 * RunIndexingJob — cancellable, retryable driver for local indexing jobs.
 *
 * Semantics:
 *   - Paths are sanitised locally; rejected inputs never reach the indexer.
 *   - Unprobed paths are retried with fresh jobs until `maxAttempts` passes
 *     have run in total (default 3, minimum 1).
 *   - The wait between retries is INJECTED (`deps.delayMs`): the runner never
 *     hardcodes a real-timer wait. When omitted it falls back to
 *     `fixedBackoff(input.retryDelayMs)` — the production default, which
 *     sleeps on a real timer ONLY when a positive `retryDelayMs` is
 *     configured (0 by default, so the default retry path is timer-free as
 *     well). Tests inject an immediate, deterministic strategy.
 *   - An aborted signal cancels the running job and stops further attempts;
 *     paths successfully probed before cancellation are kept.
 *   - Every attempt's progress events are forwarded to `onProgress` verbatim.
 */
import type { IndexingPort, IndexingProgress, IndexingStatus } from "./ports";
import type { TrackProbe } from "./types";
import {
  cancelOnAbort,
  fixedBackoff,
  sleep,
  waitForIndexingResult,
  type BackoffDelay,
} from "./indexing-session";
import { sanitizePaths } from "./path-safety";

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface RunIndexingJobInput {
  readonly paths: readonly string[];
  /** Total passes per path (first attempt + retries). Default 3, minimum 1. */
  readonly maxAttempts?: number;
  /**
   * Production-only convenience: fixed inter-retry pause in ms, consumed by
   * the default backoff when `deps.delayMs` is NOT injected. 0 (the default)
   * waits not at all. Ignored entirely when a `delayMs` strategy is injected.
   */
  readonly retryDelayMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: IndexingProgress) => void;
}

export interface IndexedPathOutcome {
  readonly path: string;
  readonly probe: TrackProbe | null;
  /** Pass on which this outcome was produced (0 for locally rejected paths). */
  readonly attempts: number;
  /** Failure reason; null for successes. */
  readonly reason: string | null;
}

export interface RunIndexingJobOutput {
  /** Terminal status of the last attempt that ran. */
  readonly status: IndexingStatus;
  readonly succeeded: readonly IndexedPathOutcome[];
  readonly failed: readonly IndexedPathOutcome[];
  readonly cancelled: boolean;
  readonly attemptsRun: number;
}

export interface RunIndexingJobDeps {
  readonly indexing: IndexingPort;
  /**
   * Backoff strategy consulted before each RETRY attempt (never before the
   * first) with the 1-based number of the completed attempt — see
   * `BackoffDelay`. Injected instead of hardcoding a timer wait so tests stay
   * deterministic and timer-free. Omitted => `fixedBackoff(input.retryDelayMs)`
   * (the real-timer production default, a no-op while `retryDelayMs` is 0).
   */
  readonly delayMs?: BackoffDelay;
}

export class RunIndexingJob {
  constructor(private readonly deps: RunIndexingJobDeps) {}

  async execute(input: RunIndexingJobInput): Promise<RunIndexingJobOutput> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const backoff = this.deps.delayMs ?? fixedBackoff(input.retryDelayMs);
    const { valid, rejected } = sanitizePaths(input.paths);

    const succeeded: IndexedPathOutcome[] = [];
    const failures = new Map<string, IndexedPathOutcome>();
    for (const item of rejected) {
      failures.set(item.path, { path: item.path, probe: null, attempts: 0, reason: item.reason });
    }

    let pending = [...valid];
    let attemptsRun = 0;
    let cancelled = false;
    let lastStatus: IndexingStatus = "completed";

    while (
      pending.length > 0 &&
      attemptsRun < maxAttempts &&
      !cancelled &&
      !input.signal?.aborted
    ) {
      if (attemptsRun > 0) {
        // The inter-retry wait lives entirely behind the injected strategy —
        // never a hardcoded timer on this path.
        const wait = backoff(attemptsRun);
        if (typeof wait === "number") {
          if (wait > 0) await sleep(wait);
        } else {
          await wait;
        }
      }
      attemptsRun += 1;
      const handle = await this.deps.indexing.start(pending);
      cancelOnAbort(this.deps.indexing, handle.jobId, input.signal);
      const result = await waitForIndexingResult(
        this.deps.indexing,
        handle.jobId,
        input.onProgress,
      );
      lastStatus = result.status;

      const probedPaths = new Set<string>();
      for (const probe of result.probes) {
        probedPaths.add(probe.path);
        failures.delete(probe.path);
        succeeded.push({ path: probe.path, probe, attempts: attemptsRun, reason: null });
      }

      const nextPending: string[] = [];
      for (const path of pending) {
        if (probedPaths.has(path)) continue;
        const perPath = result.failures.find((failure) => failure.path === path);
        const reason =
          perPath?.reason ??
          (result.status === "cancelled"
            ? "cancelled"
            : (result.error ?? `indexing ${result.status}`));
        failures.set(path, { path, probe: null, attempts: attemptsRun, reason });
        nextPending.push(path);
      }
      pending = nextPending;

      if (result.status === "cancelled") {
        cancelled = true;
      }
    }

    if (input.signal?.aborted) {
      cancelled = true;
    }

    for (const path of pending) {
      // Never probed at all (pre-aborted, or the indexer dropped the path).
      if (!failures.has(path)) {
        failures.set(path, {
          path,
          probe: null,
          attempts: attemptsRun,
          reason: cancelled ? "cancelled" : "indexer did not report this path",
        });
      }
    }

    return {
      status: cancelled ? "cancelled" : lastStatus,
      succeeded,
      failed: [...failures.values()],
      cancelled,
      attemptsRun,
    };
  }
}
