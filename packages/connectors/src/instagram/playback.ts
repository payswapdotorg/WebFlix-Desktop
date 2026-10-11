/**
 * Instagram playback-plan builder — the honest-default watch path
 * (INSTAGRAM-CONNECT scope row 2), on the same frozen §2.2 discipline as the
 * other three platforms, with the work order's mandate made structural:
 *
 *   "if playback cannot be driven officially without approved credentials,
 *    emit honest unavailable + user-handoff (open official app) as the
 *    DEFAULT state and record the approved-credential path as the pending
 *    row."
 *
 * WHAT THE INVESTIGATION FOUND (live, 2026-10-11 — see the parity matrix
 * §watch for the verbatim records):
 *   1. The official embed mechanism is the oEmbed markup: a
 *      blockquote.instagram-media (data-instgrm-permalink) plus the async
 *      loader <script async src="//platform.instagram.com/en_US/embeds.js">
 *      — the oEmbed API live-answered an UNAUTHENTICATED request for the
 *      doc-example public post (HTTP 200, full payload, captured verbatim).
 *   2. The embed page https://www.instagram.com/p|reel/<shortcode>/embed/
 *      answers 200 anonymous but CONDITIONALLY frameable: direct navigation
 *      carries x-frame-options: DENY, while an iframe-context request
 *      (Sec-Fetch-Dest: iframe + cross-site Referer) carries NO
 *      x-frame-options. The framing gate is request-context-driven — there
 *      is no query parameter WebFlix could pin (contrast Twitch's parent
 *      parameter).
 *   3. End-to-end embed playback inside the desktop webview therefore cannot
 *      be verified from this sandbox, and the oEmbed API is app-review-gated
 *      for production reliance.
 *
 * THE DESIGN: the DEFAULT plan is the honest unavailable{requires-auth} +
 * open-provider-app handoff (carrying the post permalink as the handoff
 * deep-link — the frozen RecoveryHint.url). The approved-credential path is
 * SHIPPED but OFF BY DEFAULT: `embedApproved: true` builds the official-
 * embed plan against the documented embed page. Both directions are
 * fixture-tested; flipping the flag is the operator's integration step
 * (parity matrix §watch), never a silent default.
 *
 * NO FREEZE DEVIATION: everything folds into the frozen shapes —
 * official-embed {providerId, embedSpec: SecretFreeRecord} and
 * unavailable {reason, recovery}. No IG-FD is needed for the watch path.
 *
 * ADR-0003: playback uses ONLY the official embed surface. No stream
 * extraction, no scraping, no third-party players, no undocumented
 * endpoints.
 */
import type { PlaybackPlan } from "webflix-contracts";
import {
  INSTAGRAM_EMBED_SCRIPT_URL,
  INSTAGRAM_OEMBED_EMBEDS_JS_URL,
  INSTAGRAM_PROVIDER_ID,
  INSTAGRAM_WEB_BASE,
} from "./manifest";
import { INSTAGRAM_SHORTCODE_PATTERN } from "./oembed";

/**
 * Official-documentation citation (connector-local; Instagram-suffixed so it
 * does not collide with the other playback modules' identically-shaped
 * citation notes in the package public surface).
 */
export interface InstagramCitationNote {
  label: string;
  url: string;
}

const OFFICIAL_OEMBED_DOC: InstagramCitationNote = {
  label:
    "Instagram oEmbed — the endpoint, URL formats (/p/, /reel/), the embed.js mechanism and the embedding-only usage terms (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/oembed",
};
const OFFICIAL_EMBED_BUTTON_DOC: InstagramCitationNote = {
  label: "Instagram Embed Button — the official embed mechanism for public posts (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/embed-button",
};

export class InvalidInstagramShortcodeError extends Error {
  constructor(shortcode: string) {
    super(
      `not a valid Instagram media shortcode: "${shortcode}" (URL-safe base62-style token expected); refusing to build a playback plan`,
    );
    this.name = "InvalidInstagramShortcodeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface InstagramPlaybackOptions {
  /** The media shortcode (the token the embed surface addresses). */
  shortcode: string;
  /** Whether the media is a Reel (drives /reel/ vs /p/ embed paths). */
  isReel?: boolean;
  title?: string;
  /**
   * The operator gate: official embed playback is enabled ONLY after the
   * Meta app review chain completes. DEFAULT FALSE — the honest unavailable
   * plan (work order mandate).
   */
  embedApproved?: boolean;
  width?: number;
}

/** The oEmbed-documented embed width (the payload's own width field: 658). */
export const DEFAULT_INSTAGRAM_EMBED_WIDTH = 658;

export const OFFICIAL_INSTAGRAM_EMBED_ALLOW =
  "autoplay; encrypted-media; picture-in-picture; fullscreen; web-share";

/** The handoff permalink for a media kind + shortcode. */
export function instagramPermalinkFor(isReel: boolean, shortcode: string): string {
  const segment = isReel ? "reel" : "p";
  return `${INSTAGRAM_WEB_BASE}/${segment}/${shortcode}/`;
}

/** The documented embed-page URL for a media kind + shortcode. */
export function instagramEmbedPageFor(isReel: boolean, shortcode: string): string {
  const segment = isReel ? "reel" : "p";
  return `${INSTAGRAM_WEB_BASE}/${segment}/${shortcode}/embed/`;
}

/**
 * Builds the canonical PlaybackPlan for Instagram media — TOTAL and honest:
 *   - invalid shortcode                    → InvalidInstagramShortcodeError
 *   - embedApproved not set (the DEFAULT)  → unavailable{requires-auth} with
 *     an open-provider-app handoff carrying the post permalink (the work
 *     order's mandated default; the operator's Meta app review chain gates
 *     the official embed path)
 *   - embedApproved: true (the pending     → official-embed plan against the
 *     approved-credential path)              documented embed page
 */
export function buildInstagramPlaybackPlan(options: InstagramPlaybackOptions): PlaybackPlan {
  const shortcode = options.shortcode;
  if (typeof shortcode !== "string" || !INSTAGRAM_SHORTCODE_PATTERN.test(shortcode)) {
    throw new InvalidInstagramShortcodeError(shortcode);
  }
  const isReel = options.isReel === true;
  const permalink = instagramPermalinkFor(isReel, shortcode);

  if (options.embedApproved !== true) {
    return {
      kind: "unavailable",
      reason: "requires-auth",
      recovery: {
        action: "open-provider-app",
        message: `Instagram's official embed playback is not enabled in WebFlix yet: the oEmbed/embed surface is gated behind the operator's Meta app review (pending — see the Instagram parity matrix §watch), and WebFlix never guesses a player. Watch this ${isReel ? "reel" : "post"} in the official Instagram app/site.`,
        url: permalink,
      },
    };
  }

  const embedUrl = instagramEmbedPageFor(isReel, shortcode);
  const notes = [
    "Official Instagram embed surface only (ADR-0003); no stream extraction or scraping.",
    `The documented mechanism is the oEmbed markup — blockquote.instagram-media (data-instgrm-permalink) + the async loader <script async src="${INSTAGRAM_OEMBED_EMBEDS_JS_URL}"> (loader also served at ${INSTAGRAM_EMBED_SCRIPT_URL}) — which renders this same embed page; WebFlix points its iframe at the identical official surface directly.`,
    "Framing honesty (live-verified 2026-10-11): the embed page answers x-frame-options: DENY on direct navigation but serves NO x-frame-options to iframe-context requests (Sec-Fetch-Dest: iframe + cross-site Referer) — the webview must therefore navigate as a genuine embed iframe; this is the integration step the operator verifies before flipping embedApproved.",
    "Responsive sizing per the oEmbed docs: the embed adapts to its container width (the payload's documented width is 658) and its height varies with caption length — no fixed height is invented here.",
    "This plan is emitted ONLY with embedApproved: true — the operator's post-review integration flag (parity matrix §watch); the default remains the honest unavailable + open-provider-app handoff.",
  ];

  return {
    kind: "official-embed",
    providerId: INSTAGRAM_PROVIDER_ID,
    embedSpec: {
      shortcode,
      embedUrl,
      permalink,
      mediaKind: isReel ? "reel" : "post",
      domain: "instagram.com",
      iframe: {
        width: options.width ?? DEFAULT_INSTAGRAM_EMBED_WIDTH,
        title: options.title ?? `Instagram ${isReel ? "reel" : "post"} — ${shortcode}`,
        allow: OFFICIAL_INSTAGRAM_EMBED_ALLOW,
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        style: "border: 0; max-width: 100%;",
      },
      mechanism: {
        kind: "official-embed-page",
        playerUrl: embedUrl,
        documentedAlternative: `blockquote.instagram-media[data-instgrm-permalink="${permalink}"] + <script async src="${INSTAGRAM_OEMBED_EMBEDS_JS_URL}">`,
      },
      notes,
      provenance: [OFFICIAL_OEMBED_DOC, OFFICIAL_EMBED_BUTTON_DOC],
    },
  };
}
