/**
 * WFX-ANON-VIEW-1 — the public-web CHANNEL mappers: search channel results
 * (channelRenderer) and channel page headers (pageHeaderViewModel with the
 * legacy c4TabbedHeaderRenderer fallback), ported from the web app's
 * src/lib/youtube/mappers.ts. Only what the response actually reported —
 * absent facts stay absent (the honest-absence law).
 */
import type { YouTubeChannelSummary } from "./mediaSource";
import { findFirst, lastThumbnailUrl, parseSubscriberCount, runsText } from "./publicText";

/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed public
payloads at this layer; the strong summary type is what this module BUILDS. */

/**
 * channelRenderer → summary. NOTE the real response quirk the web app
 * verified: the handle lives in `subscriberCountText` and the subscriber
 * text in `videoCountText`.
 */
export function channelSummaryFromChannelRenderer(r: any): YouTubeChannelSummary | null {
  const id = r?.channelId;
  if (typeof id !== "string" || id === "") return null;
  const canonical = r?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
  const handleFromText = runsText(r?.subscriberCountText).trim();
  const handle =
    (handleFromText.startsWith("@") ? handleFromText : "") ||
    (canonical.startsWith("/@") ? canonical.slice(1) : "") ||
    id;
  const subscriberText = runsText(r?.videoCountText);
  return {
    channelId: id,
    title: runsText(r?.title) !== "" ? runsText(r?.title) : `YouTube channel ${id}`,
    handle,
    description: runsText(r?.descriptionSnippet) !== "" ? runsText(r?.descriptionSnippet) : undefined,
    subscriberCount: parseSubscriberCount(subscriberText !== "" ? subscriberText : null),
    thumbnailUrl: lastThumbnailUrl(r?.thumbnail) !== "" ? lastThumbnailUrl(r?.thumbnail) : undefined,
  };
}

/**
 * Map the current channel page header from a browse/SSR response — the
 * summary the channelById/channelByHandle lookups answer with. Returns null
 * when the page carries no recognizable header (the honest no-channel page).
 */
export function channelSummaryFromPageResponse(response: unknown): YouTubeChannelSummary | null {
  const phr = findFirst(response, "pageHeaderRenderer") as any;
  const phv = phr?.content?.pageHeaderViewModel;
  if (phv) {
    const rows =
      phv?.metadata?.contentMetadataViewModel?.metadataRows ?? phv?.metadata?.rows ?? [];
    let handle = "";
    let subscriberText: string | null = null;
    let videoCountText: string | null = null;
    for (const row of rows) {
      for (const part of row?.metadataParts ?? []) {
        const text = part?.text?.content ?? "";
        if (text === "") continue;
        if (handle === "" && text.startsWith("@")) handle = text;
        else if (/subscribers?$/i.test(text)) subscriberText = text;
        else if (/^\d[\d.,]*[KMB]?\s*videos?$/i.test(text)) videoCountText = text;
      }
    }
    const name = phv?.title?.dynamicTextViewModel?.text?.content ?? phr?.pageTitle ?? "";
    const externalIdRaw =
      (findFirst(response, "channelMetadataRenderer") as any)?.externalId ??
      findFirst(response, "externalId");
    const externalId = typeof externalIdRaw === "string" ? externalIdRaw : "";
    const videoCountMatch =
      videoCountText !== null ? /^([\d.,]+[KMB]?)/.exec(videoCountText) : null;
    const videoCount =
      videoCountMatch !== null
        ? Number(videoCountMatch[1].replace(/,/g, "")) *
          (/[KMB]$/.test(videoCountMatch[1])
            ? videoCountMatch[1].endsWith("K")
              ? 1_000
              : videoCountMatch[1].endsWith("M")
                ? 1_000_000
                : 1_000_000_000
            : 1)
        : undefined;
    return {
      channelId: externalId !== "" ? externalId : handle,
      title: name !== "" ? name : handle,
      handle: handle !== "" ? handle.replace(/^[@\s/]+/, "").trim() : externalId,
      description:
        phv?.description?.descriptionPreviewViewModel?.description?.content ?? undefined,
      subscriberCount: parseSubscriberCount(subscriberText),
      videoCount,
      thumbnailUrl: lastThumbnailUrl(
        phv?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image,
      ) || undefined,
      bannerUrl:
        lastThumbnailUrl(phv?.banner?.imageBannerViewModel?.image) || undefined,
    };
  }
  // legacy header shape (c4TabbedHeaderRenderer)
  const c4 = findFirst(response, "c4TabbedHeaderRenderer") as any;
  if (c4) {
    const subscriberText = runsText(c4?.subscriberCountText);
    const canonical = c4?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ?? "";
    return {
      channelId: typeof c4?.channelId === "string" ? c4.channelId : "",
      title: runsText(c4?.title) !== "" ? runsText(c4?.title) : `YouTube channel ${c4?.channelId ?? ""}`,
      handle: canonical.startsWith("/@") ? canonical.slice(1) : (c4?.channelId ?? ""),
      description: undefined,
      subscriberCount: parseSubscriberCount(subscriberText !== "" ? subscriberText : null),
      thumbnailUrl: lastThumbnailUrl(c4?.avatar) || undefined,
      bannerUrl: lastThumbnailUrl(c4?.banner) || undefined,
    };
  }
  return null;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
