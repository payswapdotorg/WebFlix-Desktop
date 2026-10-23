// @vitest-environment jsdom
//
// New media-surface tests (WFX-UX-SHELL-1, deliverable 5): ChannelScreen,
// TrendingScreen, ShortsScreen, SubscriptionsScreen, HistoryScreen. The
// jsdom docblock above is mandatory. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: every view below is a tests/fixtures.ts
// literal shaped like the frozen §9 view contracts — never live data):
// - every surface renders its honest not-provided panel when the host wired
//   no producer (null view) — no spinner, no rows, no invented content;
// - every non-ready phase renders the frozen honest copy;
// - the ready surfaces render the reference patterns: the channel header
//   band + tabs the producer can honestly serve (availableTabs — never an
//   invented tab), the trending region line (honest when not set) + chips,
//   the shorts 9:16 feed, the subscriptions degradeNote (the BINDING
//   freeze §9.2 compose label), the history groups with progress overlays.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ChannelScreen,
  HistoryScreen,
  ShortsScreen,
  SubscriptionsScreen,
  TrendingScreen,
} from "../src/index";
import {
  fixtureChannelView,
  fixtureHistoryView,
  fixtureShortsView,
  fixtureSubscriptionsView,
  fixtureTrendingView,
  progressFillWidth,
} from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

describe("ChannelScreen (the frozen §9 ChannelView)", () => {
  it("renders the honest not-provided panel when no producer is wired", () => {
    render(<ChannelScreen view={null} />);
    expect(screen.getByTestId("channel-not-provided").textContent).toContain(
      "No data source is wired for this surface yet",
    );
  });

  it("renders the header band: banner, avatar, verified title, meta facts", () => {
    render(<ChannelScreen view={fixtureChannelView()} />);
    expect(screen.getByTestId("channel-banner").getAttribute("src")).toBe(
      "https://img.example.test/banner-1.jpg",
    );
    const header = screen.getByTestId("channel-header");
    expect(header.textContent).toContain("Fixture Channel");
    expect(header.textContent).toContain("@fixturechannel");
    expect(header.textContent).toContain("2.4M subscribers · 310 videos");
    expect(header.textContent).toContain("Joined 2019");
  });

  it("renders ONLY the tabs the producer can honestly serve (availableTabs)", () => {
    render(<ChannelScreen view={fixtureChannelView()} />);
    const tabs = Array.from(screen.getByTestId("channel-tabs").querySelectorAll('[data-testid^="channel-tab-"]'));
    expect(tabs.map((tab) => tab.getAttribute("data-testid"))).toEqual([
      "channel-tab-home",
      "channel-tab-videos",
      "channel-tab-shorts",
    ]);
    expect(screen.queryByTestId("channel-tab-live")).toBeNull();
    expect(screen.queryByTestId("channel-tab-playlists")).toBeNull();
  });

  it("tab selection reports the tab and marks the active one", () => {
    const onTabSelect = vi.fn();
    render(<ChannelScreen view={fixtureChannelView()} onTabSelect={onTabSelect} />);
    fireEvent.click(screen.getByTestId("channel-tab-shorts"));
    expect(onTabSelect).toHaveBeenCalledWith("shorts");
  });

  it("the active tab param is respected (the route's channelTab)", () => {
    render(<ChannelScreen view={fixtureChannelView()} activeTab="shorts" />);
    expect(screen.getByTestId("channel-tab-shorts").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("channel-tab-home").getAttribute("aria-current")).toBeNull();
  });

  it("renders the videos grid + the shorts rail with play paths", () => {
    render(<ChannelScreen view={fixtureChannelView()} onPlayCard={() => {}} />);
    expect(screen.getByTestId("video-card-yt-item-1")).toBeTruthy();
    expect(screen.getByTestId("shorts-tile-yt-short-1")).toBeTruthy();
  });

  it("a non-ready phase renders the honest panel while the header stays visible", () => {
    render(
      <ChannelScreen
        view={fixtureChannelView({ phase: "unavailable", detail: "fixture outage" })}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByTestId("channel-unavailable").textContent).toContain("fixture outage");
    expect(screen.getByTestId("channel-header")).toBeTruthy();
  });

  it("load-more reports the view's cursor", () => {
    const onLoadMore = vi.fn();
    render(<ChannelScreen view={fixtureChannelView()} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByTestId("channel-load-more-button"));
    expect(onLoadMore).toHaveBeenCalledWith("channel-cursor-2");
  });
});

describe("TrendingScreen (the frozen §9 TrendingView)", () => {
  it("renders the honest not-provided panel when no producer is wired", () => {
    render(<TrendingScreen view={null} />);
    expect(screen.getByTestId("trending-not-provided")).toBeTruthy();
  });

  it("renders the region line — honest when the producer sent none", () => {
    render(<TrendingScreen view={fixtureTrendingView({ region: null })} />);
    expect(screen.getByTestId("trending-region").textContent).toContain(
      "not set — the producer sent none",
    );
  });

  it("renders the region + chips + the chart grid", () => {
    render(
      <TrendingScreen
        view={fixtureTrendingView()}
        onPlayCard={() => {}}
        onChipSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("trending-region").textContent).toContain("US");
    expect(screen.getByTestId("trending-chips").querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByTestId("trending-grid")).toBeTruthy();
    expect(screen.getByTestId("video-card-yt-item-1")).toBeTruthy();
  });

  it("chip activation reports the chip", () => {
    const onChipSelect = vi.fn();
    render(<TrendingScreen view={fixtureTrendingView()} onChipSelect={onChipSelect} />);
    fireEvent.click(screen.getByTestId("category-chip-0"));
    expect(onChipSelect).toHaveBeenCalledWith("Now");
  });

  it("the rate-limited phase renders the honest panel (no chart is faked)", () => {
    render(
      <TrendingScreen view={fixtureTrendingView({ phase: "rate-limited", videos: [] })} />,
    );
    expect(screen.getByTestId("trending-rate-limited").getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("video-card-yt-item-1")).toBeNull();
  });

  it("the ready-but-empty chart says so honestly", () => {
    render(<TrendingScreen view={fixtureTrendingView({ videos: [] })} />);
    expect(screen.getByTestId("trending-empty").textContent).toContain(
      "nothing is padded",
    );
  });
});

describe("ShortsScreen (the frozen §9 ShortsView)", () => {
  it("renders the honest not-provided panel when no producer is wired", () => {
    render(<ShortsScreen view={null} />);
    expect(screen.getByTestId("shorts-not-provided")).toBeTruthy();
  });

  it("renders the full-bleed 9:16 feed with per-short play actions", () => {
    render(<ShortsScreen view={fixtureShortsView()} onPlayCard={() => {}} />);
    const feed = screen.getByTestId("shorts-feed");
    const tile = screen.getByTestId("shorts-tile-yt-short-1");
    expect(tile.style.aspectRatio).toBe("9 / 16");
    expect(tile.tagName).toBe("BUTTON");
    // The feed variant centers each tile in its row (the full-bleed rhythm).
    expect(tile.parentElement!.style.justifyContent).toBe("center");
    expect(feed.querySelectorAll("li")).toHaveLength(1);
  });

  it("the requires-auth phase renders the honest panel (no invented shorts)", () => {
    render(<ShortsScreen view={fixtureShortsView({ phase: "requires-auth", shorts: [] })} />);
    expect(screen.getByTestId("shorts-requires-auth").getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("shorts-feed")).toBeNull();
  });

  it("the ready-but-empty feed refuses to fill with long-form videos", () => {
    render(<ShortsScreen view={fixtureShortsView({ shorts: [] })} />);
    expect(screen.getByTestId("shorts-empty").textContent).toContain(
      "filling with long-form videos pretending to be shorts",
    );
  });

  it("load-more reports the view's cursor", () => {
    const onLoadMore = vi.fn();
    render(<ShortsScreen view={fixtureShortsView()} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByTestId("shorts-load-more-button"));
    expect(onLoadMore).toHaveBeenCalledWith("shorts-cursor-2");
  });
});

describe("SubscriptionsScreen (the frozen §9 SubscriptionsView)", () => {
  it("renders the honest not-provided panel when no producer is wired", () => {
    render(<SubscriptionsScreen view={null} />);
    expect(screen.getByTestId("subscriptions-not-provided")).toBeTruthy();
  });

  it("renders the BINDING degradeNote (freeze §9.2 — the compose must label itself)", () => {
    render(<SubscriptionsScreen view={fixtureSubscriptionsView()} />);
    const note = screen.getByTestId("subscriptions-degrade-note");
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toContain("polled per-channel uploads");
  });

  it("renders the channel rail + the uploads grid with play paths", () => {
    render(
      <SubscriptionsScreen view={fixtureSubscriptionsView()} onPlayCard={() => {}} />,
    );
    expect(screen.getByTestId("subscriptions-channel-rail")).toBeTruthy();
    expect(screen.getByTestId("channel-card-chan-1")).toBeTruthy();
    expect(screen.getByTestId("subscriptions-grid")).toBeTruthy();
    expect(screen.getByTestId("video-card-yt-item-1")).toBeTruthy();
  });

  it("the not-connected producer answers requires-auth honestly", () => {
    render(
      <SubscriptionsScreen
        view={fixtureSubscriptionsView({
          phase: "requires-auth",
          channels: [],
          videos: [],
          degradeNote: undefined,
        })}
      />,
    );
    expect(screen.getByTestId("subscriptions-requires-auth").getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("subscriptions-channel-rail")).toBeNull();
  });

  it("the ready-but-empty state explains the API truth (no subscriptions-feed API)", () => {
    render(
      <SubscriptionsScreen
        view={fixtureSubscriptionsView({ channels: [], videos: [] })}
      />,
    );
    expect(screen.getByTestId("subscriptions-channels-empty").textContent).toContain(
      "no subscriptions-feed API",
    );
    expect(screen.getByTestId("subscriptions-videos-empty").textContent).toContain(
      "only with real rows",
    );
  });
});

describe("HistoryScreen (the frozen §9 HistoryView)", () => {
  it("renders the honest not-provided panel when no producer is wired", () => {
    render(<HistoryScreen view={null} />);
    expect(screen.getByTestId("history-not-provided")).toBeTruthy();
  });

  it("renders the producer's groups verbatim with progress overlays", () => {
    render(<HistoryScreen view={fixtureHistoryView()} onPlayCard={() => {}} />);
    expect(screen.getByTestId("history-group-0").textContent).toContain("Today");
    expect(screen.getByTestId("history-group-1").textContent).toContain("Last week");
    expect(
      progressFillWidth(screen.getByTestId("video-card-yt-continue-1-progress")),
    ).toBe("42%");
    expect(
      progressFillWidth(screen.getByTestId("video-card-yt-item-h2-progress")),
    ).toBe("42%");
  });

  it("the ready-but-empty history stays honest", () => {
    render(<HistoryScreen view={fixtureHistoryView({ groups: [] })} />);
    expect(screen.getByTestId("history-empty").textContent).toContain(
      "never fills itself with anything else",
    );
  });
});
