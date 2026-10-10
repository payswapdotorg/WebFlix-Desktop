/* eslint-disable max-lines -- dataApi.ts: quota-aware YouTube Data API v3 client (D3-YOUTUBE); call wrappers, retry/quota ledger and fixture-tested param builders form one cohesive official-surface unit delivered at freeze 5549208. Split deferred to the Phase-2 module split backlog (TL2 arbitration, repo precedent: autoUpdater.ts). */
/**
 * YouTube Data API v3 client wrapper — official surface only (ADR-0003).
 *
 * Quota-aware by construction:
 *   - every call carries its official unit cost (search.list = 100 units,
 *     typical list reads = 1 unit, typical writes = 50 units);
 *   - every attempt is recorded in a local ledger (getLedger): successes,
 *     provider errors (charged — the provider received the request), pre-flight
 *     budget blocks (charged 0 — nothing reached the network), and network
 *     errors (charged 0);
 *   - the day's budget defaults to the official 10,000 units/day and search
 *     availability is exposed as explicit budget states: 'ok' | 'low' | 'exhausted';
 *   - provider-side quota and rate-limit responses surface as honest typed
 *     errors (QuotaExceededError / RateLimitedError). The client never retries
 *     silently and never presents a degraded result as a success.
 *
 * FIXTURE-TESTED ONLY: no live calls and no credentials live in this package.
 * The client requires an injected fetchImpl; without one, every call fails fast
 * with LiveNetworkDisabledError (live smoke is pending-operator-credential per
 * the connectors work order).
 */
import {
  YOUTUBE_API_BASE,
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
  YOUTUBE_READ_COST,
  YOUTUBE_SEARCH_LIST_COST,
} from "./manifest";

/** Remaining-units level under which the search budget reads 'low' (5 more searches). */
export const YOUTUBE_SEARCH_LOW_WATERMARK_UNITS = 500;

/** Explicit search-budget states surfaced to product code. */
export type SearchBudgetState = "ok" | "low" | "exhausted";

export interface SearchBudgetSnapshot {
  state: SearchBudgetState;
  unitsLimitToday: number;
  unitsUsedToday: number;
  unitsRemainingToday: number;
  searchCallsRemainingToday: number;
  lowWatermarkUnits: number;
  /** True once the PROVIDER itself reported the day's quota exhausted. */
  providerReportedExhaustion: boolean;
}

export type QuotaLedgerOutcome =
  | "success"
  | "provider-error"
  | "blocked-preflight"
  | "network-error";

export interface QuotaLedgerEntry {
  at: number;
  dayKey: string;
  operationId: string;
  /** Official unit cost charged for this attempt (0 when nothing reached the network). */
  cost: number;
  ok: boolean;
  outcome: QuotaLedgerOutcome;
  httpStatus: number | null;
  reason: string | null;
  url: string;
}

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

/** Source of short-lived access tokens (typically the OAuth session in ./oauth). */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Errors — honest by contract
// ---------------------------------------------------------------------------

export interface YouTubeApiErrorInit {
  operationId: string;
  message: string;
  status?: number | null;
  reason?: string | null;
  quotaCost?: number;
}

export class YouTubeApiError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly reason: string | null;
  readonly quotaCost: number;

  constructor(init: YouTubeApiErrorInit) {
    super(init.message);
    this.name = "YouTubeApiError";
    this.operationId = init.operationId;
    this.status = init.status ?? null;
    this.reason = init.reason ?? null;
    this.quotaCost = init.quotaCost ?? 0;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class QuotaExceededError extends YouTubeApiError {
  constructor(init: YouTubeApiErrorInit) {
    super(init);
    this.name = "QuotaExceededError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RateLimitedError extends YouTubeApiError {
  readonly retryAfterSeconds: number | null;

  constructor(init: YouTubeApiErrorInit & { retryAfterSeconds?: number | null }) {
    super(init);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MissingCredentialError extends YouTubeApiError {
  constructor(init: YouTubeApiErrorInit) {
    super(init);
    this.name = "MissingCredentialError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends YouTubeApiError {
  constructor(init: YouTubeApiErrorInit) {
    super(init);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class LiveNetworkDisabledError extends Error {
  constructor(
    message = "connectors/youtube: live network calls are disabled (fixture-only build; live smoke is pending-operator-credential)",
  ) {
    super(message);
    this.name = "LiveNetworkDisabledError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function liveNetworkDeniedFetch(): Promise<FetchResponseLike> {
  throw new LiveNetworkDisabledError();
}

// ---------------------------------------------------------------------------
// Response shapes (structural subset of the official payloads)
// ---------------------------------------------------------------------------

export interface YouTubePageInfo {
  totalResults: number;
  resultsPerPage: number;
}

export interface YouTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YouTubeThumbnails {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeSnippet {
  publishedAt?: string;
  channelId?: string;
  title?: string;
  description?: string;
  channelTitle?: string;
  customUrl?: string;
  thumbnails?: YouTubeThumbnails;
  liveBroadcastContent?: string;
}

export interface YouTubeResourceId {
  kind: string;
  videoId?: string;
  channelId?: string;
  playlistId?: string;
}

export interface YouTubeSearchItem {
  kind?: string;
  etag?: string;
  id: YouTubeResourceId;
  snippet?: YouTubeSnippet;
}

export interface YouTubeVideoItem {
  kind?: string;
  etag?: string;
  id: string;
  snippet?: YouTubeSnippet;
  contentDetails?: Record<string, unknown>;
  statistics?: Record<string, unknown>;
}

export interface YouTubeChannelItem {
  kind?: string;
  etag?: string;
  id: string;
  snippet?: YouTubeSnippet;
  statistics?: Record<string, unknown>;
}

export interface YouTubePlaylistItem {
  kind?: string;
  etag?: string;
  id: string;
  snippet?: YouTubeSnippet;
  contentDetails?: Record<string, unknown>;
}

export interface YouTubePlaylistItemsItem {
  kind?: string;
  etag?: string;
  id: string;
  snippet?: YouTubeSnippet & {
    resourceId?: YouTubeResourceId;
    playlistId?: string;
    position?: number;
  };
  contentDetails?: Record<string, unknown>;
}

export interface YouTubeListResponse<TItem> {
  kind?: string;
  etag?: string;
  nextPageToken?: string;
  prevPageToken?: string;
  regionCode?: string;
  pageInfo?: YouTubePageInfo;
  items: TItem[];
}

export interface SearchListParams {
  q: string;
  type?: "video" | "channel" | "playlist";
  maxResults?: number;
  pageToken?: string;
  order?: "relevance" | "date" | "rating" | "title" | "viewCount" | "videoCount";
  safeSearch?: "moderate" | "none" | "strict";
  regionCode?: string;
  relevanceLanguage?: string;
}

// ---------------------------------------------------------------------------
// Operation table — official endpoint + official quota cost per call
// ---------------------------------------------------------------------------

type OperationId =
  | "search.list"
  | "videos.list"
  | "channels.list"
  | "playlists.list"
  | "playlistItems.list";

interface OperationSpec {
  endpoint: string;
  cost: number;
}

const OPERATION_SPECS: Record<OperationId, OperationSpec> = {
  "search.list": { endpoint: "search", cost: YOUTUBE_SEARCH_LIST_COST },
  "videos.list": { endpoint: "videos", cost: YOUTUBE_READ_COST },
  "channels.list": { endpoint: "channels", cost: YOUTUBE_READ_COST },
  "playlists.list": { endpoint: "playlists", cost: YOUTUBE_READ_COST },
  "playlistItems.list": { endpoint: "playlistItems", cost: YOUTUBE_READ_COST },
};

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);

interface GoogleErrorEnvelope {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ message?: string; domain?: string; reason?: string }>;
  };
}

type QueryParam = string | number | boolean | undefined | null;

function utcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function buildUrl(
  endpoint: string,
  params: Record<string, QueryParam>,
  apiKey: string | null,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  if (apiKey) qs.set("key", apiKey);
  return `${YOUTUBE_API_BASE}/${endpoint}?${qs.toString()}`;
}

function extractReason(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const envelope = body as GoogleErrorEnvelope;
  const first = envelope.error?.errors?.[0];
  return first?.reason ?? null;
}

function parseRetryAfter(headers: FetchResponseLike["headers"]): number | null {
  const raw = headers.get("retry-after");
  if (raw === null || raw === "") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface YouTubeDataApiClientOptions {
  /**
   * REQUIRED for any network I/O. Omit it to get a guaranteed fixture-only
   * client whose every call fails with LiveNetworkDisabledError.
   */
  fetchImpl?: FetchLike;
  accessTokenProvider?: AccessTokenProvider;
  /** Official API key for public read calls. Fixture builds pass a labeled dummy. */
  apiKey?: string | null;
  /** Local daily budget in official units; defaults to the official 10,000/day. */
  quotaLimitToday?: number;
  clock?: () => number;
}

export class YouTubeDataApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly accessTokenProvider?: AccessTokenProvider;
  private readonly apiKey: string | null;
  private readonly limitToday: number;
  private readonly nowFn: () => number;
  private ledger: QuotaLedgerEntry[] = [];
  private dayKey: string;
  private usedToday = 0;
  private providerReportedExhaustion = false;

  constructor(options: YouTubeDataApiClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.accessTokenProvider = options.accessTokenProvider;
    this.apiKey = options.apiKey ?? null;
    this.limitToday = options.quotaLimitToday ?? YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS;
    if (!Number.isInteger(this.limitToday) || this.limitToday <= 0) {
      throw new Error("quotaLimitToday must be a positive integer");
    }
    this.nowFn = options.clock ?? Date.now;
    this.dayKey = utcDateKey(this.nowFn());
  }

  // ---- public query API --------------------------------------------------

  async searchVideos(params: SearchListParams): Promise<YouTubeListResponse<YouTubeSearchItem>> {
    if (typeof params?.q !== "string" || params.q.trim() === "") {
      throw new YouTubeApiError({
        operationId: "search.list",
        message: "searchVideos requires a non-empty q",
      });
    }
    return this.call("search.list", {
      part: "snippet",
      q: params.q,
      type: params.type ?? "video",
      maxResults: clampInt(params.maxResults ?? 25, 1, 50),
      pageToken: params.pageToken,
      order: params.order,
      safeSearch: params.safeSearch,
      regionCode: params.regionCode,
      relevanceLanguage: params.relevanceLanguage,
    });
  }

  async getVideos(params: {
    ids: string[];
    parts?: readonly string[];
  }): Promise<YouTubeListResponse<YouTubeVideoItem>> {
    if (!params?.ids?.length) {
      throw new YouTubeApiError({
        operationId: "videos.list",
        message: "getVideos requires at least one video id",
      });
    }
    return this.call("videos.list", {
      part: (params.parts ?? ["snippet", "contentDetails", "statistics"]).join(","),
      id: params.ids.join(","),
      maxResults: params.ids.length,
    });
  }

  async getVideo(videoId: string): Promise<YouTubeVideoItem> {
    const page = await this.getVideos({ ids: [videoId] });
    const item = page.items[0];
    if (!item) {
      throw new NotFoundError({
        operationId: "videos.list",
        message: `videos.list returned no video for id "${videoId}"`,
      });
    }
    return item;
  }

  async getChannel(params: {
    id?: string;
    mine?: boolean;
    parts?: readonly string[];
  }): Promise<YouTubeChannelItem> {
    if (!params.id && !params.mine) {
      throw new YouTubeApiError({
        operationId: "channels.list",
        message: "getChannel requires id or mine:true",
      });
    }
    const page = await this.call(
      "channels.list",
      {
        part: (params.parts ?? ["snippet", "statistics"]).join(","),
        id: params.id,
        mine: params.mine ? "true" : undefined,
        maxResults: params.id ? 1 : undefined,
      },
      { requiresAuth: Boolean(params.mine) },
    );
    const item = page.items[0];
    if (!item) {
      throw new NotFoundError({
        operationId: "channels.list",
        message: `channels.list returned no channel${params.id ? ` for id "${params.id}"` : " for the authorized account"}`,
      });
    }
    return item;
  }

  async getPlaylists(params: {
    channelId: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<YouTubeListResponse<YouTubePlaylistItem>> {
    if (!params?.channelId) {
      throw new YouTubeApiError({
        operationId: "playlists.list",
        message: "getPlaylists requires channelId",
      });
    }
    return this.call("playlists.list", {
      part: "snippet",
      channelId: params.channelId,
      maxResults: clampInt(params.maxResults ?? 25, 1, 50),
      pageToken: params.pageToken,
    });
  }

  async getPlaylistItems(params: {
    playlistId: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<YouTubeListResponse<YouTubePlaylistItemsItem>> {
    if (!params?.playlistId) {
      throw new YouTubeApiError({
        operationId: "playlistItems.list",
        message: "getPlaylistItems requires playlistId",
      });
    }
    return this.call("playlistItems.list", {
      part: "snippet",
      playlistId: params.playlistId,
      maxResults: clampInt(params.maxResults ?? 25, 1, 50),
      pageToken: params.pageToken,
    });
  }

  // ---- quota introspection -------------------------------------------------

  getLedger(): readonly QuotaLedgerEntry[] {
    return [...this.ledger];
  }

  getUnitsUsedToday(): number {
    return this.usedToday;
  }

  getQuotaLimitToday(): number {
    return this.limitToday;
  }

  getDayKey(): string {
    return this.dayKey;
  }

  getSearchBudget(): SearchBudgetSnapshot {
    const remaining = Math.max(0, this.limitToday - this.usedToday);
    const exhausted = this.providerReportedExhaustion || remaining < YOUTUBE_SEARCH_LIST_COST;
    const state: SearchBudgetState = exhausted
      ? "exhausted"
      : remaining < YOUTUBE_SEARCH_LOW_WATERMARK_UNITS
        ? "low"
        : "ok";
    return {
      state,
      unitsLimitToday: this.limitToday,
      unitsUsedToday: this.usedToday,
      unitsRemainingToday: remaining,
      searchCallsRemainingToday: exhausted ? 0 : Math.floor(remaining / YOUTUBE_SEARCH_LIST_COST),
      lowWatermarkUnits: YOUTUBE_SEARCH_LOW_WATERMARK_UNITS,
      providerReportedExhaustion: this.providerReportedExhaustion,
    };
  }

  /** Rolls the ledger when the UTC day changes; called lazily before every request. */
  rollDayIfNeeded(now: number = this.nowFn()): void {
    const key = utcDateKey(now);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.usedToday = 0;
      this.providerReportedExhaustion = false;
      this.ledger = [];
    }
  }

  // ---- internals -------------------------------------------------------------

  private async call<T>(
    operationId: OperationId,
    params: Record<string, QueryParam>,
    callOptions: { requiresAuth?: boolean } = {},
  ): Promise<T> {
    this.rollDayIfNeeded();
    const spec = OPERATION_SPECS[operationId];
    const requiresAuth = callOptions.requiresAuth ?? false;
    const at = this.nowFn();

    let authorization: string | null = null;
    if (requiresAuth) {
      const token = (await this.accessTokenProvider?.getAccessToken()) ?? null;
      if (!token) {
        throw new MissingCredentialError({
          operationId,
          message: `${operationId} requires an authorized YouTube account, but no access token is available (per-user OAuth loopback flow not completed; live smoke pending-operator-credential)`,
        });
      }
      authorization = `Bearer ${token}`;
    } else if (!this.apiKey) {
      throw new MissingCredentialError({
        operationId,
        message: `${operationId} requires an official API key for public read calls; none was configured (fixture builds pass a labeled dummy key)`,
      });
    }

    const url = buildUrl(spec.endpoint, params, this.apiKey);
    const remaining = this.limitToday - this.usedToday;
    if (this.providerReportedExhaustion || remaining < spec.cost) {
      this.ledger.push({
        at,
        dayKey: this.dayKey,
        operationId,
        cost: 0,
        ok: false,
        outcome: "blocked-preflight",
        httpStatus: null,
        reason: "local-budget-exhausted",
        url,
      });
      throw new QuotaExceededError({
        operationId,
        status: null,
        reason: "local-budget-exhausted",
        quotaCost: spec.cost,
        message: `${operationId} blocked locally: it costs ${spec.cost} units but only ${Math.max(0, remaining)} of ${this.limitToday} remain today; no network call was made and no units were charged`,
      });
    }

    let response: FetchResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: authorization ? { Authorization: authorization } : {},
      });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      this.ledger.push({
        at,
        dayKey: this.dayKey,
        operationId,
        cost: 0,
        ok: false,
        outcome: "network-error",
        httpStatus: null,
        reason: "network-error",
        url,
      });
      throw new YouTubeApiError({
        operationId,
        status: null,
        reason: "network-error",
        message: `network failure while calling ${operationId}: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    const body = (await response.json().catch(() => null)) as unknown;
    const reason = extractReason(body);

    if (!response.ok) {
      // The request reached the provider, so units may be charged — record honestly.
      this.usedToday += spec.cost;
      this.ledger.push({
        at: this.nowFn(),
        dayKey: this.dayKey,
        operationId,
        cost: spec.cost,
        ok: false,
        outcome: "provider-error",
        httpStatus: response.status,
        reason,
        url,
      });
      if (response.status === 429 || (reason !== null && RATE_LIMIT_REASONS.has(reason))) {
        const retryAfterSeconds = parseRetryAfter(response.headers);
        const retrySuffix =
          retryAfterSeconds !== null ? `; Retry-After: ${retryAfterSeconds}s` : "";
        throw new RateLimitedError({
          operationId,
          status: response.status,
          reason,
          quotaCost: spec.cost,
          retryAfterSeconds,
          message: `YouTube rate-limited ${operationId} (HTTP ${response.status}${reason ? `, reason=${reason}` : ""})${retrySuffix}. No automatic retry is performed.`,
        });
      }
      if (reason !== null && QUOTA_REASONS.has(reason)) {
        // The provider says the day's quota is spent — mark the budget honestly exhausted.
        this.providerReportedExhaustion = true;
        throw new QuotaExceededError({
          operationId,
          status: response.status,
          reason,
          quotaCost: spec.cost,
          message: `YouTube reports the daily quota is exhausted (HTTP ${response.status}, reason=${reason}) while calling ${operationId}; ${spec.cost} units were charged to the local ledger and the day is marked exhausted`,
        });
      }
      throw new YouTubeApiError({
        operationId,
        status: response.status,
        reason,
        quotaCost: spec.cost,
        message:
          (body as GoogleErrorEnvelope | null)?.error?.message ??
          `YouTube API error on ${operationId} (HTTP ${response.status})`,
      });
    }

    this.usedToday += spec.cost;
    this.ledger.push({
      at: this.nowFn(),
      dayKey: this.dayKey,
      operationId,
      cost: spec.cost,
      ok: true,
      outcome: "success",
      httpStatus: response.status,
      reason: null,
      url,
    });
    return body as T;
  }
}
