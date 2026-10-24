/**
 * WFX-NETFLIX-SOURCE-1 — the Tudum reader battery (fixture-only, hermetic:
 * every byte flows through the injected upstream seam — zero real network).
 *
 * The fixture (tests/fixtures/netflix/top10-films.html) is the web app's own
 * proven live capture of https://www.netflix.com/tudum/top10/ (the same
 * fixture its P42 battery pins), re-verified live from this sandbox's egress
 * on 2026-10-24 (curl → 200 + the graphql cache marker).
 *
 * Direct module imports (../src/netflix/*) mirror the streaming suite's
 * deliberate hermetic convention.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  ALL_POOL_KEYS,
  POOLS,
  extractGraphqlCache,
  getTop10Pool,
  parseTop10Page,
  resetTop10PoolCache,
} from "../src/netflix/top10";
import { netflixWatchUrl, netflixTitleUrl } from "../src/netflix/deeplink";
import {
  isNetflixInjectedUpstream,
  netflixUpstreamFetch,
  setNetflixUpstream,
  type NetflixUpstreamFetch,
} from "../src/netflix/upstream";
import {
  RAIL_COUNTRIES,
  getNetflixHome,
  getNetflixTitlePage,
  unionCatalog,
} from "../src/netflix/catalog";
import type { NetflixTitleDTO } from "../src/netflix/types";

const FIXTURE_HTML = readFileSync(
  new URL("./fixtures/netflix/top10-films.html", import.meta.url),
  "utf8",
);

/** An upstream that serves the fixture for every pool URL (counted). */
function fixtureUpstream(counter?: { calls: number }): NetflixUpstreamFetch {
  return async () => {
    if (counter !== undefined) counter.calls++;
    return { ok: true, text: async () => FIXTURE_HTML };
  };
}

/** The honest failure shape (bridge answered not-ok / threw). */
const failingUpstream: NetflixUpstreamFetch = async () => {
  throw new Error("upstream unreachable");
};

afterEach(() => {
  setNetflixUpstream(null);
  resetTop10PoolCache();
});

describe("netflix deeplink — ADR 0002 §1 (the ONLY netflix.com URL builders)", () => {
  it("builds the official per-title deep links", () => {
    expect(netflixWatchUrl(81757047)).toBe("https://www.netflix.com/watch/81757047");
    expect(netflixTitleUrl(81757047)).toBe("https://www.netflix.com/title/81757047");
  });
});

describe("netflix upstream — the injectable transport seam", () => {
  it("defaults to the global fetch until an implementation is injected", () => {
    expect(isNetflixInjectedUpstream()).toBe(false);
    expect(netflixUpstreamFetch()).toBeTypeOf("function");
  });

  it("serves the injected implementation and clears back to the default", () => {
    const fake = fixtureUpstream();
    setNetflixUpstream(fake);
    expect(isNetflixInjectedUpstream()).toBe(true);
    expect(netflixUpstreamFetch()).toBe(fake);
    setNetflixUpstream(null);
    expect(isNetflixInjectedUpstream()).toBe(false);
    expect(netflixUpstreamFetch()).not.toBe(fake);
  });
});

describe("netflix top10 — the SSR-cache parser (the web app's proven fixture)", () => {
  it("extracts the embedded GraphQL cache behind the marker", () => {
    const cache = extractGraphqlCache(FIXTURE_HTML);
    expect(cache).not.toBeNull();
    const entities = Object.keys(cache?.data ?? {}).filter((k) =>
      k.startsWith("PulseTop10ItemEntity:"),
    );
    // The page carries the Global pool AND geo copies — 20 entities dedupe
    // to the 10 ranked titles.
    expect(entities.length).toBe(20);
  });

  it("answers null honestly for a walled/changed page (no marker, no literal)", () => {
    expect(extractGraphqlCache("<html>walled</html>")).toBeNull();
    expect(extractGraphqlCache("netflix.reactContext.models.graphql but no JSON.parse('")).toBeNull();
    expect(parseTop10Page("<html>walled</html>", "weekly-films")).toBeNull();
  });

  it("parses the weekly-films pool to the 10 ranked titles, best-first", () => {
    const parsed = parseTop10Page(FIXTURE_HTML, "weekly-films");
    expect(parsed).not.toBeNull();
    expect(parsed?.titles.length).toBe(10);
    expect(parsed?.weekEndDate).toBe("2026-10-18");
    const ranks = parsed?.titles.map((t) => t.weeklyRank) ?? [];
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // The geo copies merged field-wise: rank #1 carries the richer 93-country map.
    const hero = parsed?.titles[0];
    expect(hero?.netflixId).toBe(81757047);
    expect(hero?.title).toBe("Animals");
    expect(hero?.kind).toBe("movie");
    expect(hero?.releaseYear).toBe(2026);
    expect(hero?.maturityRating).toBe("R");
    expect(Object.keys(hero?.countryRanks ?? {}).length).toBe(93);
    expect(hero?.countryRanks["US"]).toBe(1);
    expect(hero?.weeksInTop10).toBe(2);
    expect(hero?.posterUrl).toBeTruthy();
    expect(hero?.backdropUrl).toBeTruthy();
    expect(hero?.logoUrl).toBeTruthy();
    expect(hero?.deepLinkUrl).toBe("https://www.netflix.com/watch/81757047");
    expect(hero?.titlePageUrl).toBe("https://www.netflix.com/title/81757047");
  });

  it("the category gate keeps neighbor categories out (English films pool only)", () => {
    const parsed = parseTop10Page(FIXTURE_HTML, "weekly-films");
    // Every kept record is an English MOVIES weekly entry with a weekEndDate.
    for (const t of parsed?.titles ?? []) {
      expect(t.kind).toBe("movie");
      expect(t.weekEndDate).toBe("2026-10-18");
      expect(t.allTimeRank).toBeNull();
    }
    // The tv pool honestly parses nothing out of a films page.
    expect(parseTop10Page(FIXTURE_HTML, "weekly-tv")).toBeNull();
  });

  it("the pool matrix is the bounded 8 (the ADR §2 URL law)", () => {
    expect(ALL_POOL_KEYS.length).toBe(8);
    for (const key of ALL_POOL_KEYS) {
      expect(POOLS[key].path.startsWith("/tudum/top10")).toBe(true);
    }
    expect(POOLS["alltime-films"].path).toBe("/tudum/top10/most-popular");
    expect(POOLS["weekly-tv"].label).toBe("Top 10 Shows This Week");
  });
});

describe("netflix top10 — the in-memory resilient pool cache", () => {
  it("fetches once per pool and serves the soft-TTL cache afterwards", async () => {
    const counter = { calls: 0 };
    setNetflixUpstream(fixtureUpstream(counter));
    const first = await getTop10Pool("weekly-films");
    expect(first?.titles.length).toBe(10);
    const second = await getTop10Pool("weekly-films");
    expect(second).toBe(first);
    // ONE upstream transport round-trip: the second read was cache-served.
    expect(counter.calls).toBe(1);
  });

  it("falls back to the last good parse when the upstream goes dark (hard window)", async () => {
    setNetflixUpstream(fixtureUpstream());
    const good = await getTop10Pool("weekly-films");
    expect(good?.titles.length).toBe(10);
    setNetflixUpstream(failingUpstream);
    const fallback = await getTop10Pool("weekly-films");
    expect(fallback).toEqual(good);
  });

  it("answers null honestly on a cold cache with a dead upstream", async () => {
    setNetflixUpstream(failingUpstream);
    expect(await getTop10Pool("weekly-films")).toBeNull();
  });

  it("never caches a poisoned (empty) parse as good", async () => {
    setNetflixUpstream(fixtureUpstream());
    expect((await getTop10Pool("weekly-films"))?.titles.length).toBe(10);
    setNetflixUpstream(async () => ({ ok: true, text: async () => "<html>walled</html>" }));
    // The walled page parses to nothing — the last good parse still serves.
    const fallback = await getTop10Pool("weekly-films");
    expect(fallback?.titles.length).toBe(10);
    // And a cold cache with the walled page answers null (never the poison).
    resetTop10PoolCache();
    setNetflixUpstream(async () => ({ ok: true, text: async () => "<html>walled</html>" }));
    expect(await getTop10Pool("weekly-films")).toBeNull();
  });
});

describe("netflix catalog — the hub composition (the honest ladder)", () => {
  it("composes the hub from every pool that answers (partial hub beats dead hub)", async () => {
    setNetflixUpstream(fixtureUpstream());
    const home = await getNetflixHome("Global");
    // The films fixture answers for the films pools; the tv pools drop out.
    expect(home.unavailable).toBe(false);
    expect(home.rails.length).toBeGreaterThan(0);
    expect(home.rails.length).toBeLessThan(8);
    const filmsRail = home.rails.find((r) => r.key === "weekly-films");
    expect(filmsRail?.label).toBe("Top 10 Movies This Week");
    expect(filmsRail?.country).toBe("Global");
    expect(filmsRail?.titles.length).toBe(10);
    expect(home.source).toBe("netflix-top10");
    expect(home.catalogSize).toBeGreaterThanOrEqual(10);
    expect(home.unavailableReason).toBeNull();
  });

  it("the US country view re-ranks by that country's countryRanks entry", async () => {
    setNetflixUpstream(fixtureUpstream());
    const home = await getNetflixHome("US");
    const filmsRail = home.rails.find((r) => r.key === "weekly-films");
    expect(filmsRail?.country).toBe("US");
    // Every US title carries a finite US rank, ascending.
    const usRanks = (filmsRail?.titles ?? []).map((t) => t.countryRanks["US"]);
    for (const rank of usRanks) expect(Number.isFinite(rank)).toBe(true);
    for (let i = 1; i < usRanks.length; i++) expect(usRanks[i]).toBeGreaterThanOrEqual(usRanks[i - 1]!);
  });

  it("the dead-upstream hub is honestly unavailable — never fake rows", async () => {
    setNetflixUpstream(failingUpstream);
    const home = await getNetflixHome("Global");
    expect(home.unavailable).toBe(true);
    expect(home.rails).toEqual([]);
    expect(home.source).toBe("last-good");
    expect(home.unavailableReason).toContain("unreachable");
  });

  it("the country set is Global + US (the hub's bounded views)", () => {
    expect([...RAIL_COUNTRIES]).toEqual(["Global", "US"]);
  });

  it("unionCatalog dedupes across pools by netflixId", () => {
    const titleA: NetflixTitleDTO = {
      netflixId: 1,
      title: "A",
      kind: "movie",
      synopsis: "",
      releaseYear: null,
      maturityRating: null,
      backdropUrl: null,
      posterUrl: null,
      logoUrl: null,
      weeklyRank: 1,
      allTimeRank: null,
      weeksInTop10: null,
      weeklyHoursViewed: null,
      weeklyViews: null,
      countryRanks: {},
      weekEndDate: null,
      pool: "weekly-films",
      isPlayable: true,
      deepLinkUrl: netflixWatchUrl(1),
      titlePageUrl: netflixTitleUrl(1),
    };
    const pools = new Map([
      ["weekly-films", { pool: "weekly-films" as const, titles: [titleA], weekEndDate: null }],
      ["alltime-films", { pool: "alltime-films" as const, titles: [{ ...titleA, weeklyRank: null, allTimeRank: 2 }], weekEndDate: null }],
    ]);
    const union = unionCatalog(pools);
    expect(union.length).toBe(1);
  });
});

describe("netflix catalog — the title page", () => {
  it("answers the known title with sorted country ranks + same-pool neighbors", async () => {
    setNetflixUpstream(fixtureUpstream());
    const result = await getNetflixTitlePage(81757047);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.page.title.title).toBe("Animals");
    expect(result.page.source).toBe("netflix-top10");
    // Country ranks best-first.
    const ranks = result.page.countryRanks.map((c) => c.rank);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]!);
    expect(ranks[0]).toBe(1);
    // Same-pool neighbors, never the title itself.
    expect(result.page.relatedTitles.length).toBe(9);
    for (const neighbor of result.page.relatedTitles) {
      expect(neighbor.netflixId).not.toBe(81757047);
    }
  });

  it("answers not-found for an id outside the tracked universe (no Prisma fallback in the desktop — documented)", async () => {
    setNetflixUpstream(fixtureUpstream());
    expect(await getNetflixTitlePage(1)).toEqual({ kind: "not-found" });
  });

  it("answers unavailable (never not-found) when every pool is dead", async () => {
    setNetflixUpstream(failingUpstream);
    expect(await getNetflixTitlePage(81757047)).toEqual({ kind: "unavailable" });
  });
});
