/**
 * FixtureReplayRanker TEST DOUBLE contract tests (P4-EVALLOOP scope row
 * 5). Pins the double's own honesty rules so the evaluation tests built
 * on it stay trustworthy:
 * - DETERMINISM: the canned ranking returns verbatim, every call;
 * - INPUT RECORDING: every RankerInput is captured for assertions;
 * - FAILURE INJECTION: failOnCall throws on the Nth call and AFTER;
 * - NO INVENTED VALUES: it never fabricates a ranking it was not given;
 * - the registry-entry helper carries the TEST DOUBLE label visibly.
 */
import { describe, expect, it } from "vitest";
import type { RankerInput, RankingResult } from "webflix-contracts";
import {
  FixtureReplayRanker,
  FIXTURE_REPLAY_RANKER_ID,
  FIXTURE_REPLAY_RANKER_LABEL,
} from "../fixture-replay-ranker";

const AS_OF = "2026-10-11T08:00:00Z";

const CANNED: RankingResult = {
  kind: "ranked",
  policyVersion: "v1",
  items: [
    {
      itemId: "item-a",
      score: 0.9,
      reasons: [
        {
          family: "library-affinity",
          text: "canned reason",
          contribution: 0.1,
          evidence: [{ kind: "library-fact", itemId: "item-a" }],
        },
      ],
    },
  ],
};

const INPUT: RankerInput = {
  catalog: [],
  library: [],
  watchHistory: [],
  feedback: [],
  objectives: null,
  policy: { version: "v1" },
  asOf: AS_OF,
};

describe("FixtureReplayRanker (TEST DOUBLE)", () => {
  it("replays the canned ranking verbatim — deterministically, every call", () => {
    const double = new FixtureReplayRanker({ ranking: CANNED });
    expect(double.rank(INPUT)).toEqual(CANNED);
    expect(double.rank(INPUT)).toEqual(CANNED);
    expect(double.rank(INPUT)).toEqual(CANNED);
  });

  it("records every call's input verbatim for assertions", () => {
    const double = new FixtureReplayRanker({ ranking: CANNED });
    double.rank(INPUT);
    double.rank({ ...INPUT, asOf: "2026-10-10T08:00:00Z" });
    expect(double.calls).toHaveLength(2);
    expect(double.calls[0]?.input.asOf).toBe(AS_OF);
    expect(double.calls[1]?.input.asOf).toBe("2026-10-10T08:00:00Z");
  });

  it("the recording is a READ-ONLY snapshot — later calls do not mutate it", () => {
    const double = new FixtureReplayRanker({ ranking: CANNED });
    double.rank(INPUT);
    const snapshot = double.calls;
    double.rank(INPUT);
    expect(snapshot).toHaveLength(1);
    expect(double.calls).toHaveLength(2);
  });

  it("failOnCall throws on the Nth call AND every call after (a sticky failure)", () => {
    const double = new FixtureReplayRanker({ ranking: CANNED, failOnCall: 2 });
    expect(double.rank(INPUT)).toEqual(CANNED); // call 1: fine
    expect(() => double.rank(INPUT)).toThrow("call 2"); // call 2: injected failure
    expect(() => double.rank(INPUT)).toThrow("call 3"); // sticky
    expect(double.calls).toHaveLength(3); // the throwing calls are still recorded
  });

  it("never invents values: the double returns the canned result or throws — nothing else", () => {
    const empty: RankingResult = { kind: "empty", policyVersion: "v1", reason: "empty-catalog" };
    const double = new FixtureReplayRanker({ ranking: empty });
    expect(double.rank(INPUT)).toEqual(empty);
    // An empty canned ranking is replayed as the honest empty — the double
    // does not pad it with fabricated items.
    expect(double.rank(INPUT).kind).toBe("empty");
  });

  it("the registry-entry helper carries the TEST DOUBLE label visibly", () => {
    const double = new FixtureReplayRanker({ ranking: CANNED });
    const entry = double.toRegistryEntry();
    expect(entry.id).toBe(FIXTURE_REPLAY_RANKER_ID);
    expect(entry.label).toBe(FIXTURE_REPLAY_RANKER_LABEL);
    expect(entry.label).toContain("TEST DOUBLE");
    expect(entry.description).toContain("TEST DOUBLE");
    expect(entry.capabilities).toContain("test-double");
    expect(entry.ranker).toBe(double);
  });

  it("two instances with the same script behave identically (no shared state)", () => {
    const a = new FixtureReplayRanker({ ranking: CANNED });
    const b = new FixtureReplayRanker({ ranking: CANNED });
    a.rank(INPUT);
    expect(b.calls).toHaveLength(0);
    expect(b.rank(INPUT)).toEqual(a.rank(INPUT));
  });
});
