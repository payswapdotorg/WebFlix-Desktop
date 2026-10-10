/**
 * Unit tests for the pure domain rules in webflix-domain:
 * catalog merge (thresholds, ambiguous separation, conflicts, idempotency),
 * library rules (collection invariants, playlist ordering, watched-state
 * transitions with resume semantics), and job semantics (retry/backoff,
 * cancellation, provenance preservation).
 *
 * Named edge cases from the milestone: ambiguous merge,
 * resume-after-complete, retry exhaustion.
 */
import { describe, expect, it } from "vitest";
import * as domain from "../index";
import {
  addToCollection,
  addToPlaylist,
  acknowledgeCancellation,
  applyRetryDecision,
  applyWatchedProgress,
  compareInstants,
  computeBackoffMs,
  decideRetry,
  dedupeCollection,
  dedupePlaylist,
  deriveArtifactProvenance,
  initialWatchedState,
  isProvenancePreserved,
  isRetryableFailureMode,
  isTerminalJobState,
  jobArtifactProvenance,
  markUnwatched,
  markWatched,
  mergeCatalogItem,
  moveInPlaylist,
  parseIsoToEpochMs,
  playlistPlaybackOrder,
  removeFromCollection,
  removeFromPlaylist,
  requestCancellation,
  restartWatching,
  transitionJob,
  validateCollectionInvariants,
  validatePlaylistInvariants,
  validateWatchedStateInvariants,
} from "../index";
import type { CatalogMergeResult, JobRetryDecision } from "../index";
import {
  CatalogItemSchema,
  CollectionSchema,
  ErrorCode,
  JobDescriptorSchema,
  LocalPlaylistSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  Collection,
  IsoDateTime,
  JobDescriptor,
  PlaybackProgress,
  ProviderAsset,
  RetryPolicy,
  WatchedState,
} from "webflix-contracts";

const T0 = "2025-06-01T12:00:00Z";
const T0_AND_HALF = "2025-06-01T12:00:00.500Z";
const T1 = "2025-06-01T12:01:00Z";
const T2 = "2025-06-01T12:02:00Z";
const T3 = "2025-06-01T12:03:00Z";
const T4 = "2025-06-01T12:04:00Z";
const SHA256_TEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

function expectKind<T extends CatalogMergeResult["kind"]>(
  result: CatalogMergeResult,
  kind: T,
): Extract<CatalogMergeResult, { kind: T }> {
  expect(result.kind).toBe(kind);
  return result as Extract<CatalogMergeResult, { kind: T }>;
}

function expectRetry(decision: JobRetryDecision): Extract<JobRetryDecision, { outcome: "retry" }> {
  expect(decision.outcome).toBe("retry");
  if (decision.outcome !== "retry") throw new Error("expected a retry decision");
  return decision;
}

function expectWebFlixError(run: () => unknown, code?: ErrorCode): void {
  try {
    run();
  } catch (err) {
    if (!(err instanceof WebFlixError)) throw err;
    if (code !== undefined) expect(err.code).toBe(code);
    return;
  }
  throw new Error("expected the call to throw a WebFlixError");
}

describe("public entrypoint", () => {
  it("re-exports the domain rule surface", () => {
    for (const name of [
      "mergeCatalogItem",
      "strongerEvidence",
      "DEFAULT_MERGE_THRESHOLDS",
      "validateCollectionInvariants",
      "addToCollection",
      "removeFromCollection",
      "dedupeCollection",
      "validatePlaylistInvariants",
      "addToPlaylist",
      "removeFromPlaylist",
      "moveInPlaylist",
      "dedupePlaylist",
      "playlistPlaybackOrder",
      "initialWatchedState",
      "applyWatchedProgress",
      "markWatched",
      "markUnwatched",
      "restartWatching",
      "validateWatchedStateInvariants",
      "INHERENTLY_RETRYABLE_FAILURE_MODES",
      "isRetryableFailureMode",
      "DEFAULT_MAX_BACKOFF_MS",
      "computeBackoffMs",
      "decideRetry",
      "applyRetryDecision",
      "TERMINAL_JOB_STATES",
      "isTerminalJobState",
      "requestCancellation",
      "acknowledgeCancellation",
      "transitionJob",
      "jobArtifactProvenance",
      "deriveArtifactProvenance",
      "isProvenancePreserved",
      "compareInstants",
      "parseIsoToEpochMs",
    ]) {
      expect(domain).toHaveProperty(name);
    }
  });
});

describe("catalog merge", () => {
  const existingItem: CatalogItem = CatalogItemSchema.parse({
    id: "cat-001",
    providerId: "netflix",
    title: "Example Documentary",
    mediaKind: "video",
    assets: [
      {
        assetId: "thumb-1",
        kind: "thumbnail",
        reference: "https://img.example.com/cat-001.jpg",
        mimeType: "image/jpeg",
      },
    ],
    matchEvidence: { confidence: 0.8, evidence: ["exact title match"] },
    metadata: { externalIds: { tmdb: "12345" } },
  });

  const streamAsset = {
    assetId: "stream-1",
    kind: "stream",
    reference: "https://cdn.example.com/cat-001.m3u8",
    mimeType: "application/x-mpegURL",
  } as const;

  it("merges a new asset above autoMergeAt and upgrades weaker evidence", () => {
    const result = expectKind(
      mergeCatalogItem(existingItem, streamAsset, {
        confidence: 0.95,
        evidence: ["duration match", "release year match"],
      }),
      "merged",
    );
    expect(result.item.assets.map((asset) => asset.assetId)).toEqual(["thumb-1", "stream-1"]);
    expect(result.item.matchEvidence?.confidence).toBe(0.95);
    expect(result.reason).toContain("attached");
  });

  it("keeps stronger existing evidence when the incoming match is weaker", () => {
    const strong = CatalogItemSchema.parse({
      ...existingItem,
      id: "cat-strong",
      matchEvidence: { confidence: 0.95, evidence: ["exact title + runtime match"] },
    });
    const result = expectKind(
      mergeCatalogItem(strong, streamAsset, {
        confidence: 0.9,
        evidence: ["title match only"],
      }),
      "merged",
    );
    expect(result.item.matchEvidence?.confidence).toBe(0.95);
  });

  it("attaches incoming evidence when the item had none", () => {
    const bare = CatalogItemSchema.parse({
      id: "cat-002",
      providerId: "netflix",
      title: "Bare Item",
      mediaKind: "video",
      assets: [],
      metadata: {},
    });
    const result = expectKind(
      mergeCatalogItem(bare, streamAsset, {
        confidence: 0.9,
        evidence: ["filename match"],
      }),
      "merged",
    );
    expect(result.item.matchEvidence?.confidence).toBe(0.9);
  });

  it("is idempotent when the identical asset is merged again", () => {
    const result = expectKind(
      mergeCatalogItem(
        existingItem,
        {
          assetId: "thumb-1",
          kind: "thumbnail",
          reference: "https://img.example.com/cat-001.jpg",
          mimeType: "image/jpeg",
        },
        { confidence: 0.99, evidence: ["exact asset"] },
      ),
      "unchanged",
    );
    expect(result.item.assets).toHaveLength(1);
  });

  it("refreshes an asset with the same assetId at high confidence", () => {
    const result = expectKind(
      mergeCatalogItem(
        existingItem,
        {
          assetId: "thumb-1",
          kind: "thumbnail",
          reference: "https://img.example.com/cat-001-v2.jpg",
          mimeType: "image/jpeg",
        },
        { confidence: 0.95, evidence: ["provider refresh"] },
      ),
      "merged",
    );
    expect(result.item.assets).toHaveLength(1);
    expect(result.item.assets[0].reference).toBe("https://img.example.com/cat-001-v2.jpg");
    expect(result.reason).toContain("refreshed");
  });

  it("flags assetId reuse with different content below autoMergeAt as a conflict", () => {
    const result = expectKind(
      mergeCatalogItem(
        existingItem,
        {
          assetId: "thumb-1",
          kind: "thumbnail",
          reference: "https://img.example.com/cat-001-v2.jpg",
        },
        { confidence: 0.7, evidence: ["weak"] },
      ),
      "conflict",
    );
    expect(result.incoming.assetId).toBe("thumb-1");
  });

  it("flags a duplicate kind+reference under a different assetId as a conflict", () => {
    const result = expectKind(
      mergeCatalogItem(
        existingItem,
        {
          assetId: "thumb-2",
          kind: "thumbnail",
          reference: "https://img.example.com/cat-001.jpg",
        },
        { confidence: 0.99, evidence: ["dup ref"] },
      ),
      "conflict",
    );
    expect(result.incoming.assetId).toBe("thumb-2");
  });

  it("keeps ambiguous matches as separate items", () => {
    const result = expectKind(
      mergeCatalogItem(existingItem, streamAsset, {
        confidence: 0.7,
        evidence: ["title match"],
      }),
      "ambiguous",
    );
    expect(result.existing.id).toBe("cat-001");
    expect(result.existing.assets).toHaveLength(1);
    expect(result.candidate.id).toBe("candidate:stream-1");
    expect(result.candidate.id).not.toBe(result.existing.id);
    expect(result.candidate.assets.map((asset) => asset.assetId)).toEqual(["stream-1"]);
    expect(result.candidate.matchEvidence?.confidence).toBe(0.7);
    expect(result.candidate.mediaKind).toBe("video");
  });

  it("keeps low-confidence matches fully separate", () => {
    const result = expectKind(
      mergeCatalogItem(existingItem, streamAsset, {
        confidence: 0.3,
        evidence: ["vague hunch"],
      }),
      "separate",
    );
    expect(result.candidate.id).not.toBe(result.existing.id);
    expect(result.existing.assets).toHaveLength(1);
  });

  it("lets the caller seed the candidate item for ambiguous/separate outcomes", () => {
    const result = expectKind(
      mergeCatalogItem(
        existingItem,
        streamAsset,
        { confidence: 0.7, evidence: ["title match"] },
        {
          candidateSeed: {
            id: "cat-999",
            title: "Possibly the same film",
            mediaKind: "podcast",
          },
        },
      ),
      "ambiguous",
    );
    expect(result.candidate.id).toBe("cat-999");
    expect(result.candidate.title).toBe("Possibly the same film");
    expect(result.candidate.mediaKind).toBe("podcast");
  });

  it("rejects invalid thresholds", () => {
    expectWebFlixError(
      () =>
        mergeCatalogItem(
          existingItem,
          streamAsset,
          { confidence: 0.99, evidence: [] },
          { thresholds: { autoMergeAt: 1.2, ambiguousBelow: 0.6 } },
        ),
      ErrorCode.CatalogMatchFailed,
    );
    expectWebFlixError(
      () =>
        mergeCatalogItem(
          existingItem,
          streamAsset,
          { confidence: 0.99, evidence: [] },
          { thresholds: { autoMergeAt: 0.5, ambiguousBelow: 0.6 } },
        ),
      ErrorCode.CatalogMatchFailed,
    );
  });

  it("rejects inputs that are not valid contract instances", () => {
    expectWebFlixError(() =>
      mergeCatalogItem(undefined as unknown as CatalogItem, streamAsset, {
        confidence: 0.99,
        evidence: [],
      }),
    );
    expectWebFlixError(() =>
      mergeCatalogItem(existingItem, null as unknown as ProviderAsset, {
        confidence: 0.99,
        evidence: [],
      }),
    );
  });

  it("never mutates its inputs", () => {
    const before = JSON.parse(JSON.stringify(existingItem));
    mergeCatalogItem(existingItem, streamAsset, {
      confidence: 0.95,
      evidence: ["x"],
    });
    mergeCatalogItem(existingItem, streamAsset, {
      confidence: 0.7,
      evidence: ["x"],
    });
    expect(existingItem).toEqual(before);
  });
});

describe("collection rules", () => {
  const manual = () =>
    CollectionSchema.parse({
      id: "col-1",
      name: "Favourites",
      kind: "manual",
      entryIds: ["lib-1", "lib-2"],
      createdAt: T0,
      updatedAt: T0,
    });
  const smart = () =>
    CollectionSchema.parse({
      id: "col-2",
      name: "Recent podcasts",
      kind: "smart",
      entryIds: [],
      smartQuery: { mediaKind: "podcast", tags: ["commute"] },
      createdAt: T0,
      updatedAt: T0,
    });

  it("passes a clean manual collection", () => {
    expect(validateCollectionInvariants(manual())).toEqual([]);
  });

  it("flags duplicate entryIds", () => {
    const dirty = CollectionSchema.parse({
      id: "col-3",
      name: "Dupes",
      kind: "manual",
      entryIds: ["lib-1", "lib-2", "lib-1"],
      createdAt: T0,
      updatedAt: T0,
    });
    const violations = validateCollectionInvariants(dirty);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      code: "duplicate-entry-ids",
      entryIds: ["lib-1"],
    });
  });

  it("flags stored membership on smart collections", () => {
    const dirty = CollectionSchema.parse({
      id: "col-4",
      name: "Broken smart",
      kind: "smart",
      entryIds: ["lib-1"],
      smartQuery: { tags: [] },
      createdAt: T0,
      updatedAt: T0,
    });
    expect(validateCollectionInvariants(dirty).map((v) => v.code)).toEqual([
      "smart-with-stored-membership",
    ]);
  });

  it("flags smartQuery on manual collections", () => {
    const dirty = CollectionSchema.parse({
      id: "col-5",
      name: "Broken manual",
      kind: "manual",
      entryIds: [],
      smartQuery: { tags: [] },
      createdAt: T0,
      updatedAt: T0,
    });
    expect(validateCollectionInvariants(dirty).map((v) => v.code)).toEqual([
      "manual-with-smart-query",
    ]);
  });

  it("reports invalid shapes instead of throwing", () => {
    const violations = validateCollectionInvariants({
      id: "col-6",
      name: "",
      kind: "manual",
      createdAt: T0,
      updatedAt: T0,
    } as unknown as Collection);
    expect(violations).toEqual([{ code: "invalid-shape", message: expect.any(String) }]);
  });

  it("adds, dedupes and rejects membership writes", () => {
    const added = addToCollection(manual(), "lib-3");
    expect(added.outcome).toBe("added");
    if (added.outcome === "added") {
      expect(added.collection.entryIds).toEqual(["lib-1", "lib-2", "lib-3"]);
    }
    expect(addToCollection(manual(), "lib-1")).toMatchObject({
      outcome: "unchanged",
    });
    expect(addToCollection(smart(), "lib-1")).toMatchObject({
      outcome: "rejected",
    });
    const removed = removeFromCollection(manual(), "lib-1");
    expect(removed.outcome).toBe("removed");
    if (removed.outcome === "removed") {
      expect(removed.collection.entryIds).toEqual(["lib-2"]);
    }
    expect(removeFromCollection(manual(), "nope")).toMatchObject({
      outcome: "unchanged",
    });
    expect(removeFromCollection(smart(), "lib-1")).toMatchObject({
      outcome: "rejected",
    });
  });

  it("dedupes entryIds preserving first occurrence order", () => {
    const dirty = CollectionSchema.parse({
      id: "col-7",
      name: "Dupes",
      kind: "manual",
      entryIds: ["b", "a", "b", "c", "a"],
      createdAt: T0,
      updatedAt: T0,
    });
    expect(dedupeCollection(dirty).entryIds).toEqual(["b", "a", "c"]);
  });
});

describe("playlist rules", () => {
  const base = () =>
    LocalPlaylistSchema.parse({
      id: "pl-1",
      name: "Commute mix",
      itemIds: ["a", "b", "c"],
      loop: false,
      shuffle: false,
      createdAt: T0,
      updatedAt: T0,
    });

  it("appends by default and honours clamped insertion positions", () => {
    const appended = addToPlaylist(base(), "d");
    expect(appended.outcome).toBe("added");
    if (appended.outcome === "added") {
      expect(appended.playlist.itemIds).toEqual(["a", "b", "c", "d"]);
    }
    const front = addToPlaylist(base(), "d", 0);
    if (front.outcome === "added") {
      expect(front.playlist.itemIds).toEqual(["d", "a", "b", "c"]);
    }
    const clampedEnd = addToPlaylist(base(), "d", 99);
    if (clampedEnd.outcome === "added") {
      expect(clampedEnd.playlist.itemIds).toEqual(["a", "b", "c", "d"]);
    }
    const clampedStart = addToPlaylist(base(), "d", -2);
    if (clampedStart.outcome === "added") {
      expect(clampedStart.playlist.itemIds).toEqual(["d", "a", "b", "c"]);
    }
  });

  it("never duplicates membership", () => {
    const result = addToPlaylist(base(), "b");
    expect(result.outcome).toBe("unchanged");
    if (result.outcome === "unchanged") {
      expect(result.reason).toContain("already");
    }
  });

  it("removes while preserving relative order", () => {
    const result = removeFromPlaylist(base(), "b");
    expect(result.outcome).toBe("removed");
    if (result.outcome === "removed") {
      expect(result.playlist.itemIds).toEqual(["a", "c"]);
    }
    expect(removeFromPlaylist(base(), "zz").outcome).toBe("unchanged");
  });

  it("moves items with clamping and rejects no-op moves", () => {
    const toFront = moveInPlaylist(base(), "c", 0);
    expect(toFront.outcome).toBe("moved");
    if (toFront.outcome === "moved") {
      expect(toFront.playlist.itemIds).toEqual(["c", "a", "b"]);
    }
    const toEnd = moveInPlaylist(base(), "a", 99);
    if (toEnd.outcome === "moved") {
      expect(toEnd.playlist.itemIds).toEqual(["b", "c", "a"]);
    }
    expect(moveInPlaylist(base(), "a", 0).outcome).toBe("unchanged");
    expect(moveInPlaylist(base(), "zz", 0).outcome).toBe("unchanged");
    expectWebFlixError(() => moveInPlaylist(base(), "a", 0.5));
    expectWebFlixError(() => addToPlaylist(base(), "d", 1.5));
  });

  it("flags duplicate itemIds and dedupes", () => {
    const dirty = LocalPlaylistSchema.parse({
      id: "pl-2",
      name: "Dupes",
      itemIds: ["a", "b", "a"],
      loop: false,
      shuffle: false,
      createdAt: T0,
      updatedAt: T0,
    });
    const violations = validatePlaylistInvariants(dirty);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      code: "duplicate-item-ids",
      itemIds: ["a"],
    });
    expect(dedupePlaylist(dirty).itemIds).toEqual(["a", "b"]);
    expect(validatePlaylistInvariants(base())).toEqual([]);
  });

  it("derives playback order: identity, loop passes, deterministic shuffle", () => {
    expect(playlistPlaybackOrder(base())).toEqual(["a", "b", "c"]);
    const looper = LocalPlaylistSchema.parse({
      id: "pl-3",
      name: "Loop",
      itemIds: ["a", "b", "c"],
      loop: true,
      shuffle: false,
      createdAt: T0,
      updatedAt: T0,
    });
    expect(playlistPlaybackOrder(looper, { passes: 2 })).toEqual(["a", "b", "c", "a", "b", "c"]);
    expect(playlistPlaybackOrder(base(), { passes: 3 })).toEqual(["a", "b", "c"]);
    const shuffler = LocalPlaylistSchema.parse({
      id: "pl-4",
      name: "Shuffled",
      itemIds: ["a", "b", "c", "d", "e", "f"],
      loop: false,
      shuffle: true,
      createdAt: T0,
      updatedAt: T0,
    });
    const first = playlistPlaybackOrder(shuffler);
    const second = playlistPlaybackOrder(shuffler);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(playlistPlaybackOrder(shuffler, { shuffle: false })).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });
});

describe("watched-state rules", () => {
  const DURATION = 3600000;
  const progress = (
    positionMs: number,
    updatedAt: IsoDateTime,
    itemId = "cat-001",
  ): PlaybackProgress => ({ itemId, positionMs, durationMs: DURATION, updatedAt });

  it("starts fresh states as unwatched", () => {
    expect(initialWatchedState("cat-001", T0)).toEqual({
      itemId: "cat-001",
      status: "unwatched",
      watchedFraction: 0,
      lastPositionMs: 0,
      updatedAt: T0,
    });
  });

  it("moves unwatched → in-progress (partial) on first progress", () => {
    const t = applyWatchedProgress(initialWatchedState("cat-001", T0), progress(60000, T1));
    expect(t.outcome).toBe("started");
    expect(t.state.status).toBe("in-progress");
    expect(t.state.watchedFraction).toBe(60000 / DURATION);
    expect(t.state.lastPositionMs).toBe(60000);
    expect(t.state.updatedAt).toBe(T1);
  });

  it("advances, rewinds, and treats equal timestamps as newer", () => {
    const state = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(120000, T2),
    ).state;
    expect(applyWatchedProgress(state, progress(240000, T3)).outcome).toBe("advanced");
    expect(applyWatchedProgress(state, progress(60000, T3)).outcome).toBe("rewound");
    expect(applyWatchedProgress(state, progress(240000, T2)).outcome).toBe("advanced");
  });

  it("ignores out-of-order (stale) progress", () => {
    const state = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(120000, T2),
    ).state;
    const stale = applyWatchedProgress(state, progress(60000, T1));
    expect(stale.outcome).toBe("stale");
    expect(stale.state).toEqual(state);
  });

  it("completes at duration, clamping overshoot", () => {
    const state = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(60000, T1),
    ).state;
    const done = applyWatchedProgress(state, progress(DURATION, T2));
    expect(done.outcome).toBe("completed");
    expect(done.state.status).toBe("watched");
    expect(done.state.watchedFraction).toBe(1);
    expect(done.state.completedAt).toBe(T2);
    expect(done.state.lastPositionMs).toBe(DURATION);
    const overshoot = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(DURATION + 5000, T1),
    );
    expect(overshoot.outcome).toBe("completed");
    expect(overshoot.state.lastPositionMs).toBe(DURATION);
  });

  it("honours the completion tolerance when configured", () => {
    const state = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(120000, T2),
    ).state;
    expect(
      applyWatchedProgress(state, progress(DURATION - 500, T3), {
        completionToleranceMs: 1000,
      }).outcome,
    ).toBe("completed");
    expect(applyWatchedProgress(state, progress(DURATION - 500, T3)).outcome).toBe("advanced");
    expectWebFlixError(() =>
      applyWatchedProgress(state, progress(1000, T3), {
        completionToleranceMs: -1,
      }),
    );
  });

  it("protects watched state from resume pings (resume-after-complete) until an explicit restart", () => {
    const done = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(DURATION, T2),
    ).state;
    const pinged = applyWatchedProgress(done, progress(120000, T3));
    expect(pinged.outcome).toBe("ignored");
    expect(pinged.state.status).toBe("watched");
    expect(pinged.state.completedAt).toBe(T2);
    const again = applyWatchedProgress(done, progress(DURATION, T3));
    expect(again.outcome).toBe("unchanged");
    const restarted = restartWatching(done, T3);
    expect(restarted.outcome).toBe("restarted");
    expect(restarted.state.status).toBe("in-progress");
    expect(restarted.state.lastPositionMs).toBe(0);
    expect(restarted.state.watchedFraction).toBe(0);
    expect(restarted.state.completedAt).toBeUndefined();
    expect(restartWatching(initialWatchedState("cat-001", T0), T3).outcome).toBe("unchanged");
  });

  it("handles unknown durations without dividing into zero", () => {
    const t = applyWatchedProgress(initialWatchedState("cat-001", T0), {
      itemId: "cat-001",
      positionMs: 1000,
      durationMs: 0,
      updatedAt: T1,
    });
    expect(t.outcome).toBe("started");
    expect(t.state.watchedFraction).toBe(0);
    expect(t.state.status).toBe("in-progress");
  });

  it("ignores progress for a different item and rejects malformed progress", () => {
    const state = initialWatchedState("cat-001", T0);
    expect(applyWatchedProgress(state, progress(1000, T1, "cat-002")).outcome).toBe("ignored");
    expectWebFlixError(() =>
      applyWatchedProgress(state, {
        itemId: "cat-001",
        positionMs: -1,
        durationMs: DURATION,
        updatedAt: T1,
      }),
    );
  });

  it("supports explicit markWatched / markUnwatched", () => {
    const inProgress = applyWatchedProgress(
      initialWatchedState("cat-001", T0),
      progress(60000, T1),
    ).state;
    const marked = markWatched(inProgress, T2);
    expect(marked.outcome).toBe("completed");
    expect(marked.state.completedAt).toBe(T2);
    expect(markWatched(marked.state, T3).outcome).toBe("unchanged");
    const reset = markUnwatched(marked.state, T3);
    expect(reset.outcome).toBe("reset");
    expect(reset.state).toEqual({
      itemId: "cat-001",
      status: "unwatched",
      watchedFraction: 0,
      lastPositionMs: 0,
      updatedAt: T3,
    });
    expect(markUnwatched(reset.state, T4).outcome).toBe("unchanged");
  });

  it("enforces watched-state invariants", () => {
    expect(validateWatchedStateInvariants(initialWatchedState("cat-001", T0))).toEqual([]);
    const watched = markWatched(initialWatchedState("cat-001", T0), T1).state;
    expect(validateWatchedStateInvariants(watched)).toEqual([]);
    const broken = {
      itemId: "cat-001",
      status: "watched",
      watchedFraction: 0.5,
      lastPositionMs: 10,
      updatedAt: T0,
    } as unknown as WatchedState;
    expect(validateWatchedStateInvariants(broken).map((v) => v.code)).toEqual([
      "watched-without-completion",
    ]);
    expect(
      validateWatchedStateInvariants({} as unknown as WatchedState).map((v) => v.code),
    ).toEqual(["invalid-shape"]);
  });
});

describe("job retry semantics", () => {
  const baseJobInput = {
    id: "job-1",
    kind: "library.index",
    state: "failed",
    cancellable: true,
    cancelRequested: false,
    retry: { maxAttempts: 3, backoffMs: 500, multiplier: 2, on: ["network", "timeout"] },
    provenance: {
      connectorId: "webflix-connector-local",
      connectorVersion: "0.1.0",
      generatedAt: T0,
    },
    payload: { root: "/home/z/media" },
    attempts: 0,
    createdAt: T0,
    updatedAt: T1,
  };
  const makeJob = (overrides: Record<string, unknown> = {}): JobDescriptor =>
    JobDescriptorSchema.parse({ ...baseJobInput, ...overrides });
  const networkFailure = { mode: "network" as const, message: "socket hang up" };

  it("classifies failure modes", () => {
    expect(isRetryableFailureMode("network")).toBe(true);
    expect(isRetryableFailureMode("rate-limit")).toBe(true);
    expect(isRetryableFailureMode("upstream")).toBe(true);
    expect(isRetryableFailureMode("auth")).toBe(false);
    expect(isRetryableFailureMode("parse")).toBe(false);
  });

  it("retries with exponential backoff inside the budget", () => {
    const first = expectRetry(decideRetry(makeJob({ attempts: 0 }), networkFailure));
    expect(first.nextAttempt).toBe(1);
    expect(first.delayMs).toBe(500);
    expect(first.reason).toContain("attempt 1 of 3");
    const second = expectRetry(decideRetry(makeJob({ attempts: 1 }), networkFailure));
    expect(second.delayMs).toBe(1000);
    const third = expectRetry(decideRetry(makeJob({ attempts: 2 }), networkFailure));
    expect(third.nextAttempt).toBe(3);
    expect(third.delayMs).toBe(2000);
  });

  it("reports exhaustion once the retry budget is spent", () => {
    const decision = decideRetry(makeJob({ attempts: 3 }), networkFailure);
    expect(decision.outcome).toBe("exhausted");
    if (decision.outcome !== "exhausted") throw new Error("expected exhaustion");
    expect(decision.attemptsUsed).toBe(3);
    expect(decision.maxAttempts).toBe(3);
  });

  it("refuses non-retryable failure modes and policy exclusions", () => {
    expect(decideRetry(makeJob(), { mode: "auth" }).outcome).toBe("no-retry");
    expect(
      decideRetry(
        makeJob({ retry: { maxAttempts: 3, backoffMs: 500, multiplier: 2, on: ["network"] } }),
        { mode: "timeout" },
      ).outcome,
    ).toBe("no-retry");
    const override = expectRetry(
      decideRetry(
        makeJob({ retry: { maxAttempts: 3, backoffMs: 500, multiplier: 2, on: ["parse"] } }),
        { mode: "parse" },
      ),
    );
    expect(override.nextAttempt).toBe(1);
  });

  it("never retries cancelled, running, or cancellation-requested jobs", () => {
    expect(decideRetry(makeJob({ state: "cancelled" }), networkFailure).outcome).toBe("no-retry");
    expect(decideRetry(makeJob({ state: "running" }), networkFailure).outcome).toBe("no-retry");
    expect(decideRetry(makeJob({ cancelRequested: true }), networkFailure).outcome).toBe(
      "no-retry",
    );
  });

  it("computes capped backoff", () => {
    const policy: RetryPolicy = {
      maxAttempts: 5,
      backoffMs: 400000,
      multiplier: 2,
      on: [],
    };
    expect(computeBackoffMs({ maxAttempts: 3, backoffMs: 500, multiplier: 2, on: [] }, 0)).toBe(
      500,
    );
    expect(computeBackoffMs({ maxAttempts: 3, backoffMs: 500, multiplier: 2, on: [] }, 2)).toBe(
      2000,
    );
    expect(computeBackoffMs(policy, 1)).toBe(300000);
    expect(computeBackoffMs(policy, 1, { maxBackoffMs: 1000 })).toBe(1000);
  });

  it("requeues on retry and records terminal failures without losing provenance", () => {
    const original = makeJob({ attempts: 0 });
    const decision = expectRetry(decideRetry(original, networkFailure));
    const requeued = applyRetryDecision(original, decision, networkFailure, T2);
    expect(requeued.state).toBe("queued");
    expect(requeued.attempts).toBe(1);
    expect(requeued.lastError).toBe("socket hang up");
    expect(requeued.updatedAt).toBe(T2);
    expect(isProvenancePreserved(original.provenance, requeued.provenance)).toBe(true);

    const spent = makeJob({ attempts: 3 });
    const exhausted = decideRetry(spent, networkFailure);
    const failed = applyRetryDecision(spent, exhausted, networkFailure, T2);
    expect(failed.state).toBe("failed");
    expect(failed.attempts).toBe(3);
    expect(failed.lastError).toBe("socket hang up");
    expect(isProvenancePreserved(original.provenance, failed.provenance)).toBe(true);
  });
});

describe("job cancellation and lifecycle", () => {
  const makeJob = (overrides: Record<string, unknown> = {}): JobDescriptor =>
    JobDescriptorSchema.parse({
      id: "job-1",
      kind: "library.index",
      state: "failed",
      cancellable: true,
      cancelRequested: false,
      retry: { maxAttempts: 3, backoffMs: 500, multiplier: 2, on: ["network"] },
      provenance: {
        connectorId: "webflix-connector-local",
        connectorVersion: "0.1.0",
        generatedAt: T0,
      },
      payload: {},
      attempts: 0,
      createdAt: T0,
      updatedAt: T1,
      ...overrides,
    });

  it("requests cancellation idempotently on live jobs", () => {
    const queued = makeJob({ state: "queued" });
    const requested = requestCancellation(queued, T2);
    expect(requested.outcome).toBe("requested");
    if (requested.outcome !== "requested") throw new Error("expected request");
    expect(requested.job.cancelRequested).toBe(true);
    expect(requested.job.state).toBe("queued");
    expect(requested.job.updatedAt).toBe(T2);
    expect(requestCancellation(requested.job, T3).outcome).toBe("unchanged");
    expect(requestCancellation(makeJob({ state: "succeeded" }), T2).outcome).toBe("unchanged");
    expect(requestCancellation(makeJob({ state: "cancelled" }), T2).outcome).toBe("unchanged");
  });

  it("acknowledges cancellation at checkpoints, respecting cancellable", () => {
    expect(acknowledgeCancellation(makeJob({ state: "running", startedAt: T1 }), T2).outcome).toBe(
      "rejected",
    );
    expect(
      acknowledgeCancellation(
        makeJob({ state: "running", startedAt: T1, cancellable: false, cancelRequested: true }),
        T2,
      ).outcome,
    ).toBe("rejected");
    const cancelled = acknowledgeCancellation(
      makeJob({ state: "running", startedAt: T1, cancelRequested: true }),
      T2,
    );
    expect(cancelled.outcome).toBe("cancelled");
    if (cancelled.outcome !== "cancelled") throw new Error("expected cancellation");
    expect(cancelled.job.state).toBe("cancelled");
    expect(cancelled.job.finishedAt).toBe(T2);
    expect(cancelled.job.cancelRequested).toBe(true);
    expect(
      acknowledgeCancellation(
        makeJob({ state: "queued", cancellable: false, cancelRequested: true }),
        T2,
      ).outcome,
    ).toBe("cancelled");
  });

  it("transitions jobs along the legal lifecycle", () => {
    const started = transitionJob(makeJob({ state: "queued" }), "running", T2);
    expect(started.outcome).toBe("transitioned");
    if (started.outcome !== "transitioned") throw new Error("expected transition");
    expect(started.job.state).toBe("running");
    expect(started.job.startedAt).toBe(T2);
    const finished = transitionJob(started.job, "succeeded", T3);
    if (finished.outcome !== "transitioned") throw new Error("expected transition");
    expect(finished.job.finishedAt).toBe(T3);
    expect(transitionJob(makeJob({ state: "queued" }), "succeeded", T2).outcome).toBe("rejected");
    expect(transitionJob(makeJob({ state: "succeeded" }), "running", T2).outcome).toBe("rejected");
    expect(transitionJob(makeJob({ state: "failed" }), "queued", T2).outcome).toBe("rejected");
  });

  it("preserves provenance across every transformation", () => {
    const j = makeJob({ state: "queued" });
    expect(jobArtifactProvenance(j)).toEqual(j.provenance);
    const moved = transitionJob(j, "running", T2);
    if (moved.outcome !== "transitioned") throw new Error("expected transition");
    expect(isProvenancePreserved(j.provenance, moved.job.provenance)).toBe(true);
    const derived = deriveArtifactProvenance(j, {
      inputsHash: `sha256:${SHA256_TEST}`,
    });
    expect(derived.connectorId).toBe("webflix-connector-local");
    expect(derived.connectorVersion).toBe("0.1.0");
    expect(derived.generatedAt).toBe(T0);
    expect(derived.inputsHash).toBe(`sha256:${SHA256_TEST}`);
    expect(isProvenancePreserved(j.provenance, derived)).toBe(false);
    expect(isTerminalJobState("cancelled")).toBe(true);
    expect(isTerminalJobState("running")).toBe(false);
  });
});

describe("instant helpers", () => {
  it("compares instants including fractional seconds", () => {
    expect(compareInstants(T0, T1)).toBe(-1);
    expect(compareInstants(T1, T0)).toBe(1);
    expect(compareInstants(T0, T0)).toBe(0);
    expect(compareInstants(T0_AND_HALF, T0)).toBe(1);
    expect(compareInstants(T0, T0_AND_HALF)).toBe(-1);
  });

  it("parses instants to epoch milliseconds and rejects garbage", () => {
    expect(parseIsoToEpochMs(T0)).toBe(Date.UTC(2025, 5, 1, 12, 0, 0));
    expect(parseIsoToEpochMs(T0_AND_HALF)).toBe(Date.UTC(2025, 5, 1, 12, 0, 0, 500));
    expect(parseIsoToEpochMs("not-an-instant")).toBeNaN();
    expectWebFlixError(() => compareInstants("not-an-instant", T0));
  });
});
