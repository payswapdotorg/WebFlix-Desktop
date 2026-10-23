/**
 * media-producers — the WFX-PROVIDER-SLICE-1 use-case battery: every frozen
 * media-views port producer, hermetic (in-memory engine/history/account
 * fakes — ZERO network, ZERO credentials, no wall clock: the injected
 * ClockPort is pinned to a fixed instant).
 *
 * What this suite pins, block by block (the work order's test list):
 *   - HomeFeedPort: the honest compose (compositionNote law, per-section
 *     honest states, the local continue rail surviving every provider
 *     phase, requires-auth without a key, growing-grid append cursor);
 *   - SearchPagePort: videos + channel rail + nextCursor + budgetNote,
 *     append pages never re-spending the channel search, honest states
 *     landing in the budgetNote (the frozen SearchPageData has no phase
 *     field — the shell phases from the note);
 *   - ChannelPort: by id AND by handle (the forHandle path), honest
 *     availableTabs, the shorts split, placeholder headers on honest
 *     phases, append paging;
 *   - TrendingPort / ShortsPort: chart rows, region echo, the documented
 *     shorts compose note, empty/requires-auth/rate-limited states;
 *   - SubscriptionsPort: requires-auth without an account, the MANDATORY
 *     degradeNote on every connected compose, the newest-first
 *     cross-channel merge, partial-poll degradation;
 *   - HistoryPort: WebFlix-owned grouped continue-watching, empty,
 *     failing store;
 *   - ChannelResolutionPort (THE MRBEAST JOURNEY DATA PATH): id / @handle /
 *     URL parsing, exact-match resolution, ambiguity with capped
 *     candidates, not-found, unavailable phases, and the binding
 *     newest-first uploads re-sort with publishedLabel evidence;
 *   - createYouTubeMediaProducers: the one-factory bundle over one engine
 *     handle (the requires-auth handle honest everywhere, history local).
 *
 * The engine seam is the app-owned YouTubeCatalogSource port; the
 * connectors-side real adapter over the official Data API is pinned
 * structurally in packages/connectors/tests/youtube-media-slice.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { CatalogItem, OperationCapability } from "webflix-contracts";
import {
  HOME_FEED_APPEND_COMPOSITION_NOTE,
  HOME_FEED_COMPOSITION_NOTE,
  LocalHistoryProducer,
  SHORTS_COMPOSE_NOTE,
  SUBSCRIPTIONS_DEGRADE_NOTE,
  YouTubeChannelProducer,
  YouTubeChannelResolutionProducer,
  YouTubeHomeFeedProducer,
  YouTubeSearchPageProducer,
  YouTubeShortsProducer,
  YouTubeSubscriptionsProducer,
  YouTubeTrendingProducer,
  createYouTubeMediaProducers,
} from "../index";
import type {
  ClockPort,
  MediaWatchHistoryEntry,
  MediaWatchHistorySource,
  SubscribedChannelRef,
  SubscriptionsAccountSource,
  YouTubeCatalogSource,
  YouTubeCatalogSourceHandle,
  YouTubeChannelSummary,
  YouTubeSourceOutcome,
  YouTubeSourcePage,
  YouTubeVideoRow,
} from "../index";

const NOW = new Date("2026-10-23T12:00:00Z");
const REQUIRES_AUTH_DETAIL =
  "No official YouTube Data API v3 key is configured — every Data-API-backed surface answers requires-auth until one is.";

function fixedClock(): ClockPort {
  return { now: () => NOW };
}

// ---------------------------------------------------------------------------
// Row / page / channel fixtures (the shapes the engine adapter produces)
// ---------------------------------------------------------------------------

function item(videoId: string, title: string): CatalogItem {
  return {
    id: `youtube:video:${videoId}`,
    providerId: "youtube",
    title,
    mediaKind: "video",
    assets: [
      {
        assetId: `youtube:embed:${videoId}`,
        kind: "embed",
        reference: `https://www.youtube-nocookie.com/embed/${videoId}`,
      },
      {
        assetId: `youtube:thumb:${videoId}:medium`,
        kind: "thumbnail",
        reference: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      },
    ],
    matchEvidence: { confidence: 1, evidence: ["fixture row"] },
    metadata: { externalIds: { youtube: videoId } },
  };
}

function row(
  videoId: string,
  opts: Partial<YouTubeVideoRow> & { title?: string } = {},
): YouTubeVideoRow {
  return {
    item: item(videoId, opts.title ?? `Fixture video ${videoId}`),
    channelId: "UCFIXCH0000000000000002",
    channelTitle: "Fixture Shorts Lab",
    publishedAt: "2026-09-15T18:30:00Z",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    ...(opts.viewCount !== undefined ? { viewCount: opts.viewCount } : {}),
    ...(opts.liveBroadcastContent !== undefined
      ? { liveBroadcastContent: opts.liveBroadcastContent }
      : {}),
    ...(opts.publishedAt !== undefined ? { publishedAt: opts.publishedAt } : {}),
    ...(opts.channelId !== undefined ? { channelId: opts.channelId } : {}),
    ...(opts.channelTitle !== undefined ? { channelTitle: opts.channelTitle } : {}),
  };
}

/** The standard chart page: 2 long-form rows (one live) + 1 short, out-of-order dates. */
const CHART_ROWS: YouTubeVideoRow[] = [
  row("FIXVID00003", {
    title: "Fixture: trending gadget teardown",
    durationMs: 511_000,
    viewCount: 1048576,
    publishedAt: "2025-01-10T09:00:00Z",
  }),
  row("FIXVID00004", {
    title: "Fixture: live rocket launch coverage",
    liveBroadcastContent: "live",
    viewCount: 524288,
    publishedAt: "2025-01-11T12:00:00Z",
  }),
  row("FIXVID10003", {
    title: "Fixture: shorts lab newest upload #shorts",
    durationMs: 45_000,
    viewCount: 1048576,
    publishedAt: "2026-10-20T09:00:00Z",
  }),
];

/** The standard uploads page: deliberately NOT newest-first (the binding client-side re-sort). */
const UPLOADS_ROWS: YouTubeVideoRow[] = [
  row("FIXVID10001", {
    title: "Fixture: shorts lab september warmup",
    durationMs: 58_000,
    viewCount: 1234,
    publishedAt: "2026-09-01T12:00:00Z",
  }),
  row("FIXVID10003", {
    title: "Fixture: shorts lab newest upload #shorts",
    durationMs: 45_000,
    viewCount: 1048576,
    publishedAt: "2026-10-20T09:00:00Z",
  }),
  row("FIXVID10002", {
    title: "Fixture: shorts lab mid september long form",
    durationMs: 570_000,
    viewCount: 56,
    publishedAt: "2026-09-15T18:30:00Z",
  }),
];

const SHORTS_LAB_CHANNEL: YouTubeChannelSummary = {
  channelId: "UCFIXCH0000000000000002",
  title: "Fixture Shorts Lab",
  handle: "@fixtureshortslab",
  description: "Fixture-only abridged description (shorts lab).",
  subscriberCount: 1048576,
  videoCount: 312,
  publishedAt: "2022-08-08T00:00:00Z",
  uploadsPlaylistId: "UUFIXCH0000000000000002",
  thumbnailUrl: "https://yt3.ggpht.com/fixture-shorts-lab-avatar=s88",
  bannerUrl: "https://yt3.googleusercontent.com/fixture-shorts-lab-banner",
};

const BUDGET = {
  state: "ok" as const,
  unitsUsedToday: 101,
  unitsLimitToday: 10_000,
  unitsRemainingToday: 9_899,
  searchCallsRemainingToday: 98,
};

function page(
  rows: readonly YouTubeVideoRow[],
  nextPageToken: string | null = null,
): YouTubeSourcePage {
  return { rows, nextPageToken, budget: BUDGET };
}

const honest = (status: OperationCapability["status"], detail: string): YouTubeSourceOutcome<never> => ({
  kind: "honest-state",
  capability: { status, detail },
});

// ---------------------------------------------------------------------------
// The in-memory engine fake (the app-owned port, no network anywhere)
// ---------------------------------------------------------------------------

interface FakeEngineScript {
  searchVideos?: (input: { q: string; maxResults?: number; pageToken?: string }) => YouTubeSourceOutcome<YouTubeSourcePage>;
  searchChannels?: (input: { q: string; maxResults?: number }) => YouTubeSourceOutcome<{ channels: readonly YouTubeChannelSummary[] }>;
  trending?: (input: { regionCode?: string; videoCategoryId?: string; maxResults?: number; pageToken?: string }) => YouTubeSourceOutcome<YouTubeSourcePage>;
  channelById?: (channelId: string) => YouTubeSourceOutcome<{ channel: YouTubeChannelSummary | null }>;
  channelByHandle?: (handle: string) => YouTubeSourceOutcome<{ channel: YouTubeChannelSummary | null }>;
  channelUploads?: (input: { channelId: string; maxResults?: number; pageToken?: string }) => YouTubeSourceOutcome<YouTubeSourcePage>;
}

class FakeYouTubeSource implements YouTubeCatalogSource {
  readonly calls: string[] = [];
  private readonly script: FakeEngineScript;

  constructor(script: FakeEngineScript = {}) {
    this.script = script;
  }

  async searchVideos(input: { q: string; maxResults?: number; pageToken?: string }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    this.calls.push(`searchVideos:${input.q}:${input.pageToken ?? ""}`);
    return this.script.searchVideos?.(input) ?? { kind: "ok", value: page([CHART_ROWS[0] ?? row("FIXVID00003")], "FIXTURE-NEXT-PAGE-1") };
  }

  async searchChannels(input: { q: string; maxResults?: number }): Promise<YouTubeSourceOutcome<{ channels: readonly YouTubeChannelSummary[] }>> {
    this.calls.push(`searchChannels:${input.q}`);
    return (
      this.script.searchChannels?.(input) ?? {
        kind: "ok",
        value: { channels: [SHORTS_LAB_CHANNEL] },
      }
    );
  }

  async trending(input: { regionCode?: string; videoCategoryId?: string; maxResults?: number; pageToken?: string }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    this.calls.push(`trending:${input.regionCode ?? ""}:${input.videoCategoryId ?? ""}:${input.pageToken ?? ""}`);
    return this.script.trending?.(input) ?? { kind: "ok", value: page(CHART_ROWS, "FIXTURE-CHART-NEXT-PAGE-1") };
  }

  async channelById(channelId: string): Promise<YouTubeSourceOutcome<{ channel: YouTubeChannelSummary | null }>> {
    this.calls.push(`channelById:${channelId}`);
    return this.script.channelById?.(channelId) ?? { kind: "ok", value: { channel: SHORTS_LAB_CHANNEL } };
  }

  async channelByHandle(handle: string): Promise<YouTubeSourceOutcome<{ channel: YouTubeChannelSummary | null }>> {
    this.calls.push(`channelByHandle:${handle}`);
    return this.script.channelByHandle?.(handle) ?? { kind: "ok", value: { channel: SHORTS_LAB_CHANNEL } };
  }

  async channelUploads(input: { channelId: string; maxResults?: number; pageToken?: string }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    this.calls.push(`channelUploads:${input.channelId}:${input.pageToken ?? ""}:${input.maxResults ?? ""}`);
    return this.script.channelUploads?.(input) ?? { kind: "ok", value: page(UPLOADS_ROWS) };
  }

  budget(): YouTubeSourcePage["budget"] {
    return BUDGET;
  }
}

const liveSource = (script?: FakeEngineScript): YouTubeCatalogSourceHandle => ({
  kind: "source",
  source: new FakeYouTubeSource(script),
});

const noKeySource = (): YouTubeCatalogSourceHandle => ({
  kind: "requires-auth",
  detail: REQUIRES_AUTH_DETAIL,
});

/** The engine fake, for call-log assertions. */
const engineOf = (handle: YouTubeCatalogSourceHandle): FakeYouTubeSource => {
  if (handle.kind !== "source") throw new Error("test bug: expected a live handle");
  return handle.source as unknown as FakeYouTubeSource;
};

// ---------------------------------------------------------------------------
// The local-history / account fakes (WebFlix-owned seams)
// ---------------------------------------------------------------------------

function historyEntry(videoId: string, watchedAt: string, positionMs = 754_000): MediaWatchHistoryEntry {
  return {
    itemId: `youtube:video:${videoId}`,
    item: item(videoId, `Fixture half-watched ${videoId}`),
    positionMs,
    durationMs: 1_508_000,
    watchedAt,
  };
}

function fakeHistory(
  entries: readonly MediaWatchHistoryEntry[],
  options: { failWith?: Error } = {},
): MediaWatchHistorySource {
  return {
    listContinueWatching: async (limit?: number) => {
      if (options.failWith) throw options.failWith;
      return limit === undefined ? entries : entries.slice(0, limit);
    },
    listHistory: async (limit?: number) => {
      if (options.failWith) throw options.failWith;
      return limit === undefined ? entries : entries.slice(0, limit);
    },
  };
}

function fakeAccount(
  state: "connected" | "not-connected",
  refs: readonly SubscribedChannelRef[] = [],
  options: { failWith?: Error } = {},
): SubscriptionsAccountSource {
  return {
    connectionState: () => state,
    listSubscribedChannels: async () => {
      if (options.failWith) throw options.failWith;
      return refs;
    },
  };
}

// ---------------------------------------------------------------------------
// HomeFeedPort
// ---------------------------------------------------------------------------

describe("YouTubeHomeFeedProducer (the honest home compose)", () => {
  const entries = [
    historyEntry("FIXVID20001", "2026-10-23T10:00:00Z"),
    historyEntry("FIXVID20002", "2026-10-22T22:00:00Z"),
  ];

  it("ready: compositionNote names the compose; continue rail + shorts shelf + long-form grid in order", async () => {
    const handle = liveSource();
    const producer = new YouTubeHomeFeedProducer({ clock: fixedClock(), source: handle, history: fakeHistory(entries) });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("ready");
    if (view.phase !== "ready") return;
    expect(view.compositionNote).toBe(HOME_FEED_COMPOSITION_NOTE);
    expect(view.nextCursor).toBe("FIXTURE-CHART-NEXT-PAGE-1");
    expect(view.sections.map((section) => section.kind)).toEqual([
      "continue-watching",
      "shorts-shelf",
      "video-grid",
    ]);
    const rail = view.sections[0];
    if (rail?.kind !== "continue-watching") throw new Error("expected the continue rail first");
    expect(rail.items.length).toBe(2);
    expect(rail.items[0]?.resumeAtSec).toBe(754);
    expect(rail.items[0]?.badges).toContain("progress");
    const shelf = view.sections[1];
    if (shelf?.kind !== "shorts-shelf") throw new Error("expected the shorts shelf second");
    // The 45s row classifies short; its card item carries mediaKind "short".
    expect(shelf.shorts.length).toBe(1);
    expect(shelf.shorts[0]?.item.mediaKind).toBe("short");
    const grid = view.sections[2];
    if (grid?.kind !== "video-grid") throw new Error("expected the long-form grid third");
    // The live row is long-form (never a short) and keeps its live badge.
    expect(grid.videos.length).toBe(2);
    expect(grid.videos.some((card) => card.badges.includes("live"))).toBe(true);
    expect(grid.videos.every((card) => card.item.mediaKind === "video")).toBe(true);
  });

  it("no key: requires-auth phase, the LOCAL rail still renders, provider sections carry the phase", async () => {
    const producer = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: noKeySource(),
      history: fakeHistory(entries),
    });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("requires-auth");
    if (view.phase === "ready" || view.phase === "loading") return;
    expect(view.detail).toContain("local continue-watching rail still renders");
    const sectionStates = (view.sections ?? []).filter((section) => section.kind === "section-state");
    expect(sectionStates.length).toBe(1);
    const trendingState = sectionStates[0];
    if (trendingState?.kind !== "section-state") throw new Error("expected a trending section-state");
    expect(trendingState.phase).toBe("requires-auth");
    expect((view.sections ?? []).some((section) => section.kind === "continue-watching")).toBe(true);
  });

  it("quota exhausted: the surface carries the rate-limited phase while the local rail survives", async () => {
    const producer = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => honest("rate-limited", "daily quota is exhausted (fixture)") }),
      history: fakeHistory(entries),
    });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("rate-limited");
    if (view.phase === "ready" || view.phase === "loading") return;
    expect(view.detail).toContain("daily quota is exhausted");
    expect((view.sections ?? []).some((section) => section.kind === "continue-watching")).toBe(true);
    const trendingState = (view.sections ?? []).find((section) => section.kind === "section-state");
    if (trendingState?.kind !== "section-state") throw new Error("expected a trending section-state");
    expect(trendingState.phase).toBe("rate-limited");
  });

  it("network failure: unavailable phase, still with the local rail (maximal honesty)", async () => {
    const producer = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => honest("unavailable", "network failure while calling videos.list") }),
      history: fakeHistory(entries),
    });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("unavailable");
    if (view.phase === "ready" || view.phase === "loading") return;
    expect((view.sections ?? []).some((section) => section.kind === "continue-watching")).toBe(true);
  });

  it("a failing LOCAL history store is a section-level unavailable state, never a crash", async () => {
    const producer = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: liveSource(),
      history: fakeHistory([], { failWith: new Error("history store unavailable (fixture)") }),
    });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("ready");
    if (view.phase !== "ready") return;
    const rail = view.sections.find((section) => section.kind === "section-state");
    if (rail?.kind !== "section-state") throw new Error("expected the rail's honest section-state");
    expect(rail.phase).toBe("unavailable");
    expect(rail.detail).toContain("history store unavailable");
  });

  it("append: the chart's next page with the append compose note; an exhausted chart answers empty", async () => {
    const handle = liveSource();
    const producer = new YouTubeHomeFeedProducer({ clock: fixedClock(), source: handle, history: fakeHistory([]) });
    const view = await producer.getHomeFeedAppend("FIXTURE-CHART-NEXT-PAGE-1");
    expect(view.phase).toBe("ready");
    if (view.phase !== "ready") return;
    expect(view.compositionNote).toBe(HOME_FEED_APPEND_COMPOSITION_NOTE);
    expect(engineOf(handle).calls.some((call) => call.includes("trending:") && call.includes("FIXTURE-CHART-NEXT-PAGE-1"))).toBe(true);

    const emptyChart = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => ({ kind: "ok", value: page([]) }) }),
      history: fakeHistory([]),
    });
    const emptyView = await emptyChart.getHomeFeedAppend("FIXTURE-CHART-NEXT-PAGE-1");
    expect(emptyView.phase).toBe("empty");
  });

  it("append without a key answers requires-auth", async () => {
    const producer = new YouTubeHomeFeedProducer({ clock: fixedClock(), source: noKeySource(), history: fakeHistory([]) });
    const view = await producer.getHomeFeedAppend("FIXTURE-CHART-NEXT-PAGE-1");
    expect(view.phase).toBe("requires-auth");
  });

  it("an empty chart AND empty history answer the empty phase (nothing fabricated)", async () => {
    const producer = new YouTubeHomeFeedProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => ({ kind: "ok", value: page([]) }) }),
      history: fakeHistory([]),
    });
    const view = await producer.getHomeFeed({});
    expect(view.phase).toBe("empty");
  });

  it("a caller category rides through to the chart as the official videoCategoryId", async () => {
    const handle = liveSource();
    const producer = new YouTubeHomeFeedProducer({ clock: fixedClock(), source: handle, history: fakeHistory([]) });
    const view = await producer.getHomeFeed({ category: "28" });
    expect(view.phase).toBe("ready");
    expect(engineOf(handle).calls.some((call) => call.startsWith("trending:") && call.includes("28"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SearchPagePort
// ---------------------------------------------------------------------------

describe("YouTubeSearchPageProducer (search + channel rail + budget note)", () => {
  it("first page: videos + channel rail + nextCursor + the post-call budget note", async () => {
    const handle = liveSource({
      searchVideos: () => ({ kind: "ok", value: page([CHART_ROWS[0] ?? row("FIXVID00003")], "FIXTURE-NEXT-PAGE-1") }),
    });
    const producer = new YouTubeSearchPageProducer({ clock: fixedClock(), source: handle });
    const data = await producer.searchPage("cats");
    expect(data.query).toBe("cats");
    expect(data.videos.length).toBe(1);
    expect(data.videos[0]?.viewsLabel).toBe("1M views");
    expect(data.channels.length).toBe(1);
    expect(data.channels[0]?.title).toBe("Fixture Shorts Lab");
    expect(data.nextCursor).toBe("FIXTURE-NEXT-PAGE-1");
    expect(data.budgetNote).toContain("9,899 of 10,000 units remain today");
    expect(data.budgetNote).toContain("~98 searches");
  });

  it("append pages never re-spend the channel search (first-page fact only)", async () => {
    const handle = liveSource();
    const producer = new YouTubeSearchPageProducer({ clock: fixedClock(), source: handle });
    const data = await producer.searchPage("cats", { cursor: "FIXTURE-NEXT-PAGE-1" });
    expect(engineOf(handle).calls.some((call) => call.startsWith("searchChannels:"))).toBe(false);
    expect(data.channels).toEqual([]);
    expect(engineOf(handle).calls.some((call) => call.startsWith("searchVideos:cats:FIXTURE-NEXT-PAGE-1"))).toBe(true);
  });

  it("an empty query spends no quota and says so", async () => {
    const handle = liveSource();
    const producer = new YouTubeSearchPageProducer({ clock: fixedClock(), source: handle });
    const data = await producer.searchPage("   ");
    expect(data.videos).toEqual([]);
    expect(data.budgetNote).toContain("no quota was spent");
    expect(engineOf(handle).calls.length).toBe(0);
  });

  it("no key: the honest state lands in the budgetNote (the shell phases from it)", async () => {
    const producer = new YouTubeSearchPageProducer({ clock: fixedClock(), source: noKeySource() });
    const data = await producer.searchPage("cats");
    expect(data.videos).toEqual([]);
    expect(data.channels).toEqual([]);
    expect(data.nextCursor).toBeNull();
    expect(data.budgetNote).toContain("requires-auth");
    expect(data.budgetNote).toContain(REQUIRES_AUTH_DETAIL);
  });

  it("quota exhausted: the rate-limited state lands in the budgetNote", async () => {
    const producer = new YouTubeSearchPageProducer({
      clock: fixedClock(),
      source: liveSource({ searchVideos: () => honest("rate-limited", "daily quota is exhausted (fixture)") }),
    });
    const data = await producer.searchPage("cats");
    expect(data.videos).toEqual([]);
    expect(data.budgetNote).toContain("rate-limited");
    expect(data.budgetNote).toContain("daily quota is exhausted");
  });

  it("network failure: the unavailable state lands in the budgetNote", async () => {
    const producer = new YouTubeSearchPageProducer({
      clock: fixedClock(),
      source: liveSource({ searchVideos: () => honest("unavailable", "network failure while calling search.list") }),
    });
    const data = await producer.searchPage("cats");
    expect(data.budgetNote).toContain("unavailable");
    expect(data.budgetNote).toContain("network failure");
  });

  it("a failing channel rail never fails the video results — the note reports it", async () => {
    const producer = new YouTubeSearchPageProducer({
      clock: fixedClock(),
      source: liveSource({
        searchVideos: () => ({ kind: "ok", value: page([CHART_ROWS[0] ?? row("FIXVID00003")]) }),
        searchChannels: () => honest("rate-limited", "quota spent mid-page (fixture)"),
      }),
    });
    const data = await producer.searchPage("cats");
    expect(data.videos.length).toBe(1);
    expect(data.channels).toEqual([]);
    expect(data.budgetNote).toContain("channel rail is unavailable");
    expect(data.budgetNote).toContain("rate-limited");
  });
});

// ---------------------------------------------------------------------------
// ChannelPort
// ---------------------------------------------------------------------------

describe("YouTubeChannelProducer (channel surface by id AND handle)", () => {
  it("by id: header + honest tabs + the shorts split + the uploads cursor", async () => {
    const handle = liveSource({ channelUploads: () => ({ kind: "ok", value: page(UPLOADS_ROWS, "FIXTURE-UPLOADS-NEXT-1") }) });
    const producer = new YouTubeChannelProducer({ clock: fixedClock(), source: handle });
    const view = await producer.channel({ channelId: "UCFIXCH0000000000000002" });
    expect(view.phase).toBe("ready");
    expect(view.channel.title).toBe("Fixture Shorts Lab");
    expect(view.channel.subscriberLabel).toBe("1M subscribers");
    expect(view.channel.createdAtLabel).toBe("Joined Aug 2022");
    expect(view.availableTabs).toEqual(["videos", "shorts", "about"]);
    expect(view.videos.map((card) => card.item.id)).toEqual(["youtube:video:FIXVID10002"]);
    expect(view.shorts.map((card) => card.item.id)).toEqual(["youtube:video:FIXVID10001", "youtube:video:FIXVID10003"]);
    expect(view.shorts.every((card) => card.item.mediaKind === "short")).toBe(true);
    expect(view.nextCursor).toBe("FIXTURE-UPLOADS-NEXT-1");
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelById:UCFIXCH0000000000000002"))).toBe(true);
  });

  it("by handle: the official forHandle engine path (channelByHandle)", async () => {
    const handle = liveSource();
    const producer = new YouTubeChannelProducer({ clock: fixedClock(), source: handle });
    const view = await producer.channel({ handle: "fixtureshortslab" });
    expect(view.phase).toBe("ready");
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelByHandle:fixtureshortslab"))).toBe(true);
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelById:"))).toBe(false);
  });

  it("no key: requires-auth phase carrying the REQUESTED identity (placeholder header)", async () => {
    const producer = new YouTubeChannelProducer({ clock: fixedClock(), source: noKeySource() });
    const view = await producer.channel({ handle: "fixtureshortslab" });
    expect(view.phase).toBe("requires-auth");
    expect(view.detail).toBe(REQUIRES_AUTH_DETAIL);
    expect(view.channel.title).toBe("fixtureshortslab");
    expect(view.availableTabs).toEqual([]);
  });

  it("the provider's no-such-channel answer is the unavailable phase (never a throw)", async () => {
    const producer = new YouTubeChannelProducer({
      clock: fixedClock(),
      source: liveSource({ channelById: () => ({ kind: "ok", value: { channel: null } }) }),
    });
    const view = await producer.channel({ channelId: "UCFIXCH0000000000000099" });
    expect(view.phase).toBe("unavailable");
    expect(view.detail).toContain("no channel for id \"UCFIXCH0000000000000099\"");
  });

  it("identity resolved but the uploads shelf honest: partial view with the REAL header", async () => {
    const producer = new YouTubeChannelProducer({
      clock: fixedClock(),
      source: liveSource({ channelUploads: () => honest("rate-limited", "quota spent on the uploads shelf (fixture)") }),
    });
    const view = await producer.channel({ channelId: "UCFIXCH0000000000000002" });
    expect(view.phase).toBe("rate-limited");
    expect(view.channel.title).toBe("Fixture Shorts Lab");
    expect(view.videos).toEqual([]);
    // Identity facts (the description) still earn the about tab — only the
    // shorts tab needs loaded shorts rows.
    expect(view.availableTabs).toEqual(["videos", "about"]);
  });

  it("channelAppend pages the uploads shelf; without a key it answers requires-auth", async () => {
    const handle = liveSource();
    const producer = new YouTubeChannelProducer({ clock: fixedClock(), source: handle });
    const view = await producer.channelAppend("UCFIXCH0000000000000002", "FIXTURE-UPLOADS-NEXT-1");
    expect(view.phase).toBe("ready");
    expect(view.videos.length + view.shorts.length).toBe(UPLOADS_ROWS.length);
    expect(engineOf(handle).calls.some((call) => call.includes("FIXTURE-UPLOADS-NEXT-1"))).toBe(true);

    const noKey = new YouTubeChannelProducer({ clock: fixedClock(), source: noKeySource() });
    const noKeyView = await noKey.channelAppend("UCFIXCH0000000000000002", "FIXTURE-UPLOADS-NEXT-1");
    expect(noKeyView.phase).toBe("requires-auth");
  });

  it("neither id nor handle requested: unavailable with the honest reason", async () => {
    const producer = new YouTubeChannelProducer({ clock: fixedClock(), source: liveSource() });
    const view = await producer.channel({});
    expect(view.phase).toBe("unavailable");
    expect(view.detail).toContain("requires a channelId or a handle");
  });

  it("no shorts on the uploads page: the shorts tab is honestly absent", async () => {
    const producer = new YouTubeChannelProducer({
      clock: fixedClock(),
      source: liveSource({
        channelUploads: () => ({ kind: "ok", value: page([UPLOADS_ROWS[2] ?? row("FIXVID10002")]) }),
      }),
    });
    const view = await producer.channel({ channelId: "UCFIXCH0000000000000002" });
    expect(view.phase).toBe("ready");
    expect(view.availableTabs).toEqual(["videos", "about"]);
    expect(view.shorts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TrendingPort
// ---------------------------------------------------------------------------

describe("YouTubeTrendingProducer (the official chart surface)", () => {
  it("ready: chart rows + the served-region echo + the chart cursor", async () => {
    const producer = new YouTubeTrendingProducer({ clock: fixedClock(), source: liveSource() });
    const view = await producer.trending({ region: "US" });
    expect(view.phase).toBe("ready");
    expect(view.region).toBe("US");
    expect(view.videos.length).toBe(3);
    expect(view.nextCursor).toBe("FIXTURE-CHART-NEXT-PAGE-1");
    expect(view.chips).toEqual([]);
  });

  it("region echoes what the composition knows — null when nothing is known", async () => {
    const producer = new YouTubeTrendingProducer({ clock: fixedClock(), source: liveSource() });
    const view = await producer.trending({});
    expect(view.region).toBeNull();
  });

  it("an empty chart answers the empty phase", async () => {
    const producer = new YouTubeTrendingProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => ({ kind: "ok", value: page([]) }) }),
    });
    const view = await producer.trending({ region: "US" });
    expect(view.phase).toBe("empty");
    expect(view.videos).toEqual([]);
  });

  it("no key → requires-auth; quota → rate-limited; network → unavailable (all as data)", async () => {
    const noKey = new YouTubeTrendingProducer({ clock: fixedClock(), source: noKeySource() });
    expect((await noKey.trending({})).phase).toBe("requires-auth");

    const quota = new YouTubeTrendingProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => honest("rate-limited", "daily quota is exhausted (fixture)") }),
    });
    const quotaView = await quota.trending({});
    expect(quotaView.phase).toBe("rate-limited");
    expect(quotaView.detail).toContain("daily quota is exhausted");

    const network = new YouTubeTrendingProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => honest("unavailable", "network failure (fixture)") }),
    });
    expect((await network.trending({})).phase).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// ShortsPort
// ---------------------------------------------------------------------------

describe("YouTubeShortsProducer (the documented honest shorts compose)", () => {
  it("ready: only shorts-classified rows, the compose note riding the detail slot", async () => {
    const producer = new YouTubeShortsProducer({ clock: fixedClock(), source: liveSource() });
    const view = await producer.shorts();
    expect(view.phase).toBe("ready");
    expect(view.shorts.length).toBe(1);
    expect(view.shorts[0]?.item.mediaKind).toBe("short");
    expect(view.detail).toBe(SHORTS_COMPOSE_NOTE);
    expect(view.nextCursor).toBe("FIXTURE-CHART-NEXT-PAGE-1");
  });

  it("a chart page with no classified shorts answers empty — with the compose note", async () => {
    const producer = new YouTubeShortsProducer({
      clock: fixedClock(),
      source: liveSource({
        trending: () => ({ kind: "ok", value: page([CHART_ROWS[0] ?? row("FIXVID00003")]) }),
      }),
    });
    const view = await producer.shorts();
    expect(view.phase).toBe("empty");
    expect(view.detail).toContain(SHORTS_COMPOSE_NOTE);
    expect(view.shorts).toEqual([]);
  });

  it("no key → requires-auth; quota → rate-limited", async () => {
    const noKey = new YouTubeShortsProducer({ clock: fixedClock(), source: noKeySource() });
    expect((await noKey.shorts()).phase).toBe("requires-auth");

    const quota = new YouTubeShortsProducer({
      clock: fixedClock(),
      source: liveSource({ trending: () => honest("rate-limited", "quota spent (fixture)") }),
    });
    expect((await quota.shorts()).phase).toBe("rate-limited");
  });
});

// ---------------------------------------------------------------------------
// SubscriptionsPort
// ---------------------------------------------------------------------------

describe("YouTubeSubscriptionsProducer (the per-channel-uploads compose + the degradeNote law)", () => {
  const refs: SubscribedChannelRef[] = [
    { channelId: "UCFIXCH0000000000000001", title: "Fixture Channel", handle: "@fixturechannel" },
    { channelId: "UCFIXCH0000000000000002", title: "Fixture Shorts Lab", handle: "@fixtureshortslab" },
  ];

  it("without a connected account: requires-auth naming the connect path (never a fabricated feed)", async () => {
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: liveSource(),
      account: fakeAccount("not-connected"),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("requires-auth");
    expect(view.channels).toEqual([]);
    expect(view.videos).toEqual([]);
    expect(view.detail).toContain("Connect your YouTube account");
  });

  it("connected but no API key: requires-auth — the polling needs the key", async () => {
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: noKeySource(),
      account: fakeAccount("connected", refs),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("requires-auth");
    expect(view.detail).toContain("per-channel upload polling needs the official Data API key");
  });

  it("connected happy compose: MANDATORY degradeNote + the newest-first cross-channel merge", async () => {
    // Channel 1's uploads are all older; channel 2's newest (2026-10-20) must lead.
    const olderRows = [
      row("FIXVID30001", { publishedAt: "2026-08-01T00:00:00Z", channelId: "UCFIXCH0000000000000001", channelTitle: "Fixture Channel" }),
      row("FIXVID30002", { publishedAt: "2026-08-15T00:00:00Z", channelId: "UCFIXCH0000000000000001", channelTitle: "Fixture Channel" }),
    ];
    const handle = liveSource({
      channelUploads: (input) =>
        input.channelId === "UCFIXCH0000000000000001"
          ? { kind: "ok", value: page(olderRows) }
          : { kind: "ok", value: page(UPLOADS_ROWS) },
    });
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: handle,
      account: fakeAccount("connected", refs),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("ready");
    expect(view.degradeNote).toBe(SUBSCRIPTIONS_DEGRADE_NOTE);
    expect(view.channels.length).toBe(2);
    expect(view.videos.length).toBe(5);
    expect(view.videos[0]?.item.id).toBe("youtube:video:FIXVID10003");
    // The binding newest-first cross-channel merge (client-side re-sort):
    expect(view.videos.map((card) => card.item.id)).toEqual([
      "youtube:video:FIXVID10003", // 2026-10-20 (shorts lab)
      "youtube:video:FIXVID10002", // 2026-09-15 (shorts lab)
      "youtube:video:FIXVID10001", // 2026-09-01 (shorts lab)
      "youtube:video:FIXVID30002", // 2026-08-15 (fixture channel)
      "youtube:video:FIXVID30001", // 2026-08-01 (fixture channel)
    ]);
  });

  it("a partially failing poll set: degraded phase, the note kept, failures named, successes shown", async () => {
    const handle = liveSource({
      channelUploads: (input) =>
        input.channelId === "UCFIXCH0000000000000001"
          ? honest("rate-limited", "quota spent on this channel's poll (fixture)")
          : { kind: "ok", value: page(UPLOADS_ROWS) },
    });
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: handle,
      account: fakeAccount("connected", refs),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("degraded");
    expect(view.degradeNote).toBe(SUBSCRIPTIONS_DEGRADE_NOTE);
    expect(view.detail).toContain("Fixture Channel (rate-limited)");
    expect(view.videos.length).toBe(UPLOADS_ROWS.length);
    expect(view.channels.map((card) => card.title)).toEqual(["Fixture Shorts Lab"]);
  });

  it("the subscribed-channels read failing answers the degraded compose (never a crash)", async () => {
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: liveSource(),
      account: fakeAccount("connected", refs, { failWith: new Error("account read failed (fixture)") }),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("degraded");
    expect(view.detail).toContain("subscribed-channels read failed");
    expect(view.degradeNote).toBe(SUBSCRIPTIONS_DEGRADE_NOTE);
  });

  it("an account subscribed to nothing answers empty (with the compose note)", async () => {
    const producer = new YouTubeSubscriptionsProducer({
      clock: fixedClock(),
      source: liveSource(),
      account: fakeAccount("connected", []),
    });
    const view = await producer.subscriptions();
    expect(view.phase).toBe("empty");
    expect(view.degradeNote).toBe(SUBSCRIPTIONS_DEGRADE_NOTE);
  });
});

// ---------------------------------------------------------------------------
// HistoryPort
// ---------------------------------------------------------------------------

describe("LocalHistoryProducer (WebFlix-owned grouped continue-watching)", () => {
  const entries = [
    historyEntry("FIXVID40001", "2026-10-23T10:00:00Z"),
    historyEntry("FIXVID40002", "2026-10-23T09:00:00Z"),
    historyEntry("FIXVID40003", "2026-10-22T18:00:00Z"),
    historyEntry("FIXVID40004", "2026-10-20T18:00:00Z"),
    historyEntry("FIXVID40005", "2026-05-01T18:00:00Z"),
  ];

  it("groups into Today / Yesterday / This week / Earlier (UTC calendar-day buckets)", async () => {
    const producer = new LocalHistoryProducer({ clock: fixedClock(), history: fakeHistory(entries) });
    const view = await producer.history();
    expect(view.phase).toBe("ready");
    expect(view.groups.map((group) => group.label)).toEqual(["Today", "Yesterday", "This week", "Earlier"]);
    expect(view.groups[0]?.items.length).toBe(2);
    expect(view.groups[1]?.items.length).toBe(1);
    expect(view.groups[2]?.items.length).toBe(1);
    expect(view.groups[3]?.items.length).toBe(1);
    expect(view.groups[0]?.items[0]?.resumeAtSec).toBe(754);
  });

  it("no history answers the empty phase", async () => {
    const producer = new LocalHistoryProducer({ clock: fixedClock(), history: fakeHistory([]) });
    const view = await producer.history();
    expect(view.phase).toBe("empty");
    expect(view.groups).toEqual([]);
  });

  it("a failing local store answers unavailable — never a crash", async () => {
    const producer = new LocalHistoryProducer({
      clock: fixedClock(),
      history: fakeHistory([], { failWith: new Error("history store unavailable (fixture)") }),
    });
    const view = await producer.history();
    expect(view.phase).toBe("unavailable");
    expect(view.detail).toContain("history store unavailable");
  });
});

// ---------------------------------------------------------------------------
// ChannelResolutionPort — THE MRBEAST JOURNEY DATA PATH
// ---------------------------------------------------------------------------

describe("YouTubeChannelResolutionProducer (resolveChannel)", () => {
  it("@handle query: the forHandle engine path, resolved with newest-first uploads + publishedLabel evidence", async () => {
    const handle = liveSource();
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    const outcome = await producer.resolveChannel("@fixtureshortslab");
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.channel.title).toBe("Fixture Shorts Lab");
    expect(outcome.channel.subscriberLabel).toBe("1M subscribers");
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelByHandle:@fixtureshortslab"))).toBe(true);
    // The binding newest-first law: the API rows arrived [Sep 1, Oct 20, Sep 15].
    expect(outcome.uploads.map((card) => card.item.id)).toEqual([
      "youtube:video:FIXVID10003",
      "youtube:video:FIXVID10002",
      "youtube:video:FIXVID10001",
    ]);
    // The recency evidence the journey cites (the deterministic en-US labels).
    expect(outcome.uploads[0]?.publishedLabel).toBe("3 days ago");
    expect(outcome.uploads[1]?.publishedLabel).toBe("1 month ago");
    expect(outcome.uploads[2]?.publishedLabel).toBe("1 month ago");
  });

  it("a bare channel id resolves through channels.list by id (real API id shape: UC + 22)", async () => {
    const realShapeId = "UCFIXCH000000000000000X2";
    const handle = liveSource();
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    const outcome = await producer.resolveChannel(realShapeId);
    expect(outcome.kind).toBe("resolved");
    expect(engineOf(handle).calls.some((call) => call.startsWith(`channelById:${realShapeId}`))).toBe(true);
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelByHandle:"))).toBe(false);
  });

  it("a youtube.com/@handle URL resolves through forHandle", async () => {
    const handle = liveSource();
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    const outcome = await producer.resolveChannel("https://www.youtube.com/@fixtureshortslab");
    expect(outcome.kind).toBe("resolved");
    expect(engineOf(handle).calls.some((call) => call.startsWith("channelByHandle:@fixtureshortslab"))).toBe(true);
  });

  it("a name query: an EXACT name match resolves directly (one strong match)", async () => {
    const candidates: YouTubeChannelSummary[] = [
      { channelId: "UCFIXCH0000000000000099", title: "Fixture Shorts Lab Official Fan Page" },
      { channelId: "UCFIXCH0000000000000002", title: "Fixture Shorts Lab" },
    ];
    const handle = liveSource({
      searchChannels: () => ({ kind: "ok", value: { channels: candidates } }),
    });
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    const outcome = await producer.resolveChannel("Fixture Shorts Lab");
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.channel.title).toBe("Fixture Shorts Lab");
  });

  it("an exact handle match resolves even among other candidates (a mistyped direct lookup falls to search)", async () => {
    const candidates: YouTubeChannelSummary[] = [
      { channelId: "UCFIXCH0000000000000098", title: "fixtureshortslab fan channel" },
      { channelId: "UCFIXCH0000000000000002", title: "Fixture Shorts Lab", handle: "@fixtureshortslab" },
    ];
    const handle = liveSource({
      channelByHandle: () => ({ kind: "ok", value: { channel: null } }),
      searchChannels: () => ({ kind: "ok", value: { channels: candidates } }),
    });
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    const outcome = await producer.resolveChannel("@fixtureshortslab");
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.channel.channelId).toBe("UCFIXCH0000000000000002");
  });

  it("multiple plausible candidates with no exact match answer AMBIGUOUS, capped at 5 (the agent asks)", async () => {
    const candidates: YouTubeChannelSummary[] = Array.from({ length: 7 }, (_, i) => ({
      channelId: `UCFIXCH00000000000000${90 + i}`,
      title: `Fixture Shorts Lab variant ${i + 1}`,
    }));
    const producer = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({ searchChannels: () => ({ kind: "ok", value: { channels: candidates } }) }),
    });
    const outcome = await producer.resolveChannel("shorts lab");
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.candidates.length).toBe(5);
    expect(outcome.candidates.every((card) => card.channelId.startsWith("UCFIXCH000000000000009"))).toBe(true);
  });

  it("two EXACT matches stay ambiguous (never a silent pick)", async () => {
    const candidates: YouTubeChannelSummary[] = [
      { channelId: "UCFIXCH0000000000000091", title: "Fixture Shorts Lab" },
      { channelId: "UCFIXCH0000000000000092", title: "fixture shorts lab" },
    ];
    const producer = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({ searchChannels: () => ({ kind: "ok", value: { channels: candidates } }) }),
    });
    const outcome = await producer.resolveChannel("Fixture Shorts Lab");
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind !== "ambiguous") return;
    expect(outcome.candidates.length).toBe(2);
  });

  it("zero candidates answer not-found (a mistyped handle falls through to search honestly)", async () => {
    const producer = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({
        channelByHandle: () => ({ kind: "ok", value: { channel: null } }),
        searchChannels: () => ({ kind: "ok", value: { channels: [] } }),
      }),
    });
    const outcome = await producer.resolveChannel("@does-not-exist");
    expect(outcome.kind).toBe("not-found");
  });

  it("no key: the honest requires-auth unavailable phase (never a throw)", async () => {
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: noKeySource() });
    const outcome = await producer.resolveChannel("MrBeast");
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind !== "unavailable") return;
    expect(outcome.phase).toBe("requires-auth");
    expect(outcome.detail).toBe(REQUIRES_AUTH_DETAIL);
  });

  it("quota/network on the search path: the honest phase as data", async () => {
    const quota = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({ searchChannels: () => honest("rate-limited", "daily quota is exhausted (fixture)") }),
    });
    const quotaOutcome = await quota.resolveChannel("MrBeast");
    expect(quotaOutcome.kind).toBe("unavailable");
    if (quotaOutcome.kind !== "unavailable") return;
    expect(quotaOutcome.phase).toBe("rate-limited");

    const network = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({ channelByHandle: () => honest("unavailable", "network failure (fixture)") }),
    });
    const networkOutcome = await network.resolveChannel("@fixtureshortslab");
    expect(networkOutcome.kind).toBe("unavailable");
    if (networkOutcome.kind !== "unavailable") return;
    expect(networkOutcome.phase).toBe("unavailable");
  });

  it("a resolved channel whose uploads shelf fails answers unavailable NAMING the resolved channel", async () => {
    const producer = new YouTubeChannelResolutionProducer({
      clock: fixedClock(),
      source: liveSource({ channelUploads: () => honest("rate-limited", "quota spent on the uploads shelf (fixture)") }),
    });
    const outcome = await producer.resolveChannel("@fixtureshortslab");
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind !== "unavailable") return;
    expect(outcome.phase).toBe("rate-limited");
    expect(outcome.detail).toContain("channel \"Fixture Shorts Lab\" resolved");
  });

  it("uploadsLimit rides through to the engine call (the journey's evidence depth)", async () => {
    const handle = liveSource();
    const producer = new YouTubeChannelResolutionProducer({ clock: fixedClock(), source: handle });
    await producer.resolveChannel("@fixtureshortslab", { uploadsLimit: 3 });
    expect(engineOf(handle).calls.some((call) => call.endsWith(":3"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The composition bundle
// ---------------------------------------------------------------------------

describe("createYouTubeMediaProducers (the one-factory bundle)", () => {
  it("wires all eight frozen ports over one engine handle", async () => {
    const producers = createYouTubeMediaProducers({
      clock: fixedClock(),
      source: liveSource(),
      history: fakeHistory([historyEntry("FIXVID50001", "2026-10-23T10:00:00Z")]),
      account: fakeAccount("not-connected"),
    });
    expect(typeof producers.homeFeed.getHomeFeed).toBe("function");
    expect(typeof producers.searchPage.searchPage).toBe("function");
    expect(typeof producers.channel.channel).toBe("function");
    expect(typeof producers.trending.trending).toBe("function");
    expect(typeof producers.shorts.shorts).toBe("function");
    expect(typeof producers.subscriptions.subscriptions).toBe("function");
    expect(typeof producers.history.history).toBe("function");
    expect(typeof producers.channelResolution.resolveChannel).toBe("function");
    // Smoke: the local history surface works regardless of the engine.
    expect((await producers.history.history()).phase).toBe("ready");
  });

  it("the requires-auth handle answers honestly on every Data-API-backed surface (history still local)", async () => {
    const producers = createYouTubeMediaProducers({
      clock: fixedClock(),
      source: noKeySource(),
      history: fakeHistory([]),
      account: fakeAccount("not-connected"),
    });
    expect((await producers.homeFeed.getHomeFeed({})).phase).toBe("requires-auth");
    expect((await producers.trending.trending({})).phase).toBe("requires-auth");
    expect((await producers.shorts.shorts()).phase).toBe("requires-auth");
    expect((await producers.subscriptions.subscriptions()).phase).toBe("requires-auth");
    expect((await producers.channel.channel({ handle: "fixtureshortslab" })).phase).toBe("requires-auth");
    const search = await producers.searchPage.searchPage("cats");
    expect(search.videos).toEqual([]);
    expect(search.budgetNote).toContain("requires-auth");
    const resolution = await producers.channelResolution.resolveChannel("MrBeast");
    expect(resolution.kind).toBe("unavailable");
    expect((await producers.history.history()).phase).toBe("empty");
  });
});
