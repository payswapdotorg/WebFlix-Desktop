/**
 * YouTube media-source adapter (WFX-PROVIDER-SLICE-1) — the engine that
 * feeds the media-producer use cases in `webflix-application`.
 *
 * ARCHITECTURE (freeze §1 layering, honored by construction):
 * the application layer is INWARD of this adapters layer, so
 * `webflix-application` must NOT import this package. Instead, the
 * application owns a structural port (`webflix-application/src/media/
 * youtube-source-port.ts` — `YouTubeCatalogSource`) whose member shapes are
 * expressible entirely in `webflix-contracts` types plus app-owned data
 * rows. THIS adapter implements that surface STRUCTURALLY: it never imports
 * `webflix-application`, and its compatibility with the app port is pinned
 * by a compile-time assignment in the hermetic integration suite
 * (`packages/connectors/tests/youtube-media-slice.test.ts` — the
 * connectors typecheck covers tests/, so drift between the two shapes
 * fails `pnpm --filter connectors typecheck`).
 *
 * What this adapter adds over the raw client:
 *   - CATALOG ITEMS VIA THE EXISTING MAPPING: every row carries the canonical
 *     CatalogItem from `catalogMapping` (videoId in metadata.externalIds.
 *     youtube, official CDN thumbnails among assets) plus the display facts
 *     the card views need (viewCount from statistics, durationMs parsed
 *     from contentDetails.duration, publishedAt, best thumbnail URL).
 *   - LABEL-ENRICHMENT, QUOTA-AWARE (documented costs): search.list snippets
 *     carry no view counts, and playlistItems.list rows carry no durations —
 *     so the surfaces that need those facts run ONE extra videos.list id-read
 *     (official cost: 1 unit) for the page's ids and merge the facts in.
 *     Enrichment failures degrade HONESTLY: the page is still returned with
 *     the facts absent (no viewsLabel/durationLabel — never fabricated),
 *     because the primary official call DID succeed. Per-page costs:
 *       search page      = 100 (search.list) + 1 (enrichment)  = 101 units
 *       trending page    = 1 (videos.list chart — facts included)
 *       channel page     = 1 (channels.list w/ statistics) + 2 (channels.list
 *                          contentDetails + playlistItems.list) + 1
 *                          (enrichment)                          = 4 units
 *       append page      = 1 (playlistItems.list) + 1 (enrichment) = 2 units
 *       channel search   = 100 (search.list type=channel)
 *       handle/id lookup = 1 (channels.list)
 *   - HONEST STATES AS DATA: every method resolves with
 *     `{ kind: "ok", value }` or `{ kind: "honest-state", capability }` where
 *     the capability comes from `searchCapabilityFromError` (the frozen §2.3
 *     vocabulary) — a typed errors → data mapping INSIDE this adapters layer,
 *     so the app layer never sees a thrown provider error at its port
 *     boundary. `NotFoundError` from a channels.list lookup is special-cased
 *     to `{ channel: null }` (the provider's own "no such channel" answer —
 *     an ok outcome, not an error).
 *
 * FIXTURE-TESTED ONLY, exactly like the client beneath it: the network
 * boundary stays an injected fetch; live smoke is pending-operator-credential
 * (the live composition root lives in ./liveComposition.ts).
 */
import type { CatalogItem, OperationCapability } from "webflix-contracts";
import {
  NotFoundError,
  SearchBudgetSnapshot,
  YouTubeDataApiClient,
  YouTubeChannelItem,
  YouTubeListResponse,
  YouTubeSearchItem,
  YouTubeSnippet,
  YouTubeThumbnails,
  YouTubeVideoItem,
} from "./dataApi";
import {
  catalogItemsFromSearchResponse,
  catalogItemsFromVideosResponse,
  videoIdOf,
  uploadsPlaylistIdOf,
} from "./catalogMapping";
import { channelUploadsCatalog, searchCapabilityFromError } from "./service";

/** This adapter's version (rides the federated-search descriptor + matrix rows). */
export const YOUTUBE_MEDIA_SOURCE_ADAPTER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Structural row shapes (mirror-compatible with the app-owned port — pinned
// by the integration suite's compile-time assignments; see module docblock)
// ---------------------------------------------------------------------------

/** One watchable row: the canonical CatalogItem plus provider-reported display facts. */
export interface YouTubeVideoRow {
  /** The canonical CatalogItem from catalogMapping — rides VERBATIM into card views. */
  readonly item: CatalogItem;
  readonly channelId?: string;
  readonly channelTitle?: string;
  /** ISO-8601 publish instant (snippet.publishedAt). */
  readonly publishedAt?: string;
  /** View count from statistics.viewCount (present after enrichment or chart reads). */
  readonly viewCount?: number;
  /** Duration in ms parsed from contentDetails.duration. */
  readonly durationMs?: number;
  /** snippet.liveBroadcastContent ("live" | "none" | "upcoming" | "completed"). */
  readonly liveBroadcastContent?: string;
  /** Best available thumbnail URL (maxres > standard > high > medium > default). */
  readonly thumbnailUrl?: string;
}

/** A channel as the engine surfaces it (all fields the API actually reported). */
export interface YouTubeChannelSummary {
  readonly channelId: string;
  readonly title: string;
  /** customUrl (the @handle form). Absent when the API reports none. */
  readonly handle?: string;
  readonly description?: string;
  /** statistics.subscriberCount (channels.list only; search snippets omit it). */
  readonly subscriberCount?: number;
  readonly videoCount?: number;
  readonly publishedAt?: string;
  readonly uploadsPlaylistId?: string;
  readonly thumbnailUrl?: string;
  /** brandingSettings.image.bannerExternalUrl (requested on lookups; honest absence otherwise). */
  readonly bannerUrl?: string;
  readonly country?: string;
}

/** Quota-ledger facts the producers surface (subset of SearchBudgetSnapshot). */
export interface YouTubeSourceBudgetSnapshot {
  readonly state: "ok" | "low" | "exhausted";
  readonly unitsUsedToday: number;
  readonly unitsLimitToday: number;
  readonly unitsRemainingToday: number;
  readonly searchCallsRemainingToday: number;
}

/** One engine page of rows + the honest paging cursor + the post-call budget. */
export interface YouTubeSourcePage {
  readonly rows: readonly YouTubeVideoRow[];
  /** null = no further pages. */
  readonly nextPageToken: string | null;
  readonly budget: YouTubeSourceBudgetSnapshot;
  /** The provider's served-region echo, when the official response carries one. */
  readonly regionCode?: string;
}

/** The honest-state union every engine method resolves with (DATA, never throws). */
export type YouTubeSourceOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "honest-state"; readonly capability: OperationCapability };

// ---------------------------------------------------------------------------
// Deterministic helpers (official payload facts → row facts)
// ---------------------------------------------------------------------------

const THUMBNAIL_SIZE_ORDER = ["maxres", "standard", "high", "medium", "default"] as const;

/** Picks the highest-resolution official thumbnail URL the snippet reported. */
export function bestThumbnailUrlOf(thumbnails: YouTubeThumbnails | undefined): string | undefined {
  if (!thumbnails) return undefined;
  for (const size of THUMBNAIL_SIZE_ORDER) {
    const url = thumbnails[size]?.url;
    if (typeof url === "string" && url !== "") return url;
  }
  return undefined;
}

/**
 * Parses the official ISO-8601 duration (contentDetails.duration, e.g.
 * "PT4M13S", "PT1H2M3S", "PT45S") into milliseconds. Returns undefined for
 * anything else (including "PT0S", which the API reports for live streams —
 * an honest absence of a duration, never a fake 0).
 */
export function parseIso8601DurationMs(duration: unknown): number | undefined {
  if (typeof duration !== "string" || !duration.startsWith("P")) return undefined;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
  if (match === null) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalMs = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  return totalMs > 0 ? totalMs : undefined;
}

function toCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
    return Math.max(0, Number(value));
  }
  return undefined;
}

function budgetSnapshotOf(budget: SearchBudgetSnapshot): YouTubeSourceBudgetSnapshot {
  return {
    state: budget.state,
    unitsUsedToday: budget.unitsUsedToday,
    unitsLimitToday: budget.unitsLimitToday,
    unitsRemainingToday: budget.unitsRemainingToday,
    searchCallsRemainingToday: budget.searchCallsRemainingToday,
  };
}

function metadataString(item: CatalogItem, key: string): string | undefined {
  const value = item.metadata?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Row facts already present on a mapped CatalogItem (catalogMapping's metadata bag). */
function rowFromItem(item: CatalogItem): YouTubeVideoRow {
  return {
    item,
    channelId: metadataString(item, "channelId"),
    channelTitle: metadataString(item, "channelTitle"),
    publishedAt: metadataString(item, "publishedAt"),
    liveBroadcastContent: metadataString(item, "liveBroadcastContent"),
    thumbnailUrl: bestThumbnailAssetUrlOf(item),
  };
}

/** Best thumbnail from the item's thumbnail assets (assetId: youtube:thumb:<id>:<size>). */
function bestThumbnailAssetUrlOf(item: CatalogItem): string | undefined {
  let best: { size: number; url: string } | undefined;
  for (const asset of item.assets ?? []) {
    if (asset.kind !== "thumbnail") continue;
    const size = asset.assetId.split(":")[3];
    const rank = THUMBNAIL_SIZE_ORDER.indexOf(size as (typeof THUMBNAIL_SIZE_ORDER)[number]);
    if (rank === -1) continue;
    if (best === undefined || rank < best.size) best = { size: rank, url: asset.reference };
  }
  return best?.url;
}

function statisticsOf(video: YouTubeVideoItem): { viewCount?: number; durationMs?: number } {
  const statistics = video.statistics as { viewCount?: unknown } | undefined;
  const contentDetails = video.contentDetails as { duration?: unknown } | undefined;
  return {
    viewCount: toCount(statistics?.viewCount),
    durationMs: parseIso8601DurationMs(contentDetails?.duration),
  };
}

/** Merges videos.list display facts into rows keyed by the canonical video id. */
function enrichRows(rows: readonly YouTubeVideoRow[], videos: readonly YouTubeVideoItem[]): YouTubeVideoRow[] {
  const factsById = new Map<string, { viewCount?: number; durationMs?: number }>();
  for (const video of videos) {
    if (typeof video?.id === "string") factsById.set(video.id, statisticsOf(video));
  }
  return rows.map((row) => {
    const videoId = videoIdOf(row.item);
    const facts = videoId !== null ? factsById.get(videoId) : undefined;
    if (facts === undefined) return row;
    return {
      ...row,
      viewCount: facts.viewCount ?? row.viewCount,
      durationMs: facts.durationMs ?? row.durationMs,
    };
  });
}

function channelSummaryOf(channel: YouTubeChannelItem): YouTubeChannelSummary {
  const snippet = channel.snippet as (YouTubeSnippet & { country?: string }) | undefined;
  const statistics = channel.statistics as
    | { subscriberCount?: unknown; videoCount?: number }
    | undefined;
  const branding = (channel as { brandingSettings?: { image?: { bannerExternalUrl?: unknown } } })
    .brandingSettings;
  const uploads = uploadsPlaylistIdOf(channel) ?? undefined;
  const subscriberCount = toCount((statistics as { subscriberCount?: unknown } | undefined)?.subscriberCount);
  const summary: YouTubeChannelSummary = {
    channelId: channel.id,
    title: snippet?.title && snippet.title !== "" ? snippet.title : `YouTube channel ${channel.id}`,
    handle: snippet?.customUrl,
    description: snippet?.description,
    subscriberCount,
    videoCount: toCount(statistics?.videoCount),
    publishedAt: snippet?.publishedAt,
    uploadsPlaylistId: uploads ?? undefined,
    thumbnailUrl: bestThumbnailUrlOf(snippet?.thumbnails),
    bannerUrl:
      typeof branding?.image?.bannerExternalUrl === "string" && branding.image.bannerExternalUrl !== ""
        ? branding.image.bannerExternalUrl
        : undefined,
    country: snippet?.country,
  };
  return summary;
}

/** Channel search results carry snippet facts only — subscriberCount stays absent (honest). */
function channelSummaryOfSearchItem(item: YouTubeSearchItem): YouTubeChannelSummary | null {
  const channelId = item?.id?.channelId;
  if (item?.id?.kind !== "youtube#channel" || typeof channelId !== "string" || channelId === "") {
    return null;
  }
  const snippet: YouTubeSnippet | undefined = item.snippet;
  return {
    channelId,
    title: snippet?.title && snippet.title !== "" ? snippet.title : `YouTube channel ${channelId}`,
    handle: snippet?.customUrl,
    description: snippet?.description,
    publishedAt: snippet?.publishedAt,
    thumbnailUrl: bestThumbnailUrlOf(snippet?.thumbnails),
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface YouTubeCatalogSourceAdapterOptions {
  /** ISO instant stamped onto mapped CatalogItems (tests inject a fixed clock). */
  readonly observedAt?: () => string;
}

/**
 * The official-Data-API engine behind the media producers. Every method
 * resolves with the honest-state union — provider failures surface as
 * `searchCapabilityFromError` capabilities, never as thrown errors.
 */
export class YouTubeCatalogSourceAdapter {
  private readonly client: YouTubeDataApiClient;
  private readonly observedAt: () => string;

  constructor(client: YouTubeDataApiClient, options: YouTubeCatalogSourceAdapterOptions = {}) {
    this.client = client;
    this.observedAt = options.observedAt ?? (() => new Date().toISOString());
  }

  /** The underlying client (composition roots pass it to the playback planner etc.). */
  get dataApiClient(): YouTubeDataApiClient {
    return this.client;
  }

  /**
   * search.list type=video (100 units) + ONE videos.list enrichment read
   * (1 unit) for the page's ids — search snippets carry no view counts and
   * no durations, and the card views need both. Enrichment failure degrades
   * honestly: the page returns without those facts (documented).
   */
  async searchVideos(input: {
    q: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    try {
      const response = await this.client.searchVideos({
        q: input.q,
        type: "video",
        maxResults: input.maxResults,
        pageToken: input.pageToken,
      });
      return { kind: "ok", value: await this.pageFromSearchResponse(response) };
    } catch (error) {
      return { kind: "honest-state", capability: searchCapabilityFromError(error) };
    }
  }

  /**
   * search.list type=channel (100 units) — channel candidates for the
   * channel-resolution journey and the search page's channel rail. The
   * official channel search snippet carries NO statistics: subscriberCount
   * stays absent until a channels.list lookup fills the resolved header.
   */
  async searchChannels(input: {
    q: string;
    maxResults?: number;
  }): Promise<YouTubeSourceOutcome<{ readonly channels: readonly YouTubeChannelSummary[] }>> {
    try {
      const response = await this.client.searchVideos({
        q: input.q,
        type: "channel",
        maxResults: input.maxResults,
      });
      const channels: YouTubeChannelSummary[] = [];
      for (const item of response?.items ?? []) {
        const summary = channelSummaryOfSearchItem(item);
        if (summary !== null) channels.push(summary);
      }
      return { kind: "ok", value: { channels } };
    } catch (error) {
      return { kind: "honest-state", capability: searchCapabilityFromError(error) };
    }
  }

  /**
   * videos.list chart=mostPopular (1 unit) — the trending/home engine. The
   * chart response already carries snippet+statistics+contentDetails, so no
   * enrichment call is needed.
   */
  async trending(input: {
    regionCode?: string;
    videoCategoryId?: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    try {
      const response = await this.client.getTrendingVideos({
        regionCode: input.regionCode,
        videoCategoryId: input.videoCategoryId,
        maxResults: input.maxResults,
        pageToken: input.pageToken,
      });
      const regionCode = typeof response?.regionCode === "string" ? response.regionCode : undefined;
      return { kind: "ok", value: await this.pageFromVideosResponse(response, regionCode) };
    } catch (error) {
      return { kind: "honest-state", capability: searchCapabilityFromError(error) };
    }
  }

  /** channels.list by id (1 unit). `{ channel: null }` = the provider's own no-such-channel answer. */
  async channelById(channelId: string): Promise<YouTubeSourceOutcome<{ readonly channel: YouTubeChannelSummary | null }>> {
    return this.lookupChannel({ id: channelId });
  }

  /**
   * channels.list forHandle (1 unit) — the handle path of channel resolution
   * and the channel surface. `{ channel: null }` = the provider's own
   * no-such-handle answer (fixture-tested; live verification pending the
   * operator's API key).
   */
  async channelByHandle(handle: string): Promise<YouTubeSourceOutcome<{ readonly channel: YouTubeChannelSummary | null }>> {
    return this.lookupChannel({ handle });
  }

  /**
   * A channel's uploads shelf via the existing channelUploadsCatalog path
   * (channels.list contentDetails + playlistItems.list = 2 units) plus ONE
   * videos.list enrichment read (1 unit) so durations/view counts exist for
   * labels and shorts classification.
   */
  async channelUploads(input: {
    channelId: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<YouTubeSourceOutcome<YouTubeSourcePage>> {
    try {
      const page = await channelUploadsCatalog(
        this.client,
        { channelId: input.channelId, maxResults: input.maxResults, pageToken: input.pageToken },
        { observedAt: this.observedAt() },
      );
      const rows = page.items.map((item) => rowFromItem(item));
      const enriched = await this.tryEnrich(rows);
      return {
        kind: "ok",
        value: {
          rows: enriched,
          nextPageToken: page.nextPageToken ?? null,
          budget: budgetSnapshotOf(this.client.getSearchBudget()),
        },
      };
    } catch (error) {
      return { kind: "honest-state", capability: searchCapabilityFromError(error) };
    }
  }

  /** The quota-ledger view the producers surface in budget notes. */
  budget(): YouTubeSourceBudgetSnapshot {
    return budgetSnapshotOf(this.client.getSearchBudget());
  }

  // ---- internals -------------------------------------------------------------

  private async lookupChannel(params: {
    id?: string;
    handle?: string;
  }): Promise<YouTubeSourceOutcome<{ readonly channel: YouTubeChannelSummary | null }>> {
    try {
      const channel = await this.client.getChannel({
        ...(params.id !== undefined ? { id: params.id } : {}),
        ...(params.handle !== undefined ? { handle: params.handle } : {}),
        parts: ["snippet", "statistics", "contentDetails", "brandingSettings"],
      });
      return { kind: "ok", value: { channel: channelSummaryOf(channel) } };
    } catch (error) {
      if (error instanceof NotFoundError) {
        // The provider answered "no such channel" — an ok outcome with null,
        // never dressed up as an error (the resolution use case's not-found).
        return { kind: "ok", value: { channel: null } };
      }
      return { kind: "honest-state", capability: searchCapabilityFromError(error) };
    }
  }

  /** search.list page → rows + honest enrichment (failures skip facts, documented). */
  private async pageFromSearchResponse(
    response: YouTubeListResponse<YouTubeSearchItem>,
  ): Promise<YouTubeSourcePage> {
    const items = catalogItemsFromSearchResponse(response, { observedAt: this.observedAt() });
    const rows = items.map((item) => rowFromItem(item));
    const regionCode = typeof response?.regionCode === "string" ? response.regionCode : undefined;
    return {
      rows: await this.tryEnrich(rows),
      nextPageToken: typeof response?.nextPageToken === "string" ? response.nextPageToken : null,
      budget: budgetSnapshotOf(this.client.getSearchBudget()),
      ...(regionCode !== undefined ? { regionCode } : {}),
    };
  }

  /** videos.list page (chart or id read) → rows (facts already on the response). */
  private async pageFromVideosResponse(
    response: YouTubeListResponse<YouTubeVideoItem>,
    regionCode: string | undefined,
  ): Promise<YouTubeSourcePage> {
    const items = catalogItemsFromVideosResponse(response, {
      regionCode,
      observedAt: this.observedAt(),
      provenance: "provider-native: videos.list chart=mostPopular trending row",
    });
    const rowsById = new Map<string, YouTubeVideoItem>();
    for (const video of response?.items ?? []) {
      if (typeof video?.id === "string") rowsById.set(video.id, video);
    }
    const rows = items.map((item) => {
      const base = rowFromItem(item);
      const videoId = videoIdOf(item);
      const video = videoId !== null ? rowsById.get(videoId) : undefined;
      if (video === undefined) return base;
      const facts = statisticsOf(video);
      const thumbnailUrl = bestThumbnailUrlOf(video.snippet?.thumbnails) ?? base.thumbnailUrl;
      return {
        ...base,
        viewCount: facts.viewCount ?? base.viewCount,
        durationMs: facts.durationMs ?? base.durationMs,
        thumbnailUrl,
      };
    });
    return {
      rows,
      nextPageToken: typeof response?.nextPageToken === "string" ? response.nextPageToken : null,
      budget: budgetSnapshotOf(this.client.getSearchBudget()),
      ...(regionCode !== undefined ? { regionCode } : {}),
    };
  }

  /**
   * ONE videos.list id-read (1 unit) merging viewCount/durationMs into the
   * rows. Enrichment failure degrades honestly — the primary call succeeded,
   * so the page is returned with the facts absent (never fabricated, never
   * a thrown error over a page that exists).
   */
  private async tryEnrich(rows: readonly YouTubeVideoRow[]): Promise<YouTubeVideoRow[]> {
    if (rows.length === 0) return [];
    const ids = rows
      .map((row) => videoIdOf(row.item))
      .filter((id): id is string => id !== null);
    if (ids.length === 0) return [...rows];
    try {
      const response = await this.client.getVideos({ ids });
      return enrichRows(rows, response?.items ?? []);
    } catch {
      // Honest degradation: labels for this page lack views/durations.
      return [...rows];
    }
  }
}
