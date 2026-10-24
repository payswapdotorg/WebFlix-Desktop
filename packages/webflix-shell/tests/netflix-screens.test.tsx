// @vitest-environment jsdom
//
// WFX-NETFLIX-SOURCE-1 — the Netflix surface battery (FIXTURE-ONLY: every
// view below is a literal shaped like the frozen §9 Netflix view contracts —
// never live data). The jsdom docblock above is mandatory.
//
// Pins, honestly:
// - the hub renders its honest not-provided panel when the host wired no
//   producer (null view) — no spinner, no rows, no invented content;
// - the unavailable phase renders the frozen honest copy + the retry control;
// - the ready hub renders the web app's own idioms: the red N brand chip,
//   the country chips (inverted active), the hero (Top-1 badge + Play), the
//   rails with their rank numerals, the provenance source note;
// - the country chips + card clicks REPORT through their callbacks;
// - the title detail renders the hero/meta/synopsis/country-rank pills +
//   "More like this" neighbors, reports back-navigation, and carries the
//   honest null-title phase panel on non-ready views;
// - the play hand-off dialog: opens from the hero Play + the title Play,
//   states the DRM policy + the exact destination URL, and its primary
//   action reports the EXTERNAL open to the host (never navigates itself).

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { NetflixScreen, NetflixTitleScreen } from "../src/index";
import type { NetflixHomeView, NetflixTitleCard, NetflixTitleView } from "webflix-contracts";

afterEach(cleanup);

const TITLE_CARD: NetflixTitleCard = {
  netflixId: 81757047,
  title: "Animals",
  kind: "movie",
  synopsis: "When their son is kidnapped, an LA mayoral candidate and his wife scramble to ransom him.",
  releaseYear: 2026,
  maturityRating: "R",
  backdropUrl: "https://occ-0-2794-2219.1.nflxso.net/dnm/api/v6/storyArt.webp",
  posterUrl: "https://occ-0-2794-2219.1.nflxso.net/dnm/api/v6/sdpArt.webp",
  logoUrl: null,
  weeklyRank: 1,
  allTimeRank: null,
  weeksInTop10: 2,
  weeklyHoursViewed: 55_400_000,
  weekEndDate: "2026-10-18",
  watchUrl: "https://www.netflix.com/watch/81757047",
  titlePageUrl: "https://www.netflix.com/title/81757047",
};

const NEIGHBOR: NetflixTitleCard = {
  ...TITLE_CARD,
  netflixId: 82023496,
  title: "Doing Life",
  weeklyRank: 2,
  weeklyHoursViewed: 13_100_000,
  watchUrl: "https://www.netflix.com/watch/82023496",
  titlePageUrl: "https://www.netflix.com/title/82023496",
};

const READY_HOME: NetflixHomeView = {
  country: "Global",
  rails: [
    {
      key: "weekly-films",
      label: "Top 10 Movies This Week",
      ranking: "weekly",
      country: "Global",
      weekEndDate: "2026-10-18",
      titles: [TITLE_CARD, NEIGHBOR],
    },
  ],
  hero: TITLE_CARD,
  catalogSize: 57,
  sourceNote: "Data: Netflix's own public Top 10 & Most Popular (Tudum)",
  phase: "ready",
};

const READY_TITLE: NetflixTitleView = {
  title: TITLE_CARD,
  countryRanks: [
    { countryId: "US", rank: 1 },
    { countryId: "GB", rank: 2 },
  ],
  relatedTitles: [NEIGHBOR],
  phase: "ready",
};

describe("NetflixScreen — the hub surface", () => {
  it("renders the honest not-provided panel when the host wired no producer", () => {
    render(<NetflixScreen view={null} />);
    expect(screen.getByTestId("netflix-not-provided")).toBeTruthy();
    expect(screen.queryByTestId("netflix-hero")).toBeNull();
  });

  it("renders the honest unavailable phase with its reason + retry", () => {
    const onRetry = vi.fn();
    render(
      <NetflixScreen
        view={{ ...READY_HOME, rails: [], hero: null, phase: "unavailable", detail: "Netflix's Top 10 data is unreachable from this egress right now." }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId("netflix-unavailable")).toBeTruthy();
    expect(screen.getByTestId("netflix-unavailable").textContent).toContain("unreachable");
    // The phase panel's single recovery control (the frozen "Retry" label).
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the ready hub: brand chip, country chips, hero, rails, source note", () => {
    render(<NetflixScreen view={READY_HOME} />);
    expect(screen.getByTestId("netflix-root")).toBeTruthy();
    expect(screen.getByText("Netflix on WebFlix")).toBeTruthy();
    // The red N brand chip + the two bounded country views.
    expect(screen.getByText("N")).toBeTruthy();
    const chips = screen.getByTestId("netflix-country-chips");
    expect(chips.querySelectorAll("button").length).toBe(2);
    // The hero with its Top-1 badge + the provenance note.
    expect(screen.getByTestId("netflix-hero")).toBeTruthy();
    expect(screen.getByTestId("netflix-hero-play")).toBeTruthy();
    expect(screen.getByText("Top 1")).toBeTruthy();
    expect(screen.getByTestId("netflix-source-note").textContent).toContain("Tudum");
    // The rail with its rank numerals riding the cards.
    const rail = screen.getByTestId("netflix-rail-weekly-films");
    expect(rail.textContent).toContain("Top 10 Movies This Week");
    expect(rail.textContent).toContain("week of 2026-10-18");
    expect(screen.getByTestId("netflix-card-81757047")).toBeTruthy();
    expect(screen.getByTestId("netflix-card-82023496")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("the country chips report (Global → US) with the inverted active state", () => {
    const onSelectCountry = vi.fn();
    render(<NetflixScreen view={READY_HOME} onSelectCountry={onSelectCountry} />);
    const usChip = screen.getByTestId("netflix-country-chips").querySelectorAll("button")[1]!;
    expect(usChip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(usChip);
    expect(onSelectCountry).toHaveBeenCalledWith("US");
  });

  it("a card click reports the title id (the host routes to the detail)", () => {
    const onOpenTitle = vi.fn();
    render(<NetflixScreen view={READY_HOME} onOpenTitle={onOpenTitle} />);
    fireEvent.click(screen.getByTestId("netflix-card-82023496"));
    expect(onOpenTitle).toHaveBeenCalledWith(82023496);
  });

  it("the hero Play opens the hand-off dialog; the primary action reports the EXTERNAL open", () => {
    const onOpenExternal = vi.fn();
    render(<NetflixScreen view={READY_HOME} onOpenExternal={onOpenExternal} />);
    fireEvent.click(screen.getByTestId("netflix-hero-play"));
    const dialog = screen.getByTestId("netflix-handoff-dialog");
    expect(dialog.textContent).toContain("Ready to play on Netflix");
    expect(dialog.textContent).toContain("https://www.netflix.com/watch/81757047");
    expect(dialog.textContent).toContain("never touches Netflix");
    fireEvent.click(screen.getByTestId("netflix-handoff-link"));
    expect(onOpenExternal).toHaveBeenCalledWith("https://www.netflix.com/watch/81757047");
  });
});

describe("NetflixTitleScreen — the title detail surface", () => {
  it("renders the honest not-provided panel when the host wired no producer", () => {
    render(<NetflixTitleScreen view={null} />);
    expect(screen.getByTestId("netflix-title-not-provided")).toBeTruthy();
  });

  it("renders the honest unavailable phase (null title — never a placeholder card)", () => {
    render(
      <NetflixTitleScreen
        view={{ title: null, countryRanks: [], relatedTitles: [], phase: "unavailable", detail: "Title not in the tracked Netflix catalog." }}
      />,
    );
    expect(screen.getByTestId("netflix-title-unavailable")).toBeTruthy();
    expect(screen.getByTestId("netflix-title-unavailable").textContent).toContain("tracked Netflix catalog");
    expect(screen.queryByTestId("netflix-title-hero")).toBeNull();
  });

  it("renders the ready title: hero, meta bits, country ranks, more-like-this", () => {
    const onBack = vi.fn();
    const onOpenTitle = vi.fn();
    render(
      <NetflixTitleScreen view={READY_TITLE} onBack={onBack} onOpenTitle={onOpenTitle} />,
    );
    const hero = screen.getByTestId("netflix-title-hero");
    expect(hero.textContent).toContain("Animals");
    expect(hero.textContent).toContain("Film");
    expect(hero.textContent).toContain("2 weeks in the Top 10");
    expect(hero.textContent).toContain("55.4M hours viewed this week");
    expect(screen.getByTestId("netflix-title-play")).toBeTruthy();
    // Where it ranks: the best-first pills, the rank-1 pill carries the red best style.
    const ranks = screen.getByTestId("netflix-country-ranks");
    expect(ranks.textContent).toContain("US #1");
    expect(ranks.textContent).toContain("GB #2");
    // More like this: the same-pool neighbor, clickable to ITS detail.
    fireEvent.click(screen.getByTestId("netflix-card-82023496"));
    expect(onOpenTitle).toHaveBeenCalledWith(82023496);
    // Back to the hub reports.
    fireEvent.click(screen.getByTestId("netflix-title-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("the Play opens the hand-off dialog; the secondary action reports the title-page open", () => {
    const onOpenExternal = vi.fn();
    render(<NetflixTitleScreen view={READY_TITLE} onOpenExternal={onOpenExternal} />);
    fireEvent.click(screen.getByTestId("netflix-title-play"));
    expect(screen.getByTestId("netflix-handoff-dialog")).toBeTruthy();
    // The secondary anchor: the title page on netflix.com.
    const secondary = screen
      .getAllByRole("button")
      .find((b) => b.textContent === "Open the title page on netflix.com");
    expect(secondary).toBeTruthy();
    fireEvent.click(secondary!);
    expect(onOpenExternal).toHaveBeenCalledWith("https://www.netflix.com/title/81757047");
  });
});
