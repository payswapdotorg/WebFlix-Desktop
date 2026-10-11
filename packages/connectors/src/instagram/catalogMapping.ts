/**
 * Instagram Graph API payloads → canonical CatalogItems (frozen §2.1) — the
 * same mapping discipline as YouTube/TikTok/Twitch (YOUTUBE-EXPAND
 * precedent), with this platform's honesty made concrete:
 *
 *   - provider attribution is ITEM-level: providerId "instagram" on every
 *     item; the provider's own ids live in metadata.externalIds.instagram
 *     (the IG Media id) plus metadata.shortcode (the permalink token the
 *     embed surface keys on);
 *   - NO AvailabilityFact is fabricated: nothing in the own-media payload
 *     reports per-item region availability (an honest absence — the same
 *     discipline as the TikTok lane);
 *   - MatchEvidence documents the provider-native provenance (a Graph API
 *     /media row IS the provider's own record for the authorized account's
 *     own media — confidence 1);
 *   - mediaKind honesty (work order: "post/reel/video"):
 *       media_type VIDEO + media_product_type REELS → "short"
 *       media_type VIDEO (feed video, or no product type reported) → "video"
 *       media_type IMAGE                           → DROPPED — the frozen
 *         MediaKind enum is video | short | live | podcast | audio |
 *         local-file; it has NO photo kind, and inventing one is a contract
 *         edit, not a mapping decision (same precedent as YouTube's
 *         non-video drop).
 *       media_type CAROUSEL_ALBUM                  → DROPPED — an album is
 *         a mixed photo/video container whose children would each need a
 *         follow-up read; mapping it to any single kind would fabricate a
 *         watchable unit. Children reads are a later-phase option, recorded
 *         in the parity matrix, never guessed here.
 *   - thumbnail: the thumbnail_url field is VIDEO-only per the IG Media
 *     reference (and media_url may be OMITTED on copyright-flagged media —
 *     both honest absences, never filled in);
 *   - the embed asset references the documented embed page
 *     (https://www.instagram.com/p|reel/<shortcode>/embed/) — the watch
 *     surface. Its availability is GATED (see ./playback): the asset records
 *     WHERE the official surface lives; the plan builder decides honestly
 *     whether it may be driven.
 *
 * ADR-0003: only official-surface data enters this mapping (the Graph reads
 * — never the oEmbed payload, whose documented terms restrict it to
 * embedding; see ./oembed).
 */
import type { CatalogItem, ProviderAsset } from "webflix-contracts";
import type { InstagramMediaItem } from "./graphApi";
import { INSTAGRAM_PROVIDER_ID } from "./manifest";
import { INSTAGRAM_SHORTCODE_PATTERN } from "./oembed";

/** The canonical metadata key for the provider's own media id. */
export const INSTAGRAM_MEDIA_ID_METADATA_KEY = "instagram";

/** The canonical metadata key for the media shortcode (the embed token). */
export const INSTAGRAM_SHORTCODE_METADATA_KEY = "instagramShortcode";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isValidShortcode(value: unknown): value is string {
  return typeof value === "string" && INSTAGRAM_SHORTCODE_PATTERN.test(value);
}

/** Builds the documented embed-page URL for a media kind + shortcode. */
export function instagramEmbedUrlFor(kind: "post" | "reel", shortcode: string): string {
  const segment = kind === "reel" ? "reel" : "p";
  return `https://www.instagram.com/${segment}/${shortcode}/embed/`;
}

function embedAsset(shortcode: string, isReel: boolean): ProviderAsset {
  return {
    assetId: `instagram:embed:${shortcode}`,
    kind: "embed",
    reference: instagramEmbedUrlFor(isReel ? "reel" : "post", shortcode),
  };
}

function thumbnailAsset(shortcode: string, url: unknown): ProviderAsset | null {
  if (!isNonEmptyString(url)) return null;
  return {
    assetId: `instagram:thumb:${shortcode}`,
    kind: "thumbnail",
    reference: url,
  };
}

/** True when the row is a Reel (VIDEO media published to the REELS surface). */
export function isInstagramReelRow(row: InstagramMediaItem): boolean {
  return row?.media_type === "VIDEO" && row?.media_product_type === "REELS";
}

/**
 * True when a mapped CatalogItem is a Reel — read from the canonical
 * metadata the mapping wrote (mediaProductType) or, failing that, from the
 * embed asset's /reel/ path. The catalog→watch bridge uses this to pick the
 * documented /reel/ embed path over /p/.
 */
export function isInstagramReelItem(item: CatalogItem): boolean {
  if (!item || item.providerId !== INSTAGRAM_PROVIDER_ID) return false;
  const productType = item.metadata?.mediaProductType;
  if (productType === "REELS") return true;
  if (productType === "FEED" || productType === "AD" || productType === "STORY") return false;
  for (const asset of item.assets ?? []) {
    if (asset.kind === "embed" && asset.reference.includes("/reel/")) return true;
  }
  return false;
}

/**
 * Maps one Graph /media row (the authorized account's own media) into a
 * CatalogItem — or null for the honest drops (IMAGE posts, carousel albums,
 * rows without a usable id). The drops are the mapping's honesty, not
 * failures: the caller counts them and the parity matrix documents them.
 */
export function catalogItemFromGraphMedia(
  row: InstagramMediaItem,
  context: { provenance?: string } = {},
): CatalogItem | null {
  if (!isNonEmptyString(row?.id)) return null;

  const isVideo = row.media_type === "VIDEO";
  if (!isVideo) return null; // IMAGE / CAROUSEL_ALBUM → honest drop (see header)

  const shortcode = isValidShortcode(row.shortcode) ? row.shortcode : null;
  const metadata: Record<string, unknown> = {
    externalIds: { [INSTAGRAM_MEDIA_ID_METADATA_KEY]: row.id },
  };
  if (shortcode !== null) metadata[INSTAGRAM_SHORTCODE_METADATA_KEY] = shortcode;
  if (typeof row.media_product_type === "string" && row.media_product_type !== "") {
    metadata.mediaProductType = row.media_product_type;
  }
  if (isNonEmptyString(row.caption)) metadata.caption = row.caption;
  if (isNonEmptyString(row.permalink)) metadata.permalink = row.permalink;
  if (isNonEmptyString(row.username)) metadata.authorUsername = row.username;
  if (isNonEmptyString(row.timestamp)) {
    metadata.createdAt = row.timestamp; // ISO 8601 UTC (+0000) per the reference
    const year = Number(String(row.timestamp).slice(0, 4));
    if (Number.isInteger(year) && year >= 1000 && year <= 9999) metadata.year = year;
  }

  const assets: ProviderAsset[] = [];
  if (shortcode !== null) {
    assets.push(embedAsset(shortcode, isInstagramReelRow(row)));
    const thumb = thumbnailAsset(shortcode, row.thumbnail_url);
    if (thumb !== null) assets.push(thumb);
  }

  const titleBase = isNonEmptyString(row.caption)
    ? firstLine(row.caption)
    : `Instagram ${isInstagramReelRow(row) ? "reel" : "video"} ${row.id}`;

  return {
    id: `${INSTAGRAM_PROVIDER_ID}:video:${row.id}`,
    providerId: INSTAGRAM_PROVIDER_ID,
    title: titleBase,
    mediaKind: isInstagramReelRow(row) ? "short" : "video",
    assets,
    matchEvidence: {
      confidence: 1,
      evidence: [
        context.provenance ??
          `provider-native: Graph API /media row (authorized account's own media) id=${row.id}`,
      ],
    },
    availability: undefined,
    metadata,
  };
}

/**
 * Extracts the media shortcode from a CatalogItem — the catalog→watch bridge
 * key (the embed surface addresses shortcodes, NOT media ids: a numeric IG
 * Media id is a different token, and using it as a shortcode would guess a
 * URL that does not exist). Sources, in priority order: the canonical
 * metadata bag (instagramShortcode), the embed asset reference (/p|reel/
 * <code>/embed/), the embed assetId ("instagram:embed:<code>"). The
 * externalIds.instagram MEDIA ID is deliberately NOT a shortcode source.
 * Returns null when the item carries no usable shortcode.
 */
export function instagramShortcodeOf(item: CatalogItem): string | null {
  if (!item || item.providerId !== INSTAGRAM_PROVIDER_ID) return null;

  const candidate = item.metadata?.[INSTAGRAM_SHORTCODE_METADATA_KEY];
  if (isValidShortcode(candidate)) return candidate;

  for (const asset of item.assets ?? []) {
    if (asset.kind !== "embed") continue;
    const fromReference = /\/(?:p|reel)\/([A-Za-z0-9_-]+)\/embed\/?$/.exec(asset.reference)?.[1];
    if (isValidShortcode(fromReference)) return fromReference;
    if (asset.assetId.startsWith("instagram:embed:")) {
      const fromAssetId = asset.assetId.slice("instagram:embed:".length);
      if (isValidShortcode(fromAssetId)) return fromAssetId;
    }
  }
  return null;
}

/**
 * The honest drop report for a /media page: how many rows were dropped and
 * why (IMAGE posts and carousel albums are not watchable units under the
 * frozen MediaKind enum; rows without ids are unusable). Surfaced so the
 * service can tell the truth about partial pages instead of hiding it.
 */
export interface InstagramMediaMappingReport {
  mapped: number;
  droppedImage: number;
  droppedCarousel: number;
  droppedNoId: number;
}

/** Maps a whole /media page with the drop reasons counted honestly. */
export function catalogItemsFromGraphMediaPage(
  rows: readonly InstagramMediaItem[],
  context: { provenance?: string } = {},
): { items: CatalogItem[]; report: InstagramMediaMappingReport } {
  const items: CatalogItem[] = [];
  const report: InstagramMediaMappingReport = {
    mapped: 0,
    droppedImage: 0,
    droppedCarousel: 0,
    droppedNoId: 0,
  };
  for (const row of rows) {
    if (!isNonEmptyString(row?.id)) {
      report.droppedNoId += 1;
      continue;
    }
    if (row.media_type === "IMAGE") {
      report.droppedImage += 1;
      continue;
    }
    if (row.media_type === "CAROUSEL_ALBUM") {
      report.droppedCarousel += 1;
      continue;
    }
    if (row.media_type !== "VIDEO") {
      // Unknown media_type: an honest drop, counted with the images (the
      // reference enumerates exactly IMAGE/VIDEO/CAROUSEL_ALBUM).
      report.droppedImage += 1;
      continue;
    }
    const mapped = catalogItemFromGraphMedia(row, context);
    if (mapped !== null) {
      items.push(mapped);
      report.mapped += 1;
    } else {
      report.droppedNoId += 1;
    }
  }
  return { items, report };
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line !== "" ? line : "Instagram media";
}
