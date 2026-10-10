/* eslint-disable max-lines -- library.ts: cohesive local-library domain module (collections, playlists, watched state, progress merge rules) delivered as one unit at contract freeze 5549208 (D2-LOCAL lane); splitting post-freeze before desktop acceptance was arbitrated by TL2 as higher-risk than the size debt (repo precedent: autoUpdater.ts). Revisit in Phase-2 module split backlog. */
import {
  CollectionSchema,
  ErrorCode,
  IsoDateTimeSchema,
  LocalPlaylistSchema,
  PlaybackProgressSchema,
  WatchedStateSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  Collection,
  IsoDateTime,
  LocalPlaylist,
  PlaybackProgress,
  WatchedState,
} from "webflix-contracts";
import { parseOrThrow } from "./internal/parse";
import { compareInstants } from "./internal/time";

/**
 * Pure library rules: collection membership invariants, playlist ordering,
 * and watched-state transitions. Validators report violations as data;
 * mutators throw a typed WebFlixError on contract-invalid inputs.
 */

/* ------------------------------------------------------------------ */
/* Collections                                                          */
/* ------------------------------------------------------------------ */

export type CollectionViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "duplicate-entry-ids"; entryIds: string[]; message: string }
  | { code: "smart-with-stored-membership"; message: string }
  | { code: "manual-with-smart-query"; message: string };

/**
 * Invariants beyond the contract schema:
 * - entryIds must be unique;
 * - smart collections derive membership from smartQuery and must persist no entryIds;
 * - manual collections must not carry a smartQuery.
 */
export function validateCollectionInvariants(collection: Collection): CollectionViolation[] {
  const parsed = CollectionSchema.safeParse(collection);
  if (!parsed.success) {
    return [
      {
        code: "invalid-shape",
        message: `not a valid Collection: ${parsed.error.message}`,
      },
    ];
  }
  const violations: CollectionViolation[] = [];
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const entryId of parsed.data.entryIds) {
    if (seen.has(entryId)) duplicated.add(entryId);
    else seen.add(entryId);
  }
  if (duplicated.size > 0) {
    const entryIds = [...duplicated].sort();
    violations.push({
      code: "duplicate-entry-ids",
      entryIds,
      message: `entryIds contains duplicate entries: ${entryIds.join(", ")}`,
    });
  }
  if (parsed.data.kind === "smart" && parsed.data.entryIds.length > 0) {
    violations.push({
      code: "smart-with-stored-membership",
      message: "smart collections derive membership from smartQuery and must persist no entryIds",
    });
  }
  if (parsed.data.kind === "manual" && parsed.data.smartQuery !== undefined) {
    violations.push({
      code: "manual-with-smart-query",
      message: "manual collections must not carry a smartQuery",
    });
  }
  return violations;
}

export type CollectionMutation =
  | { outcome: "added"; collection: Collection }
  | { outcome: "removed"; collection: Collection }
  | { outcome: "unchanged"; collection: Collection; reason: string }
  | { outcome: "rejected"; reason: string };

/** Adds an entry to a manual collection; smart membership is derived and cannot be written. */
export function addToCollection(collection: Collection, entryId: string): CollectionMutation {
  const parsed = parseOrThrow(CollectionSchema, collection, ErrorCode.LibraryCorrupt, "Collection");
  if (parsed.kind === "smart") {
    return {
      outcome: "rejected",
      reason:
        "smart collections derive membership from smartQuery; membership cannot be added manually",
    };
  }
  if (parsed.entryIds.includes(entryId)) {
    return {
      outcome: "unchanged",
      collection: parsed,
      reason: `entry ${entryId} is already a member of collection ${parsed.id}`,
    };
  }
  return {
    outcome: "added",
    collection: { ...parsed, entryIds: [...parsed.entryIds, entryId] },
  };
}

/** Removes an entry from a manual collection; a no-op on absent ids. */
export function removeFromCollection(collection: Collection, entryId: string): CollectionMutation {
  const parsed = parseOrThrow(CollectionSchema, collection, ErrorCode.LibraryCorrupt, "Collection");
  if (parsed.kind === "smart") {
    return {
      outcome: "rejected",
      reason:
        "smart collections derive membership from smartQuery; membership cannot be removed manually",
    };
  }
  if (!parsed.entryIds.includes(entryId)) {
    return {
      outcome: "unchanged",
      collection: parsed,
      reason: `entry ${entryId} is not a member of collection ${parsed.id}`,
    };
  }
  return {
    outcome: "removed",
    collection: {
      ...parsed,
      entryIds: parsed.entryIds.filter((id) => id !== entryId),
    },
  };
}

/** Repairs duplicate membership; first occurrence wins, order is preserved. */
export function dedupeCollection(collection: Collection): Collection {
  const parsed = parseOrThrow(CollectionSchema, collection, ErrorCode.LibraryCorrupt, "Collection");
  const seen = new Set<string>();
  const entryIds: string[] = [];
  for (const id of parsed.entryIds) {
    if (!seen.has(id)) {
      seen.add(id);
      entryIds.push(id);
    }
  }
  return { ...parsed, entryIds };
}

/* ------------------------------------------------------------------ */
/* Playlists                                                            */
/* ------------------------------------------------------------------ */

export type PlaylistViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "duplicate-item-ids"; itemIds: string[]; message: string };

/** Invariant beyond the contract schema: itemIds must be unique. */
export function validatePlaylistInvariants(playlist: LocalPlaylist): PlaylistViolation[] {
  const parsed = LocalPlaylistSchema.safeParse(playlist);
  if (!parsed.success) {
    return [
      {
        code: "invalid-shape",
        message: `not a valid LocalPlaylist: ${parsed.error.message}`,
      },
    ];
  }
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const id of parsed.data.itemIds) {
    if (seen.has(id)) duplicated.add(id);
    else seen.add(id);
  }
  if (duplicated.size === 0) return [];
  const itemIds = [...duplicated].sort();
  return [
    {
      code: "duplicate-item-ids",
      itemIds,
      message: `itemIds contains duplicate items: ${itemIds.join(", ")}`,
    },
  ];
}

export type PlaylistMutation =
  | { outcome: "added"; playlist: LocalPlaylist }
  | { outcome: "removed"; playlist: LocalPlaylist }
  | { outcome: "moved"; playlist: LocalPlaylist }
  | { outcome: "unchanged"; playlist: LocalPlaylist; reason: string };

function requireInteger(value: number, what: string): number {
  if (!Number.isInteger(value)) {
    throw new WebFlixError({
      code: ErrorCode.LibraryCorrupt,
      reason: `${what} must be an integer, got ${value}`,
      retryable: false,
      context: { [what]: value },
    });
  }
  return value;
}

/**
 * Adds an item, preserving unique membership: duplicates are a no-op (use
 * moveInPlaylist to reorder). `position` is optional and clamped into
 * [0, length]; the array order of itemIds is the playback order.
 */
export function addToPlaylist(
  playlist: LocalPlaylist,
  itemId: string,
  position?: number,
): PlaylistMutation {
  const parsed = parseOrThrow(
    LocalPlaylistSchema,
    playlist,
    ErrorCode.LibraryCorrupt,
    "LocalPlaylist",
  );
  if (parsed.itemIds.includes(itemId)) {
    return {
      outcome: "unchanged",
      playlist: parsed,
      reason: `item ${itemId} is already in playlist ${parsed.id}; use moveInPlaylist to reorder`,
    };
  }
  const itemIds = [...parsed.itemIds];
  if (position === undefined) {
    itemIds.push(itemId);
  } else {
    const index = Math.max(0, Math.min(requireInteger(position, "position"), itemIds.length));
    itemIds.splice(index, 0, itemId);
  }
  return { outcome: "added", playlist: { ...parsed, itemIds } };
}

/** Removes an item; relative order of the remaining items is preserved. */
export function removeFromPlaylist(playlist: LocalPlaylist, itemId: string): PlaylistMutation {
  const parsed = parseOrThrow(
    LocalPlaylistSchema,
    playlist,
    ErrorCode.LibraryCorrupt,
    "LocalPlaylist",
  );
  if (!parsed.itemIds.includes(itemId)) {
    return {
      outcome: "unchanged",
      playlist: parsed,
      reason: `item ${itemId} is not in playlist ${parsed.id}`,
    };
  }
  return {
    outcome: "removed",
    playlist: {
      ...parsed,
      itemIds: parsed.itemIds.filter((id) => id !== itemId),
    },
  };
}

/** Moves an item to a (clamped) index; no-op when absent or already there. */
export function moveInPlaylist(
  playlist: LocalPlaylist,
  itemId: string,
  toIndex: number,
): PlaylistMutation {
  const parsed = parseOrThrow(
    LocalPlaylistSchema,
    playlist,
    ErrorCode.LibraryCorrupt,
    "LocalPlaylist",
  );
  const from = parsed.itemIds.indexOf(itemId);
  if (from === -1) {
    return {
      outcome: "unchanged",
      playlist: parsed,
      reason: `item ${itemId} is not in playlist ${parsed.id}`,
    };
  }
  const target = Math.max(
    0,
    Math.min(requireInteger(toIndex, "toIndex"), parsed.itemIds.length - 1),
  );
  if (target === from) {
    return {
      outcome: "unchanged",
      playlist: parsed,
      reason: `item ${itemId} is already at position ${target}`,
    };
  }
  const itemIds = [...parsed.itemIds];
  const [moved] = itemIds.splice(from, 1);
  itemIds.splice(target, 0, moved);
  return { outcome: "moved", playlist: { ...parsed, itemIds } };
}

/** Repairs duplicate membership; first occurrence wins, order is preserved. */
export function dedupePlaylist(playlist: LocalPlaylist): LocalPlaylist {
  const parsed = parseOrThrow(
    LocalPlaylistSchema,
    playlist,
    ErrorCode.LibraryCorrupt,
    "LocalPlaylist",
  );
  const seen = new Set<string>();
  const itemIds: string[] = [];
  for (const id of parsed.itemIds) {
    if (!seen.has(id)) {
      seen.add(id);
      itemIds.push(id);
    }
  }
  return { ...parsed, itemIds };
}

export interface PlaybackOrderOptions {
  /** Override the shuffle decision; defaults to the playlist's own flag. */
  shuffle?: boolean;
  /** Deterministic seed for shuffle (default 0): same seed ⇒ same order. */
  seed?: number;
  /** Repeat passes when the playlist loops (default 1, capped at 10 000). */
  passes?: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(itemIds: string[], seed: number): string[] {
  const items = [...itemIds];
  const random = mulberry32(seed);
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/**
 * Derives the playback order for one listening session:
 * - shuffle (playlist flag or explicit override) uses a seeded, deterministic
 *   Fisher–Yates so a given seed always yields the same order;
 * - loop replays the same base order for `passes` passes; without loop,
 *   `passes` is ignored (a single pass).
 */
export function playlistPlaybackOrder(
  playlist: LocalPlaylist,
  options: PlaybackOrderOptions = {},
): string[] {
  const parsed = parseOrThrow(
    LocalPlaylistSchema,
    playlist,
    ErrorCode.LibraryCorrupt,
    "LocalPlaylist",
  );
  const shuffle = options.shuffle ?? parsed.shuffle;
  const base = shuffle ? seededShuffle(parsed.itemIds, options.seed ?? 0) : [...parsed.itemIds];
  const passes = parsed.loop ? Math.max(1, Math.min(Math.floor(options.passes ?? 1), 10000)) : 1;
  const order: string[] = [];
  for (let pass = 0; pass < passes; pass += 1) order.push(...base);
  return order;
}

/* ------------------------------------------------------------------ */
/* Watched state                                                        */
/* ------------------------------------------------------------------ */

export interface WatchedRulesOptions {
  /**
   * A position within this many milliseconds of the duration counts as
   * complete (default 0: only position >= duration completes).
   */
  completionToleranceMs?: number;
}

export type WatchedTransition =
  | {
      outcome: "started" | "advanced" | "rewound" | "completed" | "reset" | "restarted";
      state: WatchedState;
    }
  | {
      outcome: "stale" | "ignored" | "unchanged";
      state: WatchedState;
      reason: string;
    };

/** Fresh, pristine watched state for an item. */
export function initialWatchedState(itemId: string, at: IsoDateTime): WatchedState {
  const instant = parseOrThrow(
    IsoDateTimeSchema,
    at,
    ErrorCode.LibraryCorrupt,
    "watched-state timestamp",
  );
  return {
    itemId,
    status: "unwatched",
    watchedFraction: 0,
    lastPositionMs: 0,
    updatedAt: instant,
  };
}

/**
 * Applies a playback-progress event to watched state. Transition rules:
 *
 * - progress for a different item → `ignored`;
 * - progress older than the state (strictly) → `stale` (out-of-order events
 *   never move state backwards in time; equal timestamps are applied);
 * - watched state is protected: resume pings after completion are `ignored`
 *   (resume-after-complete) — call restartWatching to rewatch explicitly;
 * - position (+ tolerance) reaching duration → `completed` (position clamped
 *   to duration, completedAt stamped);
 * - otherwise in-progress: `started` from unwatched, `rewound` when the
 *   position moves backwards, `advanced` otherwise. Unknown durations
 *   (durationMs = 0) never divide into zero: fraction stays 0.
 */
export function applyWatchedProgress(
  state: WatchedState,
  progress: PlaybackProgress,
  options: WatchedRulesOptions = {},
): WatchedTransition {
  const current = parseOrThrow(WatchedStateSchema, state, ErrorCode.LibraryCorrupt, "WatchedState");
  const event = parseOrThrow(
    PlaybackProgressSchema,
    progress,
    ErrorCode.LibraryCorrupt,
    "PlaybackProgress",
  );
  const tolerance = options.completionToleranceMs ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new WebFlixError({
      code: ErrorCode.LibraryCorrupt,
      reason: `completionToleranceMs must be a non-negative finite number, got ${tolerance}`,
      retryable: false,
      context: { completionToleranceMs: options.completionToleranceMs },
    });
  }

  if (event.itemId !== current.itemId) {
    return {
      outcome: "ignored",
      state: current,
      reason: `progress is for item ${event.itemId}, not ${current.itemId}`,
    };
  }
  if (compareInstants(event.updatedAt, current.updatedAt) < 0) {
    return {
      outcome: "stale",
      state: current,
      reason: `progress timestamp ${event.updatedAt} predates state timestamp ${current.updatedAt}`,
    };
  }

  const duration = event.durationMs;
  const completed = duration > 0 && event.positionMs + tolerance >= duration;

  if (current.status === "watched") {
    if (completed) {
      return {
        outcome: "unchanged",
        state: current,
        reason: "item is already watched",
      };
    }
    return {
      outcome: "ignored",
      state: current,
      reason: "resume-after-complete: watched state is protected; call restartWatching to rewatch",
    };
  }

  if (completed) {
    return {
      outcome: "completed",
      state: {
        ...current,
        status: "watched",
        watchedFraction: 1,
        lastPositionMs: Math.min(event.positionMs, duration),
        updatedAt: event.updatedAt,
        completedAt: event.updatedAt,
      },
    };
  }

  const fraction = duration > 0 ? Math.min(1, Math.max(0, event.positionMs / duration)) : 0;
  const outcome: "started" | "advanced" | "rewound" =
    current.status === "unwatched"
      ? "started"
      : event.positionMs < current.lastPositionMs
        ? "rewound"
        : "advanced";
  return {
    outcome,
    state: {
      ...current,
      status: "in-progress",
      watchedFraction: fraction,
      lastPositionMs: Math.max(0, event.positionMs),
      updatedAt: event.updatedAt,
      completedAt: undefined,
    },
  };
}

/** Explicit user completion; overrides the watched-state protection. */
export function markWatched(state: WatchedState, at: IsoDateTime): WatchedTransition {
  const current = parseOrThrow(WatchedStateSchema, state, ErrorCode.LibraryCorrupt, "WatchedState");
  const instant = parseOrThrow(
    IsoDateTimeSchema,
    at,
    ErrorCode.LibraryCorrupt,
    "watched-state timestamp",
  );
  if (current.status === "watched") {
    return {
      outcome: "unchanged",
      state: current,
      reason: "item is already watched",
    };
  }
  return {
    outcome: "completed",
    state: {
      ...current,
      status: "watched",
      watchedFraction: 1,
      updatedAt: instant,
      completedAt: instant,
    },
  };
}

/** Explicit reset to pristine unwatched state (clears completedAt). */
export function markUnwatched(state: WatchedState, at: IsoDateTime): WatchedTransition {
  const current = parseOrThrow(WatchedStateSchema, state, ErrorCode.LibraryCorrupt, "WatchedState");
  const instant = parseOrThrow(
    IsoDateTimeSchema,
    at,
    ErrorCode.LibraryCorrupt,
    "watched-state timestamp",
  );
  if (
    current.status === "unwatched" &&
    current.watchedFraction === 0 &&
    current.lastPositionMs === 0
  ) {
    return {
      outcome: "unchanged",
      state: current,
      reason: "item is already unwatched",
    };
  }
  return {
    outcome: "reset",
    state: {
      itemId: current.itemId,
      status: "unwatched",
      watchedFraction: 0,
      lastPositionMs: 0,
      updatedAt: instant,
    },
  };
}

/** Explicit rewatch: watched → in-progress at position 0 (clears completedAt). */
export function restartWatching(state: WatchedState, at: IsoDateTime): WatchedTransition {
  const current = parseOrThrow(WatchedStateSchema, state, ErrorCode.LibraryCorrupt, "WatchedState");
  const instant = parseOrThrow(
    IsoDateTimeSchema,
    at,
    ErrorCode.LibraryCorrupt,
    "watched-state timestamp",
  );
  if (current.status !== "watched") {
    return {
      outcome: "unchanged",
      state: current,
      reason: "only watched items can be restarted",
    };
  }
  return {
    outcome: "restarted",
    state: {
      ...current,
      status: "in-progress",
      watchedFraction: 0,
      lastPositionMs: 0,
      updatedAt: instant,
      completedAt: undefined,
    },
  };
}

export type WatchedStateViolation =
  | { code: "invalid-shape"; message: string }
  | { code: "watched-without-completion"; message: string };

/**
 * Domain invariant beyond the contract schema: a watched state must carry
 * watchedFraction 1. Range and sign checks are already enforced by the
 * locked schema, so any schema-invalid input is reported as invalid-shape.
 */
export function validateWatchedStateInvariants(state: WatchedState): WatchedStateViolation[] {
  const parsed = WatchedStateSchema.safeParse(state);
  if (!parsed.success) {
    return [
      {
        code: "invalid-shape",
        message: `not a valid WatchedState: ${parsed.error.message}`,
      },
    ];
  }
  if (parsed.data.status === "watched" && parsed.data.watchedFraction !== 1) {
    return [
      {
        code: "watched-without-completion",
        message: `watched items must carry watchedFraction 1, got ${parsed.data.watchedFraction}`,
      },
    ];
  }
  return [];
}
