/**
 * Fixture-only test-suite for the Twitch connector (TWITCH-CONNECT, Phase 3
 * platform #2) — the third platform on the exact frozen §2 contracts YouTube
 * and TikTok use. No live calls, no real credentials: the network boundary is
 * an injected fetch backed by packages/connectors/fixtures/twitch.
 *
 * Live-captured shapes this suite replays (recorded 2026-10-11 from the
 * work-order sandbox — see the parity matrix live-smoke section):
 *   - Helix unauthenticated: HTTP 401, application/json,
 *     {"error":"Unauthorized","status":401,"message":"OAuth token is missing"}
 *     (and with a bogus bearer: "Invalid OAuth token")
 *   - player.twitch.tv parent-parameter behavior: no parent → 302
 *     /embed-error.html?errorCode=NoParent; parent=<host> → 200 with
 *     Content-Security-Policy: frame-ancestors pinning exactly that host
 *     (localhost → http://localhost:* https://localhost:*)
 */
import { describe, expect, it } from "vitest";

import {
  browseLiveStreams,
  browseTopGames,
  buildTwitchAuthorizationRequest,
  buildTwitchPlaybackPlan,
  catalogItemFromClip,
  catalogItemFromStream,
  catalogItemFromVideo,
  channelDescriptorFromUser,
  createDefaultRegistry,
  followedChannels,
  gameDescriptorsFromResponse,
  InvalidTwitchWatchTargetError,
  lookupChannel,
  MissingTwitchParentError,
  OAuthFlowError,
  parseTwitchDurationSeconds,
  playbackPlanForTwitchCatalogItem,
  RequiresAuthError,
  RefreshFailedError,
  StateMismatchError,
  TWITCH_API_BASE,
  TWITCH_CLIENT_ID,
  TWITCH_DEV_PARENT,
  TWITCH_DOCUMENTED_EXAMPLE_BUCKET,
  TWITCH_MANIFEST_VERSION,
  TWITCH_OAUTH_BASE,
  TWITCH_OAUTH_SCOPES,
  TWITCH_OPERATION_PROVENANCE,
  TWITCH_PLAYBACK_CONNECTOR,
  TWITCH_PLAYER_URL,
  TWITCH_PROVIDER_ID,
  TWITCH_RATE_WINDOW_MS,
  TWITCH_UNSUPPORTED_SUBSTITUTES,
  TwitchAppAccessSession,
  TwitchHelixClient,
  TwitchMissingCredentialError,
  TwitchNotFoundError,
  TwitchOAuthSession,
  TwitchRateLimitedError,
  TwitchRequiresAuthError,
  assertTwitchSubstitutesCoverManifest,
  twitchCapabilityFromError,
  twitchManifest,
  twitchSubstituteFor,
  twitchWatchTargetOf,
  type CatalogItem,
  type ConnectorManifest,
  type ProviderAccountRecord,
  type TwitchFetchLike,
  type TwitchFetchResponseLike,
  type TwitchStoredTokens,
  type TwitchTokenFetcher,
} from "../src";

import streamsFixture from "../fixtures/twitch/helix.streams.json";
import videosFixture from "../fixtures/twitch/helix.videos.json";
import clipsFixture from "../fixtures/twitch/helix.clips.json";
import usersFixture from "../fixtures/twitch/helix.users.json";
import gamesTopFixture from "../fixtures/twitch/helix.games.top.json";
import followedFixture from "../fixtures/twitch/helix.channels.followed.json";
import unauthorizedFixture from "../fixtures/twitch/error.unauthorized.json";
import invalidTokenFixture from "../fixtures/twitch/error.invalid-token.json";
import tokenSuccessFixture from "../fixtures/twitch/oauth.token.success.json";
import tokenRefreshFixture from "../fixtures/twitch/oauth.token.refresh.json";
import appTokenFixture from "../fixtures/twitch/oauth.app-token.success.json";
import tokenRejectedFixture from "../fixtures/twitch/oauth.token.rejected.json";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");

/** The documented Helix Ratelimit example triple (official API guide). */
const RATE_HEADERS = {
  "ratelimit-limit": "800",
  "ratelimit-remaining": "799",
  "ratelimit-reset": "1781653392",
};

// ---------------------------------------------------------------------------
// Fixture helpers (all network is injected; nothing leaves the process)
// ---------------------------------------------------------------------------

interface TwitchFixtureInit {
  status?: number;
  headers?: Record<string, string>;
}

function jsonResponse(body: unknown, init: TwitchFixtureInit = {}): TwitchFetchResponseLike {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

interface Route {
  match: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => boolean;
  respond: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => TwitchFetchResponseLike;
}

function fixtureFetch(routes: Route[]): TwitchFetchLike & {
  calls: string[];
  inits: Array<{ method?: string; headers?: Record<string, string>; body?: string }>;
} {
  const calls: string[] = [];
  const inits: Array<{ method?: string; headers?: Record<string, string>; body?: string }> = [];
  const fetchFn = (async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    calls.push(url);
    inits.push(init ?? {});
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`fixture fetch: no route matched ${url}`);
    return route.respond(url, init);
  }) as TwitchFetchLike & {
    calls: string[];
    inits: Array<{ method?: string; headers?: Record<string, string>; body?: string }>;
  };
  fetchFn.calls = calls;
  fetchFn.inits = inits;
  return fetchFn;
}

const FIXED_APP_TOKEN = { getAppAccessToken: async () => "webflix-fixture-app-token" };
const FIXED_USER_TOKEN = { getUserAccessToken: async () => "webflix-fixture-user-token" };

function helixClient(
  fetch: TwitchFetchLike,
  options: { userToken?: boolean } = {},
): TwitchHelixClient {
  return new TwitchHelixClient({
    fetchImpl: fetch,
    clientId: "webflix-fixture-client-id",
    appAccessTokenProvider: FIXED_APP_TOKEN,
    userAccessTokenProvider: options.userToken ? FIXED_USER_TOKEN : undefined,
    clock: () => NOW,
  });
}

function memoryTwitchStore() {
  const accounts = new Map<string, ProviderAccountRecord>();
  const vault = new Map<string, TwitchStoredTokens>();
  return {
    accounts,
    vault,
    async loadAccount(id: string) {
      return accounts.get(id) ?? null;
    },
    async saveAccount(record: ProviderAccountRecord) {
      accounts.set(record.internalAccountId, record);
    },
    async removeAccount(id: string) {
      accounts.delete(id);
    },
    async loadTokens(id: string) {
      return vault.get(id) ?? null;
    },
    async saveTokens(id: string, tokens: TwitchStoredTokens) {
      vault.set(id, tokens);
    },
    async removeTokens(id: string) {
      vault.delete(id);
    },
  };
}

function fixtureTwitchFetcher(
  options: {
    refreshRejected?: boolean;
    revokeRejected?: boolean;
  } = {},
) {
  const counts = { exchange: 0, refresh: 0, appAccess: 0, revoke: 0 };
  const seen: string[] = [];
  const fetcher: TwitchTokenFetcher = async (request) => {
    seen.push(request.kind);
    if (request.kind === "token-exchange") {
      counts.exchange += 1;
      return { kind: "token", token: tokenSuccessFixture };
    }
    if (request.kind === "refresh") {
      counts.refresh += 1;
      if (options.refreshRejected) {
        return {
          kind: "rejected",
          status: tokenRejectedFixture.status,
          message: tokenRejectedFixture.message,
        };
      }
      return { kind: "token", token: tokenRefreshFixture };
    }
    if (request.kind === "app-access") {
      counts.appAccess += 1;
      return { kind: "token", token: appTokenFixture };
    }
    counts.revoke += 1;
    if (options.revokeRejected) {
      return { kind: "rejected", status: 400, message: "fixture: revoke rejected" };
    }
    return { kind: "revoked" };
  };
  return { fetcher, counts, seen };
}

// ---------------------------------------------------------------------------
// Manifest honesty (frozen §2.3 + the work order's honesty gates)
// ---------------------------------------------------------------------------

describe("twitch manifest honesty (frozen §2.3 + AUDIT-SOURCES §5)", () => {
  it("registers in the default registry alongside youtube and tiktok (third platform, same contracts; instagram joined at INSTAGRAM-CONNECT)", () => {
    const registry = createDefaultRegistry();
    expect(registry.require("twitch")).toBe(twitchManifest);
    expect(registry.has("youtube")).toBe(true);
    expect(registry.has("tiktok")).toBe(true);
    expect(registry.size).toBe(4);
    expect(registry.list().map((m: ConnectorManifest) => m.providerId)).toEqual([
      "instagram",
      "tiktok",
      "twitch",
      "youtube",
    ]);
  });

  it("declares only legal frozen statuses, with dot-namespaced operation ids", () => {
    const legal = [
      "supported",
      "requires-auth",
      "unsupported",
      "unavailable",
      "rate-limited",
      "degraded",
      "unknown",
    ];
    const operationIdPattern = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
    expect(Object.keys(twitchManifest.operations).length).toBeGreaterThan(0);
    for (const [operationId, capability] of Object.entries(twitchManifest.operations)) {
      expect(operationId).toMatch(operationIdPattern);
      expect(legal).toContain(capability.status);
      expect((capability.detail ?? "").length).toBeGreaterThan(0);
    }
  });

  it("every unsupported row explains itself (registry honesty rule)", () => {
    for (const [operationId, capability] of Object.entries(twitchManifest.operations)) {
      if (capability.status === "unsupported") {
        expect(capability.detail, operationId).toBeTruthy();
        expect((capability.detail ?? "").length).toBeGreaterThan(40);
      }
    }
  });

  it("carries the honest operation split: 5 public reads, 1 per-user read, playback + 3 account rows, and the honest-unsupported tail", () => {
    const statuses = Object.values(twitchManifest.operations).map((op) => op.status);
    expect(twitchManifest.operations["streams.live"]?.status).toBe("supported");
    expect(twitchManifest.operations["videos.list"]?.status).toBe("supported");
    expect(twitchManifest.operations["clips.list"]?.status).toBe("supported");
    expect(twitchManifest.operations["users.read"]?.status).toBe("supported");
    expect(twitchManifest.operations["games.top"]?.status).toBe("supported");
    expect(twitchManifest.operations["channels.followed"]?.status).toBe("requires-auth");
    expect(twitchManifest.operations["playback.embed"]?.status).toBe("supported");
    expect(twitchManifest.operations["oauth.connect"]?.status).toBe("supported");
    expect(twitchManifest.operations["oauth.disconnect"]?.status).toBe("supported");
    expect(twitchManifest.operations["oauth.app-access"]?.status).toBe("supported");
    // The work-order's honest-unsupported enumeration (chat/IRC, EventSub,
    // moderation, stream key, content classification, bits/subscriptions
    // value surfaces + the no-API rows).
    expect(twitchManifest.operations["chat.read"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["eventsub.subscribe"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["moderation.manage"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["stream-key.read"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["content-classification.list"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["bits.value"]?.status).toBe("unsupported");
    expect(twitchManifest.operations["subscriptions.value"]?.status).toBe("unsupported");
    expect(statuses.filter((s) => s === "unsupported").length).toBeGreaterThanOrEqual(13);
  });

  it("models the rate bucket honestly: the documented example in the envelope, the header basis labeled, never a verified claim", () => {
    expect(twitchManifest.quotas).toEqual({
      requestsPerWindow: TWITCH_DOCUMENTED_EXAMPLE_BUCKET,
      windowMs: TWITCH_RATE_WINDOW_MS,
    });
    expect(TWITCH_DOCUMENTED_EXAMPLE_BUCKET).toBe(800);
    expect(TWITCH_RATE_WINDOW_MS).toBe(60_000);
  });

  it("claims no served regions (honest empty list — one reachable egress is not a global claim)", () => {
    expect(twitchManifest.regions).toEqual([]);
  });

  it("cites an official source for every operation (audit trail)", () => {
    for (const operationId of Object.keys(twitchManifest.operations)) {
      const citations = TWITCH_OPERATION_PROVENANCE[operationId];
      expect(citations, operationId).toBeDefined();
      expect(citations.length).toBeGreaterThan(0);
      for (const citation of citations) {
        expect(citation.url.length).toBeGreaterThan(0);
        expect((citation.label ?? "").length).toBeGreaterThan(0);
      }
    }
  });

  it("requests only the read-only scope set (no write/editor/broadcaster scopes)", () => {
    expect(TWITCH_OAUTH_SCOPES).toEqual(["user:read:follows"]);
    for (const scope of TWITCH_OAUTH_SCOPES) {
      expect(scope).not.toMatch(/edit|write|manage|broadcaster|moderation|stream_key/);
    }
  });

  it("declares the typed failure modes the Helix client knows", () => {
    expect(twitchManifest.failureModes).toContain("rate-limit");
    expect(twitchManifest.failureModes).toContain("auth");
    expect(twitchManifest.failureModes).toContain("network");
  });
});

// ---------------------------------------------------------------------------
// Helix client (public reads — App Access token)
// ---------------------------------------------------------------------------

describe("twitch helix client (streams/videos/clips/users/games, Client-Id + Bearer)", () => {
  it("sends Client-Id + Bearer on every read and parses the Helix envelope", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () => jsonResponse(streamsFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const client = helixClient(fetch);
    const response = await client.getStreams({ first: 20, language: "en" });
    expect(response.data).toHaveLength(2);
    expect(fetch.calls[0]).toContain(`${TWITCH_API_BASE}/streams?`);
    expect(fetch.calls[0]).toContain("first=20");
    expect(fetch.calls[0]).toContain("language=en");
    expect(fetch.inits[0]?.headers?.["Client-Id"]).toBe("webflix-fixture-client-id");
    expect(fetch.inits[0]?.headers?.Authorization).toBe("Bearer webflix-fixture-app-token");
  });

  it("reads videos, clips, users and top games through the same envelope", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/videos`),
        respond: () => jsonResponse(videosFixture, { headers: RATE_HEADERS }),
      },
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/clips`),
        respond: () => jsonResponse(clipsFixture, { headers: RATE_HEADERS }),
      },
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/users`),
        respond: () => jsonResponse(usersFixture, { headers: RATE_HEADERS }),
      },
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/games/top`),
        respond: () => jsonResponse(gamesTopFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const client = helixClient(fetch);

    const videos = await client.getVideos({ userId: "141981764" });
    expect(videos.data?.[0]?.id).toBe("1973304310");
    expect(fetch.calls[0]).toContain("user_id=141981764");

    const clips = await client.getClips({ broadcasterId: "141981764" });
    expect(clips.data?.[0]?.id).toBe("EncouragingPlausibleGiraffeNomNom");

    const users = await client.getUsers({ login: "twitch" });
    expect(users.data?.[0]?.login).toBe("twitch");

    const games = await client.getTopGames({ first: 3 });
    expect(games.data).toHaveLength(3);
    expect(fetch.calls[3]).toContain("first=3");
  });

  it("refuses to call without a Client-Id or without an app token (honest pre-I/O refusals)", async () => {
    const noClientId = new TwitchHelixClient({
      fetchImpl: fixtureFetch([]),
      appAccessTokenProvider: FIXED_APP_TOKEN,
    });
    await expect(noClientId.getStreams()).rejects.toBeInstanceOf(TwitchMissingCredentialError);

    const noToken = new TwitchHelixClient({
      fetchImpl: fixtureFetch([]),
      clientId: "webflix-fixture-client-id",
    });
    await expect(noToken.getStreams()).rejects.toBeInstanceOf(TwitchMissingCredentialError);
    await expect(noToken.getTopGames()).rejects.toBeInstanceOf(TwitchMissingCredentialError);
  });

  it("maps the LIVE-CAPTURED 401 envelope verbatim onto the requires-auth error", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () => jsonResponse(unauthorizedFixture, { status: 401 }),
      },
    ]);
    const client = helixClient(fetch);
    const error = await client.getStreams().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TwitchRequiresAuthError);
    if (error instanceof TwitchRequiresAuthError) {
      expect(error.status).toBe(401);
      expect(error.providerMessage).toBe("OAuth token is missing");
      expect(error.error).toBe("Unauthorized");
    }
  });

  it("maps the invalid-token 401 shape too (live-captured variant)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/games/top`),
        respond: () => jsonResponse(invalidTokenFixture, { status: 401 }),
      },
    ]);
    const client = helixClient(fetch);
    const error = await client.getTopGames().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TwitchRequiresAuthError);
    if (error instanceof TwitchRequiresAuthError) {
      expect(error.providerMessage).toBe("Invalid OAuth token");
    }
  });

  it("maps 404 onto the not-found error", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/videos`),
        respond: () =>
          jsonResponse(
            { error: "Not Found", status: 404, message: "the video does not exist" },
            { status: 404 },
          ),
      },
    ]);
    const client = helixClient(fetch);
    await expect(client.getVideos({ id: "9999999999" })).rejects.toBeInstanceOf(
      TwitchNotFoundError,
    );
  });

  it("followed channels is a USER-token read: refuses app-only clients honestly", async () => {
    const appOnly = helixClient(fixtureFetch([]));
    await expect(
      appOnly.getFollowedChannels({ broadcasterUserId: "71092938" }),
    ).rejects.toBeInstanceOf(TwitchMissingCredentialError);
  });

  it("followed channels with a user token calls the endpoint with user_id", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/channels/followed`),
        respond: () => jsonResponse(followedFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const client = helixClient(fetch, { userToken: true });
    const response = await client.getFollowedChannels({ broadcasterUserId: "71092938" });
    expect(response.data).toHaveLength(2);
    expect(fetch.calls[0]).toContain("user_id=71092938");
    expect(fetch.inits[0]?.headers?.Authorization).toBe("Bearer webflix-fixture-user-token");
  });

  it("refuses a payload without a data array (never fabricates rows)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/games/top`),
        respond: () => jsonResponse({ unexpected: true }, { status: 200 }),
      },
    ]);
    const client = helixClient(fetch);
    await expect(client.getTopGames()).rejects.toThrowError(/refusing to fabricate rows/);
  });
});

// ---------------------------------------------------------------------------
// The header-based rate ledger (the work order's core honesty mechanism)
// ---------------------------------------------------------------------------

describe("twitch rate ledger: AUTHORITATIVE Ratelimit-* headers, basis-labeled, no invented numbers", () => {
  it("records the provider's own header triple verbatim on every call", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () => jsonResponse(streamsFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const client = helixClient(fetch);
    await client.getStreams();
    const ledger = client.getLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.bucketLimit).toBe(800);
    expect(ledger[0]?.bucketRemaining).toBe(799);
    expect(ledger[0]?.bucketResetAtSeconds).toBe(1781653392);
    expect(ledger[0]?.outcome).toBe("success");

    const budget = client.getRateBudget();
    expect(budget.bucketLimit).toBe(800);
    expect(budget.bucketRemaining).toBe(799);
    expect(budget.bucketResetAtSeconds).toBe(1781653392);
    expect(budget.state).toBe("ok");
    expect(budget.basis).toContain("Ratelimit-Limit");
    expect(budget.basis).toContain("documented example");
  });

  it("never blocks pre-flight: calls go to the wire even with remaining=0 (no invented ceiling)", async () => {
    const emptyBucketHeaders = {
      "ratelimit-limit": "800",
      "ratelimit-remaining": "0",
      "ratelimit-reset": "1781653392",
    };
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () => jsonResponse(streamsFixture, { headers: emptyBucketHeaders }),
      },
    ]);
    const client = helixClient(fetch);
    for (let i = 0; i < 5; i += 1) {
      const response = await client.getStreams();
      expect(response.data).toHaveLength(2);
    }
    expect(fetch.calls).toHaveLength(5); // all five reached the wire
    expect(client.getRateBudget().bucketRemaining).toBe(0);
    expect(client.getRateBudget().state).toBe("ok"); // the PROVIDER never said 429
  });

  it("HTTP 429 is the authoritative enforcement: typed error with the served reset, honest rate-limited state", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () =>
          jsonResponse(
            { error: "Too Many Requests", status: 429, message: "Too Many Requests" },
            { status: 429, headers: RATE_HEADERS },
          ),
      },
    ]);
    const client = helixClient(fetch);
    const error = await client.getStreams().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TwitchRateLimitedError);
    if (error instanceof TwitchRateLimitedError) {
      expect(error.status).toBe(429);
      expect(error.resetAtSeconds).toBe(1781653392);
      expect(error.message).toContain("Ratelimit-Reset");
    }
    const budget = client.getRateBudget();
    expect(budget.state).toBe("provider-rate-limited");
    expect(budget.providerReportedRateLimit).toBe(true);
    const ledger = client.getLedger();
    expect(ledger[ledger.length - 1]?.outcome).toBe("rate-limited");
  });

  it("maps the rate-limited error onto the frozen rate-limited capability", () => {
    try {
      throw new TwitchRateLimitedError({
        operationId: "streams.live",
        status: 429,
        message: "Twitch rate-limited streams.live (HTTP 429).",
        resetAtSeconds: 1781653392,
      });
    } catch (error) {
      expect(twitchCapabilityFromError(error)).toMatchObject({ status: "rate-limited" });
    }
  });
});

// ---------------------------------------------------------------------------
// App Access session (client-credentials — public reads)
// ---------------------------------------------------------------------------

describe("twitch app access session (client-credentials grant, fixture-tested)", () => {
  it("mints an app token through the official flow and caches it until expiry", async () => {
    const { fetcher, counts } = fixtureTwitchFetcher();
    let clockNow = NOW;
    const session = new TwitchAppAccessSession({
      config: {
        clientId: "webflix-fixture-client-id",
        clientSecret: "webflix-fixture-secret",
        scopes: TWITCH_OAUTH_SCOPES,
        authorizationEndpoint: `${TWITCH_OAUTH_BASE}/authorize`,
        tokenEndpoint: `${TWITCH_OAUTH_BASE}/token`,
        revokeEndpoint: `${TWITCH_OAUTH_BASE}/revoke`,
        loopbackHost: "127.0.0.1",
        loopbackPath: "/oauth/callback",
      },
      tokenFetcher: fetcher,
      clock: () => clockNow,
    });
    const first = await session.getAppAccessToken();
    expect(first).toBe(appTokenFixture.access_token);
    const second = await session.getAppAccessToken();
    expect(second).toBe(first); // cached — one mint, two reads
    expect(counts.appAccess).toBe(1);

    clockNow = NOW + (appTokenFixture.expires_in + 120) * 1000; // past expiry + skew
    const third = await session.getAppAccessToken();
    expect(third).toBe(appTokenFixture.access_token);
    expect(counts.appAccess).toBe(2); // re-minted — app tokens are never refreshed
  });

  it("returns an honest null when no client secret is provisioned (operator item)", async () => {
    const { fetcher } = fixtureTwitchFetcher();
    const session = new TwitchAppAccessSession({ tokenFetcher: fetcher, clock: () => NOW });
    expect(await session.getAppAccessToken()).toBeNull();
  });

  it("returns an honest null when the provider rejects the mint", async () => {
    const rejected: TwitchTokenFetcher = async () => ({
      kind: "rejected",
      status: 400,
      message: "Invalid Client Secret",
    });
    const session = new TwitchAppAccessSession({
      config: {
        clientId: "webflix-fixture-client-id",
        clientSecret: "wrong-secret",
        scopes: TWITCH_OAUTH_SCOPES,
        authorizationEndpoint: `${TWITCH_OAUTH_BASE}/authorize`,
        tokenEndpoint: `${TWITCH_OAUTH_BASE}/token`,
        revokeEndpoint: `${TWITCH_OAUTH_BASE}/revoke`,
        loopbackHost: "127.0.0.1",
        loopbackPath: "/oauth/callback",
      },
      tokenFetcher: rejected,
      clock: () => NOW,
    });
    expect(await session.getAppAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-user OAuth (Authorization Code + PKCE, loopback; fixture-tested)
// ---------------------------------------------------------------------------

describe("twitch per-user oauth (loopback + PKCE, fixture-tested)", () => {
  it("builds the official authorization URL: PKCE S256, SPACE-separated scopes, no invented params", () => {
    const request = buildTwitchAuthorizationRequest({
      redirectPort: 43113,
      state: "fixture-state",
      pkce: {
        codeVerifier: "fixture-verifier",
        codeChallenge: "fixture-challenge",
        codeChallengeMethod: "S256",
      },
    });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(`${TWITCH_OAUTH_BASE}/authorize`);
    expect(url.searchParams.get("client_id")).toBe(TWITCH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43113/oauth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("user:read:follows"); // SPACE-joined
    expect(url.searchParams.get("state")).toBe("fixture-state");
    expect(url.searchParams.get("code_challenge")).toBe("fixture-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // NO Google/TikTok parameters — asserted absent (the honest no-invented-input rule).
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.get("client_key")).toBeNull();
    expect(url.searchParams.get("force_verify")).toBeNull();
  });

  it("exchanges the code (PKCE) and persists a renderer-safe record + vault-side tokens", async () => {
    const store = memoryTwitchStore();
    const { fetcher, counts } = fixtureTwitchFetcher();
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 43113, state: "s1" });
    const record = await session.completeAuthorization({
      code: "fixture-code",
      state: "s1",
      displayName: "Fixture Viewer",
      twitchUserId: "71092938",
    });
    expect(record).toMatchObject({
      providerId: TWITCH_PROVIDER_ID,
      internalAccountId: "twitch-main",
      displayName: "Fixture Viewer",
      status: "connected",
      grantedScopes: ["user:read:follows"],
    });
    expect(record.connectedAt).toBe(new Date(NOW).toISOString());
    expect(JSON.stringify(record)).not.toContain(tokenSuccessFixture.access_token); // renderer-safe
    const tokens = await store.loadTokens("twitch-main");
    expect(tokens?.accessToken).toBe(tokenSuccessFixture.access_token);
    expect(tokens?.twitchUserId).toBe("71092938"); // vault-side (MR-FD4)
    expect(counts.exchange).toBe(1);
    expect(() => request).toBeDefined();
  });

  it("refuses callbacks with unknown state (CSRF guard)", async () => {
    const store = memoryTwitchStore();
    const { fetcher } = fixtureTwitchFetcher();
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    await expect(
      session.completeAuthorization({ code: "c", state: "never-started" }),
    ).rejects.toBeInstanceOf(StateMismatchError);
  });

  it("serves user tokens and refreshes near expiry, rotating the refresh token", async () => {
    const store = memoryTwitchStore();
    const { fetcher, counts } = fixtureTwitchFetcher();
    let clockNow = NOW;
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => clockNow,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });

    clockNow = NOW + (tokenSuccessFixture.expires_in - 30) * 1000; // inside the skew window
    const token = await session.getUserAccessToken();
    expect(token).toBe(tokenRefreshFixture.access_token);
    expect(counts.refresh).toBe(1);
    // Twitch rotates the refresh token on every refresh — the new one wins.
    const tokens = await store.loadTokens("twitch-main");
    expect(tokens?.refreshToken).toBe(tokenRefreshFixture.refresh_token);
  });

  it("provider-rejected refresh (HTTP 400) honestly revokes the account", async () => {
    const store = memoryTwitchStore();
    const { fetcher } = fixtureTwitchFetcher({ refreshRejected: true });
    let clockNow = NOW;
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => clockNow,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });
    clockNow = NOW + (tokenSuccessFixture.expires_in + 60) * 1000; // past expiry
    await expect(session.getUserAccessToken()).rejects.toBeInstanceOf(RefreshFailedError);
    const record = await store.loadAccount("twitch-main");
    expect(record?.status).toBe("revoked");
    expect(await store.loadTokens("twitch-main")).toBeNull();
  });

  it("disconnect performs the OFFICIAL revocation call, then destroys local state (the Twitch difference from TikTok)", async () => {
    const store = memoryTwitchStore();
    const { fetcher, counts, seen } = fixtureTwitchFetcher();
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });

    const revoked = await session.disconnect();
    expect(revoked.status).toBe("revoked");
    expect(counts.revoke).toBe(1); // the provider-side grant WAS revoked
    expect(seen).toContain("revoke");
    expect(await store.loadTokens("twitch-main")).toBeNull();
  });

  it("a FAILED revocation surfaces the error and leaves the account connected (retryable, never silent)", async () => {
    const store = memoryTwitchStore();
    const { fetcher } = fixtureTwitchFetcher({ revokeRejected: true });
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });

    await expect(session.disconnect()).rejects.toBeInstanceOf(OAuthFlowError);
    const record = await store.loadAccount("twitch-main");
    expect(record?.status).toBe("connected"); // untouched — retry the disconnect
    expect(await store.loadTokens("twitch-main")).not.toBeNull();
  });

  it("acknowledged revocation removes the record (absence = not connected)", async () => {
    const store = memoryTwitchStore();
    const { fetcher } = fixtureTwitchFetcher();
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });
    await session.disconnect();
    await session.acknowledgeRevocation();
    expect(await store.loadAccount("twitch-main")).toBeNull();
  });

  it("the credential port resolves opaque handles, never tokens", async () => {
    const store = memoryTwitchStore();
    const { fetcher } = fixtureTwitchFetcher();
    const session = new TwitchOAuthSession({
      store,
      internalAccountId: "twitch-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    session.startAuthorization({ redirectPort: 43113, state: "s1" });
    await session.completeAuthorization({ code: "c", state: "s1" });
    const port = session.credentialPort();
    const ref = await port.getToken(TWITCH_PROVIDER_ID, "twitch-main");
    expect(ref).toEqual({ handle: "twitch:twitch-main" });
    await expect(port.getToken("youtube", "twitch-main")).rejects.toBeInstanceOf(RequiresAuthError);
  });
});

// ---------------------------------------------------------------------------
// Catalog mapping (canonical §2.1)
// ---------------------------------------------------------------------------

describe("twitch catalog mapping (canonical §2.1)", () => {
  it("maps a live stream row into a live CatalogItem with the channel as the watch target", () => {
    const row = streamsFixture.data[0];
    const item = catalogItemFromStream(row);
    if (item === null) throw new Error("expected an item");
    expect(item.id).toBe("twitch:stream:twitch");
    expect(item.providerId).toBe(TWITCH_PROVIDER_ID);
    expect(item.mediaKind).toBe("live"); // the work order's mediaKind honesty
    expect(item.title).toBe(row.title);
    const external = item.metadata.externalIds as Record<string, Record<string, unknown>>;
    expect(external.twitch.userLogin).toBe("twitch");
    expect(external.twitch.streamId).toBe("50973264932");
    expect(external.twitch.userId).toBe("141981764");
    expect(item.metadata.gameName).toBe("Just Chatting");
    expect(item.metadata.viewerCount).toBe(8123);
    // The embed asset is the official player channel URL (parent applied at plan time).
    const embed = item.assets.find((asset) => asset.kind === "embed");
    expect(embed?.reference).toBe(`${TWITCH_PLAYER_URL}?channel=twitch`);
    // The thumbnail template is substituted with the officially documented mechanism.
    const thumb = item.assets.find((asset) => asset.kind === "thumbnail");
    expect(thumb?.reference).toContain("1280x720");
    expect(thumb?.reference).not.toContain("{width}");
    expect(item.metadata.thumbnailTemplate).toContain("{width}x{height}");
    expect(item.matchEvidence?.confidence).toBe(1);
    expect(item.availability).toBeUndefined(); // no fabricated facts
  });

  it("drops stream rows without a usable login (honest drop, never a guessed target)", () => {
    expect(catalogItemFromStream({ id: "1", user_id: "1", title: "no login" })).toBeNull();
    expect(catalogItemFromStream({ ...streamsFixture.data[0], user_login: "x" })).toBeNull();
  });

  it("maps a VOD row into a video CatalogItem and parses the Twitch duration format", () => {
    const item = catalogItemFromVideo(videosFixture.data[0]);
    if (item === null) throw new Error("expected an item");
    expect(item.mediaKind).toBe("video");
    expect(item.id).toBe("twitch:video:1973304310");
    const external = item.metadata.externalIds as Record<string, Record<string, unknown>>;
    expect(external.twitch.videoId).toBe("1973304310");
    expect(item.metadata.durationSeconds).toBe(3 * 3600 + 8 * 60 + 33); // "3h8m33s"
    expect(item.metadata.durationRaw).toBe("3h8m33s");
    expect(item.metadata.year).toBe(2026);
    const embed = item.assets.find((asset) => asset.kind === "embed");
    expect(embed?.reference).toBe(`${TWITCH_PLAYER_URL}?video=1973304310`);
  });

  it("parses Twitch durations honestly (and refuses garbage)", () => {
    expect(parseTwitchDurationSeconds("3h8m33s")).toBe(11313);
    expect(parseTwitchDurationSeconds("58m19s")).toBe(58 * 60 + 19);
    expect(parseTwitchDurationSeconds("45s")).toBe(45);
    expect(parseTwitchDurationSeconds("1h")).toBe(3600);
    expect(parseTwitchDurationSeconds("garbage")).toBeNull();
    expect(parseTwitchDurationSeconds(undefined)).toBeNull();
  });

  it("maps a clip row into a VIDEO CatalogItem (clips are horizontal videos — no invented kind)", () => {
    const item = catalogItemFromClip(clipsFixture.data[0]);
    if (item === null) throw new Error("expected an item");
    expect(item.mediaKind).toBe("video");
    expect(item.id).toBe("twitch:clip:EncouragingPlausibleGiraffeNomNom");
    expect(item.metadata.durationSeconds).toBe(30.2);
    const embed = item.assets.find((asset) => asset.kind === "embed");
    expect(embed?.reference).toBe(`${TWITCH_PLAYER_URL}?clip=EncouragingPlausibleGiraffeNomNom`);
  });

  it("users and games are browse CONTAINERS — descriptors, never items with invented kinds", () => {
    const channel = channelDescriptorFromUser(usersFixture.data[0]);
    expect(channel).toMatchObject({
      userId: "141981764",
      login: "twitch",
      displayName: "Twitch",
      broadcasterType: "partner",
    });
    const game = gameDescriptorsFromResponse(gamesTopFixture.data);
    expect(game).toHaveLength(3);
    expect(game[0]?.name).toBe("Just Chatting");
    expect(game[0]?.boxArtUrl).toContain("1280x720");
    // A game row can never produce a CatalogItem — there is nothing watchable.
    expect((game[0] as unknown as CatalogItem).providerId).toBeUndefined();
  });

  it("the watch-target bridge reads externalIds first, then embed assets", () => {
    const stream = catalogItemFromStream(streamsFixture.data[0])!;
    expect(twitchWatchTargetOf(stream)).toEqual({ kind: "channel", login: "twitch" });

    const video = catalogItemFromVideo(videosFixture.data[0])!;
    expect(twitchWatchTargetOf(video)).toEqual({ kind: "video", videoId: "1973304310" });

    const clip = catalogItemFromClip(clipsFixture.data[0])!;
    expect(twitchWatchTargetOf(clip)).toEqual({
      kind: "clip",
      clipId: "EncouragingPlausibleGiraffeNomNom",
    });

    // An item reduced to just its embed asset still resolves (asset fallback).
    const stripped: CatalogItem = {
      id: "twitch:stream:somechannel",
      providerId: TWITCH_PROVIDER_ID,
      title: "stripped",
      mediaKind: "live",
      metadata: {},
      assets: [
        {
          assetId: "twitch:embed:channel:somechannel",
          kind: "embed",
          reference: `${TWITCH_PLAYER_URL}?channel=somechannel`,
        },
      ],
    };
    expect(twitchWatchTargetOf(stripped)).toEqual({ kind: "channel", login: "somechannel" });
    expect(twitchWatchTargetOf({ ...stripped, providerId: "youtube" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Playback plans (official embed + the parent-parameter honesty)
// ---------------------------------------------------------------------------

describe("twitch playback plans (official-embed + REQUIRED parent)", () => {
  it("builds the channel plan with the parent pinned into the official player URL", () => {
    const plan = buildTwitchPlaybackPlan({
      target: { kind: "channel", login: "twitch" },
      parent: "localhost",
    });
    if (plan.kind !== "official-embed") throw new Error("expected official-embed");
    expect(plan.providerId).toBe(TWITCH_PROVIDER_ID);
    const spec = plan.embedSpec as {
      embedUrl: string;
      domain: string;
      iframe: { allowFullScreen: boolean };
      mechanism: { kind: string; parentParameter: string };
      notes: readonly string[];
    };
    expect(spec.embedUrl).toBe(`${TWITCH_PLAYER_URL}/?parent=localhost&channel=twitch`);
    expect(spec.domain).toBe("player.twitch.tv");
    expect(spec.iframe.allowFullScreen).toBe(true);
    expect(spec.mechanism).toMatchObject({
      kind: "official-embed-player",
      parentParameter: "localhost",
    });
    expect(spec.notes.join(" ")).toContain("errorCode=NoParent"); // the live-verified finding, recorded
  });

  it("builds video and clip plans on the same official surface", () => {
    const video = buildTwitchPlaybackPlan({
      target: { kind: "video", videoId: "1973304310" },
      parent: "app.webflix.local",
    });
    if (video.kind !== "official-embed") throw new Error("expected official-embed");
    expect(video.embedSpec.embedUrl).toBe(
      `${TWITCH_PLAYER_URL}/?parent=app.webflix.local&video=1973304310`,
    );
    const clip = buildTwitchPlaybackPlan({
      target: { kind: "clip", clipId: "EncouragingPlausibleGiraffeNomNom" },
      parent: "localhost",
    });
    if (clip.kind !== "official-embed") throw new Error("expected official-embed");
    expect(clip.embedSpec.embedUrl).toBe(
      `${TWITCH_PLAYER_URL}/?parent=localhost&clip=EncouragingPlausibleGiraffeNomNom`,
    );
  });

  it("REFUSES to build without a parent (live-verified NoParent finding — never a guessed origin)", () => {
    expect(() =>
      buildTwitchPlaybackPlan({ target: { kind: "channel", login: "twitch" }, parent: "" }),
    ).toThrowError(MissingTwitchParentError);
    expect(() =>
      buildTwitchPlaybackPlan({ target: { kind: "channel", login: "twitch" } } as never),
    ).toThrowError(MissingTwitchParentError);
  });

  it("REFUSES malformed parents (schemes, ports and paths are not hostnames)", () => {
    for (const parent of ["https://localhost", "localhost:8080", "localhost/path", "a b", "."]) {
      expect(() =>
        buildTwitchPlaybackPlan({ target: { kind: "channel", login: "twitch" }, parent }),
      ).toThrowError(MissingTwitchParentError);
    }
  });

  it("REFUSES malformed watch targets (never a broken player)", () => {
    expect(() =>
      buildTwitchPlaybackPlan({ target: { kind: "channel", login: "!!" }, parent: "localhost" }),
    ).toThrowError(InvalidTwitchWatchTargetError);
    expect(() =>
      buildTwitchPlaybackPlan({ target: { kind: "video", videoId: "abc" }, parent: "localhost" }),
    ).toThrowError(InvalidTwitchWatchTargetError);
    expect(() =>
      buildTwitchPlaybackPlan({
        target: { kind: "clip", clipId: "bad slug!" },
        parent: "localhost",
      }),
    ).toThrowError(InvalidTwitchWatchTargetError);
  });

  it("emits autoplay/muted only when explicitly set (documented optional params)", () => {
    const bare = buildTwitchPlaybackPlan({
      target: { kind: "channel", login: "twitch" },
      parent: "localhost",
    });
    if (bare.kind !== "official-embed") throw new Error("expected official-embed");
    expect(bare.embedSpec.embedUrl).not.toContain("autoplay");
    const configured = buildTwitchPlaybackPlan({
      target: { kind: "channel", login: "twitch" },
      parent: "localhost",
      autoplay: false,
      muted: true,
    });
    if (configured.kind !== "official-embed") throw new Error("expected official-embed");
    const url = configured.embedSpec.embedUrl;
    expect(url).toContain("autoplay=false");
    expect(url).toContain("muted=true");
  });
});

// ---------------------------------------------------------------------------
// Watch bridge (catalog item → canonical PlaybackPlan)
// ---------------------------------------------------------------------------

describe("twitch watch bridge (catalog item → canonical PlaybackPlan)", () => {
  const streamItem = catalogItemFromStream(streamsFixture.data[0])!;

  it("foreign items are honestly unsupported (open settings)", () => {
    const plan = playbackPlanForTwitchCatalogItem({
      id: "youtube:video:abc",
      providerId: "youtube",
      title: "foreign",
      mediaKind: "video",
      metadata: {},
      assets: [],
    });
    expect(plan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (plan.kind !== "unavailable") throw new Error("unreachable");
    expect(plan.recovery?.action).toBe("open-system-settings");
  });

  it("items without a watch target are honestly unsupported (open the provider app)", () => {
    const plan = playbackPlanForTwitchCatalogItem({
      id: "twitch:stream:x",
      providerId: TWITCH_PROVIDER_ID,
      title: "no target",
      mediaKind: "live",
      metadata: {},
      assets: [],
    });
    expect(plan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (plan.kind !== "unavailable") throw new Error("unreachable");
    expect(plan.recovery?.action).toBe("open-provider-app");
  });

  it("a live item resolves to the official player with the caller-declared parent", () => {
    const plan = playbackPlanForTwitchCatalogItem(streamItem, { parent: "app.webflix.local" });
    if (plan.kind !== "official-embed") throw new Error("expected official-embed");
    expect(plan.embedSpec.embedUrl).toBe(
      `${TWITCH_PLAYER_URL}/?parent=app.webflix.local&channel=twitch`,
    );
  });

  it("the dev-time default parent is the documented localhost origin (production overrides explicitly)", () => {
    const plan = playbackPlanForTwitchCatalogItem(streamItem);
    if (plan.kind !== "official-embed") throw new Error("expected official-embed");
    expect(plan.embedSpec.embedUrl).toContain(`parent=${TWITCH_DEV_PARENT}`);
    expect(TWITCH_DEV_PARENT).toBe("localhost");
  });
});

// ---------------------------------------------------------------------------
// Service: browse paths + honest-state mapping
// ---------------------------------------------------------------------------

describe("twitch service: browse paths + honest-state mapping", () => {
  it("browseLiveStreams returns canonical items + the header-based budget", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/streams`),
        respond: () => jsonResponse(streamsFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const page = await browseLiveStreams(helixClient(fetch), { gameId: "509658" });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.mediaKind).toBe("live");
    expect(page.after).toBe(streamsFixture.pagination.cursor);
    expect(page.budget.bucketLimit).toBe(800);
    expect(page.budget.basis).toContain("Ratelimit");
  });

  it("browseTopGames returns category descriptors (browse containers, not items)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/games/top`),
        respond: () => jsonResponse(gamesTopFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const page = await browseTopGames(helixClient(fetch));
    expect(page.descriptors).toHaveLength(3);
    expect(page.descriptors[0]?.name).toBe("Just Chatting");
  });

  it("lookupChannel resolves a channel descriptor through users.read", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TWITCH_API_BASE}/users`),
        respond: () => jsonResponse(usersFixture, { headers: RATE_HEADERS }),
      },
    ]);
    const channel = await lookupChannel(helixClient(fetch), { login: "twitch" });
    expect(channel?.displayName).toBe("Twitch");
    expect(channel?.broadcasterType).toBe("partner");
  });

  it("followedChannels needs a user-token client — the honest requires-auth path", async () => {
    const appOnly = helixClient(fixtureFetch([]));
    const error = await followedChannels(appOnly, { broadcasterUserId: "71092938" }).catch(
      (err: unknown) => err,
    );
    expect(twitchCapabilityFromError(error)).toMatchObject({ status: "requires-auth" });
  });

  it("maps every typed error onto the frozen honesty vocabulary", () => {
    expect(
      twitchCapabilityFromError(
        new TwitchMissingCredentialError({ operationId: "streams.live", message: "no token" }),
      ),
    ).toMatchObject({ status: "requires-auth" });
    expect(
      twitchCapabilityFromError(
        new TwitchRequiresAuthError({ operationId: "users.read", message: "401", status: 401 }),
      ),
    ).toMatchObject({ status: "requires-auth" });
    expect(
      twitchCapabilityFromError(
        new TwitchNotFoundError({ operationId: "videos.list", message: "404", status: 404 }),
      ),
    ).toMatchObject({ status: "unavailable" });
    expect(twitchCapabilityFromError(new Error("something unexpected"))).toMatchObject({
      status: "unknown",
    });
  });
});

// ---------------------------------------------------------------------------
// Honest-unsupported rows → WebFlix-local substitutes (work order row 4)
// ---------------------------------------------------------------------------

describe("twitch honest-unsupported rows: WebFlix-local substitutes", () => {
  it("every unsupported manifest row has exactly one substitute/handoff entry (totality)", () => {
    expect(() => assertTwitchSubstitutesCoverManifest()).not.toThrow();
    const unsupportedCount = Object.values(twitchManifest.operations).filter(
      (op) => op.status === "unsupported",
    ).length;
    expect(TWITCH_UNSUPPORTED_SUBSTITUTES).toHaveLength(unsupportedCount);
  });

  it("local substitutes exist only for the WebFlix-owned store rows", () => {
    expect(twitchSubstituteFor("history.provider")?.substitute).toBe("webflix-local-history");
    expect(twitchSubstituteFor("recommendations.browse")?.substitute).toBe("webflix-local-library");
    // The operator/gated surfaces carry NO substitute — handoff only.
    expect(twitchSubstituteFor("chat.read")?.substitute).toBe("none");
    expect(twitchSubstituteFor("bits.value")?.substitute).toBe("none");
    expect(twitchSubstituteFor("subscriptions.value")?.substitute).toBe("none");
    expect(twitchSubstituteFor("stream-key.read")?.substitute).toBe("none");
    for (const row of TWITCH_UNSUPPORTED_SUBSTITUTES) {
      expect(row.handoffNote.length).toBeGreaterThan(0);
      expect(row.substitute === "none" || row.substitute.startsWith("webflix-local")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-package seams (connectors suite — YOUTUBE-EXPAND / TIKTOK-CONNECT precedent)
// ---------------------------------------------------------------------------

describe("twitch items feed the canonical catalog merge (end-to-end seam)", () => {
  it("mapped Twitch items merge by provider-native evidence without duplicates", async () => {
    const { mergeCatalogInto } = await import("catalog");
    const item = catalogItemFromStream(streamsFixture.data[0])!;
    const result = mergeCatalogInto([item], [item]);
    expect(result.items).toHaveLength(1);
    expect(result.report.deduped).toBe(1);
    expect(result.report.created).toBe(0);
  });

  it("the Twitch connector shape resolves through the playback resolver seam (proven in the playback suite — structural twin here)", () => {
    // architecture-policy keeps connectors from depending on playback: the
    // playback package's own suite runs the resolver against the structural
    // twin of TWITCH_PLAYBACK_CONNECTOR (precedent); this side asserts the
    // constant's fields match what that lane resolves.
    const template = TWITCH_PLAYBACK_CONNECTOR.embed.urlTemplate;
    expect(template.replace("{mediaId}", encodeURIComponent("twitch"))).toBe(
      `${TWITCH_PLAYER_URL}/?channel=twitch&parent=${TWITCH_DEV_PARENT}`,
    );
    expect(TWITCH_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(true);
    expect(TWITCH_PLAYBACK_CONNECTOR.version).toBe(TWITCH_MANIFEST_VERSION);
    expect(TWITCH_PLAYBACK_CONNECTOR.providerId).toBe(TWITCH_PROVIDER_ID);
  });
});
