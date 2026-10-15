/**
 * P9-UI-1 (requirement 3, Settings functional minimum) — the retention
 * session for the WebFlix renderer host.
 *
 * Wires the REAL webflix-application retention use cases (P7-RETENTION-1)
 * over their in-memory store doubles. Honest scope, stated here and never
 * implied in the UI: the preference is session-scoped in this build — the
 * durable retention adapters on the local-library seam are a later order
 * (the P7 ledger's own wording); record counts are this session's real
 * counts (zero until playback progress exists), never seeded.
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

export interface RetentionSessionDeps {
  /** Clock (injectable for tests); default: real Date. */
  readonly now?: () => Date;
}

export function createRetentionSession(deps: RetentionSessionDeps = {}) {
  const clock = { now: () => (deps.now ?? (() => new Date()))() };

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
    },
    async resumeHistoryTracking(): Promise<void> {
      await resume.resume();
    },
    async resetLocalData(scope: RetentionScope): Promise<ResetLocalDataResult> {
      return reset.reset({ scope });
    },
    async getRetentionState(): Promise<RetentionState> {
      return getState.state();
    },
  };
}

export type RetentionSession = ReturnType<typeof createRetentionSession>;
