/**
 * TrackPlaybackProgress — WebFlix-owned playhead persistence.
 *
 * Progress belongs to the desktop app: it is recorded against the local
 * library and never exchanged with a provider. Rules:
 *   - the track must exist in the library;
 *   - positions must be finite; negatives clamp to 0 and positions clamp to
 *     the effective duration;
 *   - durations must be finite and positive to count.
 */
import type { ClockPort, LocalStore } from './ports';
import type { PlaybackProgressRecord, TrackId } from './types';

/** Fraction of the duration from which a track counts as finished. */
export const COMPLETION_THRESHOLD = 0.95;

export type PlaybackRuleCode = 'track-not-in-library' | 'invalid-position';

/** Raised when a progress operation would violate a domain rule. */
export class PlaybackRuleError extends Error {
  readonly code: PlaybackRuleCode;

  constructor(code: PlaybackRuleCode, message: string) {
    super(message);
    this.name = 'PlaybackRuleError';
    this.code = code;
  }
}

export interface TrackPlaybackProgressDeps {
  readonly store: LocalStore;
  readonly clock: ClockPort;
}

export interface SavePlaybackProgressInput {
  readonly trackId: TrackId;
  readonly positionMs: number;
  /** Overrides the library-known duration when provided. */
  readonly durationMs?: number | null;
}

export interface TrackRefInput {
  readonly trackId: TrackId;
}

export class TrackPlaybackProgress {
  constructor(private readonly deps: TrackPlaybackProgressDeps) {}

  /** Record (or overwrite) the playhead for a track. */
  async save(input: SavePlaybackProgressInput): Promise<PlaybackProgressRecord> {
    const track = await this.deps.store.getTrack(input.trackId);
    if (!track) {
      throw new PlaybackRuleError('track-not-in-library', `Track ${input.trackId} is not in the library.`);
    }
    if (!Number.isFinite(input.positionMs)) {
      throw new PlaybackRuleError(
        'invalid-position',
        `Position must be a finite number (got ${String(input.positionMs)}).`,
      );
    }
    if (input.durationMs !== undefined && input.durationMs !== null && !Number.isFinite(input.durationMs)) {
      throw new PlaybackRuleError(
        'invalid-position',
        `Duration must be a finite number (got ${String(input.durationMs)}).`,
      );
    }

    const requested = input.durationMs !== undefined ? input.durationMs : track.durationMs;
    const durationMs = requested !== null && requested > 0 ? requested : null;
    const record: PlaybackProgressRecord = {
      trackId: input.trackId,
      positionMs: this.clampPosition(input.positionMs, durationMs),
      durationMs,
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.putPlaybackProgress(record);
    return record;
  }

  /** Load the stored playhead for a track, if any. */
  async load(input: TrackRefInput): Promise<PlaybackProgressRecord | null> {
    return this.deps.store.getPlaybackProgress(input.trackId);
  }

  /** Forget the playhead (e.g. the track finished or was removed). */
  async clear(input: TrackRefInput): Promise<void> {
    await this.deps.store.clearPlaybackProgress(input.trackId);
  }

  /** A record is finished once it reaches COMPLETION_THRESHOLD of its duration. */
  isFinished(record: PlaybackProgressRecord): boolean {
    if (record.durationMs === null || record.durationMs <= 0) return false;
    return record.positionMs >= COMPLETION_THRESHOLD * record.durationMs;
  }

  private clampPosition(positionMs: number, durationMs: number | null): number {
    const upper = durationMs ?? positionMs;
    return Math.round(Math.max(0, Math.min(positionMs, upper)));
  }
}
