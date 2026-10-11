/* eslint-disable max-lines -- displayApi.ts: the Display API client (user.info + video.list),
 its typed error taxonomy and the observability ledger form one cohesive official-surface unit
 (repo precedent: youtube/dataApi.ts carries the same disable for the same reason; the module
 split stays a Phase-2 backlog item, TL2 arbitration). */
/**
 * TikTok Display API v2 client — official surface only (ADR-0003).
 *
 * Two operations, exactly as the official docs define them:
 *   - user.info  GET  {base}/user/info/?fields=…            (Bearer)
 *   - video.list POST {base}/video/list/?fields=…           (Bearer, JSON
 *                body {cursor?, max_count?}; max_count ≤ 20 per the docs)
 *
 * ERROR HONESTY: the provider's envelope is
 *   {"data":{}, "error":{"code":"…","message":"…","log_id":"…"}}
 * (live-captured verbatim for the unauthenticated case: HTTP 401,
 * error.code "access_token_invalid" — "The access token is invalid or not
 * found in the request." — 2026-10-11, see the parity matrix). The client
 * parses error.code into typed errors; success is error.code "ok" (the
 * provider's own success marker) with data present.
 *
 * RATE HONESTY (work order): the ~600 req/min figure is an UNVERIFIED
 * third-party report. The ledger records every attempt for observability and
 * the rate snapshot exposes usedInWindow against the PROVISIONAL figure with
 * an explicit basis label — but NO call is ever blocked pre-flight on the
 * unverified number. The provider's own signals (HTTP 429, Retry-After,
 * error.code "rate_limit_exceeded") are the only authoritative limits; after
 * one, the client reports an honest rate-limited state with the provider's
 * message and never silently retries.
 *
 * FIXTURE-TESTED ONLY: no live calls and no credentials live in this package.
 * The client requires an injected fetchImpl; without one every call fails
 * fast with LiveNetworkDisabledError (live smoke pending-operator-credential
 * — TikTok app client_key/secret not provisioned; operator item).
 */
import {
  TIKTOK_API_BASE,
  TIKTOK_RATE_LIMIT_BASIS,
  TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE,
} from "./manifest";
import { LiveNetworkDisabledError } from "../youtube/dataApi";

// The provider-neutral fixture-only refusal class is shared with the YouTube
// lane (identical semantics: injected-fetch builds refuse live I/O). It is
// imported, not re-declared — and deliberately NOT re-exported from this
// module: the package index already exports it once via ./youtube/dataApi.

// ---------------------------------------------------------------------------
// Fetch seam (injected; TikTok-suffixed because the shapes are NOT identical
// to YouTube's — POST bodies are first-class for video.list)
// ---------------------------------------------------------------------------

export interface TikTokFetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TikTokFetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type TikTokFetchLike = (
  url: string,
  init?: TikTokFetchRequestInit,
) => Promise<TikTokFetchResponseLike>;

/** Source of short-lived access tokens (the Login Kit session in ./oauth). */
export interface TikTokAccessTokenProvider {
  getAccessToken(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Errors — honest by contract
// ---------------------------------------------------------------------------

export interface TikTokApiErrorInit {
  operationId: string;
  message: string;
  status?: number | null;
  /** The provider envelope's error.code (authoritative provider reason). */
  code?: string | null;
  /** The provider envelope's log_id (support-traceable). */
  logId?: string | null;
}

export class TikTokApiError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly code: string | null;
  readonly logId: string | null;

  constructor(init: TikTokApiErrorInit) {
    super(init.message);
    this.name = "TikTokApiError";
    this.operationId = init.operationId;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.logId = init.logId ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The provider answered 401 / access_token_invalid: an honest requires-auth signal. */
export class TikTokRequiresAuthError extends TikTokApiError {
  constructor(init: TikTokApiErrorInit) {
    super(init);
    this.name = "TikTokRequiresAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The provider answered a rate signal (429 / rate_limit_exceeded). */
export class TikTokRateLimitedError extends TikTokApiError {
  readonly retryAfterSeconds: number | null;

  constructor(init: TikTokApiErrorInit & { retryAfterSeconds?: number | null }) {
    super(init);
    this.name = "TikTokRateLimitedError";
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No usable access token in this process — the flow has not been completed. */
export class TikTokMissingCredentialError extends TikTokApiError {
  constructor(init: TikTokApiErrorInit) {
    super(init);
    this.name = "TikTokMissingCredentialError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TikTokNotFoundError extends TikTokApiError {
  constructor(init: TikTokApiErrorInit) {
    super(init);
    this.name = "TikTokNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TikTokRegionUnavailableError extends TikTokApiError {
  constructor(init: TikTokApiErrorInit) {
    super(init);
    this.name = "TikTokRegionUnavailableError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function liveNetworkDeniedFetch(): Promise<TikTokFetchResponseLike> {
  throw new LiveNetworkDisabledError(
    "connectors/tiktok: live network calls are disabled (fixture-only build; live smoke is pending-operator-credential)",
  );
}

// ---------------------------------------------------------------------------
// Response shapes (structural subset of the official payloads)
// ---------------------------------------------------------------------------

/** The provider envelope's error object. */
export interface TikTokErrorEnvelope {
  code?: string;
  message?: string;
  log_id?: string;
}

export interface TikTokEnvelope<TData> {
  data?: TData;
  error?: TikTokErrorEnvelope;
}

/** user.info data.user — the structural fields WebFlix consumes. */
export interface TikTokUserInfo {
  open_id?: string;
  union_id?: string;
  avatar_url?: string;
  avatar_url_large?: string;
  display_name?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  bio_description?: string;
}

export interface TikTokUserInfoData {
  user?: TikTokUserInfo;
}

/** video.list data.videos[] — the structural fields WebFlix consumes. */
export interface TikTokVideoItem {
  id?: string;
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  embed_link?: string;
  create_time?: number;
  /** Statistics and other official fields ride along untouched. */
  [extra: string]: unknown;
}

export interface TikTokVideoListData {
  videos?: TikTokVideoItem[];
  cursor?: number;
  has_more?: boolean;
}

// ---------------------------------------------------------------------------
// Ledger (observability; NO pre-flight blocking — the rate figure is
// unverified, see the manifest header)
// ---------------------------------------------------------------------------

export type RateLedgerOutcome = "success" | "provider-error" | "rate-limited" | "network-error";

export interface RateLedgerEntry {
  at: number;
  operationId: string;
  ok: boolean;
  outcome: RateLedgerOutcome;
  httpStatus: number | null;
  code: string | null;
  url: string;
}

export type RateBudgetState = "ok" | "provider-rate-limited";

export interface RateBudgetSnapshot {
  state: RateBudgetState;
  /** Requests recorded in the current rolling window (observability only). */
  usedInWindow: number;
  /**
   * The PROVISIONAL third-party figure — reference only, never a block
   * reason. Null when the caller configures no reference figure.
   */
  provisionalLimitPerMinute: number | null;
  /** Honest label of where the figure comes from. */
  basis: string;
  /** True once the PROVIDER itself reported a rate limit (authoritative). */
  providerReportedRateLimit: boolean;
  /** Provider-served Retry-After seconds, when one was served. */
  retryAfterSeconds: number | null;
}

const WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface TikTokDisplayApiClientOptions {
  /**
   * REQUIRED for any network I/O. Omit it to get a guaranteed fixture-only
   * client whose every call fails with LiveNetworkDisabledError.
   */
  fetchImpl?: TikTokFetchLike;
  accessTokenProvider?: TikTokAccessTokenProvider;
  /**
   * Observability reference for the rolling-window snapshot. Defaults to the
   * UNVERIFIED third-party figure; pass null to track usage with no
   * reference number at all. Either way it NEVER blocks a call.
   */
  provisionalLimitPerMinute?: number | null;
  clock?: () => number;
}

export class TikTokDisplayApiClient {
  private readonly fetchImpl: TikTokFetchLike;
  private readonly accessTokenProvider?: TikTokAccessTokenProvider;
  private readonly provisionalLimit: number | null;
  private readonly nowFn: () => number;
  private ledger: RateLedgerEntry[] = [];
  private providerReportedRateLimit = false;
  private lastRetryAfterSeconds: number | null = null;

  constructor(options: TikTokDisplayApiClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.accessTokenProvider = options.accessTokenProvider;
    this.provisionalLimit =
      options.provisionalLimitPerMinute === undefined
        ? TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE
        : options.provisionalLimitPerMinute;
    this.nowFn = options.clock ?? Date.now;
  }

  // ---- public query API -----------------------------------------------------

  /**
   * The authorized account's own profile (user.info).
   * Fields default to the user.info.basic + user.info.profile set this
   * connector's scopes cover.
   */
  async getUserInfo(
    fields: readonly string[] = [
      "open_id",
      "union_id",
      "avatar_url",
      "display_name",
      "profile_deep_link",
      "is_verified",
      "bio_description",
    ],
  ): Promise<TikTokUserInfo> {
    if (fields.length === 0) {
      throw new TikTokApiError({
        operationId: "user.info",
        message: "getUserInfo requires at least one field",
      });
    }
    const envelope = await this.call<TikTokUserInfoData>("user.info", {
      method: "GET",
      url: `${TIKTOK_API_BASE}/user/info/?fields=${encodeURIComponent(fields.join(","))}`,
    });
    const user = envelope.data?.user;
    if (!user || typeof user !== "object") {
      throw new TikTokApiError({
        operationId: "user.info",
        message:
          'user.info returned no user object (provider envelope error.code was "ok"); refusing to fabricate a profile',
        code: "ok",
      });
    }
    return user;
  }

  /**
   * The authorized account's own video list (video.list).
   * Official paging: cursor (epoch-ms of the last item) + has_more;
   * max_count defaults to 10 and is capped at 20 by the provider.
   */
  async getVideoList(
    params: {
      fields?: readonly string[];
      cursor?: number;
      maxCount?: number;
    } = {},
  ): Promise<TikTokVideoListData> {
    const fields = params.fields ?? [
      "id",
      "title",
      "video_description",
      "duration",
      "cover_image_url",
      "embed_link",
      "create_time",
    ];
    if (fields.length === 0) {
      throw new TikTokApiError({
        operationId: "video.list",
        message: "getVideoList requires at least one field",
      });
    }
    const maxCount = params.maxCount ?? 10;
    if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 20) {
      throw new TikTokApiError({
        operationId: "video.list",
        message: `maxCount must be an integer in 1..20 (official maximum is 20); got ${String(maxCount)}`,
      });
    }
    const body: Record<string, number> = { max_count: maxCount };
    if (params.cursor !== undefined) {
      if (!Number.isInteger(params.cursor) || params.cursor < 0) {
        throw new TikTokApiError({
          operationId: "video.list",
          message: "cursor must be a non-negative integer (epoch ms of the last returned item)",
        });
      }
      body.cursor = params.cursor;
    }
    const envelope = await this.call<TikTokVideoListData>("video.list", {
      method: "POST",
      url: `${TIKTOK_API_BASE}/video/list/?fields=${encodeURIComponent(fields.join(","))}`,
      body: JSON.stringify(body),
    });
    const data = envelope.data;
    if (!data || typeof data !== "object") {
      throw new TikTokApiError({
        operationId: "video.list",
        message:
          'video.list returned no data object (provider envelope error.code was "ok"); refusing to fabricate a list',
        code: "ok",
      });
    }
    return data;
  }

  // ---- rate introspection -----------------------------------------------------

  getLedger(): readonly RateLedgerEntry[] {
    return [...this.ledger];
  }

  getRateBudget(): RateBudgetSnapshot {
    const windowStart = this.nowFn() - WINDOW_MS;
    const usedInWindow = this.ledger.filter((entry) => entry.at >= windowStart).length;
    return {
      state: this.providerReportedRateLimit ? "provider-rate-limited" : "ok",
      usedInWindow,
      provisionalLimitPerMinute: this.provisionalLimit,
      basis: TIKTOK_RATE_LIMIT_BASIS,
      providerReportedRateLimit: this.providerReportedRateLimit,
      retryAfterSeconds: this.lastRetryAfterSeconds,
    };
  }

  // ---- internals ----------------------------------------------------------------

  private async call<TData>(
    operationId: string,
    request: { method: "GET" | "POST"; url: string; body?: string },
  ): Promise<TikTokEnvelope<TData>> {
    const token = (await this.accessTokenProvider?.getAccessToken()) ?? null;
    if (!token) {
      throw new TikTokMissingCredentialError({
        operationId,
        message: `${operationId} requires a per-user Login Kit token, but no access token is available (per-user OAuth flow not completed; live smoke pending operator TikTok client credentials — operator item)`,
      });
    }

    let response: TikTokFetchResponseLike;
    try {
      response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: request.body,
      });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: false,
        outcome: "network-error",
        httpStatus: null,
        code: null,
        url: request.url,
      });
      throw new TikTokApiError({
        operationId,
        status: null,
        code: "network-error",
        message: `network failure while calling ${operationId}: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    const body = (await response.json().catch(() => null)) as
      | (TikTokEnvelope<TData> & { error?: TikTokErrorEnvelope })
      | null;
    const error = body?.error;
    const code = typeof error?.code === "string" ? error.code : null;
    const logId = typeof error?.log_id === "string" ? error.log_id : null;

    // The provider's own success marker is error.code "ok".
    const providerSaysOk = response.ok && (code === null || code === "ok");

    if (!providerSaysOk) {
      const httpStatus = response.status;
      const outcome: RateLedgerOutcome =
        httpStatus === 429 || code === "rate_limit_exceeded" ? "rate-limited" : "provider-error";
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: false,
        outcome,
        httpStatus,
        code,
        url: request.url,
      });

      if (outcome === "rate-limited") {
        this.providerReportedRateLimit = true;
        const retryAfterSeconds = parseRetryAfter(response.headers);
        this.lastRetryAfterSeconds = retryAfterSeconds;
        const retrySuffix =
          retryAfterSeconds !== null ? `; Retry-After: ${retryAfterSeconds}s` : "";
        throw new TikTokRateLimitedError({
          operationId,
          status: httpStatus,
          code,
          logId,
          retryAfterSeconds,
          message: `TikTok rate-limited ${operationId} (HTTP ${httpStatus}${code ? `, error.code=${code}` : ""})${retrySuffix}. The provider's rate signals are authoritative; no automatic retry is performed.`,
        });
      }

      if (httpStatus === 401 || code === "access_token_invalid") {
        throw new TikTokRequiresAuthError({
          operationId,
          status: httpStatus,
          code,
          logId,
          message:
            error?.message ??
            `TikTok ${operationId} requires a valid access token (HTTP ${httpStatus}${code ? `, error.code=${code}` : ""})`,
        });
      }

      if (httpStatus === 404) {
        throw new TikTokNotFoundError({
          operationId,
          status: httpStatus,
          code,
          logId,
          message: error?.message ?? `TikTok ${operationId} returned 404`,
        });
      }

      if (httpStatus === 451) {
        // Unavailable For Legal Reasons — the provider-side regional signal
        // on open.tiktokapis.com (the www.tiktok.com geo-redirect is the
        // other regional shape; see ./oembed).
        throw new TikTokRegionUnavailableError({
          operationId,
          status: httpStatus,
          code,
          logId,
          message:
            error?.message ??
            `TikTok ${operationId} is unavailable in this region (HTTP 451); the connector reports this honestly instead of guessing`,
        });
      }

      throw new TikTokApiError({
        operationId,
        status: httpStatus,
        code,
        logId,
        message:
          error?.message ??
          `TikTok ${operationId} error (HTTP ${httpStatus}${code ? `, error.code=${code}` : ""})`,
      });
    }

    this.ledger.push({
      at: this.nowFn(),
      operationId,
      ok: true,
      outcome: "success",
      httpStatus: response.status,
      code: null,
      url: request.url,
    });
    return body as TikTokEnvelope<TData>;
  }
}

function parseRetryAfter(headers: TikTokFetchResponseLike["headers"]): number | null {
  const raw = headers.get("retry-after");
  if (raw === null || raw === "") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}
