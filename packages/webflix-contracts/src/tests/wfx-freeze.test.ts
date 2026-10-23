/**
 * Round-trip tests for the WFX freeze §9 siblings: the UI-action bridge
 * (ui-actions.ts) and the media-view seam (media-views.ts).
 *
 * Same discipline as contracts.test.ts: for each schema a known-good
 * instance parses and round-trips unchanged (through JSON too), and
 * known-bad instances are rejected by safeParse. The law-level pins:
 * the action union REJECTS account mutations (no like/subscribe action
 * exists to parse), the context caps visibleItemIds, and every honest
 * phase is data the schemas accept.
 */
import { describe, expect, it } from "vitest";
import {
  AgentActionTraceEntrySchema,
  AgentChannelSummarySchema,
  AgentChoiceSchema,
  AgentItemSummarySchema,
  CatalogItemSchema,
  ChannelCardViewSchema,
  ChannelHeaderViewSchema,
  ChannelViewSchema,
  ContinueCardViewSchema,
  HistoryViewSchema,
  HomeFeedViewSchema,
  HomeSectionViewSchema,
  MediaConnectionStateSchema,
  MediaConnectionViewSchema,
  MediaRouteSchema,
  MediaViewPhaseSchema,
  PlayingItemViewSchema,
  RouteParamsSchema,
  SearchPageDataSchema,
  ShortsViewSchema,
  SubscriptionsViewSchema,
  TrendingViewSchema,
  UiActionFailureCodeSchema,
  UiActionResultSchema,
  UiActionSchema,
  VideoBadgeSchema,
  VideoCardViewSchema,
  VisibleMediaContextSchema,
} from "../index";

const ISO_NOW = "2026-10-23T12:00:00Z";

/** Parses `valid`, asserts the output deep-equals the input and survives JSON. */
function expectRoundTrip(schema: { parse(value: unknown): unknown }, valid: unknown): void {
  const parsed = schema.parse(valid);
  expect(parsed).toEqual(valid);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(valid);
}

/** Asserts `invalid` is rejected by `schema`. */
function expectRejected(schema: { safeParse(value: unknown): { success: boolean } }, invalid: unknown): void {
  expect(schema.safeParse(invalid).success).toBe(false);
}

/** A canonical catalog item the card views embed verbatim (§2.1 shape). */
const CATALOG_ITEM = {
  id: "youtube-video-dQw4w9WgXcQ",
  providerId: "youtube",
  title: "Sample video",
  mediaKind: "video",
  assets: [],
  metadata: {},
};

const VIDEO_CARD = {
  item: CATALOG_ITEM,
  title: "Sample video",
  channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA",
  channelTitle: "Sample channel",
  durationLabel: "12:34",
  viewsLabel: "1.2M views",
  publishedLabel: "2 days ago",
  badges: ["new"],
};

const CHANNEL_CARD = {
  channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA",
  title: "Sample channel",
  handle: "@sample",
  subscriberLabel: "1.2M subscribers",
  videoCountLabel: "420 videos",
  verified: true,
};

describe("ui-actions — routes, context, panel", () => {
  it("round-trips the route model", () => {
    expectRoundTrip(MediaRouteSchema, "watch");
    expectRoundTrip(RouteParamsSchema, { query: "mrbeast", itemId: "youtube-video-abc12345678" });
    expectRoundTrip(RouteParamsSchema, {});
    expectRejected(MediaRouteSchema, "dashboard");
    expectRejected(RouteParamsSchema, { query: 42 });
  });

  it("round-trips connection + panel views", () => {
    expectRoundTrip(MediaConnectionViewSchema, { providerId: "youtube", state: "connected" });
    expectRoundTrip(MediaConnectionStateSchema, "not-configured");
    expectRejected(MediaConnectionStateSchema, "half-connected");
  });

  it("round-trips the visible media context and caps visibleItemIds at 25", () => {
    const context = {
      at: ISO_NOW,
      route: "watch",
      params: { itemId: "youtube-video-dQw4w9WgXcQ" },
      playingItem: {
        itemId: "youtube-video-dQw4w9WgXcQ",
        title: "Sample video",
        providerId: "youtube",
        mediaKind: "video",
      },
      watchPlanKind: "official-embed",
      visibleItemIds: ["a", "b", "c"],
      connections: [{ providerId: "youtube", state: "not-connected" }],
      agentPanel: { visible: true, widthPx: 420 },
      pendingChoice: null,
    };
    expectRoundTrip(VisibleMediaContextSchema, context);
    expectRejected(VisibleMediaContextSchema, { ...context, route: "nope" });
    expectRejected(VisibleMediaContextSchema, {
      ...context,
      visibleItemIds: Array.from({ length: 26 }, (_, i) => `id-${i}`),
    });
    expectRejected(PlayingItemViewSchema, { itemId: "", title: "x", providerId: "youtube", mediaKind: "video" });
  });
});

describe("ui-actions — the frozen action set", () => {
  it("round-trips all seven frozen actions", () => {
    expectRoundTrip(UiActionSchema, { action: "searchCatalog", query: "mrbeast", limit: 10 });
    expectRoundTrip(UiActionSchema, { action: "resolveChannel", query: "@MrBeast" });
    expectRoundTrip(UiActionSchema, { action: "openRoute", route: "watch", params: { itemId: "x" } });
    expectRoundTrip(UiActionSchema, { action: "playCatalogItem", itemId: "youtube-video-abc", startAtSec: 30 });
    expectRoundTrip(UiActionSchema, { action: "openAccountConnection", providerId: "youtube" });
    expectRoundTrip(UiActionSchema, { action: "toggleAgentPanel" });
    expectRoundTrip(UiActionSchema, { action: "toggleAgentPanel", visible: false });
    expectRoundTrip(UiActionSchema, { action: "getVisibleMediaContext" });
  });

  it("rejects malformed actions — the union stays closed", () => {
    expectRejected(UiActionSchema, { action: "likeVideo", itemId: "x" });
    expectRejected(UiActionSchema, { action: "subscribeChannel", channelId: "x" });
    expectRejected(UiActionSchema, { action: "addToPlaylist", itemId: "x" });
    expectRejected(UiActionSchema, { action: "searchCatalog", query: "   " });
    expectRejected(UiActionSchema, { action: "playCatalogItem" });
    expectRejected(UiActionSchema, { action: "openRoute", route: "dashboard" });
    expectRejected(UiActionSchema, { action: "searchCatalog", query: "x", limit: 500 });
  });
});

describe("ui-actions — the typed result union", () => {
  const context = {
    at: ISO_NOW,
    route: "watch",
    params: {},
    playingItem: null,
    watchPlanKind: null,
    visibleItemIds: [],
    connections: [],
    agentPanel: { visible: true, widthPx: null },
    pendingChoice: null,
  };

  it("round-trips ok with items, channels, evidence and the verification context", () => {
    expectRoundTrip(UiActionResultSchema, {
      kind: "ok",
      summary: "Playing Sample video",
      items: [
        {
          itemId: "youtube-video-abc",
          title: "Sample video",
          providerId: "youtube",
          mediaKind: "video",
          channelTitle: "Sample channel",
          publishedLabel: "1 hour ago",
        },
      ],
      channels: [{ channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA", title: "Sample channel", verified: true }],
      evidence: ["uploads playlist UUx: newest item published 2026-10-23T10:00:00Z"],
      context,
    });
  });

  it("round-trips failure, needs-user-choice and unsupported", () => {
    expectRoundTrip(UiActionResultSchema, {
      kind: "failure",
      code: "item-not-found",
      message: "No item with id 'made-up' in the app state",
      retryable: false,
    });
    expectRoundTrip(UiActionFailureCodeSchema, "bridge-unavailable");
    expectRejected(UiActionFailureCodeSchema, "agent-offline");
    expectRoundTrip(UiActionResultSchema, {
      kind: "needs-user-choice",
      prompt: "Which channel did you mean?",
      choices: [{ id: "UCX6OQ3DkcsbYNE6H8uQQuVA", label: "MrBeast", description: "346M subscribers" }],
    });
    expectRejected(UiActionResultSchema, { kind: "needs-user-choice", prompt: "Which?", choices: [] });
    expectRoundTrip(UiActionResultSchema, {
      kind: "unsupported",
      capability: "requires-auth",
      reason: "No YouTube Data API key is configured",
      operationId: "catalog.search",
    });
    expectRejected(UiActionResultSchema, { kind: "unsupported", capability: "maybe", reason: "x" });
    expectRejected(AgentChoiceSchema, { id: "", label: "x" });
    expectRejected(AgentItemSummarySchema, { itemId: "x" });
  });

  it("round-trips the action trace entry", () => {
    expectRoundTrip(AgentActionTraceEntrySchema, {
      at: ISO_NOW,
      action: { action: "playCatalogItem", itemId: "youtube-video-abc" },
      outcomeKind: "ok",
      summary: "Playing Sample video",
    });
    expectRejected(AgentActionTraceEntrySchema, {
      at: ISO_NOW,
      action: { action: "likeVideo" },
      outcomeKind: "ok",
      summary: "x",
    });
    expectRejected(AgentChannelSummarySchema, { channelId: "" });
  });
});

describe("media-views — card atoms", () => {
  it("round-trips the video card (catalog item verbatim)", () => {
    expectRoundTrip(VideoCardViewSchema, VIDEO_CARD);
    expectRoundTrip(VideoBadgeSchema, "live");
    expectRejected(VideoBadgeSchema, "4k");
    expectRejected(VideoCardViewSchema, { ...VIDEO_CARD, item: { id: "x" } });
    // The embedded item must be a valid CatalogItem.
    expect(CatalogItemSchema.safeParse(VIDEO_CARD.item).success).toBe(true);
  });

  it("round-trips continue + channel cards and the channel header", () => {
    expectRoundTrip(ContinueCardViewSchema, {
      ...VIDEO_CARD,
      progressPercent: 0.42,
      progressLabel: "42%",
      resumeAtSec: 300,
    });
    expectRejected(ContinueCardViewSchema, { ...VIDEO_CARD, progressPercent: 1.5 });
    expectRoundTrip(ChannelCardViewSchema, CHANNEL_CARD);
    expectRoundTrip(ChannelHeaderViewSchema, { ...CHANNEL_CARD, createdAtLabel: "Joined 2012" });
    expectRejected(ChannelCardViewSchema, { ...CHANNEL_CARD, channelId: "" });
  });
});

describe("media-views — home feed sections", () => {
  it("round-trips every section kind", () => {
    expectRoundTrip(HomeSectionViewSchema, {
      kind: "video-grid",
      sectionId: "trending",
      title: "Trending",
      videos: [VIDEO_CARD],
      layout: "grid",
    });
    expectRoundTrip(HomeSectionViewSchema, {
      kind: "shorts-shelf",
      sectionId: "shorts-1",
      shorts: [{ ...VIDEO_CARD, item: { ...CATALOG_ITEM, mediaKind: "short" } }],
    });
    expectRoundTrip(HomeSectionViewSchema, {
      kind: "continue-watching",
      sectionId: "continue",
      items: [{ ...VIDEO_CARD, progressPercent: null }],
    });
    expectRoundTrip(HomeSectionViewSchema, {
      kind: "section-state",
      sectionId: "shorts-2",
      phase: "requires-auth",
      detail: "No authorized transport",
    });
    expectRejected(HomeSectionViewSchema, { kind: "video-grid", sectionId: "x", videos: "no" });
  });

  it("phase-gates the home feed view (ready carries the composition)", () => {
    expectRoundTrip(HomeFeedViewSchema, { phase: "loading" });
    expectRoundTrip(HomeFeedViewSchema, {
      phase: "ready",
      chips: ["All", "Music"],
      selectedChip: "All",
      sections: [
        { kind: "video-grid", sectionId: "r1", videos: [VIDEO_CARD], layout: "grid" },
        { kind: "shorts-shelf", sectionId: "s1", shorts: [] },
        { kind: "continue-watching", sectionId: "c1", items: [] },
        { kind: "section-state", sectionId: "r2", phase: "rate-limited", detail: "quota" },
      ],
      nextCursor: "cursor-1",
      compositionNote: "Composed from the trending chart + local history (no official home API exists).",
    });
    expectRoundTrip(HomeFeedViewSchema, { phase: "requires-auth", detail: "No API key configured" });
    expectRoundTrip(HomeFeedViewSchema, {
      phase: "degraded",
      sections: [{ kind: "section-state", sectionId: "r1", phase: "unavailable" }],
    });
    expectRejected(HomeFeedViewSchema, { phase: "ready", sections: "no" });
    expectRejected(HomeFeedViewSchema, { phase: "exploded" });
  });
});

describe("media-views — page surfaces", () => {
  it("round-trips search page data", () => {
    expectRoundTrip(SearchPageDataSchema, {
      query: "mrbeast",
      videos: [VIDEO_CARD],
      channels: [CHANNEL_CARD],
      nextCursor: null,
    });
    expectRejected(SearchPageDataSchema, { query: "", videos: [], channels: [] });
  });

  it("round-trips the channel surface with tabs", () => {
    expectRoundTrip(ChannelViewSchema, {
      channel: { ...CHANNEL_CARD, createdAtLabel: "Joined 2012" },
      availableTabs: ["home", "videos", "shorts"],
      videos: [VIDEO_CARD],
      shorts: [],
      nextCursor: null,
      phase: "ready",
    });
    expectRejected(ChannelViewSchema, {
      channel: CHANNEL_CARD,
      availableTabs: ["store"],
      videos: [],
      shorts: [],
      nextCursor: null,
      phase: "ready",
    });
  });

  it("round-trips trending, shorts, subscriptions (degradeNote law) and history", () => {
    expectRoundTrip(TrendingViewSchema, {
      region: "US",
      chips: ["Now", "Music"],
      selectedChip: "Now",
      videos: [VIDEO_CARD],
      nextCursor: null,
      phase: "ready",
    });
    expectRoundTrip(ShortsViewSchema, {
      shorts: [{ ...VIDEO_CARD, item: { ...CATALOG_ITEM, mediaKind: "short" } }],
      nextCursor: null,
      phase: "ready",
    });
    expectRoundTrip(SubscriptionsViewSchema, {
      channels: [CHANNEL_CARD],
      videos: [VIDEO_CARD],
      degradeNote: "Composed by polling each channel's uploads (no subscriptions-feed API).",
      phase: "ready",
    });
    expectRoundTrip(SubscriptionsViewSchema, {
      channels: [],
      videos: [],
      phase: "requires-auth",
      detail: "Connect a YouTube account to use subscriptions",
    });
    expectRoundTrip(HistoryViewSchema, {
      groups: [{ label: "Today", items: [{ ...VIDEO_CARD, progressPercent: 0.5 }] }],
      phase: "ready",
    });
    expectRejected(HistoryViewSchema, { groups: [{ label: "", items: [] }], phase: "ready" });
  });

  it("the honest phases are data", () => {
    for (const phase of ["loading", "ready", "empty", "requires-auth", "rate-limited", "unsupported", "unavailable", "degraded", "status-unknown"] as const) {
      expect(MediaViewPhaseSchema.safeParse(phase).success).toBe(true);
    }
    expectRejected(MediaViewPhaseSchema, "partial");
  });
});
