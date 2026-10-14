/**
 * History/retention controls (P7-RETENTION-1 — WF-021) — local retention use
 * cases over WebFlix-owned records, with the local/provider boundary stated
 * AS DATA, never as a silent no-op.
 *
 * Semantics, stated honestly:
 *
 * - The retention preference (pause/resume history tracking) is a PERSISTED
 *   per-profile record written ONLY by explicit user action — `pause`/`resume`
 *   stamp the injected clock's instant, never an inferred one (the
 *   ranker-adapter-selection house rule). Never-set is the honest initial
 *   state: `RetentionPreferenceStore.get()` answers null and tracking is
 *   ACTIVE (paused: false) — surfaced as `preferenceNeverSet`, never
 *   disguised as an explicit "resumed at T".
 * - `resetLocalData` clears ONLY the confirmed scope (history | progress |
 *   feedback | all = the union of those three). A history reset never
 *   touches feedback (scope isolation is the contract, not a side effect).
 *   Library tracks, collections, objectives, derived artifacts, cached
 *   provider field sets and Ad Center imports are NOT retention scopes —
 *   their own management surfaces own them; this reset never claims them.
 * - PROVIDER-OWNED DATA IS NEVER TOUCHED. `describeDataBoundaries` explains,
 *   per record class, whether it is WebFlix-local, provider-owned
 *   (untouchable from here — the boundary IS the feature), or derived
 *   (held locally from provider-sourced input; deletable locally through its
 *   own surface, the source remains provider-side). Deletes only ever claim
 *   the confirmed WebFlix-local scope; the reset result names the
 *   provider-owned classes it did NOT delete, never silently dropping or
 *   claiming them.
 * - THE PAUSE GUARD LIVES AT THE STORE SEAM: `WatchHistoryStore.append` is
 *   pause-aware BY CONTRACT (implementations consult the retention
 *   preference at construction time and refuse appends with the TYPED
 *   `paused` outcome while paused — a state, never an exception, never a
 *   silent no-op). The existing progress/feedback use cases
 *   (`track-playback-progress.ts`, `record-feedback.ts`) stay UNGUARDED, and
 *   that is the honest scoped reading: pausing HISTORY tracking governs
 *   history writes; playhead persistence and feedback appends are separate
 *   record classes whose write seams (LocalStore.putPlaybackProgress /
 *   FeedbackStore.append) cannot express a typed paused outcome without a
 *   signature rewrite — exactly the order's additive-only escape hatch
 *   ("deliver the guard at the store seam and note it honestly"). No
 *   existing use-case file is edited in this order.
 *
 * Ports: the three retention seams below (preference store + the scoped
 * record stores) are NEW seams owned by this lane. The in-memory fixture
 * doubles live in `./in-memory-retention-stores.ts` (pure-test defaults,
 * NOT durable); the DURABLE adapters ship on the local-library storage seam
 * in a later order and are wired by the composition root (P7-COMPOSE-1) —
 * the same phasing every P4/P5 store lane followed. No network, no
 * provider calls, no credentials, no telemetry anywhere in this path.
 */
import type { FeedbackEvent } from "webflix-contracts";
import type { ClockPort } from "./ports";
import type { IsoTimestamp, PlaybackProgressRecord, TrackId } from "./types";

// ---------------------------------------------------------------------------
// Typed retention policy shapes
// ---------------------------------------------------------------------------

/** The three WebFlix-owned local record scopes retention operates on. */
export type RetentionRecordScope = "history" | "progress" | "feedback";

/**
 * The confirmed scope a reset clears. `all` is the UNION of the three record
 * scopes — never "everything on disk": the local library, objectives,
 * derived artifacts, cached provider field sets and Ad Center imports stay
 * (their own management surfaces own them).
 */
export type RetentionScope = RetentionRecordScope | "all";

/**
 * The local/provider boundary class of a record family:
 * - `webflix-local`  — WebFlix-owned local records (deletable here);
 * - `provider-owned` — lives provider-side; NOT deletable from here;
 * - `derived`        — held locally, derived from provider-sourced input;
 *                      deletable locally, the source remains provider-side.
 */
export type RetentionBoundaryClass = "webflix-local" | "provider-owned" | "derived";

/** Runtime guard for scope values crossing untyped boundaries (the UI lane). */
export function isRetentionScope(value: unknown): value is RetentionScope {
  return value === "history" || value === "progress" || value === "feedback" || value === "all";
}

/**
 * The persisted retention preference. One row per profile (ADR-0003): the
 * CURRENT pause state of history tracking, stamped only by explicit user
 * action. Plain serialisable data — the exact JSON the durable adapter
 * persists.
 */
export interface RetentionPreference {
  /** True while the user has paused history tracking; appends are refused. */
  readonly historyTrackingPaused: boolean;
  /** When the current preference was written (explicit user action, injected clock). */
  readonly updatedAt: IsoTimestamp;
}

/** ISO-8601 UTC instants, mirroring the contracts `IsoDateTimeSchema` pattern. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Application-local rule codes (the PlaybackRuleError precedent — no contract edit). */
export type RetentionRuleCode =
  | "invalid-scope"
  | "invalid-preference"
  | "invalid-history-record"
  | "invalid-progress-record";

/** Raised when a retention operation would violate a domain rule. */
export class RetentionRuleError extends Error {
  readonly code: RetentionRuleCode;

  constructor(code: RetentionRuleCode, message: string) {
    super(message);
    this.name = "RetentionRuleError";
    this.code = code;
  }
}

/** Defensive shape validation — the same check the durable adapter runs. */
export function assertValidRetentionPreference(preference: RetentionPreference): void {
  if (
    typeof preference.historyTrackingPaused !== "boolean" ||
    typeof preference.updatedAt !== "string" ||
    !ISO_UTC_RE.test(preference.updatedAt)
  ) {
    throw new RetentionRuleError(
      "invalid-preference",
      `not a valid RetentionPreference (historyTrackingPaused must be a boolean and updatedAt an ISO-8601 UTC instant, got ${JSON.stringify(preference)})`,
    );
  }
}

/**
 * One watch-history record — the append-only event log of WHAT was watched
 * and WHEN (WebFlix-owned; distinct from playback progress, which is the
 * CURRENT playhead per track). `id` is the idempotency key: the surface mints
 * one id per playback session event and reuses it on retries.
 */
export interface WatchHistoryRecord {
  readonly id: string;
  /** The local library track this event was recorded for. */
  readonly trackId: TrackId;
  /** Playhead position reached in this session, in ms. */
  readonly positionMs: number;
  /** When the session event was recorded (injected clock, ISO-8601 UTC). */
  readonly watchedAt: IsoTimestamp;
}

/** Defensive shape validation — the same check the durable adapter runs. */
export function assertValidWatchHistoryRecord(record: WatchHistoryRecord): void {
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.trackId !== "string" ||
    record.trackId.length === 0 ||
    typeof record.positionMs !== "number" ||
    !Number.isFinite(record.positionMs) ||
    record.positionMs < 0 ||
    typeof record.watchedAt !== "string" ||
    !ISO_UTC_RE.test(record.watchedAt)
  ) {
    throw new RetentionRuleError(
      "invalid-history-record",
      `not a valid WatchHistoryRecord (non-empty id/trackId, finite non-negative positionMs, ISO-8601 UTC watchedAt required, got ${JSON.stringify(record)})`,
    );
  }
}

/** Defensive shape validation for seeded progress records (the durable mirror). */
export function assertValidPlaybackProgressRecord(record: PlaybackProgressRecord): void {
  const durationOk =
    record.durationMs === null ||
    (typeof record.durationMs === "number" &&
      Number.isFinite(record.durationMs) &&
      record.durationMs > 0);
  if (
    typeof record.trackId !== "string" ||
    record.trackId.length === 0 ||
    typeof record.positionMs !== "number" ||
    !Number.isFinite(record.positionMs) ||
    record.positionMs < 0 ||
    !durationOk ||
    typeof record.updatedAt !== "string" ||
    !ISO_UTC_RE.test(record.updatedAt)
  ) {
    throw new RetentionRuleError(
      "invalid-progress-record",
      `not a valid PlaybackProgressRecord (non-empty trackId, finite non-negative positionMs, positive-or-null durationMs, ISO-8601 UTC updatedAt required, got ${JSON.stringify(record)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Ports — the retention seams (in-memory defaults in
// ./in-memory-retention-stores.ts)
// ---------------------------------------------------------------------------

/**
 * Per-profile retention preference store. `put` replaces wholesale (the
 * CURRENT choice — one row per profile); implementations MUST validate the
 * shape on write (typed RetentionRuleError, never a silently-mangled row)
 * and `get` answers null for the honest never-set state.
 */
export interface RetentionPreferenceStore {
  /** The stored preference, or null when the user never acted. */
  get(): Promise<RetentionPreference | null>;
  put(preference: RetentionPreference): Promise<void>;
}

/**
 * Retention operations over one deletable local record scope: the READ side
 * (list, for counts and the boundary view) and the DELETE side (clear, the
 * reset building block). Writes to these scopes flow through their OWN
 * existing seams (LocalStore.putPlaybackProgress, FeedbackStore.append, the
 * history append below) — the composition root wires the durable retention
 * adapters over the SAME tables those seams write, the P4/P5 store phasing.
 */
export interface RetentionScopeStore<TRecord> {
  /** Every record in this scope, deterministic order; empty when none (honest). */
  list(): Promise<readonly TRecord[]>;
  /** Deletes every record in this scope; returns how many were removed. */
  clear(): Promise<number>;
}

/** The typed outcome of a watch-history append. Pause is a STATE, never an error. */
export type WatchHistoryAppendResult =
  | { readonly outcome: "appended"; readonly record: WatchHistoryRecord }
  /** Same id as a stored record: the stored one is returned (idempotent append). */
  | { readonly outcome: "duplicate"; readonly existing: WatchHistoryRecord }
  /**
   * History tracking is PAUSED: the record was NOT written. Carries the
   * current preference as the evidence (resume is the recovery, never an
   * exception, never a silent no-op).
   */
  | { readonly outcome: "paused"; readonly preference: RetentionPreference };

/**
 * Per-profile watch-history store — the record class the pause preference
 * governs. `append` is PAUSE-AWARE BY CONTRACT (the guard at the store seam,
 * per the order's additive-only escape hatch): implementations receive the
 * retention preference store at construction and, while
 * `historyTrackingPaused` is true, refuse appends with the typed `paused`
 * outcome — the write happens ONLY when tracking is active. `clear` is the
 * retention delete side and works regardless of the pause state (deleting
 * existing records is not a new history write).
 */
export interface WatchHistoryStore extends RetentionScopeStore<WatchHistoryRecord> {
  /** Idempotent append by record id; refused with the typed `paused` outcome while paused. */
  append(record: WatchHistoryRecord): Promise<WatchHistoryAppendResult>;
}

// ---------------------------------------------------------------------------
// The boundary model — typed, i18n-ready
// ---------------------------------------------------------------------------

/** Stable record-class ids the boundary explanation covers (closed set). */
export const DATA_RECORD_CLASSES = [
  "watch-history",
  "playback-progress",
  "feedback-events",
  "user-objectives",
  "local-library",
  "derived-artifacts",
  "provider-field-sets",
  "ad-center-imports",
  "provider-account",
  "provider-catalog",
  "provider-watch-history",
] as const;
export type DataRecordClassId = (typeof DATA_RECORD_CLASSES)[number];

/** i18n message keys — the UI resolves them; no baked copy lives here. */
export type RetentionRecordClassMessageKey = `retention.record-class.${DataRecordClassId}`;
export type RetentionBoundaryMessageKey = `retention.boundary.${RetentionBoundaryClass}`;

/**
 * The typed, i18n-ready boundary explanation for ONE record class: which
 * side of the local/provider boundary it lives on, whether THIS retention
 * surface can delete it, which reset scope covers it (null when none does),
 * and the message keys the settings surface resolves.
 */
export interface DataBoundaryDescription {
  readonly recordClass: DataRecordClassId;
  readonly boundary: RetentionBoundaryClass;
  /** True iff a reset scope covers this class (deletable through THIS surface). */
  readonly deletableHere: boolean;
  /** The reset scope that clears this class; null when no reset scope does. */
  readonly resetScope: RetentionRecordScope | null;
  readonly messageKey: RetentionRecordClassMessageKey;
  readonly boundaryMessageKey: RetentionBoundaryMessageKey;
}

function boundary(
  recordClass: DataRecordClassId,
  boundaryClass: RetentionBoundaryClass,
  resetScope: RetentionRecordScope | null,
): DataBoundaryDescription {
  return {
    recordClass,
    boundary: boundaryClass,
    deletableHere: resetScope !== null,
    resetScope,
    messageKey: `retention.record-class.${recordClass}`,
    boundaryMessageKey: `retention.boundary.${boundaryClass}`,
  };
}

/**
 * The boundary table (fixed data, never recomputed — the describe use case
 * returns it verbatim). Provider-owned classes are explained and NEVER
 * touched; derived classes name their own local deletion surface and that
 * the provider-side source remains.
 */
export const DATA_BOUNDARY_DESCRIPTIONS: readonly DataBoundaryDescription[] = [
  boundary("watch-history", "webflix-local", "history"),
  boundary("playback-progress", "webflix-local", "progress"),
  boundary("feedback-events", "webflix-local", "feedback"),
  boundary("user-objectives", "webflix-local", null),
  boundary("local-library", "webflix-local", null),
  boundary("derived-artifacts", "webflix-local", null),
  boundary("provider-field-sets", "derived", null),
  boundary("ad-center-imports", "derived", null),
  boundary("provider-account", "provider-owned", null),
  boundary("provider-catalog", "provider-owned", null),
  boundary("provider-watch-history", "provider-owned", null),
];

/** The provider-owned record classes, derived from the boundary table. */
export const PROVIDER_OWNED_RECORD_CLASSES: readonly DataRecordClassId[] =
  DATA_BOUNDARY_DESCRIPTIONS.filter((item) => item.boundary === "provider-owned").map(
    (item) => item.recordClass,
  );

/** The retention boundary view model — what the settings surface renders. */
export interface RetentionState {
  /** True while history tracking is paused (false when never set — see the flag below). */
  readonly historyTrackingPaused: boolean;
  /** When the preference was last written; null when never set (honest). */
  readonly preferenceUpdatedAt: IsoTimestamp | null;
  /** True when the user never acted — distinct from an explicit resume, surfaced. */
  readonly preferenceNeverSet: boolean;
  /** Current record counts of the three local retention scopes. */
  readonly localRecordCounts: Readonly<Record<RetentionRecordScope, number>>;
  /** The full boundary explanation, verbatim from the fixed table. */
  readonly boundaries: readonly DataBoundaryDescription[];
}

// ---------------------------------------------------------------------------
// Use case 1+2 — pause / resume history tracking (persisted preference)
// ---------------------------------------------------------------------------

export interface HistoryRetentionPreferenceDeps {
  readonly preference: RetentionPreferenceStore;
  readonly clock: ClockPort;
}

/**
 * Pauses history tracking — a persisted, explicit user action. Re-pausing
 * while paused re-stamps `updatedAt` (the action happened; the effect is
 * idempotent). The written preference is returned so the surface can render
 * the confirmed state.
 */
export class PauseHistoryTracking {
  constructor(private readonly deps: HistoryRetentionPreferenceDeps) {}

  async pause(): Promise<RetentionPreference> {
    const preference: RetentionPreference = {
      historyTrackingPaused: true,
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.preference.put(preference);
    return preference;
  }
}

/**
 * Resumes history tracking — the recovery for every typed `paused` append
 * refusal. Never-set semantics are preserved: resume after pause writes
 * `historyTrackingPaused: false` with a fresh stamp (an explicit resume,
 * never confused with never-set).
 */
export class ResumeHistoryTracking {
  constructor(private readonly deps: HistoryRetentionPreferenceDeps) {}

  async resume(): Promise<RetentionPreference> {
    const preference: RetentionPreference = {
      historyTrackingPaused: false,
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.preference.put(preference);
    return preference;
  }
}

// ---------------------------------------------------------------------------
// Use case 3 — resetLocalData (scoped, WebFlix-owned records ONLY)
// ---------------------------------------------------------------------------

export interface ResetLocalDataDeps {
  readonly history: WatchHistoryStore;
  readonly progress: RetentionScopeStore<PlaybackProgressRecord>;
  readonly feedback: RetentionScopeStore<FeedbackEvent>;
}

export interface ResetLocalDataInput {
  readonly scope: RetentionScope;
}

/** What one scoped reset actually did — counts only for the confirmed scope. */
export interface ResetLocalDataResult {
  /** The confirmed scope this reset cleared, echoed verbatim. */
  readonly scope: RetentionScope;
  /** How many records each local scope actually lost (0 for untouched scopes). */
  readonly removed: Readonly<Record<RetentionRecordScope, number>>;
  /** The local record scopes this reset did NOT touch, named explicitly. */
  readonly untouchedLocalScopes: readonly RetentionRecordScope[];
  /**
   * The provider-owned record classes — NOT deleted, NOT claimed, named so
   * the surface can state the boundary after every reset (the honest
   * boundary statement is part of the result, never implied).
   */
  readonly providerOwnedRecordClassesNotDeletableHere: readonly DataRecordClassId[];
}

const ALL_LOCAL_SCOPES: readonly RetentionRecordScope[] = ["history", "progress", "feedback"];

/**
 * Resets WebFlix-owned local data, scoped. ONLY the confirmed scope is
 * cleared: `history` clears watch-history records and nothing else,
 * `progress` clears playhead records, `feedback` clears feedback events,
 * `all` clears the union of the three. Library tracks, collections,
 * objectives, derived artifacts, cached provider field sets and Ad Center
 * imports are untouched (their own management surfaces own them), and
 * provider-owned records are untouchable from here — the result says both,
 * explicitly. An unknown scope smuggled past the types is a typed caller
 * defect (RetentionRuleError), never a zero-count pretend-reset.
 */
export class ResetLocalData {
  constructor(private readonly deps: ResetLocalDataDeps) {}

  async reset(input: ResetLocalDataInput): Promise<ResetLocalDataResult> {
    if (!isRetentionScope(input.scope)) {
      throw new RetentionRuleError(
        "invalid-scope",
        `unknown retention scope ${JSON.stringify(input.scope)} — expected one of history | progress | feedback | all`,
      );
    }
    const scope = input.scope;
    const clearHistory = scope === "history" || scope === "all";
    const clearProgress = scope === "progress" || scope === "all";
    const clearFeedback = scope === "feedback" || scope === "all";
    const removed: Record<RetentionRecordScope, number> = {
      history: clearHistory ? await this.deps.history.clear() : 0,
      progress: clearProgress ? await this.deps.progress.clear() : 0,
      feedback: clearFeedback ? await this.deps.feedback.clear() : 0,
    };
    const untouchedLocalScopes = ALL_LOCAL_SCOPES.filter(
      (local) =>
        !(
          (local === "history" && clearHistory) ||
          (local === "progress" && clearProgress) ||
          (local === "feedback" && clearFeedback)
        ),
    );
    return {
      scope,
      removed,
      untouchedLocalScopes,
      providerOwnedRecordClassesNotDeletableHere: PROVIDER_OWNED_RECORD_CLASSES,
    };
  }
}

// ---------------------------------------------------------------------------
// Use case 4 — getRetentionState (the boundary view model)
// ---------------------------------------------------------------------------

export interface GetRetentionStateDeps {
  readonly preference: RetentionPreferenceStore;
  readonly history: WatchHistoryStore;
  readonly progress: RetentionScopeStore<PlaybackProgressRecord>;
  readonly feedback: RetentionScopeStore<FeedbackEvent>;
}

/**
 * Reads the retention state: pause status (with the never-set state
 * surfaced distinctly), the three local record counts, and the full
 * boundary explanation. Pure read — nothing is mutated, nothing is
 * inferred; counts come from the stores' own listing surfaces.
 */
export class GetRetentionState {
  constructor(private readonly deps: GetRetentionStateDeps) {}

  async state(): Promise<RetentionState> {
    const preference = await this.deps.preference.get();
    const history = await this.deps.history.list();
    const progress = await this.deps.progress.list();
    const feedback = await this.deps.feedback.list();
    return {
      historyTrackingPaused: preference?.historyTrackingPaused ?? false,
      preferenceUpdatedAt: preference?.updatedAt ?? null,
      preferenceNeverSet: preference === null,
      localRecordCounts: {
        history: history.length,
        progress: progress.length,
        feedback: feedback.length,
      },
      boundaries: DATA_BOUNDARY_DESCRIPTIONS,
    };
  }
}

// ---------------------------------------------------------------------------
// Use case 5 — describeDataBoundaries (typed, i18n-ready)
// ---------------------------------------------------------------------------

/**
 * The boundary explanation use case. Returns the fixed boundary table
 * verbatim — for each record class: WebFlix-local / provider-owned /
 * derived, whether THIS surface can delete it, which reset scope covers it,
 * and the i18n message keys. Provider-owned records are REPORTED as not
 * deletable here — never silently dropped, never claimed. No store access:
 * the boundary is policy data, not stored state.
 */
export class DescribeDataBoundaries {
  describe(): readonly DataBoundaryDescription[] {
    return DATA_BOUNDARY_DESCRIPTIONS;
  }
}
