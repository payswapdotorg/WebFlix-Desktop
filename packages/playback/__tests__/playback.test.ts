import { describe, expect, it } from 'vitest';

import {
  COMPLETION_THRESHOLD,
  PROGRESS_OWNER,
  createProgress,
  isCompleted,
  isPlayablePlan,
  normalizeTitle,
  progressPercent,
  resolvePlaybackPlan,
  toProviderHistoryWrite,
  updateProgress,
  type Connector,
  type PlaybackPlan,
  type RecoveryAction,
  type ResolveRequest,
  type UnavailableReason,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONTENT_ID = 'wf-0001';
const TITLE = 'The Async Adventure';

const STREAMO_EMBED: Connector = {
  id: 'conn-streamo',
  providerId: 'streamo',
  version: '1.4.2',
  embed: {
    providerId: 'streamo',
    urlTemplate: 'https://play.streamo.test/embed/{mediaId}?autoplay=0',
    allowsEmbedding: true,
  },
};

function request(overrides: Partial<ResolveRequest> = {}): ResolveRequest {
  return {
    contentId: CONTENT_ID,
    title: TITLE,
    listings: [],
    connectors: [],
    localLibrary: [],
    region: 'US',
    online: true,
    ...overrides,
  };
}

/** Compile-time exhaustive switch over the PlaybackPlan union. */
function describePlan(plan: PlaybackPlan): string {
  switch (plan.kind) {
    case 'official-embed':
      return `embed:${plan.embedUrl}`;
    case 'local-file':
      return `file:${plan.filePath}`;
    case 'unavailable':
      return `unavailable:${plan.reason}:${plan.recovery.action}`;
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// official-embed lane
// ---------------------------------------------------------------------------

describe('official-embed lane', () => {
  it('resolves an embed plan from a connector embed spec', () => {
    const plan = resolvePlaybackPlan(
      request({
        listings: [{ providerId: 'streamo', externalId: 'ext-77' }],
        connectors: [STREAMO_EMBED],
      }),
    );

    if (plan.kind !== 'official-embed') {
      expect.unreachable(`expected official-embed, got ${plan.kind}`);
    }
    expect(plan.providerId).toBe('streamo');
    expect(plan.connectorId).toBe('conn-streamo');
    expect(plan.externalId).toBe('ext-77');
    expect(plan.embedUrl).toBe('https://play.streamo.test/embed/ext-77?autoplay=0');
    expect(plan.contentId).toBe(CONTENT_ID);
    expect(plan.title).toBe(TITLE);
    expect(isPlayablePlan(plan)).toBe(true);
  });

  it('URL-encodes the external media id into the embed url', () => {
    const plan = resolvePlaybackPlan(
      request({
        listings: [{ providerId: 'streamo', externalId: 'a b/c?x=1' }],
        connectors: [STREAMO_EMBED],
      }),
    );

    if (plan.kind !== 'official-embed') {
      expect.unreachable(`expected official-embed, got ${plan.kind}`);
    }
    expect(plan.embedUrl).toBe('https://play.streamo.test/embed/a%20b%2Fc%3Fx%3D1?autoplay=0');
  });

  it('skips an unplayable listing and streams from the next supported one', () => {
    const plan = resolvePlaybackPlan(
      request({
        listings: [
          { providerId: 'ghostly', externalId: 'g-1' }, // no connector installed
          { providerId: 'streamo', externalId: 's-1' },
        ],
        connectors: [STREAMO_EMBED],
      }),
    );

    if (plan.kind !== 'official-embed') {
      expect.unreachable(`expected official-embed, got ${plan.kind}`);
    }
    expect(plan.providerId).toBe('streamo');
    expect(plan.externalId).toBe('s-1');
  });

  it('is deterministic for identical requests', () => {
    const req = request({
      listings: [{ providerId: 'streamo', externalId: 's-1' }],
      connectors: [STREAMO_EMBED],
    });
    expect(resolvePlaybackPlan(req)).toEqual(resolvePlaybackPlan(req));
  });
});

// ---------------------------------------------------------------------------
// local-file lane
// ---------------------------------------------------------------------------

describe('local-file lane', () => {
  it('delegates a local library path untouched when streaming is unavailable', () => {
    const filePath = 'C:\\Media\\The Async Adventure.mkv';
    const plan = resolvePlaybackPlan(
      request({
        listings: [{ providerId: 'streamo', externalId: 's-1' }],
        connectors: [], // streaming lane fails → local fallback
        localLibrary: [{ path: filePath, mimeType: 'video/x-matroska', sizeBytes: 1_234_567 }],
      }),
    );

    if (plan.kind !== 'local-file') {
      expect.unreachable(`expected local-file, got ${plan.kind}`);
    }
    expect(plan.filePath).toBe(filePath);
    expect(plan.mimeType).toBe('video/x-matroska');
    expect(plan.sizeBytes).toBe(1_234_567);
    expect(isPlayablePlan(plan)).toBe(true);
  });

  it('matches by normalized title, ignoring case, spaces and punctuation', () => {
    const plan = resolvePlaybackPlan(
      request({
        localLibrary: [{ path: '/media/library/The.Async.Adventure.mkv' }],
      }),
    );

    if (plan.kind !== 'local-file') {
      expect.unreachable(`expected local-file, got ${plan.kind}`);
    }
    expect(plan.filePath).toBe('/media/library/The.Async.Adventure.mkv');
  });

  it('prefers an exact contentId match over a title match earlier in the library', () => {
    const plan = resolvePlaybackPlan(
      request({
        localLibrary: [
          { path: '/media/library/The.Async.Adventure.mkv' }, // title match
          { path: '/media/inbox/taa_final_FINAL.mkv', contentId: CONTENT_ID }, // id match
        ],
      }),
    );

    if (plan.kind !== 'local-file') {
      expect.unreachable(`expected local-file, got ${plan.kind}`);
    }
    expect(plan.filePath).toBe('/media/inbox/taa_final_FINAL.mkv');
  });

  it('stays playable offline through the local-file lane', () => {
    const plan = resolvePlaybackPlan(
      request({
        online: false,
        listings: [{ providerId: 'streamo', externalId: 's-1' }],
        connectors: [STREAMO_EMBED],
        localLibrary: [{ path: '/media/library/The.Async.Adventure.mkv' }],
      }),
    );

    expect(plan.kind).toBe('local-file');
  });
});

// ---------------------------------------------------------------------------
// unavailable lane — resolution matrix
// ---------------------------------------------------------------------------

describe('unavailable lane — resolution matrix', () => {
  interface MatrixCase {
    name: string;
    reason: UnavailableReason;
    recovery: RecoveryAction;
    build: () => ResolveRequest;
  }

  const MATRIX: MatrixCase[] = [
    {
      name: 'provider listed but connector missing',
      reason: 'connector-missing',
      recovery: 'install-connector',
      build: () => request({ listings: [{ providerId: 'streamo', externalId: 's-1' }] }),
    },
    {
      name: 'connector requires sign-in',
      reason: 'connector-unauthorized',
      recovery: 'sign-in',
      build: () =>
        request({
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [{ ...STREAMO_EMBED, requiresSignIn: true }],
        }),
    },
    {
      name: 'listing region-locked for the viewer',
      reason: 'region-unavailable',
      recovery: 'open-in-provider',
      build: () =>
        request({
          region: 'US',
          listings: [{ providerId: 'streamo', externalId: 's-1', regions: ['DE'] }],
          connectors: [STREAMO_EMBED],
        }),
    },
    {
      name: 'connector does not serve the viewer region',
      reason: 'region-unavailable',
      recovery: 'open-in-provider',
      build: () =>
        request({
          region: 'GB',
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [{ ...STREAMO_EMBED, regions: ['US'] }],
        }),
    },
    {
      name: 'DRM-protected listing cannot be embedded',
      reason: 'drm-unsupported',
      recovery: 'open-in-provider',
      build: () =>
        request({
          listings: [{ providerId: 'streamo', externalId: 's-1', drmProtected: true }],
          connectors: [STREAMO_EMBED],
        }),
    },
    {
      name: 'connector has no embed capability',
      reason: 'embed-unsupported',
      recovery: 'open-in-provider',
      build: () =>
        request({
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [{ id: 'conn-streamo', providerId: 'streamo', version: '1.4.2' }],
        }),
    },
    {
      name: 'embed spec points at a different provider',
      reason: 'embed-unsupported',
      recovery: 'open-in-provider',
      build: () =>
        request({
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [
            {
              ...STREAMO_EMBED,
              embed: {
                providerId: 'other-provider',
                urlTemplate: 'https://other.test/e/{mediaId}',
                allowsEmbedding: true,
              },
            },
          ],
        }),
    },
    {
      name: 'offline with no local copy',
      reason: 'offline',
      recovery: 'check-connection',
      build: () =>
        request({
          online: false,
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [STREAMO_EMBED],
        }),
    },
    {
      name: 'no officially supported provider carries the title',
      reason: 'no-official-provider',
      recovery: 'search-local-library',
      build: () => request(),
    },
  ];

  for (const tc of MATRIX) {
    it(`matrix: ${tc.name} → ${tc.reason} / ${tc.recovery}`, () => {
      const plan = resolvePlaybackPlan(tc.build());
      if (plan.kind !== 'unavailable') {
        expect.unreachable(`expected unavailable, got ${plan.kind}`);
      }
      expect(plan.reason).toBe(tc.reason);
      expect(plan.recovery.action).toBe(tc.recovery);
      expect(plan.recovery.message.length).toBeGreaterThan(0);
      expect(plan.contentId).toBe(CONTENT_ID);
      expect(isPlayablePlan(plan)).toBe(false);
    });
  }

  it('reports the first listing failure when no listing is playable', () => {
    const plan = resolvePlaybackPlan(
      request({
        listings: [
          { providerId: 'streamo', externalId: 's-1', drmProtected: true },
          { providerId: 'other', externalId: 'o-1' }, // no connector
        ],
        connectors: [STREAMO_EMBED],
      }),
    );

    if (plan.kind !== 'unavailable') {
      expect.unreachable(`expected unavailable, got ${plan.kind}`);
    }
    expect(plan.reason).toBe('drm-unsupported');
  });

  it('offline outranks sign-in and region failures', () => {
    const plan = resolvePlaybackPlan(
      request({
        online: false,
        region: 'GB',
        listings: [{ providerId: 'streamo', externalId: 's-1', regions: ['US'] }],
        connectors: [{ ...STREAMO_EMBED, requiresSignIn: true }],
      }),
    );

    if (plan.kind !== 'unavailable') {
      expect.unreachable(`expected unavailable, got ${plan.kind}`);
    }
    expect(plan.reason).toBe('offline');
  });
});

// ---------------------------------------------------------------------------
// WebFlix-owned progress
// ---------------------------------------------------------------------------

describe('WebFlix-owned progress', () => {
  it('stamps every progress record as webflix-local owned', () => {
    const progress = createProgress(
      { contentId: CONTENT_ID, planKind: 'local-file', positionMs: 1_500, durationMs: 6_000 },
      '2025-01-01T00:00:00.000Z',
    );

    expect(progress.owner).toBe(PROGRESS_OWNER);
    expect(progress.owner).toBe('webflix-local');
    expect(progress.contentId).toBe(CONTENT_ID);
    expect(progress.planKind).toBe('local-file');
    expect(progress.positionMs).toBe(1_500);
    expect(progress.durationMs).toBe(6_000);
    expect(Number.isNaN(Date.parse(progress.updatedAt))).toBe(false);
  });

  it('defaults and clamps on create', () => {
    const progress = createProgress(
      { contentId: CONTENT_ID, planKind: 'official-embed', positionMs: -10 },
      '2025-01-01T00:00:00.000Z',
    );
    expect(progress.positionMs).toBe(0);
    expect(progress.durationMs).toBeNull();
  });

  it('advances by delta, clamps at zero, and never mutates the previous record', () => {
    const p0 = createProgress({ contentId: CONTENT_ID, planKind: 'official-embed' }, '2025-01-01T00:00:00.000Z');
    const p1 = updateProgress(p0, { deltaMs: 1_500, at: '2025-01-01T00:00:01.000Z' });
    expect(p1.positionMs).toBe(1_500);
    expect(p1.updatedAt).toBe('2025-01-01T00:00:01.000Z');
    expect(p0.positionMs).toBe(0); // immutable history
    expect(p0.updatedAt).toBe('2025-01-01T00:00:00.000Z');

    const p2 = updateProgress(p1, { deltaMs: -99_999, at: '2025-01-01T00:00:02.000Z' });
    expect(p2.positionMs).toBe(0);
  });

  it('lets an absolute position win over a delta and clamps to the duration', () => {
    const p0 = createProgress(
      { contentId: CONTENT_ID, planKind: 'local-file', durationMs: 3_000 },
      '2025-01-01T00:00:00.000Z',
    );
    const p1 = updateProgress(p0, { positionMs: 10, deltaMs: 9_999, at: '2025-01-01T00:00:01.000Z' });
    expect(p1.positionMs).toBe(10);

    const p2 = updateProgress(p1, { deltaMs: 99_999, at: '2025-01-01T00:00:02.000Z' });
    expect(p2.positionMs).toBe(3_000);

    const p3 = updateProgress(p2, { durationMs: null, at: '2025-01-01T00:00:03.000Z' });
    expect(p3.durationMs).toBeNull();
    expect(p3.positionMs).toBe(3_000);
  });

  it('computes percent (null without duration) and completion at the 95% threshold', () => {
    const noDuration = createProgress({ contentId: CONTENT_ID, planKind: 'official-embed' });
    expect(progressPercent(noDuration)).toBeNull();
    expect(isCompleted(noDuration)).toBeFalse();

    const p0 = createProgress({ contentId: CONTENT_ID, planKind: 'local-file', durationMs: 10_000 });
    const third = updateProgress(p0, { positionMs: 1_000 });
    expect(progressPercent(third)).toBe(33.3);

    const half = updateProgress(p0, { positionMs: 5_000 });
    expect(progressPercent(half)).toBe(50);
    expect(isCompleted(half)).toBeFalse();

    const justUnder = updateProgress(p0, { positionMs: 9_400 });
    expect(isCompleted(justUnder)).toBeFalse();

    const atThreshold = updateProgress(p0, { positionMs: 9_500 });
    expect(progressPercent(atThreshold)).toBe(95);
    expect(isCompleted(atThreshold)).toBeTrue();

    const over = updateProgress(p0, { positionMs: 99_999 });
    expect(progressPercent(over)).toBe(100);
    expect(isCompleted(over)).toBeTrue();

    expect(COMPLETION_THRESHOLD).toBe(0.95);
  });

  it('never emits provider history writes from resolution or progress tracking', () => {
    const plans: PlaybackPlan[] = [
      resolvePlaybackPlan(
        request({
          listings: [{ providerId: 'streamo', externalId: 's-1' }],
          connectors: [STREAMO_EMBED],
        }),
      ),
      resolvePlaybackPlan(
        request({ localLibrary: [{ path: '/media/library/The.Async.Adventure.mkv' }] }),
      ),
      resolvePlaybackPlan(request()),
    ];

    expect(plans.map((p) => p.kind)).toEqual(['official-embed', 'local-file', 'unavailable']);

    const progress = updateProgress(
      createProgress({ contentId: CONTENT_ID, planKind: 'official-embed' }),
      { deltaMs: 100 },
    );

    for (const plan of plans) {
      expect(JSON.stringify(plan)).not.toContain('provider-history-write');
      expect('op' in plan).toBe(false);
    }
    expect(JSON.stringify(progress)).not.toContain('provider-history-write');
    expect(progress.owner).toBe('webflix-local');
  });

  it('builds a provider history write only as an explicit op', () => {
    const progress = createProgress(
      { contentId: CONTENT_ID, planKind: 'official-embed', positionMs: 42, durationMs: 100 },
      '2025-01-01T00:00:00.000Z',
    );
    const op = toProviderHistoryWrite(progress, { providerId: 'streamo', externalId: 's-1' });

    expect(op.op).toBe('provider-history-write');
    expect(op.providerId).toBe('streamo');
    expect(op.externalId).toBe('s-1');
    expect(op.progress).toEqual(progress);
    expect(op.progress.owner).toBe('webflix-local');
  });

  it('normalizes titles for local matching', () => {
    expect(normalizeTitle('The  Async-Adventure!')).toBe('theasyncadventure');
    expect(normalizeTitle('THE ASYNC ADVENTURE')).toBe(normalizeTitle('the.async.adventure'));
  });
});

// ---------------------------------------------------------------------------
// Plan union exhaustiveness
// ---------------------------------------------------------------------------

describe('plan kind exhaustiveness', () => {
  it('handles every PlaybackPlan variant (compile-time exhaustive switch)', () => {
    const embed = resolvePlaybackPlan(
      request({
        listings: [{ providerId: 'streamo', externalId: 's-1' }],
        connectors: [STREAMO_EMBED],
      }),
    );
    const local = resolvePlaybackPlan(
      request({ localLibrary: [{ path: '/media/library/The.Async.Adventure.mkv' }] }),
    );
    const unavailable = resolvePlaybackPlan(request());

    expect(describePlan(embed)).toMatch(/^embed:https:\/\//);
    expect(describePlan(local)).toMatch(/^file:\/media\//);
    expect(describePlan(unavailable)).toBe('unavailable:no-official-provider:search-local-library');
  });
});
