/**
 * FixtureReplayRanker — a DETERMINISTIC TEST DOUBLE implementing
 * RankerPort for the evaluation loop's tests (P4-EVALLOOP scope row 5).
 *
 * *** THIS IS A TEST DOUBLE — IT DOES NO REAL RANKING. ***
 *
 * It replays a CANNED RankingResult supplied by the test, which is
 * exactly what the evaluation loop needs to prove its honest-comparison
 * contract without any model:
 * - DETERMINISM: the same canned result every call, byte-for-byte (no
 *   randomness, no wall clock, no filesystem — the canonical
 *   deterministic-adapter evidence for the corpus pins);
 * - INPUT RECORDING: every RankerInput is recorded verbatim (frozen
 *   shallow copy) for assertions — the replay's universe filtering and
 *   signal passing are observable;
 * - FAILURE INJECTION: `failOnCall` makes the double THROW on the Nth
 *   call — the per-configuration fail-soft path (a ranker that throws
 *   mid-evaluation must surface as a failed OUTCOME, never a job
 *   failure);
 * - NO INVENTED VALUES: the double returns the canned result or throws —
 *   it never fabricates a ranking the test did not supply.
 *
 * No network, no store access, no writes: the double is pure over its
 * canned script. A registry-entry helper builds the RankerAdapterEntry
 * the injected registries carry, with the TEST DOUBLE label visible in
 * the entry's presentation copy.
 */
import type { RankerPort, RankingResult, RankerInput } from "webflix-contracts";
import type { RankerAdapterEntry } from "./ranker-adapter-registry";

/** The test double's adapter identity (OUR code's — always known). */
export const FIXTURE_REPLAY_RANKER_ID = "webflix.fixture-replay-ranker";
export const FIXTURE_REPLAY_RANKER_VERSION = "0.1.0";
export const FIXTURE_REPLAY_RANKER_LABEL = "Fixture-replay ranker (TEST DOUBLE — no real ranking)";

/** What the double replays, supplied entirely by the test. */
export interface FixtureReplayRankerScript {
  /** The canned ranking, returned verbatim on every non-failing call. */
  readonly ranking: RankingResult;
  /** Throw on the Nth call (1-based); undefined = never. */
  readonly failOnCall?: number;
}

/** Call facts recorded for assertions (deterministic — order of arrival). */
export interface FixtureReplayRankerCall {
  readonly input: RankerInput;
}

export class FixtureReplayRanker implements RankerPort {
  private readonly recording: FixtureReplayRankerCall[] = [];

  /** Read-only snapshot of every recorded call (assertion evidence). */
  get calls(): readonly FixtureReplayRankerCall[] {
    return this.recording.map((call) => ({ input: call.input }));
  }

  constructor(private readonly script: FixtureReplayRankerScript) {}

  rank(input: RankerInput): RankingResult {
    const callNumber = this.recording.length + 1;
    this.recording.push({ input });
    if (this.script.failOnCall !== undefined && callNumber >= this.script.failOnCall) {
      throw new Error(
        `fixture-replay ranker reported its own failure on call ${callNumber} (injected)`,
      );
    }
    return this.script.ranking;
  }

  /** The registry entry an injected registry carries for this double. */
  toRegistryEntry(): RankerAdapterEntry {
    return {
      id: FIXTURE_REPLAY_RANKER_ID,
      label: FIXTURE_REPLAY_RANKER_LABEL,
      description:
        "A TEST DOUBLE ranker that replays a canned ranking — no real ranking, no model, no network. Used only by tests to exercise the evaluation loop's comparison and fail-soft paths.",
      capabilities: ["deterministic", "local", "test-double"],
      ranker: this,
    };
  }
}
