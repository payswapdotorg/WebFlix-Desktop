/**
 * ManageCollections — create / rename / add / remove (plus delete) under the
 * frozen domain rules for user collections:
 *
 *   - Names are whitespace-normalised and compared case-insensitively.
 *   - A name must be 1..64 characters after normalisation.
 *   - Names are unique across the library.
 *   - Collections hold at most COLLECTION_MAX_TRACKS tracks.
 *   - Only tracks present in the library can join a collection, and a track
 *     can appear at most once per collection.
 */
import type { ClockPort, IdGenerator, LocalStore } from "./ports";
import { asCollectionId, type CollectionId, type CollectionRecord, type TrackId } from "./types";

export const COLLECTION_NAME_MIN_LENGTH = 1;
export const COLLECTION_NAME_MAX_LENGTH = 64;
export const COLLECTION_MAX_TRACKS = 1000;

export type CollectionRuleCode =
  | "name-empty"
  | "name-too-long"
  | "duplicate-name"
  | "not-found"
  | "track-not-in-library"
  | "track-already-in-collection"
  | "track-not-in-collection"
  | "collection-limit-reached";

/** Raised when an operation would violate a collection domain rule. */
export class CollectionRuleError extends Error {
  readonly code: CollectionRuleCode;

  constructor(code: CollectionRuleCode, message: string) {
    super(message);
    this.name = "CollectionRuleError";
    this.code = code;
  }
}

/** Collapse runs of whitespace and trim; the stored name is the normalised one. */
export function normalizeCollectionName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Normalise and validate a name; throws `CollectionRuleError` on violation. */
export function validateCollectionName(raw: string): string {
  const name = normalizeCollectionName(raw);
  if (name.length < COLLECTION_NAME_MIN_LENGTH) {
    throw new CollectionRuleError("name-empty", "Collection name cannot be empty.");
  }
  if (name.length > COLLECTION_NAME_MAX_LENGTH) {
    throw new CollectionRuleError(
      "name-too-long",
      `Collection name must be at most ${COLLECTION_NAME_MAX_LENGTH} characters (got ${name.length}).`,
    );
  }
  return name;
}

export interface ManageCollectionsDeps {
  readonly store: LocalStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

export interface CollectionNameInput {
  readonly name: string;
}

export interface RenameCollectionInput {
  readonly collectionId: CollectionId;
  readonly name: string;
}

export interface CollectionTrackInput {
  readonly collectionId: CollectionId;
  readonly trackId: TrackId;
}

export interface CollectionIdInput {
  readonly collectionId: CollectionId;
}

export class ManageCollections {
  constructor(private readonly deps: ManageCollectionsDeps) {}

  async createCollection(input: CollectionNameInput): Promise<CollectionRecord> {
    const name = validateCollectionName(input.name);
    await this.assertNameAvailable(name, null);
    const now = this.deps.clock.now().toISOString();
    const collection: CollectionRecord = {
      id: asCollectionId(this.deps.generateId()),
      name,
      trackIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.store.putCollection(collection);
    return collection;
  }

  async renameCollection(input: RenameCollectionInput): Promise<CollectionRecord> {
    const existing = await this.mustGetCollection(input.collectionId);
    const name = validateCollectionName(input.name);
    await this.assertNameAvailable(name, existing.id);
    const renamed: CollectionRecord = {
      ...existing,
      name,
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.putCollection(renamed);
    return renamed;
  }

  async addTrackToCollection(input: CollectionTrackInput): Promise<CollectionRecord> {
    const collection = await this.mustGetCollection(input.collectionId);
    const track = await this.deps.store.getTrack(input.trackId);
    if (!track) {
      throw new CollectionRuleError(
        "track-not-in-library",
        `Track ${input.trackId} is not in the library.`,
      );
    }
    if (collection.trackIds.includes(input.trackId)) {
      throw new CollectionRuleError(
        "track-already-in-collection",
        `Track ${input.trackId} is already in collection "${collection.name}".`,
      );
    }
    if (collection.trackIds.length >= COLLECTION_MAX_TRACKS) {
      throw new CollectionRuleError(
        "collection-limit-reached",
        `A collection can hold at most ${COLLECTION_MAX_TRACKS} tracks.`,
      );
    }
    const updated: CollectionRecord = {
      ...collection,
      trackIds: [...collection.trackIds, input.trackId],
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.putCollection(updated);
    return updated;
  }

  async removeTrackFromCollection(input: CollectionTrackInput): Promise<CollectionRecord> {
    const collection = await this.mustGetCollection(input.collectionId);
    if (!collection.trackIds.includes(input.trackId)) {
      throw new CollectionRuleError(
        "track-not-in-collection",
        `Track ${input.trackId} is not in collection "${collection.name}".`,
      );
    }
    const updated: CollectionRecord = {
      ...collection,
      trackIds: collection.trackIds.filter((id) => id !== input.trackId),
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.putCollection(updated);
    return updated;
  }

  async deleteCollection(input: CollectionIdInput): Promise<void> {
    const collection = await this.mustGetCollection(input.collectionId);
    await this.deps.store.deleteCollection(collection.id);
  }

  async listCollections(): Promise<readonly CollectionRecord[]> {
    return this.deps.store.listCollections();
  }

  private async mustGetCollection(id: CollectionId): Promise<CollectionRecord> {
    const collection = await this.deps.store.getCollection(id);
    if (!collection) {
      throw new CollectionRuleError("not-found", `Collection ${id} does not exist.`);
    }
    return collection;
  }

  private async assertNameAvailable(name: string, exceptId: CollectionId | null): Promise<void> {
    const collections = await this.deps.store.listCollections();
    const clash = collections.some(
      (collection) =>
        collection.id !== exceptId && collection.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new CollectionRuleError(
        "duplicate-name",
        `A collection named "${name}" already exists.`,
      );
    }
  }
}
