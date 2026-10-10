/**
 * Shared plumbing for use-cases that drive an `IndexingPort` job to its
 * terminal event. Pure session mechanics — no business rules.
 */
import type { IndexingPort, IndexingProgress, IndexingResult } from './ports';

/**
 * Subscribe to `jobId` and resolve with the job's terminal `IndexingResult`.
 *
 * Relies on the `IndexingPort` contract: the adapter emits exactly one event
 * whose `result` is non-null (the terminal event). Progress-sink errors are
 * swallowed so a misbehaving listener cannot corrupt the job.
 */
export function waitForIndexingResult(
  indexing: IndexingPort,
  jobId: string,
  onProgress?: (progress: IndexingProgress) => void,
): Promise<IndexingResult> {
  return new Promise((resolve) => {
    const unsubscribe = indexing.onProgress(jobId, (progress) => {
      try {
        onProgress?.(progress);
      } catch {
        // Progress sinks are observability-only.
      }
      if (progress.result !== null) {
        unsubscribe();
        resolve(progress.result);
      }
    });
  });
}

/**
 * Wire an `AbortSignal` to `IndexingPort.cancel` for the given job. Handles
 * the already-aborted case; safe to call once per job.
 */
export function cancelOnAbort(indexing: IndexingPort, jobId: string, signal?: AbortSignal): void {
  if (!signal) return;
  const cancel = (): void => {
    void indexing.cancel(jobId).catch(() => undefined);
  };
  if (signal.aborted) {
    cancel();
    return;
  }
  signal.addEventListener('abort', cancel, { once: true });
}

/**
 * Backoff strategy for retryable use-cases (see `RunIndexingJob`).
 *
 * Invoked once per RETRY (never before the first attempt) with the 1-based
 * number of the attempt that just completed. The return value decides how
 * long to wait before the next attempt:
 *
 *   - `number`           -> wait that many milliseconds via `sleep` (the REAL
 *                          timer); values <= 0 skip the timer entirely;
 *   - `Promise<void>`    -> awaited verbatim; an already-resolved promise lets
 *                          the retry proceed on the next microtask with zero
 *                          timers (what the test harness injects);
 *   - `void`/`undefined` -> no wait at all.
 *
 * This seam exists so NO use-case ever hardcodes a real-timer wait: tests
 * inject a deterministic zero delay, production can inject exponential
 * backoff, and the previous hardcoded behavior remains available as the
 * default via `fixedBackoff`.
 */
export type BackoffDelay = (completedAttempt: number) => number | Promise<void> | void;

/**
 * Production default backoff: wait a fixed `ms` before every retry.
 * `ms <= 0` (the zero default) never touches the timer, so the default retry
 * path is timer-free too; only an explicitly configured positive pause
 * reaches `sleep`.
 */
export function fixedBackoff(ms: number | undefined): BackoffDelay {
  const waitMs = Math.max(0, ms ?? 0);
  return () => waitMs;
}

/**
 * REAL-TIMER sleep — production backoff primitive ONLY.
 *
 * Never reached on test paths: the test harness injects a timer-free
 * `BackoffDelay`, so `execute()` never awaits a timer there. Production
 * callers reach this only through an explicitly positive wait (e.g.
 * `fixedBackoff(500)`), keeping the hardcoded-wait failure mode impossible.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
