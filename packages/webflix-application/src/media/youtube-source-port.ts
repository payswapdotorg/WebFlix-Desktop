/**
 * The YouTube catalog-source port (WFX-PROVIDER-SLICE-1) — the
 * application-owned seam the media producers depend on.
 *
 * ARCHITECTURE (freeze §1: dependency direction is inward — clients →
 * adapters → app → domain → contracts): `webflix-application` must NOT
 * import the connectors package. Instead THIS package owns the port, and
 * the official-Data-API adapter that satisfies it lives in
 * `packages/connectors/src/youtube/mediaSource.ts`
 * (`YouTubeCatalogSourceAdapter`) — structurally, without either package
 * importing the other. The compatibility is pinned by a compile-time
 * assignment in `packages/connectors/tests/youtube-media-slice.test.ts`
 * (the connectors typecheck covers tests/), so shape drift fails the gate.
 *
 * Laws encoded here:
 *   - HONEST STATES ARE DATA: every engine method resolves with
 *     `{ kind: "ok", value }` or `{ kind: "honest-state", capability }`
 *     (the frozen §2.3 OperationCapability vocabulary — the connectors-side
 *     adapter produces it via `searchCapabilityFromError`, so quota/rate/
 *     auth/network truths cross this seam as DATA, never thrown errors).
 *   - THE CANONICAL ITEM RIDES VERBATIM: rows carry the frozen §2.1
 *     CatalogItem exactly as the connectors catalogMapping produced it
 *     (videoId in metadata.externalIds.youtube, official CDN thumbnails
 *     among assets) plus provider-reported display facts; nothing is
 *     mirrored or re-shaped.
 *   - SOURCE-REPORTED ONLY: every optional fact is what the provider
 *     actually reported on the call that produced the row — absent stays
 *     absent (search snippets carry no subscriber counts; playlist rows
 *     carry no durations until the documented enrichment read).
 *   - THE HANDLE LAW (freeze §9.5): a composition with NO configured API
 *     key hands the producers a `{ kind: "requires-auth" }` handle — every
 *     Data-API-backed surface then answers the frozen requires-auth phase,
 *     never fabricated rows.
 */
import type { CatalogItem, OperationCapability } from "webflix-contracts";

// ---------------------------------------------------------------------------
// Row shapes (structurally satisfied by the connectors-side adapter)
// ---------------------------------------------------------------------------

/** One watchable row: the canonical CatalogItem plus display facts. */
export interface YouTubeVideoRow {
  /** The canonical CatalogItem (catalogMapping output) — rides VERBATIM into card views. */
  readonly item: CatalogItem;
  readonly channelId?: string;
  readonly channelTitle?: string;
  /** ISO-8601 publish instant as the provider reported it. */
  readonly publishedAt?: string;
  /** View count as the provider reported it (statistics.viewCount). */
  readonly viewCount?: number;
  /** Duration in ms parsed from the provider's contentDetails.duration. */
  readonly durationMs?: number;
  /** The provider's liveBroadcastContent ("live" | "none" | "upcoming" | "completed"). */
  readonly liveBroadcastContent?: string;
  /** Highest-resolution official thumbnail URL the provider reported. */
  readonly thumbnailUrl?: string;
}

/** A channel as the engine surfaces it (only what the provider reported). */
export interface YouTubeChannelSummary {
  readonly channelId: string;
  readonly title: string;
  /** The @handle form (customUrl). Absent when the API reports none. */
  readonly handle?: string;
  readonly description?: string;
  /** statistics.subscriberCount (channels.list lookups only — search snippets omit it). */
  readonly subscriberCount?: number;
  readonly videoCount?: number;
  /** The channel's own publishedAt (its "joined" instant). */
  readonly publishedAt?: string;
  /** The official uploads-playlist id when the lookup requested contentDetails. */
  readonly uploadsPlaylistId?: string;
  readonly thumbnailUrl?: string;
  /** brandingSettings banner (lookup path only; honest absence otherwise). */
  readonly bannerUrl?: string;
  readonly country?: string;
}

/** Quota-ledger facts the producers surface in budget notes. */
export interface YouTubeSourceBudgetSnapshot {
  readonly state: "ok" | "low" | "exhausted";
  readonly unitsUsedToday: number;
  readonly unitsLimitToday: number;
  readonly unitsRemainingToday: number;
  readonly searchCallsRemainingToday: number;
}

/** One engine page: rows + the honest paging cursor + the post-call budget. */
export interface YouTubeSourcePage {
  readonly rows: readonly YouTubeVideoRow[];
  /** null = no further pages. */
  readonly nextPageToken: string | null;
  readonly budget: YouTubeSourceBudgetSnapshot;
  /** The provider's served-region echo, when the official response carries one. */
  readonly regionCode?: string;
}

/**
 * The honest-state union every engine method resolves with — DATA, never a
 * thrown provider error at this seam.
 */
export type YouTubeSourceOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "honest-state"; readonly capability: OperationCapability };

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * The official-YouTube engine behind every media producer. Implementations:
 * the connectors-side `YouTubeCatalogSourceAdapter` (real, fixture-tested),
 * the labeled fakes in tests. Documented official quota costs per method
 * live in the adapter's docblock and the provider policy matrix.
 */
export interface YouTubeCatalogSource {
  /** search.list type=video + the documented enrichment read. */
  searchVideos(input: {
    q: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>>;
  /** search.list type=channel — candidates for resolution + the search page rail. */
  searchChannels(input: {
    q: string;
    maxResults?: number;
  }): Promise<YouTubeSourceOutcome<{ readonly channels: readonly YouTubeChannelSummary[] }>>;
  /** videos.list chart=mostPopular — the trending/home engine. */
  trending(input: {
    regionCode?: string;
    videoCategoryId?: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>>;
  /** channels.list by id. `{ channel: null }` = the provider's no-such-channel answer. */
  channelById(channelId: string): Promise<
    YouTubeSourceOutcome<{ readonly channel: YouTubeChannelSummary | null }>
  >;
  /** channels.list forHandle. `{ channel: null }` = the provider's no-such-handle answer. */
  channelByHandle(handle: string): Promise<
    YouTubeSourceOutcome<{ readonly channel: YouTubeChannelSummary | null }>
  >;
  /** The channel's uploads shelf (channels.list contentDetails + playlistItems.list + enrichment). */
  channelUploads(input: {
    channelId: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>>;
  /** The quota-ledger view for budget notes. */
  budget(): YouTubeSourceBudgetSnapshot;
}

/**
 * What a composition hands the producers: the engine, or the honest
 * no-key state (freeze §9.5). Built app-side from the connectors
 * composition root's outcome
 * (`createLiveYouTubeComposition` → live | requires-auth) or by test
 * harnesses; the requires-auth handle maps onto the frozen
 * MediaViewPhase "requires-auth" on every Data-API-backed surface.
 */
export type YouTubeCatalogSourceHandle =
  | { readonly kind: "source"; readonly source: YouTubeCatalogSource }
  | { readonly kind: "requires-auth"; readonly detail: string };
