import type {
  Collection,
  CollectionPatch,
  IndexedFileInfo,
  Job,
  JobState,
  LibraryEntry,
  LibraryEntryInput,
  LibraryEntryPatch,
  LibraryQuery,
  PlaylistItem,
  Progress,
  ProviderMetadataInput,
  ProviderMetadataRecord,
  WatchedState,
} from "./types";

/**
 * The application-facing LocalStore port implemented by this lane.
 *
 * It mirrors the shape of the application layer's LocalStore port; because both
 * sides are structurally typed, `LocalStore` satisfies the application port
 * without introducing a cross-package dependency from this lane.
 */
export interface LocalStorePort {
  // library entries
  addLibraryEntry(input: LibraryEntryInput): LibraryEntry;
  getLibraryEntry(id: string): LibraryEntry | null;
  findLibraryEntryByPath(path: string): LibraryEntry | null;
  listLibraryEntries(query?: LibraryQuery): LibraryEntry[];
  updateLibraryEntry(id: string, patch: LibraryEntryPatch): LibraryEntry;
  deleteLibraryEntry(id: string): boolean;
  upsertLibraryEntries(files: readonly IndexedFileInfo[]): { added: number; updated: number };
  markEntriesMissing(root: string, seenPaths: readonly string[]): number;

  // collections
  createCollection(name: string, description?: string | null): Collection;
  getCollection(id: string): Collection | null;
  findCollectionByName(name: string): Collection | null;
  listCollections(): Collection[];
  updateCollection(id: string, patch: CollectionPatch): Collection;
  deleteCollection(id: string): boolean;

  // playlists (ordered items inside a collection)
  addPlaylistItem(collectionId: string, entryId: string): PlaylistItem;
  removePlaylistItem(collectionId: string, entryId: string): boolean;
  listPlaylistItems(collectionId: string): PlaylistItem[];
  reorderPlaylist(collectionId: string, orderedItemIds: readonly string[]): void;

  // watched state
  setWatched(entryId: string, watched: boolean, watchedAt?: number): WatchedState;
  getWatchedState(entryId: string): WatchedState | null;
  listWatched(watched: boolean): LibraryEntry[];

  // progress
  setProgress(entryId: string, positionMs: number, durationMs?: number | null): Progress;
  getProgress(entryId: string): Progress | null;
  clearProgress(entryId: string): boolean;

  // provider metadata cache
  putProviderMetadata(input: ProviderMetadataInput): ProviderMetadataRecord;
  getProviderMetadata(provider: string, externalId: string): ProviderMetadataRecord | null;
  listProviderMetadata(provider?: string): ProviderMetadataRecord[];
  listExpiredProviderMetadata(cutoffMs: number): ProviderMetadataRecord[];
  refreshProviderMetadata(id: string, payload: unknown, now: number): ProviderMetadataRecord;
  deleteProviderMetadata(id: string): boolean;

  // jobs
  enqueueJob(type: string, payload?: unknown, maxAttempts?: number): Job;
  getJob(id: string): Job | null;
  claimNextJob(): Job | null;
  completeJob(id: string): Job;
  failJob(id: string, errorMessage: string): Job;
  listJobs(state?: JobState): Job[];
}
