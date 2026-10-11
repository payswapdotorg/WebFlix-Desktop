/**
 * Reddit playback-plan builder — the OFFICIAL-EMBED watch path
 * (REDDIT-CONNECT scope row 2), on the same frozen §2.2 discipline as the
 * other four platforms.
 *
 * WHAT THE INVESTIGATION FOUND (live, 2026-10-11 — see the parity matrix
 * §watch for the verbatim records):
 *   1. The official embed mechanism is the widgets.js DOM widget: a
 *      blockquote.reddit-embed-bq wrapping the post's canonical <a href>,
 *      plus <script async src="https://embed.reddit.com/widgets.js">. The
 *      widget script (fetched + read live, 7,453 bytes) scans those
 *      blockquotes, takes the post's OWN path (r/<sub>/comments/<id>/<slug>
 *      or a user path), and creates an iframe pointing at
 *      https://embed.reddit.com/<path>?… with width 640, sandbox
 *      "allow-scripts allow-same-origin allow-popups", allowfullscreen,
 *      and postMessage-driven height resize ("resize.embed" messages).
 *   2. THE SHORTLINK FOLD: https://embed.reddit.com/comments/<post-id> —
 *      the same canonical shortlink shape every Reddit post page publishes
 *      (reddit.com/comments/<id>) — answers 200 with the embed shell, BOTH
 *      on direct navigation and in iframe context (Sec-Fetch-Dest: iframe +
 *      cross-site Referer), and its content-security-policy carries
 *      frame-ancestors * — the surface is EXPLICITLY frameable by any
 *      origin. This is the clean fold onto the frozen single-placeholder
 *      embedSpec.urlTemplate (mediaId = the base36 post id): no RD-FD is
 *      needed for the watch path.
 *   3. The LEGACY embed surface www.redditmedia.com/mediaembed/<id> is
 *      RETIRED: it answered 404 for the real, still-live post id the
 *      official dev/api docs themselves reference (15bfi0) — recorded, not
 *      papered over.
 *   4. NO GATE: unlike Instagram's app-review-gated oEmbed, this
 *      share-embed surface is the platform's public share mechanism —
 *      no developer credentials, no review chain, no conditional framing.
 *      The honest default is therefore the official-embed plan, ON (the
 *      YouTube precedent), with the caveats recorded as notes rather than
 *      hidden: the embed renders the post (title + media + comment
 *      context); end-to-end playback inside the desktop webview is the
 *      operator's packaged-app smoke (parity matrix §watch).
 *
 * NO FREEZE DEVIATION: everything folds into the frozen shapes —
 * official-embed {providerId, embedSpec: SecretFreeRecord} and the
 * resolver's {mediaId} urlTemplate. No RD-FD is needed.
 *
 * ADR-0003: playback uses ONLY the official embed surface. No stream
 * extraction from the payload's reddit_video fields (those are provenance
 * metadata — see ./catalogMapping), no scraping, no third-party players.
 */
import type { PlaybackPlan } from "webflix-contracts";
import { REDDIT_EMBED_BASE, REDDIT_PROVIDER_ID, REDDIT_WIDGETS_JS_URL } from "./manifest";
import { REDDIT_POST_ID_PATTERN } from "./catalogMapping";

/** Official-documentation citation (connector-local; Reddit-suffixed). */
export interface RedditCitationNote {
  label: string;
  url: string;
}

const OFFICIAL_WIDGET_DOC: RedditCitationNote = {
  label:
    "embed.reddit.com/widgets.js — the official embed mechanism's loader script (live-fetched and read 2026-10-11; builds embed.reddit.com/<post-path> iframes with sandbox allow-scripts allow-same-origin allow-popups + postMessage resize)",
  url: REDDIT_WIDGETS_JS_URL,
};

const OFFICIAL_API_DOC: RedditCitationNote = {
  label:
    "Reddit API reference — GET [/r/subreddit]/comments/<article>: the documented comment-tree/post read; the base36 article id is the token the shortlink and embed surface address",
  url: "https://www.reddit.com/dev/api",
};

const OFFICIAL_DATA_API_WIKI: RedditCitationNote = {
  label:
    "Reddit Data API Wiki — the OAuth requirement, rate limits (100 QPM verbatim) and usage terms this embed path operates under",
  url: "https://support.reddithelp.com/hc/en-us/articles/16160319875092",
};

export class InvalidRedditPostIdError extends Error {
  constructor(postId: string) {
    super(
      `not a valid Reddit post id: "${postId}" (base36 token expected — the dev/api reference's "base 36 ID of a Link"); refusing to build a playback plan`,
    );
    this.name = "InvalidRedditPostIdError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface RedditPlaybackOptions {
  /** The base36 post id (the token the embed surface addresses). */
  postId: string;
  title?: string;
  width?: number;
}

/** The widget script's own iframe width (from the live-read source: 640px). */
export const DEFAULT_REDDIT_EMBED_WIDTH = 640;

export const OFFICIAL_REDDIT_EMBED_ALLOW =
  "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-read; clipboard-write";

/** The official embed-surface URL for a post id (the shortlink fold). */
export function redditEmbedUrlForPost(postId: string): string {
  return `${REDDIT_EMBED_BASE}/comments/${postId}`;
}

/**
 * Builds the canonical PlaybackPlan for a Reddit post — TOTAL and honest:
 *   - invalid post id → InvalidRedditPostIdError (never a guessed URL)
 *   - valid id        → the official-embed plan against
 *     https://embed.reddit.com/comments/<id> — ON BY DEFAULT (no gate on
 *     this surface; the platform's own share mechanism).
 */
export function buildRedditPlaybackPlan(options: RedditPlaybackOptions): PlaybackPlan {
  const postId = options.postId;
  if (typeof postId !== "string" || !REDDIT_POST_ID_PATTERN.test(postId)) {
    throw new InvalidRedditPostIdError(postId);
  }

  const embedUrl = redditEmbedUrlForPost(postId);
  const notes = [
    "Official Reddit embed surface only (ADR-0003); no stream extraction from the payload's reddit_video fields, no scraping, no third-party players.",
    `The documented mechanism is the widgets.js DOM widget — blockquote.reddit-embed-bq wrapping the post's canonical link + <script async src="${REDDIT_WIDGETS_JS_URL}"> — which builds an iframe at embed.reddit.com/<post-path>. WebFlix points its iframe at the same official surface via the canonical shortlink shape (embed.reddit.com/comments/<id>), the one-token fold the frozen urlTemplate supports.`,
    "Framing honesty (live-verified 2026-10-11): the embed shell answers 200 both direct and iframe-context with content-security-policy frame-ancestors * — explicitly frameable by any origin (contrast Instagram's conditional x-frame-options); the legacy www.redditmedia.com/mediaembed/<id> surface is retired (404 even for the live doc-example post id).",
    "Sizing honesty (from the live-read widget source): width 640, sandbox allow-scripts allow-same-origin allow-popups, allowfullscreen, and postMessage-driven height resize — the height is NOT invented here; the host sizes the iframe from the surface's own resize.embed messages.",
    "The embed renders the post (title + media + comment context); end-to-end playback inside the packaged desktop webview is the operator's smoke item (parity matrix §watch), recorded rather than assumed.",
    "Usage terms: this is the platform's public share-embed; the Data API terms still apply to API-consumed data (the AI-training restriction is recorded in the manifest + parity matrix — WebFlix is a media client and trains nothing).",
  ];

  return {
    kind: "official-embed",
    providerId: REDDIT_PROVIDER_ID,
    embedSpec: {
      postId,
      embedUrl,
      permalink: `https://www.reddit.com/comments/${postId}`,
      domain: "reddit.com",
      iframe: {
        width: options.width ?? DEFAULT_REDDIT_EMBED_WIDTH,
        title: options.title ?? `Reddit post — ${postId}`,
        allow: OFFICIAL_REDDIT_EMBED_ALLOW,
        allowFullScreen: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        sandbox: "allow-scripts allow-same-origin allow-popups",
        style: "border: 0; max-width: 100%;",
      },
      mechanism: {
        kind: "official-embed-surface",
        playerUrl: embedUrl,
        documentedAlternative: `blockquote.reddit-embed-bq > a[href="https://www.reddit.com/comments/${postId}"] + <script async src="${REDDIT_WIDGETS_JS_URL}">`,
      },
      notes,
      provenance: [OFFICIAL_API_DOC, OFFICIAL_WIDGET_DOC, OFFICIAL_DATA_API_WIKI],
    },
  };
}

// ---------------------------------------------------------------------------
// The structural resolver adapter (the playback package's Connector shape;
// architecture-policy keeps playback from importing connectors — the two
// packages meet at the canonical §2.2 PlaybackPlan shape. This twin is
// asserted against the connectors-side original by test.)
// ---------------------------------------------------------------------------

export interface RedditPlaybackConnector {
  id: string;
  providerId: string;
  version: string;
  embed: {
    providerId: string;
    /** The one-token fold: the shortlink shape with the base36 post id. */
    urlTemplate: string;
    /** ON by default — the honest contrast with Instagram's gated surface. */
    allowsEmbedding: boolean;
  };
}

/**
 * The resolver-facing adapter: embeds are ON by default for Reddit — the
 * surface is the platform's public share mechanism (frame-ancestors *,
 * live-verified), so the honest plan is the official embed, never an
 * unavailable stub.
 */
export const REDDIT_PLAYBACK_CONNECTOR: RedditPlaybackConnector = {
  id: "reddit",
  providerId: REDDIT_PROVIDER_ID,
  version: "1.0.0",
  embed: {
    providerId: REDDIT_PROVIDER_ID,
    urlTemplate: `${REDDIT_EMBED_BASE}/comments/{mediaId}`,
    allowsEmbedding: true,
  },
};
