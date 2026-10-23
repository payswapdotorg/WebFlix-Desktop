// Shared TEST FIXTURES for the WFX-UX-SHELL-1 component battery.
//
// FIXTURE-ONLY LAW (work order / freeze §9.5): every builder below is
// named `fixture*` and constructs shell-local literals shaped exactly like
// the frozen §9 view contracts (webflix-contracts media-views.ts). Nothing
// here is production data, and no fixture ever masquerades as a live
// producer — the tests that use them render them through the same
// components the host will drive with real port output.

import type {
  CatalogItem,
  ChannelCardView,
  ChannelHeaderView,
  ChannelView,
  ContinueCardView,
  HistoryView,
  HomeFeedView,
  HomeSectionView,
  PlaybackPlan,
  SearchPageData,
  ShortsView,
  SubscriptionsView,
  TrendingView,
  VideoCardView,
} from "../src/index";

export const ISO = "2026-01-01T00:00:00Z";

export function fixtureItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "yt-item-1",
    title: "Fixture video",
    providerId: "youtube",
    mediaKind: "video",
    assets: [],
    metadata: {},
    ...overrides,
  };
}

export function fixtureVideoCard(overrides: Partial<VideoCardView> = {}): VideoCardView {
  return {
    item: fixtureItem(),
    title: "Fixture video",
    channelId: "chan-1",
    channelTitle: "Fixture Channel",
    thumbnailUrl: "https://img.example.test/thumb-1.jpg",
    durationLabel: "12:34",
    viewsLabel: "1.2M views",
    publishedLabel: "3 days ago",
    badges: [],
    ...overrides,
  };
}

export function fixtureShortCard(overrides: Partial<VideoCardView> = {}): VideoCardView {
  return fixtureVideoCard({
    item: fixtureItem({ id: "yt-short-1", mediaKind: "short", title: "Fixture short" }),
    title: "Fixture short",
    durationLabel: undefined,
    viewsLabel: "9.9M views",
    publishedLabel: undefined,
    ...overrides,
  });
}

export function fixtureContinueCard(overrides: Partial<ContinueCardView> = {}): ContinueCardView {
  return {
    ...fixtureVideoCard({
      item: fixtureItem({ id: "yt-continue-1", title: "Continue fixture video" }),
      title: "Continue fixture video",
    }),
    progressPercent: 0.42,
    progressLabel: "Resume at 4:12",
    resumeAtSec: 252,
    ...overrides,
  };
}

export function fixtureChannelCard(overrides: Partial<ChannelCardView> = {}): ChannelCardView {
  return {
    channelId: "chan-1",
    title: "Fixture Channel",
    handle: "@fixturechannel",
    avatarUrl: "https://img.example.test/avatar-1.jpg",
    subscriberLabel: "2.4M subscribers",
    videoCountLabel: "310 videos",
    verified: true,
    description: "A fixture channel used only by tests.",
    ...overrides,
  };
}

export function fixtureChannelHeader(overrides: Partial<ChannelHeaderView> = {}): ChannelHeaderView {
  return {
    ...fixtureChannelCard(),
    bannerUrl: "https://img.example.test/banner-1.jpg",
    createdAtLabel: "Joined 2019",
    ...overrides,
  };
}

/** A ready HomeFeedView with the reference's interleaved section shapes. */
export function fixtureHomeFeedReady(
  sections: readonly HomeSectionView[],
  overrides: {
    chips?: readonly string[];
    selectedChip?: string | null;
    nextCursor?: string | null;
    compositionNote?: string;
  } = {},
): HomeFeedView {
  const ready: Extract<HomeFeedView, { phase: "ready" }> = {
    phase: "ready",
    chips: [...(overrides.chips ?? ["All", "Music", "Gaming"])],
    selectedChip: overrides.selectedChip ?? null,
    sections: [...sections],
    nextCursor: overrides.nextCursor ?? "home-cursor-2",
    compositionNote: overrides.compositionNote ?? "FIXTURE: composed from trending + local history",
  };
  return ready;
}

export function fixtureHomeSections(): readonly HomeSectionView[] {
  return [
    {
      kind: "continue-watching",
      sectionId: "continue-1",
      title: "Keep watching",
      items: [fixtureContinueCard()],
    },
    {
      kind: "shorts-shelf",
      sectionId: "shorts-1",
      title: "Shorts",
      shorts: [fixtureShortCard()],
    },
    {
      kind: "video-grid",
      sectionId: "grid-1",
      title: "Recommended",
      videos: [fixtureVideoCard(), fixtureVideoCard({ item: fixtureItem({ id: "yt-item-2" }), title: "Second fixture video" })],
      layout: "grid",
    },
  ];
}

export function fixtureHomeFeedPhase(
  phase: Extract<HomeFeedView, { phase: string }>["phase"],
  overrides: { detail?: string; sections?: readonly HomeSectionView[] } = {},
): HomeFeedView {
  if (phase === "loading") return { phase: "loading" };
  if (phase === "ready") return fixtureHomeFeedReady(fixtureHomeSections());
  return {
    phase,
    detail: overrides.detail,
    sections: overrides.sections === undefined ? undefined : [...overrides.sections],
  };
}

export function fixtureSearchPageData(overrides: Partial<SearchPageData> = {}): SearchPageData {
  return {
    query: "fixture query",
    videos: [fixtureVideoCard()],
    channels: [fixtureChannelCard()],
    nextCursor: "search-cursor-2",
    budgetNote: "FIXTURE budget note: 87 of 100 quota units left today.",
    ...overrides,
  };
}

export function fixtureChannelView(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    channel: fixtureChannelHeader(),
    availableTabs: ["home", "videos", "shorts"],
    videos: [fixtureVideoCard()],
    shorts: [fixtureShortCard()],
    nextCursor: "channel-cursor-2",
    phase: "ready",
    ...overrides,
  };
}

export function fixtureTrendingView(overrides: Partial<TrendingView> = {}): TrendingView {
  return {
    region: "US",
    chips: ["Now", "Music", "Gaming"],
    selectedChip: "Now",
    videos: [fixtureVideoCard()],
    nextCursor: "trending-cursor-2",
    phase: "ready",
    ...overrides,
  };
}

export function fixtureShortsView(overrides: Partial<ShortsView> = {}): ShortsView {
  return {
    shorts: [fixtureShortCard()],
    nextCursor: "shorts-cursor-2",
    phase: "ready",
    ...overrides,
  };
}

export function fixtureSubscriptionsView(overrides: Partial<SubscriptionsView> = {}): SubscriptionsView {
  return {
    channels: [fixtureChannelCard()],
    videos: [fixtureVideoCard()],
    degradeNote: "FIXTURE: polled per-channel uploads (no subscriptions-feed API exists).",
    phase: "ready",
    ...overrides,
  };
}

export function fixtureHistoryView(overrides: Partial<HistoryView> = {}): HistoryView {
  return {
    groups: [
      { label: "Today", items: [fixtureContinueCard()] },
      {
        label: "Last week",
        items: [
          fixtureContinueCard({
            item: fixtureItem({ id: "yt-item-h2" }),
            title: "Older fixture video",
          }),
        ],
      },
    ],
    phase: "ready",
    ...overrides,
  };
}

export const FIXTURE_EMBED_PLAN: PlaybackPlan = {
  kind: "official-embed",
  providerId: "youtube",
  embedSpec: {
    embedUrl: "https://www.youtube-nocookie.com/embed/fixture-id",
    externalId: "fixture-id",
  },
};

/** The fill-width style of a progress track's inner bar (test helper). */
export function progressFillWidth(track: Element): string {
  return (track.firstElementChild as HTMLElement | null)?.style.width ?? "";
}
