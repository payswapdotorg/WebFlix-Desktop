/**
 * WFX-NETFLIX-SOURCE-1 — the Netflix DTO family, ported from the web app's
 * src/lib/netflix/types.ts (P42-NETFLIX-SOURCE, ADR 0002 §3): every DTO
 * carries the honest `source` provenance; Netflix titles carry their own
 * DTO — the YouTube VideoDTO stays YouTube-owned. The desktop port drops
 * the web app's Prisma-mirror-only shapes (the desktop keeps the pool
 * caches in memory; there is no per-user viewer, so My List and the
 * catalog-search mirror are honestly out of scope for this lane).
 */

/** The bounded Tudum Top 10 pool matrix (8 unauthenticated page URLs). */
export type NetflixPoolKey =
  | "weekly-films"
  | "weekly-tv"
  | "weekly-nonenglish-films"
  | "weekly-nonenglish-tv"
  | "alltime-films"
  | "alltime-tv"
  | "alltime-nonenglish-films"
  | "alltime-nonenglish-tv";

export type NetflixTitleKind = "movie" | "series";

/** Where a DTO's rows came from — the provenance law, Netflix edition. */
export type NetflixSource =
  | "netflix-top10"
  | "netflix-most-popular"
  | "last-good"
  | "";

/**
 * One Netflix title as WebFlix knows it. Sourced from Netflix's own public
 * Top 10 data (unauthenticated); never a fake row.
 */
export interface NetflixTitleDTO {
  /** The real Netflix video id — the deep-link key. */
  netflixId: number;
  title: string;
  kind: NetflixTitleKind;
  synopsis: string;
  releaseYear: number | null;
  maturityRating: string | null;
  /** Landscape story art (1200×675) — hero/backdrop. */
  backdropUrl: string | null;
  /** 16:9 boxart (390×219) — cards. */
  posterUrl: string | null;
  /** Title-logo art (360×153) — hero overlay. */
  logoUrl: string | null;
  /** Global weekly rank within its pool (1..10); null for all-time pools. */
  weeklyRank: number | null;
  /** All-time most-popular rank (1..10); null for weekly pools. */
  allTimeRank: number | null;
  weeksInTop10: number | null;
  weeklyHoursViewed: number | null;
  weeklyViews: number | null;
  /** ISO country code → rank in that country's Top 10 (~93 countries when present). */
  countryRanks: Record<string, number>;
  /** Week end date (YYYY-MM-DD) for weekly pools; null = all-time. */
  weekEndDate: string | null;
  pool: NetflixPoolKey | null;
  isPlayable: boolean;
  /** ADR 0002 §1 — deep links are built ONLY by ./deeplink.ts. */
  deepLinkUrl: string;
  titlePageUrl: string;
}

/** One browsable rail on the Netflix hub. */
export interface NetflixRailDTO {
  key: NetflixPoolKey;
  label: string;
  kind: NetflixTitleKind;
  /** "Global" or an ISO country code the rail was ranked for. */
  country: string;
  /** "weekly" | "alltime" — rank semantics follow. */
  ranking: "weekly" | "alltime";
  weekEndDate: string | null;
  titles: NetflixTitleDTO[];
  source: NetflixSource;
}

export interface NetflixHomeDTO {
  rails: NetflixRailDTO[];
  catalogSize: number;
  source: NetflixSource;
  /** Honest degradation (ADR 0002 §3): upstream unreachable → notice, never fakes. */
  unavailable: boolean;
  unavailableReason: string | null;
  fetchedAt: string;
}

/** A country where the title currently ranks, ordered best-first. */
export interface NetflixCountryRank {
  countryId: string;
  rank: number;
}

export interface NetflixTitlePageDTO {
  title: NetflixTitleDTO;
  /** Where it ranks today, best-first. */
  countryRanks: NetflixCountryRank[];
  /** Same-pool neighbors — "More like this" stays honest (the Top 10 universe). */
  relatedTitles: NetflixTitleDTO[];
  source: NetflixSource;
}
