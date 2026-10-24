// @vitest-environment jsdom
//
// WFX-NETFLIX-SOURCE-1 — the Netflix surface battery (FIXTURE-ONLY: every
// view below is a literal shaped like the frozen §9 Netflix view contracts —
// never live data). The jsdom docblock above is mandatory.
//
// WFX-NETFLIX-P45-LOOK-1 — the pins re-frozen to the P45 hub (the operator's
// look ruling supersedes the P42 header idiom, exactly like WFX-WEB-LOOK-1
// re-froze the shell pins): the billboard IS the landing (no header box) —
// the N FILM/SERIES kicker, the TOP #N badge line, the white Play + More
// Info + My List + hand-off circle, the vertical dots; the sticky sub-nav
// (All/Movies/TV Shows kind tabs + the country chips); the My List rail
// (session-scoped, honest note); the Top-10 silhouette rows (portrait art +
// the giant outlined numerals + the TOP 10 tag); the hover sheets' Play and
// My List circles. The title surface gains its My List button.
//
// Pins, honestly:
// - the hub renders its honest not-provided panel when the host wired no
//   producer (null view) — no spinner, no rows, no invented content;
// - the unavailable phase renders the frozen honest copy + the retry control;
// - the ready hub renders the web app's own P45 idioms (above) + the
//   provenance source note;
// - the kind tabs filter the rails AND the billboard (client-side, exactly
//   like the web app);
// - the country chips + card clicks + Play/Info/My List circles all REPORT
//   through their callbacks;
// - the My List rail renders from the host's session-scoped list, and the
//   + circles / billboard button / title button report toggles;
// - the title detail keeps its P42-era pins (hero/meta/synopsis/country-rank
//   pills + "More like this" neighbors + back-navigation + the honest
//   null-title phase panel) and gains the My List button;
// - the play hand-off dialog: opens from the hero Play + the title Play +
//   the cards' Play circles, states the DRM policy + the exact destination
//   URL, and its primary action reports the EXTERNAL open to the host
//   (never navigates itself).

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

const SERIES_CARD: NetflixTitleCard = {
  ...TITLE_CARD,
  netflixId: 82199999,
  title: "The Agency",
  kind: "series",
  weeklyRank: 1,
  weeklyHoursViewed: 9_800_000,
  watchUrl: "https://www.netflix.com/watch/82199999",
  titlePageUrl: "https://www.netflix.com/title/82199999",
};

const ALLTIME_CARD: NetflixTitleCard = {
  ...TITLE_CARD,
  netflixId: 82300001,
  title: "Carry-On",
  weeklyRank: null,
  allTimeRank: 7,
  weekEndDate: null,
  watchUrl: "https://www.netflix.com/watch/82300001",
  titlePageUrl: "https://www.netflix.com/title/82300001",
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
    {
      key: "weekly-tv",
      label: "Top 10 TV Shows This Week",
      ranking: "weekly",
      country: "Global",
      weekEndDate: "2026-10-18",
      titles: [SERIES_CARD],
    },
    {
      key: "alltime-films",
      label: "Most Popular Films",
      ranking: "alltime",
      country: "Global",
      weekEndDate: null,
      titles: [ALLTIME_CARD],
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

  it("renders the ready P45 hub: billboard landing, sub-nav, rails, source note", () => {
    render(<NetflixScreen view={READY_HOME} />);
    expect(screen.getByTestId("netflix-root")).toBeTruthy();
    // The sr-only heading (the billboard is the landing — no header box).
    expect(screen.getByTestId("netflix-hub-heading").textContent).toBe("Netflix on WebFlix");
    // The billboard: the N FILM kicker, the TOP badge line, Play + More Info.
    const hero = screen.getByTestId("netflix-hero");
    expect(hero.textContent).toContain("N");
    expect(screen.getByTestId("netflix-billboard-kicker").textContent).toContain("FILM");
    expect(screen.getByText("#1 in Movies Today")).toBeTruthy();
    expect(screen.getByText("TOP")).toBeTruthy();
    expect(screen.getByTestId("netflix-hero-play").textContent).toContain("Play");
    expect(screen.getByTestId("netflix-hero-info").textContent).toContain("More Info");
    expect(screen.getByTestId("netflix-hero-handoff")).toBeTruthy();
    // The vertical dots (one per billboard slide — 3 weekly titles here).
    expect(screen.getByTestId("netflix-billboard-dots").querySelectorAll("button").length).toBe(3);
    // The sticky sub-nav: 3 kind tabs + the two bounded country views.
    expect(screen.getByTestId("netflix-kind-tabs").querySelectorAll("button").length).toBe(3);
    const chips = screen.getByTestId("netflix-country-chips");
    expect(chips.querySelectorAll("button").length).toBe(2);
    // The rails: the weekly rows carry the TOP 10 tag + the giant position
    // numerals (one per row — scoped); the all-time row stays 16:9.
    const rail = screen.getByTestId("netflix-rail-weekly-films");
    expect(rail.textContent).toContain("Top 10 Movies This Week");
    expect(rail.textContent).toContain("TOP 10");
    expect(rail.textContent).toContain("week of 2026-10-18");
    expect(screen.getByTestId("netflix-card-81757047")).toBeTruthy();
    expect(screen.getByTestId("netflix-card-82023496")).toBeTruthy();
    expect(within(rail).getByText("1")).toBeTruthy();
    expect(within(rail).getByText("2")).toBeTruthy();
    expect(within(screen.getByTestId("netflix-rail-weekly-tv")).getByText("1")).toBeTruthy();
    const alltimeRail = screen.getByTestId("netflix-rail-alltime-films");
    expect(alltimeRail.textContent).not.toContain("TOP 10");
    // The provenance note.
    expect(screen.getByTestId("netflix-source-note").textContent).toContain("Tudum");
  });

  it("the kind tabs filter the rails AND the billboard (client-side, like the web app)", () => {
    render(<NetflixScreen view={READY_HOME} />);
    const tabs = screen.getByTestId("netflix-kind-tabs").querySelectorAll("button");
    // TV Shows: only the weekly-tv rail + the series billboard.
    fireEvent.click(tabs[2]!);
    expect(screen.queryByTestId("netflix-rail-weekly-films")).toBeNull();
    expect(screen.getByTestId("netflix-rail-weekly-tv")).toBeTruthy();
    expect(screen.getByTestId("netflix-billboard-kicker").textContent).toContain("SERIES");
    expect(screen.getByText("#1 in TV Shows Today")).toBeTruthy();
    // Movies: the films rails + the movie billboard.
    fireEvent.click(tabs[1]!);
    expect(screen.getByTestId("netflix-rail-weekly-films")).toBeTruthy();
    expect(screen.queryByTestId("netflix-rail-weekly-tv")).toBeNull();
    expect(screen.getByText("#1 in Movies Today")).toBeTruthy();
    // All: everything.
    fireEvent.click(tabs[0]!);
    expect(screen.getByTestId("netflix-rail-weekly-films")).toBeTruthy();
    expect(screen.getByTestId("netflix-rail-weekly-tv")).toBeTruthy();
  });

  it("the country chips report (Global → US) with the pressed state", () => {
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

  it("the billboard More Info reports the title id (the host routes to the detail)", () => {
    const onOpenTitle = vi.fn();
    render(<NetflixScreen view={READY_HOME} onOpenTitle={onOpenTitle} />);
    fireEvent.click(screen.getByTestId("netflix-hero-info"));
    expect(onOpenTitle).toHaveBeenCalledWith(81757047);
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

  it("a card's Play circle opens the hand-off for THAT title", () => {
    render(<NetflixScreen view={READY_HOME} />);
    fireEvent.click(within(screen.getByTestId("netflix-card-82023496")).getByTestId("netflix-card-play"));
    const dialog = screen.getByTestId("netflix-handoff-dialog");
    expect(dialog.textContent).toContain("https://www.netflix.com/watch/82023496");
  });

  it("the My List: the + circle reports the toggle; the rail renders the host's list with the honest scope note", () => {
    const onToggleMyList = vi.fn();
    const { rerender } = render(
      <NetflixScreen view={READY_HOME} myList={[]} onToggleMyList={onToggleMyList} />,
    );
    // Empty list — no rail, and the + circle reports the card's title.
    expect(screen.queryByTestId("netflix-my-list-rail")).toBeNull();
    fireEvent.click(within(screen.getByTestId("netflix-card-82023496")).getByTestId("netflix-card-add"));
    expect(onToggleMyList).toHaveBeenCalledWith(NEIGHBOR);
    // The billboard's own My List button reports the current slide.
    fireEvent.click(screen.getByTestId("netflix-my-list-toggle"));
    expect(onToggleMyList).toHaveBeenCalledWith(TITLE_CARD);
    // A non-empty host list renders the rail (the honest session note).
    rerender(<NetflixScreen view={READY_HOME} myList={[TITLE_CARD]} onToggleMyList={onToggleMyList} />);
    const rail = screen.getByTestId("netflix-my-list-rail");
    expect(rail.textContent).toContain("My List");
    expect(rail.textContent).toContain("this session");
    expect(within(rail).getByTestId("netflix-card-81757047")).toBeTruthy();
    // The saved card's + circle shows the checked state.
    expect(
      within(within(rail).getByTestId("netflix-card-81757047")).getByTestId("netflix-card-add").getAttribute("aria-pressed"),
    ).toBe("true");
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

  it("the title's My List button reflects the host list and reports the toggle", () => {
    const onToggleMyList = vi.fn();
    const { rerender } = render(
      <NetflixTitleScreen view={READY_TITLE} myList={[]} onToggleMyList={onToggleMyList} />,
    );
    const toggle = screen.getByTestId("netflix-my-list-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toContain("My List");
    fireEvent.click(toggle);
    expect(onToggleMyList).toHaveBeenCalledWith(TITLE_CARD);
    // Saved state: the checked label.
    rerender(
      <NetflixTitleScreen view={READY_TITLE} myList={[TITLE_CARD]} onToggleMyList={onToggleMyList} />,
    );
    const saved = screen.getByTestId("netflix-my-list-toggle");
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    expect(saved.textContent).toContain("In My List");
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
