/**
 * THE FEDERATED-SEARCH FIXTURE ADAPTER SET (P7-SEARCH-1) — ALL LABELED
 * TEST DOUBLES, ZERO NETWORK (rg-provable: this module imports NOTHING
 * but contract shapes/types and performs NO I/O of any kind — no fetch,
 * no http/https, no sockets, no child processes; every adapter replays
 * canned data). The set the work order names: a YouTube-like source
 * (two canned pages, real paging cursors), a Reddit-like source (whose
 * first page shares a provider asset with the YouTube-like page — the
 * cross-source merge substrate), one unsupported source (the typed
 * honest state) and one auth-gated source (the typed honest state
 * naming the sign-in path).
 *
 * The P7-SEARCH-1 non-goals are binding here: NO live network, NO real
 * provider calls, NO credentials. When a later order sanctions real
 * transport, THAT adapter lands behind the same SearchSourcePort — the
 * seam is the point, and swapping implementations changes nothing above
 * it. NOTHING in production code constructs these doubles except the
 * composition root's test/fixture wiring.
 *
 * The configurable double (FixtureSearchSource) is the
 * fixture-replay-transparency-source pattern: canned responses keyed by
 * the incoming cursor, an optional mid-run delay window (the timeout +
 * mid-run cancellation tests), optional failure injection (the
 * infrastructure-defect tests), per-source limit truncation, and call
 * recording for assertion.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { SearchOutcome, SearchRequest } from "webflix-contracts";
import type { SearchSourceDescriptor, SearchSourceOptions, SearchSourcePort } from "./ports";
import { createStaticSearchSourceRegistry } from "./federated-search";
import type { SearchSourceRegistry } from "./federated-search";

// ---------------------------------------------------------------------------
// The configurable labeled double
// ---------------------------------------------------------------------------

/** One canned response: the outcome answered for a given incoming cursor (absent = the first page). */
export interface FixtureSearchResponse {
  /** The request cursor this response answers; absent = the no-cursor (first-page) call. */
  readonly cursor?: string;
  /** The canned outcome replayed for the matching call. */
  readonly outcome: SearchOutcome;
}

/** The double's configuration. */
export interface FixtureSearchSourceOptions {
  /** The registry source id this double serves. */
  readonly source: string;
  /** The double's own adapter version (defaults to a fixture marker). */
  readonly version?: string;
  /** The canned responses, in order; the first whose cursor matches the incoming one wins. */
  readonly responses?: readonly FixtureSearchResponse[];
  /** When set, search() waits this many milliseconds BEFORE replaying (the timeout / mid-run cancellation window). */
  readonly delayMs?: number;
  /** When set, search() THROWS this value instead of replaying (failure injection). */
  readonly failWith?: unknown;
}

/** One recorded call — what the double was asked, and whether it was already aborted. */
export interface FixtureSearchCall {
  readonly request: SearchRequest;
  readonly abortedAtBoundary: boolean;
}

/** The labeled configurable test double over the SearchSourcePort. */
export class FixtureSearchSource implements SearchSourcePort {
  readonly descriptor: SearchSourceDescriptor;
  private readonly responses: readonly FixtureSearchResponse[];
  private readonly delayMs: number | undefined;
  private readonly failWith: unknown;
  private readonly calls: FixtureSearchCall[] = [];

  constructor(options: FixtureSearchSourceOptions) {
    this.descriptor = {
      source: options.source,
      version: options.version ?? "fixture-replay",
    };
    this.responses = options.responses ?? [];
    this.delayMs = options.delayMs;
    this.failWith = options.failWith;
  }

  /** The calls received so far (assertion surface; a copy, never the live array). */
  recordedCalls(): readonly FixtureSearchCall[] {
    return [...this.calls];
  }

  async search(request: SearchRequest, options?: SearchSourceOptions): Promise<SearchOutcome> {
    // Boundary cancellation (the port contract, same as every real adapter must).
    const abortedAtBoundary = options?.signal?.aborted === true;
    this.calls.push({ request, abortedAtBoundary });
    if (abortedAtBoundary) {
      throw new WebFlixError({
        code: ErrorCode.Cancelled,
        reason: "the fixture search-source call was cancelled at the adapter boundary",
        retryable: false,
        context: { phase: "source-boundary", fixture: true },
      });
    }
    if (this.failWith !== undefined) throw this.failWith;

    // The optional mid-run window: an abort during the wait is the
    // cooperative mid-run cancellation (the transport adapter's honest
    // behaviour, replayed).
    if (this.delayMs !== undefined && this.delayMs > 0) {
      const signal = options?.signal;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, this.delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(
            new WebFlixError({
              code: ErrorCode.Cancelled,
              reason: "the fixture search-source call was cancelled mid-run",
              retryable: false,
              context: { phase: "source-run", fixture: true },
            }),
          );
        };
        if (signal !== undefined) {
          if (signal.aborted) {
            clearTimeout(timer);
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }

    // Replay the canned response for the incoming cursor (absent cursor =
    // the first page); a cursor the fixture does not know is the honest
    // fixture miss, never a fabricated page.
    const cursor = request.cursors?.[this.descriptor.source];
    const response = this.responses.find((candidate) => candidate.cursor === cursor);
    if (response === undefined) {
      return {
        status: "partial-failure",
        reason:
          `the fixture "${this.descriptor.source}" has no canned response for cursor ` +
          `${cursor === undefined ? "(first page)" : `"${cursor}"`}`,
        items: [],
      };
    }
    return truncateToLimit(response.outcome, request.limits?.[this.descriptor.source]);
  }
}

/** Applies the per-source limit (the max rows the source may return); never pads. */
function truncateToLimit(outcome: SearchOutcome, limit: number | undefined): SearchOutcome {
  if (limit === undefined) return outcome;
  if (outcome.status !== "ok" && outcome.status !== "partial-failure") return outcome;
  return { ...outcome, items: outcome.items.slice(0, limit) };
}

// ---------------------------------------------------------------------------
// The named fixture set — YouTube-like, Reddit-like, unsupported, auth-gated
// ---------------------------------------------------------------------------

/** The YouTube-like fixture's registry id. */
export const FIXTURE_YOUTUBE_LIKE_SOURCE_ID = "fixture-youtube-like";
/** The Reddit-like fixture's registry id. */
export const FIXTURE_REDDIT_LIKE_SOURCE_ID = "fixture-reddit-like";
/** The unsupported fixture's registry id. */
export const FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID = "fixture-unsupported-search";
/** The auth-gated fixture's registry id. */
export const FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID = "fixture-auth-gated-search";

/** The YouTube-like page-2 cursor (the paging handoff between the two canned pages). */
export const FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR = "yt-page-2";

/**
 * The YouTube-like fixture: TWO canned pages of provider-attributed
 * videos (providerId "youtube"). Page 1 carries three rows and hands
 * back the page-2 cursor; page 2 carries two rows and no next cursor
 * (the honest end of results). The first row shares its embed asset
 * with the Reddit-like fixture's first row — the cross-source merge
 * substrate.
 */
export function createYouTubeLikeSearchFixture(): FixtureSearchSource {
  return new FixtureSearchSource({
    source: FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
    responses: [
      {
        outcome: {
          status: "ok",
          items: [
            {
              id: "yt:video-1",
              providerId: "youtube",
              title: "Cosmic Rivers — Episode 1",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-1",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=cosmic-rivers-1",
                },
                {
                  assetId: "yt-thumb-1",
                  kind: "thumbnail",
                  reference: "https://i.ytimg.com/vi/cosmic-rivers-1/hq720.jpg",
                },
              ],
              matchEvidence: {
                confidence: 0.9,
                evidence: ["fixture: provider-reported match for cosmic rivers 1"],
              },
              availability: {
                providerId: "youtube",
                region: "US",
                available: true,
                observedAt: "2026-10-01T00:00:00Z",
              },
              metadata: { year: 2024, externalIds: { imdb: "tt10000001" } },
            },
            {
              id: "yt:video-2",
              providerId: "youtube",
              title: "Cosmic Rivers — Episode 2",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-2",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=cosmic-rivers-2",
                },
              ],
              metadata: { year: 2024 },
            },
            {
              id: "yt:video-3",
              providerId: "youtube",
              title: "Desert Bloom (full cut)",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-3",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=desert-bloom",
                },
              ],
              metadata: {},
            },
          ],
          nextCursor: FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR,
        },
      },
      {
        cursor: FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR,
        outcome: {
          status: "ok",
          items: [
            {
              id: "yt:video-4",
              providerId: "youtube",
              title: "Night Market Walk",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-4",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=night-market-walk",
                },
              ],
              metadata: {},
            },
            {
              id: "yt:video-5",
              providerId: "youtube",
              title: "Signal from the Shore",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-5",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=signal-from-the-shore",
                },
              ],
              metadata: {},
            },
          ],
        },
      },
    ],
  });
}

/**
 * The Reddit-like fixture: ONE canned page whose first row is a
 * discussion post surfacing the SAME provider asset as the YouTube-like
 * fixture's first row (providerId "youtube", assetId "yt-embed-1" — the
 * duplicate provider asset across two sources), plus two Reddit-native
 * podcast rows. The discussion row carries an availability fact observed
 * LATER than the YouTube-like row's — the merged item must keep the
 * later observation.
 */
export function createRedditLikeSearchFixture(): FixtureSearchSource {
  return new FixtureSearchSource({
    source: FIXTURE_REDDIT_LIKE_SOURCE_ID,
    responses: [
      {
        outcome: {
          status: "ok",
          items: [
            {
              id: "rd:post-1",
              providerId: "youtube",
              title: "Discussion: Cosmic Rivers — Episode 1",
              mediaKind: "video",
              assets: [
                {
                  assetId: "yt-embed-1",
                  kind: "embed",
                  reference: "https://www.youtube.com/watch?v=cosmic-rivers-1",
                },
              ],
              availability: {
                providerId: "youtube",
                region: "US",
                available: true,
                observedAt: "2026-10-10T00:00:00Z",
              },
              metadata: { externalIds: { tmdb: "99001" } },
            },
            {
              id: "rd:post-2",
              providerId: "reddit",
              title: "WebFlix Weekly Podcast — ep. 12",
              mediaKind: "podcast",
              assets: [
                {
                  assetId: "reddit-stream-12",
                  kind: "stream",
                  reference: "https://media.reddit-example.com/wfw-12.mp3",
                  mimeType: "audio/mpeg",
                },
              ],
              matchEvidence: {
                confidence: 0.7,
                evidence: ["fixture: provider-reported match for wfw 12"],
              },
              metadata: { year: 2025 },
            },
            {
              id: "rd:post-3",
              providerId: "reddit",
              title: "WebFlix Weekly Podcast — ep. 13",
              mediaKind: "podcast",
              assets: [
                {
                  assetId: "reddit-stream-13",
                  kind: "stream",
                  reference: "https://media.reddit-example.com/wfw-13.mp3",
                  mimeType: "audio/mpeg",
                },
              ],
              metadata: { year: 2025 },
            },
          ],
        },
      },
    ],
  });
}

/**
 * The unsupported fixture: every search answers the typed unsupported
 * state with the honest reason — an honest state, never a dead control
 * and never a hidden empty result.
 */
export function createUnsupportedSearchFixture(): FixtureSearchSource {
  return new FixtureSearchSource({
    source: FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID,
    responses: [
      {
        outcome: {
          status: "unsupported",
          reason:
            "this source does not support search — its own terms expose no search surface " +
            "(the typed honest state, surfaced with the reason, never a dead control)",
        },
      },
    ],
  });
}

/**
 * The auth-gated fixture: every search answers the typed auth-required
 * state naming the sign-in path — DATA, never a thrown auth error.
 */
export function createAuthGatedSearchFixture(): FixtureSearchSource {
  return new FixtureSearchSource({
    source: FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID,
    responses: [
      {
        outcome: {
          status: "auth-required",
          reason:
            "sign in to this source before searching it — connect the account in " +
            "Settings → Accounts (the typed honest state, never a thrown auth error)",
        },
      },
    ],
  });
}

/**
 * A registry over the four named fixtures, in the work order's own order
 * (YouTube-like, Reddit-like, unsupported, auth-gated). A FACTORY, not a
 * shared constant: every call mints FRESH adapters so each test's
 * recorded-calls stay isolated (a shared double would leak call history
 * between tests).
 */
export function createDefaultFixtureSearchRegistry(): SearchSourceRegistry {
  return createStaticSearchSourceRegistry([
    createYouTubeLikeSearchFixture(),
    createRedditLikeSearchFixture(),
    createUnsupportedSearchFixture(),
    createAuthGatedSearchFixture(),
  ]);
}
