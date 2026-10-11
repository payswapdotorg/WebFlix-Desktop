/**
 * TikTok official embed playback-plan builder — canonical PlaybackPlan
 * (official-embed), the same frozen §2.2 discipline as YouTube's IFrame
 * builder.
 *
 * OFFICIAL MECHANISM (investigated per the work order; sources cited in
 * embedSpec.provenance):
 *   1. The documented embed (developers.tiktok.com/doc/embed-videos) is a
 *      <blockquote class="tiktok-embedded-video" cite="<video url>"
 *      data-video-id="<id>"> … </blockquote> plus the async loader
 *      <script src="https://www.tiktok.com/embed.js"> — embed.js swaps the
 *      blockquote for an iframe player.
 *   2. The iframe the mechanism produces points at the official embed player
 *      https://www.tiktok.com/embed/v2/<video id> (portrait; the oEmbed
 *      payload's html carries the same src, and oEmbed reports the player
 *      dimensions — 325×580 for the doc's example).
 *   3. WebFlix therefore renders the OFFICIAL PLAYER URL directly in its own
 *      iframe — the exact same player surface the official mechanism
 *      produces, without inventing any parameter. No playerVars exist in
 *      TikTok's official embed surface (no documented query parameters), so
 *      none are emitted — an honest absence, not a stub.
 *
 * The mechanism maps CLEANLY onto the frozen official-embed plan
 * {kind, providerId, embedSpec: SecretFreeRecord}: everything the host needs
 * folds into embedSpec (videoId, embedUrl, domain, iframe attributes, notes,
 * provenance citations). No shapes are forced; no freeze deviation is needed
 * for the embed path itself.
 *
 * REGIONAL HONESTY: the embed host is regionally geo-redirected in regions
 * TikTok does not serve (live-verified 2026-10-11: /embed/v2/<id> → 302 →
 * https://www.tiktok.com/hk/about from Hong Kong egress). The builder
 * therefore accepts an optional viewer region and answers the honest frozen
 * unavailable{reason: "region"} plan for regions in the OBSERVED-unavailable
 * list — never a player that would silently land on a marketing page.
 *
 * ADR-0003: playback uses ONLY the official embed player. No stream
 * extraction, no signature deciphering, no third-party players, no
 * undocumented endpoints.
 */
import type { PlaybackPlan } from "webflix-contracts";
import { TIKTOK_EMBED_SCRIPT_URL, TIKTOK_EMBED_URL_PREFIX } from "./manifest";
import { TIKTOK_OBSERVED_UNAVAILABLE_REGIONS, TIKTOK_PROVIDER_ID } from "./manifest";
import { TIKTOK_VIDEO_ID_PATTERN } from "./oembed";

/**
 * Official-documentation citation (connector-local; not a contract shape —
 * TikTok-suffixed so it does not collide with the YouTube playback module's
 * identically-shaped CitationNote in the package public surface).
 */
export interface TikTokCitationNote {
  label: string;
  url: string;
}

const OFFICIAL_EMBED_DOC: TikTokCitationNote = {
  label: "TikTok Embed Videos — official embed mechanism (blockquote + embed.js)",
  url: "https://developers.tiktok.com/doc/embed-videos",
};
const OFFICIAL_TIKTOK_HELP_EMBED: TikTokCitationNote = {
  label: "TikTok oEmbed endpoint (official; the html field carries the same embed player src)",
  url: "https://developers.tiktok.com/doc/embed-videos",
};

export class InvalidTikTokVideoIdError extends Error {
  constructor(videoId: string) {
    super(
      `not a valid TikTok video id: "${videoId}" (official ids are numeric); refusing to build a playback plan`,
    );
    this.name = "InvalidTikTokVideoIdError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface TikTokPlaybackOptions {
  videoId: string;
  title?: string;
  /** Viewer region (ISO 3166-1 alpha-2). When it is an OBSERVED-unavailable region, the plan is honestly unavailable. */
  userRegion?: string;
  width?: number;
  height?: number;
}

/** Portrait player dimensions the official oEmbed reports for the doc example. */
export const DEFAULT_TIKTOK_EMBED_WIDTH = 325;
export const DEFAULT_TIKTOK_EMBED_HEIGHT = 580;
export const OFFICIAL_TIKTOK_EMBED_ALLOW =
  "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";

/**
 * Regions where the embed host was observed unavailable (connector-local
 * view of TIKTOK_OBSERVED_UNAVAILABLE_REGIONS — uppercase region codes).
 */
export const TIKTOK_EMBED_OBSERVED_UNAVAILABLE_REGIONS: readonly string[] =
  TIKTOK_OBSERVED_UNAVAILABLE_REGIONS.map((note) => note.region.toUpperCase());

function isObservedUnavailableRegion(region: string | undefined): boolean {
  if (typeof region !== "string" || region === "") return false;
  return TIKTOK_EMBED_OBSERVED_UNAVAILABLE_REGIONS.includes(region.toUpperCase());
}

/**
 * Builds the canonical PlaybackPlan for a TikTok video (official embed
 * player). Total and honest:
 *   - invalid video id                     → InvalidTikTokVideoIdError
 *   - observed-unavailable viewer region   → unavailable{region, change-region}
 *   - otherwise                            → official-embed plan whose
 *     embedSpec.embedUrl is the official embed player URL.
 */
export function buildTikTokPlaybackPlan(options: TikTokPlaybackOptions): PlaybackPlan {
  const videoId = options.videoId;
  if (!TIKTOK_VIDEO_ID_PATTERN.test(videoId)) {
    throw new InvalidTikTokVideoIdError(videoId);
  }

  if (isObservedUnavailableRegion(options.userRegion)) {
    const region = options.userRegion as string;
    return {
      kind: "unavailable",
      reason: "region",
      recovery: {
        action: "change-region",
        message: `TikTok's web player is not served in region ${region.toUpperCase()} (live-observed: the embed host redirects to a regional about page). WebFlix shows this honestly instead of a broken player.`,
      },
    };
  }

  const embedUrl = `${TIKTOK_EMBED_URL_PREFIX}${videoId}`;

  const notes = [
    "Official TikTok embed player only (ADR-0003); no stream extraction or signature deciphering.",
    "The documented mechanism is a tiktok-embedded-video blockquote plus the async embed.js loader; that loader renders this same embed player URL (https://www.tiktok.com/embed/v2/<id>) — WebFlix points its iframe at the identical official player surface directly.",
    "TikTok's official embed exposes no documented player parameters, so none are emitted (honest absence).",
    "Portrait player dimensions default to the official oEmbed example (325x580).",
    `Regional note: from regions TikTok does not serve, the embed host redirects to a regional about page (live-observed 2026-10-11); this connector surfaces that as an honest unavailable{region} plan instead of rendering a marketing page. Loader reference: ${TIKTOK_EMBED_SCRIPT_URL}`,
  ];

  return {
    kind: "official-embed",
    providerId: TIKTOK_PROVIDER_ID,
    embedSpec: {
      videoId,
      embedUrl,
      domain: "tiktok.com",
      iframe: {
        width: options.width ?? DEFAULT_TIKTOK_EMBED_WIDTH,
        height: options.height ?? DEFAULT_TIKTOK_EMBED_HEIGHT,
        title: options.title ?? `TikTok player — ${videoId}`,
        allow: OFFICIAL_TIKTOK_EMBED_ALLOW,
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        style: "border: 0; max-width: 100%;",
      },
      mechanism: {
        kind: "official-embed-player",
        playerUrl: embedUrl,
        documentedAlternative: `blockquote.tiktok-embedded-video[data-video-id] + <script async src="${TIKTOK_EMBED_SCRIPT_URL}">`,
      },
      notes,
      provenance: [OFFICIAL_EMBED_DOC, OFFICIAL_TIKTOK_HELP_EMBED],
    },
  };
}
