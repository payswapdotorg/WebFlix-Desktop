import type { Migration } from '../migrate';

/**
 * 0001_init — initial WebFlix local-library schema.
 * Forward-only: never edit this file after it ships; append a new migration instead.
 */
export const migration0001Init: Migration = {
  id: 1,
  name: '0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS library_entries (
  id              TEXT PRIMARY KEY,
  path            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('movie', 'series', 'episode', 'other')),
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  mtime_ms        INTEGER NOT NULL DEFAULT 0,
  fingerprint     TEXT NOT NULL,
  missing         INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
  added_at        INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_indexed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_library_entries_fingerprint ON library_entries (fingerprint);
CREATE INDEX IF NOT EXISTS idx_library_entries_missing ON library_entries (missing);

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
  entry_id      TEXT NOT NULL REFERENCES library_entries (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  added_at      INTEGER NOT NULL,
  UNIQUE (collection_id, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_items_collection ON playlist_items (collection_id, position);

CREATE TABLE IF NOT EXISTS watched_state (
  entry_id   TEXT PRIMARY KEY REFERENCES library_entries (id) ON DELETE CASCADE,
  watched    INTEGER NOT NULL CHECK (watched IN (0, 1)),
  watched_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watched_state_watched ON watched_state (watched);

CREATE TABLE IF NOT EXISTS progress (
  entry_id    TEXT PRIMARY KEY REFERENCES library_entries (id) ON DELETE CASCADE,
  position_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_metadata_cache (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT REFERENCES library_entries (id) ON DELETE SET NULL,
  provider    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload     TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_metadata_cache_fetched_at ON provider_metadata_cache (fetched_at);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at);
`,
};
