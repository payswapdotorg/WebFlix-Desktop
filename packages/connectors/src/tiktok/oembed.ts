/**
 * TikTok oEmbed client — the PUBLIC, unauthenticated official surface.
 *
 * Official mechanism (developers.tiktok.com/doc/embed-videos): resolve a
 * canonical TikTok video URL
 *   https://www.tiktok.com/@<username>/video/<numeric id>
 * through
 *   GET https://www.tiktok.com/oembed?url=<url-encoded video URL>
 * and receive the oEmbed payload: title, author_name/author_url, type,
 * width/height (portrait player dimensions), thumbnail_url and the `html`
 * field carrying the official blockquote + embed.js embed markup (whose
 * iframe src is the official embed player https://www.tiktok.com/embed/v2/<id>).
 *
 * REGIONAL HONESTY (live-verified 2026-10-11): from regions TikTok does not
 * serve (observed: Hong Kong egress), the oEmbed endpoint does NOT answer
 * the API payload — it 302-redirects to a regional about page
 * (https://www.tiktok.com/hk/about; same result with a browser User-Agent).
 * A redirect (or a followed HTML landing) instead of the JSON payload is
 * therefore surfaced as a typed TikTokRegionUnavailableError: the honest
 * state, never a fabricated item and never a silent failure. The FetchLike
 * seam surfaces either shape (30x status or a 200 whose body is HTML), and
 * the client detects both.
 *
 * SCOPE DISCIPLINE: canonical @user/video/<id> URLs only. Short links
 * (vm.tiktok.com/…) resolve through first-party redirects and stay OUT of
 * this connector (resolving them would require following arbitrary provider
 * redirect chains — a later-phase, explicitly reviewed surface; the honest
 * current answer for a short link is a typed invalid-input error).
 *
 * FIXTURE-TESTED ONLY: injected fetch; without one every call fails fast
 * with LiveNetworkDisabledError.
 */
import { TIKTOK_OEMBED_ENDPOINT } from "./manifest";
import {
  TikTokApiError,
  TikTokFetchLike,
  TikTokNotFoundError,
  TikTokRegionUnavailableError,
} from "./displayApi";
import { LiveNetworkDisabledError } from "../youtube/dataApi";

// LiveNetworkDisabledError is re-imported here for the default fetch below;
// it is the provider-neutral fixture-only refusal class shared with the
// YouTube lane (see ./displayApi for why it is shared, not re-declared).

// ---------------------------------------------------------------------------
// Canonical URL discipline
// ---------------------------------------------------------------------------

/** TikTok video ids are numeric (the official doc example is 19 digits). */
export const TIKTOK_VIDEO_ID_PATTERN = /^\d{6,32}$/;

/** Canonical video URL shape: https://www.tiktok.com/@<username>/video/<id> */
const CANONICAL_VIDEO_URL_PATTERN =
  /^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})\/video\/(\d{6,32})\/?$/;

export interface TikTokVideoUrlParts {
  username: string;
  videoId: string;
  /** The canonical URL re-built from the parts. */
  canonicalUrl: string;
}

/** Builds the canonical video URL from its parts. */
export function canonicalTikTokVideoUrl(username: string, videoId: string): string {
  return `https://www.tiktok.com/@${username}/video/${videoId}`;
}

/**
 * Parses a canonical TikTok video URL into its parts. Returns null for
 * anything else (short links, mobile paths, other hosts) — the honest
 * invalid-input answer, never a guess.
 */
export function parseTikTokVideoUrl(url: string): TikTokVideoUrlParts | null {
  if (typeof url !== "string") return null;
  const match = CANONICAL_VIDEO_URL_PATTERN.exec(url.trim());
  if (match === null) return null;
  return {
    username: match[1],
    videoId: match[2],
    canonicalUrl: canonicalTikTokVideoUrl(match[1], match[2]),
  };
}

export class InvalidTikTokUrlError extends Error {
  constructor(url: string) {
    super(
      `not a canonical TikTok video URL: "${url}" (expected https://www.tiktok.com/@<user>/video/<numeric id>; short links are not resolved by this connector)`,
    );
    this.name = "InvalidTikTokUrlError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// oEmbed payload (structural subset of the official response)
// ---------------------------------------------------------------------------

export interface TikTokOembedPayload {
  title?: string;
  author_name?: string;
  author_url?: string;
  /** The provider's own media type ("video" for videos; anything else is dropped by the mapping). */
  type?: string;
  width?: number;
  height?: number;
  /** Official embed markup: blockquote + embed.js script (iframe src = embed player). */
  html?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  thumbnail_url?: string;
  provider_url?: string;
  provider_name?: string;
  version?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface TikTokOembedClientOptions {
  /** REQUIRED for any network I/O; omit for a fixture-only client. */
  fetchImpl?: TikTokFetchLike;
}

export class TikTokOembedClient {
  private readonly fetchImpl: TikTokFetchLike;

  constructor(options: TikTokOembedClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
  }

  /**
   * Resolves one canonical TikTok video URL through the public oEmbed
   * endpoint (no credentials — the request carries no Authorization header).
   *
   * Honest failures, typed:
   *   - non-canonical URL            → InvalidTikTokUrlError (before any I/O)
   *   - redirect / HTML landing page → TikTokRegionUnavailableError
   *     (live-verified shape: 302 → https://www.tiktok.com/hk/about from HK
   *     egress; the regional about page is not an oEmbed payload)
   *   - 404 / not found              → TikTokNotFoundError
   *   - other provider errors        → TikTokApiError
   */
  async resolveVideo(url: string): Promise<TikTokOembedPayload> {
    const parts = parseTikTokVideoUrl(url);
    if (parts === null) {
      throw new InvalidTikTokUrlError(url);
    }
    const requestUrl = `${TIKTOK_OEMBED_ENDPOINT}?url=${encodeURIComponent(parts.canonicalUrl)}`;

    let response: Awaited<ReturnType<TikTokFetchLike>>;
    try {
      response = await this.fetchImpl(requestUrl, { method: "GET", headers: {} });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      throw new TikTokApiError({
        operationId: "oembed.resolve",
        status: null,
        code: "network-error",
        message: `network failure while resolving TikTok oEmbed: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    // Regional shape A: the endpoint answered a redirect (FetchLike surfaces
    // the 30x directly). TikTok's API endpoints never redirect on success.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      throw new TikTokRegionUnavailableError({
        operationId: "oembed.resolve",
        status: response.status,
        code: "regional-redirect",
        message: `TikTok oEmbed answered HTTP ${response.status}${location ? ` → ${location}` : ""} instead of the oEmbed payload — the surface is not served to this client (live-verified shape from Hong Kong egress: 302 → https://www.tiktok.com/hk/about, 2026-10-11). This is the honest regional-unavailable state, not a parse error.`,
      });
    }

    if (response.status === 404) {
      throw new TikTokNotFoundError({
        operationId: "oembed.resolve",
        status: 404,
        code: "not-found",
        message: "TikTok oEmbed has no video for this URL (HTTP 404).",
      });
    }

    if (!response.ok) {
      throw new TikTokApiError({
        operationId: "oembed.resolve",
        status: response.status,
        code: null,
        message: `TikTok oEmbed error (HTTP ${response.status}).`,
      });
    }

    // Regional shape B: a followed redirect landed on an HTML page (the
    // fetch seam followed the 302; status 200 but the body is the regional
    // landing page, not JSON). Parse honestly: if the body is not a JSON
    // object with oEmbed fields, it is not an oEmbed payload.
    const body = (await response.json().catch(() => null)) as TikTokOembedPayload | null;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      const sample = (await response.text().catch(() => "")).slice(0, 120);
      throw new TikTokRegionUnavailableError({
        operationId: "oembed.resolve",
        status: response.status,
        code: "non-json-payload",
        message: `TikTok oEmbed served HTML instead of the oEmbed JSON payload (body starts: "${sample}…") — the live-verified signature of the regional landing page (followed 302 → https://www.tiktok.com/hk/about, 2026-10-11). This is the honest regional-unavailable state.`,
      });
    }
    if (typeof body.type === "string" && body.type !== "video") {
      throw new TikTokApiError({
        operationId: "oembed.resolve",
        status: response.status,
        code: `oembed-type-${body.type}`,
        message: `TikTok oEmbed returned type "${body.type}", not a video; this connector drops non-video results instead of inventing a media kind for them.`,
      });
    }
    return body;
  }
}

async function liveNetworkDeniedFetch(): Promise<never> {
  throw new LiveNetworkDisabledError(
    "connectors/tiktok oembed: live network calls are disabled (fixture-only build; the public oEmbed endpoint is reachable but the connector ships fixture-tested only)",
  );
}
