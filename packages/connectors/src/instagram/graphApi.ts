/* eslint-disable max-lines -- graphApi.ts: the Graph API client (the discovery chain, profile,
 media and insights reads), its typed error taxonomy and the usage-header ledger form one cohesive
 official-surface unit (repo precedent: youtube/dataApi.ts + tiktok/displayApi.ts +
 twitch/helixApi.ts carry the same disable for the same reason). */
/**
 * Instagram Graph API client (Instagram API with Facebook Login for Business
 * — the official-surface variant this connector drives; host
 * graph.facebook.com, version pinned per the manifest). ADR-0003: official
 * surfaces only; every endpoint and field below is read from the live
 * official documentation (2026-10-11) — nothing is guessed.
 *
 * Endpoints (all GET, all requiring the per-user Facebook Login token):
 *   - discovery   GET /me/accounts                       → the user's Pages
 *                GET /{page-id}?fields=instagram_business_account
 *                                                       → the linked IG User
 *                (the documented two-step discovery chain, verbatim from the
 *                Getting Started guide; the app user may hold tasks on
 *                several Pages, so ALL Page→IG candidates are returned and
 *                the caller picks — the guide's own instruction)
 *   - profile     GET /{ig-user-id}?fields=username,name,biography,
 *                 followers_count,follows_count,media_count,
 *                 profile_picture_url,website
 *   - media       GET /{ig-user-id}/media?fields=…&limit&after&since&until
 *                 (Graph cursor paging {paging:{cursors:{after},next}};
 *                 10K most-recent cap; stories excluded by the endpoint)
 *   - insights    GET /{ig-user-id}/insights?metric=…&period=…
 *                 GET /{media-id}/insights?metric=…
 *
 * ERROR HONESTY: the Graph error envelope is
 *   {"error":{"message":…,"type":"OAuthException"|"IGApiException",
 *             "code":…,"error_subcode":…,"error_data":…,
 *             "error_user_title":…,"error_user_msg":…,"fbtrace_id":…}}
 * Live-captured verbatim 2026-10-11 (see the parity matrix live-smoke):
 *   - graph.facebook.com unauthenticated /me → HTTP 400 code 2500
 *     "An active access token must be used to query information about the
 *      current user." (OAuthException)
 *   - instagram_oembed with a dead shortcode → HTTP 400 code 24 subcode
 *     2207045 "The requested resource does not exist" (error_user_title
 *     "Media Not Found") — see ./oembed
 * The client maps the envelope's code/type onto typed errors; the body never
 * overrides the HTTP status.
 *
 * RATE HONESTY: Instagram Platform calls are BUC-rate-limited with the
 * documented impressions formula (see the manifest basis string) — there is
 * NO numeric remaining-count header. What the provider DOES serve, once an
 * endpoint has seen enough traffic, is the X-App-Usage /
 * X-Business-Use-Case-Usage response headers carrying percentage-used JSON
 * ({"call_count":%,"total_cputime":%,"total_time":%}). The ledger records
 * those headers VERBATIM when present, exposes the last observed values with
 * the basis label, and NEVER blocks pre-flight: the provider's own throttle
 * error (HTTP 429, or the Graph request-limit error codes) is the only
 * authoritative enforcement acted on, surfaced as a typed rate-limited
 * error and never silently retried.
 *
 * FIXTURE-TESTED ONLY: no live calls and no credentials in this package. The
 * client requires an injected fetchImpl; without one every call fails fast
 * with LiveNetworkDisabledError (live smoke is pending the operator's Meta
 * app review chain — operator item, the heaviest of the four platforms).
 */
import {
  INSTAGRAM_API_VERSION,
  INSTAGRAM_GRAPH_BASE,
  INSTAGRAM_RATE_LIMIT_BASIS,
} from "./manifest";
import { LiveNetworkDisabledError } from "../youtube/dataApi";

// The provider-neutral fixture-only refusal class is shared with the YouTube
// lane (identical semantics). Imported, not re-declared — and deliberately
// NOT re-exported from this module: the package index already exports it
// once via ./youtube/dataApi.

// ---------------------------------------------------------------------------
// Fetch seam (injected; Instagram-suffixed per the Twitch/TikTok precedent)
// ---------------------------------------------------------------------------

export interface InstagramFetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface InstagramFetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type InstagramFetchLike = (
  url: string,
  init?: InstagramFetchRequestInit,
) => Promise<InstagramFetchResponseLike>;

/** Source of per-user Facebook Login access tokens (the session in ./oauth). */
export interface InstagramUserAccessTokenProvider {
  getUserAccessToken(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Errors — honest by contract
// ---------------------------------------------------------------------------

export interface InstagramApiErrorInit {
  operationId: string;
  message: string;
  status?: number | null;
  /** The Graph envelope's `type` field (e.g. "OAuthException"). */
  errorType?: string | null;
  /** The Graph envelope's numeric `code` (e.g. 190, 2500). */
  code?: number | null;
  /** The Graph envelope's numeric `error_subcode` (e.g. 2207045). */
  errorSubcode?: number | null;
  /** The Graph envelope's `message` field (the provider's own words). */
  providerMessage?: string | null;
}

export class InstagramApiError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly errorType: string | null;
  readonly code: number | null;
  readonly errorSubcode: number | null;
  readonly providerMessage: string | null;

  constructor(init: InstagramApiErrorInit) {
    super(init.message);
    this.name = "InstagramApiError";
    this.operationId = init.operationId;
    this.status = init.status ?? null;
    this.errorType = init.errorType ?? null;
    this.code = init.code ?? null;
    this.errorSubcode = init.errorSubcode ?? null;
    this.providerMessage = init.providerMessage ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The provider rejected the token: code 190 ("Invalid OAuth 2.0 Access
 * Token" — the live-captured graph.instagram.com shape) or the unauthenticated
 * /me shape (code 2500) — an honest requires-auth signal.
 */
export class InstagramRequiresAuthError extends InstagramApiError {
  constructor(init: InstagramApiErrorInit) {
    super(init);
    this.name = "InstagramRequiresAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The provider throttled the call — HTTP 429 or the Graph request-limit
 * error codes (code 4: application request limit; 17: user request limit;
 * 32: the platform-limit class). UNVERIFIED-BASIS note: the rate-limiting
 * doc confirms throttle errors exist and that BUC/Platform limits apply, but
 * its error-code table is client-rendered and did not extract from this
 * sandbox — the code list is the documented Graph vocabulary, conservatively
 * matched; an unmatched throttle shape still surfaces honestly as a plain
 * InstagramApiError carrying the provider's own message.
 */
export class InstagramRateLimitedError extends InstagramApiError {
  constructor(init: InstagramApiErrorInit) {
    super(init);
    this.name = "InstagramRateLimitedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No usable token in this process — the login flow has not completed. */
export class InstagramMissingCredentialError extends InstagramApiError {
  constructor(init: InstagramApiErrorInit) {
    super(init);
    this.name = "InstagramMissingCredentialError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The target (page, account, media) does not exist for this caller. */
export class InstagramNotFoundError extends InstagramApiError {
  constructor(init: InstagramApiErrorInit) {
    super(init);
    this.name = "InstagramNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function liveNetworkDeniedFetch(): Promise<InstagramFetchResponseLike> {
  throw new LiveNetworkDisabledError(
    "connectors/instagram graph: live network calls are disabled (fixture-only build; live smoke is pending the operator's Meta app review chain — operator item)",
  );
}

// ---------------------------------------------------------------------------
// Response shapes (structural subsets of the official payloads)
// ---------------------------------------------------------------------------

/** The Graph API uniform error envelope (live-captured shape, verbatim). */
export interface InstagramGraphErrorEnvelope {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: unknown;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
    [extra: string]: unknown;
  };
}

/** GET /me/accounts row — the documented Page fields the chain consumes. */
export interface InstagramPageRow {
  id?: string;
  name?: string;
  category?: string;
  tasks?: string[];
  [extra: string]: unknown;
}

/** GET /{page-id}?fields=instagram_business_account response. */
export interface InstagramPageInstagramAccountResponse {
  instagram_business_account?: { id?: string; [extra: string]: unknown };
  id?: string;
  [extra: string]: unknown;
}

/** One discovered professional account (a Page → IG User candidate). */
export interface InstagramDiscoveredAccount {
  /** The Facebook Page id (the discovery chain's first hop). */
  pageId: string;
  /** The Page's display name (the caller picks between candidates with it). */
  pageName: string | null;
  /** The linked IG User id — the read target for profile/media/insights. */
  igUserId: string;
}

/** IG User own-profile fields (all documented IG User reference fields). */
export interface InstagramUserProfile {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  website?: string;
  [extra: string]: unknown;
}

/** GET /{ig-user-id}/media row — the documented IG Media fields consumed. */
export interface InstagramMediaItem {
  id?: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  permalink?: string;
  shortcode?: string;
  thumbnail_url?: string;
  timestamp?: string;
  username?: string;
  [extra: string]: unknown;
}

/** Graph cursor-paged list response ({data, paging}). */
export interface InstagramGraphList<TItem> {
  data?: TItem[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

/** One insights metric row (the documented shape, from the guide's samples). */
export interface InstagramInsightMetric {
  name?: string;
  period?: string;
  title?: string;
  description?: string;
  id?: string;
  values?: { value?: number; end_time?: string }[];
  [extra: string]: unknown;
}

/** Insights responses are {data: metric[]} lists. */
export type InstagramInsightsResponse = InstagramGraphList<InstagramInsightMetric>;

// ---------------------------------------------------------------------------
// Usage-header ledger — the provider's own percentage-used signals, recorded
// VERBATIM (BUC/Platform limits have no numeric remaining-count header; see
// the module header + manifest basis string)
// ---------------------------------------------------------------------------

export type InstagramUsageLedgerOutcome =
  | "success"
  | "provider-error"
  | "rate-limited"
  | "network-error";

/** One call: what the provider's own usage headers reported, verbatim. */
export interface InstagramUsageLedgerEntry {
  at: number;
  operationId: string;
  ok: boolean;
  outcome: InstagramUsageLedgerOutcome;
  httpStatus: number | null;
  /** The raw X-App-Usage header value (a JSON string), when served. */
  appUsageHeader: string | null;
  /** The raw X-Business-Use-Case-Usage header value (a JSON string), when served. */
  businessUseCaseUsageHeader: string | null;
  url: string;
}

export type InstagramUsageBudgetState = "ok" | "provider-rate-limited";

/** The honest budget view: the last observed authoritative header values. */
export interface InstagramUsageBudgetSnapshot {
  state: InstagramUsageBudgetState;
  /** Raw X-App-Usage from the most recent response; null before any. */
  appUsageHeader: string | null;
  /** Raw X-Business-Use-Case-Usage from the most recent response; null before any. */
  businessUseCaseUsageHeader: string | null;
  /** How many calls the ledger has recorded (observability only). */
  callsRecorded: number;
  /** Where the numbers come from — the usage-header + BUC basis, labeled honestly. */
  basis: string;
  /** True once the PROVIDER itself enforced a limit (429 / request-limit code). */
  providerReportedRateLimit: boolean;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface InstagramGraphClientOptions {
  /**
   * REQUIRED for any network I/O. Omit it to get a guaranteed fixture-only
   * client whose every call fails with LiveNetworkDisabledError.
   */
  fetchImpl?: InstagramFetchLike;
  /** Per-user Facebook Login token source (the OAuth session in ./oauth). */
  userAccessTokenProvider?: InstagramUserAccessTokenProvider;
  /** Graph API version override; defaults to the pinned manifest constant. */
  apiVersion?: string;
  clock?: () => number;
}

/** The request-limit error codes the throttle classifier matches (see the class doc). */
const REQUEST_LIMIT_ERROR_CODES: readonly number[] = [4, 17, 32];

export class InstagramGraphClient {
  private readonly fetchImpl: InstagramFetchLike;
  private readonly tokenProvider?: InstagramUserAccessTokenProvider;
  private readonly apiVersion: string;
  private readonly nowFn: () => number;
  private ledger: InstagramUsageLedgerEntry[] = [];
  private lastAppUsageHeader: string | null = null;
  private lastBusinessUseCaseHeader: string | null = null;
  private providerReportedRateLimit = false;

  constructor(options: InstagramGraphClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.tokenProvider = options.userAccessTokenProvider;
    this.apiVersion = options.apiVersion ?? INSTAGRAM_API_VERSION;
    this.nowFn = options.clock ?? Date.now;
  }

  // ---- discovery chain (Getting Started guide, verbatim) -------------------

  /**
   * The documented two-step discovery chain: GET /me/accounts (the Facebook
   * User's Pages), then GET /{page-id}?fields=instagram_business_account for
   * each. Returns EVERY Page with a linked IG professional account — the
   * guide's own note: users may hold tasks on several Pages, so the caller
   * (or its UI) identifies the correct one. Pages without an Instagram
   * business account are skipped honestly.
   */
  async discoverInstagramAccounts(): Promise<InstagramDiscoveredAccount[]> {
    const pages = await this.callJson<InstagramGraphList<InstagramPageRow>>(
      "profile.read",
      "/me/accounts",
    );
    const accounts: InstagramDiscoveredAccount[] = [];
    for (const page of pages.data ?? []) {
      if (typeof page?.id !== "string" || page.id === "") continue;
      const linked = await this.callJson<InstagramPageInstagramAccountResponse>(
        "profile.read",
        `/${page.id}`,
        { fields: "instagram_business_account" },
      );
      const igId = linked?.instagram_business_account?.id;
      if (typeof igId === "string" && igId !== "") {
        accounts.push({
          pageId: page.id,
          pageName: typeof page.name === "string" ? page.name : null,
          igUserId: igId,
        });
      }
    }
    return accounts;
  }

  // ---- own-profile read ------------------------------------------------------

  /** The authorized professional account's own profile (documented fields). */
  async getInstagramUserProfile(
    igUserId: string,
    fields?: readonly string[],
  ): Promise<InstagramUserProfile> {
    if (typeof igUserId !== "string" || igUserId === "") {
      throw new InstagramApiError({
        operationId: "profile.read",
        message: "getInstagramUserProfile requires the discovered ig-user-id",
      });
    }
    const requested = fields ?? [
      "id",
      "username",
      "name",
      "biography",
      "followers_count",
      "follows_count",
      "media_count",
      "profile_picture_url",
      "website",
    ];
    return this.callJson<InstagramUserProfile>("profile.read", `/${igUserId}`, {
      fields: requested.join(","),
    });
  }

  // ---- own-media read ---------------------------------------------------------

  /**
   * The authorized professional account's own media (cursor-paged; the
   * endpoint caps at the 10K most recent and excludes stories by itself).
   */
  async getInstagramMedia(
    igUserId: string,
    params: {
      fields?: readonly string[];
      limit?: number;
      after?: string;
      /** Time-based paging (Unix seconds), documented for this edge. */
      since?: number;
      until?: number;
    } = {},
  ): Promise<InstagramGraphList<InstagramMediaItem>> {
    if (typeof igUserId !== "string" || igUserId === "") {
      throw new InstagramApiError({
        operationId: "media.list",
        message: "getInstagramMedia requires the discovered ig-user-id",
      });
    }
    const fields = params.fields ?? [
      "id",
      "caption",
      "media_type",
      "media_product_type",
      "permalink",
      "shortcode",
      "thumbnail_url",
      "timestamp",
      "username",
      "media_url",
    ];
    return this.callJson<InstagramGraphList<InstagramMediaItem>>(
      "media.list",
      `/${igUserId}/media`,
      {
        fields: fields.join(","),
        limit: params.limit,
        after: params.after,
        since: params.since,
        until: params.until,
      },
    );
  }

  // ---- insights reads -----------------------------------------------------------

  /** Account-level insights (e.g. impressions, reach, profile_views; period=day). */
  async getAccountInsights(
    igUserId: string,
    params: { metric: readonly string[]; period?: string },
  ): Promise<InstagramInsightsResponse> {
    if (typeof igUserId !== "string" || igUserId === "") {
      throw new InstagramApiError({
        operationId: "insights.account",
        message: "getAccountInsights requires the discovered ig-user-id",
      });
    }
    if (!Array.isArray(params?.metric) || params.metric.length === 0) {
      throw new InstagramApiError({
        operationId: "insights.account",
        message: "getAccountInsights requires a non-empty metric list",
      });
    }
    return this.callJson<InstagramInsightsResponse>("insights.account", `/${igUserId}/insights`, {
      metric: params.metric.join(","),
      period: params.period,
    });
  }

  /** Per-media insights (e.g. engagement, impressions, reach). */
  async getMediaInsights(
    mediaId: string,
    params: { metric: readonly string[] },
  ): Promise<InstagramInsightsResponse> {
    if (typeof mediaId !== "string" || mediaId === "") {
      throw new InstagramApiError({
        operationId: "insights.media",
        message: "getMediaInsights requires the media id",
      });
    }
    if (!Array.isArray(params?.metric) || params.metric.length === 0) {
      throw new InstagramApiError({
        operationId: "insights.media",
        message: "getMediaInsights requires a non-empty metric list",
      });
    }
    return this.callJson<InstagramInsightsResponse>("insights.media", `/${mediaId}/insights`, {
      metric: params.metric.join(","),
    });
  }

  // ---- usage introspection -------------------------------------------------------

  getLedger(): readonly InstagramUsageLedgerEntry[] {
    return [...this.ledger];
  }

  getUsageBudget(): InstagramUsageBudgetSnapshot {
    return {
      state: this.providerReportedRateLimit ? "provider-rate-limited" : "ok",
      appUsageHeader: this.lastAppUsageHeader,
      businessUseCaseUsageHeader: this.lastBusinessUseCaseHeader,
      callsRecorded: this.ledger.length,
      basis: INSTAGRAM_RATE_LIMIT_BASIS,
      providerReportedRateLimit: this.providerReportedRateLimit,
    };
  }

  // ---- internals -------------------------------------------------------------------

  private async callJson<TPayload>(
    operationId: string,
    path: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<TPayload> {
    const token = (await this.tokenProvider?.getUserAccessToken()) ?? null;
    if (!token) {
      throw new InstagramMissingCredentialError({
        operationId,
        message:
          "Instagram Graph reads need a per-user Facebook Login token, but none is available (account not connected, or the operator's Meta app review chain is not complete — operator item)",
      });
    }

    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
    qs.set("access_token", token);
    const url = `${INSTAGRAM_GRAPH_BASE}/${this.apiVersion}${path}?${qs.toString()}`;

    let response: InstagramFetchResponseLike;
    try {
      response = await this.fetchImpl(url, { method: "GET", headers: {} });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: false,
        outcome: "network-error",
        httpStatus: null,
        appUsageHeader: null,
        businessUseCaseUsageHeader: null,
        url,
      });
      throw new InstagramApiError({
        operationId,
        status: null,
        message: `network failure while calling ${operationId}: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    // The provider's own usage signals — recorded verbatim whenever served
    // (these headers appear once the endpoint has seen enough traffic).
    const appUsage = response.headers.get("x-app-usage");
    const bucUsage = response.headers.get("x-business-use-case-usage");
    if (appUsage !== null) this.lastAppUsageHeader = appUsage;
    if (bucUsage !== null) this.lastBusinessUseCaseHeader = bucUsage;

    const body = (await response.json().catch(() => null)) as
      | (TPayload & InstagramGraphErrorEnvelope)
      | null;
    const envelopeError =
      body && typeof body === "object" && body.error !== null && typeof body.error === "object"
        ? body.error
        : null;

    const recordOutcome = (outcome: InstagramUsageLedgerOutcome) => {
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: outcome === "success",
        outcome,
        httpStatus: response.status,
        appUsageHeader: appUsage,
        businessUseCaseUsageHeader: bucUsage,
        url,
      });
    };

    if (!response.ok) {
      const httpStatus = response.status;
      const isThrottle =
        httpStatus === 429 ||
        (envelopeError?.code !== undefined &&
          REQUEST_LIMIT_ERROR_CODES.includes(envelopeError.code));

      if (isThrottle) {
        this.providerReportedRateLimit = true;
        recordOutcome("rate-limited");
        throw new InstagramRateLimitedError({
          operationId,
          status: httpStatus,
          errorType: envelopeError?.type ?? null,
          code: envelopeError?.code ?? null,
          errorSubcode: envelopeError?.error_subcode ?? null,
          providerMessage: envelopeError?.message ?? null,
          message: `Instagram throttled ${operationId} (HTTP ${httpStatus}${envelopeError?.code !== undefined ? `, code ${envelopeError.code}` : ""}). The provider's own enforcement is authoritative (BUC impressions formula — see the manifest basis); no automatic retry is performed.`,
        });
      }

      recordOutcome("provider-error");

      // Auth honesty: only the true auth signals map to requires-auth —
      // HTTP 401, the live-captured token codes (190 invalid token, 2500
      // token required). The envelope TYPE alone is NOT an auth signal: the
      // Graph error vocabulary types many non-auth errors (e.g. code 100
      // invalid parameter) as OAuthException too.
      if (httpStatus === 401 || envelopeError?.code === 190 || envelopeError?.code === 2500) {
        throw new InstagramRequiresAuthError({
          operationId,
          status: httpStatus,
          errorType: envelopeError?.type ?? null,
          code: envelopeError?.code ?? null,
          errorSubcode: envelopeError?.error_subcode ?? null,
          providerMessage: envelopeError?.message ?? null,
          message:
            envelopeError?.message ??
            `Instagram ${operationId} requires valid credentials (HTTP ${httpStatus})`,
        });
      }

      if (httpStatus === 404) {
        throw new InstagramNotFoundError({
          operationId,
          status: httpStatus,
          errorType: envelopeError?.type ?? null,
          code: envelopeError?.code ?? null,
          errorSubcode: envelopeError?.error_subcode ?? null,
          providerMessage: envelopeError?.message ?? null,
          message: envelopeError?.message ?? `Instagram ${operationId} returned 404`,
        });
      }

      throw new InstagramApiError({
        operationId,
        status: httpStatus,
        errorType: envelopeError?.type ?? null,
        code: envelopeError?.code ?? null,
        errorSubcode: envelopeError?.error_subcode ?? null,
        providerMessage: envelopeError?.message ?? null,
        message:
          envelopeError?.message ??
          `Instagram ${operationId} error (HTTP ${httpStatus}${envelopeError?.type ? `, type=${envelopeError.type}` : ""})`,
      });
    }

    if (body === null || typeof body !== "object") {
      throw new InstagramApiError({
        operationId,
        status: response.status,
        message: `${operationId} returned an unparseable payload; refusing to fabricate data (the Graph envelope is a JSON object)`,
      });
    }

    recordOutcome("success");
    return body;
  }
}
