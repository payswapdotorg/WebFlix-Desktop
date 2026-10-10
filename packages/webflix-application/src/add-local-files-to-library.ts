/**
 * AddLocalFilesToLibrary — path-safe ingestion of local audio files.
 *
 * Rules (D2-LOCAL):
 *   - The use-case touches PATHS ONLY: it validates and normalises them
 *     (`sanitizePaths`) and delegates every filesystem/media access to the
 *     `IndexingPort` adapter. No media bytes ever flow through this layer.
 *   - Identity is a fingerprint computed from probed METADATA (container,
 *     size, duration, tags) — never from the path or mtime, so moving or
 *     renaming a file must not fork the library identity.
 *   - A fingerprint that already exists in the library is reported as a
 *     duplicate; the existing track wins and the store is left untouched.
 *   - An aborted signal cancels the underlying job; files already probed are
 *     still ingested, the rest is reported as rejected.
 */
import type { ClockPort, IdGenerator, IndexingPort, IndexingProgress, LocalStore } from './ports';
import { cancelOnAbort, waitForIndexingResult } from './indexing-session';
import { sanitizePaths, type RejectedPath } from './path-safety';
import {
  asFingerprint,
  asTrackId,
  type Fingerprint,
  type LibraryTrack,
  type TrackId,
  type TrackProbe,
} from './types';

/** Collapse case and whitespace so cosmetic tag edits do not fork identity. */
function normalizeTagPart(value: string | null): string {
  return value === null ? '' : value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Content-ish identity WITHOUT media bytes: SHA-256 over a canonical metadata
 * vector. Path and mtime are deliberately excluded — moving, renaming or
 * re-stamping a file must not change its identity.
 */
export async function fingerprintTrack(probe: TrackProbe): Promise<Fingerprint> {
  const canonical = [
    'webflix-track-v1',
    probe.container.trim().toLowerCase(),
    String(probe.sizeBytes),
    probe.durationMs === null ? '' : String(probe.durationMs),
    normalizeTagPart(probe.title),
    normalizeTagPart(probe.artist),
    normalizeTagPart(probe.album),
    probe.trackNo === null ? '' : String(probe.trackNo),
  ].join('\u001f');

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return asFingerprint(hex);
}

export interface AddLocalFilesInput {
  /** Raw user-supplied paths (absolute); validated by `sanitizePaths`. */
  readonly paths: readonly string[];
  /** Abort to cancel the underlying indexing job; probed files still ingest. */
  readonly signal?: AbortSignal;
  /** Observability sink for indexing progress; sink errors are swallowed. */
  readonly onProgress?: (progress: IndexingProgress) => void;
}

export interface DuplicateHit {
  readonly path: string;
  readonly existingTrackId: TrackId;
}

export interface AddLocalFilesOutput {
  readonly added: readonly LibraryTrack[];
  readonly duplicates: readonly DuplicateHit[];
  /** Locally rejected paths, per-path indexing failures and cancel remainders. */
  readonly rejected: readonly RejectedPath[];
}

export interface AddLocalFilesToLibraryDeps {
  readonly store: LocalStore;
  readonly indexing: IndexingPort;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

export class AddLocalFilesToLibrary {
  constructor(private readonly deps: AddLocalFilesToLibraryDeps) {}

  async execute(input: AddLocalFilesInput): Promise<AddLocalFilesOutput> {
    const { valid, rejected } = sanitizePaths(input.paths);
    const added: LibraryTrack[] = [];
    const duplicates: DuplicateHit[] = [];

    if (valid.length === 0) {
      return { added, duplicates, rejected };
    }
    if (input.signal?.aborted) {
      const cancelled: RejectedPath[] = valid.map((path) => ({ path, reason: 'cancelled before start' }));
      return { added, duplicates, rejected: [...rejected, ...cancelled] };
    }

    const handle = await this.deps.indexing.start(valid);
    cancelOnAbort(this.deps.indexing, handle.jobId, input.signal);
    const result = await waitForIndexingResult(this.deps.indexing, handle.jobId, input.onProgress);

    const handled = new Set<string>();
    for (const trackProbe of result.probes) {
      handled.add(trackProbe.path);
      await this.ingestProbe(trackProbe, added, duplicates);
    }
    for (const failure of result.failures) {
      handled.add(failure.path);
      rejected.push({ path: failure.path, reason: failure.reason });
    }
    if (result.status === 'cancelled' || result.status === 'failed') {
      for (const path of valid) {
        if (!handled.has(path)) {
          rejected.push({
            path,
            reason: result.status === 'cancelled' ? 'cancelled' : (result.error ?? 'indexer failed'),
          });
        }
      }
    }

    return { added, duplicates, rejected };
  }

  private async ingestProbe(
    trackProbe: TrackProbe,
    added: LibraryTrack[],
    duplicates: DuplicateHit[],
  ): Promise<void> {
    const fingerprint = await fingerprintTrack(trackProbe);
    const existing = await this.deps.store.findTrackByFingerprint(fingerprint);
    if (existing) {
      duplicates.push({ path: trackProbe.path, existingTrackId: existing.id });
      return;
    }
    const track: LibraryTrack = {
      id: asTrackId(this.deps.generateId()),
      fingerprint,
      path: trackProbe.path,
      sizeBytes: trackProbe.sizeBytes,
      mtimeMs: trackProbe.mtimeMs,
      container: trackProbe.container,
      durationMs: trackProbe.durationMs,
      title: trackProbe.title,
      artist: trackProbe.artist,
      album: trackProbe.album,
      trackNo: trackProbe.trackNo,
      addedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.putTrack(track);
    added.push(track);
  }
}
