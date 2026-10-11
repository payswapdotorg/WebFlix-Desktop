/**
 * TikTok API payloads → canonical CatalogItems (frozen §2.1) — the same
 * mapping discipline as YouTube's (YOUTUBE-EXPAND precedent):
 *
 *   - provider attribution is ITEM-level: providerId "tiktok" on every item;
 *   - the provider's own ids live in metadata.externalIds.tiktok;
 *   - the official embed player becomes a ProviderAsset (kind "embed",
 *     reference = https://www.tiktok.com/embed/v2/<id>) and the official
 *     cover/thumbnail becomes a ProviderAsset (kind "thumbnail");
 *   - NO AvailabilityFact is fabricated: neither oEmbed nor the Display API
 *     reports per-item region availability (honest absence — regional
 *     unavailability is a RUNTIME provider behavior surfaced by the typed
 *     clients, never a per-item guess);
 *   - MatchEvidence documents the provider-native provenance (an oEmbed
 *     resolution or a video.list row IS the provider's own record —
 *     confidence 1);
 *   - mediaKind: "short" — the canonical enum's short-form kind, the honest
 *     kind for TikTok's short-form platform (AUDIT-SOURCES §5: "short-video
 *     audience matches product"); non-video oEmbed payloads are dropped by
 *     the client, never mapped with an invented kind.
 *
 * ADR-0003: only official-surface data enters this mapping. No scraping,
 * no private payloads, no synthesized fields.
 */
import type { CatalogItem, ProviderAsset } from "webflix-contracts";
import type { TikTokVideoItem } from "./displayApi";
import type { TikTokOembedPayload } from "./oembed";
import { TIKTOK_VIDEO_ID_PATTERN, type TikTokVideoUrlParts } from "./oembed";
import { TIKTOK_EMBED_URL_PREFIX, TIKTOK_PROVIDER_ID } from "./manifest";

/** The canonical metadata key for the provider's own video id. */
export const TIKTOK_VIDEO_ID_METADATA_KEY = "tiktok";

function isValidVideoId(videoId: unknown): videoId is string {
  return typeof videoId === "string" && TIKTOK_VIDEO_ID_PATTERN.test(videoId);
}

function embedAsset(videoId: string): ProviderAsset {
  return {
    assetId: `tiktok:embed:${videoId}`,
    kind: "embed",
    reference: `${TIKTOK_EMBED_URL_PREFIX}${videoId}`,
  };
}

function thumbnailAsset(videoId: string, url: unknown): ProviderAsset | null {
  if (typeof url !== "string" || url === "") return null;
  return {
    assetId: `tiktok:thumb:${videoId}`,
    kind: "thumbnail",
    reference: url,
  };
}

/**
 * Maps one oEmbed payload + its canonical URL parts into a CatalogItem.
 * Returns null when the payload carries no usable video id (honest drop —
 * never an item built on a guessed id).
 *
 * NOTE: unlike YouTube's mapping, no observedAt context is taken: neither
 * oEmbed nor the Display API reports per-item region availability, so NO
 * AvailabilityFact is ever fabricated here (an honest absence — regional
 * unavailability is a runtime provider behavior surfaced by the typed
 * clients, never a per-item guess).
 */
export function catalogItemFromOembed(
  payload: TikTokOembedPayload,
  parts: TikTokVideoUrlParts,
): CatalogItem | null {
  if (!isValidVideoId(parts.videoId)) return null;

  const metadata: Record<string, unknown> = {
    externalIds: { [TIKTOK_VIDEO_ID_METADATA_KEY]: parts.videoId },
  };
  if (parts.username) metadata.authorUsername = parts.username;
  if (payload.author_name) metadata.authorName = payload.author_name;
  if (payload.author_url) metadata.authorUrl = payload.author_url;
  if (typeof payload.width === "number") metadata.oembedWidth = payload.width;
  if (typeof payload.height === "number") metadata.oembedHeight = payload.height;

  const assets: ProviderAsset[] = [embedAsset(parts.videoId)];
  const thumb = thumbnailAsset(parts.videoId, payload.thumbnail_url);
  if (thumb !== null) assets.push(thumb);

  return {
    id: `${TIKTOK_PROVIDER_ID}:video:${parts.videoId}`,
    providerId: TIKTOK_PROVIDER_ID,
    title:
      typeof payload.title === "string" && payload.title.length > 0
        ? payload.title
        : `TikTok video ${parts.videoId}`,
    mediaKind: "short",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [`provider-native: oEmbed resolution of ${parts.canonicalUrl}`],
    },
    availability: undefined,
    metadata,
  };
}

/**
 * Maps one Display API video.list row (the authorized account's own video)
 * into a CatalogItem. Returns null when the row carries no usable id. No
 * observedAt context — see catalogItemFromOembed for the honest-absence note.
 */
export function catalogItemFromDisplayVideo(
  row: TikTokVideoItem,
  context: { provenance?: string } = {},
): CatalogItem | null {
  if (!isValidVideoId(row?.id)) return null;

  const metadata: Record<string, unknown> = {
    externalIds: { [TIKTOK_VIDEO_ID_METADATA_KEY]: row.id },
  };
  if (typeof row.video_description === "string" && row.video_description !== "") {
    metadata.description = row.video_description;
  }
  if (typeof row.duration === "number" && Number.isFinite(row.duration)) {
    metadata.durationSeconds = row.duration;
  }
  if (typeof row.create_time === "number" && Number.isFinite(row.create_time)) {
    // create_time is epoch SECONDS in the official payload.
    const createdAt = new Date(row.create_time * 1000).toISOString();
    metadata.createdAt = createdAt;
    const year = Number(createdAt.slice(0, 4));
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) metadata.year = year;
  }
  if (typeof row.embed_link === "string" && row.embed_link !== "") {
    metadata.providerEmbedLink = row.embed_link;
  }

  const assets: ProviderAsset[] = [embedAsset(row.id)];
  const thumb = thumbnailAsset(row.id, row.cover_image_url);
  if (thumb !== null) assets.push(thumb);

  return {
    id: `${TIKTOK_PROVIDER_ID}:video:${row.id}`,
    providerId: TIKTOK_PROVIDER_ID,
    title: typeof row.title === "string" && row.title !== "" ? row.title : `TikTok video ${row.id}`,
    mediaKind: "short",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [
        context.provenance ??
          `provider-native: Display API video.list row (authorized account's own video) id=${row.id}`,
      ],
    },
    availability: undefined,
    metadata,
  };
}

/**
 * Extracts the provider video id from a CatalogItem — the catalog→watch
 * bridge. Priority: the canonical metadata bag (externalIds.tiktok), then
 * the provider embed asset reference (/embed/v2/<id>), then the embed
 * assetId ("tiktok:embed:<id>"). Returns null when the item carries no
 * usable id. (YouTube's catalogMapping exports the same helper under the
 * generic name videoIdOf; this one is TikTok-suffixed so both live in the
 * package's public surface without ambiguity.)
 */
export function tikTokVideoIdOf(item: CatalogItem): string | null {
  if (!item || item.providerId !== TIKTOK_PROVIDER_ID) return null;

  const external = item.metadata?.externalIds;
  if (external !== null && typeof external === "object" && !Array.isArray(external)) {
    const candidate = (external as Record<string, unknown>)[TIKTOK_VIDEO_ID_METADATA_KEY];
    if (isValidVideoId(candidate)) return candidate;
  }

  for (const asset of item.assets ?? []) {
    if (asset.kind !== "embed") continue;
    const fromReference = asset.reference.split("/embed/v2/")[1];
    if (isValidVideoId(fromReference)) return fromReference;
    if (asset.assetId.startsWith("tiktok:embed:")) {
      const fromAssetId = asset.assetId.slice("tiktok:embed:".length);
      if (isValidVideoId(fromAssetId)) return fromAssetId;
    }
  }
  return null;
}
