/**
 * YouTube service glue — quota-ledger-aware search/browse paths and the
 * catalog→playback watch bridge (YOUTUBE-EXPAND scope rows 1–3).
 *
 * What lives here (and why):
 *   - search/browse functions that pair a dataApi call with the canonical
 *     catalog mapping AND the live SearchBudgetSnapshot, so the app layer
 *     gets items + honest remaining-quota in one step ("surface
 *     remaining-quota honestly in the shell" — the app maps the snapshot
 *     onto the shell's structural SearchBudgetView; the shell itself never
 *     depends on this package, per architecture-policy dependency rules);
 *   - playbackPlanForCatalogItem: CatalogItem → canonical PlaybackPlan via
 *     the official IFrame embed builder (catalog → connector → playback →
 *     the shell WatchScreen renders embedSpec.embedUrl);
 *   - searchCapabilityFromError: typed dataApi errors → frozen §2.3
 *     OperationCapability, so an honest failure maps straight onto the
 *     shell's honest-state vocabulary (rate-limited / requires-auth /
 *     unavailable / unknown) without the app guessing.
 *
 * Fixture-tested only, exactly like the client: the network boundary stays
 * an injected fetch; live smoke status is recorded in the parity matrix.
 */
import type { CatalogItem, OperationCapability, PlaybackPlan } from "webflix-contracts";
import {
  LiveNetworkDisabledError,
  MissingCredentialError,
  NotFoundError,
  QuotaExceededError,
  RateLimitedError,
  SearchBudgetSnapshot,
  YouTubeApiError,
  YouTubeDataApiClient,
  YouTubeListResponse,
  YouTubePlaylistItemsItem,
  YouTubeSearchItem,
  YouTubeVideoItem,
} from "./dataApi";
import {
  catalogItemsFromPlaylistItemsResponse,
  catalogItemsFromSearchResponse,
  catalogItemsFromVideosResponse,
  playlistDescriptorsFromResponse,
  uploadsPlaylistIdOf,
  videoIdOf,
  type YouTubePlaylistDescriptor,
} from "./catalogMapping";
import { buildYouTubePlaybackPlan, InvalidVideoIdError } from "./playback";
import { YOUTUBE_MANIFEST_VERSION, YOUTUBE_PROVIDER_ID } from "./manifest";

/** One browse/search result page: canonical items + the honest budget after the call. */
export interface YouTubeCatalogPage {
  items: readonly CatalogItem[];
  budget: SearchBudgetSnapshot;
  nextPageToken: string | undefined;
}

export interface YouTubeBrowseContext {
  /** ISO 8601 instant stamped on availability facts (tests pass a fixed clock). */
  observedAt?: string;
}

function isoNow(): string {
  return new Date().toISOString();
}

function pageOf(
  items: readonly CatalogItem[],
  budget: SearchBudgetSnapshot,
  response: { nextPageToken?: string },
): YouTubeCatalogPage {
  return {
    items,
    budget,
    nextPageToken: typeof response?.nextPageToken === "string" ? response.nextPageToken : undefined,
  };
}

// ---------------------------------------------------------------------------
// Search (search.list — 100 units, the quota-binding call)
// ---------------------------------------------------------------------------

/** Keyword search across videos, mapped to canonical CatalogItems. */
export async function searchYouTubeCatalog(
  client: YouTubeDataApiClient,
  params: { q: string; maxResults?: number; pageToken?: string; regionCode?: string },
  context: YouTubeBrowseContext = {},
): Promise<YouTubeCatalogPage> {
  const response = await client.searchVideos({
    q: params.q,
    type: "video",
    maxResults: params.maxResults,
    pageToken: params.pageToken,
    regionCode: params.regionCode,
  });
  const items = catalogItemsFromSearchResponse(response, {
    observedAt: context.observedAt ?? isoNow(),
  });
  return pageOf(items, client.getSearchBudget(), response);
}

// ---------------------------------------------------------------------------
// Browse (videos.list chart=mostPopular — 1 unit)
// ---------------------------------------------------------------------------

/** Trending browse via the official mostPopular chart. */
export async function trendingYouTubeCatalog(
  client: YouTubeDataApiClient,
  params: { regionCode?: string; maxResults?: number; pageToken?: string } = {},
  context: YouTubeBrowseContext = {},
): Promise<YouTubeCatalogPage> {
  const response = await client.getTrendingVideos(params);
  const items = catalogItemsFromVideosResponse(response, {
    regionCode: params.regionCode,
    observedAt: context.observedAt ?? isoNow(),
    provenance: "provider-native: videos.list chart=mostPopular trending row",
  });
  return pageOf(items, client.getSearchBudget(), response);
}

// ---------------------------------------------------------------------------
// Channel browse (channels.list + playlists.list + playlistItems.list — 1 unit each)
// ---------------------------------------------------------------------------

/** A channel's playlists as honest browse CONTAINERS (not watchable items). */
export async function listChannelPlaylists(
  client: YouTubeDataApiClient,
  params: { channelId: string; maxResults?: number; pageToken?: string },
): Promise<{
  playlists: readonly YouTubePlaylistDescriptor[];
  budget: SearchBudgetSnapshot;
  nextPageToken: string | undefined;
}> {
  const response = await client.getPlaylists(params);
  const playlists = playlistDescriptorsFromResponse(response);
  return {
    playlists,
    budget: client.getSearchBudget(),
    nextPageToken: typeof response?.nextPageToken === "string" ? response.nextPageToken : undefined,
  };
}

/** The videos of one playlist (playlistItems.list), mapped to CatalogItems. */
export async function playlistVideosCatalog(
  client: YouTubeDataApiClient,
  params: { playlistId: string; maxResults?: number; pageToken?: string },
  context: YouTubeBrowseContext = {},
): Promise<YouTubeCatalogPage> {
  const response = await client.getPlaylistItems(params);
  const items = catalogItemsFromPlaylistItemsResponse(response, {
    observedAt: context.observedAt ?? isoNow(),
  });
  return pageOf(items, client.getSearchBudget(), response);
}

/**
 * A channel's uploads shelf: channels.list (part=contentDetails) → the
 * official relatedPlaylists.uploads id → playlistItems.list. This is also
 * the honest degrade path for "new videos from subscribed channels"
 * (AUDIT-SOURCES §2: no direct subscriptions-feed API; poll uploads
 * playlists — quota-hungry, so callers must batch sparingly).
 */
export async function channelUploadsCatalog(
  client: YouTubeDataApiClient,
  params: { channelId: string; maxResults?: number; pageToken?: string },
  context: YouTubeBrowseContext = {},
): Promise<YouTubeCatalogPage & { playlistId: string | null }> {
  const channel = await client.getChannel({
    id: params.channelId,
    parts: ["snippet", "contentDetails"],
  });
  const uploadsId = uploadsPlaylistIdOf(channel);
  if (uploadsId === null) {
    // Honest empty: the provider returned no uploads playlist for this channel.
    return {
      items: [],
      budget: client.getSearchBudget(),
      nextPageToken: undefined,
      playlistId: null,
    };
  }
  const page = await playlistVideosCatalog(
    client,
    { playlistId: uploadsId, maxResults: params.maxResults, pageToken: params.pageToken },
    context,
  );
  return { ...page, playlistId: uploadsId };
}

// ---------------------------------------------------------------------------
// Watch bridge (catalog item → canonical PlaybackPlan)
// ---------------------------------------------------------------------------

export interface YouTubeWatchOptions {
  /** Pinned origin — required to enable the IFrame JS API (official guidance). */
  origin?: string;
  startSeconds?: number;
  autoplay?: boolean;
  relatedVideos?: boolean;
  privacyEnhanced?: boolean;
  captions?: boolean;
  captionsLanguage?: string;
  interfaceLanguage?: string;
}

/**
 * Builds the canonical PlaybackPlan for a YouTube-attributed CatalogItem
 * (official IFrame embed — the one reusable playback mechanism). The plan's
 * embedSpec carries embedUrl, the key the shell WatchScreen renders.
 *
 * Total and honest:
 *   - non-YouTube item                → unavailable{unsupported, open-system-settings}
 *   - YouTube item without a usable id → unavailable{unsupported, open-provider-app}
 *   - valid video id                  → official-embed plan (builder validates
 *                                        the id against the official pattern)
 */
export function playbackPlanForCatalogItem(
  item: CatalogItem,
  options: YouTubeWatchOptions = {},
): PlaybackPlan {
  if (!item || item.providerId !== YOUTUBE_PROVIDER_ID) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-system-settings",
        message: `Only YouTube items resolve through the YouTube connector; "${item?.providerId ?? "unknown"}" is not installed for this item.`,
      },
    };
  }

  const videoId = videoIdOf(item);
  if (videoId === null) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: `"${item.title}" carries no usable YouTube video id, so no official embed can be built. Watch it on YouTube.`,
      },
    };
  }

  try {
    return buildYouTubePlaybackPlan({
      videoId,
      title: item.title,
      origin: options.origin,
      startSeconds: options.startSeconds,
      autoplay: options.autoplay,
      relatedVideos: options.relatedVideos,
      privacyEnhanced: options.privacyEnhanced,
      captions: options.captions,
      captionsLanguage: options.captionsLanguage,
      interfaceLanguage: options.interfaceLanguage,
    });
  } catch (error) {
    if (error instanceof InvalidVideoIdError) {
      return {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-provider-app",
          message: `"${item.title}" does not carry a well-formed YouTube video id, so the official embed cannot be built. Watch it on YouTube.`,
        },
      };
    }
    throw error;
  }
}

/**
 * Structural adapter for the playback package's resolver seam
 * (resolvePlaybackPlan's Connector record: {id, providerId, version,
 * embed: {providerId, urlTemplate, allowsEmbedding}}). The playback package
 * accepts structural input and connectors must not import it — the app layer
 * passes this constant to the resolver, whose output plan is the same
 * official-embed kind (embedSpec.embedUrl resolved from the template).
 */
export const YOUTUBE_PLAYBACK_CONNECTOR = {
  id: "youtube",
  providerId: YOUTUBE_PROVIDER_ID,
  version: YOUTUBE_MANIFEST_VERSION,
  embed: {
    providerId: YOUTUBE_PROVIDER_ID,
    urlTemplate: "https://www.youtube-nocookie.com/embed/{mediaId}",
    allowsEmbedding: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Honest-state mapping (typed errors → frozen §2.3 OperationCapability)
// ---------------------------------------------------------------------------

/**
 * Maps a typed dataApi error onto the frozen OperationCapability vocabulary
 * so the shell's searchStateFromCapability renders the honest state:
 * quota/rate-limit → rate-limited (first-class UX state per the work order),
 * missing credential → requires-auth, not-found/other API errors →
 * unavailable, fixture-only build refusal → unknown (the check did not
 * complete — never dressed up as anything else).
 */
export function searchCapabilityFromError(error: unknown): OperationCapability {
  if (error instanceof QuotaExceededError || error instanceof RateLimitedError) {
    return { status: "rate-limited", detail: (error as Error).message };
  }
  if (error instanceof MissingCredentialError) {
    return { status: "requires-auth", detail: (error as Error).message };
  }
  if (error instanceof NotFoundError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  if (error instanceof LiveNetworkDisabledError) {
    return {
      status: "unknown",
      detail: `${(error as Error).message} (capability check not completed)`,
    };
  }
  if (error instanceof YouTubeApiError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  return {
    status: "unknown",
    detail: `unexpected error while searching: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

// Re-exported response types used by the service signatures ( callers should
// not need to reach into dataApi.ts for the structural page types).
export type { YouTubeListResponse, YouTubeSearchItem, YouTubeVideoItem, YouTubePlaylistItemsItem };
