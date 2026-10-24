/**
 * WFX-ANON-VIEW-1 — the public-web payload mappers: walk real youtube.com
 * InnerTube/SSR responses and yield the engine rows (the canonical
 * CatalogItem + display facts, exactly the shapes the app-side
 * YouTubeCatalogSource port consumes).
 *
 * Ported from the web app's src/lib/youtube/mappers.ts (its anonymous path —
 * every field mapped from an actual response field; nothing invented):
 *   - videoRenderer / gridVideoRenderer — search results, channel grids
 *   - lockupViewModel — the current unified item renderer (trending grids,
 *     channel shelves)
 *   - richItemRenderer — wraps the above (grid containers)
 *   - channelRenderer — search channel results (publicChannelMapping.ts)
 *
 * Canonical discipline (mirrors catalogMapping.ts): provider attribution is
 * item-level, videoId in metadata.externalIds.youtube, the official
 * youtube-nocookie embed + the hotlinked i.ytimg.com thumbnail ride as
 * ProviderAssets, provenance evidence names the PUBLIC surface (never a
 * secret — there are none on this path). shortsLockupViewModel is
 * deliberately NOT walked: its rows carry no duration, and the app layer's
 * shorts classification is duration/marker-driven — the shorts surface
 * rides the public search feed instead (documented in publicSource.ts).
 */
import type { CatalogItem } from "webflix-contracts";
import { YOUTUBE_PROVIDER_ID } from "./manifest";
import { YOUTUBE_VIDEO_ID_PATTERN } from "./playback";
import type { YouTubeVideoRow } from "./mediaSource";
import { publicProvenance, publicVideoThumbnailUrl } from "./publicTransport";
import {
  parseDurationSec,
  relativeAgeToDate,
  runsText,
  viewsFromTexts,
  walkTree,
} from "./publicText";

/* eslint-disable @typescript-eslint/no-explicit-any -- the public payloads are
loosely typed at this layer (the web app's own discipline); the strong row
types are what this module BUILDS. */

/** One watchable row from a public-web payload (the port's intermediate). */
export interface PublicVideoFacts {
  readonly videoId: string;
  readonly title: string;
  readonly channelId?: string;
  readonly channelTitle?: string;
  readonly publishedAt?: string;
  readonly viewCount?: number;
  readonly durationMs?: number;
  readonly liveBroadcastContent?: string;
  readonly thumbnailUrl?: string;
}

// ---------------------------------------------------------------------------
// renderer badge/live helpers (ported verbatim)
// ---------------------------------------------------------------------------

function badgeStyles(node: any): string[] {
  const out: string[] = [];
  for (const b of [...(node?.ownerBadges ?? []), ...(node?.badges ?? [])]) {
    const style = b?.metadataBadgeRenderer?.style;
    if (typeof style === "string") out.push(style.replace(/^BADGE_STYLE_TYPE_/, "").toLowerCase());
    else {
      const label = runsText(b?.metadataBadgeRenderer?.label);
      if (label !== "") out.push(label.toLowerCase());
    }
  }
  return [...new Set(out)];
}

function isLiveFromRenderer(node: any): boolean {
  if (badgeStyles(node).some((s) => s.includes("live"))) return true;
  for (const overlay of node?.thumbnailOverlays ?? []) {
    if (overlay?.thumbnailOverlayTimeStatusRenderer?.style === "LIVE") return true;
  }
  const views = runsText(node?.shortViewCountText) || runsText(node?.viewCountText);
  return /watching now$/i.test(views);
}

function isUpcomingFromRenderer(node: any): boolean {
  for (const overlay of node?.thumbnailOverlays ?? []) {
    if (overlay?.thumbnailOverlayTimeStatusRenderer?.style === "UPCOMING") return true;
  }
  return false;
}

/** Channel id/handle/title from a byline runs array (search/owner text). */
function channelFromBylineRuns(runs: any[] | undefined): { channelId?: string; channelTitle: string } {
  const first = Array.isArray(runs) ? runs[0] : null;
  const channelId: unknown = first?.navigationEndpoint?.browseEndpoint?.browseId;
  const name = Array.isArray(runs) ? runs.map((r: any) => r?.text ?? "").join("") : "";
  return {
    channelId: typeof channelId === "string" && channelId !== "" ? channelId : undefined,
    channelTitle: name,
  };
}

// ---------------------------------------------------------------------------
// renderer → facts mappers (each total: null when the row is not watchable)
// ---------------------------------------------------------------------------

function liveBroadcastContentOf(node: any): string | undefined {
  if (isLiveFromRenderer(node)) return "live";
  if (isUpcomingFromRenderer(node)) return "upcoming";
  return undefined;
}

/** videoRenderer → facts (search results, home/trending grids). */
export function factsFromVideoRenderer(r: any): PublicVideoFacts | null {
  const id = r?.videoId;
  if (typeof id !== "string" || id === "") return null;
  const title = runsText(r?.title);
  if (title === "") return null;
  const owner = r?.owner?.videoOwnerRenderer;
  const byline = owner?.title?.runs ?? r?.ownerText?.runs ?? r?.longBylineText?.runs ?? r?.shortBylineText?.runs;
  const channel = channelFromBylineRuns(byline);
  const publishedText = runsText(r?.publishedTimeText);
  return {
    videoId: id,
    title,
    channelId: channel.channelId,
    channelTitle: channel.channelTitle !== "" ? channel.channelTitle : undefined,
    publishedAt: relativeAgeToDate(publishedText !== "" ? publishedText : null),
    viewCount: viewsFromTexts(
      runsText(r?.viewCountText) || runsText(r?.shortViewCountText) || null,
      null,
    ),
    durationMs: (() => {
      const sec = parseDurationSec(runsText(r?.lengthText));
      return sec !== null && sec > 0 ? sec * 1000 : undefined;
    })(),
    liveBroadcastContent: liveBroadcastContentOf(r),
    thumbnailUrl: publicVideoThumbnailUrl(id),
  };
}

/** gridVideoRenderer → facts (channel video grids). */
export function factsFromGridVideoRenderer(r: any): PublicVideoFacts | null {
  const id = r?.videoId;
  if (typeof id !== "string" || id === "") return null;
  const title = runsText(r?.title);
  if (title === "") return null;
  const channel = channelFromBylineRuns(
    r?.ownerText?.runs ?? r?.longBylineText?.runs ?? r?.shortBylineText?.runs,
  );
  const publishedText = runsText(r?.publishedTimeText);
  return {
    videoId: id,
    title,
    channelId: channel.channelId,
    channelTitle: channel.channelTitle !== "" ? channel.channelTitle : undefined,
    publishedAt: relativeAgeToDate(publishedText !== "" ? publishedText : null),
    viewCount: viewsFromTexts(
      runsText(r?.viewCountText) || runsText(r?.shortViewCountText) || null,
      null,
    ),
    durationMs: (() => {
      const sec = parseDurationSec(runsText(r?.lengthText));
      return sec !== null && sec > 0 ? sec * 1000 : undefined;
    })(),
    liveBroadcastContent: liveBroadcastContentOf(r),
    thumbnailUrl: publicVideoThumbnailUrl(id),
  };
}

interface LockupMeta {
  channelName: string;
  viewsText: string | null;
  viewsA11y: string | null;
  publishedText: string | null;
}

/** Flatten lockupViewModel metadata rows into channel/views/age parts. */
function lockupMeta(l: any): LockupMeta {
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const rows =
    lmv?.metadata?.contentMetadataViewModel?.metadataRows ?? lmv?.metadata?.rows ?? [];
  const meta: LockupMeta = {
    channelName: "",
    viewsText: null,
    viewsA11y: null,
    publishedText: null,
  };
  for (const row of rows) {
    for (const part of row?.metadataParts ?? []) {
      const text = part?.text?.content ?? "";
      const a11y = part?.text?.accessibilityLabel ?? "";
      if (text === "") continue;
      if (/ago$/i.test(text) || /ago$/i.test(a11y)) {
        meta.publishedText = meta.publishedText ?? text;
        continue;
      }
      if (
        part?.leadingIcon?.name === "PLAY_ARROW_OUTLINED" ||
        / views$/i.test(a11y) ||
        (/^[\d.,]+[KMB]?$/i.test(text) &&
          meta.channelName !== "" &&
          meta.viewsText === null &&
          !/^\d+ videos?$/i.test(text) &&
          !/subscri/i.test(text))
      ) {
        if (meta.viewsText === null) {
          meta.viewsText = text;
          meta.viewsA11y = a11y !== "" ? a11y : null;
        }
        continue;
      }
      if (!meta.channelName && !/subscri/i.test(text) && !/^\d+ videos?$/i.test(text)) {
        meta.channelName = text;
      }
    }
  }
  return meta;
}

/** lockupViewModel → facts (trending grids, channel shelves, related rails). */
export function factsFromLockupViewModel(l: any): PublicVideoFacts | null {
  const id = l?.contentId;
  if (typeof id !== "string" || id === "") return null;
  const lmv = l?.metadata?.lockupMetadataViewModel ?? {};
  const title = lmv?.title?.content ?? "";
  if (title === "") return null; // promo/skeleton lockups carry no title
  const meta = lockupMeta(l);
  let live = false;
  let durationMs: number | undefined;
  for (const overlay of l?.contentImage?.thumbnailViewModel?.overlays ?? []) {
    for (const badge of overlay?.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const text = badge?.thumbnailBadgeViewModel?.text ?? "";
      if (/^(?:\d+:)?\d{1,2}:\d{2}$/.test(text)) {
        const sec = parseDurationSec(text);
        durationMs = sec !== null && sec > 0 ? sec * 1000 : undefined;
      } else if (/^live/i.test(text)) {
        live = true;
      }
    }
  }
  return {
    videoId: id,
    title,
    channelTitle: meta.channelName !== "" ? meta.channelName : undefined,
    publishedAt: relativeAgeToDate(meta.publishedText),
    viewCount: viewsFromTexts(meta.viewsText, meta.viewsA11y),
    durationMs,
    liveBroadcastContent: live ? "live" : undefined,
    thumbnailUrl: publicVideoThumbnailUrl(id),
  };
}

/** richItemRenderer → facts (dispatches on the wrapped content). */
export function factsFromRichItemRenderer(r: any): PublicVideoFacts | null {
  const content = r?.content ?? {};
  return (
    factsFromVideoRenderer(content.videoRenderer) ??
    factsFromGridVideoRenderer(content.gridVideoRenderer) ??
    factsFromLockupViewModel(content.lockupViewModel) ??
    null
  );
}

// ---------------------------------------------------------------------------
// facts → the canonical engine row
// ---------------------------------------------------------------------------

function isValidVideoId(videoId: unknown): videoId is string {
  return typeof videoId === "string" && YOUTUBE_VIDEO_ID_PATTERN.test(videoId);
}

function yearOf(publishedAt: string | undefined): number | undefined {
  if (typeof publishedAt !== "string" || publishedAt.length < 4) return undefined;
  const year = Number(publishedAt.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
}

/** The canonical CatalogItem for a public-surface row (catalogMapping discipline). */
export function catalogItemFromPublicFacts(
  facts: PublicVideoFacts,
  context: { observedAt: string; surface: string },
): CatalogItem {
  const metadata: Record<string, unknown> = {
    externalIds: { youtube: facts.videoId },
  };
  if (facts.channelId !== undefined) metadata.channelId = facts.channelId;
  if (facts.channelTitle !== undefined) metadata.channelTitle = facts.channelTitle;
  if (facts.publishedAt !== undefined) metadata.publishedAt = facts.publishedAt;
  if (facts.liveBroadcastContent !== undefined) {
    metadata.liveBroadcastContent = facts.liveBroadcastContent;
  }
  const year = yearOf(facts.publishedAt);
  if (year !== undefined) metadata.year = year;
  return {
    id: `${YOUTUBE_PROVIDER_ID}:video:${facts.videoId}`,
    providerId: YOUTUBE_PROVIDER_ID,
    title: facts.title,
    mediaKind: facts.liveBroadcastContent === "live" ? "live" : "video",
    assets: [
      {
        assetId: `youtube:embed:${facts.videoId}`,
        kind: "embed",
        reference: `https://www.youtube-nocookie.com/embed/${facts.videoId}`,
      },
      {
        assetId: `youtube:thumb:${facts.videoId}:hqdefault`,
        kind: "thumbnail",
        reference: publicVideoThumbnailUrl(facts.videoId),
        mimeType: "image/jpeg",
      },
    ],
    matchEvidence: {
      confidence: 1,
      evidence: [publicProvenance(context.surface, facts.videoId)],
    },
    metadata,
  };
}

/** One facts payload → the engine row the app port consumes. */
export function rowFromPublicFacts(
  facts: PublicVideoFacts,
  context: { observedAt: string; surface: string },
): YouTubeVideoRow | null {
  if (!isValidVideoId(facts.videoId)) return null;
  return {
    item: catalogItemFromPublicFacts(facts, context),
    channelId: facts.channelId,
    channelTitle: facts.channelTitle,
    publishedAt: facts.publishedAt,
    viewCount: facts.viewCount,
    durationMs: facts.durationMs,
    liveBroadcastContent: facts.liveBroadcastContent,
    thumbnailUrl: facts.thumbnailUrl,
  };
}

// ---------------------------------------------------------------------------
// the generic walker (search/feed/trending/channel grids — document order)
// ---------------------------------------------------------------------------

/**
 * Every watchable row found anywhere in a public-web response, in document
 * order, de-duplicated by video id (the web app's mapVideos walker).
 */
export function publicRowsFromResponse(
  response: unknown,
  context: { observedAt: string; surface: string; limit?: number },
): YouTubeVideoRow[] {
  const seen = new Set<string>();
  const out: YouTubeVideoRow[] = [];
  const push = (facts: PublicVideoFacts | null): void => {
    if (facts === null || facts.videoId === "" || facts.title === "") return;
    if (seen.has(facts.videoId)) return;
    seen.add(facts.videoId);
    const row = rowFromPublicFacts(facts, context);
    if (row !== null) out.push(row);
  };
  for (const r of walkTree(response, "videoRenderer")) push(factsFromVideoRenderer(r));
  for (const r of walkTree(response, "gridVideoRenderer")) push(factsFromGridVideoRenderer(r));
  for (const r of walkTree(response, "richItemRenderer")) push(factsFromRichItemRenderer(r));
  for (const r of walkTree(response, "lockupViewModel")) push(factsFromLockupViewModel(r));
  return context.limit !== undefined ? out.slice(0, context.limit) : out;
}

/** The next-page continuation token from a search response — ANY page's shape
 * (the web app's P22-C fix: continuation pages carry no sectionListRenderer,
 * so the whole tree is walked for continuationItemRenderer nodes). */
export function publicSearchContinuationToken(response: unknown): string | null {
  for (const item of walkTree(response, "continuationItemRenderer")) {
    const token = (item as any)?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token !== "") return token;
  }
  for (const section of walkTree(response, "sectionListRenderer")) {
    const token = (section as any)?.continuations?.[0]?.nextContinuationData?.continuation;
    if (typeof token === "string" && token !== "") return token;
  }
  return null;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
