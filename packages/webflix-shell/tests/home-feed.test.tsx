// @vitest-environment jsdom
//
// HomeScreen media-feed tests (WFX-UX-SHELL-1, deliverable 3). The jsdom
// docblock above is mandatory. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: the feeds below are tests/fixtures.ts
// literals shaped like the frozen §9 HomeFeedView — never live data):
// - the ready feed renders the sections model IN ORDER (continue rail with
//   progress overlays, shorts shelf with 9:16 tiles, the growing grid), the
//   chip row, the composition note, and the cursor-paginated load-more;
// - appends render BELOW existing sections (the shell never scrolls — the
//   no-viewport-jump law is structural: append-only DOM, no scroll calls);
// - per-section honest states (the section-state union member) render their
//   own phase panel — a degraded section never blanks the whole feed;
// - the feed-level phases (loading / requires-auth / degraded-with-partial)
//   render the frozen honest copy, with connect ONLY when wired;
// - empty sections stay honestly empty — no invented rows;
// - the LEGACY surface (feed=null) still renders the pre-WFX home exactly.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HomeScreen } from "../src/index";
import type { CatalogItem, HomeFeedView } from "../src/index";
import {
  fixtureHomeFeedPhase,
  fixtureHomeFeedReady,
  fixtureHomeSections,
  fixtureVideoCard,
  progressFillWidth,
} from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

function renderFeed(feed: HomeFeedView, props: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  return render(<HomeScreen feed={feed} {...props} />);
}

describe("HomeScreen — the media-first feed (the frozen §9 HomeFeedView)", () => {
  it("renders the ready feed's sections IN ORDER with the chip row + composition note", () => {
    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()));
    const root = screen.getByTestId("home-feed-root");

    // Composition order: continue rail, shorts shelf, video grid.
    const sectionIds = Array.from(
      root.querySelectorAll('[data-testid^="home-section-"]'),
    ).map((el) => el.getAttribute("data-testid"));
    expect(sectionIds).toEqual([
      "home-section-continue-1",
      "home-section-shorts-1",
      "home-section-grid-1",
    ]);

    // Chips + selected chip + the composition note (source-labeled law).
    expect(screen.getAllByTestId(/^home-chips/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("home-chips").querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByTestId("home-composition-note").textContent).toContain(
      "FIXTURE: composed from trending + local history",
    );
  });

  it("the continue-watching rail renders the progress overlay + resume label on its cards", () => {
    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()));
    expect(
      progressFillWidth(screen.getByTestId("video-card-yt-continue-1-progress")),
    ).toBe("42%");
    expect(screen.getByText("Resume at 4:12")).toBeTruthy();
  });

  it("the shorts shelf renders 9:16 tiles with their own play action", () => {
    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()), { onPlayCard: () => {} });
    const tile = screen.getByTestId("shorts-tile-yt-short-1");
    expect(tile.style.aspectRatio).toBe("9 / 16");
    expect(tile.tagName).toBe("BUTTON");
  });

  it("shorts shelf tiles stay non-interactive previews when no play path is wired", () => {
    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()));
    expect(screen.getByTestId("shorts-tile-yt-short-1").tagName).toBe("DIV");
  });

  it("chip activation reports the chip (the producer's vocabulary, not a shell invention)", () => {
    const onChipSelect = vi.fn();
    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()), { onChipSelect });
    fireEvent.click(screen.getByTestId("category-chip-1"));
    expect(onChipSelect).toHaveBeenCalledWith("Music");
  });

  it("load-more reports the view's own cursor; the in-flight fact disables + relabels", () => {
    const onLoadMore = vi.fn();
    const first = renderFeed(fixtureHomeFeedReady(fixtureHomeSections()), { onLoadMore });
    fireEvent.click(screen.getByTestId("home-load-more-button"));
    expect(onLoadMore).toHaveBeenCalledWith("home-cursor-2");
    first.unmount();

    renderFeed(fixtureHomeFeedReady(fixtureHomeSections()), { onLoadMore, loadingMore: true });
    const button = screen.getByTestId("home-load-more-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toBe("Loading more…");
  });

  it("appends render BELOW existing sections: the DOM only grows (the no-jump law is structural)", () => {
    const before = fixtureHomeFeedReady(fixtureHomeSections(), {
      nextCursor: "cursor-2",
    });
    const after = fixtureHomeFeedReady(
      [
        ...fixtureHomeSections(),
        {
          kind: "video-grid",
          sectionId: "grid-2",
          title: "More",
          videos: [fixtureVideoCard({ item: { ...fixtureVideoCard().item, id: "yt-appended" }, title: "Appended fixture video" })],
          layout: "grid",
        },
      ],
      { nextCursor: null },
    );
    const { rerender } = render(<HomeScreen feed={before} />);
    const firstSection = screen.getByTestId("home-section-grid-1");
    rerender(<HomeScreen feed={after} />);
    // The existing section node is the SAME DOM node (append-only), and the
    // new section landed after it — the shell never scrolls.
    expect(screen.getByTestId("home-section-grid-1")).toBe(firstSection);
    expect(
      screen.getByTestId("home-section-grid-1").compareDocumentPosition(
        screen.getByTestId("home-section-grid-2"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Appended fixture video")).toBeTruthy();
  });

  it("an empty section stays honestly empty — nothing is invented to fill it", () => {
    renderFeed(
      fixtureHomeFeedReady([
        { kind: "shorts-shelf", sectionId: "s-empty", title: "Shorts", shorts: [] },
      ]),
    );
    expect(screen.getByTestId("home-section-s-empty").textContent).toContain(
      "No shorts in this shelf — nothing is invented to fill it.",
    );
  });

  it("a section-state section renders its own honest phase without blanking the feed", () => {
    renderFeed(
      fixtureHomeFeedReady([
        {
          kind: "section-state",
          sectionId: "s-rate",
          title: "Live now",
          phase: "rate-limited",
          detail: "provider quota hit (fixture)",
        },
        ...fixtureHomeSections(),
      ]),
    );
    expect(screen.getByTestId("home-section-s-rate-rate-limited").textContent).toContain(
      "provider quota hit (fixture)",
    );
    expect(screen.getByTestId("home-section-grid-1")).toBeTruthy();
  });
});

describe("HomeScreen — feed-level honest phases (the data-only states)", () => {
  it("loading renders the honest copy with skeleton tiles — never a fake feed", () => {
    renderFeed(fixtureHomeFeedPhase("loading"));
    expect(screen.getByTestId("home-feed-loading").getAttribute("role")).toBe("status");
    expect(screen.queryByTestId(/^home-section-/)).toBeNull();
  });

  it("requires-auth renders the connect action only when the shell wired one", () => {
    const onConnect = vi.fn();
    const first = renderFeed(fixtureHomeFeedPhase("requires-auth", { detail: "no Data API key (fixture)" }), { onConnect });
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(onConnect).toHaveBeenCalledOnce();
    first.unmount();

    renderFeed(fixtureHomeFeedPhase("requires-auth"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("degraded keeps its partial sections visible around the honest panel", () => {
    renderFeed(
      fixtureHomeFeedPhase("degraded", {
        detail: "one fixture source failed",
        sections: fixtureHomeSections(),
      }),
    );
    expect(screen.getByTestId("home-feed-degraded").textContent).toContain(
      "one fixture source failed",
    );
    expect(screen.getByTestId("home-section-grid-1")).toBeTruthy();
  });

  it("unavailable renders the retry action only when wired", () => {
    const onRetry = vi.fn();
    renderFeed(fixtureHomeFeedPhase("unavailable"), { onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("HomeScreen — the legacy surface (feed not provided) is retained verbatim", () => {
  it("renders the pre-WFX accounts/recent summary when no producer is wired", () => {
    const recent: CatalogItem[] = [];
    render(
      <HomeScreen
        accounts={[]}
        recentItems={recent}
        onNavigate={() => {}}
        onPlay={() => {}}
      />,
    );
    expect(screen.getByText("Welcome to WebFlix")).toBeTruthy();
    expect(screen.getByTestId("home-accounts-empty")).toBeTruthy();
    expect(screen.queryByTestId("home-feed-root")).toBeNull();
  });
});
