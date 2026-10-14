/**
 * In-memory retention store defaults (P7-RETENTION-1) — the PURE-TEST
 * doubles for the retention seams defined in `./history-retention.ts`, the
 * in-memory-intelligence-stores / in-memory-ads-stores precedents carried
 * into the retention lane.
 *
 * Honest boundary, stated plainly: these implementations live in memory
 * ONLY — nothing survives a process restart, and they are per-profile by
 * construction (the composition root instantiates one set per profile;
 * ADR-0003 — no cross-profile data ever). The DURABLE adapters ship on the
 * local-library storage seam in a LATER order (own retention tables over
 * the same records the existing write seams persist — LocalStore progress
 * rows, FeedbackStore events, the watch-history log) and are wired by the
 * composition root (P7-COMPOSE-1). The port interfaces in
 * ./history-retention.ts are the stable seam — swapping these defaults for
 * persistent adapters changes nothing above the ports.
 *
 * Validation honesty: the doubles validate the SHAPE on write exactly like
 * their durable mirrors will — the preference/history/progress guards throw
 * the typed application-local RetentionRuleError, and feedback seeds
 * re-validate through the locked contracts schema (typed
 * IntelligenceFeedbackInvalid WebFlixError, the record-feedback discipline).
 * The WATCH-HISTORY double is pause-aware by construction: it holds the
 * retention preference store it was built with and refuses appends with the
 * typed `paused` outcome while history tracking is paused — the pause guard
 * delivered at the store seam, pinned by hermetic tests.
 *
 * FIXTURE-ONLY surfaces, labelled as such: `snapshot()`/`restore()` on the
 * preference double (the restart simulation — the exact JSON the durable
 * adapter persists, round-tripped through a fresh instance) and
 * `seed(...)` on the scope doubles (test data setup; production writes flow
 * through the existing write seams, never through the retention read/delete
 * ports).
 */
import { ErrorCode, FeedbackEventSchema } from "webflix-contracts";
import type { FeedbackEvent } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";
import type { PlaybackProgressRecord } from "./types";
import type {
  RetentionPreference,
  RetentionPreferenceStore,
  RetentionScopeStore,
  WatchHistoryAppendResult,
  WatchHistoryRecord,
  WatchHistoryStore,
} from "./history-retention";
import {
  assertValidPlaybackProgressRecord,
  assertValidRetentionPreference,
  assertValidWatchHistoryRecord,
} from "./history-retention";

/** The JSON-serialisable persisted form of the preference (null = never set). */
export type RetentionPreferenceSnapshot = RetentionPreference | null;

/**
 * In-memory RetentionPreferenceStore (NOT durable — see the module doc).
 * `put` validates the shape (typed RetentionRuleError on any violation,
 * never a silently-mangled row); `get` answers null for the honest
 * never-set state.
 */
export class InMemoryRetentionPreferenceStore implements RetentionPreferenceStore {
  private preference: RetentionPreference | null = null;

  async get(): Promise<RetentionPreference | null> {
    return this.preference === null ? null : { ...this.preference };
  }

  async put(preference: RetentionPreference): Promise<void> {
    assertValidRetentionPreference(preference);
    this.preference = { ...preference };
  }

  /**
   * FIXTURE-ONLY restart simulation: the exact value the durable adapter
   * persists (plain JSON). Hand to `restore` on a fresh instance.
   */
  snapshot(): RetentionPreferenceSnapshot {
    return this.preference === null ? null : { ...this.preference };
  }

  /**
   * FIXTURE-ONLY restart simulation: reconstructs the persisted state. A
   * corrupt snapshot surfaces as the typed RetentionRuleError, never a
   * silently-mangled preference.
   */
  restore(snapshot: RetentionPreferenceSnapshot): void {
    if (snapshot !== null) {
      assertValidRetentionPreference(snapshot);
    }
    this.preference = snapshot === null ? null : { ...snapshot };
  }
}

/**
 * In-memory WatchHistoryStore (NOT durable) — PAUSE-AWARE BY CONSTRUCTION:
 * built over the retention preference store, `append` consults it and, while
 * `historyTrackingPaused` is true, refuses the write with the typed
 * `paused` outcome (carrying the current preference as the evidence). The
 * append is idempotent by record id (a stored id re-appends as a duplicate
 * returning the STORED record); listing is deterministic (insertion order,
 * the InMemoryFeedbackStore precedent); `clear` is the retention delete
 * side and works regardless of the pause state.
 */
export class InMemoryWatchHistoryStore implements WatchHistoryStore {
  private readonly records = new Map<string, WatchHistoryRecord>();

  constructor(private readonly preference: RetentionPreferenceStore) {}

  async append(record: WatchHistoryRecord): Promise<WatchHistoryAppendResult> {
    assertValidWatchHistoryRecord(record);
    const preference = await this.preference.get();
    if (preference?.historyTrackingPaused === true) {
      return { outcome: "paused", preference };
    }
    const existing = this.records.get(record.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    this.records.set(record.id, { ...record });
    return { outcome: "appended", record };
  }

  async list(): Promise<readonly WatchHistoryRecord[]> {
    return [...this.records.values()];
  }

  async clear(): Promise<number> {
    const removed = this.records.size;
    this.records.clear();
    return removed;
  }
}

/**
 * In-memory retention scope store for WebFlix-owned playback progress
 * records (NOT durable). Keyed per track (the putPlaybackProgress house
 * semantic — one current playhead per track); `list` is deterministic
 * (insertion order); `clear` deletes every row and returns the count.
 * `seed` is the labelled FIXTURE-ONLY write surface: production progress
 * writes flow through LocalStore.putPlaybackProgress — the composition
 * root wires the durable retention adapter over the same rows.
 */
export class InMemoryPlaybackProgressScopeStore implements RetentionScopeStore<PlaybackProgressRecord> {
  private readonly records = new Map<string, PlaybackProgressRecord>();

  async list(): Promise<readonly PlaybackProgressRecord[]> {
    return [...this.records.values()];
  }

  async clear(): Promise<number> {
    const removed = this.records.size;
    this.records.clear();
    return removed;
  }

  /** FIXTURE-ONLY test setup — validates each record like the durable mirror. */
  async seed(...records: readonly PlaybackProgressRecord[]): Promise<void> {
    for (const record of records) {
      assertValidPlaybackProgressRecord(record);
      this.records.set(record.trackId, { ...record });
    }
  }
}

/**
 * In-memory retention scope store for WebFlix-owned feedback events (NOT
 * durable). Keyed by event id (the FeedbackStore house semantic); `list` is
 * deterministic (insertion order); `clear` deletes every row and returns the
 * count. `seed` is the labelled FIXTURE-ONLY write surface: production
 * feedback appends flow through FeedbackStore.append (RecordFeedback) — the
 * composition root wires the durable retention adapter over the same rows.
 */
export class InMemoryFeedbackScopeStore implements RetentionScopeStore<FeedbackEvent> {
  private readonly events = new Map<string, FeedbackEvent>();

  async list(): Promise<readonly FeedbackEvent[]> {
    return [...this.events.values()];
  }

  async clear(): Promise<number> {
    const removed = this.events.size;
    this.events.clear();
    return removed;
  }

  /**
   * FIXTURE-ONLY test setup — each event re-validates through the locked
   * contracts schema (typed IntelligenceFeedbackInvalid on any violation,
   * the record-feedback discipline; stores persist validated data).
   */
  async seed(...events: readonly FeedbackEvent[]): Promise<void> {
    for (const event of events) {
      const validated = parseOrThrow(
        FeedbackEventSchema,
        event,
        ErrorCode.IntelligenceFeedbackInvalid,
        "FeedbackEvent",
      );
      this.events.set(validated.id, validated);
    }
  }
}
