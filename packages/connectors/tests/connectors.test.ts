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

  it("createDefaultRegistry seeds the youtube manifest", () => {
    const registry = createDefaultRegistry();
    expect(registry.size).toBe(1);
    expect(registry.require("youtube").providerId).toBe(YOUTUBE_PROVIDER_ID);
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
