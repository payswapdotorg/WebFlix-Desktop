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
