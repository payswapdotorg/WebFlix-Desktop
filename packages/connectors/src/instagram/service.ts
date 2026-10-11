/**
 * Instagram service glue — discovery/account/watch paths and the honest-state
 * mapping (INSTAGRAM-CONNECT scope rows 1–4), mirroring the TikTok/Twitch
 * service discipline (YOUTUBE-EXPAND precedent).
 *
 * What lives here:
 *   - discoverMyInstagramAccounts: the documented two-step discovery chain
 *     (/me/accounts → page?fields=instagram_business_account) returning ALL
 *     Page→IG candidates (the guide's own note: the user may hold tasks on
 *     several Pages — the caller picks);
 *   - myInstagramMedia: the authorized professional account's own media as
 *     canonical CatalogItems + the honest drop report (image posts and
 *     carousel albums are dropped — the frozen MediaKind enum has no photo
 *     kind and an album is not a single watchable unit) + the usage-budget
 *     snapshot (percentage headers, basis-labeled; never a pre-flight
 *     blocker);
 *   - instagramAccountInfo / instagramAccountInsights / instagramMediaInsights:
 *     the authorized reads passed through;
 *   - playbackPlanForInstagramCatalogItem: CatalogItem → canonical
 *     PlaybackPlan via the honest-default builder (the work order's mandated
 *     DEFAULT: unavailable{requires-auth} + open-provider-app handoff; the
 *     approved-credential path behind embedApproved);
 *   - instagramCapabilityFromError: typed client errors → frozen §2.3
 *     OperationCapability (rate-limited / requires-auth / unavailable /
 *     unknown) so the app maps failures straight onto honest UI states.
 *
 * Fixture-tested only, exactly like the clients: the network boundary stays
 * an injected fetch; live-smoke status is recorded in the parity matrix.
 */
import type { CatalogItem, OperationCapability, PlaybackPlan } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  InstagramApiError,
  InstagramDiscoveredAccount,
  InstagramGraphClient,
  InstagramInsightsResponse,
  InstagramMissingCredentialError,
  InstagramNotFoundError,
  InstagramRateLimitedError,
  InstagramRequiresAuthError,
  InstagramUsageBudgetSnapshot,
} from "./graphApi";
import {
  catalogItemsFromGraphMediaPage,
  instagramShortcodeOf,
  isInstagramReelItem,
} from "./catalogMapping";
import { buildInstagramPlaybackPlan, InvalidInstagramShortcodeError } from "./playback";
import { INSTAGRAM_MANIFEST_VERSION, INSTAGRAM_PROVIDER_ID } from "./manifest";

/** The authorized account's own media page + the honest drop report. */
export interface InstagramMyMediaPage {
  items: readonly CatalogItem[];
  /** How many rows were dropped and why (images, carousels, unusable ids). */
  dropped: {
    image: number;
    carousel: number;
    noId: number;
  };
  budget: InstagramUsageBudgetSnapshot;
  /** The next-page cursor (paging.cursors.after), when the provider served one. */
  after: string | undefined;
  /** True when the provider's paging.next link exists (more pages remain). */
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Discovery chain (the documented /me/accounts → page → IG User walk)
// ---------------------------------------------------------------------------

/**
 * Every Instagram professional account reachable by the authorized Facebook
 * user (the Page→IG candidates). The guide's own instruction: users may hold
 * tasks on several Pages, so the caller (or its UI) identifies the right one.
 */
export async function discoverMyInstagramAccounts(
  client: InstagramGraphClient,
): Promise<InstagramDiscoveredAccount[]> {
  return client.discoverInstagramAccounts();
}

// ---------------------------------------------------------------------------
// Authorized reads (Graph API — per-user Facebook Login token)
// ---------------------------------------------------------------------------

/** The authorized professional account's own media, mapped + drop-reported. */
export async function myInstagramMedia(
  client: InstagramGraphClient,
  igUserId: string,
  params: { limit?: number; after?: string } = {},
): Promise<InstagramMyMediaPage> {
  const page = await client.getInstagramMedia(igUserId, {
    limit: params.limit,
    after: params.after,
  });
  const { items, report } = catalogItemsFromGraphMediaPage(page.data ?? []);
  return {
    items,
    dropped: {
      image: report.droppedImage,
      carousel: report.droppedCarousel,
      noId: report.droppedNoId,
    },
    budget: client.getUsageBudget(),
    after: page.paging?.cursors?.after,
    hasMore: typeof page.paging?.next === "string" && page.paging.next !== "",
  };
}

/** The authorized professional account's own profile. */
export async function instagramAccountInfo(client: InstagramGraphClient, igUserId: string) {
  return client.getInstagramUserProfile(igUserId);
}

/** The authorized professional account's account-level insights. */
export async function instagramAccountInsights(
  client: InstagramGraphClient,
  igUserId: string,
  params: { metric: readonly string[]; period?: string },
): Promise<InstagramInsightsResponse> {
  return client.getAccountInsights(igUserId, params);
}

/** The authorized professional account's per-media insights. */
export async function instagramMediaInsights(
  client: InstagramGraphClient,
  mediaId: string,
  params: { metric: readonly string[] },
): Promise<InstagramInsightsResponse> {
  return client.getMediaInsights(mediaId, params);
}

// ---------------------------------------------------------------------------
// Watch bridge (catalog item → canonical PlaybackPlan)
// ---------------------------------------------------------------------------

export interface InstagramWatchOptions {
  /**
   * The operator gate — official embed playback is enabled ONLY after the
   * Meta app review chain completes (parity matrix §watch). DEFAULT: the
   * honest unavailable plan.
   */
  embedApproved?: boolean;
}

/**
 * Builds the canonical PlaybackPlan for an Instagram-attributed CatalogItem.
 *
 * Total and honest:
 *   - non-Instagram item            → unavailable{unsupported, open-system-settings}
 *   - Instagram item without a
 *     usable shortcode              → unavailable{unsupported, open-provider-app}
 *   - embedApproved not set (the
 *     DEFAULT)                      → unavailable{requires-auth, open-provider-app}
 *                                     + the post permalink as the handoff URL
 *   - embedApproved: true           → official-embed plan (the documented
 *                                     embed page; the builder validates the
 *                                     shortcode against the official pattern)
 */
export function playbackPlanForInstagramCatalogItem(
  item: CatalogItem,
  options: InstagramWatchOptions = {},
): PlaybackPlan {
  if (!item || item.providerId !== INSTAGRAM_PROVIDER_ID) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-system-settings",
        message: `Only Instagram items resolve through the Instagram connector; "${item?.providerId ?? "unknown"}" is not installed for this item.`,
      },
    };
  }

  const shortcode = instagramShortcodeOf(item);
  if (shortcode === null) {
    return {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: `"${item.title}" carries no usable Instagram shortcode, so no official embed can be built. Watch it on Instagram.`,
      },
    };
  }

  try {
    return buildInstagramPlaybackPlan({
      shortcode,
      isReel: isInstagramReelItem(item),
      title: item.title,
      embedApproved: options.embedApproved,
    });
  } catch (error) {
    if (error instanceof InvalidInstagramShortcodeError) {
      return {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-provider-app",
          message: `"${item.title}" does not carry a well-formed Instagram shortcode, so the official embed cannot be built. Watch it on Instagram.`,
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
 * every connector exposes. HONEST DEFAULT: allowsEmbedding FALSE — the
 * resolver's lane-1 answer for Instagram is the honest unavailable plan
 * until the operator's Meta app review completes; flipping the flag (and
 * verifying the iframe-context framing behavior in the packaged webview) is
 * the documented integration step in the parity matrix §watch.
 */
export const INSTAGRAM_PLAYBACK_CONNECTOR = {
  id: "instagram",
  providerId: INSTAGRAM_PROVIDER_ID,
  version: INSTAGRAM_MANIFEST_VERSION,
  embed: {
    providerId: INSTAGRAM_PROVIDER_ID,
    urlTemplate: "https://www.instagram.com/p/{mediaId}/embed/",
    allowsEmbedding: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Honest-state mapping (typed errors → frozen §2.3 OperationCapability)
// ---------------------------------------------------------------------------

/**
 * Maps a typed Instagram client error onto the frozen OperationCapability
 * vocabulary so the shell renders the honest state:
 *   - provider throttle (429 / request-limit codes) → rate-limited (the
 *     detail carries the unverified-basis explanation)
 *   - code 190 / 2500 / OAuthException / missing
 *     credential                        → requires-auth (professional-account
 *     reads + the app-review gate chain)
 *   - not-found / other provider errors → unavailable
 *   - fixture-only build refusal        → unknown (the check did not
 *     complete — never dressed up as anything else)
 */
export function instagramCapabilityFromError(error: unknown): OperationCapability {
  if (error instanceof InstagramRateLimitedError) {
    return { status: "rate-limited", detail: (error as Error).message };
  }
  if (
    error instanceof InstagramMissingCredentialError ||
    error instanceof InstagramRequiresAuthError
  ) {
    return { status: "requires-auth", detail: (error as Error).message };
  }
  if (error instanceof InstagramNotFoundError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  if (error instanceof LiveNetworkDisabledError) {
    return {
      status: "unknown",
      detail: `${(error as Error).message} (capability check not completed)`,
    };
  }
  if (error instanceof InstagramApiError) {
    return { status: "unavailable", detail: (error as Error).message };
  }
  return {
    status: "unknown",
    detail: `unexpected error while calling Instagram: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}
