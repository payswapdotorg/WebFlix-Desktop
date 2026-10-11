/* eslint-disable max-lines -- restApi.ts: the Reddit REST API client (REDDIT-CONNECT); payload types for every documented read, the typed error taxonomy keyed on the live-captured envelopes, the served-header rate ledger and the app-only session form one cohesive official-surface unit (precedent: youtube/dataApi.ts, instagram/graphApi.ts). Split deferred to the Phase-2 module split backlog (TL2 arbitration). */
/**
 * Reddit REST API client — the OAuth-authenticated Data API reads
 * (REDDIT-CONNECT scope row 1), on the same discipline as the other four
 * platforms' clients (fixture-only by default; an injected fetchImpl is
 * REQUIRED for any network I/O — omitted, every call fails with
 * LiveNetworkDisabledError, so the package never talks to the network in
 * tests).
 *
 * Every read goes to https://oauth.reddit.com with a Bearer token (app-only
 * or per-user) — the Reddit Data API Wiki's own rule, captured verbatim
 * 2026-10-11: "Clients must authenticate with a registered OAuth token. We
 * can and will freely throttle or block unidentified Data API users." and
 * "Traffic not using OAuth or login credentials will be blocked." The
 * live-verified enforcement shape from this sandbox's datacenter egress:
 * unauthenticated www.reddit.com/.json reads answer HTTP 403 with an HTML
 * block page (~190 KB, <title>Blocked</title> / theme-beta shell) — the
 * client maps that shape to a TYPED RedditBlockedError instead of hiding it.
 *
 * RATE MODEL (basis-labeled): the authoritative enforcement is the served
 * response headers — X-Ratelimit-Used / X-Ratelimit-Remaining /
 * X-Ratelimit-Reset (documented verbatim on the Data API Wiki: "Monitor the
 * following response headers to ensure that you're not exceeding the
 * limits") — plus HTTP 429 with Retry-After. The client records those
 * headers VERBATIM on every call (success and error) and NEVER blocks
 * pre-flight: the provider's own throttle is the enforcement, and a
 * client-side guess would be an invented ceiling (the Twitch header-authority
 * precedent). The headers were NOT observable from this sandbox's blocked
 * egress (the API host 403-blocks it), so the ledger's basis label says
 * served-header and the fixtures replay the documented header names.
 *
 * ADR-0003: only the documented endpoints on the two official hosts. No
 * scraping, no cookie replay, no undocumented endpoints.
 */
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import { REDDIT_API_BASE, REDDIT_DESKTOP_USER_AGENT, REDDIT_TOKEN_URL } from "./manifest";

// ---------------------------------------------------------------------------
// Minimal fetch seam (the Twitch/Instagram precedent)
// ---------------------------------------------------------------------------

export interface RedditFetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface RedditFetchResponseLike {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
}

export type RedditFetchLike = (
  url: string,
  init?: RedditFetchRequestInit,
) => Promise<RedditFetchResponseLike>;

const liveNetworkDeniedFetch: RedditFetchLike = async () => {
  throw new LiveNetworkDisabledError(
    "connectors/reddit restApi: live network I/O is disabled (fixture-only build; live reads are pending the operator's registered Reddit app — operator item, reddit.com/prefs/apps)",
  );
};

// ---------------------------------------------------------------------------
// Documented payload shapes (dev/api — the Listing/Link/Comment structures)
// ---------------------------------------------------------------------------

/** The reddit_video media object (the provider's own playback sources). */
export interface RedditVideoMedia {
  reddit_video: {
    fallback_url: string;
    dash_url?: string;
    hls_url?: string;
    duration?: number;
    height?: number;
    width?: number;
    is_gif?: boolean;
  };
}

/**
 * The oEmbed-shaped media object link posts carry (secure_media / media) —
 * the OFFICIAL payload's own attribution of the ORIGINAL provider (e.g.
 * type "youtube.com", provider_name "YouTube" for YouTube links).
 */
export interface RedditOEmbedMedia {
  oembed: {
    type?: string;
    provider_name?: string;
    url?: string;
    html?: string;
    author_name?: string;
    width?: number;
    height?: number;
  };
}

/** The preview images structure (thumbnails on link/video posts). */
export interface RedditPreview {
  enabled?: boolean;
  images?: Array<{
    source?: { url: string; width: number; height: number };
    resolutions?: Array<{ url: string; width: number; height: number }>;
  }>;
}

/** A t3 Link row (a post) — the fields this connector actually reads. */
export interface RedditLinkData {
  id: string;
  name?: string;
  subreddit?: string;
  subreddit_id?: string;
  title?: string;
  permalink?: string;
  domain?: string;
  url?: string;
  author?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  over_18?: boolean;
  is_video?: boolean;
  is_self?: boolean;
  selftext?: string;
  thumbnail?: string;
  post_hint?: string;
  media?: RedditVideoMedia | RedditOEmbedMedia | null;
  secure_media?: RedditVideoMedia | RedditOEmbedMedia | null;
  preview?: RedditPreview;
  crosspost_parent_list?: RedditLinkData[];
  is_gallery?: boolean;
  is_reddit_media_domain?: boolean;
  media_only?: boolean;
  edited?: boolean | number;
}

/** A t1 Comment row. */
export interface RedditCommentData {
  id: string;
  author?: string;
  body?: string;
  score?: number;
  created_utc?: number;
  permalink?: string;
  depth?: number;
  replies?: string | { kind: string; data?: unknown } | null;
}

/** A t5 Subreddit row (about). */
export interface RedditSubredditAboutData {
  display_name: string;
  title?: string;
  subscribers?: number;
  public_description?: string;
  over18?: boolean;
  url?: string;
  icon_img?: string;
  header_img?: string;
  active_user_count?: number;
}

/** A t2 User row (about). */
export interface RedditUserData {
  name: string;
  id?: string;
  link_karma?: number;
  comment_karma?: number;
  is_gold?: boolean;
  icon_img?: string;
  created_utc?: number;
}

/** The /api/v1/me payload (per-user identity). */
export interface RedditMeData extends RedditUserData {
  verified?: boolean;
  has_verified_email?: boolean;
  over_18?: boolean;
}

/** Listing children (the kinds the read surface returns). */
export type RedditListingChild =
  | { kind: "t3"; data: RedditLinkData }
  | { kind: "t1"; data: RedditCommentData }
  | { kind: "t5"; data: RedditSubredditAboutData }
  | { kind: "more"; data: { count?: number; children?: string[] } }
  | { kind: string; data: unknown };

/** The Listing envelope every listing endpoint returns. */
export interface RedditListing {
  kind: "Listing";
  data: {
    after: string | null;
    before?: string | null;
    dist?: number;
    children: RedditListingChild[];
    geo_filter?: string;
  };
}

/** The post-detail page shape: [post-link Listing, comments Listing]. */
export type RedditPostDetailPage = [RedditListing, RedditListing] | readonly RedditListing[];

// ---------------------------------------------------------------------------
// Rate-budget snapshot (served-header authority, basis-labeled)
// ---------------------------------------------------------------------------

/**
 * What the client observed about the provider's rate state. Every field is
 * VERBATIM from served headers (or null when the provider did not serve
 * one) — the client invents no numbers. `basis` is the honesty label.
 */
export interface RedditRateBudgetSnapshot {
  /** How many calls the ledger has recorded (this client instance). */
  callsRecorded: number;
  /** X-Ratelimit-Used, verbatim, from the most recent response (or null). */
  lastUsed: string | null;
  /** X-Ratelimit-Remaining, verbatim, from the most recent response (or null). */
  lastRemaining: string | null;
  /** X-Ratelimit-Reset (seconds to window end), verbatim (or null). */
  lastResetSeconds: string | null;
  /** Retry-After on a 429, verbatim (or null). */
  lastRetryAfterSeconds: string | null;
  /** The most recent HTTP status (or null before any call). */
  lastStatus: number | null;
  /** True when the most recent call was throttled by the provider itself. */
  providerRateLimited: boolean;
  /** The basis label: these numbers come from served headers, never guesses. */
  basis: "served-header";
}

function emptyRedditBudget(): RedditRateBudgetSnapshot {
  return {
    callsRecorded: 0,
    lastUsed: null,
    lastRemaining: null,
    lastResetSeconds: null,
    lastRetryAfterSeconds: null,
    lastStatus: null,
    providerRateLimited: false,
    basis: "served-header",
  };
}

// ---------------------------------------------------------------------------
// Typed errors (the taxonomy the service maps onto frozen §2.3 statuses)
// ---------------------------------------------------------------------------

export class RedditApiError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  constructor(options: { operationId: string; status: number | null; message: string }) {
    super(options.message);
    this.name = "RedditApiError";
    this.operationId = options.operationId;
    this.status = options.status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 — the live-captured verbatim shape: {"message":"Unauthorized","error":401}. */
export class RedditRequiresAuthError extends RedditApiError {
  readonly providerMessage: string | null;
  readonly providerCode: number | null;
  constructor(options: {
    operationId: string;
    providerMessage?: string | null;
    providerCode?: number | null;
  }) {
    super({
      operationId: options.operationId,
      status: 401,
      message: `${options.operationId}: the token is missing or invalid (${
        options.providerMessage ?? "Unauthorized"
      }) — (re-)authorization required`,
    });
    this.name = "RedditRequiresAuthError";
    this.providerMessage = options.providerMessage ?? null;
    this.providerCode = options.providerCode ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 403 with the HTML block page — the live-verified enforcement of the
 * documented "traffic not using OAuth or login credentials will be blocked"
 * policy (observed on every www/oauth surface from this sandbox's datacenter
 * egress, 2026-10-11). Honest state: the API is unreachable from this
 * network class — surfaced, never hidden.
 */
export class RedditBlockedError extends RedditApiError {
  constructor(options: { operationId: string; detail: string }) {
    super({
      operationId: options.operationId,
      status: 403,
      message: `${options.operationId}: Reddit served a 403 block page (${options.detail}) — the documented policy blocks non-OAuth/datacenter traffic; a residential network or the operator's registered OAuth app is the compliant path`,
    });
    this.name = "RedditBlockedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 429 — the provider's own throttle (served headers + Retry-After recorded). */
export class RedditRateLimitedError extends RedditApiError {
  readonly budget: RedditRateBudgetSnapshot;
  constructor(options: {
    operationId: string;
    budget: RedditRateBudgetSnapshot;
    retryAfterSeconds: number | null;
  }) {
    super({
      operationId: options.operationId,
      status: 429,
      message: `${options.operationId}: rate-limited by Reddit (the documented 100 QPM per OAuth client id free tier, enforced by the provider)${
        options.retryAfterSeconds !== null ? `; Retry-After: ${options.retryAfterSeconds}s` : ""
      }`,
    });
    this.name = "RedditRateLimitedError";
    this.budget = options.budget;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 404 — post/subreddit/user not found. */
export class RedditNotFoundError extends RedditApiError {
  constructor(options: { operationId: string; what: string }) {
    super({
      operationId: options.operationId,
      status: 404,
      message: `${options.operationId}: ${options.what} not found`,
    });
    this.name = "RedditNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No token available for an authenticated read. */
export class RedditMissingCredentialError extends Error {
  constructor(operationId: string, needs: "app-only" | "per-user") {
    super(
      `${operationId} needs ${
        needs === "app-only" ? "an app-only (client_credentials) token" : "a per-user token"
      } — none is available (pending the operator's registered Reddit app / a connected account — operator item)`,
    );
    this.name = "RedditMissingCredentialError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Token sources (the app-only vs per-user distinction, made structural)
// ---------------------------------------------------------------------------

/** An app-only (client_credentials) token source — public reads. */
export interface RedditAppOnlyTokenSource {
  kind: "app-only";
  getAppOnlyAccessToken(): Promise<string | null>;
}

/** A per-user (code flow) token source — identity + my subreddits. */
export interface RedditUserTokenSource {
  kind: "user";
  getUserAccessToken(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export interface RedditRestClientOptions {
  /**
   * REQUIRED for any network I/O; omitted → fixture-only client whose every
   * call fails with LiveNetworkDisabledError.
   */
  fetchImpl?: RedditFetchLike;
  /** App-only token source for public reads. */
  appOnlyTokenSource?: RedditAppOnlyTokenSource | null;
  /** Per-user token source for user-scoped reads. */
  userTokenSource?: RedditUserTokenSource | null;
  /** Override the honest descriptive User-Agent (operator item). */
  userAgent?: string;
  clock?: () => number;
}

export interface RedditListingResult {
  listing: RedditListing;
  budget: RedditRateBudgetSnapshot;
}

export interface RedditReadResult<T> {
  data: T;
  budget: RedditRateBudgetSnapshot;
}

/** Listing query parameters (the documented shared set). */
export interface RedditListingParams {
  limit?: number;
  after?: string;
  before?: string;
  count?: number;
  /** The top-listing time window (hour|day|week|month|year|all). */
  t?: string;
  /** The search query (search endpoints). */
  q?: string;
  type?: string;
  include_facets?: boolean;
}

/**
 * The fixture-only-by-default REST client. Public reads take the app-only
 * token (falling back to a per-user token — both are OAuth, and the wiki's
 * block rule is about OAuth vs not); user-scoped reads REQUIRE the per-user
 * token and say so honestly when it is missing.
 */
export class RedditRestClient {
  private readonly fetchImpl: RedditFetchLike;
  private readonly appOnlyTokenSource: RedditAppOnlyTokenSource | null;
  private readonly userTokenSource: RedditUserTokenSource | null;
  private readonly userAgent: string;
  private readonly nowFn: () => number;
  private budget: RedditRateBudgetSnapshot = emptyRedditBudget();

  constructor(options: RedditRestClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.appOnlyTokenSource = options.appOnlyTokenSource ?? null;
    this.userTokenSource = options.userTokenSource ?? null;
    this.userAgent = options.userAgent ?? REDDIT_DESKTOP_USER_AGENT;
    this.nowFn = options.clock ?? (() => Date.now());
  }

  /** The most recent served-header budget snapshot. */
  get rateBudget(): RedditRateBudgetSnapshot {
    return { ...this.budget };
  }

  // ---- public reads (app-only OAuth; documented listings) ---------------

  async getSubredditHot(
    subreddit: string,
    params: RedditListingParams = {},
  ): Promise<RedditListingResult> {
    return this.listing("listings.hot", `/r/${subreddit}/hot`, params);
  }

  async getSubredditNew(
    subreddit: string,
    params: RedditListingParams = {},
  ): Promise<RedditListingResult> {
    return this.listing("listings.new", `/r/${subreddit}/new`, params);
  }

  async getSubredditTop(
    subreddit: string,
    params: RedditListingParams = {},
  ): Promise<RedditListingResult> {
    return this.listing("listings.top", `/r/${subreddit}/top`, params);
  }

  async getBest(params: RedditListingParams = {}): Promise<RedditListingResult> {
    return this.listing("listings.best", "/best", params);
  }

  async searchLinks(
    query: string,
    subreddit?: string,
    params: RedditListingParams = {},
  ): Promise<RedditListingResult> {
    const path = subreddit !== undefined && subreddit !== "" ? `/r/${subreddit}/search` : "/search";
    return this.listing("search.query", path, { ...params, q: query, type: "link" });
  }

  async getUserSubmitted(
    username: string,
    params: RedditListingParams = {},
  ): Promise<RedditListingResult> {
    return this.listing("user.submitted", `/user/${username}/submitted`, params);
  }

  /** GET /comments/<article-id> — the post + its comment tree. */
  async getPostComments(
    postId: string,
    params: RedditListingParams = {},
  ): Promise<{
    post: RedditLinkData | null;
    comments: RedditCommentData[];
    budget: RedditRateBudgetSnapshot;
  }> {
    const raw = await this.requestJson<RedditPostDetailPage>(
      "post.detail",
      `/comments/${postId}`,
      params,
      "app-only",
    );
    const pages = Array.isArray(raw) ? raw : [];
    let post: RedditLinkData | null = null;
    const comments: RedditCommentData[] = [];
    for (const page of pages) {
      for (const child of page?.data?.children ?? []) {
        if (child.kind === "t3" && post === null) post = child.data as RedditLinkData;
        else if (child.kind === "t1") comments.push(child.data as RedditCommentData);
      }
    }
    return { post, comments, budget: this.rateBudget };
  }

  /** GET /r/<sub>/about — the subreddit browse container. */
  async getSubredditAbout(
    subreddit: string,
  ): Promise<RedditReadResult<RedditSubredditAboutData | null>> {
    const body = await this.requestJson<{ kind: string; data?: RedditSubredditAboutData }>(
      "subreddit.about",
      `/r/${subreddit}/about`,
      {},
      "app-only",
    );
    return { data: body?.data ?? null, budget: this.rateBudget };
  }

  /** GET /user/<username>/about — the public user browse container. */
  async getUserAbout(username: string): Promise<RedditReadResult<RedditUserData | null>> {
    const body = await this.requestJson<{ kind: string; data?: RedditUserData }>(
      "user.about",
      `/user/${username}/about`,
      {},
      "app-only",
    );
    return { data: body?.data ?? null, budget: this.rateBudget };
  }

  // ---- per-user reads (the app-only vs per-user distinction) -------------

  /** GET /api/v1/me — REQUIRES a per-user token (identity scope). */
  async getMe(): Promise<RedditReadResult<RedditMeData | null>> {
    const body = await this.requestJson<RedditMeData>("identity.me", "/api/v1/me", {}, "per-user");
    return { data: body ?? null, budget: this.rateBudget };
  }

  /** GET /subreddits/mine/subscriber — REQUIRES a per-user token (mysubreddits scope). */
  async getMySubreddits(params: RedditListingParams = {}): Promise<RedditListingResult> {
    return this.listing("subreddits.mine", "/subreddits/mine/subscriber", params, "per-user");
  }

  // ---- internals ----------------------------------------------------------

  private async listing(
    operationId: string,
    path: string,
    params: RedditListingParams,
    tokenKind: "app-only" | "per-user" = "app-only",
  ): Promise<RedditListingResult> {
    const listing = await this.requestJson<RedditListing>(operationId, path, params, tokenKind);
    return { listing, budget: this.rateBudget };
  }

  private async pickToken(tokenKind: "app-only" | "per-user"): Promise<string | null> {
    if (tokenKind === "per-user") {
      return this.userTokenSource !== null ? await this.userTokenSource.getUserAccessToken() : null;
    }
    // Public reads prefer the app-only token; a per-user token also carries
    // the read scope and is an honest fallback (both are OAuth).
    if (this.appOnlyTokenSource !== null) {
      const appOnly = await this.appOnlyTokenSource.getAppOnlyAccessToken();
      if (appOnly !== null) return appOnly;
    }
    return this.userTokenSource !== null ? await this.userTokenSource.getUserAccessToken() : null;
  }

  private async requestJson<T>(
    operationId: string,
    path: string,
    params: RedditListingParams,
    tokenKind: "app-only" | "per-user",
  ): Promise<T> {
    const token = await this.pickToken(tokenKind);
    if (token === null || token === "") {
      throw new RedditMissingCredentialError(operationId, tokenKind);
    }

    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
    const url =
      qs.toString() !== ""
        ? `${REDDIT_API_BASE}${path}?${qs.toString()}`
        : `${REDDIT_API_BASE}${path}`;

    let response: RedditFetchResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": this.userAgent,
          Accept: "application/json",
        },
      });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      throw new RedditApiError({
        operationId,
        status: null,
        message: `${operationId}: network failure — ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    this.recordBudget(response);

    const bodyText = await response.text().catch(() => "");
    const status = response.status;

    if (status === 429) {
      const retryAfter = this.budget.lastRetryAfterSeconds;
      throw new RedditRateLimitedError({
        operationId,
        budget: this.rateBudget,
        retryAfterSeconds: retryAfter !== null ? Number(retryAfter) : null,
      });
    }
    if (status === 401) {
      const parsed = parseUnauthorizedBody(bodyText);
      throw new RedditRequiresAuthError({
        operationId,
        providerMessage: parsed.message,
        providerCode: parsed.code,
      });
    }
    if (status === 403) {
      // The live-verified block-page shape (HTML, not JSON) vs a genuine
      // permission denial (JSON) — distinguished honestly, not guessed.
      const isBlockPage = bodyText.trimStart().startsWith("<");
      throw new RedditBlockedError({
        operationId,
        detail: isBlockPage
          ? "HTML block page (the live-captured shape: ~190 KB theme-beta shell / <title>Blocked</title>)"
          : `JSON denial: ${bodyText.slice(0, 120)}`,
      });
    }
    if (status === 404) {
      throw new RedditNotFoundError({ operationId, what: path });
    }
    if (status < 200 || status >= 300) {
      throw new RedditApiError({
        operationId,
        status,
        message: `${operationId}: unexpected HTTP ${status} — ${bodyText.slice(0, 160)}`,
      });
    }

    let parsedBody: T;
    try {
      parsedBody = JSON.parse(bodyText) as T;
    } catch {
      throw new RedditApiError({
        operationId,
        status,
        message: `${operationId}: response body is not JSON (content may be an HTML shell) — refusing to guess a payload`,
      });
    }
    return parsedBody;
  }

  /**
   * The AUTHORITATIVE served-header record — verbatim, on every call, with
   * NO pre-flight blocking (the provider's 429 + Retry-After is the
   * enforcement; a client-side ceiling would be invented).
   */
  private recordBudget(response: RedditFetchResponseLike): void {
    const used = readHeader(response.headers, "x-ratelimit-used");
    const remaining = readHeader(response.headers, "x-ratelimit-remaining");
    const reset = readHeader(response.headers, "x-ratelimit-reset");
    const retryAfter = readHeader(response.headers, "retry-after");
    this.budget = {
      callsRecorded: this.budget.callsRecorded + 1,
      lastUsed: used,
      lastRemaining: remaining,
      lastResetSeconds: reset,
      lastRetryAfterSeconds: retryAfter,
      lastStatus: response.status,
      providerRateLimited: response.status === 429,
      basis: "served-header",
    };
  }
}

function readHeader(headers: Record<string, string>, name: string): string | null {
  const direct = headers[name];
  if (typeof direct === "string" && direct !== "") return direct;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value !== "" ? value : null;
  }
  return null;
}

/**
 * The live-captured 401 body shape:
 * {"message": "Unauthorized", "error": 401} (verbatim, 2026-10-11, dummy
 * Basic credentials against the token endpoints). Returns nulls for any
 * other shape — the error keeps the honest raw fallback.
 */
export function parseUnauthorizedBody(bodyText: string): {
  message: string | null;
  code: number | null;
} {
  try {
    const parsed = JSON.parse(bodyText) as { message?: unknown; error?: unknown };
    return {
      message: typeof parsed.message === "string" ? parsed.message : null,
      code: typeof parsed.error === "number" ? parsed.error : null,
    };
  } catch {
    return { message: null, code: null };
  }
}

// ---------------------------------------------------------------------------
// App-only session (client_credentials — the documented public-read token)
// ---------------------------------------------------------------------------

/** The documented app-only token response. */
export interface RedditAppOnlyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  /** NEVER present for app-only grants (the wiki: "App-only OAuth token requests never receive a refresh_token"). */
  refresh_token?: string;
}

export interface RedditAppOnlySessionOptions {
  fetchImpl?: RedditFetchLike;
  clientId: string;
  clientSecret: string;
  userAgent?: string;
  clock?: () => number;
}

/**
 * The app-only token manager: requests a client_credentials token, caches it
 * with expiry awareness, and re-requests (never "refreshes" — there is no
 * refresh token for app-only grants, an honest asymmetry the OAuth2 wiki
 * documents). Implements RedditAppOnlyTokenSource for the REST client.
 */
export class RedditAppOnlySession implements RedditAppOnlyTokenSource {
  readonly kind = "app-only" as const;
  private readonly fetchImpl: RedditFetchLike;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userAgent: string;
  private readonly nowFn: () => number;
  private cached: { token: string; expiresAtMs: number } | null = null;

  constructor(options: RedditAppOnlySessionOptions) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.userAgent = options.userAgent ?? REDDIT_DESKTOP_USER_AGENT;
    this.nowFn = options.clock ?? (() => Date.now());
  }

  async getAppOnlyAccessToken(): Promise<string | null> {
    const now = this.nowFn();
    if (this.cached !== null && this.cached.expiresAtMs - 30_000 > now) {
      return this.cached.token;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, "utf8").toString("base64");
    let response: RedditFetchResponseLike;
    try {
      response = await this.fetchImpl(REDDIT_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": this.userAgent,
        },
        body: "grant_type=client_credentials",
      });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      throw new RedditApiError({
        operationId: "oauth.app-only",
        status: null,
        message: `oauth.app-only: network failure — ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }
    if (response.status === 401) {
      const bodyText = await response.text().catch(() => "");
      const parsed = parseUnauthorizedBody(bodyText);
      throw new RedditRequiresAuthError({
        operationId: "oauth.app-only",
        providerMessage: parsed.message,
        providerCode: parsed.code,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      const bodyText = await response.text().catch(() => "");
      throw new RedditApiError({
        operationId: "oauth.app-only",
        status: response.status,
        message: `oauth.app-only: token request failed (HTTP ${response.status}) — ${bodyText.slice(0, 160)}`,
      });
    }
    const bodyText = await response.text();
    let parsed: RedditAppOnlyTokenResponse;
    try {
      parsed = JSON.parse(bodyText) as RedditAppOnlyTokenResponse;
    } catch {
      throw new RedditApiError({
        operationId: "oauth.app-only",
        status: response.status,
        message: "oauth.app-only: token response is not JSON — refusing to guess",
      });
    }
    const expiresInMs =
      typeof parsed.expires_in === "number" && parsed.expires_in > 0
        ? parsed.expires_in * 1000
        : 3600_000;
    this.cached = { token: parsed.access_token, expiresAtMs: now + expiresInMs };
    return parsed.access_token;
  }
}
