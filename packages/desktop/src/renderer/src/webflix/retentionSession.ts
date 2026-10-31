/**
 * P9-UI-1 (requirement 3, Settings functional minimum) — the retention
 * session for the WebFlix renderer host.
 *
 * Wires the REAL webflix-application retention use cases (P7-RETENTION-1)
 * over their in-memory store doubles. Honest scope, stated here and never
 * implied in the UI: the preference is session-scoped in this build (a
 * durable preference store is a later order); record counts are the REAL
 * counts (the durable seam below reports the durable watch-history facts;
 * progress/feedback stay this session's real counts — zero until their
 * flows exist), never seeded.
 *
 * WFX-DURABLE-LIB-1: when the durable seam is provided, the retention
 * controls act on the REAL stores — pause/resume flip the durable history
 * source's write gate, the history reset scope clears BOTH stores (the
 * removed count is the honest per-store sum), and the state's history
 * count reports the merged durable fact count. This closes the
 * two-disconnected-stores gap (a history reset that reported 0 while the
 * History screen kept its rows was the pre-wave state — never again).
 *
 * All five use cases are the frozen application surface, consumed as-is:
 * PauseHistoryTracking / ResumeHistoryTracking (persisted preference),
 * ResetLocalData (scoped, WebFlix-owned records only), GetRetentionState
 * (the boundary view model). The pause preference drives the watch-history
 * append gate inside the store itself (pause-aware by construction).
 */
import {
  GetRetentionState,
  InMemoryFeedbackScopeStore,
  InMemoryPlaybackProgressScopeStore,
  InMemoryRetentionPreferenceStore,
  InMemoryWatchHistoryStore,
  PauseHistoryTracking,
  ResetLocalData,
  ResumeHistoryTracking,
} from "../../../../../webflix-application/src/index.js";
import type {
  ResetLocalDataResult,
  RetentionScope,
  RetentionState,
} from "../../../../../webflix-application/src/index.js";

/**
 * The durable retention seam (WFX-DURABLE-LIB-1 — satisfied by the durable
 * history source; tests inject fakes). Absent = the honest session-only
 * retention of the pre-wave build.
 */
export interface RetentionDurableSeam {
  /** WF-021's pause gate: true refuses every new history record (both stores). */
  setHistoryPaused(paused: boolean): void;
  /** The merged (session + durable) watch-history fact count. */
  historyCount(): Promise<number>;
  /** The history-reset scope: clears both stores, returns the honest removed count. */
  clearHistory(): Promise<number>;
}

export interface RetentionSessionDeps {
  /** Clock (injectable for tests); default: real Date. */
  readonly now?: () => Date;
  /** The durable seam (WFX-DURABLE-LIB-1); absent = session-only retention. */
  readonly durable?: RetentionDurableSeam | null;
}

export function createRetentionSession(deps: RetentionSessionDeps = {}) {
  const clock = { now: () => (deps.now ?? (() => new Date()))() };
  const durable = deps.durable ?? null;

  const preference = new InMemoryRetentionPreferenceStore();
  const history = new InMemoryWatchHistoryStore(preference);
  const progress = new InMemoryPlaybackProgressScopeStore();
  const feedback = new InMemoryFeedbackScopeStore();

  const pause = new PauseHistoryTracking({ preference, clock });
  const resume = new ResumeHistoryTracking({ preference, clock });
  const reset = new ResetLocalData({ history, progress, feedback });
  const getState = new GetRetentionState({ preference, history, progress, feedback });

  return {
    async pauseHistoryTracking(): Promise<void> {
      await pause.pause();
      // The durable history source's write gate follows the same preference
      // (WF-021: one pause, both stores — the durable seam is the REAL store).
      durable?.setHistoryPaused(true);
    },
    async resumeHistoryTracking(): Promise<void> {
      await resume.resume();
      durable?.setHistoryPaused(false);
    },
    async resetLocalData(scope: RetentionScope): Promise<ResetLocalDataResult> {
      const result = await reset.reset({ scope });
      if ((scope === "history" || scope === "all") && durable !== null) {
        // The removed count is the honest per-store sum (the in-memory use
        // case's count plus the durable store's real removals).
        const durableRemoved = await durable.clearHistory();
        return {
          ...result,
          removed: { ...result.removed, history: result.removed.history + durableRemoved },
        };
      }
      return result;
    },
    async getRetentionState(): Promise<RetentionState> {
      const state = await getState.state();
      if (durable === null) return state;
      // The durable fact count is the REAL history record count (the
      // in-memory store is never appended to in this build — its count is 0
      // by construction; the durable seam owns the truth).
      const historyCount = await durable.historyCount();
      return {
        ...state,
        localRecordCounts: { ...state.localRecordCounts, history: historyCount },
      };
    },
  };
}

export type RetentionSession = ReturnType<typeof createRetentionSession>;
