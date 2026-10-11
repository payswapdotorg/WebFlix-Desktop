/**
 * Twitch service glue — browse/watch/identity paths and the honest-state
 * mapping (TWITCH-CONNECT scope rows 1–4), mirroring the YouTube/TikTok
 * service discipline (YOUTUBE-EXPAND / TIKTOK-CONNECT precedents).
 *
 * What lives here:
 *   - browseLiveStreams / browseTopGames / browseChannelVideos /
 *     browseChannelClips / browseGameClips: the Helix browse rows (streams,
 *     VODs, clips, users, games — the work order's "browse/watch rows"),
 *     each returning canonical CatalogItems or honest descriptors PLUS the
 *     authoritative header-based rate snapshot (Ratelimit-* triple, basis
 *     labeled);
 *   - lookupChannel: the users.read identity lookup (channel descriptors,
 *     browse containers — never watchable items);
 *   - followedChannels: the requires-auth per-user browse row (the channels
 *     the authorized account follows);
 *   - playbackPlanForTwitchCatalogItem: CatalogItem → canonical PlaybackPlan
 *     via the official embed builder — the catalog→connector→playback→shell
 *     watch chain (the shell WatchScreen renders embedSpec.embedUrl);
 *   - twitchCapabilityFromError: typed client errors → frozen §2.3
 *     OperationCapability (rate-limited / requires-auth / unavailable /
 *     unknown) so the app maps failures straight onto honest UI states.
 *
 * Fixture-tested only, exactly like the clients: the network boundary stays
 * an injected fetch; live-smoke status is recorded in the parity matrix.
 */
import type { CatalogItem, OperationCapability, PlaybackPlan } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  TwitchApiError,
  TwitchHelixClient,
  TwitchMissingCredentialError,
  TwitchNotFoundError,
  TwitchRateLimitedError,
  TwitchRequiresAuthError,
  type TwitchRateBudgetSnapshot,
} from "./helixApi";
import {
  catalogItemsFromClipsResponse,
  catalogItemsFromStreamsResponse,
  catalogItemsFromTwitchVideosResponse,
  channelDescriptorFromUser,
  channelDescriptorsFromFollowed,
  gameDescriptorsFromResponse,
  twitchWatchTargetOf,
  type TwitchChannelDescriptor,
  type TwitchGameDescriptor,
} from "./catalogMapping";
import {
  buildTwitchPlaybackPlan,
  InvalidTwitchWatchTargetError,
  MissingTwitchParentError,
  TWITCH_DEV_PARENT,
} from "./playback";
import { TWITCH_MANIFEST_VERSION, TWITCH_PLAYER_URL, TWITCH_PROVIDER_ID } from "./manifest";

/** One browse result page: canonical items (or descriptors) + the honest header-based rate snapshot. */
export interface TwitchCatalogPage {
  items: readonly CatalogItem[];
  budget: TwitchRateBudgetSnapshot;
  after: string | undefined;
}

/** A descriptor browse page (games/categories — browse containers, not items). */
export interface TwitchDescriptorPage<T> {
  descriptors: readonly T[];
  budget: TwitchRateBudgetSnapshot;
  after: string | undefined;
}

// ---------------------------------------------------------------------------
// Browse rows (public reads — App Access token)
// ---------------------------------------------------------------------------

/** Live streams by game/category, channel or language (mediaKind live). */
export async function browseLiveStreams(
  client: TwitchHelixClient,
  params: {
    gameId?: string;
    userLogin?: string;
    language?: string;
    first?: number;
    after?: string;
  } = {},
): Promise<TwitchCatalogPage> {
  const response = await client.getStreams(params);
  return {
    items: catalogItemsFromStreamsResponse(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

/** The top games/categories (browse containers that feed streams.live rows). */
export async function browseTopGames(
  client: TwitchHelixClient,
  params: { first?: number; after?: string } = {},
): Promise<TwitchDescriptorPage<TwitchGameDescriptor>> {
  const response = await client.getTopGames(params);
  return {
    descriptors: gameDescriptorsFromResponse(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

/** A channel's VODs (past broadcasts, highlights, uploads — mediaKind video). */
export async function browseChannelVideos(
  client: TwitchHelixClient,
  params: {
    userId: string;
    type?: "all" | "archive" | "highlight" | "upload";
    first?: number;
    after?: string;
  },
): Promise<TwitchCatalogPage> {
  const response = await client.getVideos({
    userId: params.userId,
    type: params.type,
    first: params.first,
    after: params.after,
  });
  return {
    items: catalogItemsFromTwitchVideosResponse(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

/** A channel's clips (mediaKind video). */
export async function browseChannelClips(
  client: TwitchHelixClient,
  params: { broadcasterId: string; first?: number; after?: string },
): Promise<TwitchCatalogPage> {
  const response = await client.getClips({
    broadcasterId: params.broadcasterId,
    first: params.first,
    after: params.after,
  });
  return {
    items: catalogItemsFromClipsResponse(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

/** The clips of a game/category (mediaKind video). */
export async function browseGameClips(
  client: TwitchHelixClient,
  params: { gameId: string; first?: number; after?: string },
): Promise<TwitchCatalogPage> {
  const response = await client.getClips({
    gameId: params.gameId,
    first: params.first,
    after: params.after,
  });
  return {
    items: catalogItemsFromClipsResponse(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

/** Channel identity lookup (users.read — descriptors, never watchable items). */
export async function lookupChannel(
  client: TwitchHelixClient,
  params: { login?: string; id?: string },
): Promise<TwitchChannelDescriptor | null> {
  const response = await client.getUsers(params);
  const row = (response.data ?? [])[0];
  return row === undefined ? null : channelDescriptorFromUser(row);
}

// ---------------------------------------------------------------------------
// Per-user browse (requires a connected account)
// ---------------------------------------------------------------------------

/** The channels the authorized account follows (channels.followed — user token). */
export async function followedChannels(
  client: TwitchHelixClient,
  params: { broadcasterUserId: string; first?: number; after?: string },
): Promise<TwitchDescriptorPage<TwitchChannelDescriptor>> {
  const response = await client.getFollowedChannels(params);
  return {
    descriptors: channelDescriptorsFromFollowed(response.data ?? []),
    budget: client.getRateBudget(),
    after: response.pagination?.cursor,
  };
}

// ---------------------------------------------------------------------------
// Watch bridge (catalog item → canonical PlaybackPlan)
// ---------------------------------------------------------------------------

export interface TwitchWatchOptions {
  /**
   * The embedding page's origin hostname for the REQUIRED parent parameter
   * (e.g. "localhost" at dev time — live-verified; the production origin is
   * the parity-matrix integration note). Defaults to the documented dev
   * origin so the bridge is callable in dev; production callers pass their
   * pinned origin explicitly.
   */
  parent?: string;
  autoplay?: boolean;
  muted?: boolean;
  width?: number;
  height?: number;
}

/**
 * Builds the canonical PlaybackPlan for a Twitch-attributed CatalogItem
 * (official embed player — the one reusable playback mechanism).
 *
 * Total and honest:
 *   - non-Twitch item           → unavailable{unsupported, open-system-settings}
 *   - Twitch item without a
 *     usable watch target       → unavailable{unsupported, open-provider-app}
 *   - no/malformed parent       → unavailable{unsupported, open-system-settings}
 *     with the parent explanation (the plan cannot render without the
 *     embedding origin — never a guessed parent)
 *   - valid target + parent     → official-embed plan (builder validates the
 *                                target against the official patterns)
 */
export function playbackPlanForTwitchCatalogItem(
  item: CatalogItem,
  options: TwitchWatchOptions = {},
): PlaybackPlan {
  if (!item || item.providerId !== TWITCH_PROVIDER_ID) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-system-settings",
        message: `Only Twitch items resolve through the Twitch connector; "${item?.providerId ?? "unknown"}" is not installed for this item.`,
      },
    };
  }

  const target = twitchWatchTargetOf(item);
  if (target === null) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: `"${item.title}" carries no usable Twitch watch target (channel login, video id or clip id), so no official embed can be built. Watch it on Twitch.`,
      },
    };
  }

  const parent = options.parent ?? TWITCH_DEV_PARENT;
  try {
    return buildTwitchPlaybackPlan({
      target,
      parent,
      title: item.title,
      autoplay: options.autoplay,
      muted: options.muted,
      width: options.width,
      height: options.height,
    });
  } catch (error) {
    if (error instanceof MissingTwitchParentError) {
      return {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-system-settings",
          message: `${(error as Error).message} Configure the embedding origin in settings (dev: localhost).`,
        },
      };
    }
    if (error instanceof InvalidTwitchWatchTargetError) {
      return {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-provider-app",
          message: `"${item.title}" does not carry a well-formed Twitch watch target, so the official embed cannot be built. Watch it on Twitch.`,
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
 * the YouTube and TikTok connectors expose. The urlTemplate carries the
 * dev-time parent (localhost); the production origin replaces it at
 * integration (parity matrix §parent — the template is the app layer's to
 * configure, never guessed here).
 */
export const TWITCH_PLAYBACK_CONNECTOR = {
  id: "twitch",
  providerId: TWITCH_PROVIDER_ID,
  version: TWITCH_MANIFEST_VERSION,
  embed: {
    providerId: TWITCH_PROVIDER_ID,
    urlTemplate: `${TWITCH_PLAYER_URL}/?channel={mediaId}&parent=${TWITCH_DEV_PARENT}`,
    allowsEmbedding: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Honest-state mapping (typed errors → frozen §2.3 OperationCapability)
// ---------------------------------------------------------------------------

/**
 * Maps a typed Twitch client error onto the frozen OperationCapability
 * vocabulary so the shell renders the honest state:
 *   - provider rate enforcement (HTTP 429 + Ratelimit-Reset) → rate-limited
 *   - 401 Unauthorized / missing token or client id            → requires-auth
 *   - not-found                                               → unavailable
 *   - fixture-only build refusal                              → unknown (the
 *     check did not complete — never dressed up as anything else)
 */
export function twitchCapabilityFromError(error: unknown): OperationCapability {
  if (error instanceof TwitchRateLimitedError) {
    return { status: "rate-limited", detail: (error as Error).message };
  }
  if (error instanceof TwitchMissingCredentialError || error instanceof TwitchRequiresAuthError) {
    return { status: "requires-auth", detail: (error as Error).message };
  }
  if (error instanceof TwitchNotFoundError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  if (error instanceof LiveNetworkDisabledError) {
    return {
      status: "unknown",
      detail: `${(error as Error).message} (capability check not completed)`,
    };
  }
  if (error instanceof TwitchApiError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  return {
    status: "unknown",
    detail: `unexpected error while calling Twitch: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}
