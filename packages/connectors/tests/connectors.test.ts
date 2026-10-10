/**
 * Fixture-only test-suite for packages/connectors.
 * No live calls, no real credentials — the network boundary is an injected
 * fetch implementation backed by packages/connectors/fixtures (fixture-only).
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
  YOUTUBE_OAUTH_LOOPBACK_CONFIG,
  YOUTUBE_PROVIDER_ID,
  YOUTUBE_SEARCH_LIST_COST,
  youtubeManifest,
  YouTubeOAuthSession,
  RequiresAuthError,
  RefreshFailedError,
  type ConnectorManifest,
  type CredentialPort,
  type FetchLike,
  type FetchResponseLike,
  type OAuthTokenFetcher,
  type ProviderAccountRecord,
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

function memoryCredentialPort(): CredentialPort & { records: Map<string, ProviderAccountRecord> } {
  const records = new Map<string, ProviderAccountRecord>();
  const key = (providerId: string, userId: string) => `${providerId}::${userId}`;
  return {
    records,
    async get(providerId, userId) {
      return records.get(key(providerId, userId)) ?? null;
    },
    async put(record) {
      records.set(key(record.providerId, record.userId), record);
    },
    async remove(providerId, userId) {
      records.delete(key(providerId, userId));
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

function authorizedRecordFixture(): ProviderAccountRecord {
  return {
    providerId: "youtube",
    userId: "local-user-1",
    providerAccountId: "UCFIXCH0000000000000001",
    displayName: "Fixture Channel",
    status: "authorized",
    linkedAt: NOW,
    updatedAt: NOW,
    credentials: {
      accessToken: "FIXTURE-ACCESS-TOKEN-1",
      refreshToken: "FIXTURE-REFRESH-TOKEN-1",
      expiresAt: NOW + HOUR_MS,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      tokenType: "Bearer",
    },
  };
}

function minimalManifest(providerId: string): ConnectorManifest {
  return {
    providerId,
    displayName: providerId,
    manifestVersion: "0.0.1",
    policy: { officialSurfacesOnly: true, adr: "ADR-0003" },
    officialSurfaces: ["https://example.invalid/api"],
    requiresOAuth: false,
    scopes: [],
    quota: {
      currency: "units",
      defaultDailyLimit: 1000,
      referenceCosts: { read: 1, write: 50 },
      notes: [],
    },
    operations: [
      {
        operationId: "example.list",
        category: "metadata",
        summary: "minimal valid row for registry tests",
        status: "supported-official",
        mechanism: "official example.list",
        quotaCost: 1,
        reasonUnsupported: null,
        provenance: [{ label: "official docs", url: "https://example.invalid/docs" }],
      },
    ],
    sources: { auditDoc: "docs/plans/audits/AUDIT-SOURCES.md", sections: ["§2"] },
    notes: [],
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
    expect(registry.require("youtube").displayName).toBe("YouTube");
    expect(registry.require("youtube").operations).toHaveLength(14);

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
    const unsupportedWithCost = minimalManifest("dishonest-1");
    unsupportedWithCost.operations[0] = {
      operationId: "home-feed",
      category: "home-feed",
      summary: "dishonest row",
      status: "unsupported",
      mechanism: null,
      quotaCost: 40,
      reasonUnsupported: null,
      provenance: [{ label: "audit", url: "docs/plans/audits/AUDIT-SOURCES.md" }],
    };
    expect(() => validateManifest(unsupportedWithCost)).toThrowError(/quotaCost/);

    const supportedWithoutMechanism = minimalManifest("dishonest-2");
    supportedWithoutMechanism.operations[0] = {
      ...supportedWithoutMechanism.operations[0],
      status: "supported-official",
      mechanism: null,
      quotaCost: 1,
    };
    expect(() => validateManifest(supportedWithoutMechanism)).toThrowError(/mechanism/);
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
    const unsupported = youtubeManifest.operations.filter((op) => op.status === "unsupported");
    expect(unsupported.map((op) => op.operationId).sort()).toEqual(
      [...HONEST_UNSUPPORTED_IDS].sort(),
    );
    for (const op of unsupported) {
      expect(op.mechanism).toBeNull();
      expect(op.quotaCost).toBe(0);
      expect(op.reasonUnsupported).toBeTruthy();
    }
  });

  it("marks browse/search/metadata as supported-official with real mechanisms", () => {
    const supportedFamilies = ["browse", "search", "metadata"];
    const supported = youtubeManifest.operations.filter((op) =>
      supportedFamilies.includes(op.category),
    );
    expect(supported).toHaveLength(5);
    expect(
      youtubeManifest.operations.filter((op) => op.status === "supported-official"),
    ).toHaveLength(5);
    for (const op of supported) {
      expect(op.status).toBe("supported-official");
      expect(op.mechanism).toContain("YouTube Data API v3");
      expect(op.quotaCost).toBeGreaterThan(0);
      expect(op.reasonUnsupported).toBeNull();
    }
  });

  it("charges search.list 100 units and list reads 1 unit against the 10,000/day default", () => {
    expect(youtubeManifest.quota.defaultDailyLimit).toBe(YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS);
    expect(youtubeManifest.quota.defaultDailyLimit).toBe(10_000);
    expect(youtubeManifest.quota.referenceCosts.read).toBe(1);
    expect(youtubeManifest.quota.referenceCosts.write).toBe(50);
    expect(youtubeManifest.quota.referenceCosts.searchList).toBe(100);

    const searchRow = youtubeManifest.operations.find((op) => op.operationId === "search.list");
    expect(searchRow?.quotaCost).toBe(YOUTUBE_SEARCH_LIST_COST);
    expect(searchRow?.quotaCost).toBe(100);
    const videosRow = youtubeManifest.operations.find((op) => op.operationId === "videos.list");
    expect(videosRow?.quotaCost).toBe(1);
  });

  it("cites provenance on every row (official docs for supported, audit for unsupported)", () => {
    for (const op of youtubeManifest.operations) {
      expect(op.provenance.length).toBeGreaterThan(0);
      for (const citation of op.provenance) {
        expect(citation.url.length).toBeGreaterThan(0);
      }
      if (op.status === "supported-official") {
        expect(
          op.provenance.some((c) => c.url.startsWith("https://developers.google.com/youtube/")),
        ).toBe(true);
      } else {
        expect(op.provenance.some((c) => c.url.includes("AUDIT-SOURCES.md"))).toBe(true);
      }
    }
  });

  it("pins the ADR-0003 official-surfaces-only policy and the readonly scope", () => {
    expect(youtubeManifest.policy).toEqual({ officialSurfacesOnly: true, adr: "ADR-0003" });
    for (const surface of youtubeManifest.officialSurfaces) {
      expect(surface.startsWith("https://")).toBe(true);
    }
    expect(youtubeManifest.officialSurfaces).toContain("https://www.googleapis.com/youtube/v3");
    expect(youtubeManifest.officialSurfaces).toContain("https://www.youtube-nocookie.com/embed/");
    expect(youtubeManifest.scopes).toEqual(["https://www.googleapis.com/auth/youtube.readonly"]);
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
// OAuth loopback + PKCE state machine
// ---------------------------------------------------------------------------

describe("oauth loopback + PKCE state machine", () => {
  it("allows exactly the honest transitions and refuses skips", () => {
    expect(OAUTH_TRANSITIONS.authorized).toEqual(["expired", "revoked"]);
    expect(canTransition("authorized", "expired")).toBe(true);
    expect(canTransition("expired", "revoked")).toBe(true);
    expect(canTransition("revoked", "requires-auth")).toBe(true);
    expect(canTransition("authorized", "authorized")).toBe(false);
    expect(canTransition("requires-auth", "expired")).toBe(false);
    expect(canTransition("revoked", "authorized")).toBe(false);
    expect(() => {
      if (canTransition("requires-auth", "revoked")) return;
      throw new InvalidTransitionError("illegal oauth account transition: requires-auth → revoked");
    }).toThrowError(InvalidTransitionError);
  });

  it("transitionAccount stamps status changes and enforces the map", () => {
    const record = authorizedRecordFixture();
    const expired = transitionAccount(record, "expired", NOW + 1);
    expect(expired.status).toBe("expired");
    expect(expired.credentials).toEqual(record.credentials);

    const revoked = transitionAccount(expired, "revoked", NOW + 2);
    expect(revoked.status).toBe("revoked");
    expect(revoked.credentials).toBeNull();

    const reset = transitionAccount(revoked, "requires-auth", NOW + 3);
    expect(reset.status).toBe("requires-auth");
    expect(() => transitionAccount(reset, "expired", NOW + 4)).toThrowError(InvalidTransitionError);
  });

  it("derives status from the stored record and the clock", () => {
    expect(deriveAccountStatus(null, NOW)).toBe("requires-auth");
    const base = authorizedRecordFixture();
    expect(deriveAccountStatus(base, NOW)).toBe("authorized");
    expect(deriveAccountStatus(base, (base.credentials?.expiresAt ?? NOW) + 1)).toBe("expired");
    expect(deriveAccountStatus({ ...base, status: "revoked" }, NOW)).toBe("revoked");
    expect(deriveAccountStatus({ ...base, credentials: null }, NOW)).toBe("requires-auth");
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

  it("walks requires-auth → authorized → expired → authorized → revoked → requires-auth honestly", async () => {
    const port = memoryCredentialPort();
    let now = NOW;
    const behavior = { refreshFailsWithInvalidGrant: false };
    const { fetcher, counts } = fixtureTokenFetcher(behavior);
    const session = new YouTubeOAuthSession({
      credentialPort: port,
      userId: "local-user-1",
      clock: () => now,
      tokenFetcher: fetcher,
    });

    expect(await session.status()).toBe("requires-auth");
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);

    const request = session.startAuthorization({ redirectPort: 41073 });
    await expect(
      session.completeAuthorization({ code: "FIXTURE-CODE", state: "wrong-state" }),
    ).rejects.toThrowError(StateMismatchError);

    const authorized = await session.completeAuthorization({
      code: "FIXTURE-CODE",
      state: request.state,
      providerAccountId: "UCFIXCH0000000000000001",
      displayName: "Fixture Channel",
    });
    expect(authorized.status).toBe("authorized");
    expect(authorized.credentials?.accessToken).toBe("FIXTURE-ACCESS-TOKEN-1");
    expect(authorized.credentials?.expiresAt).toBe(NOW + HOUR_MS);
    expect(await session.status()).toBe("authorized");
    await expect(session.getToken()).resolves.toBe("FIXTURE-ACCESS-TOKEN-1");

    // authorized → expired (clock passes expiry)
    now = NOW + 2 * HOUR_MS;
    expect(await session.status()).toBe("expired");

    // expired → authorized via refresh
    const refreshed = await session.refresh();
    expect(refreshed.status).toBe("authorized");
    expect(refreshed.credentials?.accessToken).toBe("FIXTURE-ACCESS-TOKEN-2");
    expect(refreshed.credentials?.refreshToken).toBe("FIXTURE-REFRESH-TOKEN-1"); // refresh omitted it; kept
    expect(refreshed.credentials?.expiresAt).toBe(now + HOUR_MS);
    await expect(session.getToken()).resolves.toBe("FIXTURE-ACCESS-TOKEN-2");

    // authorized → expired again; this time the refresh is rejected with invalid_grant → revoked
    now = now + 2 * HOUR_MS;
    behavior.refreshFailsWithInvalidGrant = true;
    await expect(session.getToken()).rejects.toThrowError(RefreshFailedError);
    expect((await session.loadAccount())?.status).toBe("revoked");
    expect((await session.loadAccount())?.credentials).toBeNull();
    expect(await session.status()).toBe("revoked");

    // revoked → requires-auth when the operator acknowledges
    const acknowledged = await session.acknowledgeRevocation();
    expect(acknowledged.status).toBe("requires-auth");
    expect(await session.status()).toBe("requires-auth");
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);

    expect(counts.exchange).toBe(1);
    expect(counts.refresh).toBe(2);
    expect(port.records.size).toBe(1);
  });

  it("revoke() walks authorized → revoked and destroys the credentials", async () => {
    const port = memoryCredentialPort();
    const { fetcher, counts } = fixtureTokenFetcher();
    const session = new YouTubeOAuthSession({
      credentialPort: port,
      userId: "local-user-1",
      clock: () => NOW,
      tokenFetcher: fetcher,
    });
    const request = session.startAuthorization({ redirectPort: 41073 });
    await session.completeAuthorization({ code: "FIXTURE-CODE", state: request.state });

    const revoked = await session.revoke();
    expect(revoked.status).toBe("revoked");
    expect(revoked.credentials).toBeNull();
    expect(counts.revoke).toBe(1);
    await expect(session.getToken()).rejects.toThrowError(RequiresAuthError);
  });

  it("the default token fetcher refuses live network honestly", async () => {
    const session = new YouTubeOAuthSession({
      credentialPort: memoryCredentialPort(),
      userId: "local-user-1",
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 41073 });
    await expect(
      session.completeAuthorization({ code: "x", state: request.state }),
    ).rejects.toThrowError(LiveNetworkDisabledError);
  });
});

// ---------------------------------------------------------------------------
// Playback plans (official-embed)
// ---------------------------------------------------------------------------

describe("playback plans (official-embed)", () => {
  it("builds an official IFrame embed plan with a pinned origin", () => {
    const plan = buildYouTubePlaybackPlan({
      videoId: "dQw4w9WgXcQ",
      origin: "https://app.webflix.local",
      startSeconds: 90,
      title: "Fixture video",
    });
    expect(plan.kind).toBe("official-embed");
    expect(plan.providerId).toBe("youtube");
    expect(plan.embedUrl.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(
      true,
    );
    expect(plan.embedUrl).toContain("autoplay=0");
    expect(plan.embedUrl).toContain("controls=1");
    expect(plan.embedUrl).toContain("rel=0");
    expect(plan.embedUrl).toContain("playsinline=1");
    expect(plan.embedUrl).toContain("start=90");
    expect(plan.embedUrl).toContain("enablejsapi=1");
    expect(plan.embedUrl).toContain(`origin=${encodeURIComponent("https://app.webflix.local")}`);
    expect(plan.iframe.allowFullScreen).toBe(true);
    expect(plan.iframe.title).toBe("Fixture video");
    expect(plan.iframe.allow).toContain("autoplay");
    expect(
      plan.provenance.some(
        (c) => c.url === "https://developers.google.com/youtube/iframe_api_reference",
      ),
    ).toBe(true);

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
    expect(plan.embedUrl.startsWith("https://www.youtube.com/embed/dQw4w9WgXcQ?")).toBe(true);
    expect(plan.embedUrl).not.toContain("enablejsapi");
    expect(plan.embedUrl).not.toContain("origin=");
    expect(plan.notes.join(" ")).toContain("No origin supplied");
  });
});
