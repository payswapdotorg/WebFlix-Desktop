/**
 * YouTube API payloads → canonical CatalogItems (frozen §2.1).
 *
 * YOUTUBE-EXPAND (scope row 1/2): the mapping that lets official YouTube
 * responses enter the WebFlix catalog as provider-attributed CatalogItems —
 * the unit the catalog merge scores and the playback resolver plans.
 *
 * Canonical shape discipline (no mirror vocabulary):
 *   - provider attribution is ITEM-level: providerId "youtube" on every item;
 *   - the provider's own ids live in metadata.externalIds.youtube (the
 *     metadata bag is the canonical home for external descriptors);
 *   - thumbnails become ProviderAssets (kind "thumbnail", reference = the
 *     official CDN URL); the official embed surface becomes a ProviderAsset
 *     (kind "embed", reference = the youtube-nocookie.com embed URL);
 *   - one optional AvailabilityFact, only when a region is actually known
 *     (search responses carry regionCode; id-based reads carry none — an
 *     honest absence, never a fabricated region);
 *   - MatchEvidence documents the provider-native provenance (a search hit
 *     or a playlist listing IS the provider's own row — confidence 1);
 *   - mediaKind: "video" normally, "live" when the provider says
 *     liveBroadcastContent === "live" (honest, never guessed).
 *
 * ADR-0003: only official-surface data enters this mapping. No scraping,
 * no private payloads, no synthesized fields.
 */
import type { AvailabilityFact, CatalogItem, MediaKind, ProviderAsset } from "webflix-contracts";
import type {
  YouTubeChannelItem,
  YouTubeListResponse,
  YouTubePlaylistItemsItem,
  YouTubeSearchItem,
  YouTubeSnippet,
  YouTubeThumbnails,
  YouTubeVideoItem,
} from "./dataApi";
import { YOUTUBE_PROVIDER_ID } from "./manifest";
import { YOUTUBE_VIDEO_ID_PATTERN } from "./playback";

/** The canonical metadata key for the provider's own video id. */
export const YOUTUBE_VIDEO_ID_METADATA_KEY = "youtube";

/** Official embed host used for embed asset references (privacy-enhanced). */
const EMBED_REFERENCE_PREFIX = "https://www.youtube-nocookie.com/embed/";

function isValidVideoId(videoId: unknown): videoId is string {
  return typeof videoId === "string" && YOUTUBE_VIDEO_ID_PATTERN.test(videoId);
}

function mediaKindForSnippet(snippet: YouTubeSnippet | undefined): MediaKind {
  return snippet?.liveBroadcastContent === "live" ? "live" : "video";
}

function yearOf(publishedAt: string | undefined): number | undefined {
  if (typeof publishedAt !== "string" || publishedAt.length < 4) return undefined;
  const year = Number(publishedAt.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
}

function thumbnailAssets(
  videoId: string,
  thumbnails: YouTubeThumbnails | undefined,
): ProviderAsset[] {
  if (!thumbnails) return [];
  const assets: ProviderAsset[] = [];
  for (const [size, thumb] of Object.entries(thumbnails)) {
    if (!thumb || typeof thumb.url !== "string" || thumb.url === "") continue;
    assets.push({
      assetId: `youtube:thumb:${videoId}:${size}`,
      kind: "thumbnail",
      reference: thumb.url,
      mimeType: "image/jpeg",
    });
  }
  return assets;
}

function embedAsset(videoId: string): ProviderAsset {
  return {
    assetId: `youtube:embed:${videoId}`,
    kind: "embed",
    reference: `${EMBED_REFERENCE_PREFIX}${videoId}`,
  };
}

function availabilityFor(
  region: string | undefined,
  observedAt: string,
): AvailabilityFact | undefined {
  // Region codes arrive as ISO 3166-1 alpha-2 from the provider; anything
  // else is treated as unknown (no fact — honest absence).
  if (typeof region !== "string" || !/^[A-Z]{2}$/.test(region)) return undefined;
  return {
    providerId: YOUTUBE_PROVIDER_ID,
    region,
    available: true,
    observedAt,
    note: "Observed from the provider's official response envelope.",
  };
}

function baseVideoItem(
  videoId: string,
  snippet: YouTubeSnippet | undefined,
  provenanceEvidence: string,
  region: string | undefined,
  observedAt: string,
): CatalogItem {
  const metadata: Record<string, unknown> = {
    externalIds: { [YOUTUBE_VIDEO_ID_METADATA_KEY]: videoId },
  };
  if (snippet?.channelId) metadata.channelId = snippet.channelId;
  if (snippet?.channelTitle) metadata.channelTitle = snippet.channelTitle;
  if (snippet?.publishedAt) metadata.publishedAt = snippet.publishedAt;
  if (snippet?.liveBroadcastContent && snippet.liveBroadcastContent !== "none") {
    metadata.liveBroadcastContent = snippet.liveBroadcastContent;
  }
  const year = yearOf(snippet?.publishedAt);
  if (year !== undefined) metadata.year = year;

  return {
    id: `${YOUTUBE_PROVIDER_ID}:video:${videoId}`,
    providerId: YOUTUBE_PROVIDER_ID,
    title: snippet?.title && snippet.title.length > 0 ? snippet.title : `YouTube video ${videoId}`,
    mediaKind: mediaKindForSnippet(snippet),
    assets: [embedAsset(videoId), ...thumbnailAssets(videoId, snippet?.thumbnails)],
    matchEvidence: {
      confidence: 1,
      evidence: [provenanceEvidence],
    },
    availability: availabilityFor(region, observedAt),
    metadata,
  };
}

/**
 * Maps one search.list item (id.kind youtube#video) into a CatalogItem.
 * Non-video results (channels, playlists) return null — they are browse
 * containers, not watchable items; inventing a mediaKind for them would be
 * dishonest.
 */
export function catalogItemFromSearchItem(
  item: YouTubeSearchItem,
  context: { regionCode?: string; observedAt: string },
): CatalogItem | null {
  if (item?.id?.kind !== "youtube#video" || !isValidVideoId(item.id.videoId)) return null;
  return baseVideoItem(
    item.id.videoId,
    item.snippet,
    `provider-native: search.list hit videoId=${item.id.videoId}`,
    context.regionCode,
    context.observedAt,
  );
}

/** Maps a full search.list response page into watchable CatalogItems. */
export function catalogItemsFromSearchResponse(
  response: YouTubeListResponse<YouTubeSearchItem>,
  context: { observedAt: string },
): CatalogItem[] {
  const regionCode = typeof response?.regionCode === "string" ? response.regionCode : undefined;
  const items: CatalogItem[] = [];
  for (const item of response?.items ?? []) {
    const mapped = catalogItemFromSearchItem(item, { ...context, regionCode });
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

/** Maps one videos.list item (direct id read or chart=mostPopular trending row). */
export function catalogItemFromVideoItem(
  item: YouTubeVideoItem,
  context: { regionCode?: string; observedAt: string; provenance: string },
): CatalogItem | null {
  if (!isValidVideoId(item?.id)) return null;
  return baseVideoItem(
    item.id,
    item.snippet,
    context.provenance,
    context.regionCode,
    context.observedAt,
  );
}

/** Maps a full videos.list response page (trending or id read). */
export function catalogItemsFromVideosResponse(
  response: YouTubeListResponse<YouTubeVideoItem>,
  context: { regionCode?: string; observedAt: string; provenance: string },
): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const item of response?.items ?? []) {
    const mapped = catalogItemFromVideoItem(item, context);
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

/** Maps one playlistItems.list row into the video it lists (watchable). */
export function catalogItemFromPlaylistItem(
  item: YouTubePlaylistItemsItem,
  context: { observedAt: string },
): CatalogItem | null {
  const videoId = item?.snippet?.resourceId?.videoId;
  if (item?.snippet?.resourceId?.kind !== "youtube#video" || !isValidVideoId(videoId)) return null;
  return baseVideoItem(
    videoId,
    item.snippet,
    `provider-native: playlistItems.list entry videoId=${videoId} (playlist ${
      item.snippet.playlistId ?? "unknown"
    })`,
    undefined,
    context.observedAt,
  );
}

/** Maps a full playlistItems.list response page into watchable CatalogItems. */
export function catalogItemsFromPlaylistItemsResponse(
  response: YouTubeListResponse<YouTubePlaylistItemsItem>,
  context: { observedAt: string },
): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const item of response?.items ?? []) {
    const mapped = catalogItemFromPlaylistItem(item, context);
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

/**
 * Extracts the provider video id from a CatalogItem — the catalog→watch
 * bridge. Priority: the canonical metadata bag (externalIds.youtube), then
 * a provider embed asset reference (/embed/<id>), then the embed assetId
 * ("youtube:embed:<id>"). Returns null when the item carries no usable id.
 */
export function videoIdOf(item: CatalogItem): string | null {
  if (!item || item.providerId !== YOUTUBE_PROVIDER_ID) return null;

  const external = item.metadata?.externalIds;
  if (external !== null && typeof external === "object" && !Array.isArray(external)) {
    const candidate = (external as Record<string, unknown>)[YOUTUBE_VIDEO_ID_METADATA_KEY];
    if (isValidVideoId(candidate)) return candidate;
  }

  for (const asset of item.assets ?? []) {
    if (asset.kind !== "embed") continue;
    const fromReference = asset.reference.split("/embed/")[1];
    if (isValidVideoId(fromReference)) return fromReference;
    if (asset.assetId.startsWith("youtube:embed:")) {
      const fromAssetId = asset.assetId.slice("youtube:embed:".length);
      if (isValidVideoId(fromAssetId)) return fromAssetId;
    }
  }
  return null;
}

/**
 * Channel playlist descriptor — playlists are browse CONTAINERS, not
 * watchable items, so they surface as honest descriptors (never a fake
 * mediaKind) until their items are read via playlistItems.list.
 */
export interface YouTubePlaylistDescriptor {
  playlistId: string;
  title: string;
  itemCount: number | undefined;
  publishedAt: string | undefined;
  channelId: string | undefined;
}

export function playlistDescriptorsFromResponse(
  response: YouTubeListResponse<{
    id: string;
    snippet?: YouTubeSnippet & { channelTitle?: string };
    contentDetails?: Record<string, unknown>;
  }>,
): YouTubePlaylistDescriptor[] {
  const descriptors: YouTubePlaylistDescriptor[] = [];
  for (const playlist of response?.items ?? []) {
    if (typeof playlist?.id !== "string" || playlist.id === "") continue;
    const itemCountRaw = (playlist.contentDetails as { itemCount?: unknown } | undefined)
      ?.itemCount;
    descriptors.push({
      playlistId: playlist.id,
      title: playlist.snippet?.title ?? `YouTube playlist ${playlist.id}`,
      itemCount:
        typeof itemCountRaw === "number"
          ? itemCountRaw
          : typeof itemCountRaw === "string" &&
              itemCountRaw !== "" &&
              Number.isFinite(Number(itemCountRaw))
            ? Number(itemCountRaw)
            : undefined,
      publishedAt: playlist.snippet?.publishedAt,
      channelId: playlist.snippet?.channelId,
    });
  }
  return descriptors;
}

/**
 * The uploads-playlist id from a channels.list item that requested
 * part=contentDetails (official: contentDetails.relatedPlaylists.uploads).
 * Returns null when the response carries no uploads playlist (honest).
 */
export function uploadsPlaylistIdOf(channel: YouTubeChannelItem): string | null {
  const related = (
    channel?.contentDetails as { relatedPlaylists?: { uploads?: unknown } } | undefined
  )?.relatedPlaylists;
  const uploads = related?.uploads;
  return typeof uploads === "string" && uploads !== "" ? uploads : null;
}
