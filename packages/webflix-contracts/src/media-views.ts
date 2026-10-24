/**
 * Media-surface view shapes (WFX-DESKTOP-WEBFLIX-UX-1 — freeze §9).
 *
 * ADDITIVE module (semver minor 0.13.0 -> 0.14.0 per the §3 method): every
 * frozen §2.1–2.7 shape and every earlier additive sibling is untouched.
 *
 * What this module is: the SHARED VIEW CONTRACT between the media-first
 * shell (webflix-shell — the renderer) and the provider vertical slice
 * (application use cases over the connectors — the producer). Binding
 * laws, encoded here:
 *
 * - THE CANONICAL ITEM RIDES VERBATIM: every card view carries the frozen
 *   §2.1 CatalogItem VERBATIM (imported from ./catalog, never mirrored),
 *   so the UI's play path resolves through the SAME playback planning the
 *   buttons use. Display labels are additive presentation facts.
 * - THE HONEST STATES ARE DATA, NOT FAILURES: each surface answers with a
 *   phase (loading / ready / requires-auth / rate-limited / unsupported /
 *   unavailable / degraded / status-unknown / empty — the frozen view
 *   vocabulary) carrying its typed detail. A provider that is not
 *   configured ANSWERS requires-auth, it never yields fabricated rows or
 *   a thrown error. `degraded` surfaces may carry partial data with an
 *   honest note.
 * - SOURCES ARE LABELED: composed surfaces (home feed, subscriptions
 *   degrade) carry a note naming HOW they were composed — the UI may show
 *   it; a mock/fixture producer must identify itself in `sourceNote`.
 * - THE PORTS ARE INTERFACES ONLY (CredentialPort precedent, §2.5): the
 *   producer implements them in webflix-application; the shell/host
 *   consumes. No implementation lives in contracts.
 * - NO NETWORK, NO CREDENTIALS HERE: shapes only. The Data-API-backed
 *   producer is Worker 2's lane with its own honest-unconfigured law.
 */
import { z } from "zod";
import { CatalogItemSchema } from "./catalog";
import { AbsoluteUrlSchema } from "./internal/primitives";
import type { MediaRoute, RouteParams, VisibleMediaContext } from "./ui-actions";

// Type re-exports for producer/consumer convenience from this seam
// (schema re-exports stay in ./ui-actions to keep the barrel unambiguous).
export type { MediaRoute, RouteParams, VisibleMediaContext };

// ---------------------------------------------------------------------------
// The frozen view-state vocabulary (the honest states as data)
// ---------------------------------------------------------------------------

/**
 * The surface-level phase vocabulary — a data-only mirror of the shell's
 * HonestState grammar so producers and the shell speak one language.
 * `ready` carries data; every other phase carries at most a detail.
 */
export const MediaViewPhaseSchema = z.enum([
  "loading",
  "ready",
  "empty",
  "requires-auth",
  "rate-limited",
  "unsupported",
  "unavailable",
  "degraded",
  "status-unknown",
]);
export type MediaViewPhase = z.infer<typeof MediaViewPhaseSchema>;

// ---------------------------------------------------------------------------
// Card views — the atoms every surface composes
// ---------------------------------------------------------------------------

/** Display badges a card may carry (additive). */
export const VideoBadgeSchema = z.enum(["live", "new", "verified", "members-only", "progress"]);
export type VideoBadge = z.infer<typeof VideoBadgeSchema>;

/**
 * A video/short/live card: the canonical CatalogItem plus presentation
 * facts the UI renders (labels are preformatted strings — the producer
 * formats numbers/dates so the shell never guesses locales).
 */
export const VideoCardViewSchema = z.object({
  item: CatalogItemSchema,
  title: z.string(),
  channelId: z.string().optional(),
  channelTitle: z.string().optional(),
  thumbnailUrl: AbsoluteUrlSchema.optional(),
  durationLabel: z.string().optional(),
  viewsLabel: z.string().optional(),
  publishedLabel: z.string().optional(),
  badges: z.array(VideoBadgeSchema).default([]),
});
export type VideoCardView = z.infer<typeof VideoCardViewSchema>;

/** A continue-watching card: a video card plus resume facts. */
export const ContinueCardViewSchema = VideoCardViewSchema.extend({
  progressPercent: z.number().min(0).max(1).nullable(),
  progressLabel: z.string().optional(),
  resumeAtSec: z.number().min(0).optional(),
});
export type ContinueCardView = z.infer<typeof ContinueCardViewSchema>;

/** A channel card (search results, subscriptions list). */
export const ChannelCardViewSchema = z.object({
  channelId: z.string().min(1),
  title: z.string(),
  handle: z.string().optional(),
  avatarUrl: AbsoluteUrlSchema.optional(),
  subscriberLabel: z.string().optional(),
  videoCountLabel: z.string().optional(),
  verified: z.boolean().default(false),
  description: z.string().optional(),
});
export type ChannelCardView = z.infer<typeof ChannelCardViewSchema>;

/** A channel header (the channel surface's identity band). */
export const ChannelHeaderViewSchema = ChannelCardViewSchema.extend({
  bannerUrl: AbsoluteUrlSchema.optional(),
  createdAtLabel: z.string().optional(),
});
export type ChannelHeaderView = z.infer<typeof ChannelHeaderViewSchema>;

// ---------------------------------------------------------------------------
// Home feed — sections model (the reference's interleaved composition)
// ---------------------------------------------------------------------------

/**
 * One ordered home section. The renderer draws sections IN ORDER; the
 * producer composes the reference's interleaving (long grids, shorts
 * shelves, continue rail) honestly. Sections carry their own state so a
 * degraded surface still shows what worked.
 */
export const HomeSectionViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video-grid"),
    sectionId: z.string().min(1),
    title: z.string().optional(),
    videos: z.array(VideoCardViewSchema),
    /** `grid` = responsive multi-up grid; `rail` = horizontal scroller. */
    layout: z.enum(["grid", "rail"]).default("grid"),
  }),
  z.object({
    kind: z.literal("shorts-shelf"),
    sectionId: z.string().min(1),
    title: z.string().optional(),
    shorts: z.array(VideoCardViewSchema),
  }),
  z.object({
    kind: z.literal("continue-watching"),
    sectionId: z.string().min(1),
    title: z.string().optional(),
    items: z.array(ContinueCardViewSchema),
  }),
  z.object({
    kind: z.literal("section-state"),
    sectionId: z.string().min(1),
    title: z.string().optional(),
    phase: MediaViewPhaseSchema,
    detail: z.string().optional(),
  }),
]);
export type HomeSectionView = z.infer<typeof HomeSectionViewSchema>;

/** The home feed view (phase-gated; ready carries the composition). */
export const HomeFeedViewSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("loading"),
  }),
  z.object({
    phase: z.literal("ready"),
    chips: z.array(z.string()).default([]),
    selectedChip: z.string().nullable().default(null),
    sections: z.array(HomeSectionViewSchema),
    /** Cursor for the growing-grid append (null = no more pages). */
    nextCursor: z.string().nullable(),
    /** HOW this feed was composed (e.g. trending + local history). */
    compositionNote: z.string().optional(),
  }),
  z.object({
    phase: z.enum(["empty", "requires-auth", "rate-limited", "unsupported", "unavailable", "degraded", "status-unknown"]),
    detail: z.string().optional(),
    /** A degraded surface may still carry partial sections. */
    sections: z.array(HomeSectionViewSchema).optional(),
  }),
]);
export type HomeFeedView = z.infer<typeof HomeFeedViewSchema>;

// ---------------------------------------------------------------------------
// The page surfaces — search, channel, trending, shorts, subscriptions,
// history
// ---------------------------------------------------------------------------

/** The producer-side search page data (phases are the shell's grammar). */
export const SearchPageDataSchema = z.object({
  query: z.string(),
  videos: z.array(VideoCardViewSchema),
  channels: z.array(ChannelCardViewSchema),
  nextCursor: z.string().nullable(),
  /** Quota/search budget facts when the provider surfaces them. */
  budgetNote: z.string().optional(),
});
export type SearchPageData = z.infer<typeof SearchPageDataSchema>;

/** The channel surface (header + tabs + videos + shorts). */
export const ChannelViewSchema = z.object({
  channel: ChannelHeaderViewSchema,
  /** Tabs the producer can honestly serve for THIS channel. */
  availableTabs: z.array(z.enum(["home", "videos", "shorts", "live", "playlists", "about"])).default(["videos"]),
  videos: z.array(VideoCardViewSchema),
  shorts: z.array(VideoCardViewSchema),
  nextCursor: z.string().nullable(),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type ChannelView = z.infer<typeof ChannelViewSchema>;

/** The trending surface (region + category chips + chart rows). */
export const TrendingViewSchema = z.object({
  region: z.string().nullable(),
  chips: z.array(z.string()).default([]),
  selectedChip: z.string().nullable().default(null),
  videos: z.array(VideoCardViewSchema),
  nextCursor: z.string().nullable(),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type TrendingView = z.infer<typeof TrendingViewSchema>;

/** The shorts surface (vertical feed of shorts-classified items). */
export const ShortsViewSchema = z.object({
  shorts: z.array(VideoCardViewSchema),
  nextCursor: z.string().nullable(),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type ShortsView = z.infer<typeof ShortsViewSchema>;

/**
 * The subscriptions surface. YouTube has no subscriptions-feed API for
 * third-party clients: the honest compose polls channel uploads and MUST
 * say so in degradeNote. `channels` may be empty when not connected.
 */
export const SubscriptionsViewSchema = z.object({
  channels: z.array(ChannelCardViewSchema),
  videos: z.array(VideoCardViewSchema),
  /** The honest compose note (e.g. "polled per-channel uploads"). */
  degradeNote: z.string().optional(),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type SubscriptionsView = z.infer<typeof SubscriptionsViewSchema>;

/** The history surface (grouped continue-watching). */
export const HistoryViewSchema = z.object({
  groups: z.array(
    z.object({
      label: z.string().min(1),
      items: z.array(ContinueCardViewSchema),
    }),
  ),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type HistoryView = z.infer<typeof HistoryViewSchema>;

// ---------------------------------------------------------------------------
// Netflix hub — the second source's surfaces (WFX-NETFLIX-SOURCE-1)
// ---------------------------------------------------------------------------

/**
 * A Netflix title card atom — the second source's OWN shape, deliberately
 * NOT a VideoCardView: Netflix titles never resolve to an in-app CatalogItem
 * (playback hands off to Netflix's official player — ADR 0002 §1 / the
 * provider-policy matrix row). The agent cannot playCatalogItem these; the
 * hub surfaces carry no visibleItemIds by the same law.
 */
export const NetflixTitleCardSchema = z.object({
  /** The real Netflix video id — the deep-link key. */
  netflixId: z.number().int().positive(),
  title: z.string(),
  kind: z.enum(["movie", "series"]),
  synopsis: z.string(),
  releaseYear: z.number().int().nullable(),
  maturityRating: z.string().nullable(),
  /** Landscape story art (hero/backdrop). */
  backdropUrl: AbsoluteUrlSchema.nullable(),
  /** 16:9 boxart (cards). */
  posterUrl: AbsoluteUrlSchema.nullable(),
  /** Title-logo art (hero overlay). */
  logoUrl: AbsoluteUrlSchema.nullable(),
  /** Global weekly rank within its pool (1..10); null for all-time pools. */
  weeklyRank: z.number().int().nullable(),
  /** All-time most-popular rank; null for weekly pools. */
  allTimeRank: z.number().int().nullable(),
  weeksInTop10: z.number().int().nullable(),
  weeklyHoursViewed: z.number().nullable(),
  /** Week end date (YYYY-MM-DD) for weekly pools; null = all-time. */
  weekEndDate: z.string().nullable(),
  /** The ONLY sanctioned netflix.com deep links (the connector's deeplink law). */
  watchUrl: AbsoluteUrlSchema,
  titlePageUrl: AbsoluteUrlSchema,
});
export type NetflixTitleCard = z.infer<typeof NetflixTitleCardSchema>;

/** One browsable rail on the Netflix hub (one Tudum pool, one country view). */
export const NetflixRailViewSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  ranking: z.enum(["weekly", "alltime"]),
  /** "Global" or an ISO country code the rail was ranked for. */
  country: z.string(),
  weekEndDate: z.string().nullable(),
  titles: z.array(NetflixTitleCardSchema),
});
export type NetflixRailView = z.infer<typeof NetflixRailViewSchema>;

/**
 * The Netflix hub surface. `hero` is the top weekly title (null = honest
 * absence); empty rails ARE the honest unavailable state (the producer maps
 * the upstream-failure shape to phase "unavailable" with its reason).
 */
export const NetflixHomeViewSchema = z.object({
  country: z.string(),
  rails: z.array(NetflixRailViewSchema),
  hero: NetflixTitleCardSchema.nullable(),
  catalogSize: z.number().int().nonnegative(),
  /** Provenance note naming HOW the surface was composed (the source-label law). */
  sourceNote: z.string(),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type NetflixHomeView = z.infer<typeof NetflixHomeViewSchema>;

/** A country where a title currently ranks (best-first). */
export const NetflixCountryRankViewSchema = z.object({
  countryId: z.string().min(1),
  rank: z.number().int().positive(),
});
export type NetflixCountryRankView = z.infer<typeof NetflixCountryRankViewSchema>;

/**
 * The Netflix title-detail surface. `title` is null on every non-ready
 * phase (the phase panel renders the honest state — never a fabricated
 * placeholder card); a ready view always carries the title.
 */
export const NetflixTitleViewSchema = z.object({
  title: NetflixTitleCardSchema.nullable(),
  countryRanks: z.array(NetflixCountryRankViewSchema),
  /** Same-pool neighbors — "More like this" stays honest (the Top 10 universe). */
  relatedTitles: z.array(NetflixTitleCardSchema),
  phase: MediaViewPhaseSchema,
  detail: z.string().optional(),
});
export type NetflixTitleView = z.infer<typeof NetflixTitleViewSchema>;

// ---------------------------------------------------------------------------
// The producer ports (interfaces only — implemented in webflix-application)
// ---------------------------------------------------------------------------

/** Paging cursor + optional signal, shared by every loading port call. */
export interface MediaPageRequest {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

/** Produces the home feed (initial + append pages for the growing grid). */
export interface HomeFeedPort {
  getHomeFeed(request: MediaPageRequest & { category?: string }): Promise<HomeFeedView>;
  getHomeFeedAppend(cursor: string, request?: MediaPageRequest): Promise<HomeFeedView>;
}

/** Produces search page data (the honest-phase mapping is the shell's). */
export interface SearchPagePort {
  searchPage(query: string, request?: MediaPageRequest): Promise<SearchPageData>;
}

/** Produces a channel surface by id or handle. */
export interface ChannelPort {
  channel(input: { channelId?: string; handle?: string; tab?: string }, request?: MediaPageRequest): Promise<ChannelView>;
  /** Append page for a channel's videos tab. */
  channelAppend(channelId: string, cursor: string, request?: MediaPageRequest): Promise<ChannelView>;
}

/** Produces the trending chart surface. */
export interface TrendingPort {
  trending(input: { region?: string; category?: string }, request?: MediaPageRequest): Promise<TrendingView>;
}

/** Produces the shorts surface (shorts-classified catalog rows). */
export interface ShortsPort {
  shorts(request?: MediaPageRequest): Promise<ShortsView>;
}

/**
 * Produces the subscriptions surface. Without a connected account this
 * answers requires-auth phase honestly; the connected compose polls
 * channel uploads and labels itself in degradeNote.
 */
export interface SubscriptionsPort {
  subscriptions(request?: MediaPageRequest): Promise<SubscriptionsView>;
}

/** Produces the local-history surface (grouped continue-watching). */
export interface HistoryPort {
  history(): Promise<HistoryView>;
}

/**
 * Produces the Netflix hub surfaces (WFX-NETFLIX-SOURCE-1 — the web app's
 * second source, over Netflix's own public Tudum Top 10 data; no
 * credentials, no account, playback hands off to netflix.com). Implementations
 * answer the honest phase vocabulary: an unreachable upstream answers
 * `unavailable` with its reason — never fabricated rows.
 */
export interface NetflixPort {
  /** The hub: rails per Tudum pool for the requested country view. */
  netflixHome(input: { country?: string }): Promise<NetflixHomeView>;
  /** One title's detail page (where-it-ranks + same-pool neighbors). */
  netflixTitle(input: { netflixId: number }): Promise<NetflixTitleView>;
}

/**
 * The channel-resolution use case behind the agent's resolveChannel
 * action (the MrBeast journey's data path): resolve a channel query to
 * ONE channel + its newest uploads, or to typed candidates when
 * ambiguous. newest-first ordering is binding on implementations.
 */
export interface ChannelResolutionPort {
  resolveChannel(
    query: string,
    options?: { uploadsLimit?: number },
  ): Promise<
    | { kind: "resolved"; channel: ChannelHeaderView; uploads: VideoCardView[] }
    | { kind: "ambiguous"; candidates: ChannelCardView[] }
    | { kind: "not-found" }
    | { kind: "unavailable"; phase: MediaViewPhase; detail?: string }
  >;
}
