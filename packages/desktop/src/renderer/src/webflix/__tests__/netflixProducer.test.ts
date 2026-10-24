/**
 * WFX-NETFLIX-SOURCE-1 — the NetflixPort producer battery (FIXTURE-ONLY:
 * every byte flows through the injected upstream seam — zero real network;
 * the fixture is the web app's own proven live Tudum capture, the same one
 * the connectors battery pins).
 *
 * Pinned here:
 * - the producer maps the connector catalog's DTOs onto the frozen contract
 *   views (rails, hero = the first weeklyRank-1 title, the provenance note);
 * - the honest-phase law: a dead upstream answers phase "unavailable" with
 *   its reason — never fabricated rows;
 * - the country view rides through to the catalog composition;
 * - the title detail: known id → sorted country ranks + same-pool neighbors;
 *   unknown id → the typed unavailable "not in the tracked catalog" view
 *   (title:null — never a placeholder); invalid id → typed unsupported;
 * - the upstream seam is injected at construction (the composition-root law).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  NetflixCatalogProducer,
  resetNetflixPoolCacheForTests,
} from "../netflixProducer.js";

// The renderer battery's documented invocation runs from the repo root
// (`vitest run --config packages/desktop/src/renderer/vitest.config.ts`),
// so the fixture resolves off the process cwd — import.meta.url is unstable
// under this config's module-id rewriting.
const FIXTURE_HTML = readFileSync(
  resolve(process.cwd(), "packages/connectors/tests/fixtures/netflix/top10-films.html"),
  "utf8",
);

const fixtureUpstream = async (): Promise<{ ok: boolean; text: () => Promise<string> }> => ({
  ok: true,
  text: async () => FIXTURE_HTML,
});

const failingUpstream = async (): Promise<never> => {
  throw new Error("upstream unreachable");
};

afterEach(() => {
  resetNetflixPoolCacheForTests();
});

describe("NetflixCatalogProducer — the hub view (netflixHome)", () => {
  it("maps the catalog DTOs onto the frozen view (rails + hero + provenance)", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixHome({ country: "Global" });
    expect(view.phase).toBe("ready");
    expect(view.country).toBe("Global");
    expect(view.rails.length).toBeGreaterThan(0);
    expect(view.rails.length).toBeLessThan(8);
    const filmsRail = view.rails.find((r) => r.key === "weekly-films");
    expect(filmsRail?.label).toBe("Top 10 Movies This Week");
    expect(filmsRail?.titles.length).toBe(10);
    // The hero is the first weeklyRank-1 title across the rails.
    expect(view.hero?.netflixId).toBe(81757047);
    expect(view.hero?.title).toBe("Animals");
    expect(view.hero?.watchUrl).toBe("https://www.netflix.com/watch/81757047");
    // The provenance note names the source (the source-label law).
    expect(view.sourceNote).toContain("Tudum");
    expect(view.sourceNote).toContain("hands off");
    expect(view.catalogSize).toBeGreaterThanOrEqual(10);
  });

  it("the country view rides through to the composition (the US re-rank)", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixHome({ country: "US" });
    expect(view.country).toBe("US");
    const filmsRail = view.rails.find((r) => r.key === "weekly-films");
    expect(filmsRail?.country).toBe("US");
    const usRanks = (filmsRail?.titles ?? []).map((t) => t.countryRanks);
    expect(usRanks.length).toBeGreaterThan(0);
  });

  it("a dead upstream answers the honest unavailable phase — never fake rows", async () => {
    const producer = new NetflixCatalogProducer({ upstream: failingUpstream });
    const view = await producer.netflixHome({});
    expect(view.phase).toBe("unavailable");
    expect(view.rails).toEqual([]);
    expect(view.hero).toBeNull();
    expect(view.detail).toContain("unreachable");
    expect(view.sourceNote).toContain("Tudum");
  });

  it("an empty country input defaults to the Global view", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixHome({ country: "" });
    expect(view.country).toBe("Global");
  });
});

describe("NetflixCatalogProducer — the title view (netflixTitle)", () => {
  it("a known id answers the full detail (sorted ranks + same-pool neighbors)", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixTitle({ netflixId: 81757047 });
    expect(view.phase).toBe("ready");
    expect(view.title?.title).toBe("Animals");
    expect(view.title?.weeklyHoursViewed).toBe(55_400_000);
    const ranks = view.countryRanks.map((c) => c.rank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]!);
    }
    expect(view.relatedTitles.length).toBe(9);
    for (const neighbor of view.relatedTitles) {
      expect(neighbor.netflixId).not.toBe(81757047);
    }
  });

  it("an unknown id answers the typed unavailable view with title:null (no placeholder)", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixTitle({ netflixId: 1 });
    expect(view.phase).toBe("unavailable");
    expect(view.title).toBeNull();
    expect(view.detail).toContain("not in the tracked Netflix catalog");
  });

  it("an invalid id answers the typed unsupported view", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    const view = await producer.netflixTitle({ netflixId: -5 });
    expect(view.phase).toBe("unsupported");
    expect(view.title).toBeNull();
    expect(view.detail).toContain("not a valid number");
  });

  it("a dead upstream answers the honest unavailable title view", async () => {
    const producer = new NetflixCatalogProducer({ upstream: failingUpstream });
    const view = await producer.netflixTitle({ netflixId: 81757047 });
    expect(view.phase).toBe("unavailable");
    expect(view.title).toBeNull();
    expect(view.detail).toContain("unreachable");
  });
});

describe("NetflixCatalogProducer — the seam injection law", () => {
  it("the constructor injects the upstream into the connector seam (the composition root owns it)", async () => {
    const producer = new NetflixCatalogProducer({ upstream: fixtureUpstream });
    // A SECOND construction would re-inject — the composition root builds
    // exactly ONE producer per host (documented); this pin just proves the
    // seam is live by serving through it.
    const view = await producer.netflixHome({});
    expect(view.phase).toBe("ready");
  });
});
