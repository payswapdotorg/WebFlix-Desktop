/* eslint-disable max-lines -- localStore.ts: single migration-backed SQLite store for the local library (D2-LOCAL); the schema, statement cache, indexing and backup/restore paths share one transaction substrate and were delivered as one unit at freeze 5549208. Split deferred to the Phase-2 module split backlog (TL2 arbitration, repo precedent: autoUpdater.ts). */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { sep } from "node:path";
import { PROVIDER_METADATA_TTL_MS } from "./constants";
import { inTransaction, toSqlParam, type SqliteDatabase } from "./db/adapter";
import { DuplicateError, NotFoundError, ValidationError } from "./errors";
import { fingerprintFor } from "./fingerprint";
import { assertSafeAbsolutePath, statableRealOrResolve, titleFromPath } from "./paths";
import type { LocalStorePort } from "./ports";
import type {
  Collection,
  CollectionPatch,
  IndexedFileInfo,
  Job,
  JobState,
  LibraryEntry,
  LibraryEntryInput,
  LibraryEntryKind,
  LibraryEntryPatch,
  LibraryQuery,
  PlaylistItem,
  Progress,
  ProviderMetadataInput,
  ProviderMetadataRecord,
  WatchedState,
} from "./types";

const LIBRARY_ENTRY_KINDS: readonly LibraryEntryKind[] = ["movie", "series", "episode", "other"];

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

function asJobState(value: unknown): JobState {
  return value === "running" || value === "done" || value === "failed" || value === "cancelled"
    ? value
    : "queued";
}

function requireNonEmptyText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  if (trimmed.length > 512) {
    throw new ValidationError(`${label} must be at most 512 characters`);
  }
  return trimmed;
}

function validateKind(kind: string): void {
  if (!LIBRARY_ENTRY_KINDS.includes(kind as LibraryEntryKind)) {
    throw new ValidationError(
      `invalid library entry kind "${kind}" — expected one of ${LIBRARY_ENTRY_KINDS.join(", ")}`,
    );
  }
}

function progressPercent(positionMs: number, durationMs: number | null): number {
  if (durationMs === null || durationMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((positionMs / durationMs) * 100)));
}

function mapEntry(row: Record<string, unknown>): LibraryEntry {
  return {
    id: asString(row["id"]),
    path: asString(row["path"]),
    title: asString(row["title"]),
    kind: asString(row["kind"]) as LibraryEntryKind,
    sizeBytes: asNumber(row["size_bytes"]),
    mtimeMs: asNumber(row["mtime_ms"]),
    fingerprint: asString(row["fingerprint"]),
    missing: asBool(row["missing"]),
    addedAt: asNumber(row["added_at"]),
    updatedAt: asNumber(row["updated_at"]),
    lastIndexedAt: asNullableNumber(row["last_indexed_at"]),
  };
}

function mapCollection(row: Record<string, unknown>): Collection {
  return {
    id: asString(row["id"]),
    name: asString(row["name"]),
    description: asNullableString(row["description"]),
    createdAt: asNumber(row["created_at"]),
    updatedAt: asNumber(row["updated_at"]),
  };
}

function mapPlaylistItem(row: Record<string, unknown>): PlaylistItem {
  return {
    id: asString(row["id"]),
    collectionId: asString(row["collection_id"]),
    entryId: asString(row["entry_id"]),
    position: asNumber(row["position"]),
    addedAt: asNumber(row["added_at"]),
  };
}

function mapWatchedState(row: Record<string, unknown>): WatchedState {
  return {
    entryId: asString(row["entry_id"]),
    watched: asBool(row["watched"]),
    watchedAt: asNullableNumber(row["watched_at"]),
    updatedAt: asNumber(row["updated_at"]),
  };
}

function mapProviderMetadata(row: Record<string, unknown>): ProviderMetadataRecord {
  return {
    id: asString(row["id"]),
    entryId: asNullableString(row["entry_id"]),
    provider: asString(row["provider"]),
    externalId: asString(row["external_id"]),
    payload: asString(row["payload"]),
    fetchedAt: asNumber(row["fetched_at"]),
    expiresAt: asNumber(row["expires_at"]),
  };
}

function mapJob(row: Record<string, unknown>): Job {
  return {
    id: asString(row["id"]),
    type: asString(row["type"]),
    payload: asString(row["payload"]),
    state: asJobState(row["state"]),
    attempts: asNumber(row["attempts"]),
    maxAttempts: asNumber(row["max_attempts"]),
    lastError: asNullableString(row["last_error"]),
    createdAt: asNumber(row["created_at"]),
    updatedAt: asNumber(row["updated_at"]),
    startedAt: asNullableNumber(row["started_at"]),
    finishedAt: asNullableNumber(row["finished_at"]),
  };
}

export interface LocalStoreOptions {
  now?: () => number;
}

/**
 * SQLite-backed implementation of the application's LocalStore port.
 * All data lives in the migration-managed schema; media bytes are never stored.
 */
export class LocalStore implements LocalStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: LocalStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  private now(): number {
    return this.clock();
  }

  private run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
    return this.db.prepare(sql).run(...params.map(toSqlParam));
  }

  private one(sql: string, ...params: unknown[]): Record<string, unknown> | undefined {
    return this.db.prepare(sql).get(...params.map(toSqlParam));
  }

  private all(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...params.map(toSqlParam)) as Array<Record<string, unknown>>;
  }

  private requireEntry(entryId: string): LibraryEntry {
    const entry = this.getLibraryEntry(entryId);
    if (!entry) {
      throw new NotFoundError(`library entry ${entryId} not found`);
    }
    return entry;
  }

  private touchCollection(collectionId: string): void {
    this.run("UPDATE collections SET updated_at = ? WHERE id = ?", this.now(), collectionId);
  }

  // ── library entries ─────────────────────────────────────────────────────────

  addLibraryEntry(input: LibraryEntryInput): LibraryEntry {
    const path = statableRealOrResolve(assertSafeAbsolutePath(input.path, "library entry path"));
    if (this.findOneEntryByPath(path)) {
      throw new DuplicateError(`a library entry already exists for path ${path}`);
    }
    let sizeBytes = input.sizeBytes;
    let mtimeMs = input.mtimeMs;
    if (sizeBytes === undefined || mtimeMs === undefined) {
      const stats = statSync(path, { throwIfNoEntry: false });
      if (stats?.isFile()) {
        sizeBytes ??= stats.size;
        mtimeMs ??= Math.floor(stats.mtimeMs);
      }
    }
    sizeBytes ??= 0;
    mtimeMs ??= 0;
    const kind = input.kind ?? "other";
    validateKind(kind);
    const now = this.now();
    const entry: LibraryEntry = {
      id: randomUUID(),
      path,
      title: input.title ?? titleFromPath(path),
      kind,
      sizeBytes: Math.max(0, Math.floor(sizeBytes)),
      mtimeMs: Math.floor(mtimeMs),
      fingerprint: input.fingerprint ?? fingerprintFor(path, sizeBytes, mtimeMs),
      missing: false,
      addedAt: now,
      updatedAt: now,
      lastIndexedAt: null,
    };
    this.run(
      "INSERT INTO library_entries (id, path, title, kind, size_bytes, mtime_ms, fingerprint, missing, added_at, updated_at, last_indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      entry.id,
      entry.path,
      entry.title,
      entry.kind,
      entry.sizeBytes,
      entry.mtimeMs,
      entry.fingerprint,
      entry.missing,
      entry.addedAt,
      entry.updatedAt,
      entry.lastIndexedAt,
    );
    return entry;
  }

  getLibraryEntry(id: string): LibraryEntry | null {
    const row = this.one("SELECT * FROM library_entries WHERE id = ?", id);
    return row ? mapEntry(row) : null;
  }

  private findOneEntryByPath(path: string): LibraryEntry | null {
    const row = this.one("SELECT * FROM library_entries WHERE path = ?", path);
    return row ? mapEntry(row) : null;
  }

  findLibraryEntryByPath(path: string): LibraryEntry | null {
    const normalized = statableRealOrResolve(assertSafeAbsolutePath(path, "path"));
    return this.findOneEntryByPath(normalized);
  }

  listLibraryEntries(query: LibraryQuery = {}): LibraryEntry[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.missing !== undefined) {
      clauses.push("missing = ?");
      params.push(query.missing ? 1 : 0);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    return this.all(`SELECT * FROM library_entries${where} ORDER BY added_at, path`, ...params).map(
      mapEntry,
    );
  }

  updateLibraryEntry(id: string, patch: LibraryEntryPatch): LibraryEntry {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(requireNonEmptyText(patch.title, "title"));
    }
    if (patch.kind !== undefined) {
      validateKind(patch.kind);
      sets.push("kind = ?");
      params.push(patch.kind);
    }
    if (patch.sizeBytes !== undefined) {
      sets.push("size_bytes = ?");
      params.push(Math.max(0, Math.floor(patch.sizeBytes)));
    }
    if (patch.mtimeMs !== undefined) {
      sets.push("mtime_ms = ?");
      params.push(Math.floor(patch.mtimeMs));
    }
    if (patch.fingerprint !== undefined) {
      sets.push("fingerprint = ?");
      params.push(patch.fingerprint);
    }
    if (patch.missing !== undefined) {
      sets.push("missing = ?");
      params.push(patch.missing ? 1 : 0);
    }
    if (sets.length === 0) {
      const existing = this.getLibraryEntry(id);
      if (!existing) {
        throw new NotFoundError(`library entry ${id} not found`);
      }
      return existing;
    }
    sets.push("updated_at = ?");
    params.push(this.now());
    params.push(id);
    const result = this.run(
      `UPDATE library_entries SET ${sets.join(", ")} WHERE id = ?`,
      ...params,
    );
    if (result.changes === 0) {
      throw new NotFoundError(`library entry ${id} not found`);
    }
    return this.getLibraryEntry(id) as LibraryEntry;
  }

  deleteLibraryEntry(id: string): boolean {
    return this.run("DELETE FROM library_entries WHERE id = ?", id).changes > 0;
  }

  /** Upsert used by the indexer: matches by path, never stores media bytes. */
  upsertLibraryEntries(files: readonly IndexedFileInfo[]): { added: number; updated: number } {
    return inTransaction(this.db, () => {
      let added = 0;
      let updated = 0;
      const now = this.now();
      for (const file of files) {
        const path = statableRealOrResolve(assertSafeAbsolutePath(file.path, "indexed file path"));
        const kind = file.kind ?? "other";
        validateKind(kind);
        const title = file.title && file.title.trim().length > 0 ? file.title : titleFromPath(path);
        const sizeBytes = Math.max(0, Math.floor(file.sizeBytes ?? 0));
        const mtimeMs = Math.floor(file.mtimeMs ?? 0);
        const fingerprint =
          file.fingerprint && file.fingerprint.length > 0
            ? file.fingerprint
            : fingerprintFor(path, sizeBytes, mtimeMs);
        const existing = this.one("SELECT id FROM library_entries WHERE path = ?", path);
        if (existing) {
          this.run(
            "UPDATE library_entries SET title = ?, kind = ?, size_bytes = ?, mtime_ms = ?, fingerprint = ?, missing = 0, updated_at = ?, last_indexed_at = ? WHERE path = ?",
            title,
            kind,
            sizeBytes,
            mtimeMs,
            fingerprint,
            now,
            now,
            path,
          );
          updated += 1;
        } else {
          this.run(
            "INSERT INTO library_entries (id, path, title, kind, size_bytes, mtime_ms, fingerprint, missing, added_at, updated_at, last_indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
            randomUUID(),
            path,
            title,
            kind,
            sizeBytes,
            mtimeMs,
            fingerprint,
            now,
            now,
            now,
          );
          added += 1;
        }
      }
      return { added, updated };
    });
  }

  /** Marks entries under `root` that were NOT seen in `seenPaths` as missing. */
  markEntriesMissing(root: string, seenPaths: readonly string[]): number {
    const rootReal = statableRealOrResolve(assertSafeAbsolutePath(root, "index root"));
    const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
    const keep = new Set(
      [...seenPaths].map((p) => statableRealOrResolve(assertSafeAbsolutePath(p, "seen path"))),
    );
    const stale = this.all("SELECT id, path FROM library_entries WHERE missing = 0")
      .map((row) => ({ id: asString(row["id"]), path: asString(row["path"]) }))
      .filter((entry) => entry.path.startsWith(prefix) && !keep.has(entry.path));
    if (stale.length === 0) {
      return 0;
    }
    return inTransaction(this.db, () => {
      let marked = 0;
      for (const entry of stale) {
        this.run(
          "UPDATE library_entries SET missing = 1, updated_at = ? WHERE id = ?",
          this.now(),
          entry.id,
        );
        marked += 1;
      }
      return marked;
    });
  }

  // ── collections ─────────────────────────────────────────────────────────────

  createCollection(name: string, description: string | null = null): Collection {
    const trimmed = requireNonEmptyText(name, "collection name");
    if (this.one("SELECT id FROM collections WHERE name = ?", trimmed)) {
      throw new DuplicateError(`a collection named "${trimmed}" already exists`);
    }
    const now = this.now();
    const collection: Collection = {
      id: randomUUID(),
      name: trimmed,
      description,
      createdAt: now,
      updatedAt: now,
    };
    this.run(
      "INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      collection.id,
      collection.name,
      collection.description,
      collection.createdAt,
      collection.updatedAt,
    );
    return collection;
  }

  getCollection(id: string): Collection | null {
    const row = this.one("SELECT * FROM collections WHERE id = ?", id);
    return row ? mapCollection(row) : null;
  }

  findCollectionByName(name: string): Collection | null {
    const row = this.one("SELECT * FROM collections WHERE name = ?", name);
    return row ? mapCollection(row) : null;
  }

  listCollections(): Collection[] {
    return this.all("SELECT * FROM collections ORDER BY name, rowid").map(mapCollection);
  }

  updateCollection(id: string, patch: CollectionPatch): Collection {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      const name = requireNonEmptyText(patch.name, "collection name");
      if (this.one("SELECT id FROM collections WHERE name = ? AND id != ?", name, id)) {
        throw new DuplicateError(`another collection is already named "${name}"`);
      }
      sets.push("name = ?");
      params.push(name);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      params.push(patch.description);
    }
    if (sets.length === 0) {
      const existing = this.getCollection(id);
      if (!existing) {
        throw new NotFoundError(`collection ${id} not found`);
      }
      return existing;
    }
    sets.push("updated_at = ?");
    params.push(this.now());
    params.push(id);
    const result = this.run(`UPDATE collections SET ${sets.join(", ")} WHERE id = ?`, ...params);
    if (result.changes === 0) {
      throw new NotFoundError(`collection ${id} not found`);
    }
    return this.getCollection(id) as Collection;
  }

  deleteCollection(id: string): boolean {
    return this.run("DELETE FROM collections WHERE id = ?", id).changes > 0;
  }

  // ── playlists (ordered items within a collection) ───────────────────────────

  addPlaylistItem(collectionId: string, entryId: string): PlaylistItem {
    if (!this.getCollection(collectionId)) {
      throw new NotFoundError(`collection ${collectionId} not found`);
    }
    this.requireEntry(entryId);
    if (
      this.one(
        "SELECT id FROM playlist_items WHERE collection_id = ? AND entry_id = ?",
        collectionId,
        entryId,
      )
    ) {
      throw new DuplicateError(`entry ${entryId} is already in collection ${collectionId}`);
    }
    return inTransaction(this.db, () => {
      const maxRow = this.one(
        "SELECT MAX(position) AS max_position FROM playlist_items WHERE collection_id = ?",
        collectionId,
      );
      const maxPosition = maxRow?.["max_position"];
      const position =
        maxPosition === null || maxPosition === undefined ? 0 : asNumber(maxPosition) + 1;
      const item: PlaylistItem = {
        id: randomUUID(),
        collectionId,
        entryId,
        position,
        addedAt: this.now(),
      };
      this.run(
        "INSERT INTO playlist_items (id, collection_id, entry_id, position, added_at) VALUES (?, ?, ?, ?, ?)",
        item.id,
        item.collectionId,
        item.entryId,
        item.position,
        item.addedAt,
      );
      this.touchCollection(collectionId);
      return item;
    });
  }

  removePlaylistItem(collectionId: string, entryId: string): boolean {
    if (!this.getCollection(collectionId)) {
      throw new NotFoundError(`collection ${collectionId} not found`);
    }
    return inTransaction(this.db, () => {
      const result = this.run(
        "DELETE FROM playlist_items WHERE collection_id = ? AND entry_id = ?",
        collectionId,
        entryId,
      );
      if (result.changes === 0) {
        return false;
      }
      const remaining = this.all(
        "SELECT id FROM playlist_items WHERE collection_id = ? ORDER BY position, added_at, id",
        collectionId,
      );
      let position = 0;
      for (const row of remaining) {
        this.run(
          "UPDATE playlist_items SET position = ? WHERE id = ?",
          position,
          asString(row["id"]),
        );
        position += 1;
      }
      this.touchCollection(collectionId);
      return true;
    });
  }

  listPlaylistItems(collectionId: string): PlaylistItem[] {
    return this.all(
      "SELECT * FROM playlist_items WHERE collection_id = ? ORDER BY position, added_at, id",
      collectionId,
    ).map(mapPlaylistItem);
  }

  reorderPlaylist(collectionId: string, orderedItemIds: readonly string[]): void {
    if (!this.getCollection(collectionId)) {
      throw new NotFoundError(`collection ${collectionId} not found`);
    }
    inTransaction(this.db, () => {
      const items = this.listPlaylistItems(collectionId);
      if (items.length === 0 && orderedItemIds.length === 0) {
        return;
      }
      const byId = new Map(items.map((item) => [item.id, item]));
      const seen = new Set<string>();
      for (const itemId of orderedItemIds) {
        if (!byId.has(itemId)) {
          throw new NotFoundError(
            `playlist item ${itemId} does not belong to collection ${collectionId}`,
          );
        }
        if (seen.has(itemId)) {
          throw new ValidationError(`playlist item ${itemId} appears twice in the reorder list`);
        }
        seen.add(itemId);
      }
      if (seen.size !== items.length) {
        throw new ValidationError(
          "reorderPlaylist requires every playlist item to be listed exactly once",
        );
      }
      let position = 0;
      for (const itemId of orderedItemIds) {
        this.run("UPDATE playlist_items SET position = ? WHERE id = ?", position, itemId);
        position += 1;
      }
      this.touchCollection(collectionId);
    });
  }

  // ── watched state ───────────────────────────────────────────────────────────

  setWatched(entryId: string, watched: boolean, watchedAt?: number): WatchedState {
    this.requireEntry(entryId);
    const now = this.now();
    const watchedAtValue = watched ? (watchedAt ?? now) : null;
    this.run(
      "INSERT INTO watched_state (entry_id, watched, watched_at, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(entry_id) DO UPDATE SET watched = excluded.watched, watched_at = excluded.watched_at, updated_at = excluded.updated_at",
      entryId,
      watched ? 1 : 0,
      watchedAtValue,
      now,
    );
    return this.getWatchedState(entryId) as WatchedState;
  }

  getWatchedState(entryId: string): WatchedState | null {
    const row = this.one("SELECT * FROM watched_state WHERE entry_id = ?", entryId);
    return row ? mapWatchedState(row) : null;
  }

  listWatched(watched: boolean): LibraryEntry[] {
    return this.all(
      "SELECT le.* FROM library_entries le INNER JOIN watched_state ws ON ws.entry_id = le.id WHERE ws.watched = ? ORDER BY le.title, le.path",
      watched ? 1 : 0,
    ).map(mapEntry);
  }

  // ── progress ────────────────────────────────────────────────────────────────

  setProgress(entryId: string, positionMs: number, durationMs: number | null = null): Progress {
    this.requireEntry(entryId);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      throw new ValidationError("positionMs must be a non-negative finite number");
    }
    const duration =
      durationMs === null || durationMs === undefined ? null : Math.floor(durationMs);
    if (duration !== null && duration <= 0) {
      throw new ValidationError("durationMs must be positive when provided");
    }
    const position = Math.floor(positionMs);
    const now = this.now();
    this.run(
      "INSERT INTO progress (entry_id, position_ms, duration_ms, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(entry_id) DO UPDATE SET position_ms = excluded.position_ms, duration_ms = excluded.duration_ms, updated_at = excluded.updated_at",
      entryId,
      position,
      duration,
      now,
    );
    return this.getProgress(entryId) as Progress;
  }

  getProgress(entryId: string): Progress | null {
    const row = this.one("SELECT * FROM progress WHERE entry_id = ?", entryId);
    if (!row) {
      return null;
    }
    const positionMs = asNumber(row["position_ms"]);
    const durationMs = asNullableNumber(row["duration_ms"]);
    return {
      entryId: asString(row["entry_id"]),
      positionMs,
      durationMs,
      percent: progressPercent(positionMs, durationMs),
      updatedAt: asNumber(row["updated_at"]),
    };
  }

  clearProgress(entryId: string): boolean {
    return this.run("DELETE FROM progress WHERE entry_id = ?", entryId).changes > 0;
  }

  // ── provider metadata cache ─────────────────────────────────────────────────

  putProviderMetadata(input: ProviderMetadataInput): ProviderMetadataRecord {
    const provider = requireNonEmptyText(input.provider, "provider");
    const externalId = requireNonEmptyText(input.externalId, "externalId");
    if (input.entryId !== null && input.entryId !== undefined) {
      this.requireEntry(input.entryId);
    }
    const now = input.now ?? this.now();
    const payloadText = JSON.stringify(input.payload ?? null);
    this.run(
      "INSERT INTO provider_metadata_cache (id, entry_id, provider, external_id, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(provider, external_id) DO UPDATE SET entry_id = excluded.entry_id, payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
      randomUUID(),
      input.entryId ?? null,
      provider,
      externalId,
      payloadText,
      now,
      now + PROVIDER_METADATA_TTL_MS,
    );
    return this.getProviderMetadata(provider, externalId) as ProviderMetadataRecord;
  }

  getProviderMetadata(provider: string, externalId: string): ProviderMetadataRecord | null {
    const row = this.one(
      "SELECT * FROM provider_metadata_cache WHERE provider = ? AND external_id = ?",
      provider,
      externalId,
    );
    return row ? mapProviderMetadata(row) : null;
  }

  listProviderMetadata(provider?: string): ProviderMetadataRecord[] {
    if (provider !== undefined) {
      return this.all(
        "SELECT * FROM provider_metadata_cache WHERE provider = ? ORDER BY fetched_at DESC, rowid DESC",
        provider,
      ).map(mapProviderMetadata);
    }
    return this.all(
      "SELECT * FROM provider_metadata_cache ORDER BY fetched_at DESC, rowid DESC",
    ).map(mapProviderMetadata);
  }

  listExpiredProviderMetadata(cutoffMs: number): ProviderMetadataRecord[] {
    return this.all(
      "SELECT * FROM provider_metadata_cache WHERE fetched_at <= ? ORDER BY fetched_at, rowid",
      cutoffMs,
    ).map(mapProviderMetadata);
  }

  refreshProviderMetadata(id: string, payload: unknown, now: number): ProviderMetadataRecord {
    const result = this.run(
      "UPDATE provider_metadata_cache SET payload = ?, fetched_at = ?, expires_at = ? WHERE id = ?",
      JSON.stringify(payload ?? null),
      now,
      now + PROVIDER_METADATA_TTL_MS,
      id,
    );
    if (result.changes === 0) {
      throw new NotFoundError(`provider metadata ${id} not found`);
    }
    const row = this.one("SELECT * FROM provider_metadata_cache WHERE id = ?", id);
    return mapProviderMetadata(row as Record<string, unknown>);
  }

  deleteProviderMetadata(id: string): boolean {
    return this.run("DELETE FROM provider_metadata_cache WHERE id = ?", id).changes > 0;
  }

  // ── jobs ────────────────────────────────────────────────────────────────────

  enqueueJob(type: string, payload: unknown = null, maxAttempts = 3): Job {
    const jobType = requireNonEmptyText(type, "job type");
    const max = Math.max(1, Math.floor(maxAttempts));
    const now = this.now();
    const job: Job = {
      id: randomUUID(),
      type: jobType,
      payload: JSON.stringify(payload ?? null),
      state: "queued",
      attempts: 0,
      maxAttempts: max,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    this.run(
      "INSERT INTO jobs (id, type, payload, state, attempts, max_attempts, last_error, created_at, updated_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      job.id,
      job.type,
      job.payload,
      job.state,
      job.attempts,
      job.maxAttempts,
      job.lastError,
      job.createdAt,
      job.updatedAt,
      job.startedAt,
      job.finishedAt,
    );
    return job;
  }

  getJob(id: string): Job | null {
    const row = this.one("SELECT * FROM jobs WHERE id = ?", id);
    return row ? mapJob(row) : null;
  }

  claimNextJob(): Job | null {
    return inTransaction(this.db, () => {
      const next = this.one(
        "SELECT id FROM jobs WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1",
      );
      if (!next) {
        return null;
      }
      const id = asString(next["id"]);
      const now = this.now();
      this.run(
        "UPDATE jobs SET state = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
        now,
        now,
        id,
      );
      return this.getJob(id);
    });
  }

  completeJob(id: string): Job {
    const now = this.now();
    const result = this.run(
      "UPDATE jobs SET state = 'done', finished_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      id,
    );
    if (result.changes === 0) {
      throw new NotFoundError(`job ${id} not found`);
    }
    return this.getJob(id) as Job;
  }

  failJob(id: string, errorMessage: string): Job {
    const job = this.getJob(id);
    if (!job) {
      throw new NotFoundError(`job ${id} not found`);
    }
    const now = this.now();
    const message = String(errorMessage).slice(0, 2000);
    if (job.attempts >= job.maxAttempts) {
      this.run(
        "UPDATE jobs SET state = 'failed', last_error = ?, finished_at = ?, updated_at = ? WHERE id = ?",
        message,
        now,
        now,
        id,
      );
    } else {
      this.run(
        "UPDATE jobs SET state = 'queued', last_error = ?, updated_at = ? WHERE id = ?",
        message,
        now,
        id,
      );
    }
    return this.getJob(id) as Job;
  }

  listJobs(state?: JobState): Job[] {
    if (state !== undefined) {
      return this.all("SELECT * FROM jobs WHERE state = ? ORDER BY created_at, rowid", state).map(
        mapJob,
      );
    }
    return this.all("SELECT * FROM jobs ORDER BY created_at, rowid").map(mapJob);
  }
}
