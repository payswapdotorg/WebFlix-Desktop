/**
 * Twitch Helix payloads → canonical CatalogItems (frozen §2.1) — the same
 * mapping discipline as YouTube's and TikTok's (YOUTUBE-EXPAND /
 * TIKTOK-CONNECT precedents):
 *
 *   - provider attribution is ITEM-level: providerId "twitch" on every item;
 *   - the provider's own ids live in metadata.externalIds.twitch (stream /
 *     video / clip ids AND the channel's userId/userLogin — the watchable
 *     target for a live stream IS the channel login);
 *   - the official embed player becomes a ProviderAsset (kind "embed",
 *     reference = https://player.twitch.tv/?channel=<login> | ?video=<id> |
 *     ?clip=<slug> — the REQUIRED parent parameter is applied at
 *     playback-plan time from deployment configuration, never baked into
 *     catalog data);
 *   - official thumbnails become ProviderAssets (kind "thumbnail"). Stream
 *     thumbnails arrive as the provider's own {width}x{height} URL template
 *     — the substitution is the officially documented mechanism, so the
 *     mapping substitutes a fixed display size (1280x720) and records the
 *     raw template in metadata for auditability;
 *   - NO AvailabilityFact is fabricated: Helix rows report no per-item
 *     region availability (honest absence — a live stream IS live by
 *     construction, and the frozen plan union carries no availability);
 *   - MatchEvidence documents the provider-native provenance (a Helix row IS
 *     the provider's own record — confidence 1);
 *   - mediaKind honesty (work order): "live" for streams, "video" for VODs
 *     AND clips (Twitch clips are horizontal videos, not short-form vertical
 *     media — "video" is the honest kind; no clip kind exists in the frozen
 *     enum and none is invented);
 *   - users and games are browse CONTAINERS, never watchable items — they
 *     surface as honest descriptors (the YouTube playlist-descriptor
 *     precedent), never with a fabricated mediaKind.
 *
 * ADR-0003: only official-surface data enters this mapping. No scraping,
 * no private payloads, no synthesized fields.
 */
import type { CatalogItem, ProviderAsset } from "webflix-contracts";
import type {
  TwitchClipItem,
  TwitchFollowedChannelItem,
  TwitchGameItem,
  TwitchStreamItem,
  TwitchUserItem,
  TwitchVideoItem,
} from "./helixApi";
import { TWITCH_PLAYER_URL, TWITCH_PROVIDER_ID } from "./manifest";

/** The canonical metadata key for the provider's own ids. */
export const TWITCH_ID_METADATA_KEY = "twitch";

/** Official login rules: 3–25 chars of [a-zA-Z0-9_]. */
export const TWITCH_LOGIN_PATTERN = /^[A-Za-z0-9_]{3,25}$/;
/** Helix video ids are numeric strings. */
export const TWITCH_VIDEO_ID_PATTERN = /^\d{5,20}$/;
/** Helix stream ids are numeric strings. */
export const TWITCH_STREAM_ID_PATTERN = /^\d{5,20}$/;
/** Clip ids are ASCII slugs (e.g. "AbrasivePluckyCormorantOptimizeBudgie"). */
export const TWITCH_CLIP_ID_PATTERN = /^[A-Za-z0-9_-]{3,120}$/;
/** Game ids are numeric strings. */
export const TWITCH_GAME_ID_PATTERN = /^\d{1,20}$/;

/** The display size substituted into the provider's thumbnail templates. */
export const TWITCH_THUMBNAIL_WIDTH = 1280;
export const TWITCH_THUMBNAIL_HEIGHT = 720;

function isLogin(value: unknown): value is string {
  return typeof value === "string" && TWITCH_LOGIN_PATTERN.test(value);
}

function isVideoId(value: unknown): value is string {
  return typeof value === "string" && TWITCH_VIDEO_ID_PATTERN.test(value);
}

function isStreamId(value: unknown): value is string {
  return typeof value === "string" && TWITCH_STREAM_ID_PATTERN.test(value);
}

function isClipId(value: unknown): value is string {
  return typeof value === "string" && TWITCH_CLIP_ID_PATTERN.test(value);
}

function isGameId(value: unknown): value is string {
  return typeof value === "string" && TWITCH_GAME_ID_PATTERN.test(value);
}

function embedAsset(
  kind: "channel" | "video" | "clip",
  key: string,
  assetKey: string,
): ProviderAsset {
  return {
    assetId: `twitch:embed:${kind}:${assetKey}`,
    kind: "embed",
    reference: `${TWITCH_PLAYER_URL}?${kind === "channel" ? "channel" : kind}=${key}`,
  };
}

/**
 * Substitutes the provider's documented {width}/{height} placeholders in a
 * thumbnail template (official mechanism). Non-template URLs pass through
 * verbatim (VOD/clip thumbnails are direct URLs).
 */
export function twitchThumbnailUrl(template: string | undefined): string | null {
  if (typeof template !== "string" || template === "") return null;
  return template
    .replaceAll("{width}", String(TWITCH_THUMBNAIL_WIDTH))
    .replaceAll("{height}", String(TWITCH_THUMBNAIL_HEIGHT));
}

function thumbnailAsset(prefix: string, key: string, url: string | null): ProviderAsset | null {
  if (url === null) return null;
  return {
    assetId: `twitch:thumb:${prefix}:${key}`,
    kind: "thumbnail",
    reference: url,
    mimeType: "image/jpeg",
  };
}

/**
 * Parses Twitch's duration format ("3h8m33s", "58m19s", "45s", "1h0m0s")
 * into seconds. Returns null for anything the pattern does not honestly
 * match — a duration is never guessed.
 */
export function parseTwitchDurationSeconds(duration: string | undefined): number | null {
  if (typeof duration !== "string" || duration === "") return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration);
  if (match === null) return null;
  const hours = match[1] !== undefined ? Number(match[1]) : 0;
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  if (hours === 0 && minutes === 0 && seconds === 0) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

// ---------------------------------------------------------------------------
// Streams → live CatalogItems
// ---------------------------------------------------------------------------

/**
 * Maps one GET /streams row into a CatalogItem (mediaKind "live"). The
 * watchable target is the CHANNEL (user_login) — the embed player takes
 * ?channel=<login>. Returns null when the row carries no usable login (an
 * honest drop, never an item built on a guessed target).
 */
export function catalogItemFromStream(row: TwitchStreamItem): CatalogItem | null {
  if (!isLogin(row?.user_login)) return null;

  const metadata: Record<string, unknown> = {
    externalIds: {
      [TWITCH_ID_METADATA_KEY]: {
        userId: typeof row.user_id === "string" ? row.user_id : undefined,
        userLogin: row.user_login,
        streamId: isStreamId(row.id) ? row.id : undefined,
      },
    },
  };
  if (typeof row.user_name === "string" && row.user_name !== "")
    metadata.channelName = row.user_name;
  if (typeof row.game_name === "string" && row.game_name !== "") metadata.gameName = row.game_name;
  if (isGameId(row.game_id)) metadata.gameId = row.game_id;
  if (typeof row.viewer_count === "number" && Number.isFinite(row.viewer_count)) {
    metadata.viewerCount = row.viewer_count;
  }
  if (typeof row.started_at === "string" && row.started_at !== "") {
    metadata.startedAt = row.started_at;
    const year = Number(row.started_at.slice(0, 4));
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) metadata.year = year;
  }
  if (typeof row.language === "string" && row.language !== "") metadata.language = row.language;
  if (typeof row.thumbnail_url === "string" && row.thumbnail_url !== "") {
    metadata.thumbnailTemplate = row.thumbnail_url;
  }

  const assets: ProviderAsset[] = [embedAsset("channel", row.user_login, row.user_login)];
  const thumb = thumbnailAsset("stream", row.user_login, twitchThumbnailUrl(row.thumbnail_url));
  if (thumb !== null) assets.push(thumb);

  return {
    id: `twitch:stream:${row.user_login}`,
    providerId: TWITCH_PROVIDER_ID,
    title:
      typeof row.title === "string" && row.title !== ""
        ? row.title
        : `${row.user_login} live on Twitch`,
    mediaKind: "live",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [`provider-native: Helix GET /streams row for channel ${row.user_login}`],
    },
    availability: undefined,
    metadata,
  };
}

/** Maps a full /streams response page into live CatalogItems. */
export function catalogItemsFromStreamsResponse(rows: readonly TwitchStreamItem[]): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const row of rows ?? []) {
    const mapped = catalogItemFromStream(row);
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Videos (VODs) → video CatalogItems
// ---------------------------------------------------------------------------

/**
 * Maps one GET /videos row into a CatalogItem (mediaKind "video"). Returns
 * null when the row carries no usable video id.
 */
export function catalogItemFromVideo(row: TwitchVideoItem): CatalogItem | null {
  if (!isVideoId(row?.id)) return null;

  const metadata: Record<string, unknown> = {
    externalIds: {
      [TWITCH_ID_METADATA_KEY]: {
        videoId: row.id,
        userId: typeof row.user_id === "string" ? row.user_id : undefined,
        userLogin: isLogin(row.user_login) ? row.user_login : undefined,
      },
    },
  };
  if (typeof row.user_name === "string" && row.user_name !== "")
    metadata.channelName = row.user_name;
  if (typeof row.description === "string" && row.description !== "") {
    metadata.description = row.description;
  }
  const durationSeconds = parseTwitchDurationSeconds(row.duration);
  if (durationSeconds !== null) metadata.durationSeconds = durationSeconds;
  if (typeof row.duration === "string" && row.duration !== "") {
    metadata.durationRaw = row.duration;
  }
  if (typeof row.published_at === "string" && row.published_at !== "") {
    metadata.publishedAt = row.published_at;
    const year = Number(row.published_at.slice(0, 4));
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) metadata.year = year;
  }
  if (typeof row.view_count === "number" && Number.isFinite(row.view_count)) {
    metadata.viewCount = row.view_count;
  }
  if (typeof row.type === "string" && row.type !== "") metadata.videoType = row.type;
  if (typeof row.url === "string" && row.url !== "") metadata.providerUrl = row.url;

  const assets: ProviderAsset[] = [embedAsset("video", row.id, row.id)];
  const thumb = thumbnailAsset("video", row.id, twitchThumbnailUrl(row.thumbnail_url));
  if (thumb !== null) assets.push(thumb);

  return {
    id: `twitch:video:${row.id}`,
    providerId: TWITCH_PROVIDER_ID,
    title: typeof row.title === "string" && row.title !== "" ? row.title : `Twitch video ${row.id}`,
    mediaKind: "video",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [`provider-native: Helix GET /videos row id=${row.id}`],
    },
    availability: undefined,
    metadata,
  };
}

/** Maps a full /videos response page into video CatalogItems. */
export function catalogItemsFromTwitchVideosResponse(
  rows: readonly TwitchVideoItem[],
): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const row of rows ?? []) {
    const mapped = catalogItemFromVideo(row);
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Clips → video CatalogItems (horizontal clips — the honest "video" kind)
// ---------------------------------------------------------------------------

/**
 * Maps one GET /clips row into a CatalogItem (mediaKind "video"). Returns
 * null when the row carries no usable clip id.
 */
export function catalogItemFromClip(row: TwitchClipItem): CatalogItem | null {
  if (!isClipId(row?.id)) return null;

  const metadata: Record<string, unknown> = {
    externalIds: {
      [TWITCH_ID_METADATA_KEY]: {
        clipId: row.id,
        broadcasterLogin: isLogin(row.broadcaster_login) ? row.broadcaster_login : undefined,
        broadcasterId: typeof row.broadcaster_id === "string" ? row.broadcaster_id : undefined,
        // The parent VOD the clip was cut from — provenance, NOT this item's
        // watch target (the clip itself is watched via ?clip=<slug>).
        parentVideoId: isVideoId(row.video_id) ? row.video_id : undefined,
      },
    },
  };
  if (typeof row.broadcaster_name === "string" && row.broadcaster_name !== "") {
    metadata.channelName = row.broadcaster_name;
  }
  if (typeof row.creator_name === "string" && row.creator_name !== "") {
    metadata.creatorName = row.creator_name;
  }
  if (typeof row.creator_login === "string" && row.creator_login !== "") {
    metadata.creatorLogin = row.creator_login;
  }
  if (typeof row.duration === "number" && Number.isFinite(row.duration)) {
    metadata.durationSeconds = row.duration;
  }
  if (typeof row.view_count === "number" && Number.isFinite(row.view_count)) {
    metadata.viewCount = row.view_count;
  }
  if (typeof row.created_at === "string" && row.created_at !== "") {
    metadata.createdAt = row.created_at;
    const year = Number(row.created_at.slice(0, 4));
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) metadata.year = year;
  }
  if (typeof row.embed_url === "string" && row.embed_url !== "") {
    metadata.providerEmbedUrl = row.embed_url;
  }
  if (typeof row.url === "string" && row.url !== "") metadata.providerUrl = row.url;

  const assets: ProviderAsset[] = [embedAsset("clip", row.id, row.id)];
  const thumb = thumbnailAsset("clip", row.id, twitchThumbnailUrl(row.thumbnail_url));
  if (thumb !== null) assets.push(thumb);

  return {
    id: `twitch:clip:${row.id}`,
    providerId: TWITCH_PROVIDER_ID,
    title: typeof row.title === "string" && row.title !== "" ? row.title : `Twitch clip ${row.id}`,
    mediaKind: "video",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [`provider-native: Helix GET /clips row id=${row.id}`],
    },
    availability: undefined,
    metadata,
  };
}

/** Maps a full /clips response page into video CatalogItems. */
export function catalogItemsFromClipsResponse(rows: readonly TwitchClipItem[]): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const row of rows ?? []) {
    const mapped = catalogItemFromClip(row);
    if (mapped !== null) items.push(mapped);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Users → channel descriptors (browse containers, never items)
// ---------------------------------------------------------------------------

export interface TwitchChannelDescriptor {
  userId: string;
  login: string;
  displayName: string;
  broadcasterType: string | undefined;
  description: string | undefined;
  profileImageUrl: string | undefined;
  createdAt: string | undefined;
}

/**
 * Maps one GET /users row into a channel descriptor. Users are browse
 * containers (you watch a channel's stream or VODs, not "a user") — never a
 * CatalogItem with an invented mediaKind.
 */
export function channelDescriptorFromUser(row: TwitchUserItem): TwitchChannelDescriptor | null {
  if (!isLogin(row?.login)) return null;
  return {
    userId: typeof row.id === "string" && row.id !== "" ? row.id : "",
    login: row.login,
    displayName:
      typeof row.display_name === "string" && row.display_name !== ""
        ? row.display_name
        : row.login,
    broadcasterType:
      typeof row.broadcaster_type === "string" && row.broadcaster_type !== ""
        ? row.broadcaster_type
        : undefined,
    description:
      typeof row.description === "string" && row.description !== "" ? row.description : undefined,
    profileImageUrl:
      typeof row.profile_image_url === "string" && row.profile_image_url !== ""
        ? row.profile_image_url
        : undefined,
    createdAt:
      typeof row.created_at === "string" && row.created_at !== "" ? row.created_at : undefined,
  };
}

/** The channels the authorized account follows — descriptors, not items. */
export function channelDescriptorsFromFollowed(
  rows: readonly TwitchFollowedChannelItem[],
): TwitchChannelDescriptor[] {
  const descriptors: TwitchChannelDescriptor[] = [];
  for (const row of rows ?? []) {
    if (!isLogin(row?.broadcaster_login)) continue;
    descriptors.push({
      userId: typeof row.broadcaster_id === "string" ? row.broadcaster_id : "",
      login: row.broadcaster_login,
      displayName:
        typeof row.broadcaster_name === "string" && row.broadcaster_name !== ""
          ? row.broadcaster_name
          : row.broadcaster_login,
      broadcasterType: undefined,
      description: undefined,
      profileImageUrl: undefined,
      createdAt: undefined,
    });
  }
  return descriptors;
}

// ---------------------------------------------------------------------------
// Games → category descriptors (browse containers, never items)
// ---------------------------------------------------------------------------

export interface TwitchGameDescriptor {
  gameId: string;
  name: string;
  boxArtUrl: string | undefined;
}

/**
 * Maps one GET /games/top row into a category descriptor. Games are browse
 * containers — you watch streams IN a category, never "a game" itself.
 */
export function gameDescriptorFromRow(row: TwitchGameItem): TwitchGameDescriptor | null {
  if (!isGameId(row?.id)) return null;
  return {
    gameId: row.id,
    name: typeof row.name === "string" && row.name !== "" ? row.name : `Twitch game ${row.id}`,
    boxArtUrl: twitchThumbnailUrl(row.box_art_url) ?? undefined,
  };
}

/** Maps a full /games/top response page into category descriptors. */
export function gameDescriptorsFromResponse(
  rows: readonly TwitchGameItem[],
): TwitchGameDescriptor[] {
  const descriptors: TwitchGameDescriptor[] = [];
  for (const row of rows ?? []) {
    const mapped = gameDescriptorFromRow(row);
    if (mapped !== null) descriptors.push(mapped);
  }
  return descriptors;
}

// ---------------------------------------------------------------------------
// Catalog → watch bridge
// ---------------------------------------------------------------------------

/** The watchable target a Twitch CatalogItem carries. */
export type TwitchWatchTarget =
  | { kind: "channel"; login: string }
  | { kind: "video"; videoId: string }
  | { kind: "clip"; clipId: string };

function externalIdsOf(item: CatalogItem): Record<string, unknown> | null {
  const external = item.metadata?.externalIds;
  if (external !== null && typeof external === "object" && !Array.isArray(external)) {
    return external as Record<string, unknown>;
  }
  return null;
}

/**
 * Extracts the watchable target from a CatalogItem — the catalog→watch
 * bridge. Priority: the canonical metadata bag (externalIds.twitch), then
 * the provider embed asset reference (player.twitch.tv?channel=|video=|clip=).
 * Within the metadata bag each item kind resolves to its OWN target: a
 * clip's parentVideoId is provenance (never the clip's watch target — the
 * clip is watched via ?clip=<slug>), a VOD is watched via ?video=<id>, and
 * the channel login is the fallback a live-stream item carries. Returns
 * null when the item carries no usable target.
 */
export function twitchWatchTargetOf(item: CatalogItem): TwitchWatchTarget | null {
  if (!item || item.providerId !== TWITCH_PROVIDER_ID) return null;

  const external = externalIdsOf(item);
  if (external !== null) {
    const twitch = external[TWITCH_ID_METADATA_KEY];
    if (twitch !== null && typeof twitch === "object" && !Array.isArray(twitch)) {
      const ids = twitch as Record<string, unknown>;
      if (isVideoId(ids.videoId)) return { kind: "video", videoId: ids.videoId };
      if (isClipId(ids.clipId)) return { kind: "clip", clipId: ids.clipId };
      if (isLogin(ids.userLogin)) return { kind: "channel", login: ids.userLogin };
    }
  }

  for (const asset of item.assets ?? []) {
    if (asset.kind !== "embed") continue;
    const reference = asset.reference;
    if (!reference.startsWith(`${TWITCH_PLAYER_URL}?`)) continue;
    const channel = new URL(reference).searchParams.get("channel");
    if (channel !== null && isLogin(channel)) return { kind: "channel", login: channel };
    const video = new URL(reference).searchParams.get("video");
    if (video !== null && isVideoId(video)) return { kind: "video", videoId: video };
    const clip = new URL(reference).searchParams.get("clip");
    if (clip !== null && isClipId(clip)) return { kind: "clip", clipId: clip };
  }
  return null;
}
