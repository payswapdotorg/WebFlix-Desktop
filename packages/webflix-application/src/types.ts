/**
 * Application-layer persisted model (D2-LOCAL).
 *
 * These are the shapes spoken over the `LocalStore` port (see `./ports.ts`).
 * They are plain, JSON-serialisable data with no behaviour, so adapters
 * (webflix-local-store, webflix-indexer) can map them onto their engines
 * while use-cases stay free of storage concerns. Entity shapes mirror
 * `@webflix/domain`; the composition root bridges the two at the edges.
 */

/** Brand marker — keeps otherwise-identical string IDs structurally distinct. */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Stable identifier of a track in the local library. */
export type TrackId = Brand<string, 'TrackId'>;
/** Stable identifier of a user collection. */
export type CollectionId = Brand<string, 'CollectionId'>;
/** Identifier of a metadata provider (e.g. `musicbrainz`). */
export type ProviderId = Brand<string, 'ProviderId'>;
/** Content-derived identity of a track, computed without media bytes. */
export type Fingerprint = Brand<string, 'Fingerprint'>;

export const asTrackId = (raw: string): TrackId => raw as TrackId;
export const asCollectionId = (raw: string): CollectionId => raw as CollectionId;
export const asProviderId = (raw: string): ProviderId => raw as ProviderId;
export const asFingerprint = (raw: string): Fingerprint => raw as Fingerprint;

/** ISO-8601 timestamp in UTC, e.g. `2025-01-01T00:00:00.000Z`. */
export type IsoTimestamp = string;

/** Values a provider may contribute for a track. */
export type ProviderFieldValue = string | number | boolean | null;
export type ProviderFields = Readonly<Record<string, ProviderFieldValue>>;

/**
 * Metadata probed by the `IndexingPort` adapter for one path.
 *
 * Produced WITHOUT reading media bytes: the adapter may parse container
 * headers/tags only; audio data never crosses this boundary.
 */
export interface TrackProbe {
  /** Absolute path, exactly as handed to the indexer. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  /** Lower-case container/format tag, e.g. `mp3`, `flac`, `m4a`. */
  readonly container: string;
  readonly durationMs: number | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly trackNo: number | null;
}

/** A track known to the local library. Never carries media bytes. */
export interface LibraryTrack {
  readonly id: TrackId;
  readonly fingerprint: Fingerprint;
  readonly path: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly container: string;
  readonly durationMs: number | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly trackNo: number | null;
  readonly addedAt: IsoTimestamp;
}

/** A user-curated, ordered set of library tracks. */
export interface CollectionRecord {
  readonly id: CollectionId;
  readonly name: string;
  readonly trackIds: readonly TrackId[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * WebFlix-owned playback progress. Progress belongs to the desktop app and is
 * never delegated to (or sourced from) a provider.
 */
export interface PlaybackProgressRecord {
  readonly trackId: TrackId;
  /** Last reported playhead position in ms; clamped to `[0, durationMs]` when duration is known. */
  readonly positionMs: number;
  readonly durationMs: number | null;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Provider-sourced field set for one track.
 *
 * Contract-freeze §7.8: every provider-sourced field set carries `fetchedAt`
 * so the 30-day TTL (see `./refresh-provider-metadata.ts`) is enforceable.
 */
export interface ProviderFieldSetRecord {
  readonly trackId: TrackId;
  readonly provider: ProviderId;
  readonly fields: ProviderFields;
  readonly fetchedAt: IsoTimestamp;
}
