/**
 * PORTS — hexagonal seams owned by the application layer (D2-LOCAL).
 *
 * Interfaces here are implemented by adapters in later milestones:
 *
 *   - `LocalStore`           -> packages/webflix-local-store (offline DB)
 *   - `IndexingPort`         -> packages/webflix-indexer (filesystem + tags)
 *   - `ProviderMetadataPort` -> packages/webflix-providers (online lookup)
 *   - `CredentialPort`       -> desktop keychain adapter (contract re-export)
 *   - `ClockPort`            -> provided by the composition root
 *
 * Use-cases depend only on these interfaces; tests substitute in-memory fakes
 * (see `src/__tests__/application.test.ts`).
 */
import type {
  CollectionId,
  CollectionRecord,
  Fingerprint,
  LibraryTrack,
  PlaybackProgressRecord,
  ProviderFieldSetRecord,
  ProviderFields,
  ProviderId,
  TrackId,
  TrackProbe,
} from "./types";
import type { DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import type { TranscriptPayload } from "./transcript-payload";
import type { AudioRendition } from "./audio-rendition";
import type { TextPayload } from "./text-payload";

/**
 * The credential contract is frozen in `@webflix/contracts`; re-exported here
 * so use-cases, adapters and tests share a single definition.
 */
export type { CredentialPort } from "webflix-contracts";

/** Injectable time — use-cases never read the wall clock directly. */
export interface ClockPort {
  /** The current instant. */
  now(): Date;
}

/** Factory for opaque identifiers; the composition root supplies `crypto.randomUUID`. */
export type IdGenerator = () => string;

// ---------------------------------------------------------------------------
// LocalStore — everything WebFlix owns, fully offline
// ---------------------------------------------------------------------------

/**
 * Local persistence for tracks, collections, WebFlix-owned playback progress
 * and provider-sourced field sets. Implementations must work fully offline.
 */
export interface LocalStore {
  // --- tracks ---
  listTracks(): Promise<readonly LibraryTrack[]>;
  getTrack(id: TrackId): Promise<LibraryTrack | null>;
  findTrackByFingerprint(fingerprint: Fingerprint): Promise<LibraryTrack | null>;
  putTrack(track: LibraryTrack): Promise<void>;
  removeTrack(id: TrackId): Promise<void>;

  // --- collections ---
  listCollections(): Promise<readonly CollectionRecord[]>;
  getCollection(id: CollectionId): Promise<CollectionRecord | null>;
  putCollection(collection: CollectionRecord): Promise<void>;
  deleteCollection(id: CollectionId): Promise<void>;

  // --- WebFlix-owned playback progress ---
  getPlaybackProgress(trackId: TrackId): Promise<PlaybackProgressRecord | null>;
  listPlaybackProgress(): Promise<readonly PlaybackProgressRecord[]>;
  putPlaybackProgress(progress: PlaybackProgressRecord): Promise<void>;
  clearPlaybackProgress(trackId: TrackId): Promise<void>;

  // --- provider-sourced field sets ---
  getProviderFieldSet(
    trackId: TrackId,
    provider: ProviderId,
  ): Promise<ProviderFieldSetRecord | null>;
  listProviderFieldSets(provider?: ProviderId): Promise<readonly ProviderFieldSetRecord[]>;
  putProviderFieldSet(record: ProviderFieldSetRecord): Promise<void>;
  deleteProviderFieldSet(trackId: TrackId, provider: ProviderId): Promise<void>;
}

// ---------------------------------------------------------------------------
// IndexingPort — path-safe local indexing
// ---------------------------------------------------------------------------

export type IndexingStatus = "running" | "completed" | "cancelled" | "failed";

export interface IndexingJobHandle {
  readonly jobId: string;
}

/** Per-path failure inside an indexing job; never fatal to the whole job. */
export interface IndexingFailure {
  readonly path: string;
  readonly reason: string;
}

export interface IndexingResult {
  readonly jobId: string;
  readonly status: IndexingStatus;
  /** Successfully probed paths, in completion order. */
  readonly probes: readonly TrackProbe[];
  readonly failures: readonly IndexingFailure[];
  /** Whole-job error message; set only when `status === 'failed'`. */
  readonly error: string | null;
}

/**
 * Streaming progress for an indexing job. `result` is non-null exactly when
 * `status` is terminal (`completed`, `cancelled` or `failed`); adapters MUST
 * emit that terminal event exactly once per job.
 */
export interface IndexingProgress {
  readonly jobId: string;
  readonly status: IndexingStatus;
  readonly done: number;
  readonly total: number;
  readonly result: IndexingResult | null;
}

/**
 * Local indexing seam. Use-cases hand over PATHS ONLY; the adapter owns every
 * filesystem and media-byte access. That division is what keeps the
 * application layer path-safe.
 *
 * Emission-timing rule for implementers: consumers subscribe via `onProgress`
 * in the microtask continuation that follows the awaited `start()` promise.
 * Adapters MUST therefore defer their first emission until after that
 * subscription can exist (e.g. process on a macrotask / next tick), so a
 * fast-completing job can never fire its terminal event into the void.
 */
export interface IndexingPort {
  /** Start probing `paths`; resolves immediately with a job handle. */
  start(paths: readonly string[]): Promise<IndexingJobHandle>;
  /** Best-effort cancel; resolves `true` when the job acknowledged cancellation. */
  cancel(jobId: string): Promise<boolean>;
  /**
   * Subscribe to progress events; returns an unsubscribe function.
   * See `IndexingProgress` for the terminal-event contract.
   */
  onProgress(jobId: string, listener: (progress: IndexingProgress) => void): () => void;
}

// ---------------------------------------------------------------------------
// ProviderMetadataPort — online lookup for the 30-day refresh
// ---------------------------------------------------------------------------

/** Outcome of a single track's provider lookup (contract-freeze §7.8). */
export type ProviderMetadataOutcome =
  | { readonly kind: "fetched"; readonly trackId: TrackId; readonly fields: ProviderFields }
  | { readonly kind: "not-found"; readonly trackId: TrackId }
  | { readonly kind: "error"; readonly trackId: TrackId; readonly reason: string };

/**
 * Online provider seam used by `RefreshProviderMetadata`. The adapter performs
 * the network call; the use-case owns TTL decisions and refresh-or-delete.
 */
export interface ProviderMetadataPort {
  fetch(trackId: TrackId, provider: ProviderId): Promise<ProviderMetadataOutcome>;
}

// ---------------------------------------------------------------------------
// Media intelligence (Phase 4, P4-CONTRACTS) — objective / feedback /
// artifact-bookkeeping seams
//
// Per-user, per-profile isolation (ADR-0003): every port instance is
// profile-scoped by construction — the composition root creates one store
// per profile, and no port crosses profiles. Durability update
// (P4-ARTIFACTS row 1): the DURABLE adapters for all three ports ship on
// the local-library storage seam (better-sqlite3, own `mi_*` tables,
// additive migration 0002, per-profile by construction) and are exported
// there for the composition root — wiring them here is explicitly a later
// order. The in-memory defaults below remain the pure-test defaults; the
// port boundary is the stable seam.
// ---------------------------------------------------------------------------

/** Outcome of an idempotent feedback append. */
export type FeedbackAppendResult =
  | { readonly outcome: "appended"; readonly event: FeedbackEvent }
  /** Same id as a stored event: the store returns the stored one; the use-case decides idempotency vs conflict. */
  | { readonly outcome: "duplicate"; readonly existing: FeedbackEvent };

/**
 * Per-profile objective store. `put` replaces the objective wholesale —
 * objectives are the user's CURRENT goals, editable any time (never
 * inferred, never versioned history this order; evaluation replay is
 * P4-EVALLOOP's concern).
 */
export interface ObjectiveStore {
  /** The current objective, or null when the user never set one. */
  get(): Promise<UserObjective | null>;
  put(objective: UserObjective): Promise<void>;
}

/**
 * Per-profile feedback store with idempotent-append semantics keyed by
 * event id: re-appending a stored id MUST NOT create a second entry —
 * implementations return the stored event instead.
 */
export interface FeedbackStore {
  append(event: FeedbackEvent): Promise<FeedbackAppendResult>;
  get(id: string): Promise<FeedbackEvent | null>;
  list(): Promise<readonly FeedbackEvent[]>;
}

/**
 * Per-profile derived-artifact descriptor registry. Stores descriptors
 * ONLY — structural original/derived separation: nothing here can write
 * into a catalog item, and the original catalog snapshot is supplied by the
 * caller at each create call for the lineage check.
 */
export interface ArtifactRegistry {
  put(descriptor: DerivedArtifact): Promise<void>;
  get(id: string): Promise<DerivedArtifact | null>;
  list(): Promise<readonly DerivedArtifact[]>;
}

/**
 * Per-profile transcript segment payload store (P4-SUMMARIZE row 1 — the
 * P4-TRANSCRIBE recorded adjacency resolved). Keyed by the TRANSCRIPT
 * artifact id; `put` persists the payload (segments + checksum, both
 * re-validated defensively — a mismatched checksum is a caller defect, not
 * silently stored); `get` resolves it.
 *
 * ABSENCE IS TYPED, never null: a transcript artifact whose payload was
 * never persisted (a pre-0004 transcript) makes `get` reject with the typed
 * `intelligence/transcript-payload-absent` WebFlixError — surfaced with
 * re-transcription as the recovery, never hidden and never substituted with
 * an empty payload. The durable implementation is local-library migration
 * 0004 (own `mi_transcript_payloads` table, per-profile by construction);
 * the in-memory default below serves hermetic tests. The store does NOT
 * know the artifact registry — it persists what the validated use cases
 * hand over, keyed by the id they computed.
 */
export interface TranscriptPayloadStore {
  /** Persists (or replaces) the payload for one transcript artifact id. */
  put(payload: TranscriptPayload): Promise<void>;
  /**
   * The stored payload for a transcript artifact id; rejects with the typed
   * absent error when none was persisted. Same-id re-puts replace.
   */
  get(artifactId: string): Promise<TranscriptPayload>;
}

/**
 * Per-profile TEXT payload store (P4-TRANSLATE row 2) for non-transcript
 * derived artifacts (kinds summary / overview / qa / translation): the
 * artifact's documented text projection, keyed by its artifact id.
 *
 * ABSENCE IS TYPED, never null: an artifact whose text projection was
 * never persisted makes `get` reject with the typed
 * `intelligence/text-payload-absent` WebFlixError — surfaced with
 * re-running the producing use case as the recovery, never hidden and
 * never substituted with an empty payload. `put` re-validates the record
 * defensively (a mismatched checksum is a caller defect, never silently
 * stored); same-id re-puts replace (the put-replaces house semantic). The
 * durable implementation is local-library migration 0005 (`mi_text_payloads`,
 * the 0002/0003/0004 rules); the in-memory default serves hermetic tests.
 */
export interface TextPayloadStore {
  /** Persists (or replaces) the text payload for one derived artifact id. */
  put(payload: TextPayload): Promise<void>;
  /**
   * The stored text payload; rejects with the typed absent error when none
   * was persisted (never null — absence is typed and surfaced).
   */
  get(artifactId: string): Promise<TextPayload>;
}

/**
 * Per-profile AUDIO rendition store (P4-TRANSLATE row 2, the TTS side):
 * synthesized audio attached to its SOURCE artifact as payload renditions
 * — each carrying its OWN lineage (engine, voice, inputsHash) — with the
 * source artifact's descriptor never mutated (audio-as-rendition, NOT a
 * derived-artifact kind; the kind enum stays closed).
 *
 * Renditions list BY SOURCE artifact id (the attachment surface — a source
 * may honestly carry MANY renditions: different voices, different engine
 * runs); listing order is deterministic (createdAt then renditionId — the
 * DeriveArtifactBookkeeping.list precedent). The retention surface (delete
 * / deleteBySource / clearAll) mirrors the payload stores'. The durable
 * implementation is local-library migration 0005 (`mi_audio_renditions`,
 * the 0002/0003/0004 rules — the audio bytes a BLOB column, the canonical
 * form of bytes); the in-memory default serves hermetic tests.
 */
export interface AudioRenditionStore {
  /** Persists one rendition (id-keyed; a re-put of the same id replaces). */
  put(rendition: AudioRendition): Promise<void>;
  /** The source artifact's renditions, deterministic order; empty when none (honest). */
  listBySource(sourceArtifactId: string): Promise<readonly AudioRendition[]>;
  /** Deletes one rendition by id; true when it existed (retention surface). */
  delete(renditionId: string): Promise<boolean>;
  /** Deletes every rendition attached to one source artifact; returns how many (retention surface). */
  deleteBySource(sourceArtifactId: string): Promise<number>;
  /** Clear-all per profile; returns the number of renditions removed (retention surface). */
  clearAll(): Promise<number>;
}
