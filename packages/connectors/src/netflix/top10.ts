/**
 * WFX-NETFLIX-SOURCE-1 — the Tudum Top 10 reader, ported from the web app's
 * src/lib/netflix/top10.ts (P42-NETFLIX-SOURCE, ADR 0002 §2).
 *
 * Netflix publishes its official weekly Top 10 + Most Popular data on the
 * Tudum site (netflix.com/tudum/top10). Each pool page server-renders a
 * normalized Relay cache at `netflix.reactContext.models.graphql`
 * (JSON.parse('…') of a `{data: {"PulseTop10ItemEntity:…": …}}` record).
 *
 * Bounds (ADR 0002 §2, verbatim from the web port): exactly these 8
 * unauthenticated page URLs, always through the netflix upstream seam, no
 * cookies, no accounts, no other netflix.com paths (robots: `Disallow: /`
 * for generic agents).
 *
 * DESKTOP DIFFERENCE (documented): the web app cached pools through the
 * shared Upstash adapter (soft TTL + SWR + last-good). The desktop keeps
 * the SAME soft/hard TTL semantics in an in-memory pool cache (the
 * project's local-memory caching law — no external middleware): soft TTL
 * serves within 6h/24h; a failed/walled fetch falls back to the last good
 * parse within 48h/7d; a poisoned (empty) parse is never cached as good.
 */

import { netflixUpstreamFetch } from "./upstream";
import { netflixTitleUrl, netflixWatchUrl } from "./deeplink";
import type { NetflixPoolKey, NetflixTitleDTO, NetflixTitleKind } from "./types";

/** Soft TTLs: the pools refresh weekly (6h) / most-popular moves slower (24h). */
const PAGE_TTL_MS = {
  weekly: 6 * 3_600_000,
  alltime: 24 * 3_600_000,
} as const;

/** Last-good windows: weekly data stays truthful ~2 days, all-time ~a week. */
const HARD_TTL_MS = {
  weekly: 48 * 3_600_000,
  alltime: 7 * 24 * 3_600_000,
} as const;

/** One bounded fetch budget for a pool page (single attempt + one retry). */
const FETCH_TIMEOUT_MS = 12_000;

const POOL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface PoolSpec {
  key: NetflixPoolKey;
  /** Path under netflix.com (the full URL is https://www.netflix.com + path). */
  path: string;
  kind: NetflixTitleKind;
  ranking: "weekly" | "alltime";
  label: string;
  ttlMs: number;
}

/**
 * The pool matrix (measured live by the web app 2026-10-24 — every row
 * answered 200 with the documented SSR cache shape):
 * - weekly  → ENGLISH_MOVIES / ENGLISH_SERIES / NONENGLISH_MOVIES / NONENGLISH_SERIES with weekEndDate
 * - alltime → same categories with weekEndDate null
 */
export const POOLS: Record<NetflixPoolKey, PoolSpec> = {
  "weekly-films": {
    key: "weekly-films",
    path: "/tudum/top10/",
    kind: "movie",
    ranking: "weekly",
    label: "Top 10 Movies This Week",
    ttlMs: PAGE_TTL_MS.weekly,
  },
  "weekly-tv": {
    key: "weekly-tv",
    path: "/tudum/top10/tv",
    kind: "series",
    ranking: "weekly",
    label: "Top 10 Shows This Week",
    ttlMs: PAGE_TTL_MS.weekly,
  },
  "weekly-nonenglish-films": {
    key: "weekly-nonenglish-films",
    path: "/tudum/top10/films-non-english",
    kind: "movie",
    ranking: "weekly",
    label: "Top 10 Non-English Movies This Week",
    ttlMs: PAGE_TTL_MS.weekly,
  },
  "weekly-nonenglish-tv": {
    key: "weekly-nonenglish-tv",
    path: "/tudum/top10/tv-non-english",
    kind: "series",
    ranking: "weekly",
    label: "Top 10 Non-English Shows This Week",
    ttlMs: PAGE_TTL_MS.weekly,
  },
  "alltime-films": {
    key: "alltime-films",
    path: "/tudum/top10/most-popular",
    kind: "movie",
    ranking: "alltime",
    label: "Most Popular Movies of All Time",
    ttlMs: PAGE_TTL_MS.alltime,
  },
  "alltime-tv": {
    key: "alltime-tv",
    path: "/tudum/top10/most-popular/tv",
    kind: "series",
    ranking: "alltime",
    label: "Most Popular Shows of All Time",
    ttlMs: PAGE_TTL_MS.alltime,
  },
  "alltime-nonenglish-films": {
    key: "alltime-nonenglish-films",
    path: "/tudum/top10/most-popular/films-non-english",
    kind: "movie",
    ranking: "alltime",
    label: "Most Popular Non-English Movies",
    ttlMs: PAGE_TTL_MS.alltime,
  },
  "alltime-nonenglish-tv": {
    key: "alltime-nonenglish-tv",
    path: "/tudum/top10/most-popular/tv-non-english",
    kind: "series",
    ranking: "alltime",
    label: "Most Popular Non-English Shows",
    ttlMs: PAGE_TTL_MS.alltime,
  },
};

export const ALL_POOL_KEYS = Object.keys(POOLS) as NetflixPoolKey[];

// ---------------------------------------------------------------------------
// The SSR-cache parser
// ---------------------------------------------------------------------------

/** Marker the pool page must contain (cheapest honest validity gate). */
const CACHE_MARKER = "netflix.reactContext.models.graphql";

/**
 * JS-string-unescape for the JSON.parse('…') literal. The captures carry only
 * \' \\ \u escapes (verified on the live pages); the rest are handled
 * defensively.
 */
function jsUnescape(literal: string): string {
  let out = "";
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (c === "\\" && i + 1 < literal.length) {
      const n = literal[i + 1];
      if (n === "'") {
        out += "'";
        i++;
        continue;
      }
      if (n === '"') {
        out += '"';
        i++;
        continue;
      }
      if (n === "\\") {
        out += "\\";
        i++;
        continue;
      }
      if (n === "/") {
        out += "/";
        i++;
        continue;
      }
      if (n === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i++;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (n === "u" && i + 5 < literal.length) {
        const hex = literal.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}

interface Top10Record {
  weekEndDate?: string | null;
  category?: string | null;
  weeklyRank?: number | null;
  weeklyHoursViewed?: number | null;
  weeklyViews?: number | null;
  cumulativeWeeksInTop10?: number | null;
  videoId?: number | null;
}

interface Top10VideoRecord {
  title?: string | null;
  videoId?: number | null;
  shortSynopsis?: string | null;
  releaseYear?: number | null;
  maturityRating?: string | null;
}

interface PulseImageSize {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

interface ArtworkRecord {
  logoArt?: { urlsSized?: unknown } | null;
  sdpArt?: { urlsSized?: unknown } | null;
  storyArt?: { urlsSized?: unknown } | null;
}

interface EntityRecord {
  top10?: Top10Record | null;
  top10Video?: Top10VideoRecord | null;
  artwork?: ArtworkRecord | null;
  displayVideo?: { video?: { isPlayable?: boolean | null } | null } | null;
  countryRanks?: { countryId?: string | null; rank?: number | null }[] | null;
}

interface GraphqlCache {
  data?: Record<string, unknown>;
}

/**
 * Extract + parse the embedded GraphQL cache. Returns null honestly when the
 * page shape changed or the fetch was walled (never throws).
 *
 * The literal is a JS single-quoted string — every `'` inside it is escaped,
 * so the true terminator is the FIRST unescaped `'` after the opening quote.
 * An escape-aware scan is exact; greedy/lastIndexOf heuristics overshoot
 * when other scripts follow.
 */
export function extractGraphqlCache(html: string): GraphqlCache | null {
  const markerAt = html.indexOf(CACHE_MARKER);
  if (markerAt === -1) return null;
  const literalStart = html.indexOf("JSON.parse('", markerAt);
  if (literalStart === -1) return null;
  const from = literalStart + "JSON.parse('".length;
  let end = -1;
  for (let i = from; i < html.length - 1; i++) {
    const c = html[i];
    if (c === "\\") {
      i++; // skip the escaped char
      continue;
    }
    if (c === "'") {
      end = i;
      break;
    }
  }
  if (end === -1 || end <= from) return null;
  try {
    const parsed: unknown = JSON.parse(jsUnescape(html.slice(from, end)));
    if (parsed && typeof parsed === "object" && "data" in (parsed as GraphqlCache)) {
      return parsed as GraphqlCache;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The artwork sets ride GraphQL parameterized keys —
 * `urlsSized({"sizes":{"height":675,"width":1200}})` — so the lookup scans
 * every key that starts with "urlsSized" and takes the first array value.
 */
function urlsSizedList(field: unknown): PulseImageSize[] {
  if (!field || typeof field !== "object") return [];
  const record = field as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("urlsSized") && Array.isArray(value)) {
      return value.filter(
        (e): e is PulseImageSize =>
          !!e && typeof e === "object" && typeof (e as PulseImageSize).url === "string",
      );
    }
  }
  return [];
}

/** Largest artwork URL of a sized set (the storyArt set carries widths). */
function bestArtworkUrl(field: unknown): string | null {
  const list = urlsSizedList(field);
  if (list.length === 0) return null;
  return list.reduce((best, cur) => ((cur.width ?? 0) > (best.width ?? 0) ? cur : best)).url ?? null;
}

function kindFromCategory(category: string | null | undefined): NetflixTitleKind | null {
  if (!category) return null;
  if (category.endsWith("_MOVIES")) return "movie";
  if (category.endsWith("_SERIES")) return "series";
  return null;
}

/**
 * The category gate: a pool page can carry neighbor categories (geo pool
 * copies); keep only records matching the requested pool's language class and
 * kind. Language class rides the category prefix (ENGLISH_ / NONENGLISH_).
 */
function poolLanguageClass(key: NetflixPoolKey): "ENGLISH" | "NONENGLISH" {
  return key.includes("nonenglish") ? "NONENGLISH" : "ENGLISH";
}

function recordMatchesPool(entity: EntityRecord, pool: PoolSpec): boolean {
  const category = entity.top10?.category;
  if (kindFromCategory(category) !== pool.kind) return false;
  const lang = poolLanguageClass(pool.key);
  if (lang === "ENGLISH" && !category?.startsWith("ENGLISH_")) return false;
  if (lang === "NONENGLISH" && !category?.startsWith("NONENGLISH_")) return false;
  // Weekly pools carry a weekEndDate; all-time pools leave it null.
  if (pool.ranking === "weekly" && !entity.top10?.weekEndDate) return false;
  if (pool.ranking === "alltime" && entity.top10?.weekEndDate) return false;
  return true;
}

/**
 * Map one Relay entity → NetflixTitleDTO. Returns null when the record is not
 * a usable Top 10 item (missing id/title — never a fake row).
 */
export function mapTop10Entity(entity: EntityRecord, pool: PoolSpec): NetflixTitleDTO | null {
  const video = entity.top10Video;
  const top10 = entity.top10;
  const netflixId = video?.videoId ?? top10?.videoId ?? null;
  const title = video?.title ?? null;
  if (!netflixId || typeof netflixId !== "number" || !video || !title) return null;

  const countryRanks: Record<string, number> = {};
  for (const cr of entity.countryRanks ?? []) {
    if (cr && cr.countryId && typeof cr.rank === "number") countryRanks[cr.countryId] = cr.rank;
  }

  return {
    netflixId,
    title,
    kind: pool.kind,
    synopsis: video.shortSynopsis ?? "",
    releaseYear: video.releaseYear ?? null,
    maturityRating: video.maturityRating ?? null,
    backdropUrl: bestArtworkUrl(entity.artwork?.storyArt),
    posterUrl: bestArtworkUrl(entity.artwork?.sdpArt),
    logoUrl: bestArtworkUrl(entity.artwork?.logoArt),
    weeklyRank: pool.ranking === "weekly" ? top10?.weeklyRank ?? null : null,
    allTimeRank: pool.ranking === "alltime" ? top10?.weeklyRank ?? null : null,
    weeksInTop10: top10?.cumulativeWeeksInTop10 ?? null,
    weeklyHoursViewed: top10?.weeklyHoursViewed ?? null,
    weeklyViews: top10?.weeklyViews ?? null,
    countryRanks,
    weekEndDate: top10?.weekEndDate ?? null,
    pool: pool.key,
    isPlayable: entity.displayVideo?.video?.isPlayable ?? true,
    deepLinkUrl: netflixWatchUrl(netflixId),
    titlePageUrl: netflixTitleUrl(netflixId),
  };
}

export interface ParsedPool {
  pool: NetflixPoolKey;
  titles: NetflixTitleDTO[];
  weekEndDate: string | null;
}

/**
 * Parse a captured pool page into the deduped, rank-ordered title list.
 * The SSR cache carries the Global pool AND the geo pool copies of the same
 * records — dedupe by videoId, preferring the copy with the richer
 * countryRanks map (measured: identical titles, different rank payloads).
 */
export function parseTop10Page(html: string, poolKey: NetflixPoolKey): ParsedPool | null {
  const pool = POOLS[poolKey];
  const cache = extractGraphqlCache(html);
  if (!cache?.data) return null;
  const byId = new Map<number, NetflixTitleDTO>();
  for (const [key, value] of Object.entries(cache.data)) {
    if (!key.startsWith("PulseTop10ItemEntity:")) continue;
    if (!value || typeof value !== "object") continue;
    if (!recordMatchesPool(value as EntityRecord, pool)) continue;
    const dto = mapTop10Entity(value as EntityRecord, pool);
    if (!dto) continue;
    const existing = byId.get(dto.netflixId);
    if (!existing) {
      byId.set(dto.netflixId, dto);
      continue;
    }
    // The page carries the Global pool AND the geo pool copies of the same
    // record with different completeness — merge field-wise: keep the richer
    // countryRanks map and the first non-null artwork of either copy.
    byId.set(dto.netflixId, {
      ...existing,
      ...dto,
      countryRanks:
        Object.keys(dto.countryRanks).length >= Object.keys(existing.countryRanks).length
          ? dto.countryRanks
          : existing.countryRanks,
      backdropUrl: dto.backdropUrl ?? existing.backdropUrl,
      posterUrl: dto.posterUrl ?? existing.posterUrl,
      logoUrl: dto.logoUrl ?? existing.logoUrl,
      synopsis: dto.synopsis || existing.synopsis,
    });
  }
  if (byId.size === 0) return null;
  const rankOf = (t: NetflixTitleDTO) => t.weeklyRank ?? t.allTimeRank ?? 99;
  const titles = [...byId.values()].sort((a, b) => rankOf(a) - rankOf(b));
  const weekEndDate = titles.find((t) => t.weekEndDate)?.weekEndDate ?? null;
  return { pool: poolKey, titles, weekEndDate };
}

// ---------------------------------------------------------------------------
// The bounded fetch + the in-memory resilient pool cache
// ---------------------------------------------------------------------------

async function fetchPoolPage(pool: PoolSpec): Promise<string | null> {
  const url = `https://www.netflix.com${pool.path}`;
  const doFetch = async (): Promise<string | null> => {
    try {
      const res = await netflixUpstreamFetch()(url, {
        headers: {
          "User-Agent": POOL_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = await res.text();
      if (!body.includes(CACHE_MARKER)) return null;
      return body;
    } catch {
      return null;
    }
  };
  const first = await doFetch();
  if (first) return first;
  // One retry — the walled/5xx class is transient at the CDN edge.
  return doFetch();
}

interface PoolCacheEntry {
  /** The last GOOD parse (non-empty); null until one succeeds. */
  value: ParsedPool | null;
  goodAt: number;
}

const poolCache = new Map<NetflixPoolKey, PoolCacheEntry>();

/** Test seam: drop every cached pool (the battery runs hermetic per case). */
export function resetTop10PoolCache(): void {
  poolCache.clear();
}

/**
 * Get-or-load one pool through the in-memory resilient cache. Soft TTL
 * serves within the pool's window; a failed/walled/empty fetch falls back
 * to the last good parse within the HARD window; a poisoned (empty) parse
 * is never cached as good. Null honestly means "unavailable right now".
 */
export async function getTop10Pool(poolKey: NetflixPoolKey): Promise<ParsedPool | null> {
  const pool = POOLS[poolKey];
  const now = Date.now();
  const cached = poolCache.get(poolKey);
  if (cached?.value && now - cached.goodAt < pool.ttlMs) {
    return cached.value;
  }
  const html = await fetchPoolPage(pool);
  const parsed = html === null ? null : parseTop10Page(html, poolKey);
  if (parsed !== null && parsed.titles.length > 0) {
    poolCache.set(poolKey, { value: parsed, goodAt: now });
    return parsed;
  }
  // Last-good fallback within the hard window (poisoning guard: the empty
  // parse above was never stored as good).
  if (cached?.value && now - cached.goodAt < HARD_TTL_MS[pool.ranking]) {
    return cached.value;
  }
  return null;
}
