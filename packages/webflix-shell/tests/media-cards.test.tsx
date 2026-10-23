// @vitest-environment jsdom
//
// Media card atom tests (WFX-UX-SHELL-1, deliverable 8). The jsdom docblock
// above is mandatory: the package-local vitest.config.ts defaults to the
// node environment, and these tests need a DOM. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: every view below is a tests/fixtures.ts
// literal shaped like the frozen §9 card atoms — never live producer data):
// - VideoCard renders ONLY what the producer sent: thumbnail when present,
//   a quiet placeholder when absent (never an invented <img>), labels only
//   when present, badges with their plain-word labels;
// - the card is interactive ONLY with a real handler (play/channel);
// - progress facts render the overlay bar + label (continue-watching);
// - ChannelCard / ShortsTile follow the same honesty laws;
// - MediaCardGrid renders the responsive grid vs the horizontal rail and
//   skeleton tiles are the loading phase's own visual;
// - CategoryChipRow renders EXACTLY the producer's chip vocabulary;
// - LoadMoreControl never renders a dead control: disabled + reason when
//   the cursor is exhausted or paging is not wired;
// - MediaPhasePanel renders the frozen HONEST_COPY per phase, with its
//   action button ONLY when a real handler is wired.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  CategoryChipRow,
  ChannelCard,
  LoadMoreControl,
  MediaCardGrid,
  MediaPhasePanel,
  ShortsTile,
  VideoCard,
  ViewNotProvided,
  theme,
} from "../src/index";
import type { VideoBadge } from "../src/index";
import {
  fixtureChannelCard,
  fixtureContinueCard,
  fixtureShortCard,
  fixtureVideoCard,
  progressFillWidth,
} from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

describe("VideoCard (the frozen §9 VideoCardView atom)", () => {
  it("renders the producer's facts: thumbnail, title, labels", () => {
    render(<VideoCard card={fixtureVideoCard()} />);
    expect(screen.getByTestId("video-card-yt-item-1-thumb").getAttribute("src")).toBe(
      "https://img.example.test/thumb-1.jpg",
    );
    expect(screen.getByText("Fixture video")).toBeTruthy();
    expect(screen.getByText("1.2M views · 3 days ago")).toBeTruthy();
    expect(screen.getByText("12:34")).toBeTruthy();
  });

  it("renders a quiet placeholder when no thumbnail was sent — never an invented image", () => {
    render(<VideoCard card={fixtureVideoCard({ thumbnailUrl: undefined })} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("no thumbnail")).toBeTruthy();
  });

  it("omits the meta line when the producer sent no labels (nothing is formatted shell-side)", () => {
    render(
      <VideoCard card={fixtureVideoCard({ viewsLabel: undefined, publishedLabel: undefined })} />,
    );
    expect(screen.queryByText(/views/i)).toBeNull();
    expect(screen.queryByText(/ago/i)).toBeNull();
  });

  it("renders every badge with its plain-word label", () => {
    const badges: VideoBadge[] = ["live", "new", "verified", "members-only", "progress"];
    render(<VideoCard card={fixtureVideoCard({ badges })} />);
    for (const badge of badges) {
      expect(screen.getByTestId(`video-card-yt-item-1-badge-${badge}`)).toBeTruthy();
    }
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText("Members only")).toBeTruthy();
  });

  it("is playable only with a real handler: the play button fires with the card", () => {
    const onPlay = vi.fn();
    render(<VideoCard card={fixtureVideoCard()} onPlay={onPlay} />);
    const play = screen.getByTestId("video-card-yt-item-1-play");
    expect(play.getAttribute("aria-label")).toBe("Play Fixture video");
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledWith(fixtureVideoCard());
  });

  it("renders non-interactive markup when no play handler is wired (no dead buttons)", () => {
    render(<VideoCard card={fixtureVideoCard()} />);
    expect(screen.queryByTestId("video-card-yt-item-1-play")).toBeNull();
    // The channel row is plain text, not a fake button.
    expect(screen.getByTestId("video-card-yt-item-1-channel").tagName).toBe("SPAN");
  });

  it("the channel row is a real button only when an open-channel handler is wired", () => {
    const onOpenChannel = vi.fn();
    render(<VideoCard card={fixtureVideoCard()} onOpenChannel={onOpenChannel} />);
    const channel = screen.getByTestId("video-card-yt-item-1-channel");
    expect(channel.tagName).toBe("BUTTON");
    fireEvent.click(channel);
    expect(onOpenChannel).toHaveBeenCalledWith({ channelId: "chan-1" });
  });

  it("continue-watching progress renders the overlay bar with the producer's percent + label", () => {
    render(
      <VideoCard
        card={fixtureContinueCard()}
        progress={{ percent: 0.42, label: "Resume at 4:12" }}
      />,
    );
    const track = screen.getByTestId("video-card-yt-continue-1-progress");
    expect(progressFillWidth(track)).toBe("42%");
    expect(screen.getByText("Resume at 4:12")).toBeTruthy();
  });
});

describe("ChannelCard (the frozen §9 ChannelCardView atom)", () => {
  it("renders the producer's facts: avatar, title+verified, handle, meta", () => {
    render(<ChannelCard channel={fixtureChannelCard()} />);
    expect(screen.getByTestId("channel-card-chan-1")).toBeTruthy();
    expect(screen.getByText("Fixture Channel")).toBeTruthy();
    expect(screen.getByText("@fixturechannel")).toBeTruthy();
    expect(screen.getByText("2.4M subscribers · 310 videos")).toBeTruthy();
  });

  it("renders an avatar placeholder disc when no avatar was sent", () => {
    render(<ChannelCard channel={fixtureChannelCard({ avatarUrl: undefined })} />);
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens the channel only with a real handler", () => {
    const onOpenChannel = vi.fn();
    render(<ChannelCard channel={fixtureChannelCard()} onOpenChannel={onOpenChannel} />);
    fireEvent.click(screen.getByTestId("channel-card-chan-1"));
    expect(onOpenChannel).toHaveBeenCalledWith({ channelId: "chan-1", handle: "@fixturechannel" });
  });

  it("renders a static summary card without a handler (never a dead button)", () => {
    render(<ChannelCard channel={fixtureChannelCard()} />);
    expect(screen.getByTestId("channel-card-chan-1").tagName).toBe("ARTICLE");
  });
});

describe("ShortsTile (the 9:16 vertical tile atom)", () => {
  it("renders the 9:16 aspect ratio with the producer's title + channel views", () => {
    render(<ShortsTile short={fixtureShortCard()} />);
    const tile = screen.getByTestId("shorts-tile-yt-short-1");
    expect(tile.style.aspectRatio).toBe("9 / 16");
    expect(screen.getByText("Fixture short")).toBeTruthy();
    expect(screen.getByText("Fixture Channel · 9.9M views")).toBeTruthy();
  });

  it("is playable only with a real handler", () => {
    const onPlay = vi.fn();
    render(<ShortsTile short={fixtureShortCard()} onPlay={onPlay} />);
    const tile = screen.getByTestId("shorts-tile-yt-short-1");
    expect(tile.tagName).toBe("BUTTON");
    fireEvent.click(tile);
    expect(onPlay).toHaveBeenCalledWith(fixtureShortCard());
  });

  it("renders a static preview tile without a handler", () => {
    render(<ShortsTile short={fixtureShortCard()} />);
    expect(screen.getByTestId("shorts-tile-yt-short-1").tagName).toBe("DIV");
  });
});

describe("MediaCardGrid (the responsive grid + horizontal rail)", () => {
  it("grid layout: the reference's auto-fill columns — 1→N-up by container width, no page overflow", () => {
    render(
      <MediaCardGrid
        cards={[fixtureVideoCard(), fixtureVideoCard({ item: { ...fixtureVideoCard().item, id: "yt-item-2" } })]}
      />,
    );
    const grid = screen.getByTestId("media-card-grid");
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(min(320px, 100%), 1fr))");
    expect(grid.style.overflowX).toBe("");
    expect(grid.querySelectorAll("li")).toHaveLength(2);
  });

  it("rail layout: its own horizontal scroller with fixed-width cards", () => {
    render(<MediaCardGrid cards={[fixtureVideoCard()]} layout="rail" />);
    const rail = screen.getByTestId("media-card-rail");
    expect(rail.style.overflowX).toBe("auto");
  });

  it("skeleton tiles are the loading phase's own visual (aria-hidden, never fake rows)", () => {
    render(<MediaCardGrid cards={[]} loadingSkeleton={3} />);
    const grid = screen.getByTestId("media-card-grid");
    expect(grid.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(grid.querySelectorAll('[data-testid^="video-card-"]')).toHaveLength(0);
  });

  it("progress facts flow through to the cards by item id", () => {
    render(
      <MediaCardGrid
        cards={[fixtureContinueCard()]}
        progressByItemId={new Map([["yt-continue-1", { percent: 0.9 }]])}
      />,
    );
    expect(
      progressFillWidth(screen.getByTestId("video-card-yt-continue-1-progress")),
    ).toBe("90%");
  });
});

describe("CategoryChipRow (the producer's chip vocabulary, verbatim)", () => {
  it("renders exactly the sent chips and marks the selected one", () => {
    render(<CategoryChipRow chips={["All", "Music", "Gaming"]} selected="Music" onSelect={() => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("category-chip-1").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("category-chip-0").getAttribute("aria-pressed")).toBe("false");
  });

  it("chip activation reports the chip value", () => {
    const onSelect = vi.fn();
    render(<CategoryChipRow chips={["All", "Music"]} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("category-chip-1"));
    expect(onSelect).toHaveBeenCalledWith("Music");
  });

  it("static chips (no handler) render as aria-current spans — the shell adds no invented 'All'", () => {
    render(<CategoryChipRow chips={["Music"]} selected={null} />);
    const chip = screen.getByTestId("category-chip-0");
    expect(chip.tagName).toBe("SPAN");
    expect(screen.queryByText("All")).toBeNull();
  });
});

describe("LoadMoreControl (the honest cursor affordance)", () => {
  it("enabled with a cursor + handler: the button reports the surface", () => {
    const onLoadMore = vi.fn();
    render(<LoadMoreControl nextCursor="cursor-2" onLoadMore={onLoadMore} surfaceLabel="home feed" />);
    const button = screen.getByTestId("load-more-button");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Load more from the home feed");
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledWith("cursor-2");
  });

  it("exhausted cursor: disabled with the no-more-pages reason (never dead)", () => {
    render(<LoadMoreControl nextCursor={null} onLoadMore={() => {}} />);
    expect(screen.getByTestId("load-more-button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("load-more-reason").textContent).toBe(
      "No more pages — the view said so.",
    );
    expect(screen.queryByTestId("load-more-sentinel")).toBeNull();
  });

  it("unwired paging: disabled with the honest not-wired reason", () => {
    render(<LoadMoreControl nextCursor="cursor-2" />);
    expect(screen.getByTestId("load-more-button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("load-more-reason").textContent).toBe(
      "Paging is not wired by this host yet.",
    );
  });

  it("in-flight appends disable + relabel the button", () => {
    render(<LoadMoreControl nextCursor="cursor-2" onLoadMore={() => {}} loadingMore />);
    const button = screen.getByTestId("load-more-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toBe("Loading more…");
  });
});

describe("MediaPhasePanel (the frozen MediaViewPhase vocabulary as data)", () => {
  it("ready renders nothing (the caller renders data)", () => {
    const { container } = render(<MediaPhasePanel phase="ready" />);
    expect(container.firstElementChild).toBeNull();
  });

  it("every non-ready phase renders its HONEST_COPY title + the typed detail verbatim", () => {
    const phases = [
      "loading",
      "empty",
      "requires-auth",
      "rate-limited",
      "unsupported",
      "unavailable",
      "degraded",
      "status-unknown",
    ] as const;
    for (const phase of phases) {
      const { unmount } = render(
        <MediaPhasePanel phase={phase} detail="provider said: fixture" testIdPrefix="p" />,
      );
      const panel = screen.getByTestId(`p-${phase}`);
      expect(panel.getAttribute("role")).toBe("status");
      expect(panel.textContent).toContain("provider said: fixture");
      unmount();
    }
  });

  it("requires-auth offers the connect action ONLY when a handler is wired", () => {
    const onConnect = vi.fn();
    const first = render(<MediaPhasePanel phase="requires-auth" onConnect={onConnect} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(onConnect).toHaveBeenCalledOnce();
    first.unmount();

    render(<MediaPhasePanel phase="requires-auth" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("unavailable offers retry ONLY when a handler is wired", () => {
    render(<MediaPhasePanel phase="unavailable" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the loading phase renders quiet skeleton tiles — never fake rows", () => {
    render(<MediaPhasePanel phase="loading" skeletonCount={4} />);
    const panel = screen.getByTestId("media-phase-loading");
    expect(panel.querySelectorAll('[aria-hidden="true"] > div, [aria-hidden="true"] div').length).toBeGreaterThan(0);
    expect(panel.querySelectorAll('[data-testid^="video-card-"]')).toHaveLength(0);
  });
});

describe("ViewNotProvided (the honest no-producer state)", () => {
  it("explains that no data source is wired — no spinner, no rows", () => {
    render(<ViewNotProvided surfaceLabel="Trending" testIdPrefix="trending" />);
    const panel = screen.getByTestId("trending-not-provided");
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.textContent).toContain("No data source is wired for this surface yet");
    expect(panel.querySelector("button")).toBeNull();
  });
});

describe("theme layout tokens (the geometry laws the chrome consumes)", () => {
  it("the agent panel min width is 320px (the no-overlap floor)", () => {
    expect(theme.layout.agentPanelMinWidth).toBe(320);
  });
  it("the sidebar collapses to the rail below the narrow viewport bound", () => {
    expect(theme.layout.sidebarRailWidth).toBeLessThan(theme.layout.sidebarWidth);
    expect(theme.layout.narrowViewportPx).toBe(1024);
  });
});
