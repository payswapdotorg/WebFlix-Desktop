/**
 * Reddit REST payload shapes → canonical CatalogItems (frozen §2.1) — the
 * same mapping discipline as YouTube/TikTok/Twitch/Instagram
 * (YOUTUBE-EXPAND precedent), with this platform's honesty made concrete:
 *
 *   - provider attribution is ITEM-level: native Reddit video posts carry
 *     providerId "reddit" with the provider's own id in
 *     metadata.externalIds.reddit (the base36 post id — the token the
 *     official embed surface addresses, NOT the t3_ fullname);
 *   - CROSS-PROVIDER ATTRIBUTION (the work order: "crossposts attributed to
 *     their original provider when the official payload says so"): a link
 *     post whose own secure_media/media oembed identifies the ORIGINAL
 *     provider (Reddit's oembed for YouTube links carries type
 *     "youtube.com" + provider_name "YouTube" + the canonical url) is
 *     mapped as a YOUTUBE item — the payload says so — with the Reddit
 *     context (subreddit, post id, permalink) preserved as provenance
 *     metadata. The watch path then routes through the YouTube connector
 *     naturally: Reddit surfaces community-curated content from other
 *     providers, and the mapping never pretends Reddit hosts it. Link
 *     posts whose oembed does NOT identify a provider WebFlix knows are
 *     honestly dropped (no invented id extraction);
 *   - native crossposts (crosspost_parent_list) of Reddit-hosted video
 *     stay REDDIT items — the original is still a Reddit post — with the
 *     crosspost relationship recorded in metadata;
 *   - mediaKind honesty (work order: "video for Reddit video posts"):
 *     is_video (the payload's own flag; reddit_video media object) →
 *     "video" — community long-form, the platform's own shape. Reddit has
 *     no short-form vertical surface distinct from posts; no kind is
 *     invented;
 *   - honest DROPS (the frozen MediaKind enum is video | short | live |
 *     podcast | audio | local-file — NO photo kind, and a text post is not
 *     a watchable media unit; the Instagram drop precedent):
 *       image posts (post_hint "image" / i.redd.it domains / gallery) → dropped;
 *       self/text posts (is_self) → dropped;
 *       galleries (is_gallery) → dropped (mixed containers);
 *       link posts to unknown providers → dropped (no invented extraction);
 *       rows without an id → dropped;
 *   - NO AvailabilityFact is fabricated (the Reddit payloads carry no
 *     per-item region availability — the same honest absence as the
 *     TikTok/Instagram lanes);
 *   - MatchEvidence documents the provider-native provenance (a t3 Listing
 *     row IS the provider's own record — confidence 1; for cross-attributed
 *     items the evidence names both the Reddit row and the oembed provider
 *     attribution);
 *   - assets: the official embed asset (https://embed.reddit.com/comments/
 *     <id> — the watch surface, see ./playback) + the payload's own preview
 *     thumbnail when present (never a guessed URL).
 *
 * ADR-0003: only official-surface data enters this mapping (the REST
 * listing/comment reads). The reddit_video fallback_url/dash_url/hls_url
 * fields are recorded in metadata as the provider's own playback-source
 * references for provenance — WebFlix never extracts streams from them
 * (video.download is an honestly-unsupported row; the embed surface is the
 * watch path).
 */
import type { CatalogItem, ProviderAsset } from "webflix-contracts";
import type { RedditLinkData, RedditOEmbedMedia, RedditVideoMedia } from "./restApi";
import { REDDIT_PROVIDER_ID } from "./manifest";

/** The canonical metadata key for the provider's own post id. */
export const REDDIT_ID_METADATA_KEY = "reddit";

/** The canonical metadata key for the cross-provider attribution note. */
export const REDDIT_VIA_METADATA_KEY = "redditVia";

/** The base36 id pattern the embed surface addresses (dev/api: "The base 36 ID of a Link"). */
export const REDDIT_POST_ID_PATTERN = /^[a-z0-9]{4,10}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isValidPostId(value: unknown): value is string {
  return typeof value === "string" && REDDIT_POST_ID_PATTERN.test(value);
}

/** Builds the official embed-surface URL for a post id (see ./playback). */
export function redditEmbedUrlFor(postId: string): string {
  return `https://embed.reddit.com/comments/${postId}`;
}

/** Builds the canonical permalink for a post (the payload's own permalink path). */
export function redditPermalinkFor(permalinkPath: string | undefined, postId: string): string {
  if (isNonEmptyString(permalinkPath) && permalinkPath.startsWith("/")) {
    return `https://www.reddit.com${permalinkPath}`;
  }
  // Honest fallback: the documented canonical shortlink shape for the id.
  return `https://www.reddit.com/comments/${postId}`;
}

function embedAsset(postId: string): ProviderAsset {
  return {
    assetId: `reddit:embed:${postId}`,
    kind: "embed",
    reference: redditEmbedUrlFor(postId),
  };
}

function thumbnailAsset(postId: string, url: unknown): ProviderAsset | null {
  if (
    !isNonEmptyString(url) ||
    url === "self" ||
    url === "default" ||
    url === "spoiler" ||
    url === "nsfw"
  ) {
    return null; // the payload's placeholder thumbnail tokens are not images
  }
  return {
    assetId: `reddit:thumb:${postId}`,
    kind: "thumbnail",
    reference: url,
  };
}

function previewSourceUrl(row: RedditLinkData): string | undefined {
  const source = row?.preview?.images?.[0]?.source;
  return typeof source?.url === "string" && source.url !== "" ? source.url : undefined;
}

function isVideoMedia(media: unknown): media is RedditVideoMedia {
  return (
    typeof media === "object" &&
    media !== null &&
    typeof (media as RedditVideoMedia).reddit_video === "object" &&
    (media as RedditVideoMedia).reddit_video !== null
  );
}

function isOEmbedMedia(media: unknown): media is RedditOEmbedMedia {
  return (
    typeof media === "object" &&
    media !== null &&
    typeof (media as RedditOEmbedMedia).oembed === "object" &&
    (media as RedditOEmbedMedia).oembed !== null
  );
}

/** Extracts a YouTube video id from a canonical watch URL (the oembed's own url field). */
function youtubeIdFromUrl(url: string | undefined): string | null {
  if (!isNonEmptyString(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be" && /^[\w-]{5,}$/.test(parsed.pathname.slice(1))) {
      return parsed.pathname.slice(1);
    }
    if (
      (parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "m.youtube.com" ||
        parsed.hostname === "youtube.com") &&
      parsed.pathname === "/watch" &&
      /^[\w-]{5,}$/.test(parsed.searchParams.get("v") ?? "")
    ) {
      return parsed.searchParams.get("v");
    }
    const shortMatch = /^\/(?:shorts|embed)\/([\w-]{5,})$/.exec(parsed.pathname);
    if (
      (parsed.hostname === "www.youtube.com" || parsed.hostname === "youtube.com") &&
      shortMatch !== null
    ) {
      return shortMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the row's own oembed payload identifies the ORIGINAL provider as
 * YouTube — Reddit's oembed for YouTube links carries type "youtube.com" (the
 * provider's own type token) and provider_name "YouTube". Only the payload's
 * own words count; domain heuristics alone never drive attribution.
 */
export function rowAttributesToYouTube(row: RedditLinkData): boolean {
  for (const media of [row?.secure_media, row?.media]) {
    if (isOEmbedMedia(media)) {
      const type = media.oembed.type ?? "";
      const providerName = media.oembed.provider_name ?? "";
      if (type === "youtube.com" || providerName === "YouTube") return true;
    }
  }
  return false;
}

/** The honest drop report for a listing page (surfaced by the service). */
export interface RedditListingMappingReport {
  mapped: number;
  /** Native Reddit video posts mapped as reddit items. */
  video: number;
  /** Link posts the payload attributed to YouTube (cross-provider rows). */
  attributedExternal: number;
  droppedImage: number;
  droppedSelfText: number;
  droppedGallery: number;
  droppedUnsupportedLink: number;
  droppedNoId: number;
}

/**
 * Maps one t3 Link row into a CatalogItem — or null for the honest drops.
 * The drops are the mapping's honesty, not failures: the caller counts them
 * and the parity matrix documents them.
 */
export function catalogItemFromRedditLink(row: RedditLinkData): CatalogItem | null {
  if (!isValidPostId(row?.id)) return null;

  // 1. Native Reddit video posts — the platform's own watchable unit.
  if (row.is_video === true || isVideoMedia(row?.secure_media) || isVideoMedia(row?.media)) {
    const metadata: Record<string, unknown> = {
      externalIds: { [REDDIT_ID_METADATA_KEY]: row.id },
    };
    if (isNonEmptyString(row.subreddit)) metadata.subreddit = row.subreddit;
    if (isNonEmptyString(row.domain)) metadata.domain = row.domain;
    if (isNonEmptyString(row.author)) metadata.authorUsername = row.author;
    if (isNonEmptyString(row.title)) metadata.title = row.title;
    if (isNonEmptyString(row.permalink))
      metadata.permalink = redditPermalinkFor(row.permalink, row.id);
    if (typeof row.created_utc === "number") {
      metadata.createdAt = new Date(row.created_utc * 1000).toISOString();
    }
    if (typeof row.score === "number") metadata.score = row.score;
    if (typeof row.num_comments === "number") metadata.commentCount = row.num_comments;
    if (typeof row.over_18 === "boolean") metadata.over18 = row.over_18;
    // The provider's own playback-source references, recorded for provenance
    // only — WebFlix watches through the official embed, never these files.
    for (const media of [row?.secure_media, row?.media]) {
      if (isVideoMedia(media)) {
        const video = media.reddit_video;
        metadata.redditVideo = {
          ...(isNonEmptyString(video.fallback_url) ? { fallbackUrl: video.fallback_url } : {}),
          ...(isNonEmptyString(video.dash_url) ? { dashUrl: video.dash_url } : {}),
          ...(isNonEmptyString(video.hls_url) ? { hlsUrl: video.hls_url } : {}),
          ...(typeof video.duration === "number" ? { durationSeconds: video.duration } : {}),
        };
        break;
      }
    }
    // Crosspost provenance: the original is still a Reddit post — attribution
    // stays reddit with the relationship recorded, never re-attributed away.
    const crossParent = row?.crosspost_parent_list?.[0];
    if (crossParent !== undefined && isValidPostId(crossParent.id)) {
      metadata.crosspostParentId = crossParent.id;
    }

    const assets: ProviderAsset[] = [embedAsset(row.id)];
    const thumb = thumbnailAsset(row.id, previewSourceUrl(row) ?? row?.thumbnail);
    if (thumb !== null) assets.push(thumb);

    const title = isNonEmptyString(row.title) ? row.title : `Reddit post ${row.id}`;
    return {
      id: `${REDDIT_PROVIDER_ID}:video:${row.id}`,
      providerId: REDDIT_PROVIDER_ID,
      title,
      mediaKind: "video",
      assets,
      matchEvidence: {
        confidence: 1,
        evidence: [
          `provider-native: REST API t3 Listing row id=${row.id}${
            isNonEmptyString(row.subreddit) ? ` in r/${row.subreddit}` : ""
          }`,
        ],
      },
      availability: undefined,
      metadata,
    };
  }

  // 2. Link posts the payload itself attributes to another provider — mapped
  //    to that provider (the work order's crosspost-attribution rule).
  if (rowAttributesToYouTube(row)) {
    const youtubeId =
      youtubeIdFromUrl(row?.secure_media?.oembed?.url) ?? youtubeIdFromUrl(row?.media?.oembed?.url);
    if (youtubeId !== null) {
      const metadata: Record<string, unknown> = {
        externalIds: { youtube: youtubeId },
        [REDDIT_VIA_METADATA_KEY]: {
          providerId: REDDIT_PROVIDER_ID,
          postId: row.id,
          ...(isNonEmptyString(row.subreddit) ? { subreddit: row.subreddit } : {}),
          permalink: redditPermalinkFor(row.permalink, row.id),
          ...(isNonEmptyString(row.author) ? { authorUsername: row.author } : {}),
          ...(typeof row.score === "number" ? { score: row.score } : {}),
          ...(typeof row.num_comments === "number" ? { commentCount: row.num_comments } : {}),
        },
      };
      const assets: ProviderAsset[] = [
        {
          assetId: `youtube:embed:${youtubeId}`,
          kind: "embed",
          reference: `https://www.youtube-nocookie.com/embed/${youtubeId}`,
        },
      ];
      const title = isNonEmptyString(row.title) ? row.title : `YouTube video ${youtubeId}`;
      return {
        id: `reddit-via:youtube:${row.id}`,
        providerId: "youtube",
        title,
        mediaKind: "video",
        assets,
        matchEvidence: {
          confidence: 1,
          evidence: [
            `cross-provider attribution: Reddit t3 row id=${row.id} whose own oembed payload identifies YouTube (type "youtube.com") with url carrying video id ${youtubeId}; Reddit context preserved in metadata.redditVia`,
          ],
        },
        availability: undefined,
        metadata,
      };
    }
    // oembed says YouTube but the url is not a canonical watch URL — no
    // invented extraction (the honest drop).
    return null;
  }

  // 3. The honest drops (frozen enum has no photo kind; text is not media;
  //    unknown-provider links are not extractable without invention).
  if (row?.is_gallery === true || row?.post_hint === "image" || row?.domain === "i.redd.it") {
    return null;
  }
  if (row?.is_self === true) return null;
  if (isNonEmptyString(row?.url) || isNonEmptyString(row?.domain)) return null; // unsupported link
  return null; // no usable media signal at all
}

/** Maps a whole Listing's t3 children with the drop reasons counted honestly. */
export function catalogItemsFromRedditListing(
  children: ReadonlyArray<{ kind: string; data: unknown }>,
): { items: CatalogItem[]; report: RedditListingMappingReport } {
  const items: CatalogItem[] = [];
  const report: RedditListingMappingReport = {
    mapped: 0,
    video: 0,
    attributedExternal: 0,
    droppedImage: 0,
    droppedSelfText: 0,
    droppedGallery: 0,
    droppedUnsupportedLink: 0,
    droppedNoId: 0,
  };
  for (const child of children) {
    if (child?.kind !== "t3") continue; // listings may carry other kinds (ads etc.) — skipped, not dropped
    const row = child.data as RedditLinkData;
    if (!isValidPostId(row?.id)) {
      report.droppedNoId += 1;
      continue;
    }
    const mapped = catalogItemFromRedditLink(row);
    if (mapped === null) {
      if (row?.is_gallery === true) report.droppedGallery += 1;
      else if (row?.post_hint === "image" || row?.domain === "i.redd.it") report.droppedImage += 1;
      else if (row?.is_self === true) report.droppedSelfText += 1;
      else if (isNonEmptyString(row?.url) || isNonEmptyString(row?.domain))
        report.droppedUnsupportedLink += 1;
      else report.droppedNoId += 1;
      continue;
    }
    items.push(mapped);
    report.mapped += 1;
    if (mapped.providerId === REDDIT_PROVIDER_ID) report.video += 1;
    else report.attributedExternal += 1;
  }
  return { items, report };
}

/**
 * Extracts the Reddit post id from a CatalogItem — the catalog→watch bridge
 * key (the embed surface addresses base36 post ids). Sources, in priority
 * order: the canonical metadata bag (externalIds.reddit), the embed asset
 * reference (/comments/<id>), the embed assetId ("reddit:embed:<id>").
 * Returns null when the item carries no usable id.
 */
export function redditPostIdOf(item: CatalogItem): string | null {
  if (!item || item.providerId !== REDDIT_PROVIDER_ID) return null;

  const candidate = (item.metadata?.externalIds as Record<string, unknown> | undefined)?.[
    REDDIT_ID_METADATA_KEY
  ];
  if (isValidPostId(candidate)) return candidate;

  for (const asset of item.assets ?? []) {
    if (asset.kind !== "embed") continue;
    const fromReference = /\/comments\/([a-z0-9]{4,10})\/?$/i.exec(asset.reference)?.[1];
    if (isValidPostId(fromReference)) return fromReference;
    if (asset.assetId.startsWith("reddit:embed:")) {
      const fromAssetId = asset.assetId.slice("reddit:embed:".length);
      if (isValidPostId(fromAssetId)) return fromAssetId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Browse containers (subreddits + users — descriptors, never items)
// ---------------------------------------------------------------------------

/** A subreddit browse container (the Twitch users/games precedent). */
export interface RedditSubredditDescriptor {
  displayName: string;
  title: string | undefined;
  subscribers: number | undefined;
  publicDescription: string | undefined;
  over18: boolean | undefined;
  iconUrl: string | undefined;
  url: string | undefined;
}

/** Maps a GET /r/<sub>/about payload into a subreddit descriptor. */
export function subredditDescriptorFromAbout(
  data: {
    display_name?: unknown;
    title?: unknown;
    subscribers?: unknown;
    public_description?: unknown;
    over18?: unknown;
    icon_img?: unknown;
    url?: unknown;
  } | null,
): RedditSubredditDescriptor | null {
  if (!isNonEmptyString(data?.display_name)) return null;
  return {
    displayName: data!.display_name as string,
    title: isNonEmptyString(data!.title) ? (data!.title as string) : undefined,
    subscribers: typeof data!.subscribers === "number" ? (data!.subscribers as number) : undefined,
    publicDescription: isNonEmptyString(data!.public_description)
      ? (data!.public_description as string)
      : undefined,
    over18: typeof data!.over18 === "boolean" ? (data!.over18 as boolean) : undefined,
    iconUrl: isNonEmptyString(data!.icon_img) ? (data!.icon_img as string) : undefined,
    url: isNonEmptyString(data!.url) ? (data!.url as string) : undefined,
  };
}

/** A public user browse container. */
export interface RedditUserDescriptor {
  username: string;
  linkKarma: number | undefined;
  commentKarma: number | undefined;
  isGold: boolean | undefined;
  iconUrl: string | undefined;
}

/** Maps a GET /user/<name>/about payload into a user descriptor. */
export function userDescriptorFromAbout(
  data: {
    name?: unknown;
    link_karma?: unknown;
    comment_karma?: unknown;
    is_gold?: unknown;
    icon_img?: unknown;
  } | null,
): RedditUserDescriptor | null {
  if (!isNonEmptyString(data?.name)) return null;
  return {
    username: data!.name as string,
    linkKarma: typeof data!.link_karma === "number" ? (data!.link_karma as number) : undefined,
    commentKarma:
      typeof data!.comment_karma === "number" ? (data!.comment_karma as number) : undefined,
    isGold: typeof data!.is_gold === "boolean" ? (data!.is_gold as boolean) : undefined,
    iconUrl: isNonEmptyString(data!.icon_img) ? (data!.icon_img as string) : undefined,
  };
}
