/**
 * Use-case tests for @webflix/application (D2-LOCAL).
 *
 * FIXTURE-ONLY / HERMETIC: every port below is backed by an in-memory fake
 * defined in this file — no filesystem, no network, no database, no wall
 * clock. The fixtures mirror no real data; they exist purely to drive the
 * use-cases deterministically.
 */
import { describe, expect, it } from 'vitest';
import type {
  ClockPort,
  CredentialPort,
  IdGenerator,
  IndexingFailure,
  IndexingJobHandle,
  IndexingPort,
  IndexingProgress,
  IndexingStatus,
  LocalStore,
  ProviderMetadataOutcome,
  ProviderMetadataPort,
} from '../ports';
import type {
  CollectionId,
  CollectionRecord,
  Fingerprint,
  LibraryTrack,
  PlaybackProgressRecord,
  ProviderFieldSetRecord,
  ProviderId,
  TrackId,
  TrackProbe,
} from '../types';
import { asCollectionId, asFingerprint, asProviderId, asTrackId } from '../types';
import { AddLocalFilesToLibrary, fingerprintTrack } from '../add-local-files-to-library';
import { COLLECTION_MAX_TRACKS, COLLECTION_NAME_MAX_LENGTH, ManageCollections } from '../manage-collections';
import { TrackPlaybackProgress } from '../track-playback-progress';
import {
  isProviderFieldSetStale,
  PROVIDER_METADATA_TTL_DAYS,
  PROVIDER_METADATA_TTL_MS,
  RefreshProviderMetadata,
} from '../refresh-provider-metadata';
import { DEFAULT_MAX_ATTEMPTS, RunIndexingJob } from '../run-indexing-job';

// ---------------------------------------------------------------------------
// In-memory port fakes (fixture-only)
// ---------------------------------------------------------------------------

class FakeClock implements ClockPort {
  private instant: Date;

  constructor(iso = '2025-01-01T00:00:00.000Z') {
    this.instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.instant);
  }

  advanceMs(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

function sequenceIds(prefix = 'id'): IdGenerator {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

class FakeLocalStore implements LocalStore {
  private readonly tracks = new Map<string, LibraryTrack>();
  private readonly collections = new Map<string, CollectionRecord>();
  private readonly progress = new Map<string, PlaybackProgressRecord>();
  private readonly fieldSets = new Map<string, ProviderFieldSetRecord>();

  async listTracks(): Promise<readonly LibraryTrack[]> {
    return [...this.tracks.values()];
  }

  async getTrack(id: TrackId): Promise<LibraryTrack | null> {
    return this.tracks.get(id) ?? null;
  }

  async findTrackByFingerprint(fingerprint: Fingerprint): Promise<LibraryTrack | null> {
    for (const track of this.tracks.values()) {
      if (track.fingerprint === fingerprint) return track;
    }
    return null;
  }

  async putTrack(track: LibraryTrack): Promise<void> {
    this.tracks.set(track.id, track);
  }

  async removeTrack(id: TrackId): Promise<void> {
    this.tracks.delete(id);
  }

  async listCollections(): Promise<readonly CollectionRecord[]> {
    return [...this.collections.values()];
  }

  async getCollection(id: CollectionId): Promise<CollectionRecord | null> {
    return this.collections.get(id) ?? null;
  }

  async putCollection(collection: CollectionRecord): Promise<void> {
    this.collections.set(collection.id, collection);
  }

  async deleteCollection(id: CollectionId): Promise<void> {
    this.collections.delete(id);
  }

  async getPlaybackProgress(trackId: TrackId): Promise<PlaybackProgressRecord | null> {
    return this.progress.get(trackId) ?? null;
  }

  async listPlaybackProgress(): Promise<readonly PlaybackProgressRecord[]> {
    return [...this.progress.values()];
  }

  async putPlaybackProgress(record: PlaybackProgressRecord): Promise<void> {
    this.progress.set(record.trackId, record);
  }

  async clearPlaybackProgress(trackId: TrackId): Promise<void> {
    this.progress.delete(trackId);
  }

  private fieldSetKey(trackId: TrackId, provider: ProviderId): string {
    return `${trackId}::${provider}`;
  }

  async getProviderFieldSet(trackId: TrackId, provider: ProviderId): Promise<ProviderFieldSetRecord | null> {
    return this.fieldSets.get(this.fieldSetKey(trackId, provider)) ?? null;
  }

  async listProviderFieldSets(provider?: ProviderId): Promise<readonly ProviderFieldSetRecord[]> {
    return [...this.fieldSets.values()].filter(
      (record) => provider === undefined || record.provider === provider,
    );
  }

  async putProviderFieldSet(record: ProviderFieldSetRecord): Promise<void> {
    this.fieldSets.set(this.fieldSetKey(record.trackId, record.provider), record);
  }

  async deleteProviderFieldSet(trackId: TrackId, provider: ProviderId): Promise<void> {
    this.fieldSets.delete(this.fieldSetKey(trackId, provider));
  }
}

type ScriptedOutcome = { kind: 'probe'; probe: TrackProbe } | { kind: 'failure'; reason: string };

interface JobState {
  readonly jobId: string;
  readonly paths: readonly string[];
  readonly script: Readonly<Record<string, ScriptedOutcome>> | null;
  readonly hardError: string | null;
  cancelRequested: boolean;
  settled: boolean;
}

function syntheticProbe(path: string): TrackProbe {
  const file = path.split('/').pop() ?? path;
  return {
    path,
    sizeBytes: 1024,
    mtimeMs: 0,
    container: 'mp3',
    durationMs: 180_000,
    title: file,
    artist: null,
    album: null,
    trackNo: null,
  };
}

/**
 * One macrotask tick. Yields a macrotask (not a microtask) so ALL pending
 * microtask continuations drain first: use-case result processing, follow-up
 * job starts (retries) and — crucially — `onProgress` subscriptions that the
 * use-case attaches in the continuation after `await indexing.start(...)`.
 */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** In-memory IndexingPort: jobs only advance when `settle()` is called. */
class FakeIndexing implements IndexingPort {
  readonly startCalls: Array<readonly string[]> = [];
  readonly cancelCalls: string[] = [];

  private readonly scripts: Array<Readonly<Record<string, ScriptedOutcome>> | null> = [];
  private readonly hardErrors: string[] = [];
  private readonly jobs = new Map<string, JobState>();
  private readonly listeners = new Map<string, Set<(progress: IndexingProgress) => void>>();
  private nextJobId = 0;

  /** Queue per-path outcomes for the next `start()`; unlisted paths succeed. */
  queueScript(script: Readonly<Record<string, ScriptedOutcome>> | null): void {
    this.scripts.push(script);
  }

  /** Make the next `start()` fail as a whole. */
  queueHardFailure(error: string): void {
    this.hardErrors.push(error);
  }

  async start(paths: readonly string[]): Promise<IndexingJobHandle> {
    const jobId = `job-${(this.nextJobId += 1)}`;
    this.startCalls.push([...paths]);
    this.jobs.set(jobId, {
      jobId,
      paths: [...paths],
      script: this.scripts.shift() ?? null,
      hardError: this.hardErrors.shift() ?? null,
      cancelRequested: false,
      settled: false,
    });
    return { jobId };
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.cancelCalls.push(jobId);
    job.cancelRequested = true;
    return true;
  }

  onProgress(jobId: string, listener: (progress: IndexingProgress) => void): () => void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  /**
   * Drive all started (unsettled) jobs to their terminal events.
   *
   * Each round first yields a MACROTASK so pending microtask continuations —
   * use-case result handling, retry-job starts and their `onProgress`
   * subscriptions — fully drain before this round decides what still needs
   * settling. Settling a job whose listener has not attached yet would
   * swallow its terminal event and hang the use-case forever (microtask-only
   * yields allowed exactly that); the macrotask yield makes the pump
   * deterministic. Throws if jobs remain unsettled after the round budget so
   * a broken pump fails loudly instead of timing out silently.
   */
  async settle(): Promise<void> {
    const roundBudget = 100;
    for (let round = 0; round < roundBudget; round += 1) {
      await macrotask();
      const unsettled = [...this.jobs.values()].filter((job) => !job.settled);
      if (unsettled.length === 0) return;
      for (const job of unsettled) {
        this.settleJob(job);
      }
    }
    const stuck = [...this.jobs.values()]
      .filter((job) => !job.settled)
      .map((job) => job.jobId);
    throw new Error(
      `FakeIndexing.settle: jobs did not settle within ${roundBudget} rounds: ${stuck.join(', ')}`,
    );
  }

  private settleJob(job: JobState): void {
    job.settled = true;
    const probes: TrackProbe[] = [];
    const failures: IndexingFailure[] = [];
    let done = 0;

    if (!job.cancelRequested && job.hardError === null) {
      for (const path of job.paths) {
        done += 1;
        const scripted = job.script?.[path];
        if (scripted === undefined || scripted.kind === 'probe') {
          probes.push(scripted === undefined ? syntheticProbe(path) : scripted.probe);
        } else {
          failures.push({ path, reason: scripted.reason });
        }
        this.emit(job, { jobId: job.jobId, status: 'running', done, total: job.paths.length, result: null });
        if (job.cancelRequested) break; // cancellation halts the job immediately
      }
    }

    const status: IndexingStatus = job.cancelRequested
      ? 'cancelled'
      : job.hardError !== null
        ? 'failed'
        : 'completed';
    this.emit(job, {
      jobId: job.jobId,
      status,
      done,
      total: job.paths.length,
      result: {
        jobId: job.jobId,
        status,
        probes: status === 'failed' ? [] : probes,
        failures: status === 'failed' ? [] : failures,
        error: status === 'failed' ? job.hardError : null,
      },
    });
  }

  private emit(job: JobState, progress: IndexingProgress): void {
    const set = this.listeners.get(job.jobId);
    if (!set) return;
    for (const listener of [...set]) {
      listener(progress);
    }
  }
}

class FakeProviderMetadata implements ProviderMetadataPort {
  readonly calls: Array<{ trackId: TrackId; provider: ProviderId }> = [];

  private readonly responses = new Map<string, ProviderMetadataOutcome>();

  respond(trackId: TrackId, provider: ProviderId, outcome: ProviderMetadataOutcome): void {
    this.responses.set(`${trackId}::${provider}`, outcome);
  }

  async fetch(trackId: TrackId, provider: ProviderId): Promise<ProviderMetadataOutcome> {
    this.calls.push({ trackId, provider });
    return (
      this.responses.get(`${trackId}::${provider}`) ?? { kind: 'error', trackId, reason: 'no scripted response' }
    );
  }
}

/** Implements the contract-frozen CredentialPort shape in memory. */
class FakeCredentials implements CredentialPort {
  private readonly tokens = new Map<string, string>();

  setToken(provider: string, token: string | null): void {
    if (token === null) this.tokens.delete(provider);
    else this.tokens.set(provider, token);
  }

  async get(provider: string): Promise<string | null> {
    return this.tokens.get(provider) ?? null;
  }

  async set(provider: string, token: string): Promise<void> {
    this.tokens.set(provider, token);
  }

  async delete(provider: string): Promise<void> {
    this.tokens.delete(provider);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  readonly store: FakeLocalStore;
  readonly indexing: FakeIndexing;
  readonly clock: FakeClock;
  readonly ids: IdGenerator;
  readonly credentials: FakeCredentials;
  readonly providers: FakeProviderMetadata;
}

function makeHarness(): Harness {
  return {
    store: new FakeLocalStore(),
    indexing: new FakeIndexing(),
    clock: new FakeClock(),
    ids: sequenceIds('id'),
    credentials: new FakeCredentials(),
    providers: new FakeProviderMetadata(),
  };
}

function probe(overrides: Partial<TrackProbe> & { path: string }): TrackProbe {
  return {
    sizeBytes: 1000,
    mtimeMs: 1_700_000_000_000,
    container: 'mp3',
    durationMs: 200_000,
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    trackNo: 1,
    ...overrides,
  };
}

function makeTrack(id: string, overrides: Partial<LibraryTrack> = {}): LibraryTrack {
  return {
    id: asTrackId(id),
    fingerprint: asFingerprint(`fp-${id}`),
    path: `/music/${id}.mp3`,
    sizeBytes: 1000,
    mtimeMs: 0,
    container: 'mp3',
    durationMs: 200_000,
    title: id,
    artist: null,
    album: null,
    trackNo: null,
    addedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAddFiles(h: Harness): AddLocalFilesToLibrary {
  return new AddLocalFilesToLibrary({
    store: h.store,
    indexing: h.indexing,
    clock: h.clock,
    generateId: h.ids,
  });
}

function makeCollections(h: Harness): ManageCollections {
  return new ManageCollections({ store: h.store, clock: h.clock, generateId: h.ids });
}

function makePlayback(h: Harness): TrackPlaybackProgress {
  return new TrackPlaybackProgress({ store: h.store, clock: h.clock });
}

function makeRefresh(h: Harness): RefreshProviderMetadata {
  return new RefreshProviderMetadata({
    store: h.store,
    clock: h.clock,
    providers: h.providers,
    credentials: h.credentials,
  });
}

function makeJob(h: Harness): RunIndexingJob {
  return new RunIndexingJob({ indexing: h.indexing });
}

// ---------------------------------------------------------------------------
// AddLocalFilesToLibrary
// ---------------------------------------------------------------------------

describe('AddLocalFilesToLibrary', () => {
  it('adds probed files to the library, fingerprinting metadata only', async () => {
    const h = makeHarness();
    h.indexing.queueScript({
      '/music/a.flac': { kind: 'probe', probe: probe({ path: '/music/a.flac', container: 'flac', title: 'A' }) },
      '/music/b.mp3': { kind: 'probe', probe: probe({ path: '/music/b.mp3', title: 'B' }) },
    });

    const [output] = await Promise.all([
      makeAddFiles(h).execute({ paths: ['/music/a.flac', '/music/b.mp3'] }),
      h.indexing.settle(),
    ]);

    expect(h.indexing.startCalls).toEqual([['/music/a.flac', '/music/b.mp3']]);
    expect(output.rejected).toEqual([]);
    expect(output.duplicates).toEqual([]);
    expect(output.added).toHaveLength(2);
    const [first] = output.added;
    expect(first).toMatchObject({
      id: 'id-1',
      path: '/music/a.flac',
      container: 'flac',
      title: 'A',
      addedAt: '2025-01-01T00:00:00.000Z',
    });
    const stored = await h.store.listTracks();
    expect(stored.map((track) => track.id)).toEqual(['id-1', 'id-2']);
    for (const track of stored) {
      expect(track.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('is path-safe: invalid and duplicate inputs never reach the indexer', async () => {
    const h = makeHarness();

    const [output] = await Promise.all([
      makeAddFiles(h).execute({
        paths: ['', 'music/song.mp3', '/music/\0evil.mp3', '/music/good.mp3', '/music/good.mp3'],
      }),
      h.indexing.settle(),
    ]);

    expect(h.indexing.startCalls).toEqual([['/music/good.mp3']]);
    expect(output.rejected).toEqual([
      { path: '', reason: 'empty path' },
      { path: 'music/song.mp3', reason: 'only absolute paths are accepted' },
      { path: '/music/\0evil.mp3', reason: 'path contains a NUL byte' },
    ]);
    expect(output.added.map((track) => track.path)).toEqual(['/music/good.mp3']);
  });

  it('reports fingerprint duplicates instead of double-inserting', async () => {
    const h = makeHarness();
    // Identical metadata at different paths => identical fingerprint (the path
    // is deliberately not part of the fingerprint).
    h.indexing.queueScript({
      '/x/a.mp3': { kind: 'probe', probe: probe({ path: '/x/a.mp3' }) },
      '/x/b.mp3': { kind: 'probe', probe: probe({ path: '/x/b.mp3' }) },
    });
    const addFiles = makeAddFiles(h);

    const [first] = await Promise.all([
      addFiles.execute({ paths: ['/x/a.mp3', '/x/b.mp3'] }),
      h.indexing.settle(),
    ]);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]?.id).toBe('id-1');
    expect(first.duplicates).toEqual([{ path: '/x/b.mp3', existingTrackId: 'id-1' }]);

    // A later run over a different path with the same tags also dedupes.
    h.indexing.queueScript({ '/x/c.mp3': { kind: 'probe', probe: probe({ path: '/x/c.mp3' }) } });
    const [second] = await Promise.all([addFiles.execute({ paths: ['/x/c.mp3'] }), h.indexing.settle()]);
    expect(second.added).toHaveLength(0);
    expect(second.duplicates).toEqual([{ path: '/x/c.mp3', existingTrackId: 'id-1' }]);
    expect(await h.store.listTracks()).toHaveLength(1);
  });

  it('reports everything as cancelled when aborted before the job starts', async () => {
    const h = makeHarness();
    const controller = new AbortController();
    const execution = makeAddFiles(h).execute({ paths: ['/x/a.mp3', '/x/b.mp3'], signal: controller.signal });
    controller.abort();

    const [output] = await Promise.all([execution, h.indexing.settle()]);

    expect(output.added).toEqual([]);
    expect(output.rejected.map((item) => item.reason)).toEqual(['cancelled', 'cancelled']);
    expect(h.indexing.cancelCalls).toEqual(['job-1']);
    expect(await h.store.listTracks()).toEqual([]);
  });

  it('keeps already-probed files when aborted mid-job', async () => {
    const h = makeHarness();
    const controller = new AbortController();
    h.indexing.queueScript({
      '/x/a.mp3': { kind: 'probe', probe: probe({ path: '/x/a.mp3', title: 'A' }) },
      '/x/b.mp3': { kind: 'probe', probe: probe({ path: '/x/b.mp3', title: 'B' }) },
    });

    const [output] = await Promise.all([
      makeAddFiles(h).execute({
        paths: ['/x/a.mp3', '/x/b.mp3'],
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.done >= 1 && !controller.signal.aborted) controller.abort();
        },
      }),
      h.indexing.settle(),
    ]);

    expect(output.added.map((track) => track.title)).toEqual(['A']);
    expect(output.rejected.map((item) => item.reason)).toEqual(['cancelled']);
    expect(h.indexing.cancelCalls).toEqual(['job-1']);
  });

  it('fingerprints are path-independent but metadata-sensitive', async () => {
    const sameA = await fingerprintTrack(probe({ path: '/a.mp3' }));
    const sameB = await fingerprintTrack(probe({ path: '/somewhere/else/b.mp3' }));
    const different = await fingerprintTrack(probe({ path: '/a.mp3', title: 'Different' }));
    expect(sameA).toBe(sameB);
    expect(sameA).not.toBe(different);
  });
});

// ---------------------------------------------------------------------------
// ManageCollections
// ---------------------------------------------------------------------------

describe('ManageCollections', () => {
  it('creates a collection with a normalised name and clock timestamps', async () => {
    const h = makeHarness();
    const created = await makeCollections(h).createCollection({ name: '  Late   Night  ' });
    expect(created.name).toBe('Late Night');
    expect(created.trackIds).toEqual([]);
    expect(created.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(created.updatedAt).toBe(created.createdAt);
  });

  it('enforces name rules and case-insensitive uniqueness', async () => {
    const h = makeHarness();
    const collections = makeCollections(h);
    await collections.createCollection({ name: 'Focus' });

    await expect(collections.createCollection({ name: '  focus ' })).rejects.toMatchObject({
      code: 'duplicate-name',
    });
    await expect(collections.createCollection({ name: '   ' })).rejects.toMatchObject({ code: 'name-empty' });
    await expect(collections.createCollection({ name: 'x'.repeat(COLLECTION_NAME_MAX_LENGTH + 1) })).rejects.toMatchObject(
      { code: 'name-too-long' },
    );
    await expect(
      collections.createCollection({ name: `  ${'x'.repeat(COLLECTION_NAME_MAX_LENGTH)}  ` }),
    ).resolves.toMatchObject({ name: 'x'.repeat(COLLECTION_NAME_MAX_LENGTH) });
  });

  it('renames with rule checks and fresh updatedAt', async () => {
    const h = makeHarness();
    const collections = makeCollections(h);
    const created = await collections.createCollection({ name: 'Workout' });
    h.clock.advanceMs(1_000);

    const renamed = await collections.renameCollection({ collectionId: created.id, name: '  Gym   Mix ' });
    expect(renamed.name).toBe('Gym Mix');
    expect(renamed.createdAt).toBe(created.createdAt);
    expect(renamed.updatedAt).toBe('2025-01-01T00:00:01.000Z');

    // Renaming to the same name (case-insensitively) is fine...
    await expect(collections.renameCollection({ collectionId: created.id, name: 'Gym Mix' })).resolves.toMatchObject({
      name: 'Gym Mix',
    });
    // ...but clashing with ANOTHER collection is not.
    const other = await collections.createCollection({ name: 'Other' });
    await expect(collections.renameCollection({ collectionId: other.id, name: 'gym mix' })).rejects.toMatchObject({
      code: 'duplicate-name',
    });
  });

  it('adds tracks under the domain rules', async () => {
    const h = makeHarness();
    await h.store.putTrack(makeTrack('t1'));
    const collections = makeCollections(h);
    const collection = await collections.createCollection({ name: 'Mix' });

    const updated = await collections.addTrackToCollection({
      collectionId: collection.id,
      trackId: asTrackId('t1'),
    });
    expect(updated.trackIds).toEqual([asTrackId('t1')]);
    expect(updated.updatedAt).toBe('2025-01-01T00:00:00.000Z');

    await expect(
      collections.addTrackToCollection({ collectionId: collection.id, trackId: asTrackId('t1') }),
    ).rejects.toMatchObject({ code: 'track-already-in-collection' });
    await expect(
      collections.addTrackToCollection({ collectionId: collection.id, trackId: asTrackId('missing') }),
    ).rejects.toMatchObject({ code: 'track-not-in-library' });
    await expect(
      collections.addTrackToCollection({ collectionId: asCollectionId('nope'), trackId: asTrackId('t1') }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('enforces the collection size limit', async () => {
    const h = makeHarness();
    const collections = makeCollections(h);
    const collection = await collections.createCollection({ name: 'Huge' });
    const full: CollectionRecord = {
      ...collection,
      trackIds: Array.from({ length: COLLECTION_MAX_TRACKS }, (_, index) => asTrackId(`t-${index}`)),
    };
    await h.store.putCollection(full);
    await h.store.putTrack(makeTrack('t-new'));

    await expect(
      collections.addTrackToCollection({ collectionId: collection.id, trackId: asTrackId('t-new') }),
    ).rejects.toMatchObject({ code: 'collection-limit-reached' });
  });

  it('removes tracks and deletes collections', async () => {
    const h = makeHarness();
    await h.store.putTrack(makeTrack('t1'));
    const collections = makeCollections(h);
    const collection = await collections.createCollection({ name: 'Mix' });
    await collections.addTrackToCollection({ collectionId: collection.id, trackId: asTrackId('t1') });

    const removed = await collections.removeTrackFromCollection({
      collectionId: collection.id,
      trackId: asTrackId('t1'),
    });
    expect(removed.trackIds).toEqual([]);
    await expect(
      collections.removeTrackFromCollection({ collectionId: collection.id, trackId: asTrackId('t1') }),
    ).rejects.toMatchObject({ code: 'track-not-in-collection' });

    await collections.deleteCollection({ collectionId: collection.id });
    expect(await h.store.getCollection(collection.id)).toBeNull();
    await expect(collections.deleteCollection({ collectionId: collection.id })).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

// ---------------------------------------------------------------------------
// TrackPlaybackProgress
// ---------------------------------------------------------------------------

describe('TrackPlaybackProgress', () => {
  it('requires a library track and clamps positions', async () => {
    const h = makeHarness();
    await h.store.putTrack(makeTrack('t1', { durationMs: 200_000 }));
    const progress = makePlayback(h);

    const saved = await progress.save({ trackId: asTrackId('t1'), positionMs: 999_999 });
    expect(saved.positionMs).toBe(200_000);
    expect(saved.durationMs).toBe(200_000);
    expect(saved.updatedAt).toBe('2025-01-01T00:00:00.000Z');

    h.clock.advanceMs(500);
    const clamped = await progress.save({ trackId: asTrackId('t1'), positionMs: -5, durationMs: 1_000 });
    expect(clamped.positionMs).toBe(0);
    expect(clamped.durationMs).toBe(1_000);
    expect(clamped.updatedAt).toBe('2025-01-01T00:00:00.500Z');

    const unknownDuration = await progress.save({ trackId: asTrackId('t1'), positionMs: 42, durationMs: null });
    expect(unknownDuration.durationMs).toBeNull();
    expect(unknownDuration.positionMs).toBe(42);

    await expect(progress.save({ trackId: asTrackId('ghost'), positionMs: 0 })).rejects.toMatchObject({
      code: 'track-not-in-library',
    });
    await expect(progress.save({ trackId: asTrackId('t1'), positionMs: Number.NaN })).rejects.toMatchObject({
      code: 'invalid-position',
    });
    await expect(
      progress.save({ trackId: asTrackId('t1'), positionMs: Number.POSITIVE_INFINITY }),
    ).rejects.toMatchObject({ code: 'invalid-position' });
    await expect(
      progress.save({ trackId: asTrackId('t1'), positionMs: 0, durationMs: Number.NaN }),
    ).rejects.toMatchObject({ code: 'invalid-position' });
  });

  it('loads, detects completion and clears', async () => {
    const h = makeHarness();
    const progress = makePlayback(h);
    expect(await progress.load({ trackId: asTrackId('t1') })).toBeNull();

    await h.store.putTrack(makeTrack('t1', { durationMs: 200_000 }));
    const below = await progress.save({ trackId: asTrackId('t1'), positionMs: 189_999 });
    expect(progress.isFinished(below)).toBe(false);
    const at = await progress.save({ trackId: asTrackId('t1'), positionMs: 190_000 });
    expect(progress.isFinished(at)).toBe(true);

    await progress.clear({ trackId: asTrackId('t1') });
    expect(await progress.load({ trackId: asTrackId('t1') })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RefreshProviderMetadata
// ---------------------------------------------------------------------------

describe('RefreshProviderMetadata', () => {
  it('freezes the 30-day TTL from contract-freeze §7.8', () => {
    expect(PROVIDER_METADATA_TTL_DAYS).toBe(30);
    expect(PROVIDER_METADATA_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('treats sets as stale exactly at the TTL boundary', () => {
    const record: ProviderFieldSetRecord = {
      trackId: asTrackId('t1'),
      provider: asProviderId('musicbrainz'),
      fields: { mood: 'calm' },
      fetchedAt: '2025-01-01T00:00:00.000Z',
    };
    expect(isProviderFieldSetStale(record, new Date('2025-01-30T23:59:59.999Z'))).toBe(false);
    expect(isProviderFieldSetStale(record, new Date('2025-01-31T00:00:00.000Z'))).toBe(true);
    expect(
      isProviderFieldSetStale({ ...record, fetchedAt: 'not-a-timestamp' }, new Date('2025-01-02T00:00:00.000Z')),
    ).toBe(true);
  });

  it('keeps fresh sets without calling the provider', async () => {
    const h = makeHarness();
    const provider = asProviderId('musicbrainz');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider,
      fields: { mood: 'calm' },
      fetchedAt: '2025-01-01T00:00:00.000Z', // == clock.now(): age 0 < 30 days
    });
    h.credentials.setToken('musicbrainz', 'token-1');

    const output = await makeRefresh(h).execute({ provider });

    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'kept-fresh' }]);
    expect(h.providers.calls).toHaveLength(0);
    const stored = await h.store.getProviderFieldSet(asTrackId('t1'), provider);
    expect(stored?.fields).toEqual({ mood: 'calm' });
  });

  it('refreshes stale sets and stamps fetchedAt (§7.8)', async () => {
    const h = makeHarness();
    const provider = asProviderId('musicbrainz');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider,
      fields: { mood: 'stale' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });
    h.credentials.setToken('musicbrainz', 'token-1');
    h.providers.respond(asTrackId('t1'), provider, {
      kind: 'fetched',
      trackId: asTrackId('t1'),
      fields: { mood: 'fresh', bpm: 120 },
    });

    const output = await makeRefresh(h).execute({ provider });

    expect(output.checked).toBe(1);
    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'refreshed' }]);
    const stored = await h.store.getProviderFieldSet(asTrackId('t1'), provider);
    expect(stored?.fields).toEqual({ mood: 'fresh', bpm: 120 });
    expect(stored?.fetchedAt).toBe('2025-01-01T00:00:00.000Z'); // stamped via ClockPort
    expect(h.providers.calls).toEqual([{ trackId: 't1', provider }]);
  });

  it('deletes sets the provider no longer reports (refresh-or-delete)', async () => {
    const h = makeHarness();
    const provider = asProviderId('musicbrainz');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider,
      fields: { mood: 'stale' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });
    h.credentials.setToken('musicbrainz', 'token-1');
    h.providers.respond(asTrackId('t1'), provider, { kind: 'not-found', trackId: asTrackId('t1') });

    const output = await makeRefresh(h).execute({ provider });

    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'deleted' }]);
    expect(await h.store.getProviderFieldSet(asTrackId('t1'), provider)).toBeNull();
  });

  it('keeps stored data on transient provider errors', async () => {
    const h = makeHarness();
    const provider = asProviderId('musicbrainz');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider,
      fields: { mood: 'stale' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });
    h.credentials.setToken('musicbrainz', 'token-1');
    h.providers.respond(asTrackId('t1'), provider, {
      kind: 'error',
      trackId: asTrackId('t1'),
      reason: 'provider 503',
    });

    const output = await makeRefresh(h).execute({ provider });

    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'kept-transient-error', detail: 'provider 503' }]);
    const stored = await h.store.getProviderFieldSet(asTrackId('t1'), provider);
    expect(stored?.fields).toEqual({ mood: 'stale' });
    expect(stored?.fetchedAt).toBe('2024-11-01T00:00:00.000Z');
  });

  it('skips everything without a credential and calls nothing', async () => {
    const h = makeHarness();
    const provider = asProviderId('musicbrainz');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider,
      fields: { mood: 'x' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });

    const output = await makeRefresh(h).execute({ provider });

    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'skipped-unauthenticated' }]);
    expect(h.providers.calls).toHaveLength(0);
    const stored = await h.store.getProviderFieldSet(asTrackId('t1'), provider);
    expect(stored?.fetchedAt).toBe('2024-11-01T00:00:00.000Z');
  });

  it('defaults to stored sets of the provider; explicit ids may fill gaps', async () => {
    const h = makeHarness();
    const musicbrainz = asProviderId('musicbrainz');
    const discogs = asProviderId('discogs');
    h.credentials.setToken('musicbrainz', 'token-a');
    h.credentials.setToken('discogs', 'token-b');
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t1'),
      provider: musicbrainz,
      fields: { mood: 'stale' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });
    await h.store.putProviderFieldSet({
      trackId: asTrackId('t2'),
      provider: discogs,
      fields: { label: 'x' },
      fetchedAt: '2024-11-01T00:00:00.000Z',
    });
    h.providers.respond(asTrackId('t1'), musicbrainz, {
      kind: 'fetched',
      trackId: asTrackId('t1'),
      fields: { mood: 'fresh' },
    });

    const refresh = makeRefresh(h);
    const output = await refresh.execute({ provider: musicbrainz });
    expect(output.outcomes).toEqual([{ trackId: 't1', action: 'refreshed' }]);
    expect(h.providers.calls.map((call) => call.trackId)).toEqual(['t1']);

    h.providers.respond(asTrackId('t9'), musicbrainz, {
      kind: 'fetched',
      trackId: asTrackId('t9'),
      fields: { year: 1998 },
    });
    const explicit = await refresh.execute({ provider: musicbrainz, trackIds: [asTrackId('t9')] });
    expect(explicit.outcomes).toEqual([{ trackId: 't9', action: 'refreshed' }]);
    expect((await h.store.getProviderFieldSet(asTrackId('t9'), musicbrainz))?.fields).toEqual({ year: 1998 });
  });
});

// ---------------------------------------------------------------------------
// RunIndexingJob
// ---------------------------------------------------------------------------

describe('RunIndexingJob', () => {
  it('retries failed paths and reports per-path attempts', async () => {
    const h = makeHarness();
    h.indexing.queueScript({ '/x/a.mp3': { kind: 'failure', reason: 'boom-1' } });
    h.indexing.queueScript({});

    const [output] = await Promise.all([
      makeJob(h).execute({ paths: ['/x/a.mp3', '/x/b.mp3'] }),
      h.indexing.settle(),
    ]);

    expect(output.cancelled).toBe(false);
    expect(output.attemptsRun).toBe(2);
    expect(h.indexing.startCalls).toEqual([['/x/a.mp3', '/x/b.mp3'], ['/x/a.mp3']]);
    expect(output.succeeded.map((entry) => [entry.path, entry.attempts])).toEqual([
      ['/x/b.mp3', 1],
      ['/x/a.mp3', 2],
    ]);
    expect(output.failed).toEqual([]);
  });

  it('stops after maxAttempts with the last failure reason', async () => {
    const h = makeHarness();
    h.indexing.queueScript({ '/x/a.mp3': { kind: 'failure', reason: 'boom-1' } });
    h.indexing.queueScript({ '/x/a.mp3': { kind: 'failure', reason: 'boom-2' } });
    h.indexing.queueScript({ '/x/a.mp3': { kind: 'failure', reason: 'boom-3' } });

    const [output] = await Promise.all([makeJob(h).execute({ paths: ['/x/a.mp3'] }), h.indexing.settle()]);

    expect(output.attemptsRun).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(output.cancelled).toBe(false);
    expect(output.succeeded).toEqual([]);
    expect(output.failed).toEqual([
      { path: '/x/a.mp3', probe: null, attempts: DEFAULT_MAX_ATTEMPTS, reason: 'boom-3' },
    ]);
  });

  it('retries after a whole-job failure', async () => {
    const h = makeHarness();
    h.indexing.queueHardFailure('indexer wedged');

    const [output] = await Promise.all([makeJob(h).execute({ paths: ['/x/a.mp3'] }), h.indexing.settle()]);

    expect(output.attemptsRun).toBe(2);
    expect(output.status).toBe('completed');
    expect(output.succeeded).toHaveLength(1);
    expect(output.failed).toEqual([]);
    expect(h.indexing.startCalls).toHaveLength(2);
  });

  it('never starts when the signal is already aborted', async () => {
    const h = makeHarness();
    const controller = new AbortController();
    controller.abort();

    const [output] = await Promise.all([
      makeJob(h).execute({ paths: ['/x/a.mp3', '/x/b.mp3'], signal: controller.signal }),
      h.indexing.settle(),
    ]);

    expect(output.cancelled).toBe(true);
    expect(output.status).toBe('cancelled');
    expect(output.attemptsRun).toBe(0);
    expect(h.indexing.startCalls).toEqual([]);
    expect(output.failed.map((entry) => entry.reason)).toEqual(['cancelled', 'cancelled']);
  });

  it('cancels the running job when the signal fires mid-attempt', async () => {
    const h = makeHarness();
    const controller = new AbortController();
    h.indexing.queueScript({
      '/x/a.mp3': { kind: 'probe', probe: probe({ path: '/x/a.mp3', title: 'A' }) },
      '/x/b.mp3': { kind: 'probe', probe: probe({ path: '/x/b.mp3', title: 'B' }) },
    });

    const [output] = await Promise.all([
      makeJob(h).execute({
        paths: ['/x/a.mp3', '/x/b.mp3'],
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.done >= 1 && !controller.signal.aborted) controller.abort();
        },
      }),
      h.indexing.settle(),
    ]);

    expect(output.cancelled).toBe(true);
    expect(output.attemptsRun).toBe(1);
    expect(output.succeeded.map((entry) => entry.path)).toEqual(['/x/a.mp3']);
    expect(output.failed).toEqual([{ path: '/x/b.mp3', probe: null, attempts: 1, reason: 'cancelled' }]);
    expect(h.indexing.cancelCalls).toEqual(['job-1']);
  });
});
