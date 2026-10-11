/**
 * Instagram oEmbed client — the official embed-markup surface
 * (GET graph.facebook.com/v26.0/instagram_oembed?url=…).
 *
 * OFFICIAL MECHANISM (oEmbed guide, live-read 2026-10-11): resolve one of the
 * documented URL formats
 *   - posts:     https://www.instagram.com/p/{media-shortcode}/
 *   - reels:     https://www.instagram.com/reel/{media-shortcode}/
 *   - profiles:  https://www.instagram.com/{username}
 * through the oEmbed endpoint and receive the embed payload: version "1.0",
 * provider_name "Instagram", type "rich", width 658 and the `html` field
 * carrying the official blockquote.instagram-media markup (with
 * data-instgrm-permalink pointing at the post) plus the async loader
 *   <script async src="//platform.instagram.com/en_US/embeds.js">
 * which "scans the page for the post HTML and generates the fully rendered
 * post".
 *
 * SCOPE DISCIPLINE — this connector accepts canonical POST and REEL URLs
 * only: the watch path is the one sanctioned use (see the terms note below),
 * and a profile URL is not a watchable item. Short-link/redirect URLs are
 * not resolved (same discipline as the TikTok lane).
 *
 * USAGE TERMS (oEmbed guide, verbatim): the endpoint "is only meant to be
 * used for embedding Instagram content in websites and apps… Using metadata
 * and page, post, or video content (or their derivations) from the endpoint
 * for any purpose other than providing a front-end view of the page, post,
 * or video is strictly prohibited… including… deriving information about
 * pages, posts and videos from the metadata for analytics purposes." This
 * client is therefore PLAYBACK-PATH ONLY: its payload feeds the watch
 * surface, never catalog metadata enrichment (the catalog rides the Graph
 * reads instead — see ./catalogMapping).
 *
 * LIVE EVIDENCE (2026-10-11, captured verbatim as fixtures):
 *   - an UNAUTHENTICATED call for the oEmbed doc's own example post
 *     (https://www.instagram.com/p/fA9uwTtkSN/) answered HTTP 200
 *     application/json with the FULL payload — the html field carrying the
 *     blockquote + the //platform.instagram.com/en_US/embeds.js loader;
 *   - a DEAD shortcode answered HTTP 400 with
 *     {"error":{"message":"The requested resource does not exist",
 *      "type":"OAuthException","code":24,"error_subcode":2207045,
 *      "error_user_title":"Media Not Found",
 *      "error_user_msg":"The requested media could not be embedded either
 *       because it does not exist or you don't have permission to embed it.",
 *      "fbtrace_id":"…"}}.
 * The manifest holds oembed.resolve at requires-auth (pending the operator's
 * Meta app review chain) — the anonymous success on one public post is
 * recorded as evidence, not treated as a waiver of the production gate.
 *
 * FIXTURE-TESTED ONLY: injected fetch; without one every call fails fast
 * with LiveNetworkDisabledError.
 */
import { INSTAGRAM_API_VERSION, INSTAGRAM_GRAPH_BASE, INSTAGRAM_OEMBED_PATH } from "./manifest";
import {
  InstagramApiError,
  InstagramFetchLike,
  InstagramRateLimitedError,
  InstagramRequiresAuthError,
} from "./graphApi";
import { LiveNetworkDisabledError } from "../youtube/dataApi";

// LiveNetworkDisabledError is re-imported here for the default fetch below;
// it is the provider-neutral fixture-only refusal class shared with the
// YouTube lane (see ./graphApi for why it is shared, not re-declared).

// ---------------------------------------------------------------------------
// Canonical URL discipline
// ---------------------------------------------------------------------------

/**
 * Instagram media shortcodes are URL-safe base62-style tokens. The connector
 * does not fix a length (the provider has used several); it validates the
 * charset and rejects empty/degenerate values honestly.
 */
export const INSTAGRAM_SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{5,64}$/;

export type InstagramMediaKind = "post" | "reel";

export interface InstagramMediaUrlParts {
  kind: InstagramMediaKind;
  shortcode: string;
  /** The canonical URL re-built from the parts. */
  canonicalUrl: string;
}

/** Builds the canonical media URL from its parts. */
export function canonicalInstagramMediaUrl(kind: InstagramMediaKind, shortcode: string): string {
  const segment = kind === "reel" ? "reel" : "p";
  return `https://www.instagram.com/${segment}/${shortcode}/`;
}

/**
 * Parses a canonical Instagram post/reel URL into its parts. Returns null
 * for anything else (profile URLs, share/redirect links, other hosts) — the
 * honest invalid-input answer, never a guess.
 */
export function parseInstagramMediaUrl(url: string): InstagramMediaUrlParts | null {
  if (typeof url !== "string") return null;
  const match = /^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]{5,64})\/?$/.exec(
    url.trim(),
  );
  if (match === null) return null;
  const kind: InstagramMediaKind = match[1] === "reel" ? "reel" : "post";
  return {
    kind,
    shortcode: match[2],
    canonicalUrl: canonicalInstagramMediaUrl(kind, match[2]),
  };
}

export class InvalidInstagramUrlError extends Error {
  constructor(url: string) {
    super(
      `not a canonical Instagram post/reel URL: "${url}" (expected https://www.instagram.com/p/<shortcode>/ or https://www.instagram.com/reel/<shortcode>/; profile URLs and share links are not resolved by this connector)`,
    );
    this.name = "InvalidInstagramUrlError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// oEmbed payload (structural subset of the official response — the
// LIVE-CAPTURED shape; see fixtures/instagram/oembed.success.json)
// ---------------------------------------------------------------------------

export interface InstagramOembedPayload {
  version?: string;
  provider_name?: string;
  provider_url?: string;
  /** The provider's own media type ("rich" for Instagram embeds). */
  type?: string;
  width?: number;
  /**
   * The official embed markup: blockquote.instagram-media (with
   * data-instgrm-permalink) + the async embeds.js loader. EMBEDDING USE
   * ONLY per the documented terms — never a metadata source.
   */
  html?: string;
  thumbnail_url?: string;
  author_name?: string;
  author_url?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface InstagramOembedClientOptions {
  /** REQUIRED for any network I/O; omit for a fixture-only client. */
  fetchImpl?: InstagramFetchLike;
  /**
   * Access token for the call (Graph convention: the access_token query
   * parameter). The live 2026-10-11 observation recorded an anonymous 200
   * for one public post; production reliance is gated on the operator's app
   * review — this field lets the main process supply the token when the
   * operator chain completes.
   */
  accessToken?: string | null;
  apiVersion?: string;
}

export class InstagramOembedClient {
  private readonly fetchImpl: InstagramFetchLike;
  private readonly accessToken: string | null;
  private readonly apiVersion: string;

  constructor(options: InstagramOembedClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.accessToken = options.accessToken ?? null;
    this.apiVersion = options.apiVersion ?? INSTAGRAM_API_VERSION;
  }

  /**
   * Resolves one canonical Instagram post/reel URL through the official
   * oEmbed endpoint (playback path only — see the module header's terms
   * note).
   *
   * Honest failures, typed:
   *   - non-canonical URL                        → InvalidInstagramUrlError (before any I/O)
   *   - code 24 / subcode 2207045 (dead/private/ → InstagramOembedMediaNotEmbeddableError
   *     embed-disabled content, live-captured)     (the provider's own words carried)
   *   - code 190 / OAuthException                → InstagramRequiresAuthError
   *   - 429 / request-limit codes                → InstagramRateLimitedError
   *   - other provider errors                    → InstagramApiError
   */
  async resolveEmbed(url: string): Promise<InstagramOembedPayload> {
    const parts = parseInstagramMediaUrl(url);
    if (parts === null) {
      throw new InvalidInstagramUrlError(url);
    }

    const qs = new URLSearchParams({ url: parts.canonicalUrl });
    if (this.accessToken !== null) qs.set("access_token", this.accessToken);
    const requestUrl = `${INSTAGRAM_GRAPH_BASE}/${this.apiVersion}${INSTAGRAM_OEMBED_PATH}?${qs.toString()}`;

    let response: Awaited<ReturnType<InstagramFetchLike>>;
    try {
      response = await this.fetchImpl(requestUrl, { method: "GET", headers: {} });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      throw new InstagramApiError({
        operationId: "oembed.resolve",
        status: null,
        message: `network failure while resolving Instagram oEmbed: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    const body = (await response.json().catch(() => null)) as InstagramOembedPayload | null;

    if (!response.ok) {
      const envelope = (body as unknown as { error?: Record<string, unknown> } | null)?.error;
      const code = typeof envelope?.code === "number" ? envelope.code : null;
      const subcode = typeof envelope?.error_subcode === "number" ? envelope.error_subcode : null;
      const providerMessage =
        typeof envelope?.error_user_msg === "string"
          ? envelope.error_user_msg
          : typeof envelope?.message === "string"
            ? envelope.message
            : null;

      if (code === 24 || subcode === 2207045) {
        throw new InstagramOembedMediaNotEmbeddableError({
          operationId: "oembed.resolve",
          status: response.status,
          code,
          errorSubcode: subcode,
          providerMessage,
          url: parts.canonicalUrl,
        });
      }

      if (response.status === 429 || code === 4 || code === 17 || code === 32) {
        throw new InstagramRateLimitedError({
          operationId: "oembed.resolve",
          status: response.status,
          code,
          errorSubcode: subcode,
          providerMessage,
          message: `Instagram oEmbed throttled the request (HTTP ${response.status}${code !== null ? `, code ${code}` : ""}); the documented oEmbed limit is 1,000 requests per hour. The provider's enforcement is authoritative; no automatic retry.`,
        });
      }

      if (response.status === 401 || code === 190 || code === 2500) {
        throw new InstagramRequiresAuthError({
          operationId: "oembed.resolve",
          status: response.status,
          code,
          errorSubcode: subcode,
          providerMessage,
          message:
            providerMessage ??
            `Instagram oEmbed rejected the request's credentials (HTTP ${response.status})`,
        });
      }

      throw new InstagramApiError({
        operationId: "oembed.resolve",
        status: response.status,
        code,
        errorSubcode: subcode,
        providerMessage,
        message: providerMessage ?? `Instagram oEmbed error (HTTP ${response.status}).`,
      });
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      const sample = (await response.text().catch(() => "")).slice(0, 120);
      throw new InstagramApiError({
        operationId: "oembed.resolve",
        status: response.status,
        message: `Instagram oEmbed served a non-JSON payload (body starts: "${sample}…"); refusing to guess an oEmbed response`,
      });
    }
    return body;
  }
}

/**
 * The provider's honest "this media cannot be embedded" answer — the live-
 * captured code 24 / subcode 2207045 envelope ("The requested media could
 * not be embedded either because it does not exist or you don't have
 * permission to embed it." — dead, private, inactive, age-restricted or
 * embed-disabled content per the guide's Limitations).
 */
export class InstagramOembedMediaNotEmbeddableError extends InstagramApiError {
  readonly mediaUrl: string;

  constructor(init: InstagramApiErrorInitLike & { url: string }) {
    super({
      operationId: init.operationId,
      status: init.status,
      code: init.code,
      errorSubcode: init.errorSubcode,
      providerMessage: init.providerMessage,
      message:
        `${init.url}: the media could not be embedded (provider code ${String(init.code ?? "?")}/${String(init.errorSubcode ?? "?")} — dead, private, inactive, age-restricted, or embeds disabled by the account). ${init.providerMessage ?? ""}`.trim(),
    });
    this.name = "InstagramOembedMediaNotEmbeddableError";
    this.mediaUrl = init.url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface InstagramApiErrorInitLike {
  operationId: string;
  status?: number | null;
  code?: number | null;
  errorSubcode?: number | null;
  providerMessage?: string | null;
}

async function liveNetworkDeniedFetch(): Promise<never> {
  throw new LiveNetworkDisabledError(
    "connectors/instagram oembed: live network calls are disabled (fixture-only build; the oEmbed endpoint live-answered an anonymous request for the doc-example post on 2026-10-11 — recorded in the parity matrix — but the connector ships fixture-tested only)",
  );
}
