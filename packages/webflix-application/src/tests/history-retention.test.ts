/**
 * P7-RETENTION-1 tests — WF-021 history/retention controls.
 *
 * FIXTURE-ONLY / HERMETIC: every port is backed by the lane's own in-memory
 * doubles (in-memory-retention-stores.ts) with an injected fake clock — no
 * filesystem, no network, no database, no wall clock, no timers, no
 * provider calls anywhere. The tests prove the STATED CONTRACTS ONLY:
 *
 *   1. preference persistence across store restarts (the snapshot/restore
 *      round-trip through plain JSON — the fixture-honest form of "the
 *      preference row survives storage reconstruction"; the durable
 *      adapter's process restart is a later order's class);
 *   2. reset semantics per scope — ONLY the confirmed scope is cleared;
 *   3. scope isolation — a history reset never touches feedback;
 *   4. provider-boundary honesty — provider-owned records are REPORTED as
 *      not deletable here, never silently dropped, never claimed;
 *   5. pause actually stops new local history writes while paused (the
 *      typed `paused` outcome at the store seam), and resume recovers.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { FeedbackEvent } from "webflix-contracts";
import type { ClockPort } from "../ports";
import { asTrackId } from "../types";
import type { PlaybackProgressRecord } from "../types";
import type { RetentionPreferenceSnapshot } from "../in-memory-retention-stores";
import {
  InMemoryFeedbackScopeStore,
  InMemoryPlaybackProgressScopeStore,
  InMemoryRetentionPreferenceStore,
  InMemoryWatchHistoryStore,
} from "../in-memory-retention-stores";
import type { WatchHistoryRecord } from "../history-retention";
import {
  DATA_BOUNDARY_DESCRIPTIONS,
  DescribeDataBoundaries,
  GetRetentionState,
  PauseHistoryTracking,
  ResetLocalData,
  ResumeHistoryTracking,
  RetentionRuleError,
  isRetentionScope,
} from "../history-retention";

// ---------------------------------------------------------------------------
// Fixtures (fixture-only)
// ---------------------------------------------------------------------------

class FakeClock implements ClockPort {
  private instant: Date;

  constructor(iso = "2025-01-01T00:00:00.000Z") {
    this.instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.instant);
  }

  advanceMs(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

function historyRecord(n: number): WatchHistoryRecord {
  return {
    id: `history-${n}`,
    trackId: asTrackId(`track-${n}`),
    positionMs: 500 * n,
    watchedAt: "2025-01-01T00:00:00.000Z",
  };
}

function progressRecord(n: number): PlaybackProgressRecord {
  return {
    trackId: asTrackId(`track-${n}`),
    positionMs: 1000 * n,
    durationMs: 60000,
    updatedAt: "2025-01-01T00:00:00.000Z",
  };
}

function feedbackEvent(n: number): FeedbackEvent {
  return {
    id: `feedback-${n}`,
    itemId: `item-${n}`,
    channel: "explicit",
    kind: "thumbs-up",
    provenance: { surface: "history-retention.test", capturedAt: "2025-01-01T00:00:00.000Z" },
  };
}

function makeStores() {
  const preference = new InMemoryRetentionPreferenceStore();
  const history = new InMemoryWatchHistoryStore(preference);
  const progress = new InMemoryPlaybackProgressScopeStore();
  const feedback = new InMemoryFeedbackScopeStore();
  return { preference, history, progress, feedback };
}

function makeUseCases(stores: ReturnType<typeof makeStores>) {
  const clock = new FakeClock();
  return {
    clock,
    pause: new PauseHistoryTracking({ preference: stores.preference, clock }),
    resume: new ResumeHistoryTracking({ preference: stores.preference, clock }),
    reset: new ResetLocalData({
      history: stores.history,
      progress: stores.progress,
      feedback: stores.feedback,
    }),
    getState: new GetRetentionState({
      preference: stores.preference,
      history: stores.history,
      progress: stores.progress,
      feedback: stores.feedback,
    }),
    describe: new DescribeDataBoundaries(),
  };
}

async function seedAllScopes(stores: ReturnType<typeof makeStores>): Promise<void> {
  await stores.history.append(historyRecord(1));
  await stores.history.append(historyRecord(2));
  await stores.progress.seed(progressRecord(1), progressRecord(2));
  await stores.feedback.seed(feedbackEvent(1), feedbackEvent(2));
}

// ---------------------------------------------------------------------------
// Pause / resume — the persisted preference
// ---------------------------------------------------------------------------

describe("pause/resume history tracking (persisted preference)", () => {
  it("pause writes the persisted preference stamped from the injected clock", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    const preference = await useCases.pause.pause();
    expect(preference).toEqual({
      historyTrackingPaused: true,
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
    await expect(stores.preference.get()).resolves.toEqual(preference);
  });

  it("resume flips the persisted preference back with a fresh stamp", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await useCases.pause.pause();
    useCases.clock.advanceMs(60_000);
    const preference = await useCases.resume.resume();
    expect(preference).toEqual({
      historyTrackingPaused: false,
      updatedAt: "2025-01-01T00:01:00.000Z",
    });
    await expect(stores.preference.get()).resolves.toEqual(preference);
  });

  it("re-pausing while paused re-stamps the same effect (idempotent effect, refreshed time)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await useCases.pause.pause();
    useCases.clock.advanceMs(1_000);
    const again = await useCases.pause.pause();
    expect(again.historyTrackingPaused).toBe(true);
    expect(again.updatedAt).toBe("2025-01-01T00:00:01.000Z");
  });

  it("never-set is the honest initial state: null preference, tracking active, surfaced distinctly", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await expect(stores.preference.get()).resolves.toBeNull();
    const state = await useCases.getState.state();
    expect(state.historyTrackingPaused).toBe(false);
    expect(state.preferenceUpdatedAt).toBeNull();
    expect(state.preferenceNeverSet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WF-021 test 1 — preference persistence across store restarts
// ---------------------------------------------------------------------------

describe("preference persistence across store restarts (snapshot/restore round-trip)", () => {
  it("a paused preference survives a JSON round-trip into a fresh store instance", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await useCases.pause.pause();
    const snapshot: RetentionPreferenceSnapshot = JSON.parse(
      JSON.stringify(stores.preference.snapshot()),
    );
    const restarted = new InMemoryRetentionPreferenceStore();
    restarted.restore(snapshot);
    await expect(restarted.get()).resolves.toEqual({
      historyTrackingPaused: true,
      updatedAt: "2025-01-01T00:00:00.000Z",
    });
  });

  it("a resumed preference survives the same round-trip (false is persisted, not reset-to-default)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await useCases.pause.pause();
    useCases.clock.advanceMs(30_000);
    await useCases.resume.resume();
    const restarted = new InMemoryRetentionPreferenceStore();
    restarted.restore(JSON.parse(JSON.stringify(stores.preference.snapshot())));
    const preference = await restarted.get();
    expect(preference).toEqual({
      historyTrackingPaused: false,
      updatedAt: "2025-01-01T00:00:30.000Z",
    });
  });

  it("the never-set state round-trips as null (never confused with an explicit resume)", async () => {
    const stores = makeStores();
    const restarted = new InMemoryRetentionPreferenceStore();
    restarted.restore(JSON.parse(JSON.stringify(stores.preference.snapshot())));
    await expect(restarted.get()).resolves.toBeNull();
  });

  it("a corrupt snapshot surfaces as the typed RetentionRuleError, never a mangled row", () => {
    const restarted = new InMemoryRetentionPreferenceStore();
    const corrupt = {
      historyTrackingPaused: "yes",
      updatedAt: "not-a-timestamp",
    } as unknown as RetentionPreferenceSnapshot;
    expect(() => restarted.restore(corrupt)).toThrow(RetentionRuleError);
    expect(() => restarted.restore(corrupt)).toThrow(
      expect.objectContaining({ code: "invalid-preference" }),
    );
    // Nothing was stored — the corrupt row never lands.
    expect(restarted.snapshot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// WF-021 test 5 — pause actually stops new local history writes
// ---------------------------------------------------------------------------

describe("pause stops new local history writes while paused (guard at the store seam)", () => {
  it("while tracking is active, appends land and are listed", async () => {
    const stores = makeStores();
    const result = await stores.history.append(historyRecord(1));
    expect(result).toEqual({ outcome: "appended", record: historyRecord(1) });
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1)]);
  });

  it("while paused, an append is REFUSED with the typed paused outcome and nothing is written", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await stores.history.append(historyRecord(1));
    const before = await stores.history.list();
    await useCases.pause.pause();

    const refused = await stores.history.append(historyRecord(2));
    expect(refused.outcome).toBe("paused");
    if (refused.outcome === "paused") {
      expect(refused.preference).toEqual({
        historyTrackingPaused: true,
        updatedAt: "2025-01-01T00:00:00.000Z",
      });
    }
    await expect(stores.history.list()).resolves.toEqual(before);
  });

  it("after resume, the same append succeeds (resume is the recovery)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await useCases.pause.pause();
    await useCases.resume.resume();
    const result = await stores.history.append(historyRecord(1));
    expect(result).toEqual({ outcome: "appended", record: historyRecord(1) });
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1)]);
  });

  it("appends are idempotent by record id (a stored id re-appends as a duplicate)", async () => {
    const stores = makeStores();
    await stores.history.append(historyRecord(1));
    const again = await stores.history.append(historyRecord(1));
    expect(again).toEqual({ outcome: "duplicate", existing: historyRecord(1) });
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1)]);
  });

  it("an invalid record is a typed caller defect, never stored", async () => {
    const stores = makeStores();
    const bad = { ...historyRecord(1), watchedAt: "yesterday" };
    await expect(stores.history.append(bad)).rejects.toMatchObject({
      name: "RetentionRuleError",
      code: "invalid-history-record",
    });
    await expect(stores.history.list()).resolves.toEqual([]);
  });

  it("clearing history while paused still works (deleting stored records is not a new write)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await stores.history.append(historyRecord(1));
    await useCases.pause.pause();
    await expect(stores.history.clear()).resolves.toBe(1);
    await expect(stores.history.list()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WF-021 test 2 — reset semantics per scope (only the confirmed scope clears)
// ---------------------------------------------------------------------------

describe("resetLocalData — reset semantics per scope", () => {
  it("scope history clears ONLY history; the result echoes the scope and names what stayed", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    const result = await useCases.reset.reset({ scope: "history" });
    expect(result.scope).toBe("history");
    expect(result.removed).toEqual({ history: 2, progress: 0, feedback: 0 });
    expect(result.untouchedLocalScopes).toEqual(["progress", "feedback"]);
    await expect(stores.history.list()).resolves.toEqual([]);
    await expect(stores.progress.list()).resolves.toEqual([progressRecord(1), progressRecord(2)]);
    await expect(stores.feedback.list()).resolves.toEqual([feedbackEvent(1), feedbackEvent(2)]);
  });

  it("scope progress clears ONLY progress records", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    const result = await useCases.reset.reset({ scope: "progress" });
    expect(result.removed).toEqual({ history: 0, progress: 2, feedback: 0 });
    expect(result.untouchedLocalScopes).toEqual(["history", "feedback"]);
    await expect(stores.progress.list()).resolves.toEqual([]);
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1), historyRecord(2)]);
    await expect(stores.feedback.list()).resolves.toEqual([feedbackEvent(1), feedbackEvent(2)]);
  });

  it("scope feedback clears ONLY feedback events", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    const result = await useCases.reset.reset({ scope: "feedback" });
    expect(result.removed).toEqual({ history: 0, progress: 0, feedback: 2 });
    expect(result.untouchedLocalScopes).toEqual(["history", "progress"]);
    await expect(stores.feedback.list()).resolves.toEqual([]);
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1), historyRecord(2)]);
    await expect(stores.progress.list()).resolves.toEqual([progressRecord(1), progressRecord(2)]);
  });

  it("scope all clears the union of the three local scopes and touches nothing else", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    const result = await useCases.reset.reset({ scope: "all" });
    expect(result.scope).toBe("all");
    expect(result.removed).toEqual({ history: 2, progress: 2, feedback: 2 });
    expect(result.untouchedLocalScopes).toEqual([]);
    await expect(stores.history.list()).resolves.toEqual([]);
    await expect(stores.progress.list()).resolves.toEqual([]);
    await expect(stores.feedback.list()).resolves.toEqual([]);
  });

  it("an empty scope clears nothing and still reports honestly (zeros, all scopes untouched)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    const result = await useCases.reset.reset({ scope: "history" });
    expect(result.removed).toEqual({ history: 0, progress: 0, feedback: 0 });
    expect(result.untouchedLocalScopes).toEqual(["progress", "feedback"]);
  });

  it("an unknown scope smuggled past the types is a typed defect and clears NOTHING", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    await expect(useCases.reset.reset({ scope: "the-whole-disk" as never })).rejects.toMatchObject({
      name: "RetentionRuleError",
      code: "invalid-scope",
    });
    await expect(stores.history.list()).resolves.toEqual([historyRecord(1), historyRecord(2)]);
    await expect(stores.progress.list()).resolves.toEqual([progressRecord(1), progressRecord(2)]);
    await expect(stores.feedback.list()).resolves.toEqual([feedbackEvent(1), feedbackEvent(2)]);
  });
});

// ---------------------------------------------------------------------------
// WF-021 test 3 — scope isolation (history reset never touches feedback)
// ---------------------------------------------------------------------------

describe("resetLocalData — scope isolation (history reset never touches feedback)", () => {
  it("a history reset leaves the feedback store byte-identical", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);
    const feedbackBefore = await stores.feedback.list();

    await useCases.reset.reset({ scope: "history" });

    await expect(stores.feedback.list()).resolves.toEqual(feedbackBefore);
    await expect(stores.feedback.list()).resolves.toHaveLength(2);
    await expect(stores.history.list()).resolves.toEqual([]);
  });

  it("the isolation is symmetric: a feedback reset never touches history", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);

    await useCases.reset.reset({ scope: "feedback" });

    await expect(stores.history.list()).resolves.toEqual([historyRecord(1), historyRecord(2)]);
    await expect(stores.feedback.list()).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// WF-021 test 4 — provider-boundary honesty
// ---------------------------------------------------------------------------

describe("provider-boundary honesty (provider-owned records are reported, never touched or claimed)", () => {
  it("every reset result names the provider-owned classes it did NOT delete", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    for (const scope of ["history", "progress", "feedback", "all"] as const) {
      const result = await useCases.reset.reset({ scope });
      expect(result.providerOwnedRecordClassesNotDeletableHere).toEqual([
        "provider-account",
        "provider-catalog",
        "provider-watch-history",
      ]);
    }
  });

  it("describeDataBoundaries reports provider-owned classes as NOT deletable here, with resetScope null", () => {
    const descriptions = new DescribeDataBoundaries().describe();
    const providerOwned = descriptions.filter((item) => item.boundary === "provider-owned");
    expect(providerOwned.map((item) => item.recordClass)).toEqual([
      "provider-account",
      "provider-catalog",
      "provider-watch-history",
    ]);
    for (const item of providerOwned) {
      expect(item.deletableHere).toBe(false);
      expect(item.resetScope).toBeNull();
      expect(item.boundaryMessageKey).toBe("retention.boundary.provider-owned");
      expect(item.messageKey).toBe(`retention.record-class.${item.recordClass}`);
    }
  });

  it("exactly the three local retention scopes are deletable here — no more, no less", () => {
    const descriptions = new DescribeDataBoundaries().describe();
    const deletable = descriptions.filter((item) => item.deletableHere);
    expect(deletable.map((item) => item.resetScope).sort()).toEqual([
      "feedback",
      "history",
      "progress",
    ]);
    for (const item of deletable) {
      expect(item.boundary).toBe("webflix-local");
    }
  });

  it("every boundary class is represented (webflix-local, provider-owned, derived) — the full honest picture", () => {
    const descriptions = new DescribeDataBoundaries().describe();
    const classes = new Set(descriptions.map((item) => item.boundary));
    expect(classes.has("webflix-local")).toBe(true);
    expect(classes.has("provider-owned")).toBe(true);
    expect(classes.has("derived")).toBe(true);
  });

  it("derived classes (provider-sourced local copies) are named with deletableHere false — their own surfaces own deletion", () => {
    const descriptions = new DescribeDataBoundaries().describe();
    const derived = descriptions.filter((item) => item.boundary === "derived");
    expect(derived.map((item) => item.recordClass)).toEqual([
      "provider-field-sets",
      "ad-center-imports",
    ]);
    for (const item of derived) {
      expect(item.deletableHere).toBe(false);
      expect(item.resetScope).toBeNull();
      expect(item.boundaryMessageKey).toBe("retention.boundary.derived");
    }
  });

  it("the describe use case returns the fixed boundary table verbatim (policy data, not stored state)", () => {
    expect(new DescribeDataBoundaries().describe()).toEqual(DATA_BOUNDARY_DESCRIPTIONS);
    expect(DATA_BOUNDARY_DESCRIPTIONS).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// getRetentionState — the boundary view model
// ---------------------------------------------------------------------------

describe("getRetentionState (the boundary view model)", () => {
  it("reads pause status, record counts and the boundary table from the stores", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);
    await useCases.pause.pause();

    const state = await useCases.getState.state();
    expect(state.historyTrackingPaused).toBe(true);
    expect(state.preferenceUpdatedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(state.preferenceNeverSet).toBe(false);
    expect(state.localRecordCounts).toEqual({ history: 2, progress: 2, feedback: 2 });
    expect(state.boundaries).toEqual(DATA_BOUNDARY_DESCRIPTIONS);
  });

  it("counts shrink to zero after a scoped reset (the read side reflects the delete side)", async () => {
    const stores = makeStores();
    const useCases = makeUseCases(stores);
    await seedAllScopes(stores);
    await useCases.reset.reset({ scope: "progress" });
    const state = await useCases.getState.state();
    expect(state.localRecordCounts).toEqual({ history: 2, progress: 0, feedback: 2 });
  });
});

// ---------------------------------------------------------------------------
// In-memory double contracts (fixture discipline)
// ---------------------------------------------------------------------------

describe("in-memory retention store contracts", () => {
  it("the preference store validates on put (typed RetentionRuleError, nothing stored)", async () => {
    const preference = new InMemoryRetentionPreferenceStore();
    await expect(
      preference.put({ historyTrackingPaused: true, updatedAt: "2025-01-01 00:00:00" }),
    ).rejects.toMatchObject({ name: "RetentionRuleError", code: "invalid-preference" });
    await expect(preference.get()).resolves.toBeNull();
  });

  it("progress seeding validates and keys per track (last seed per track wins)", async () => {
    const progress = new InMemoryPlaybackProgressScopeStore();
    await progress.seed(progressRecord(1), progressRecord(2));
    const replaced: PlaybackProgressRecord = { ...progressRecord(1), positionMs: 42_000 };
    await progress.seed(replaced);
    await expect(progress.list()).resolves.toEqual([replaced, progressRecord(2)]);
    await expect(progress.seed({ ...progressRecord(3), positionMs: -1 })).rejects.toMatchObject({
      name: "RetentionRuleError",
      code: "invalid-progress-record",
    });
    await expect(progress.clear()).resolves.toBe(2);
    await expect(progress.list()).resolves.toEqual([]);
  });

  it("feedback seeding re-validates through the locked contracts schema", async () => {
    const feedback = new InMemoryFeedbackScopeStore();
    await feedback.seed(feedbackEvent(1));
    const bad = { ...feedbackEvent(2), kind: "not-a-real-kind" } as unknown as FeedbackEvent;
    await expect(feedback.seed(bad)).rejects.toBeInstanceOf(WebFlixError);
    await expect(feedback.seed(bad)).rejects.toMatchObject({
      code: ErrorCode.IntelligenceFeedbackInvalid,
    });
    await expect(feedback.list()).resolves.toEqual([feedbackEvent(1)]);
  });

  it("isRetentionScope guards the four scope values and nothing else", () => {
    for (const scope of ["history", "progress", "feedback", "all"]) {
      expect(isRetentionScope(scope)).toBe(true);
    }
    for (const not of ["", "History", "everything", undefined, null, 1]) {
      expect(isRetentionScope(not)).toBe(false);
    }
  });
});
