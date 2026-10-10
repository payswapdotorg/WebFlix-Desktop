export type LibraryEntryKind = 'movie' | 'series' | 'episode' | 'other';

export interface LibraryEntry {
  id: string;
  /** Absolute, real (symlink-resolved) path — the store never holds media bytes. */
  path: string;
  title: string;
  kind: LibraryEntryKind;
  sizeBytes: number;
  mtimeMs: number;
  /** sha-256 of (path, size, mtime) — see fingerprint.ts. */
  fingerprint: string;
  missing: boolean;
  addedAt: number;
  updatedAt: number;
  lastIndexedAt: number | null;
}

export interface LibraryEntryInput {
  path: string;
  title?: string;
  kind?: LibraryEntryKind;
  sizeBytes?: number;
  mtimeMs?: number;
  fingerprint?: string;
}

export type LibraryEntryPatch = Partial<
  Pick<LibraryEntry, 'title' | 'kind' | 'sizeBytes' | 'mtimeMs' | 'fingerprint' | 'missing'>
>;

export interface LibraryQuery {
  missing?: boolean;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionPatch {
  name?: string;
  description?: string | null;
}

export interface PlaylistItem {
  id: string;
  collectionId: string;
  entryId: string;
  position: number;
  addedAt: number;
}

export interface WatchedState {
  entryId: string;
  watched: boolean;
  watchedAt: number | null;
  updatedAt: number;
}

export interface Progress {
  entryId: string;
  positionMs: number;
  durationMs: number | null;
  /** 0..100, computed from position/duration. */
  percent: number;
  updatedAt: number;
}

export interface ProviderMetadataRecord {
  id: string;
  entryId: string | null;
  provider: string;
  externalId: string;
  /** JSON text of the cached provider payload. */
  payload: string;
  fetchedAt: number;
  expiresAt: number;
}

export interface ProviderMetadataInput {
  entryId?: string | null;
  provider: string;
  externalId: string;
  payload: unknown;
  now?: number;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: string;
  /** JSON text of the job payload. */
  payload: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface IndexedFileInfo {
  path: string;
  title: string;
  kind: LibraryEntryKind;
  sizeBytes: number;
  mtimeMs: number;
  fingerprint: string;
}
