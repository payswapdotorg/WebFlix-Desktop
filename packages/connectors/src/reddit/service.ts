/**
 * Reddit service glue — the read/watch paths and the honest-state mapping
 * (REDDIT-CONNECT scope rows 1–4), mirroring the four-platform service
 * discipline (YOUTUBE-EXPAND precedent).
 *
 * What lives here:
 *   - redditListingPage: hot/new/top/best/search/user-submitted listings →
 *     canonical CatalogItems + the honest drop report (images/self-text/
 *     galleries/unknown links dropped; YouTube-attributed link posts
 *     cross-attributed) + the after cursor + the served-header budget
 *     snapshot (never a pre-flight blocker);
 *   - redditPostDetail: the documented comment-tree read → the post item +
 *     comments as discussion context (comments are NEVER catalog items);
 *   - redditSubredditAbout / redditUserAbout: browse-container descriptors
 *     (the Twitch users/games precedent — a subreddit is where you browse,
 *     not a watchable item);
 *   - playbackPlanForRedditCatalogItem: CatalogItem → canonical
 *     PlaybackPlan via the ON-by-default official-embed builder;
 *   - redditCapabilityFromError: typed client errors → frozen §2.3
 *     OperationCapability (rate-limited with the served-header budget /
 *     requires-auth / unavailable (the 403 block policy) / unknown) so the
 *     app maps failures straight onto honest UI states.
 *
 * Fixture-tested only, exactly like the client: the network boundary stays
 * an injected fetch; live-smoke status is recorded in the parity matrix.
 */
import type { CatalogItem, OperationCapability, PlaybackPlan } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  RedditApiError,
  RedditBlockedError,
  RedditCommentData,
  RedditLinkData,
  RedditListing,
  RedditMissingCredentialError,
  RedditNotFoundError,
  RedditRateBudgetSnapshot,
  RedditRateLimitedError,
  RedditRequiresAuthError,
  RedditRestClient,
  RedditSubredditAboutData,
  RedditUserData,
} from "./restApi";
import {
  catalogItemsFromRedditListing,
  redditPostIdOf,
  subredditDescriptorFromAbout,
  userDescriptorFromAbout,
  type RedditSubredditDescriptor,
  type RedditUserDescriptor,
} from "./catalogMapping";
import { buildRedditPlaybackPlan, InvalidRedditPostIdError } from "./playback";
import { REDDIT_PROVIDER_ID } from "./manifest";

/** A mapped listing page: items + honest drop report + cursor + budget. */
export interface RedditListingPage {
  items: readonly CatalogItem[];
  dropped: {
    image: number;
    selfText: number;
    gallery: number;
    unsupportedLink: number;
    noId: number;
  };
  attributedExternal: number;
  budget: RedditRateBudgetSnapshot;
  /** The after cursor (the documented listing pagination token), when served. */
  after: string | undefined;
  hasMore: boolean;
}

function listingPageFrom(listing: RedditListing): RedditListingPage {
  const { items, report } = catalogItemsFromRedditListing(listing?.data?.children ?? []);
  return {
    items,
    dropped: {
      image: report.droppedImage,
      selfText: report.droppedSelfText,
      gallery: report.droppedGallery,
      unsupportedLink: report.droppedUnsupportedLink,
      noId: report.droppedNoId,
    },
    attributedExternal: report.attributedExternal,
    budget: {
      callsRecorded: 0,
      lastUsed: null,
      lastRemaining: null,
      lastResetSeconds: null,
      lastRetryAfterSeconds: null,
      lastStatus: null,
      providerRateLimited: false,
      basis: "served-header",
    },
    after:
      typeof listing?.data?.after === "string" && listing.data.after !== ""
        ? listing.data.after
        : undefined,
    hasMore: typeof listing?.data?.after === "string" && listing.data.after !== "",
  };
}

async function readListing(
  call: () => Promise<{ listing: RedditListing; budget: RedditRateBudgetSnapshot }>,
): Promise<RedditListingPage> {
  const { listing, budget } = await call();
  const page = listingPageFrom(listing);
  return { ...page, budget };
}

// ---- listings (documented "This endpoint is a listing" surfaces) --------

export async function redditHotPage(
  client: RedditRestClient,
  subreddit: string,
  params: { limit?: number; after?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.getSubredditHot(subreddit, params));
}

export async function redditNewPage(
  client: RedditRestClient,
  subreddit: string,
  params: { limit?: number; after?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.getSubredditNew(subreddit, params));
}

export async function redditTopPage(
  client: RedditRestClient,
  subreddit: string,
  params: { limit?: number; after?: string; t?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.getSubredditTop(subreddit, params));
}

export async function redditBestPage(
  client: RedditRestClient,
  params: { limit?: number; after?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.getBest(params));
}

export async function redditSearchPage(
  client: RedditRestClient,
  query: string,
  subreddit?: string,
  params: { limit?: number; after?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.searchLinks(query, subreddit, params));
}

export async function redditUserSubmittedPage(
  client: RedditRestClient,
  username: string,
  params: { limit?: number; after?: string } = {},
): Promise<RedditListingPage> {
  return readListing(() => client.getUserSubmitted(username, params));
}

// ---- post detail (the comment-tree read) --------------------------------

/** A discussion comment (context around the watchable post — never an item). */
export interface RedditDiscussionComment {
  id: string;
  author: string | undefined;
  body: string | undefined;
  score: number | undefined;
  depth: number | undefined;
}

export interface RedditPostDetail {
  /** The post as a canonical CatalogItem (or the honest drop when unmappable). */
  item: CatalogItem | null;
  /** Why the post was dropped, when it was (the mapping's honest report). */
  dropReason: "image" | "self-text" | "gallery" | "unsupported-link" | "no-id" | undefined;
  comments: readonly RedditDiscussionComment[];
  budget: RedditRateBudgetSnapshot;
}

function dropReasonForLink(row: RedditLinkData | null): RedditPostDetail["dropReason"] {
  if (row === null || row === undefined) return "no-id";
  if (row.is_gallery === true) return "gallery";
  if (row.post_hint === "image" || row.domain === "i.redd.it") return "image";
  if (row.is_self === true) return "self-text";
  if (typeof row.url === "string" && row.url !== "") return "unsupported-link";
  return "no-id";
}

export async function redditPostDetail(
  client: RedditRestClient,
  postId: string,
): Promise<RedditPostDetail> {
  const { post, comments, budget } = await client.getPostComments(postId);
  const { items } = catalogItemsFromRedditListing(
    post !== null ? [{ kind: "t3", data: post }] : [],
  );
  const mappedComments: RedditDiscussionComment[] = comments.map((comment: RedditCommentData) => ({
    id: comment.id,
    author: typeof comment.author === "string" ? comment.author : undefined,
    body: typeof comment.body === "string" ? comment.body : undefined,
    score: typeof comment.score === "number" ? comment.score : undefined,
    depth: typeof comment.depth === "number" ? comment.depth : undefined,
  }));
  return {
    item: items[0] ?? null,
    dropReason: items[0] === undefined ? dropReasonForLink(post) : undefined,
    comments: mappedComments,
    budget,
  };
}

// ---- browse containers (subreddit + user about) --------------------------

export async function redditSubredditAbout(
  client: RedditRestClient,
  subreddit: string,
): Promise<{ subreddit: RedditSubredditDescriptor | null; budget: RedditRateBudgetSnapshot }> {
  const { data, budget } = await client.getSubredditAbout(subreddit);
  return { subreddit: subredditDescriptorFromAbout(data as RedditSubredditAboutData), budget };
}

export async function redditUserAbout(
  client: RedditRestClient,
  username: string,
): Promise<{ user: RedditUserDescriptor | null; budget: RedditRateBudgetSnapshot }> {
  const { data, budget } = await client.getUserAbout(username);
  return { user: userDescriptorFromAbout(data as RedditUserData), budget };
}

// ---- watch bridge (CatalogItem → canonical PlaybackPlan) ------------------

/**
 * TOTAL watch bridge: a Reddit item with a usable post id → the
 * ON-by-default official-embed plan; a cross-attributed item routes to ITS
 * provider (the YouTube plan builder is the caller's composition point —
 * this bridge honestly refuses to build a plan for a provider it does not
 * own); a Reddit item without a post id → the honest refusal.
 */
export function playbackPlanForRedditCatalogItem(item: CatalogItem): PlaybackPlan {
  if (!item || item.providerId !== REDDIT_PROVIDER_ID) {
    throw new RedditApiError({
      operationId: "playback.embed",
      status: null,
      message: `playbackPlanForRedditCatalogItem: item providerId "${item?.providerId}" is not "${REDDIT_PROVIDER_ID}" (cross-attributed items route through their own provider's plan builder)`,
    });
  }
  const postId = redditPostIdOf(item);
  if (postId === null) {
    throw new RedditApiError({
      operationId: "playback.embed",
      status: null,
      message:
        "playbackPlanForRedditCatalogItem: the item carries no usable Reddit post id (no externalIds.reddit, no embed asset) — refusing to guess a URL",
    });
  }
  return buildRedditPlaybackPlan({ postId, title: item.title });
}

// ---- honest-state mapping (typed errors → frozen §2.3) --------------------

/**
 * Maps a typed client error onto the frozen OperationCapability vocabulary
 * so the app renders the honest state: rate-limited (the provider's own
 * throttle, served-header budget), requires-auth (the live-captured 401
 * shape), unavailable (the 403 block policy — surfaced, never hidden),
 * unknown for anything else.
 */
export function redditCapabilityFromError(error: unknown): OperationCapability {
  if (error instanceof RedditRateLimitedError) {
    const budget = error.budget;
    const retry =
      budget.lastRetryAfterSeconds !== null ? `; Retry-After ${budget.lastRetryAfterSeconds}s` : "";
    return {
      status: "rate-limited",
      detail: `Rate-limited by Reddit (429${retry}) — the documented 100 QPM per OAuth client id free tier enforced by the provider; served headers: X-Ratelimit-Used=${budget.lastUsed ?? "n/a"}, Remaining=${budget.lastRemaining ?? "n/a"}, Reset=${budget.lastResetSeconds ?? "n/a"}s (basis: served-header; the provider's own numbers)`,
    };
  }
  if (error instanceof RedditRequiresAuthError) {
    return {
      status: "requires-auth",
      detail: `${error.operationId}: the token is missing or invalid (${error.providerMessage ?? "Unauthorized"}) — (re-)authorization required`,
    };
  }
  if (error instanceof RedditBlockedError) {
    return {
      status: "unavailable",
      detail: `${error.operationId}: Reddit served a 403 block page — the documented policy blocks non-OAuth/datacenter traffic from this network; the operator's registered OAuth app on a compliant network is the path (parity matrix §network)`,
    };
  }
  if (error instanceof RedditMissingCredentialError) {
    return {
      status: "requires-auth",
      detail: error.message,
    };
  }
  if (error instanceof RedditNotFoundError) {
    return {
      status: "unavailable",
      detail: error.message,
    };
  }
  if (error instanceof LiveNetworkDisabledError) {
    return {
      status: "unavailable",
      detail:
        "live network I/O is disabled in this build (fixture-only) — the parity matrix §live-smoke records the honest live-check status",
    };
  }
  if (error instanceof InvalidRedditPostIdError) {
    return { status: "unsupported", detail: error.message };
  }
  if (error instanceof RedditApiError) {
    return {
      status: "unknown",
      detail: `${error.operationId}: provider error (HTTP ${error.status ?? "n/a"}) — ${error.message}`,
    };
  }
  return {
    status: "unknown",
    detail: `unexpected error: ${(error as Error | undefined)?.message ?? String(error)}`,
  };
}
