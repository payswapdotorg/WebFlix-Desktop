/**
 * WFX-NETFLIX-SOURCE-1 — the Netflix catalog composition layer, ported from
 * the web app's src/lib/netflix/catalog.ts (P42-NETFLIX-SOURCE).
 *
 * Builds the hub's rails from the 8 bounded pools and exposes per-title
 * reads. Every payload carries the provenance `source` field (ADR 0002 §3)
 * — never a fake row.
 *
 * DESKTOP DIFFERENCE (documented): the web app's Prisma mirror + per-viewer
 * My List + catalog-search index are NOT ported — the desktop has no
 * per-user viewer for the Netflix source. A title that fell off the Top 10
 * between refresh windows answers the honest not-found shape (the pool
 * cache IS the tracked universe this build knows).
 */

import { ALL_POOL_KEYS, POOLS, getTop10Pool, type ParsedPool } from "./top10";
import type {
  NetflixCountryRank,
  NetflixHomeDTO,
  NetflixPoolKey,
  NetflixRailDTO,
  NetflixSource,
  NetflixTitleDTO,
  NetflixTitlePageDTO,
} from "./types";

/** Countries the hub rails render by default (Global is always first). */
export const RAIL_COUNTRIES = ["Global", "US"] as const;

function poolSource(poolKey: NetflixPoolKey): NetflixSource {
  return POOLS[poolKey].ranking === "weekly" ? "netflix-top10" : "netflix-most-popular";
}

/**
 * One rail = one pool, ranked for a country. "Global" rides the pool's own
 * rank order; a country rail re-ranks by that country's countryRanks entry
 * (measured: ~93 countries ride along on the same fetch).
 */
function railForPool(
  poolKey: NetflixPoolKey,
  country: string,
  pool: ParsedPool | null,
): NetflixRailDTO | null {
  if (!pool || pool.titles.length === 0) return null;
  let titles = pool.titles;
  if (country !== "Global") {
    titles = pool.titles
      .filter((t) => typeof t.countryRanks[country] === "number")
      .sort((a, b) => a.countryRanks[country] - b.countryRanks[country]);
  }
  if (titles.length === 0) return null;
  return {
    key: poolKey,
    label: POOLS[poolKey].label,
    kind: POOLS[poolKey].kind,
    country,
    ranking: POOLS[poolKey].ranking,
    weekEndDate: pool.weekEndDate,
    titles: titles.slice(0, 10),
    source: poolSource(poolKey),
  };
}

/**
 * The hub composition: every pool answers through the pool cache; pools that
 * fail drop out honestly (a partial hub beats a dead hub — the same ladder
 * logic the home feed runs).
 */
export async function getNetflixHome(country: string = "Global"): Promise<NetflixHomeDTO> {
  const settled = await Promise.all(
    ALL_POOL_KEYS.map(async (key) => ({ key, pool: await getTop10Pool(key) })),
  );
  const byKey = new Map(settled.map((s) => [s.key, s.pool]));
  const rails: NetflixRailDTO[] = [];
  for (const key of ALL_POOL_KEYS) {
    const rail = railForPool(key, country, byKey.get(key) ?? null);
    if (rail) rails.push(rail);
  }
  const catalog = unionCatalog(byKey);
  const okRails = rails.length > 0;
  return {
    rails,
    catalogSize: catalog.length,
    source: okRails ? poolSource(rails[0].key) : "last-good",
    unavailable: !okRails,
    unavailableReason: okRails
      ? null
      : "Netflix's Top 10 data is unreachable from this egress right now — the hub stays empty rather than showing fake rows.",
    fetchedAt: new Date().toISOString(),
  };
}

/** The deduped union of every pool's titles (the browsable catalog). */
export function unionCatalog(
  byKey?: Map<NetflixPoolKey, ParsedPool | null>,
): NetflixTitleDTO[] {
  const pools =
    byKey ??
    new Map(
      ALL_POOL_KEYS.map((k) => [k, null as ParsedPool | null] as const),
    );
  const byId = new Map<number, NetflixTitleDTO>();
  for (const pool of pools.values()) {
    for (const t of pool?.titles ?? []) {
      byId.set(t.netflixId, t); // pool parses already dedupe + merge field-wise
    }
  }
  return [...byId.values()];
}

/** The title-page outcome: a page, an honest not-in-universe, or a dead upstream. */
export type NetflixTitlePageResult =
  | { kind: "ready"; page: NetflixTitlePageDTO }
  | { kind: "not-found" }
  | { kind: "unavailable" };

/**
 * The title page: title + where-it-ranks + same-pool neighbors. The honest
 * three-way outcome: `not-found` when at least one pool served but the id is
 * outside the tracked universe; `unavailable` when every pool answered null
 * (a dead/walled upstream — never conflated with not-found).
 */
export async function getNetflixTitlePage(
  netflixId: number,
): Promise<NetflixTitlePageResult> {
  const pools = await Promise.all(ALL_POOL_KEYS.map((k) => getTop10Pool(k)));
  let anyPoolServed = false;
  let title: NetflixTitleDTO | null = null;
  let servedPool: ParsedPool | null = null;
  for (const pool of pools) {
    if (pool !== null) anyPoolServed = true;
    const hit = pool?.titles.find((t) => t.netflixId === netflixId);
    if (hit && title === null) {
      title = hit;
      servedPool = pool;
    }
  }
  if (title === null) {
    return anyPoolServed ? { kind: "not-found" } : { kind: "unavailable" };
  }
  // The FULL country-rank truth rides the DTO (the UI caps the display) —
  // the composition never truncates the honest data.
  const countryRanks: NetflixCountryRank[] = Object.entries(title.countryRanks)
    .map(([countryId, rank]) => ({ countryId, rank }))
    .sort((a, b) => a.rank - b.rank || a.countryId.localeCompare(b.countryId));

  const relatedTitles: NetflixTitleDTO[] = (servedPool?.titles ?? [])
    .filter((t) => t.netflixId !== netflixId)
    .slice(0, 10);

  return {
    kind: "ready",
    page: {
      title,
      countryRanks,
      relatedTitles,
      source: poolSource(title.pool ?? "weekly-films"),
    },
  };
}
