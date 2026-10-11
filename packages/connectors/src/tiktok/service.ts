/**
 * TikTok service glue — discovery/watch/identity paths and the honest-state
 * mapping (TIKTOK-CONNECT scope rows 1–4), mirroring the YouTube service
 * discipline (YOUTUBE-EXPAND precedent).
 *
 * What lives here:
 *   - resolveTikTokVideo: the "paste a canonical link" discovery path
 *     (oembed.resolve — TikTok has no public search API, so this is THE
 *     public discovery surface) returning the canonical CatalogItem;
 *   - myTikTokVideos: the authorized account's own video list (Display API
 *     video.list) as CatalogItems + the honest rate snapshot (provisional,
 *     unverified basis — the provider's envelopes are authoritative);
 *   - tikTokAccountInfo: the authorized account's own profile (user.info);
 *   - playbackPlanForTikTokCatalogItem: CatalogItem → canonical PlaybackPlan
 *     via the official embed builder (the catalog→connector→playback→shell
 *     watch chain — the shell WatchScreen renders embedSpec.embedUrl);
 *   - tikTokCapabilityFromError: typed client errors → frozen §2.3
 *     OperationCapability (rate-limited / requires-auth / unavailable /
 *     unknown) so the app maps failures straight onto honest UI states.
 *
 * Fixture-tested only, exactly like the clients: the network boundary stays
 * an injected fetch; live-smoke status is recorded in the parity matrix.
 */
import type { CatalogItem, OperationCapability, PlaybackPlan } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  RateBudgetSnapshot,
  TikTokApiError,
  TikTokDisplayApiClient,
  TikTokMissingCredentialError,
  TikTokNotFoundError,
  TikTokRateLimitedError,
  TikTokRegionUnavailableError,
  TikTokRequiresAuthError,
  TikTokUserInfo,
  TikTokVideoListData,
} from "./displayApi";
import { InvalidTikTokUrlError, parseTikTokVideoUrl, TikTokOembedClient } from "./oembed";
import {
  catalogItemFromDisplayVideo,
  catalogItemFromOembed,
  tikTokVideoIdOf,
} from "./catalogMapping";
import { buildTikTokPlaybackPlan, InvalidTikTokVideoIdError } from "./playback";
import { TIKTOK_MANIFEST_VERSION, TIKTOK_PROVIDER_ID } from "./manifest";

/** One resolved link: the canonical item + the canonical URL it came from. */
export interface TikTokResolvedVideo {
  item: CatalogItem;
  canonicalUrl: string;
}

/** The authorized account's own videos + the honest rate snapshot after the call. */
export interface TikTokMyVideosPage {
  items: readonly CatalogItem[];
  budget: RateBudgetSnapshot;
  cursor: number | undefined;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Discovery (oembed.resolve — public, no auth; paste-a-link)
// ---------------------------------------------------------------------------

/**
 * Resolves a canonical TikTok video URL into a canonical CatalogItem via the
 * public oEmbed endpoint. Non-canonical URLs (short links, other hosts)
 * throw InvalidTikTokUrlError before any I/O — the honest answer, since this
 * connector resolves canonical URLs only.
 */
export async function resolveTikTokVideo(
  client: TikTokOembedClient,
  url: string,
): Promise<TikTokResolvedVideo> {
  const parts = parseTikTokVideoUrl(url);
  if (parts === null) {
    throw new InvalidTikTokUrlError(url);
  }
  const payload = await client.resolveVideo(parts.canonicalUrl);
  const item = catalogItemFromOembed(payload, parts);
  if (item === null) {
    throw new TikTokApiError({
      operationId: "oembed.resolve",
      message: `oEmbed payload for ${parts.canonicalUrl} carried no usable video id; refusing to fabricate an item`,
    });
  }
  return { item, canonicalUrl: parts.canonicalUrl };
}

// ---------------------------------------------------------------------------
// Authorized reads (Display API — per-user Login Kit token)
// ---------------------------------------------------------------------------

/** The authorized account's own video list, mapped to canonical CatalogItems. */
export async function myTikTokVideos(
  client: TikTokDisplayApiClient,
  params: { cursor?: number; maxCount?: number } = {},
): Promise<TikTokMyVideosPage> {
  const data: TikTokVideoListData = await client.getVideoList(params);
  const items: CatalogItem[] = [];
  for (const row of data.videos ?? []) {
    const mapped = catalogItemFromDisplayVideo(row);
    if (mapped !== null) items.push(mapped);
  }
  return {
    items,
    budget: client.getRateBudget(),
    cursor: typeof data.cursor === "number" ? data.cursor : undefined,
    hasMore: data.has_more === true,
  };
}

/** The authorized account's own profile (user.info). */
export async function tikTokAccountInfo(
  client: TikTokDisplayApiClient,
  fields?: readonly string[],
): Promise<TikTokUserInfo> {
  return client.getUserInfo(fields);
}

// ---------------------------------------------------------------------------
// Watch bridge (catalog item → canonical PlaybackPlan)
// ---------------------------------------------------------------------------

export interface TikTokWatchOptions {
  /** Viewer region (ISO 3166-1 alpha-2) — checked against observed-unavailable regions. */
  userRegion?: string;
  width?: number;
  height?: number;
}

/**
 * Builds the canonical PlaybackPlan for a TikTok-attributed CatalogItem
 * (official embed player — the one reusable playback mechanism).
 *
 * Total and honest:
 *   - non-TikTok item                → unavailable{unsupported, open-system-settings}
 *   - TikTok item without a usable id → unavailable{unsupported, open-provider-app}
 *   - observed-unavailable viewer region → unavailable{region, change-region}
 *   - valid video id                 → official-embed plan (builder validates
 *                                       the id against the official pattern)
 */
export function playbackPlanForTikTokCatalogItem(
  item: CatalogItem,
  options: TikTokWatchOptions = {},
): PlaybackPlan {
  if (!item || item.providerId !== TIKTOK_PROVIDER_ID) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-system-settings",
        message: `Only TikTok items resolve through the TikTok connector; "${item?.providerId ?? "unknown"}" is not installed for this item.`,
      },
    };
  }

  const videoId = tikTokVideoIdOf(item);
  if (videoId === null) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: `"${item.title}" carries no usable TikTok video id, so no official embed can be built. Watch it on TikTok.`,
      },
    };
  }

  try {
    return buildTikTokPlaybackPlan({
      videoId,
      title: item.title,
      userRegion: options.userRegion,
      width: options.width,
      height: options.height,
    });
  } catch (error) {
    if (error instanceof InvalidTikTokVideoIdError) {
      return {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-provider-app",
          message: `"${item.title}" does not carry a well-formed TikTok video id, so the official embed cannot be built. Watch it on TikTok.`,
        },
      };
    }
    throw error;
  }
}

/**
 * Structural adapter for the playback package's resolver seam
 * (resolvePlaybackPlan's Connector record: {id, providerId, version,
 * embed: {providerId, urlTemplate, allowsEmbedding}}) — the same seam shape
 * the YouTube connector exposes (YOUTUBE_PLAYBACK_CONNECTOR precedent). The
 * playback package accepts structural input; connectors never import it —
 * the app layer passes this constant to the resolver.
 */
export const TIKTOK_PLAYBACK_CONNECTOR = {
  id: "tiktok",
  providerId: TIKTOK_PROVIDER_ID,
  version: TIKTOK_MANIFEST_VERSION,
  embed: {
    providerId: TIKTOK_PROVIDER_ID,
    urlTemplate: "https://www.tiktok.com/embed/v2/{mediaId}",
    allowsEmbedding: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Honest-state mapping (typed errors → frozen §2.3 OperationCapability)
// ---------------------------------------------------------------------------

/**
 * Maps a typed TikTok client error onto the frozen OperationCapability
 * vocabulary so the shell renders the honest state:
 *   - provider rate signal (429 / rate_limit_exceeded) → rate-limited
 *   - 401 / access_token_invalid / missing token      → requires-auth
 *   - regional unavailability (geo-redirect / 451)    → unavailable (detail
 *     carries the regional explanation — the frozen enum has no region status)
 *   - not-found                                       → unavailable
 *   - fixture-only build refusal                      → unknown (the check
 *     did not complete — never dressed up as anything else)
 */
export function tikTokCapabilityFromError(error: unknown): OperationCapability {
  if (error instanceof TikTokRateLimitedError) {
    return { status: "rate-limited", detail: (error as Error).message };
  }
  if (error instanceof TikTokMissingCredentialError || error instanceof TikTokRequiresAuthError) {
    return { status: "requires-auth", detail: (error as Error).message };
  }
  if (error instanceof TikTokRegionUnavailableError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  if (error instanceof TikTokNotFoundError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  if (error instanceof LiveNetworkDisabledError) {
    return {
      status: "unknown",
      detail: `${(error as Error).message} (capability check not completed)`,
    };
  }
  if (error instanceof TikTokApiError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  return {
    status: "unknown",
    detail: `unexpected error while calling TikTok: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}
