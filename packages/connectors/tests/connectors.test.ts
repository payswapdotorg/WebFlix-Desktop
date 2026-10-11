/**
 * Fixture-only test-suite for packages/connectors.
 * No live calls, no real credentials — the network boundary is an injected
 * fetch implementation backed by packages/connectors/fixtures (fixture-only).
 *
 * MIRROR-RECON (2026-10-11): rewritten against the FROZEN §2 shapes —
 * canonical ConnectorManifest (operations Record, quotas envelope, artifact
 * provenance), canonical OperationCapability (status + detail), canonical
 * ProviderAccountRecord (renderer-safe, NO credentials), the canonical
 * CredentialPort seam (getToken → CredentialRef HANDLE, never a token), and
 * the canonical PlaybackPlan (official-embed embedSpec record). Every honesty
 * and lifecycle intent from the mirror suite is preserved.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildAuthorizationRequest,
  buildYouTubePlaybackPlan,
  canTransition,
  ConnectorRegistry,
  createDefaultRegistry,
  createPkcePair,
  deriveAccountStatus,
  InvalidTransitionError,
  InvalidVideoIdError,
  LiveNetworkDisabledError,
  MissingCredentialError,
  NotFoundError,
  OAUTH_TRANSITIONS,
  QuotaExceededError,
  RateLimitedError,
  RegistryError,
  StateMismatchError,
  transitionAccount,
  validateCallbackState,
  validateManifest,
  YOUTUBE_API_BASE,
  YouTubeDataApiClient,
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
  YOUTUBE_DISPLAY_NAME,
  YOUTUBE_OFFICIAL_SURFACES,
  YOUTUBE_OAUTH_LOOPBACK_CONFIG,
  YOUTUBE_OPERATION_COSTS,
  YOUTUBE_OPERATION_PROVENANCE,
  YOUTUBE_PROVIDER_ID,
  YOUTUBE_SEARCH_CALLS_PER_DAY,
  YOUTUBE_SEARCH_LIST_COST,
  youtubeManifest,
  YouTubeOAuthSession,
  RequiresAuthError,
  RefreshFailedError,
  type ConnectorManifest,
  type CredentialRef,
  type FetchLike,
  type FetchResponseLike,
  type OAuthAccountStore,
  type OAuthTokenFetcher,
  type ProviderAccountRecord,
  type StoredOAuthTokens,
} from "../src";

import searchFixture from "../fixtures/youtube/search.list.q-cats.json";
import videosFixture from "../fixtures/youtube/videos.list.json";
import channelsFixture from "../fixtures/youtube/channels.list.json";
import playlistsFixture from "../fixtures/youtube/playlists.list.json";
import playlistItemsFixture from "../fixtures/youtube/playlistItems.list.json";
import quotaExceededFixture from "../fixtures/youtube/error.quotaExceeded.json";
import rateLimitExceededFixture from "../fixtures/youtube/error.rateLimitExceeded.json";
import tooManyRequestsFixture from "../fixtures/youtube/error.tooManyRequests.json";
import tokenSuccessFixture from "../fixtures/youtube/oauth.token.success.json";
import tokenRefreshFixture from "../fixtures/youtube/oauth.token.refresh.json";

const FIXTURE_API_KEY = "FIXTURE-KEY-NOT-A-REAL-CREDENTIAL";
const NOW = Date.parse("2025-03-04T12:00:00.000Z");
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Fixtures helpers (all network is injected; nothing leaves the process)
// ---------------------------------------------------------------------------

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): FetchResponseLike {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

interface FixtureRoute {
  match: (url: string) => boolean;
  respond: (url: string) => FetchResponseLike;
}

function fixtureFetch(routes: FixtureRoute[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    const route = routes.find((r) => r.match(url));
    if (!route) throw new Error(`fixture fetch: no route matched ${url}`);
    return route.respond(url);
  }) as FetchLike & { calls: string[] };
  fetchFn.calls = calls;
  return fetchFn;
}

/**
 * In-memory fake of the connector-local OAuthAccountStore seam: renderer-safe
 * account records on one side, raw vault tokens on the other (MR-FD6). The
 * canonical CredentialPort view is exercised through session.credentialPort().
 */
function memoryOAuthStore(): OAuthAccountStore & {
  accounts: Map<string, ProviderAccountRecord>;
  vault: Map<string, StoredOAuthTokens>;
} {
  const accounts = new Map<string, ProviderAccountRecord>();
  const vault = new Map<string, StoredOAuthTokens>();
  return {
    accounts,
    vault,
    async loadAccount(id) {
      return accounts.get(id) ?? null;
    },
    async saveAccount(record) {
      accounts.set(record.internalAccountId, record);
    },
    async removeAccount(id) {
      accounts.delete(id);
    },
    async loadTokens(id) {
      return vault.get(id) ?? null;
    },
    async saveTokens(id, tokens) {
      vault.set(id, tokens);
    },
    async removeTokens(id) {
      vault.delete(id);
    },
  };
}

function fixtureTokenFetcher(options: { refreshFailsWithInvalidGrant?: boolean } = {}): {
  fetcher: OAuthTokenFetcher;
  counts: { exchange: number; refresh: number; revoke: number };
} {
  const counts = { exchange: 0, refresh: 0, revoke: 0 };
  const fetcher: OAuthTokenFetcher = async (request) => {
    if (request.kind === "token-exchange") {
      counts.exchange += 1;
      return { kind: "token", token: tokenSuccessFixture };
    }
    if (request.kind === "refresh") {
      counts.refresh += 1;
      if (options.refreshFailsWithInvalidGrant) {
        const error = new Error("fixture: refresh rejected") as Error & { reason: string };
        error.reason = "invalid_grant";
        throw error;
      }
      return { kind: "token", token: tokenRefreshFixture };
    }
    counts.revoke += 1;
    return { kind: "revoked" };
  };
  return { fetcher, counts };
}

function connectedRecordFixture(): ProviderAccountRecord {
  return {
    providerId: "youtube",
    internalAccountId: "local-user-1",
    displayName: "Fixture Channel",
    grantedScopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    status: "connected",
    connectedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + HOUR_MS).toISOString(),
  };
}

function minimalManifest(providerId: string): ConnectorManifest {
  return {
    providerId,
    operations: {
      "example.list": { status: "supported", detail: "official example.list" },
    },
    regions: [],
    quotas: { requestsPerWindow: 1000, windowMs: 86_400_000 },
    provenance: {
      connectorId: providerId,
      connectorVersion: "0.0.1",
      generatedAt: "2026-10-09T00:00:00Z",
    },
    failureModes: [],
  };
}

// ---------------------------------------------------------------------------
// Manifest registry
// ---------------------------------------------------------------------------

describe("connector manifest registry", () => {
  it("round-trips a manifest through register/get/list by providerId", () => {
    const registry = new ConnectorRegistry();
    expect(registry.size).toBe(0);

    registry.register(youtubeManifest);
    expect(registry.size).toBe(1);
    expect(registry.has("youtube")).toBe(true);
    expect(registry.get("youtube")).toBe(youtubeManifest);
    expect(Object.keys(registry.require("youtube").operations)).toHaveLength(14);

    expect(registry.list().map((m) => m.providerId)).toEqual(["youtube"]);
    registry.register(minimalManifest("aardvark-official"));
    expect(registry.list().map((m) => m.providerId)).toEqual(["aardvark-official", "youtube"]);

    expect(registry.get("nothing")).toBeUndefined();
    expect(() => registry.require("nothing")).toThrowError(RegistryError);
    expect(() => registry.register(youtubeManifest)).toThrowError(/already registered/);
  });

  it("createDefaultRegistry seeds every shipped manifest (youtube, then tiktok at TIKTOK-CONNECT, then twitch at TWITCH-CONNECT, then instagram at INSTAGRAM-CONNECT)", () => {
    const registry = createDefaultRegistry();
    expect(registry.size).toBe(4);
    expect(registry.require("youtube").providerId).toBe(YOUTUBE_PROVIDER_ID);
    expect(registry.require("tiktok").providerId).toBe("tiktok");
    expect(registry.require("twitch").providerId).toBe("twitch");
    expect(registry.require("instagram").providerId).toBe("instagram");
  });

  it("validateManifest refuses dishonest rows", () => {
    const unsupportedWithoutReason = minimalManifest("dishonest-1");
    unsupportedWithoutReason.operations["home-feed"] = { status: "unsupported" };
    expect(() => validateManifest(unsupportedWithoutReason)).toThrowError(/must explain/);

    const illegalStatus = minimalManifest("dishonest-2");
    illegalStatus.operations["example.list"] = {
      status: "definitely-supported" as never,
      detail: "not a frozen CapabilityStatus",
    };
    expect(() => validateManifest(illegalStatus)).toThrowError(/unknown CapabilityStatus/);

    const noOperations = minimalManifest("dishonest-3");
    noOperations.operations = {};
    expect(() => validateManifest(noOperations)).toThrowError(/non-empty record/);
  });
});

// ---------------------------------------------------------------------------
// YouTube manifest honesty (AUDIT-SOURCES §2/§8)
// ---------------------------------------------------------------------------

describe("youtube manifest honesty (AUDIT-SOURCES §2/§8)", () => {
  const HONEST_UNSUPPORTED_IDS = [
    "history",
    "notifications",
    "related",
    "community",
    "memberships",
    "superchat",
    "premiere",
    "search-suggestions",
    "home-feed",
  ];

  it("declares exactly the honest-unsupported list from the audit", () => {
    const unsupported = Object.entries(youtubeManifest.operations).filter(
      ([, op]) => op.status === "unsupported",
    );
    expect(unsupported.map(([id]) => id).sort()).toEqual([...HONEST_UNSUPPORTED_IDS].sort());
    for (const [, op] of unsupported) {
      expect(op.detail).toBeTruthy();
    }
  });

  it("marks browse/search/metadata as supported with real official mechanisms in detail", () => {
    const supported = Object.entries(youtubeManifest.operations).filter(
      ([, op]) => op.status === "supported",
    );
    expect(supported).toHaveLength(5);
    for (const [id, op] of supported) {
      expect(op.detail).toContain("YouTube Data API v3");
      expect(id).toMatch(/^(search|videos|channels|playlists|playlistItems)\.list$/);
    }
  });

  it("carries the official quota model: 10,000 units/day, search 100, reads 1", () => {
    // Frozen quotas envelope (request-based): 100 search-class calls per day.
    expect(youtubeManifest.quotas.requestsPerWindow).toBe(YOUTUBE_SEARCH_CALLS_PER_DAY);
    expect(youtubeManifest.quotas.requestsPerWindow).toBe(100);
    expect(youtubeManifest.quotas.windowMs).toBe(86_400_000);

    // Connector-local unit-cost table (MR-FD2): the precise official model.
    expect(YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS).toBe(10_000);
    expect(YOUTUBE_OPERATION_COSTS["search.list"]).toBe(YOUTUBE_SEARCH_LIST_COST);
    expect(YOUTUBE_OPERATION_COSTS["search.list"]).toBe(100);
    expect(YOUTUBE_OPERATION_COSTS["videos.list"]).toBe(1);
  });

  it("cites provenance on every row (official docs for supported, audit for unsupported)", () => {
    for (const [id] of Object.entries(youtubeManifest.operations)) {
      const citations = YOUTUBE_OPERATION_PROVENANCE[id];
      expect(citations?.length ?? 0).toBeGreaterThan(0);
      for (const citation of citations ?? []) {
        expect(citation.url.length).toBeGreaterThan(0);
      }
      if (youtubeManifest.operations[id]?.status === "supported") {
        expect(
          (citations ?? []).some((c) => c.url.startsWith("https://developers.google.com/youtube/")),
        ).toBe(true);
      } else {
        expect((citations ?? []).some((c) => c.url.includes("AUDIT-SOURCES.md"))).toBe(true);
      }
    }
  });

  it("pins the ADR-0003 official-surfaces-only policy data and the readonly scope", () => {
    for (const surface of YOUTUBE_OFFICIAL_SURFACES) {
      expect(surface.startsWith("https://")).toBe(true);
    }
    expect(YOUTUBE_OFFICIAL_SURFACES).toContain("https://www.googleapis.com/youtube/v3");
    expect(YOUTUBE_OFFICIAL_SURFACES).toContain("https://www.youtube-nocookie.com/embed/");
    expect(youtubeManifest.provenance.connectorVersion).toBe("1.0.0");
    expect(youtubeManifest.provenance.connectorId).toBe("youtube");
  });
});

// ---------------------------------------------------------------------------
// Data API client — quota ledger & search budget
// ---------------------------------------------------------------------------

describe("data api client: quota ledger & search budget", () => {
  it("charges official unit costs per call and reports the search budget state", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/search?`),
        respond: () => jsonResponse(searchFixture),
      },
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/videos?`),
        respond: () => jsonResponse(videosFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const page = await client.searchVideos({ q: "container gardening" });
    expect(page.items[0]?.id.videoId).toBe("FIXVID00001");
    expect(page.nextPageToken).toBe("FIXTURE-NEXT-PAGE-1");

    let ledger = client.getLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      operationId: "search.list",
      cost: YOUTUBE_SEARCH_LIST_COST,
      ok: true,
      outcome: "success",
      dayKey: "2025-03-04",
    });
    expect(ledger[0]?.url).toContain("q=container+gardening");
    expect(ledger[0]?.url).toContain("key=FIXTURE-KEY");
    expect(client.getUnitsUsedToday()).toBe(100);

    const video = await client.getVideo("FIXVID00001");
    expect(video.id).toBe("FIXVID00001");
    ledger = client.getLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[1]).toMatchObject({
      operationId: "videos.list",
      cost: 1,
      ok: true,
      outcome: "success",
    });
    expect(client.getUnitsUsedToday()).toBe(101);

    const budget = client.getSearchBudget();
    expect(budget.state).toBe("ok");
    expect(budget.unitsUsedToday).toBe(101);
    expect(budget.unitsRemainingToday).toBe(9_899);
    expect(budget.searchCallsRemainingToday).toBe(98);
  });

  it("moves ok → low → exhausted and blocks pre-flight with an honest error", async () => {
    const fetch = fixtureFetch([
      { match: (url) => url.includes("/search?"), respond: () => jsonResponse(searchFixture) },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
      quotaLimitToday: 1000,
    });

    for (let i = 0; i < 5; i += 1) {
      await client.searchVideos({ q: `ok${i}` });
      expect(client.getSearchBudget().state).toBe("ok");
    }
    for (let i = 0; i < 4; i += 1) {
      await client.searchVideos({ q: `low${i}` });
      expect(client.getSearchBudget().state).toBe("low");
    }
    expect(client.getUnitsUsedToday()).toBe(900);

    // The 10th search exactly consumes the day: 900 + 100 = 1000.
    await client.searchVideos({ q: "final" });
    expect(client.getSearchBudget().state).toBe("exhausted");
    expect(client.getSearchBudget().searchCallsRemainingToday).toBe(0);

    // The 11th is blocked locally before any network call and charges nothing.
    const blockedError = await client.searchVideos({ q: "blocked" }).catch((e: unknown) => e);
    expect(blockedError).toBeInstanceOf(QuotaExceededError);
    expect((blockedError as QuotaExceededError).message).toContain("no network call was made");
    expect(fetch.calls).toHaveLength(10);

    const ledger = client.getLedger();
    expect(ledger).toHaveLength(11);
    expect(ledger[10]).toMatchObject({
      operationId: "search.list",
      outcome: "blocked-preflight",
      cost: 0,
      ok: false,
      reason: "local-budget-exhausted",
    });
    expect(client.getUnitsUsedToday()).toBe(1000);
  });

  it("provider quotaExceeded marks the day exhausted and blocks further ops", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/search?"),
        respond: () => jsonResponse(quotaExceededFixture, { status: 403 }),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const err = await client.searchVideos({ q: "anything" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).message).toContain("daily quota is exhausted");

    expect(client.getLedger()[0]).toMatchObject({
      operationId: "search.list",
      outcome: "provider-error",
      cost: 100,
      ok: false,
      httpStatus: 403,
      reason: "quotaExceeded",
    });
    expect(client.getUnitsUsedToday()).toBe(100);
    expect(client.getSearchBudget().state).toBe("exhausted");
    expect(client.getSearchBudget().providerReportedExhaustion).toBe(true);

    // Even a 1-unit read is blocked for the rest of the day — no more network calls.
    await expect(client.getVideo("FIXVID00001")).rejects.toThrowError(QuotaExceededError);
    expect(fetch.calls).toHaveLength(1);
    expect(client.getLedger()[1]).toMatchObject({
      operationId: "videos.list",
      outcome: "blocked-preflight",
      cost: 0,
    });
  });

  it("rate-limited responses surface honest RateLimitedError with Retry-After", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/search?"),
        respond: () =>
          jsonResponse(rateLimitExceededFixture, { status: 403, headers: { "retry-after": "30" } }),
      },
      {
        match: (url) => url.includes("/videos?"),
        respond: () => jsonResponse(tooManyRequestsFixture, { status: 429 }),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const err = await client.searchVideos({ q: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBe(30);
    expect((err as RateLimitedError).message).toContain("rate-limited");
    // A rate limit is NOT a quota exhaustion — the budget stays usable.
    expect(client.getSearchBudget().state).toBe("ok");

    const err429 = await client.getVideo("FIXVID00001").catch((e: unknown) => e);
    expect(err429).toBeInstanceOf(RateLimitedError);
    expect((err429 as RateLimitedError).status).toBe(429);
    expect((err429 as RateLimitedError).retryAfterSeconds).toBeNull();
    expect(client.getLedger()[1]).toMatchObject({ outcome: "provider-error", cost: 1 });
  });

  it("without an injected fetch the client refuses to touch the network", async () => {
    const client = new YouTubeDataApiClient({ apiKey: FIXTURE_API_KEY, clock: () => NOW });
    await expect(client.searchVideos({ q: "x" })).rejects.toThrowError(LiveNetworkDisabledError);
    await expect(client.searchVideos({ q: "x" })).rejects.toThrowError(
      /pending-operator-credential/,
    );
    expect(client.getLedger()).toHaveLength(0);
    expect(client.getUnitsUsedToday()).toBe(0);
  });

  it("authorized calls without a credential fail honestly before any network call", async () => {
    const fetch = fixtureFetch([]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    await expect(client.getChannel({ mine: true })).rejects.toThrowError(MissingCredentialError);
    await expect(client.getChannel({ mine: true })).rejects.toThrowError(/no access token/);
    expect(fetch.calls).toHaveLength(0);
    expect(client.getLedger()).toHaveLength(0);
  });

  it("rolls the ledger at the UTC day boundary", async () => {
    let now = NOW;
    const fetch = fixtureFetch([
      { match: (url) => url.includes("/search?"), respond: () => jsonResponse(searchFixture) },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => now,
    });

    await client.searchVideos({ q: "day1" });
    expect(client.getDayKey()).toBe("2025-03-04");
    expect(client.getUnitsUsedToday()).toBe(100);

    now = NOW + 86_400_000;
    await client.searchVideos({ q: "day2" });
    expect(client.getDayKey()).toBe("2025-03-05");
    expect(client.getUnitsUsedToday()).toBe(100);
    expect(client.getLedger()).toHaveLength(1);
  });

  it("browse reads cost 1 unit each", async () => {
    const fetch = fixtureFetch([
      { match: (url) => url.includes("/channels?"), respond: () => jsonResponse(channelsFixture) },
      {
        match: (url) => url.includes("/playlists?"),
        respond: () => jsonResponse(playlistsFixture),
      },
      {
        match: (url) => url.includes("/playlistItems?"),
        respond: () => jsonResponse(playlistItemsFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const channel = await client.getChannel({ id: "UCFIXCH0000000000000001" });
    expect(channel.id).toBe("UCFIXCH0000000000000001");
    const playlists = await client.getPlaylists({ channelId: "UCFIXCH0000000000000001" });
    expect(playlists.items[0]?.id).toBe("PLFIX0000000000000001");
    const items = await client.getPlaylistItems({ playlistId: "PLFIX0000000000000001" });
    expect(items.items[0]?.snippet?.resourceId?.videoId).toBe("FIXVID00001");

    const ledger = client.getLedger();
    expect(ledger.map((entry) => entry.operationId)).toEqual([
      "channels.list",
      "playlists.list",
      "playlistItems.list",
    ]);
    expect(ledger.every((entry) => entry.cost === 1 && entry.ok)).toBe(true);
    expect(client.getUnitsUsedToday()).toBe(3);
  });

  it("missing resources produce an honest NotFoundError", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/videos?"),
        respond: () => jsonResponse({ ...videosFixture, items: [] }),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    await expect(client.getVideo("FIXVIDzzzz99")).rejects.toThrowError(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// OAuth loopback + PKCE state machine (frozen §2.5 vocabulary)
// ---------------------------------------------------------------------------

describe("oauth loopback + PKCE state machine", () => {
  it("allows exactly the honest transitions and refuses skips", () => {
    expect(OAUTH_TRANSITIONS.connected).toEqual(["expired", "revoked"]);
    expect(canTransition("connected", "expired")).toBe(true);
    expect(canTransition("expired", "revoked")).toBe(true);
    expect(canTransition("revoked", "connected")).toBe(true); // fresh consent after acknowledge
    expect(canTransition("connected", "connected")).toBe(false);
    expect(canTransition("revoked", "expired")).toBe(false);
    expect(() => {
      if (canTransition("connected", "connected")) return;
      throw new InvalidTransitionError("illegal oauth account transition: connected → connected");
    }).toThrowError(InvalidTransitionError);
  });

  it("transitionAccount stamps status changes and enforces the map", () => {
    const record = connectedRecordFixture();
    const expired = transitionAccount(record, "expired");
    expect(expired.status).toBe("expired");
    // Renderer-safe: the canonical record never carries credentials.
    expect(Object.hasOwn(expired, "credentials")).toBe(false);

    const revoked = transitionAccount(expired, "revoked");
    expect(revoked.status).toBe("revoked");

    expect(() => transitionAccount(revoked, "expired")).toThrowError(InvalidTransitionError);
  });

  it("derives status from the stored record and the clock (null = not linked)", () => {
    expect(deriveAccountStatus(null, NOW)).toBeNull();
    const base = connectedRecordFixture();
    expect(deriveAccountStatus(base, NOW)).toBe("connected");
    // Grant expiry (renderer-safe record.expiresAt) honestly derives 'expired'.
    expect(deriveAccountStatus(base, Date.parse(base.expiresAt ?? "") + 1)).toBe("expired");
    expect(deriveAccountStatus({ ...base, status: "revoked" }, NOW)).toBe("revoked");
    expect(deriveAccountStatus({ ...base, status: "expired" }, NOW)).toBe("expired");
  });

  it("builds a loopback+PKCE authorization request with no real client id", () => {
    const pkce = createPkcePair(Buffer.alloc(32, 7));
    const expectedChallenge = createHash("sha256")
      .update(pkce.codeVerifier, "ascii")
      .digest("base64url");
    expect(pkce.codeChallenge).toBe(expectedChallenge);
    expect(pkce.codeChallengeMethod).toBe("S256");

    const request = buildAuthorizationRequest({
      redirectPort: 41073,
      state: "fixture-state",
      pkce,
    });
    expect(request.redirectUri).toBe("http://127.0.0.1:41073/oauth/callback");
    expect(request.url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
    expect(request.url).toContain("response_type=code");
    expect(request.url).toContain("access_type=offline");
    expect(request.url).toContain("code_challenge_method=S256");
    expect(request.url).toContain(`code_challenge=${encodeURIComponent(pkce.codeChallenge)}`);
    expect(request.url).toContain("state=fixture-state");
    expect(request.url).toContain(
      encodeURIComponent("https://www.googleapis.com/auth/youtube.readonly"),
    );

    // No real client id ships in this package.
    expect(YOUTUBE_OAUTH_LOOPBACK_CONFIG.clientId).not.toMatch(/apps\.googleusercontent\.com$/);
    expect(YOUTUBE_OAUTH_LOOPBACK_CONFIG.clientId).toContain("PENDING-OPERATOR-PROVISIONING");

    const randomPair = createPkcePair();
    expect(randomPair.codeVerifier).toHaveLength(43);
    expect(randomPair.codeVerifier).not.toBe(pkce.codeVerifier);
  });

  it("rejects callback state mismatches (CSRF guard)", () => {
    expect(() => validateCallbackState("evil", "expected")).toThrowError(StateMismatchError);
    expect(() => validateCallbackState(null, "expected")).toThrowError(StateMismatchError);
    expect(() => validateCallbackState("expected", "expected")).not.toThrow();
  });

  it("walks not-linked → connected → expired → connected → revoked → (acknowledged: removed) honestly", async () => {
    const store = memoryOAuthStore();
    let now = NOW;
    const behavior = { refreshFailsWithInvalidGrant: false };
    const { fetcher, counts } = fixtureTokenFetcher(behavior);
    const session = new YouTubeOAuthSession({
      store,
      internalAccountId: "local-user-1",
      clock: () => now,
      tokenFetcher: fetcher,
    });

    expect(await session.status()).toBeNull();
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);

    const request = session.startAuthorization({ redirectPort: 41073 });
    await expect(
      session.completeAuthorization({ code: "FIXTURE-CODE", state: "wrong-state" }),
    ).rejects.toThrowError(StateMismatchError);

    const connected = await session.completeAuthorization({
      code: "FIXTURE-CODE",
      state: request.state,
      displayName: "Fixture Channel",
    });
    // Canonical connected record — renderer-safe, NO credentials on it.
    expect(connected.status).toBe("connected");
    expect(connected.providerId).toBe("youtube");
    expect(connected.internalAccountId).toBe("local-user-1");
    expect(connected.grantedScopes).toContain("https://www.googleapis.com/auth/youtube.readonly");
    expect(connected.expiresAt).toBe(new Date(NOW + HOUR_MS).toISOString());
    expect(Object.hasOwn(connected, "credentials")).toBe(false);
    expect(store.vault.get("local-user-1")?.accessToken).toBe("FIXTURE-ACCESS-TOKEN-1");
    expect(await session.status()).toBe("connected");
    await expect(session.getToken()).resolves.toBe("FIXTURE-ACCESS-TOKEN-1");

    // Canonical §2.6 seam: getToken → CredentialRef HANDLE (never a token).
    const port = session.credentialPort();
    const ref: CredentialRef = await port.getToken("youtube", "local-user-1");
    expect(ref.handle).toBe("youtube:local-user-1");
    expect(JSON.stringify(ref)).not.toContain("FIXTURE-ACCESS-TOKEN");

    // connected → expired (clock passes grant expiry)
    now = NOW + 2 * HOUR_MS;
    expect(await session.status()).toBe("expired");

    // expired → connected via refresh
    const refreshed = await session.refresh();
    expect(refreshed.status).toBe("connected");
    expect(store.vault.get("local-user-1")?.accessToken).toBe("FIXTURE-ACCESS-TOKEN-2");
    expect(store.vault.get("local-user-1")?.refreshToken).toBe("FIXTURE-REFRESH-TOKEN-1"); // refresh omitted it; kept
    expect(refreshed.expiresAt).toBe(new Date(now + HOUR_MS).toISOString());
    await expect(session.getToken()).resolves.toBe("FIXTURE-ACCESS-TOKEN-2");

    // connected → expired again; this time the refresh is rejected with invalid_grant → revoked
    now = now + 2 * HOUR_MS;
    behavior.refreshFailsWithInvalidGrant = true;
    await expect(session.getToken()).rejects.toThrowError(RefreshFailedError);
    expect((await session.loadAccount())?.status).toBe("revoked");
    expect(store.vault.get("local-user-1")).toBeUndefined();
    expect(await session.status()).toBe("revoked");
    // The revoked account honestly has no usable credential.
    await expect(session.credentialPort().getToken("youtube", "local-user-1")).rejects.toThrowError(
      RequiresAuthError,
    );

    // revoked → (acknowledged) record removed — the fresh-consent starting state
    await session.acknowledgeRevocation();
    expect(await session.loadAccount()).toBeNull();
    expect(await session.status()).toBeNull();
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);

    expect(counts.exchange).toBe(1);
    expect(counts.refresh).toBe(2);
    expect(store.accounts.size).toBe(0);
  });

  it("revoke() walks connected → revoked and clears the vault", async () => {
    const store = memoryOAuthStore();
    const { fetcher, counts } = fixtureTokenFetcher();
    const session = new YouTubeOAuthSession({
      store,
      internalAccountId: "local-user-1",
      clock: () => NOW,
      tokenFetcher: fetcher,
    });
    const request = session.startAuthorization({ redirectPort: 41073 });
    await session.completeAuthorization({ code: "FIXTURE-CODE", state: request.state });

    const revoked = await session.revoke();
    expect(revoked.status).toBe("revoked");
    expect(Object.hasOwn(revoked, "credentials")).toBe(false);
    expect(store.vault.get("local-user-1")).toBeUndefined();
    expect(counts.revoke).toBe(1);
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);
  });

  it("falls back to a truthful display name when the callback carries none", async () => {
    const store = memoryOAuthStore();
    const { fetcher } = fixtureTokenFetcher();
    const session = new YouTubeOAuthSession({
      store,
      internalAccountId: "local-user-2",
      clock: () => NOW,
      tokenFetcher: fetcher,
    });
    const request = session.startAuthorization({ redirectPort: 41073 });
    const record = await session.completeAuthorization({
      code: "FIXTURE-CODE",
      state: request.state,
    });
    expect(record.displayName).toBe(`${YOUTUBE_DISPLAY_NAME} account`);
  });

  it("the default token fetcher refuses live network honestly", async () => {
    const session = new YouTubeOAuthSession({
      store: memoryOAuthStore(),
      internalAccountId: "local-user-1",
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 41073 });
    await expect(
      session.completeAuthorization({ code: "x", state: request.state }),
    ).rejects.toThrowError(LiveNetworkDisabledError);
  });
});

// ---------------------------------------------------------------------------
// Playback plans (official-embed, frozen §2.2)
// ---------------------------------------------------------------------------

describe("playback plans (official-embed)", () => {
  it("builds an official IFrame embed plan with a pinned origin", () => {
    const plan = buildYouTubePlaybackPlan({
      videoId: "dQw4w9WgXcQ",
      origin: "https://app.webflix.local",
      startSeconds: 90,
      title: "Fixture video",
    });
    if (plan.kind !== "official-embed") throw new Error("expected an official-embed plan");
    expect(plan.kind).toBe("official-embed");
    expect(plan.providerId).toBe("youtube");
    const spec = plan.embedSpec as Record<string, unknown> & {
      embedUrl: string;
      videoId: string;
      playerVars: Record<string, string | number>;
      iframe: { title: string; allow: string; allowFullScreen: boolean };
      provenance: { url: string }[];
    };
    expect(spec.embedUrl.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(
      true,
    );
    expect(spec.embedUrl).toContain("autoplay=0");
    expect(spec.embedUrl).toContain("controls=1");
    expect(spec.embedUrl).toContain("rel=0");
    expect(spec.embedUrl).toContain("playsinline=1");
    expect(spec.embedUrl).toContain("start=90");
    expect(spec.embedUrl).toContain("enablejsapi=1");
    expect(spec.embedUrl).toContain(`origin=${encodeURIComponent("https://app.webflix.local")}`);
    expect(spec.iframe.allowFullScreen).toBe(true);
    expect(spec.iframe.title).toBe("Fixture video");
    expect(spec.iframe.allow).toContain("autoplay");
    expect(spec.videoId).toBe("dQw4w9WgXcQ");
    expect(
      spec.provenance.some(
        (c) => c.url === "https://developers.google.com/youtube/iframe_api_reference",
      ),
    ).toBe(true);

    // Secret-free record: the plan round-trips through JSON unchanged.
    const round = JSON.parse(JSON.stringify(plan)) as typeof plan;
    expect(round).toEqual(plan);
  });

  it("refuses to build plans for malformed ids", () => {
    expect(() => buildYouTubePlaybackPlan({ videoId: "too-short" })).toThrowError(
      InvalidVideoIdError,
    );
    expect(() => buildYouTubePlaybackPlan({ videoId: "has space here" })).toThrowError(
      InvalidVideoIdError,
    );
    expect(() => buildYouTubePlaybackPlan({ videoId: "../../etc" })).toThrowError(
      InvalidVideoIdError,
    );
  });

  it("supports the standard domain and omits the JS API when no origin is pinned", () => {
    const plan = buildYouTubePlaybackPlan({ videoId: "dQw4w9WgXcQ", privacyEnhanced: false });
    if (plan.kind !== "official-embed") throw new Error("expected an official-embed plan");
    const spec = plan.embedSpec as { embedUrl: string; notes: string[] };
    expect(spec.embedUrl.startsWith("https://www.youtube.com/embed/dQw4w9WgXcQ?")).toBe(true);
    expect(spec.embedUrl).not.toContain("enablejsapi");
    expect(spec.embedUrl).not.toContain("origin=");
    expect(spec.notes.join(" ")).toContain("No origin supplied");
  });
});

// ---------------------------------------------------------------------------
// YOUTUBE-EXPAND — trending browse, canonical catalog mapping, service glue,
// honest-state mapping, watch bridge, local substitutes
// ---------------------------------------------------------------------------

import trendingFixture from "../fixtures/youtube/videos.list.chart-mostPopular.json";
import channelsContentDetailsFixture from "../fixtures/youtube/channels.list.contentDetails.json";
import uploadsPlaylistItemsFixture from "../fixtures/youtube/playlistItems.list.uploads.json";
import {
  catalogItemFromPlaylistItem,
  catalogItemFromSearchItem,
  catalogItemFromVideoItem,
  catalogItemsFromSearchResponse,
  uploadsPlaylistIdOf,
  videoIdOf,
} from "../src/youtube/catalogMapping";
import {
  channelUploadsCatalog,
  listChannelPlaylists,
  playbackPlanForCatalogItem,
  playlistVideosCatalog,
  searchCapabilityFromError,
  searchYouTubeCatalog,
  trendingYouTubeCatalog,
  YOUTUBE_PLAYBACK_CONNECTOR,
} from "../src/youtube/service";
import {
  assertSubstitutesCoverManifest,
  substituteFor,
  YOUTUBE_UNSUPPORTED_SUBSTITUTES,
} from "../src/youtube/substitutes";
import type { CatalogItem } from "webflix-contracts";

const OBSERVED_AT = "2026-10-11T00:00:00Z";

describe("youtube trending browse (videos.list chart=mostPopular)", () => {
  it("requests the official chart with region/category params and charges 1 unit", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) =>
          url.startsWith(`${YOUTUBE_API_BASE}/videos?`) && url.includes("chart=mostPopular"),
        respond: () => jsonResponse(trendingFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const page = await client.getTrendingVideos({ regionCode: "US", maxResults: 3 });
    expect(page.items).toHaveLength(3);
    expect(fetch.calls[0]).toContain("chart=mostPopular");
    expect(fetch.calls[0]).toContain("regionCode=US");
    expect(fetch.calls[0]).toContain("part=snippet%2CcontentDetails%2Cstatistics");

    const ledger = client.getLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      operationId: "videos.list",
      cost: 1,
      ok: true,
      outcome: "success",
    });
    expect(client.getSearchBudget().unitsUsedToday).toBe(1);
  });

  it("is honest about fewer results than requested (no padding)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("chart=mostPopular"),
        respond: () =>
          jsonResponse({ ...trendingFixture, items: trendingFixture.items.slice(0, 1) }),
      },
    ]);
    const client = new YouTubeDataApiClient({ fetchImpl: fetch, apiKey: FIXTURE_API_KEY });
    const page = await client.getTrendingVideos({ regionCode: "DE" });
    expect(page.items).toHaveLength(1);
  });
});

describe("youtube catalog mapping (canonical §2.1 CatalogItems)", () => {
  it("maps a search item to a provider-attributed item with the video id in the metadata bag", () => {
    const item = catalogItemFromSearchItem(searchFixture.items[0]!, {
      regionCode: "US",
      observedAt: OBSERVED_AT,
    });
    if (item === null) throw new Error("expected a mapped item");
    expect(item.providerId).toBe("youtube");
    expect(item.id).toBe("youtube:video:FIXVID00001");
    expect(item.title).toBe("Fixture: container gardening basics");
    expect(item.mediaKind).toBe("video");
    expect(item.metadata.externalIds).toEqual({ youtube: "FIXVID00001" });
    expect(item.metadata.channelId).toBe("UCFIXCH0000000000000001");
    expect(item.metadata.channelTitle).toBe("Fixture Channel");
    expect(item.metadata.publishedAt).toBe("2024-11-02T10:00:00Z");
    expect(item.metadata.year).toBe(2024);
    // Provider-native provenance, not a fabricated match.
    expect(item.matchEvidence?.confidence).toBe(1);
    expect(item.matchEvidence?.evidence[0]).toContain("search.list hit videoId=FIXVID00001");
    // One availability fact, region only because the response carried one.
    expect(item.availability).toMatchObject({
      providerId: "youtube",
      region: "US",
      available: true,
      observedAt: OBSERVED_AT,
    });
    // Assets: the official embed reference + provider thumbnails.
    const embed = item.assets.find((asset) => asset.kind === "embed");
    expect(embed?.reference).toBe("https://www.youtube-nocookie.com/embed/FIXVID00001");
    const thumb = item.assets.find((asset) => asset.kind === "thumbnail");
    expect(thumb?.reference).toBe("https://i.ytimg.com/vi/FIXVID00001/default.jpg");
  });

  it("marks live broadcast content as mediaKind live (never guessed)", () => {
    const liveRow = trendingFixture.items.find(
      (row) => row.snippet?.liveBroadcastContent === "live",
    );
    if (!liveRow) throw new Error("fixture must contain a live row");
    const item = catalogItemFromVideoItem(liveRow, {
      regionCode: "US",
      observedAt: OBSERVED_AT,
      provenance: "provider-native: videos.list chart=mostPopular trending row",
    });
    expect(item?.mediaKind).toBe("live");
    expect(item?.metadata.liveBroadcastContent).toBe("live");
  });

  it("maps playlistItems rows through resourceId.videoId", () => {
    const item = catalogItemFromPlaylistItem(uploadsPlaylistItemsFixture.items[0]!, {
      observedAt: OBSERVED_AT,
    });
    if (item === null) throw new Error("expected a mapped item");
    expect(item.metadata.externalIds).toEqual({ youtube: "FIXVID00002" });
    expect(item.matchEvidence?.evidence[0]).toContain(
      "playlistItems.list entry videoId=FIXVID00002",
    );
    // No region known from a playlist read: NO availability fact (honest absence).
    expect(item.availability).toBeUndefined();
  });

  it("drops non-video search results instead of inventing a mediaKind", () => {
    const channelHit = {
      kind: "youtube#searchResult",
      id: { kind: "youtube#channel", channelId: "UCFIXCH0000000000000001" },
      snippet: { title: "Fixture Channel" },
    };
    expect(catalogItemFromSearchItem(channelHit, { observedAt: OBSERVED_AT })).toBeNull();
    // Malformed video ids are refused too.
    expect(
      catalogItemFromSearchItem(
        { id: { kind: "youtube#video", videoId: "short" }, snippet: { title: "x" } },
        { observedAt: OBSERVED_AT },
      ),
    ).toBeNull();
  });

  it("extracts the uploads playlist id from channels.list contentDetails", () => {
    expect(uploadsPlaylistIdOf(channelsContentDetailsFixture.items[0]!)).toBe(
      "UUFIXCH0000000000000001",
    );
    expect(uploadsPlaylistIdOf({ id: "UCX" })).toBeNull();
  });

  it("videoIdOf bridges metadata, embed reference and assetId (and refuses the rest)", () => {
    const mapped = catalogItemsFromSearchResponse(searchFixture, { observedAt: OBSERVED_AT })[0]!;
    expect(videoIdOf(mapped)).toBe("FIXVID00001");

    const embedOnly: CatalogItem = {
      id: "youtube:video:X",
      providerId: "youtube",
      title: "Embed-only item",
      mediaKind: "video",
      assets: [
        {
          assetId: "youtube:embed:FIXVID00002",
          kind: "embed",
          reference: "https://www.youtube-nocookie.com/embed/FIXVID00002",
        },
      ],
      metadata: {},
    };
    expect(videoIdOf(embedOnly)).toBe("FIXVID00002");

    const neither: CatalogItem = {
      id: "youtube:video:none",
      providerId: "youtube",
      title: "No id anywhere",
      mediaKind: "video",
      assets: [],
      metadata: {},
    };
    expect(videoIdOf(neither)).toBeNull();
    expect(videoIdOf({ ...neither, providerId: "somebody-else" })).toBeNull();
  });
});

describe("youtube service: quota-ledger-aware search & browse", () => {
  it("searchYouTubeCatalog returns canonical items plus the honest budget snapshot", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/search?`),
        respond: () => jsonResponse(searchFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const page = await searchYouTubeCatalog(
      client,
      { q: "container gardening" },
      { observedAt: OBSERVED_AT },
    );
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.metadata.externalIds).toEqual({ youtube: "FIXVID00001" });
    expect(page.nextPageToken).toBe("FIXTURE-NEXT-PAGE-1");
    // One search call: 100 units charged, 99 search-class calls remain.
    expect(page.budget).toMatchObject({
      state: "ok",
      unitsUsedToday: 100,
      unitsRemainingToday: 9_900,
      searchCallsRemainingToday: 99,
    });

    const second = await searchYouTubeCatalog(
      client,
      { q: "winter soil" },
      { observedAt: OBSERVED_AT },
    );
    expect(second.budget.searchCallsRemainingToday).toBe(98);
    expect(client.getUnitsUsedToday()).toBe(200);
  });

  it("trendingYouTubeCatalog maps the chart and keeps the 1-unit budget arithmetic", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("chart=mostPopular"),
        respond: () => jsonResponse(trendingFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    const page = await trendingYouTubeCatalog(
      client,
      { regionCode: "US" },
      { observedAt: OBSERVED_AT },
    );
    expect(page.items).toHaveLength(3);
    expect(page.items.map((item) => item.metadata.externalIds)).toEqual(
      expect.arrayContaining([{ youtube: "FIXVID00003" }, { youtube: "FIXVID00004" }]),
    );
    expect(page.budget.unitsUsedToday).toBe(1);
  });

  it("channel browse: playlists list as containers, uploads shelf via contentDetails", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/playlists?`),
        respond: () => jsonResponse(playlistsFixture),
      },
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/channels?`),
        respond: () => jsonResponse(channelsContentDetailsFixture),
      },
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/playlistItems?`),
        respond: (url) =>
          jsonResponse(
            url.includes("UUFIXCH0000000000000001")
              ? uploadsPlaylistItemsFixture
              : playlistItemsFixture,
          ),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });

    const playlists = await listChannelPlaylists(client, {
      channelId: "UCFIXCH0000000000000001",
    });
    expect(playlists.playlists.length).toBeGreaterThan(0);
    expect(playlists.playlists[0]?.playlistId).toBe("PLFIX0000000000000001");

    const uploads = await channelUploadsCatalog(
      client,
      { channelId: "UCFIXCH0000000000000001" },
      { observedAt: OBSERVED_AT },
    );
    expect(uploads.playlistId).toBe("UUFIXCH0000000000000001");
    expect(uploads.items).toHaveLength(2);
    // Client-cumulative ledger: playlists.list (1) + channels.list (1) +
    // playlistItems.list (1) = 3 units — the uploads browse itself costs 2.
    expect(uploads.budget.unitsUsedToday).toBe(3);

    const playlist = await playlistVideosCatalog(
      client,
      { playlistId: "PLFIX0000000000000001" },
      { observedAt: OBSERVED_AT },
    );
    expect(playlist.items.map((item) => item.metadata.externalIds)).toEqual(
      expect.arrayContaining([{ youtube: "FIXVID00001" }, { youtube: "FIXVID00002" }]),
    );
  });

  it("searchCapabilityFromError maps typed errors onto the frozen §2.3 vocabulary", async () => {
    // rate-limited: provider 429 (fixture) surfaces with Retry-After context.
    const fetch429 = fixtureFetch([
      {
        match: (url) => url.includes("/search?"),
        respond: () =>
          jsonResponse(rateLimitExceededFixture, { status: 429, headers: { "retry-after": "42" } }),
      },
    ]);
    const client429 = new YouTubeDataApiClient({ fetchImpl: fetch429, apiKey: FIXTURE_API_KEY });
    const failure = await client429.searchVideos({ q: "x" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RateLimitedError);
    const rateLimited = searchCapabilityFromError(failure);
    expect(rateLimited.status).toBe("rate-limited");
    expect(rateLimited.detail).toContain("Retry-After: 42s");

    // rate-limited: local budget exhaustion (pre-flight block, nothing sent).
    const fetchTiny = fixtureFetch([
      { match: (url) => url.includes("/search?"), respond: () => jsonResponse(searchFixture) },
    ]);
    const tinyClient = new YouTubeDataApiClient({
      fetchImpl: fetchTiny,
      apiKey: FIXTURE_API_KEY,
      quotaLimitToday: 150,
      clock: () => NOW,
    });
    await tinyClient.searchVideos({ q: "first" });
    const blocked = await tinyClient.searchVideos({ q: "second" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(blocked).toBeInstanceOf(QuotaExceededError);
    expect(searchCapabilityFromError(blocked).status).toBe("rate-limited");

    // requires-auth: authorized call without any credential.
    const noAuthClient = new YouTubeDataApiClient({ apiKey: FIXTURE_API_KEY });
    const missing = await noAuthClient.getChannel({ mine: true }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(missing).toBeInstanceOf(MissingCredentialError);
    expect(searchCapabilityFromError(missing).status).toBe("requires-auth");

    // unknown: the fixture-only build refuses the network — check not completed.
    const offlineClient = new YouTubeDataApiClient({ apiKey: FIXTURE_API_KEY });
    const offline = await offlineClient.searchVideos({ q: "x" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(offline).toBeInstanceOf(LiveNetworkDisabledError);
    expect(searchCapabilityFromError(offline).status).toBe("unknown");

    // unavailable: a well-formed API error that is none of the above.
    const notFound = new NotFoundError({ operationId: "videos.list", message: "no video" });
    expect(searchCapabilityFromError(notFound).status).toBe("unavailable");
    expect(searchCapabilityFromError(new Error("boom")).status).toBe("unknown");
  });
});

describe("youtube watch bridge (catalog item → canonical PlaybackPlan)", () => {
  it("builds an official-embed plan for a mapped search item, end to end", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/search?`),
        respond: () => jsonResponse(searchFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    const page = await searchYouTubeCatalog(
      client,
      { q: "container gardening" },
      { observedAt: OBSERVED_AT },
    );
    const plan = playbackPlanForCatalogItem(page.items[0]!, {
      origin: "https://app.webflix.local",
    });
    if (plan.kind !== "official-embed") throw new Error("expected an official-embed plan");
    expect(plan.providerId).toBe("youtube");
    const spec = plan.embedSpec as { videoId: string; embedUrl: string; iframe: { title: string } };
    expect(spec.videoId).toBe("FIXVID00001");
    // The exact key the shell WatchScreen renders (§2.2 embedSpec.embedUrl).
    expect(spec.embedUrl).toContain("https://www.youtube-nocookie.com/embed/FIXVID00001");
    expect(spec.embedUrl).toContain("origin=https%3A%2F%2Fapp.webflix.local");
    expect(spec.iframe.title).toBe("Fixture: container gardening basics");
  });

  it("is total and honest: non-YouTube and id-less items become truthful unavailable plans", () => {
    const foreign: CatalogItem = {
      id: "other:1",
      providerId: "somebody-else",
      title: "Not ours",
      mediaKind: "video",
      assets: [],
      metadata: {},
    };
    const foreignPlan = playbackPlanForCatalogItem(foreign);
    expect(foreignPlan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (foreignPlan.kind !== "unavailable") throw new Error("unreachable");
    expect(foreignPlan.recovery?.action).toBe("open-system-settings");

    const idLess: CatalogItem = {
      id: "youtube:video:none",
      providerId: "youtube",
      title: "No video id",
      mediaKind: "video",
      assets: [],
      metadata: {},
    };
    const idLessPlan = playbackPlanForCatalogItem(idLess);
    expect(idLessPlan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (idLessPlan.kind !== "unavailable") throw new Error("unreachable");
    expect(idLessPlan.recovery?.action).toBe("open-provider-app");
  });

  it("exposes the structural adapter for the playback resolver seam", () => {
    // The playback package accepts structural Connector input; this constant
    // is what the app layer passes to resolvePlaybackPlan (no cross-package
    // import — architecture-policy keeps connectors from importing playback).
    expect(YOUTUBE_PLAYBACK_CONNECTOR.providerId).toBe("youtube");
    expect(YOUTUBE_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(true);
    expect(YOUTUBE_PLAYBACK_CONNECTOR.embed.urlTemplate).toBe(
      "https://www.youtube-nocookie.com/embed/{mediaId}",
    );
    // Sanity: the template resolves to the same URL shape the watch bridge emits.
    const resolved = YOUTUBE_PLAYBACK_CONNECTOR.embed.urlTemplate.replace(
      "{mediaId}",
      encodeURIComponent("FIXVID00001"),
    );
    expect(resolved).toBe("https://www.youtube-nocookie.com/embed/FIXVID00001");
  });
});

describe("honest-unsupported rows: WebFlix-local substitutes (work order row 4)", () => {
  it("every unsupported manifest row has exactly one substitute/handoff entry", () => {
    expect(() => assertSubstitutesCoverManifest()).not.toThrow();
    const unsupportedCount = Object.values(youtubeManifest.operations).filter(
      (op) => op.status === "unsupported",
    ).length;
    expect(YOUTUBE_UNSUPPORTED_SUBSTITUTES).toHaveLength(unsupportedCount);
  });

  it("local substitutes exist only for history and home-feed, and are WebFlix-owned stores", () => {
    expect(substituteFor("history")?.substitute).toBe("webflix-local-history");
    expect(substituteFor("home-feed")?.substitute).toBe("webflix-local-library");
    expect(substituteFor("history")?.substituteNote).toContain("WebFlix-owned");
    expect(substituteFor("home-feed")?.substituteNote).toContain("never");
    for (const row of YOUTUBE_UNSUPPORTED_SUBSTITUTES) {
      expect(row.handoffNote.length).toBeGreaterThan(0);
      if (row.substitute === "none") {
        // The note must deny a substitute (no fabricated surface) — phrased
        // as "No …" or "no official …; shows nothing".
        expect(row.substituteNote).toMatch(/[Nn]o |nothing|never/);
      }
    }
  });

  it("no substitute claims provider data (the store boundary is WebFlix-local only)", () => {
    for (const row of YOUTUBE_UNSUPPORTED_SUBSTITUTES) {
      expect(row.substitute === "none" || row.substitute.startsWith("webflix-local")).toBe(true);
      expect(row.substituteNote).toMatch(/WebFlix|[Nn]o |nothing|never/);
    }
  });
});

describe("catalog mapping feeds the canonical catalog merge (end-to-end seam)", () => {
  it("mapped search items merge by provider-native evidence without duplicates", async () => {
    const { mergeCatalogInto } = await import("catalog");
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${YOUTUBE_API_BASE}/search?`),
        respond: () => jsonResponse(searchFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({
      fetchImpl: fetch,
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    const first = await searchYouTubeCatalog(
      client,
      { q: "container gardening" },
      { observedAt: OBSERVED_AT },
    );
    const second = await searchYouTubeCatalog(
      client,
      { q: "container gardening" },
      { observedAt: OBSERVED_AT },
    );

    const result = mergeCatalogInto(first.items, second.items);
    // Same provider + same asset ids → the second page dedupes into the first.
    expect(result.items).toHaveLength(2);
    expect(result.report.deduped).toBe(2);
    expect(result.report.created).toBe(0);
  });
});
