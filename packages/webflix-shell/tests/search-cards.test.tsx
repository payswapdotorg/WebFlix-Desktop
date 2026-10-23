// @vitest-environment jsdom
//
// SearchScreen card-results tests (WFX-UX-SHELL-1, deliverable 4). The
// jsdom docblock above is mandatory. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: the page data below is a tests/fixtures.ts
// literal shaped like the frozen §9 SearchPageData — never live data):
// - the results phase + SearchPageData renders the reference's card list:
//   the query echo, the budget note (verbatim), channel cards, the video
//   card grid, and cursor load-more paging;
// - the honest-phase vocabulary is PRESERVED: every legacy phase panel
//   (idle/loading/empty/requires-auth/rate-limited/unsupported/unavailable/
//   degraded/status-unknown) still renders its own testid + copy when no
//   pageData rides along;
// - the degraded phase + pageData keeps the degraded banner ABOVE the
//   cards — partial results never dress up as fully ready;
// - the youtube-link direct-play behavior contract (onSelectItem with the
//   canonical CatalogItem) is preserved as the fallback play path.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SearchScreen } from "../src/index";
import type { SearchState } from "../src/index";
import { fixtureSearchPageData, fixtureVideoCard } from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

const resultsState: SearchState = { phase: "results", query: "fixture query", items: [] };

describe("SearchScreen — the WFX card results (frozen §9 SearchPageData)", () => {
  it("renders the query echo, channel cards, video grid, and the load-more cursor", () => {
    render(
      <SearchScreen
        state={resultsState}
        pageData={fixtureSearchPageData()}
        onLoadMore={() => {}}
      />,
    );
    expect(screen.getByText("2 results for “fixture query”")).toBeTruthy();
    expect(screen.getByTestId("search-channels")).toBeTruthy();
    expect(screen.getByTestId("channel-card-chan-1")).toBeTruthy();
    expect(screen.getByTestId("search-videos")).toBeTruthy();
    expect(screen.getByTestId("video-card-yt-item-1")).toBeTruthy();
    expect(screen.getByTestId("search-load-more-button").hasAttribute("disabled")).toBe(false);
  });

  it("renders the producer's budget note verbatim", () => {
    render(<SearchScreen state={resultsState} pageData={fixtureSearchPageData()} />);
    expect(screen.getByTestId("search-budget-note").textContent).toBe(
      "FIXTURE budget note: 87 of 100 quota units left today.",
    );
  });

  it("video card activation fires onPlayCard with the card (the shared play path)", () => {
    const onPlayCard = vi.fn();
    render(
      <SearchScreen state={resultsState} pageData={fixtureSearchPageData()} onPlayCard={onPlayCard} />,
    );
    fireEvent.click(screen.getByTestId("video-card-yt-item-1-play"));
    expect(onPlayCard).toHaveBeenCalledWith(fixtureVideoCard());
  });

  it("channel card activation fires onOpenChannel with the channel facts", () => {
    const onOpenChannel = vi.fn();
    render(
      <SearchScreen
        state={resultsState}
        pageData={fixtureSearchPageData()}
        onOpenChannel={onOpenChannel}
      />,
    );
    fireEvent.click(screen.getByTestId("channel-card-chan-1"));
    expect(onOpenChannel).toHaveBeenCalledWith({ channelId: "chan-1", handle: "@fixturechannel" });
  });

  it("load-more reports the page's cursor; the in-flight fact disables + relabels", () => {
    const onLoadMore = vi.fn();
    const first = render(
      <SearchScreen state={resultsState} pageData={fixtureSearchPageData()} onLoadMore={onLoadMore} />,
    );
    fireEvent.click(screen.getByTestId("search-load-more-button"));
    expect(onLoadMore).toHaveBeenCalledWith("search-cursor-2");
    first.unmount();

    render(
      <SearchScreen
        state={resultsState}
        pageData={fixtureSearchPageData()}
        onLoadMore={onLoadMore}
        loadingMore
      />,
    );
    const button = screen.getByTestId("search-load-more-button");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toBe("Loading more…");
  });

  it("a channels-only page says so honestly instead of an empty videos grid", () => {
    render(
      <SearchScreen
        state={resultsState}
        pageData={fixtureSearchPageData({ videos: [], nextCursor: null })}
      />,
    );
    expect(screen.getByText("1 result for “fixture query”")).toBeTruthy();
    expect(
      screen.getByText("No video results — the channels above are everything this search returned."),
    ).toBeTruthy();
    expect(screen.getByTestId("search-load-more-button").hasAttribute("disabled")).toBe(true);
  });

  it("the legacy onSelectItem path still plays the canonical CatalogItem when no card handler is wired", () => {
    const onSelectItem = vi.fn();
    render(
      <SearchScreen
        state={resultsState}
        pageData={fixtureSearchPageData()}
        onSelectItem={onSelectItem}
      />,
    );
    fireEvent.click(screen.getByTestId("video-card-yt-item-1-play"));
    expect(onSelectItem).toHaveBeenCalledWith(fixtureVideoCard().item);
  });
});

describe("SearchScreen — the degraded phase with card results (never dressed up as ready)", () => {
  it("keeps the honest degraded banner ABOVE the cards", () => {
    const degradedState: SearchState = {
      phase: "degraded",
      query: "fixture query",
      items: [],
      detail: "one fixture source failed",
    };
    render(<SearchScreen state={degradedState} pageData={fixtureSearchPageData()} />);
    const panel = screen.getByTestId("search-degraded");
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.textContent).toContain("Degraded");
    expect(panel.textContent).toContain("one fixture source failed");
    expect(screen.getByTestId("video-card-yt-item-1")).toBeTruthy();
  });
});

describe("SearchScreen — the honest-phase vocabulary is preserved (no pageData)", () => {
  it.each([
    ["idle", "search-idle"],
    ["loading", "search-loading"],
    ["empty", "search-empty"],
    ["requires-auth", "search-requires-auth"],
    ["rate-limited", "search-rate-limited"],
    ["unsupported", "search-unsupported"],
    ["unavailable", "search-unavailable"],
    ["status-unknown", "search-status-unknown"],
  ] as const)("the %s phase renders its own panel", (phase, testid) => {
    const state = { phase, query: "fixture query" } as SearchState;
    render(<SearchScreen state={state} />);
    const panel = screen.getByTestId(testid);
    expect(panel.getAttribute("role")).toBe("status");
  });

  it("requires-auth offers the connect control for the failing provider", () => {
    const onConnect = vi.fn();
    render(
      <SearchScreen
        state={{ phase: "requires-auth", query: "fixture query", providerId: "youtube" }}
        onConnect={onConnect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(onConnect).toHaveBeenCalledWith("youtube");
  });
});

describe("SearchScreen — the global-search prefill path", () => {
  it("initialQuery prefills the input (the route param the shell passes)", () => {
    render(<SearchScreen state={{ phase: "idle" }} initialQuery="prefilled query" />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    expect(input.value).toBe("prefilled query");
  });

  it("submit reports the trimmed query", () => {
    const onSubmit = vi.fn();
    render(<SearchScreen state={{ phase: "idle" }} onSubmit={onSubmit} initialQuery="  padded  " />);
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith("padded");
  });
});
