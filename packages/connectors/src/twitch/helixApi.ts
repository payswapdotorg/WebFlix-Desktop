/* eslint-disable max-lines -- helixApi.ts: the Helix client (six read endpoints), its typed
 error taxonomy and the AUTHORITATIVE header-based rate ledger form one cohesive official-surface
 unit (repo precedent: youtube/dataApi.ts + tiktok/displayApi.ts carry the same disable for the
 same reason; the module split stays a backlog item, TL2 arbitration). */
/**
 * Twitch Helix API client — official surface only (ADR-0003).
 *
 * Six read operations, exactly as the official reference defines them
 * (all GET, all requiring Client-Id + Bearer headers):
 *   - streams   GET {base}/streams?game_id|user_id|user_login|language&first&after
 *   - videos    GET {base}/videos?id|user_id|game_id&period|type|sort&first&after
 *   - clips     GET {base}/clips?id|game_id|broadcaster_id&first&after
 *   - users     GET {base}/users?id|login
 *   - games/top GET {base}/games/top?first&after
 *   - channels/followed  GET {base}/channels/followed?user_id&first&after
 *               (per-user token ONLY — the app-access bucket is rejected)
 *
 * ERROR HONESTY: the provider envelope is
 *   {"error":"Unauthorized","status":401,"message":"OAuth token is missing"}
 * (live-captured verbatim 2026-10-11 for the unauthenticated case — see the
 * parity matrix live-smoke; with an invalid token the message reads
 * "Invalid OAuth token"). The client maps HTTP status + envelope onto typed
 * errors; the payload body never overrides the HTTP status.
 *
 * RATE HONESTY (the work order's core): the point-based token bucket is
 * AUTHORITATIVELY reported by the provider on EVERY response via the
 *   Ratelimit-Limit     — the maximum rate of the bucket
 *   Ratelimit-Remaining — the points remaining in the bucket
 *   Ratelimit-Reset     — Unix epoch seconds when the bucket resets to full
 * headers (official API guide). The ledger records this triple verbatim for
 * every call and the budget snapshot exposes the last observed values with
 * an explicit basis label. NO number is invented and NO call is blocked
 * pre-flight: the provider's own HTTP 429 (with its Ratelimit-Reset) is the
 * only authoritative enforcement; after one, the client reports an honest
 * rate-limited state and never silently retries.
 *
 * FIXTURE-TESTED ONLY: no live calls and no credentials live in this package.
 * The client requires an injected fetchImpl; without one every call fails
 * fast with LiveNetworkDisabledError (live smoke pending-operator-credential
 * — Twitch client_id/secret not provisioned; operator item).
 */
import { TWITCH_API_BASE, TWITCH_RATE_LIMIT_BASIS } from "./manifest";
import { LiveNetworkDisabledError } from "../youtube/dataApi";

// The provider-neutral fixture-only refusal class is shared with the YouTube
// lane (identical semantics). Imported, not re-declared — and deliberately
// NOT re-exported from this module: the package index already exports it
// once via ./youtube/dataApi.

// ---------------------------------------------------------------------------
// Fetch seam (injected; Twitch-suffixed per the TikTok precedent so the
// package surface stays unambiguous)
// ---------------------------------------------------------------------------

export interface TwitchFetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface TwitchFetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type TwitchFetchLike = (
  url: string,
  init?: TwitchFetchRequestInit,
) => Promise<TwitchFetchResponseLike>;

/** Source of App Access tokens for public reads (the manager in ./oauth). */
export interface TwitchAppAccessTokenProvider {
  getAppAccessToken(): Promise<string | null>;
}

/** Source of per-user access tokens (the OAuth session in ./oauth). */
export interface TwitchUserAccessTokenProvider {
  getUserAccessToken(): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Errors — honest by contract
// ---------------------------------------------------------------------------

export interface TwitchApiErrorInit {
  operationId: string;
  message: string;
  status?: number | null;
  /** The provider envelope's `error` field (e.g. "Unauthorized"). */
  error?: string | null;
  /** The provider envelope's `message` field (the provider's own words). */
  providerMessage?: string | null;
}

export class TwitchApiError extends Error {
  readonly operationId: string;
  readonly status: number | null;
  readonly error: string | null;
  readonly providerMessage: string | null;

  constructor(init: TwitchApiErrorInit) {
    super(init.message);
    this.name = "TwitchApiError";
    this.operationId = init.operationId;
    this.status = init.status ?? null;
    this.error = init.error ?? null;
    this.providerMessage = init.providerMessage ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The provider answered 401 Unauthorized: an honest requires-auth signal. */
export class TwitchRequiresAuthError extends TwitchApiError {
  constructor(init: TwitchApiErrorInit) {
    super(init);
    this.name = "TwitchRequiresAuthError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The provider answered 429 Too Many Requests — the authoritative point-
 * bucket enforcement. Carries the served Ratelimit-Reset epoch seconds.
 */
export class TwitchRateLimitedError extends TwitchApiError {
  readonly resetAtSeconds: number | null;

  constructor(init: TwitchApiErrorInit & { resetAtSeconds?: number | null }) {
    super(init);
    this.name = "TwitchRateLimitedError";
    this.resetAtSeconds = init.resetAtSeconds ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No usable token/client id in this process — the flow has not completed. */
export class TwitchMissingCredentialError extends TwitchApiError {
  constructor(init: TwitchApiErrorInit) {
    super(init);
    this.name = "TwitchMissingCredentialError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TwitchNotFoundError extends TwitchApiError {
  constructor(init: TwitchApiErrorInit) {
    super(init);
    this.name = "TwitchNotFoundError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

async function liveNetworkDeniedFetch(): Promise<TwitchFetchResponseLike> {
  throw new LiveNetworkDisabledError(
    "connectors/twitch: live network calls are disabled (fixture-only build; live smoke is pending-operator-credential)",
  );
}

// ---------------------------------------------------------------------------
// Response shapes (structural subset of the official payloads)
// ---------------------------------------------------------------------------

/** The provider's uniform error envelope (live-captured shape, verbatim). */
export interface TwitchErrorEnvelope {
  error?: string;
  status?: number;
  message?: string;
}

/** Helix list responses all share {data: T[], pagination: {cursor?}}. */
export interface TwitchHelixList<TItem> {
  data?: TItem[];
  pagination?: { cursor?: string };
}

/** GET /streams row — the structural fields WebFlix consumes. */
export interface TwitchStreamItem {
  id?: string;
  user_id?: string;
  user_login?: string;
  user_name?: string;
  game_id?: string;
  game_name?: string;
  type?: string;
  title?: string;
  viewer_count?: number;
  started_at?: string;
  language?: string;
  thumbnail_url?: string;
  [extra: string]: unknown;
}

/** GET /videos row (VOD: past broadcast, highlight or upload). */
export interface TwitchVideoItem {
  id?: string;
  user_id?: string;
  user_login?: string;
  user_name?: string;
  title?: string;
  description?: string;
  created_at?: string;
  published_at?: string;
  url?: string;
  thumbnail_url?: string;
  viewable?: string;
  view_count?: number;
  language?: string;
  type?: string;
  duration?: string;
  [extra: string]: unknown;
}

/** GET /clips row. */
export interface TwitchClipItem {
  id?: string;
  url?: string;
  embed_url?: string;
  broadcaster_id?: string;
  broadcaster_name?: string;
  broadcaster_login?: string;
  creator_id?: string;
  creator_name?: string;
  creator_login?: string;
  video_id?: string;
  game_id?: string;
  language?: string;
  title?: string;
  view_count?: number;
  created_at?: string;
  thumbnail_url?: string;
  duration?: number;
  [extra: string]: unknown;
}

/** GET /users row. */
export interface TwitchUserItem {
  id?: string;
  login?: string;
  display_name?: string;
  type?: string;
  broadcaster_type?: string;
  description?: string;
  profile_image_url?: string;
  offline_image_url?: string;
  view_count?: number;
  created_at?: string;
  [extra: string]: unknown;
}

/** GET /games/top row (a category — a browse container, never watchable). */
export interface TwitchGameItem {
  id?: string;
  name?: string;
  box_art_url?: string;
  [extra: string]: unknown;
}

/** GET /channels/followed row. */
export interface TwitchFollowedChannelItem {
  broadcaster_id?: string;
  broadcaster_login?: string;
  broadcaster_name?: string;
  followed_at?: string;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Rate ledger — AUTHORITATIVE numbers from the Ratelimit-* response headers
// (point-based token bucket; basis-labeled; NO invented numbers, NO
// pre-flight blocking — see the module header)
// ---------------------------------------------------------------------------

export type TwitchRateLedgerOutcome =
  | "success"
  | "provider-error"
  | "rate-limited"
  | "network-error";

/** One call: what the provider's own headers reported, verbatim. */
export interface TwitchRateLedgerEntry {
  at: number;
  operationId: string;
  ok: boolean;
  outcome: TwitchRateLedgerOutcome;
  httpStatus: number | null;
  /** Ratelimit-Limit header value (points), when served. */
  bucketLimit: number | null;
  /** Ratelimit-Remaining header value (points), when served. */
  bucketRemaining: number | null;
  /** Ratelimit-Reset header value (Unix epoch seconds), when served. */
  bucketResetAtSeconds: number | null;
  url: string;
}

export type TwitchRateBudgetState = "ok" | "provider-rate-limited";

/** The honest budget view: the last observed authoritative header triple. */
export interface TwitchRateBudgetSnapshot {
  state: TwitchRateBudgetState;
  /** Ratelimit-Limit from the most recent response; null before any. */
  bucketLimit: number | null;
  /** Ratelimit-Remaining from the most recent response; null before any. */
  bucketRemaining: number | null;
  /** Ratelimit-Reset (epoch seconds) from the most recent response; null before any. */
  bucketResetAtSeconds: number | null;
  /** How many calls the ledger has recorded (observability only). */
  callsRecorded: number;
  /** Where the numbers come from — the header basis, labeled honestly. */
  basis: string;
  /** True once the PROVIDER itself enforced the limit (HTTP 429). */
  providerReportedRateLimit: boolean;
}

function parseHeaderInt(headers: TwitchFetchResponseLike["headers"], name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface TwitchHelixClientOptions {
  /**
   * REQUIRED for any network I/O. Omit it to get a guaranteed fixture-only
   * client whose every call fails with LiveNetworkDisabledError.
   */
  fetchImpl?: TwitchFetchLike;
  /** The Twitch app's client id (Client-Id header on every call). */
  clientId?: string | null;
  /** App Access token source for public reads (client-credentials manager). */
  appAccessTokenProvider?: TwitchAppAccessTokenProvider;
  /** Per-user token source for user-scoped reads (channels.followed). */
  userAccessTokenProvider?: TwitchUserAccessTokenProvider;
  clock?: () => number;
}

export class TwitchHelixClient {
  private readonly fetchImpl: TwitchFetchLike;
  private readonly clientId: string | null;
  private readonly appTokenProvider?: TwitchAppAccessTokenProvider;
  private readonly userTokenProvider?: TwitchUserAccessTokenProvider;
  private readonly nowFn: () => number;
  private ledger: TwitchRateLedgerEntry[] = [];
  private lastBucketLimit: number | null = null;
  private lastBucketRemaining: number | null = null;
  private lastBucketResetAt: number | null = null;
  private providerReportedRateLimit = false;

  constructor(options: TwitchHelixClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? liveNetworkDeniedFetch;
    this.clientId = options.clientId ?? null;
    this.appTokenProvider = options.appAccessTokenProvider;
    this.userTokenProvider = options.userAccessTokenProvider;
    this.nowFn = options.clock ?? Date.now;
  }

  // ---- public query API ------------------------------------------------------

  /** Browse live streams (by game, channel or language; cursor-paged). */
  async getStreams(
    params: {
      gameId?: string;
      userId?: string;
      userLogin?: string;
      language?: string;
      first?: number;
      after?: string;
    } = {},
  ): Promise<TwitchHelixList<TwitchStreamItem>> {
    return this.callPublic("streams.live", "/streams", {
      game_id: params.gameId,
      user_id: params.userId,
      user_login: params.userLogin,
      language: params.language,
      first: clampFirst(params.first),
      after: params.after,
    });
  }

  /** Browse VODs by video id, channel or game (cursor-paged). */
  async getVideos(
    params: {
      id?: string;
      userId?: string;
      gameId?: string;
      period?: "all" | "day" | "month" | "week";
      sort?: "time" | "trending" | "views";
      type?: "all" | "archive" | "highlight" | "upload";
      first?: number;
      after?: string;
    } = {},
  ): Promise<TwitchHelixList<TwitchVideoItem>> {
    return this.callPublic("videos.list", "/videos", {
      id: params.id,
      user_id: params.userId,
      game_id: params.gameId,
      period: params.period,
      sort: params.sort,
      type: params.type,
      first: clampFirst(params.first),
      after: params.after,
    });
  }

  /** Browse clips by clip id, broadcaster or game (cursor-paged). */
  async getClips(
    params: {
      id?: string;
      gameId?: string;
      broadcasterId?: string;
      first?: number;
      after?: string;
    } = {},
  ): Promise<TwitchHelixList<TwitchClipItem>> {
    return this.callPublic("clips.list", "/clips", {
      id: params.id,
      game_id: params.gameId,
      broadcaster_id: params.broadcasterId,
      first: clampFirst(params.first),
      after: params.after,
    });
  }

  /** Read user/channel records by id or login. */
  async getUsers(
    params: { id?: string; login?: string } = {},
  ): Promise<TwitchHelixList<TwitchUserItem>> {
    return this.callPublic("users.read", "/users", { id: params.id, login: params.login });
  }

  /** Browse the top games/categories (cursor-paged). */
  async getTopGames(
    params: { first?: number; after?: string } = {},
  ): Promise<TwitchHelixList<TwitchGameItem>> {
    return this.callPublic("games.top", "/games/top", {
      first: clampFirst(params.first),
      after: params.after,
    });
  }

  /**
   * The channels the AUTHORIZED account follows — per-user token ONLY (the
   * official endpoint rejects app-access tokens for this read).
   */
  async getFollowedChannels(params: {
    broadcasterUserId: string;
    first?: number;
    after?: string;
  }): Promise<TwitchHelixList<TwitchFollowedChannelItem>> {
    if (typeof params?.broadcasterUserId !== "string" || params.broadcasterUserId === "") {
      throw new TwitchApiError({
        operationId: "channels.followed",
        message:
          "getFollowedChannels requires the authorized account's user id (broadcasterUserId)",
      });
    }
    return this.callWithToken("channels.followed", "user", "/channels/followed", {
      user_id: params.broadcasterUserId,
      first: clampFirst(params.first),
      after: params.after,
    });
  }

  // ---- rate introspection ------------------------------------------------------

  getLedger(): readonly TwitchRateLedgerEntry[] {
    return [...this.ledger];
  }

  getRateBudget(): TwitchRateBudgetSnapshot {
    return {
      state: this.providerReportedRateLimit ? "provider-rate-limited" : "ok",
      bucketLimit: this.lastBucketLimit,
      bucketRemaining: this.lastBucketRemaining,
      bucketResetAtSeconds: this.lastBucketResetAt,
      callsRecorded: this.ledger.length,
      basis: TWITCH_RATE_LIMIT_BASIS,
      providerReportedRateLimit: this.providerReportedRateLimit,
    };
  }

  // ---- internals -----------------------------------------------------------------

  private async callPublic<TItem>(
    operationId: string,
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<TwitchHelixList<TItem>> {
    return this.callWithToken(operationId, "app", path, params);
  }

  private async callWithToken<TItem>(
    operationId: string,
    tokenKind: "app" | "user",
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<TwitchHelixList<TItem>> {
    if (!this.clientId) {
      throw new TwitchMissingCredentialError({
        operationId,
        message:
          "Twitch Helix requires the app's Client-Id, but none is configured (Twitch client_id/secret not provisioned; live smoke is an operator item)",
      });
    }
    const token =
      tokenKind === "app"
        ? ((await this.appTokenProvider?.getAppAccessToken()) ?? null)
        : ((await this.userTokenProvider?.getUserAccessToken()) ?? null);
    if (!token) {
      throw new TwitchMissingCredentialError({
        operationId,
        message:
          tokenKind === "app"
            ? `${operationId} is a public read that needs an App Access token (client-credentials flow), but no token is available (pending operator Twitch credentials — operator item)`
            : `${operationId} needs a per-user token (Authorization Code + PKCE flow), but no token is available (account not connected or flow not completed)`,
      });
    }

    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
    const url = `${TWITCH_API_BASE}${path}?${qs.toString()}`;

    let response: TwitchFetchResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      if (err instanceof LiveNetworkDisabledError) throw err;
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: false,
        outcome: "network-error",
        httpStatus: null,
        bucketLimit: null,
        bucketRemaining: null,
        bucketResetAtSeconds: null,
        url,
      });
      throw new TwitchApiError({
        operationId,
        status: null,
        message: `network failure while calling ${operationId}: ${(err as Error | undefined)?.message ?? String(err)}`,
      });
    }

    // The AUTHORITATIVE point-bucket triple — recorded verbatim from every
    // response, whatever the outcome (the headers ride on errors too).
    const bucketLimit = parseHeaderInt(response.headers, "ratelimit-limit");
    const bucketRemaining = parseHeaderInt(response.headers, "ratelimit-remaining");
    const bucketResetAt = parseHeaderInt(response.headers, "ratelimit-reset");
    if (bucketLimit !== null) this.lastBucketLimit = bucketLimit;
    if (bucketRemaining !== null) this.lastBucketRemaining = bucketRemaining;
    if (bucketResetAt !== null) this.lastBucketResetAt = bucketResetAt;

    const body = (await response.json().catch(() => null)) as
      | (TwitchHelixList<TItem> & TwitchErrorEnvelope)
      | null;
    const envelopeError =
      body && typeof body === "object" && typeof (body as TwitchErrorEnvelope).error === "string"
        ? (body as TwitchErrorEnvelope)
        : null;

    if (!response.ok) {
      const httpStatus = response.status;
      const outcome: TwitchRateLedgerOutcome =
        httpStatus === 429 ? "rate-limited" : "provider-error";
      this.ledger.push({
        at: this.nowFn(),
        operationId,
        ok: false,
        outcome,
        httpStatus,
        bucketLimit,
        bucketRemaining,
        bucketResetAtSeconds: bucketResetAt,
        url,
      });

      if (outcome === "rate-limited") {
        this.providerReportedRateLimit = true;
        throw new TwitchRateLimitedError({
          operationId,
          status: httpStatus,
          error: envelopeError?.error ?? null,
          providerMessage: envelopeError?.message ?? null,
          resetAtSeconds: bucketResetAt,
          message: `Twitch rate-limited ${operationId} (HTTP 429; point bucket exhausted). The provider's Ratelimit-Reset header says the bucket refills at epoch second ${String(bucketResetAt ?? "unknown")}. The provider's enforcement is authoritative; no automatic retry is performed.`,
        });
      }

      if (httpStatus === 401) {
        throw new TwitchRequiresAuthError({
          operationId,
          status: httpStatus,
          error: envelopeError?.error ?? null,
          providerMessage: envelopeError?.message ?? null,
          message:
            envelopeError?.message ??
            `Twitch ${operationId} requires valid credentials (HTTP ${httpStatus})`,
        });
      }

      if (httpStatus === 404) {
        throw new TwitchNotFoundError({
          operationId,
          status: httpStatus,
          error: envelopeError?.error ?? null,
          providerMessage: envelopeError?.message ?? null,
          message: envelopeError?.message ?? `Twitch ${operationId} returned 404`,
        });
      }

      throw new TwitchApiError({
        operationId,
        status: httpStatus,
        error: envelopeError?.error ?? null,
        providerMessage: envelopeError?.message ?? null,
        message:
          envelopeError?.message ??
          `Twitch ${operationId} error (HTTP ${httpStatus}${envelopeError?.error ? `, error=${envelopeError.error}` : ""})`,
      });
    }

    if (
      body === null ||
      typeof body !== "object" ||
      !Array.isArray((body as TwitchHelixList<TItem>).data)
    ) {
      throw new TwitchApiError({
        operationId,
        status: httpStatus(response),
        message: `${operationId} returned a payload without a data array; refusing to fabricate rows (the provider's envelope is {data, pagination})`,
      });
    }

    this.ledger.push({
      at: this.nowFn(),
      operationId,
      ok: true,
      outcome: "success",
      httpStatus: response.status,
      bucketLimit,
      bucketRemaining,
      bucketResetAtSeconds: bucketResetAt,
      url,
    });
    return body;
  }
}

function httpStatus(response: TwitchFetchResponseLike): number {
  return response.status;
}

/** first is clamped to the official 1..100 page-size range. */
function clampFirst(first: number | undefined): number | undefined {
  if (first === undefined) return undefined;
  if (!Number.isFinite(first)) return undefined;
  return Math.min(100, Math.max(1, Math.floor(first)));
}
