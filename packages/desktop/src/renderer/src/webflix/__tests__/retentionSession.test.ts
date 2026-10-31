/**
 * WFX-DURABLE-LIB-1 — the retention session's durable seam battery.
 *
 * Pinned here (all binding):
 *   - The seam-less build is the honest session-only retention of the
 *     pre-wave surface (counts from the in-memory stores, no durable calls).
 *   - With the seam: pause/resume flip the durable write gate; the history
 *     reset scope clears the durable store TOO and the removed count is the
 *     honest per-store sum; getRetentionState reports the DURABLE history
 *     count (the real record count — the in-memory store is never appended
 *     to in this build).
 *   - The progress/feedback scopes stay session-scoped (recorded follow-up;
 *     never implied otherwise).
 */
import { describe, expect, it } from "vitest";
import { createRetentionSession } from "../retentionSession.js";
import type { RetentionDurableSeam } from "../retentionSession.js";

function durableSeamDouble(overrides?: { historyCount?: number; clearRemoved?: number }) {
  const calls = { paused: [] as boolean[], clears: 0 };
  const seam: RetentionDurableSeam & { calls: typeof calls } = {
    calls,
    setHistoryPaused(paused) {
      calls.paused.push(paused);
    },
    async historyCount() {
      return overrides?.historyCount ?? 0;
    },
    async clearHistory() {
      calls.clears += 1;
      return overrides?.clearRemoved ?? 0;
    },
  };
  return seam;
}

describe("createRetentionSession — the seam-less honest session-only build", () => {
  it("never touches a durable seam when none is provided", async () => {
    const session = createRetentionSession({ now: () => new Date("2026-10-31T12:00:00Z") });
    await session.pauseHistoryTracking();
    await session.resumeHistoryTracking();
    const reset = await session.resetLocalData("history");
    expect(reset.removed.history).toBe(0);
    const state = await session.getRetentionState();
    expect(state.localRecordCounts.history).toBe(0);
    expect(state.historyTrackingPaused).toBe(false);
  });
});

describe("createRetentionSession — the WFX-DURABLE-LIB-1 durable seam", () => {
  it("pause/resume flip the durable write gate (one pause, both stores)", async () => {
    const durable = durableSeamDouble();
    const session = createRetentionSession({
      now: () => new Date("2026-10-31T12:00:00Z"),
      durable,
    });
    await session.pauseHistoryTracking();
    expect(durable.calls.paused).toEqual([true]);
    const state = await session.getRetentionState();
    expect(state.historyTrackingPaused).toBe(true);
    await session.resumeHistoryTracking();
    expect(durable.calls.paused).toEqual([true, false]);
  });

  it("the history reset clears the durable store too — the removed count is the per-store sum", async () => {
    const durable = durableSeamDouble({ clearRemoved: 4 });
    const session = createRetentionSession({
      now: () => new Date("2026-10-31T12:00:00Z"),
      durable,
    });
    const reset = await session.resetLocalData("history");
    expect(durable.calls.clears).toBe(1);
    expect(reset.removed.history).toBe(4);
    // The `all` scope clears it too (the scope union includes history).
    await session.resetLocalData("all");
    expect(durable.calls.clears).toBe(2);
  });

  it("the progress-only scope does NOT touch the durable history store (recorded follow-up)", async () => {
    const durable = durableSeamDouble();
    const session = createRetentionSession({
      now: () => new Date("2026-10-31T12:00:00Z"),
      durable,
    });
    await session.resetLocalData("progress");
    expect(durable.calls.clears).toBe(0);
  });

  it("getRetentionState reports the DURABLE history count (the real record count)", async () => {
    const durable = durableSeamDouble({ historyCount: 7 });
    const session = createRetentionSession({
      now: () => new Date("2026-10-31T12:00:00Z"),
      durable,
    });
    const state = await session.getRetentionState();
    expect(state.localRecordCounts.history).toBe(7);
  });
});
