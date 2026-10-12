/**
 * THIS IS A TEST DOUBLE — IT DOES NO REAL SOURCE ACCESS. It performs NO
 * network calls, NO scraping, NO I/O of any kind: it REPLAYS a canned
 * TransparencyQueryResult for every query (the fixture-replay-ranker /
 * fixture-replay-ads-claim-extractor house pattern), records the calls
 * it received for assertion, and honours the port's cancellation
 * contract at the boundary and (optionally, via `delayMs`) mid-run —
 * the two phases the contract/cancellation tests need a double for.
 *
 * The REAL adapters (./transparency-source-adapters) answer with their
 * constant honest states; this double exists so the authorized-path
 * machinery (the ok status, mid-run cancellation, failure injection)
 * can be exercised hermetically BEFORE any authorization exists. It is
 * exported from the package index beside the other labeled doubles,
 * and NOTHING in production code constructs it.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TransparencyQuery,
  TransparencyQueryResult,
  TransparencySourceDescriptor,
  TransparencySourceManifest,
  TransparencySourceOptions,
  TransparencySourcePort,
} from "webflix-contracts";

/** The double's configuration. */
export interface FixtureReplayTransparencySourceOptions {
  /** The manifest the double declares (any contract-valid manifest). */
  readonly manifest: TransparencySourceManifest;
  /** The canned result every query replays (ok / unavailable / pending / blocked). */
  readonly result: TransparencyQueryResult;
  /** The double's own adapter version (defaults to a fixture marker). */
  readonly version?: string;
  /**
   * When set, query() waits this many milliseconds BEFORE replaying —
   * the mid-run cancellation window (an abort during the wait rejects
   * with the typed common/cancelled error, the future transport
   * adapter's honest mid-run behaviour).
   */
  readonly delayMs?: number;
  /**
   * When set, query() THROWS this value instead of replaying (failure
   * injection for the infrastructure-failure tests).
   */
  readonly failWith?: unknown;
}

/** One recorded call — what the double was asked, and when it aborted. */
export interface FixtureReplaySourceCall {
  readonly query: TransparencyQuery;
  readonly abortedAtBoundary: boolean;
}

/** The labeled test double over the transparency-source port. */
export class FixtureReplayTransparencySource implements TransparencySourcePort {
  readonly descriptor: TransparencySourceDescriptor;
  readonly manifest: TransparencySourceManifest;
  private readonly result: TransparencyQueryResult;
  private readonly delayMs: number | undefined;
  private readonly failWith: unknown;
  private readonly calls: FixtureReplaySourceCall[] = [];

  constructor(options: FixtureReplayTransparencySourceOptions) {
    this.manifest = options.manifest;
    this.descriptor = {
      source: options.manifest.source,
      version: options.version ?? "fixture-replay",
    };
    this.result = options.result;
    this.delayMs = options.delayMs;
    this.failWith = options.failWith;
  }

  /** The calls received so far (assertion surface; a copy, never the live array). */
  recordedCalls(): readonly FixtureReplaySourceCall[] {
    return [...this.calls];
  }

  async query(
    query: TransparencyQuery,
    options?: TransparencySourceOptions,
  ): Promise<TransparencyQueryResult> {
    // Boundary cancellation (the port contract, same as the real adapters).
    const abortedAtBoundary = options?.signal?.aborted === true;
    this.calls.push({ query, abortedAtBoundary });
    if (abortedAtBoundary) {
      throw new WebFlixError({
        code: ErrorCode.Cancelled,
        reason: "the fixture-replay source call was cancelled at the adapter boundary",
        retryable: false,
        context: { phase: "source-boundary", fixture: true },
      });
    }
    if (this.failWith !== undefined) throw this.failWith;

    // The optional mid-run window: an abort during the wait is the
    // cooperative mid-run cancellation (the transport adapter's honest
    // behaviour, replayed).
    if (this.delayMs !== undefined && this.delayMs > 0) {
      const signal = options?.signal;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, this.delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(
            new WebFlixError({
              code: ErrorCode.Cancelled,
              reason: "the fixture-replay source call was cancelled mid-run",
              retryable: false,
              context: { phase: "source-run", fixture: true },
            }),
          );
        };
        if (signal !== undefined) {
          if (signal.aborted) {
            clearTimeout(timer);
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    // Replay the canned result — nothing is fetched, ever.
    return this.result;
  }
}
