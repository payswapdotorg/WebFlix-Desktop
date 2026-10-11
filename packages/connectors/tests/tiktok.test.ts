/**
 * Fixture-only test-suite for the TikTok connector (TIKTOK-CONNECT, Phase 3
 * opener) — the second platform on the exact frozen §2 contracts YouTube
 * uses. No live calls, no real credentials: the network boundary is an
 * injected fetch backed by packages/connectors/fixtures/tiktok.
 *
 * Live-captured shapes this suite replays (recorded 2026-10-11 from the
 * work-order sandbox — see the parity matrix live-smoke section):
 *   - Display API unauthenticated: HTTP 401, application/json,
 *     {"data":{},"error":{"code":"access_token_invalid","message":"The
 *     access token is invalid or not found in the request.","log_id":…}}
 *   - Regional geo-redirect: www.tiktok.com surfaces answer
 *     302 → https://www.tiktok.com/hk/about from Hong Kong egress (same
 *     result with a browser User-Agent); a followed fetch lands on the HTML
 *     about page (200, text/html) instead of the API payload.
 */
import { describe, expect, it } from "vitest";

import {
  buildTikTokAuthorizationRequest,
  buildTikTokPlaybackPlan,
  canonicalTikTokVideoUrl,
  catalogItemFromDisplayVideo,
  catalogItemFromOembed,
  createDefaultRegistry,
  InvalidTikTokUrlError,
  InvalidTikTokVideoIdError,
  parseTikTokVideoUrl,
  playbackPlanForTikTokCatalogItem,
  RequiresAuthError,
  RefreshFailedError,
  resolveTikTokVideo,
  StateMismatchError,
  tikTokAccountInfo,
  tikTokCapabilityFromError,
  tikTokSubstituteFor,
  tikTokVideoIdOf,
  TikTokDisplayApiClient,
  TikTokMissingCredentialError,
  TikTokNotFoundError,
  TikTokOembedClient,
  TikTokOAuthSession,
  TikTokRateLimitedError,
  TikTokRegionUnavailableError,
  TikTokRequiresAuthError,
  TIKTOK_API_BASE,
  TIKTOK_DISPLAY_NAME,
  TIKTOK_EMBED_URL_PREFIX,
  TIKTOK_LOGIN_KIT_CLIENT_KEY,
  TIKTOK_MANIFEST_VERSION,
  TIKTOK_OBSERVED_UNAVAILABLE_REGIONS,
  TIKTOK_OEMBED_ENDPOINT,
  TIKTOK_OPERATION_PROVENANCE,
  TIKTOK_OAUTH_SCOPES,
  TIKTOK_PLAYBACK_CONNECTOR,
  TIKTOK_PROVIDER_ID,
  TIKTOK_RATE_WINDOW_MS,
  TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE,
  TIKTOK_UNSUPPORTED_SUBSTITUTES,
  assertTikTokSubstitutesCoverManifest,
  myTikTokVideos,
  tiktokManifest,
  type CatalogItem,
  type ConnectorManifest,
  type ProviderAccountRecord,
  type TikTokFetchLike,
  type TikTokFetchResponseLike,
  type TikTokStoredTokens,
  type TikTokTokenFetcher,
} from "../src";

import oembedVideoFixture from "../fixtures/tiktok/oembed.video.json";
import userInfoFixture from "../fixtures/tiktok/display.user.info.json";
import videoListFixture from "../fixtures/tiktok/display.video.list.json";
import accessTokenInvalidFixture from "../fixtures/tiktok/error.access_token_invalid.json";
import rateLimitExceededFixture from "../fixtures/tiktok/error.rate_limit_exceeded.json";
import tokenSuccessFixture from "../fixtures/tiktok/oauth.token.success.json";
import tokenRefreshFixture from "../fixtures/tiktok/oauth.token.refresh.json";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");

/** The official doc example video — the same id used for the live checks. */
const DOC_VIDEO_URL = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const DOC_VIDEO_ID = "6718335390845095173";

/** The live-captured regional landing page (followed 302 from HK egress). */
const HK_ABOUT_HTML =
  '<!DOCTYPE html><html lang="en" dir="ltr"><head><title>TikTok</title></head><body></body></html>';

// ---------------------------------------------------------------------------
// Fixture helpers (all network is injected; nothing leaves the process)
// ---------------------------------------------------------------------------

interface TikTokFixtureInit {
  status?: number;
  headers?: Record<string, string>;
}

function jsonResponse(body: unknown, init: TikTokFixtureInit = {}): TikTokFetchResponseLike {
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

function htmlResponse(html: string, init: TikTokFixtureInit = {}): TikTokFetchResponseLike {
  const status = init.status ?? 200;
  const headers = init.headers ?? {};
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON"); // the landing page is HTML
    },
    text: async () => html,
  };
}

function redirectResponse(location: string): TikTokFetchResponseLike {
  return {
    ok: false,
    status: 302,
    statusText: "Found",
    headers: { get: (name) => (name.toLowerCase() === "location" ? location : null) },
    json: async () => {
      throw new SyntaxError("no body on a redirect");
    },
    text: async () => "",
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
  ) => TikTokFetchResponseLike;
}

function fixtureFetch(routes: Route[]): TikTokFetchLike & {
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
  }) as TikTokFetchLike & {
    calls: string[];
    inits: Array<{ method?: string; headers?: Record<string, string>; body?: string }>;
  };
  fetchFn.calls = calls;
  fetchFn.inits = inits;
  return fetchFn;
}

const FIXED_TOKEN_PROVIDER = { getAccessToken: async () => "act.FIXTURE-TIKTOK-TOKEN" };

function memoryTikTokStore() {
  const accounts = new Map<string, ProviderAccountRecord>();
  const vault = new Map<string, TikTokStoredTokens>();
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
    async saveTokens(id: string, tokens: TikTokStoredTokens) {
      vault.set(id, tokens);
    },
    async removeTokens(id: string) {
      vault.delete(id);
    },
  };
}

function fixtureTikTokFetcher(options: { refreshRejectedCode?: string } = {}) {
  const counts = { exchange: 0, refresh: 0 };
  const fetcher: TikTokTokenFetcher = async (request) => {
    if (request.kind === "token-exchange") {
      counts.exchange += 1;
      return { kind: "token", token: tokenSuccessFixture.data };
    }
    counts.refresh += 1;
    if (options.refreshRejectedCode !== undefined) {
      return {
        kind: "rejected",
        code: options.refreshRejectedCode,
        message: `fixture: refresh rejected (${options.refreshRejectedCode})`,
      };
    }
    return { kind: "token", token: tokenRefreshFixture.data };
  };
  return { fetcher, counts };
}

// ---------------------------------------------------------------------------
// Manifest honesty (frozen §2.3 + the work order's honesty gates)
// ---------------------------------------------------------------------------

describe("tiktok manifest honesty (frozen §2.3 + AUDIT-SOURCES §5)", () => {
  it("registers in the default registry alongside youtube (second platform, same contracts; twitch joined at TWITCH-CONNECT, instagram at INSTAGRAM-CONNECT)", () => {
    const registry = createDefaultRegistry();
    expect(registry.require("tiktok")).toBe(tiktokManifest);
    expect(registry.has("youtube")).toBe(true);
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
    expect(Object.keys(tiktokManifest.operations).length).toBeGreaterThan(0);
    for (const [operationId, capability] of Object.entries(tiktokManifest.operations)) {
      expect(operationId).toMatch(operationIdPattern);
      expect(legal).toContain(capability.status);
      expect((capability.detail ?? "").length).toBeGreaterThan(0);
    }
  });

  it("every unsupported row explains itself (registry honesty rule)", () => {
    for (const [operationId, capability] of Object.entries(tiktokManifest.operations)) {
      if (capability.status === "unsupported") {
        expect(capability.detail, operationId).toBeTruthy();
        expect((capability.detail ?? "").length).toBeGreaterThan(40);
      }
    }
  });

  it("carries the honest operation split: 1 public read, 2 requires-auth reads, and the honest-unsupported tail", () => {
    const statuses = Object.values(tiktokManifest.operations).map((op) => op.status);
    expect(statuses.filter((s) => s === "supported")).toHaveLength(1);
    expect(tiktokManifest.operations["oembed.resolve"]?.status).toBe("supported");
    expect(tiktokManifest.operations["user.info"]?.status).toBe("requires-auth");
    expect(tiktokManifest.operations["video.list"]?.status).toBe("requires-auth");
    // No public search API — the work-order's headline honest-unsupported row.
    expect(tiktokManifest.operations["search.query"]?.status).toBe("unsupported");
    expect(statuses.filter((s) => s === "unsupported").length).toBeGreaterThanOrEqual(9);
  });

  it("models the UNVERIFIED rate report honestly in the quotas envelope", () => {
    expect(tiktokManifest.quotas).toEqual({
      requestsPerWindow: TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE,
      windowMs: TIKTOK_RATE_WINDOW_MS,
    });
    expect(TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(TIKTOK_RATE_WINDOW_MS).toBe(60_000);
  });

  it("claims no served regions (honest empty list) and records the observed HK exclusion as connector-local data", () => {
    expect(tiktokManifest.regions).toEqual([]);
    const hk = TIKTOK_OBSERVED_UNAVAILABLE_REGIONS.find((note) => note.region === "HK");
    expect(hk).toBeDefined();
    expect(hk?.observation).toContain("https://www.tiktok.com/hk/about");
  });

  it("cites an official source for every operation (audit trail)", () => {
    for (const operationId of Object.keys(tiktokManifest.operations)) {
      const citations = TIKTOK_OPERATION_PROVENANCE[operationId];
      expect(citations, operationId).toBeDefined();
      expect(citations.length).toBeGreaterThan(0);
      for (const citation of citations) {
        expect(citation.url.length).toBeGreaterThan(0);
      }
    }
  });

  it("declares the region failure mode (live-verified necessity) and no publish scope", () => {
    expect(tiktokManifest.failureModes).toContain("region");
    expect(TIKTOK_OAUTH_SCOPES).toEqual(["user.info.basic", "user.info.profile", "video.list"]);
    expect(TIKTOK_OAUTH_SCOPES.join(",")).not.toContain("publish");
    for (const citation of Object.values(TIKTOK_OPERATION_PROVENANCE).flat()) {
      expect((citation.label ?? "").length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// oEmbed client (public, no auth — the discovery surface)
// ---------------------------------------------------------------------------

describe("tiktok oembed client (public, no auth)", () => {
  it("parses canonical URLs and rejects everything else before any I/O", async () => {
    const parts = parseTikTokVideoUrl(DOC_VIDEO_URL);
    expect(parts).toEqual({
      username: "scout2015",
      videoId: DOC_VIDEO_ID,
      canonicalUrl: DOC_VIDEO_URL,
    });
    expect(parseTikTokVideoUrl(`${DOC_VIDEO_URL}/`)?.videoId).toBe(DOC_VIDEO_ID);
    expect(canonicalTikTokVideoUrl("scout2015", DOC_VIDEO_ID)).toBe(DOC_VIDEO_URL);
    // Short links, other hosts, and garbage are honestly refused.
    expect(parseTikTokVideoUrl("https://vm.tiktok.com/ZMabcdefg/")).toBeNull();
    expect(parseTikTokVideoUrl("https://example.com/@a/video/1234567890")).toBeNull();
    expect(parseTikTokVideoUrl("not a url")).toBeNull();
    await expect(
      new TikTokOembedClient().resolveVideo("https://vm.tiktok.com/ZMabcdefg/"),
    ).rejects.toThrow(InvalidTikTokUrlError);
  });

  it("resolves a canonical URL with NO credentials (public surface)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
        respond: () => jsonResponse(oembedVideoFixture),
      },
    ]);
    const client = new TikTokOembedClient({ fetchImpl: fetch });
    const payload = await client.resolveVideo(DOC_VIDEO_URL);
    expect(fetch.calls[0]).toBe(
      `${TIKTOK_OEMBED_ENDPOINT}?url=${encodeURIComponent(DOC_VIDEO_URL)}`,
    );
    // No Authorization header — the surface is public; sending one would be
    // invented protocol behavior.
    expect(fetch.inits[0]?.headers).toEqual({});
    expect(payload.title).toContain("Scout and Suki");
    expect(payload.html).toContain("https://www.tiktok.com/embed.js");
  });

  it("surfaces the LIVE-CAPTURED regional geo-redirect as an honest typed error (302 shape)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
        respond: () => redirectResponse("https://www.tiktok.com/hk/about"),
      },
    ]);
    const client = new TikTokOembedClient({ fetchImpl: fetch });
    const error = await client.resolveVideo(DOC_VIDEO_URL).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TikTokRegionUnavailableError);
    expect((error as TikTokRegionUnavailableError).message).toContain("hk/about");
    expect((error as TikTokRegionUnavailableError).operationId).toBe("oembed.resolve");
  });

  it("surfaces the followed geo-redirect landing page as the same honest typed error (200-HTML shape)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
        respond: () => htmlResponse(HK_ABOUT_HTML),
      },
    ]);
    const client = new TikTokOembedClient({ fetchImpl: fetch });
    const error = await client.resolveVideo(DOC_VIDEO_URL).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TikTokRegionUnavailableError);
    expect((error as TikTokRegionUnavailableError).message).toContain("HTML");
  });

  it("is honest about not-found and about non-video oEmbed payloads", async () => {
    const notFound = new TikTokOembedClient({
      fetchImpl: fixtureFetch([
        {
          match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
          respond: () => jsonResponse({ error: "not found" }, { status: 404 }),
        },
      ]),
    });
    await expect(notFound.resolveVideo(DOC_VIDEO_URL)).rejects.toBeInstanceOf(TikTokNotFoundError);

    const photo = new TikTokOembedClient({
      fetchImpl: fixtureFetch([
        {
          match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
          respond: () => jsonResponse({ ...oembedVideoFixture, type: "photo" }),
        },
      ]),
    });
    // Non-video payload: refused rather than mapped with an invented kind.
    await expect(photo.resolveVideo(DOC_VIDEO_URL)).rejects.toThrow(/type "photo"/);
  });
});

// ---------------------------------------------------------------------------
// Display API client (per-user, Bearer; rate/ledger honesty)
// ---------------------------------------------------------------------------

describe("tiktok display api client (user.info + video.list, Bearer)", () => {
  it("refuses calls without a token (honest requires-auth, nothing reaches the network)", async () => {
    const fetch = fixtureFetch([]);
    const client = new TikTokDisplayApiClient({ fetchImpl: fetch });
    await expect(client.getUserInfo()).rejects.toBeInstanceOf(TikTokMissingCredentialError);
    await expect(client.getVideoList()).rejects.toBeInstanceOf(TikTokMissingCredentialError);
    expect(fetch.calls).toHaveLength(0);
  });

  it("reads the authorized profile via user.info with a Bearer token", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/user/info/`),
        respond: () => jsonResponse(userInfoFixture),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    const user = await client.getUserInfo();
    expect(fetch.inits[0]?.headers?.Authorization).toBe(
      `Bearer ${await FIXED_TOKEN_PROVIDER.getAccessToken()}`,
    );
    expect(fetch.calls[0]).toContain("fields=");
    expect(user.display_name).toBe("Fixture TikTok Creator");
    expect(user.open_id).toBeDefined();
    expect(client.getLedger()).toHaveLength(1);
    expect(client.getLedger()[0]?.outcome).toBe("success");
  });

  it("reads the account's own videos via video.list (POST + JSON body + query fields)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/video/list/`),
        respond: () => jsonResponse(videoListFixture),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    const data = await client.getVideoList({ cursor: 1734900000000, maxCount: 20 });
    expect(fetch.inits[0]?.method).toBe("POST");
    expect(fetch.inits[0]?.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(fetch.inits[0]?.body ?? "{}")).toEqual({
      cursor: 1734900000000,
      max_count: 20,
    });
    expect(fetch.calls[0]).toContain(`${TIKTOK_API_BASE}/video/list/?fields=`);
    expect(data.videos).toHaveLength(2);
    expect(data.has_more).toBe(true);
  });

  it("enforces the official max_count bound (1..20) before any I/O", async () => {
    const client = new TikTokDisplayApiClient({
      fetchImpl: fixtureFetch([]),
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
    });
    await expect(client.getVideoList({ maxCount: 21 })).rejects.toThrow(/1\.\.20/);
    await expect(client.getVideoList({ maxCount: 0 })).rejects.toThrow(/1\.\.20/);
  });

  it("replays the LIVE-CAPTURED unauthenticated envelope as an honest requires-auth error", async () => {
    // Verbatim capture from 2026-10-11: HTTP 401, application/json,
    // {"data":{},"error":{"code":"access_token_invalid",…}}.
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/user/info/`),
        respond: () => jsonResponse(accessTokenInvalidFixture, { status: 401 }),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: { getAccessToken: async () => "act.EXPIRED-FIXTURE-TOKEN" },
      clock: () => NOW,
    });
    const error = await client.getUserInfo().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TikTokRequiresAuthError);
    expect((error as TikTokRequiresAuthError).code).toBe("access_token_invalid");
    expect((error as TikTokRequiresAuthError).message).toBe(
      "The access token is invalid or not found in the request.",
    );
    expect((error as TikTokRequiresAuthError).logId).toBe("20261011043236273A06A1F93F5D6A9A59");
    // The provider's own log_id rides along for support traceability.
    expect(client.getLedger()[0]?.outcome).toBe("provider-error");
  });

  it("surfaces the provider's rate signal honestly (rate_limit_exceeded + Retry-After)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/video/list/`),
        respond: () =>
          jsonResponse(rateLimitExceededFixture, {
            status: 429,
            headers: { "retry-after": "30" },
          }),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    const error = await client.getVideoList().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TikTokRateLimitedError);
    expect((error as TikTokRateLimitedError).retryAfterSeconds).toBe(30);
    const budget = client.getRateBudget();
    expect(budget.state).toBe("provider-rate-limited");
    expect(budget.providerReportedRateLimit).toBe(true);
    expect(budget.retryAfterSeconds).toBe(30);
  });

  it("NEVER pre-flight blocks on the unverified rate figure (no invented ceiling)", async () => {
    // provisionalLimitPerMinute = 2, then 5 successful calls: every one goes
    // to the wire. The unverified third-party number is observability data,
    // not a block reason — the provider's envelopes are the only authority.
    let served = 0;
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/user/info/`),
        respond: () => {
          served += 1;
          return jsonResponse(userInfoFixture);
        },
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      provisionalLimitPerMinute: 2,
      clock: () => NOW,
    });
    for (let i = 0; i < 5; i += 1) {
      await client.getUserInfo(["open_id"]);
    }
    expect(served).toBe(5);
    expect(client.getRateBudget().usedInWindow).toBe(5);
    expect(client.getRateBudget().provisionalLimitPerMinute).toBe(2);
    expect(client.getRateBudget().basis).toContain("UNVERIFIED");
    expect(client.getRateBudget().state).toBe("ok");
  });

  it("refuses to fabricate data when the envelope says ok but carries no data object", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/user/info/`),
        respond: () => jsonResponse({ data: {}, error: { code: "ok", message: "" } }),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    await expect(client.getUserInfo()).rejects.toThrow(/no user object/);
  });
});

// ---------------------------------------------------------------------------
// Catalog mapping (canonical §2.1 CatalogItems)
// ---------------------------------------------------------------------------

describe("tiktok catalog mapping (canonical §2.1)", () => {
  const parts = parseTikTokVideoUrl(DOC_VIDEO_URL)!;

  it("maps an oEmbed payload to a provider-attributed CatalogItem (no fabricated fields)", () => {
    const item = catalogItemFromOembed(oembedVideoFixture, parts)!;
    expect(item.id).toBe(`tiktok:video:${DOC_VIDEO_ID}`);
    expect(item.providerId).toBe(TIKTOK_PROVIDER_ID);
    expect(item.title).toContain("Scout and Suki");
    // TikTok is the canonical short-form platform: mediaKind "short".
    expect(item.mediaKind).toBe("short");
    expect(item.metadata.externalIds).toEqual({ tiktok: DOC_VIDEO_ID });
    expect(item.metadata.authorName).toBe("scout2015");
    // Embed asset = the official embed player; thumbnail = the official CDN.
    const embed = item.assets.find((asset) => asset.kind === "embed")!;
    expect(embed.reference).toBe(`${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`);
    const thumb = item.assets.find((asset) => asset.kind === "thumbnail")!;
    expect(thumb.reference).toContain("tiktokcdn.com");
    // Provider-native evidence, confidence 1 (the provider's own record).
    expect(item.matchEvidence?.confidence).toBe(1);
    // NO availability fact: the provider reports no per-item region data.
    expect(item.availability).toBeUndefined();
  });

  it("drops payloads without a usable numeric video id instead of guessing", () => {
    const bad = catalogItemFromOembed(oembedVideoFixture, {
      username: "scout2015",
      videoId: "not-numeric",
      canonicalUrl: DOC_VIDEO_URL,
    });
    expect(bad).toBeNull();
  });

  it("maps a Display API video.list row with its official metadata", () => {
    const row = videoListFixture.data.videos[0];
    const item = catalogItemFromDisplayVideo(row)!;
    expect(item.id).toBe(`tiktok:video:${row.id}`);
    expect(item.providerId).toBe(TIKTOK_PROVIDER_ID);
    expect(item.mediaKind).toBe("short");
    expect(item.metadata.externalIds).toEqual({ tiktok: row.id });
    expect(item.metadata.description).toBe(row.video_description);
    expect(item.metadata.durationSeconds).toBe(row.duration);
    expect(item.metadata.providerEmbedLink).toBe(row.embed_link);
    expect(item.metadata.year).toBe(2024); // create_time 1735000000 → 2024-12-24
    const embed = item.assets.find((asset) => asset.kind === "embed")!;
    expect(embed.reference).toBe(`${TIKTOK_EMBED_URL_PREFIX}${row.id}`);
  });

  it("bridges the catalog→watch id: metadata first, then embed asset, then assetId", () => {
    const item = catalogItemFromOembed(oembedVideoFixture, parts)!;
    expect(tikTokVideoIdOf(item)).toBe(DOC_VIDEO_ID);
    const embedOnly: CatalogItem = {
      ...item,
      metadata: {},
      assets: [
        {
          assetId: `tiktok:embed:${DOC_VIDEO_ID}`,
          kind: "embed",
          reference: `${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`,
        },
      ],
    };
    expect(tikTokVideoIdOf(embedOnly)).toBe(DOC_VIDEO_ID);
    const assetIdOnly: CatalogItem = {
      ...item,
      metadata: {},
      assets: [{ assetId: `tiktok:embed:${DOC_VIDEO_ID}`, kind: "embed", reference: "" }],
    };
    expect(tikTokVideoIdOf(assetIdOnly)).toBe(DOC_VIDEO_ID);
    // Foreign or id-less items honestly return null.
    expect(tikTokVideoIdOf({ ...item, providerId: "youtube" })).toBeNull();
    expect(tikTokVideoIdOf({ ...item, metadata: {}, assets: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Playback (official embed — the §2.2 official-embed plan)
// ---------------------------------------------------------------------------

describe("tiktok playback plans (official-embed)", () => {
  it("builds the official embed player plan (same frozen shape as YouTube's)", () => {
    const plan = buildTikTokPlaybackPlan({ videoId: DOC_VIDEO_ID, title: "Fixture title" });
    if (plan.kind !== "official-embed") throw new Error("expected an official-embed plan");
    expect(plan.providerId).toBe(TIKTOK_PROVIDER_ID);
    const spec = plan.embedSpec as {
      videoId: string;
      embedUrl: string;
      domain: string;
      iframe: { width: number; height: number; allow: string; allowFullScreen: boolean };
      mechanism: { kind: string; documentedAlternative: string };
      notes: string[];
    };
    expect(spec.videoId).toBe(DOC_VIDEO_ID);
    expect(spec.embedUrl).toBe(`${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`);
    expect(spec.domain).toBe("tiktok.com");
    // Portrait player (the official oEmbed example dimensions).
    expect(spec.iframe.width).toBe(325);
    expect(spec.iframe.height).toBe(580);
    expect(spec.iframe.allowFullScreen).toBe(true);
    // The documented blockquote + embed.js mechanism is recorded, and the
    // plan points at the identical official player URL that mechanism renders.
    expect(spec.mechanism.kind).toBe("official-embed-player");
    expect(spec.mechanism.documentedAlternative).toContain("tiktok-embedded-video");
    expect(spec.mechanism.documentedAlternative).toContain("https://www.tiktok.com/embed.js");
    expect(spec.notes.join(" ")).toContain("official");
    // No player parameters exist in TikTok's official embed — none emitted.
    expect(spec.embedUrl.indexOf("?")).toBe(-1);
  });

  it("refuses invalid video ids (never a guessed embed URL)", () => {
    expect(() => buildTikTokPlaybackPlan({ videoId: "abc" })).toThrow(InvalidTikTokVideoIdError);
    expect(() => buildTikTokPlaybackPlan({ videoId: "" })).toThrow(InvalidTikTokVideoIdError);
  });

  it("answers the honest regionally-unavailable plan for observed-excluded regions", () => {
    const plan = buildTikTokPlaybackPlan({ videoId: DOC_VIDEO_ID, userRegion: "HK" });
    expect(plan).toMatchObject({ kind: "unavailable", reason: "region" });
    if (plan.kind !== "unavailable") throw new Error("unreachable");
    expect(plan.recovery?.action).toBe("change-region");
    expect(plan.recovery?.message).toContain("HK");
    // An unobserved region does not get a fabricated exclusion.
    const usPlan = buildTikTokPlaybackPlan({ videoId: DOC_VIDEO_ID, userRegion: "US" });
    expect(usPlan.kind).toBe("official-embed");
  });
});

describe("tiktok watch bridge (catalog item → canonical PlaybackPlan)", () => {
  const parts = parseTikTokVideoUrl(DOC_VIDEO_URL)!;

  it("resolves a mapped oEmbed item end to end: link → oEmbed → CatalogItem → official-embed plan", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(TIKTOK_OEMBED_ENDPOINT),
        respond: () => jsonResponse(oembedVideoFixture),
      },
    ]);
    const oembed = new TikTokOembedClient({ fetchImpl: fetch });
    const resolved = await resolveTikTokVideo(oembed, DOC_VIDEO_URL);
    expect(resolved.canonicalUrl).toBe(DOC_VIDEO_URL);

    const plan = playbackPlanForTikTokCatalogItem(resolved.item);
    if (plan.kind !== "official-embed") throw new Error("expected an official-embed plan");
    // The exact key the shell WatchScreen renders (§2.2 embedSpec.embedUrl).
    expect((plan.embedSpec as { embedUrl: string }).embedUrl).toBe(
      `${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`,
    );
  });

  it("is total and honest: non-TikTok and id-less items become truthful unavailable plans", () => {
    const foreign: CatalogItem = {
      id: "other:1",
      providerId: "somebody-else",
      title: "Not ours",
      mediaKind: "video",
      assets: [],
      metadata: {},
    };
    const foreignPlan = playbackPlanForTikTokCatalogItem(foreign);
    expect(foreignPlan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (foreignPlan.kind !== "unavailable") throw new Error("unreachable");
    expect(foreignPlan.recovery?.action).toBe("open-system-settings");

    const idLess: CatalogItem = {
      id: "tiktok:video:none",
      providerId: TIKTOK_PROVIDER_ID,
      title: "No video id",
      mediaKind: "short",
      assets: [],
      metadata: {},
    };
    const idLessPlan = playbackPlanForTikTokCatalogItem(idLess);
    expect(idLessPlan).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (idLessPlan.kind !== "unavailable") throw new Error("unreachable");
    expect(idLessPlan.recovery?.action).toBe("open-provider-app");
  });

  it("carries the regional honesty through the bridge (HK viewer → unavailable{region})", () => {
    const item = catalogItemFromOembed(oembedVideoFixture, parts)!;
    const plan = playbackPlanForTikTokCatalogItem(item, { userRegion: "hk" });
    expect(plan).toMatchObject({ kind: "unavailable", reason: "region" });
  });

  it("exposes the structural adapter for the playback resolver seam", () => {
    expect(TIKTOK_PLAYBACK_CONNECTOR.providerId).toBe(TIKTOK_PROVIDER_ID);
    expect(TIKTOK_PLAYBACK_CONNECTOR.version).toBe(TIKTOK_MANIFEST_VERSION);
    expect(TIKTOK_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(true);
    expect(TIKTOK_PLAYBACK_CONNECTOR.embed.urlTemplate).toBe(
      "https://www.tiktok.com/embed/v2/{mediaId}",
    );
    const resolved = TIKTOK_PLAYBACK_CONNECTOR.embed.urlTemplate.replace(
      "{mediaId}",
      encodeURIComponent(DOC_VIDEO_ID),
    );
    expect(resolved).toBe(`${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`);
  });
});

// ---------------------------------------------------------------------------
// Login Kit OAuth (loopback + PKCE, fixture-tested)
// ---------------------------------------------------------------------------

describe("tiktok login kit oauth (loopback + PKCE, fixture-tested)", () => {
  it("builds the authorization URL with the TikTok parameter set (and NO Google params)", () => {
    const request = buildTikTokAuthorizationRequest({
      redirectPort: 48151,
      state: "fixture-state",
      pkce: {
        codeVerifier: "fixture-verifier",
        codeChallenge: "fixture-challenge",
        codeChallengeMethod: "S256",
      },
    });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe(TIKTOK_LOGIN_KIT_CLIENT_KEY);
    expect(url.searchParams.get("scope")).toBe(TIKTOK_OAUTH_SCOPES.join(","));
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:48151/oauth/callback");
    expect(url.searchParams.get("state")).toBe("fixture-state");
    expect(url.searchParams.get("code_challenge")).toBe("fixture-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Google-only parameters must NOT leak into a TikTok authorization URL.
    expect(url.searchParams.has("access_type")).toBe(false);
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("completes the loopback flow into a renderer-safe connected record + vault tokens", async () => {
    const store = memoryTikTokStore();
    const { fetcher, counts } = fixtureTikTokFetcher();
    const session = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 48151 });
    const record = await session.completeAuthorization({
      code: "fixture-code",
      state: request.state,
    });
    expect(counts.exchange).toBe(1);
    expect(record).toMatchObject({
      providerId: TIKTOK_PROVIDER_ID,
      internalAccountId: "local-user-1",
      status: "connected",
    });
    // Scopes come back comma-separated from TikTok; the record splits them.
    expect(record.grantedScopes).toEqual([...TIKTOK_OAUTH_SCOPES]);
    expect(record.displayName).toBe(`${TIKTOK_DISPLAY_NAME} account`);
    // Renderer-safe: no token material anywhere on the record.
    expect(JSON.stringify(record)).not.toContain("access_token");
    expect(JSON.stringify(record)).not.toContain("refresh_token");
    // The provider's own user id (open_id) stays vault-side (MR-FD4 gap).
    const tokens = store.vault.get("local-user-1")!;
    expect(tokens.openId).toBe(tokenSuccessFixture.data.open_id);
    expect(tokens.refreshExpiresAtMs).toBe(
      NOW + tokenSuccessFixture.data.refresh_expires_in * 1000,
    );
    expect(tokens.accessToken).toBe(tokenSuccessFixture.data.access_token);
  });

  it("rejects a mismatched callback state (CSRF guard)", async () => {
    const session = new TikTokOAuthSession({
      store: memoryTikTokStore(),
      internalAccountId: "local-user-1",
      tokenFetcher: fixtureTikTokFetcher().fetcher,
      clock: () => NOW,
    });
    session.startAuthorization({ redirectPort: 48151 });
    await expect(
      session.completeAuthorization({ code: "c", state: "wrong-state" }),
    ).rejects.toBeInstanceOf(StateMismatchError);
  });

  it("serves tokens and transparently refreshes near expiry", async () => {
    const store = memoryTikTokStore();
    const { fetcher, counts } = fixtureTikTokFetcher();
    const session = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 48151 });
    await session.completeAuthorization({ code: "c", state: request.state });
    expect(counts.refresh).toBe(0);

    // 30s before expiry (inside the 60s skew) → refresh fires.
    const nearExpiry = NOW + tokenSuccessFixture.data.expires_in * 1000 - 30_000;
    const sessionNearExpiry = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => nearExpiry,
    });
    const token = await sessionNearExpiry.getToken();
    expect(counts.refresh).toBe(1);
    expect(token).toBe(tokenRefreshFixture.data.access_token);
    const record = await sessionNearExpiry.loadAccount();
    expect(record?.status).toBe("connected");
  });

  it("marks the account revoked when the provider rejects refresh (access_token_invalid)", async () => {
    const store = memoryTikTokStore();
    const { fetcher } = fixtureTikTokFetcher({ refreshRejectedCode: "access_token_invalid" });
    const session = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 48151 });
    await session.completeAuthorization({ code: "c", state: request.state });

    const expired = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      // Past the 24h access-token expiry (and the 60s skew) so getToken must refresh.
      clock: () => NOW + tokenSuccessFixture.data.expires_in * 1000 + 5 * 60_000,
    });
    await expect(expired.getToken()).rejects.toBeInstanceOf(RefreshFailedError);
    const revoked = await expired.loadAccount();
    expect(revoked?.status).toBe("revoked");
    expect(store.vault.get("local-user-1")).toBeUndefined();
  });

  it("disconnects LOCALLY with ZERO network calls (no official revocation endpoint exists)", async () => {
    const store = memoryTikTokStore();
    const { fetcher, counts } = fixtureTikTokFetcher();
    const session = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const request = session.startAuthorization({ redirectPort: 48151 });
    await session.completeAuthorization({ code: "c", state: request.state });
    expect(counts.exchange).toBe(1);

    const revoked = await session.disconnect();
    // THE TikTok-specific honesty assertion: disconnect() must not touch the
    // network — Login Kit documents no revocation endpoint, and calling an
    // undocumented one is forbidden (ADR-0003).
    expect(counts.exchange).toBe(1);
    expect(counts.refresh).toBe(0);
    expect(revoked.status).toBe("revoked");
    expect(store.vault.get("local-user-1")).toBeUndefined();

    // Acknowledgement removes the record; a fresh consent can begin.
    await session.acknowledgeRevocation();
    expect(store.accounts.get("local-user-1")).toBeUndefined();
    expect(await session.status()).toBeNull();
  });

  it("exposes the canonical CredentialPort (opaque handle, provider-checked)", async () => {
    const store = memoryTikTokStore();
    const { fetcher } = fixtureTikTokFetcher();
    const session = new TikTokOAuthSession({
      store,
      internalAccountId: "local-user-1",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    const port = session.credentialPort();
    // No linked account → honest rejection (never a fabricated handle).
    await expect(port.getToken(TIKTOK_PROVIDER_ID, "local-user-1")).rejects.toBeInstanceOf(
      RequiresAuthError,
    );
    // Wrong provider → honest rejection.
    await expect(port.getToken("youtube", "local-user-1")).rejects.toBeInstanceOf(
      RequiresAuthError,
    );

    const request = session.startAuthorization({ redirectPort: 48151 });
    await session.completeAuthorization({ code: "c", state: request.state });
    const ref = await port.getToken(TIKTOK_PROVIDER_ID, "local-user-1");
    expect(ref.handle).toBe("tiktok:local-user-1");
    // A handle is a lookup key, never a token.
    expect(ref.handle).not.toContain("act.");
  });
});

// ---------------------------------------------------------------------------
// Service honest-state mapping (typed errors → frozen §2.3)
// ---------------------------------------------------------------------------

describe("tiktok service: honest-state mapping + authorized reads", () => {
  it("maps every typed error onto the frozen OperationCapability vocabulary", () => {
    const rateLimited = tikTokCapabilityFromError(
      new TikTokRateLimitedError({
        operationId: "video.list",
        message: "rate limited",
        status: 429,
        code: "rate_limit_exceeded",
      }),
    );
    expect(rateLimited.status).toBe("rate-limited");

    const needsAuth = tikTokCapabilityFromError(
      new TikTokRequiresAuthError({
        operationId: "user.info",
        message: "401",
        status: 401,
        code: "access_token_invalid",
      }),
    );
    expect(needsAuth.status).toBe("requires-auth");

    const noCredential = tikTokCapabilityFromError(
      new TikTokMissingCredentialError({ operationId: "video.list", message: "no token" }),
    );
    expect(noCredential.status).toBe("requires-auth");

    const region = tikTokCapabilityFromError(
      new TikTokRegionUnavailableError({
        operationId: "oembed.resolve",
        message: "regional redirect",
        status: 302,
        code: "regional-redirect",
      }),
    );
    // The frozen enum has no region status — the honest mapping is
    // unavailable with the regional explanation in detail.
    expect(region.status).toBe("unavailable");
    expect(region.detail).toContain("regional redirect");

    const notFound = tikTokCapabilityFromError(
      new TikTokNotFoundError({ operationId: "oembed.resolve", message: "404" }),
    );
    expect(notFound.status).toBe("unavailable");
  });

  it("lists the authorized account's own videos with the honest rate snapshot", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/video/list/`),
        respond: () => jsonResponse(videoListFixture),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    const page = await myTikTokVideos(client, { maxCount: 20 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.providerId).toBe(TIKTOK_PROVIDER_ID);
    expect(page.items[0]?.mediaKind).toBe("short");
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe(videoListFixture.data.cursor);
    expect(page.budget.basis).toContain("UNVERIFIED");
    expect(page.budget.state).toBe("ok");
  });

  it("reads the authorized account profile through the service", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.startsWith(`${TIKTOK_API_BASE}/user/info/`),
        respond: () => jsonResponse(userInfoFixture),
      },
    ]);
    const client = new TikTokDisplayApiClient({
      fetchImpl: fetch,
      accessTokenProvider: FIXED_TOKEN_PROVIDER,
      clock: () => NOW,
    });
    const user = await tikTokAccountInfo(client);
    expect(user.display_name).toBe("Fixture TikTok Creator");
  });

  it("honestly refuses non-canonical discovery URLs", async () => {
    const oembed = new TikTokOembedClient({
      fetchImpl: fixtureFetch([]),
    });
    await expect(
      resolveTikTokVideo(oembed, "https://vm.tiktok.com/ZMabcdefg/"),
    ).rejects.toBeInstanceOf(InvalidTikTokUrlError);
  });
});

// ---------------------------------------------------------------------------
// Honest-unsupported rows → WebFlix-local substitutes (work order row 4)
// ---------------------------------------------------------------------------

describe("tiktok honest-unsupported rows: WebFlix-local substitutes", () => {
  it("every unsupported manifest row has exactly one substitute/handoff entry (totality)", () => {
    expect(() => assertTikTokSubstitutesCoverManifest()).not.toThrow();
    const unsupportedCount = Object.values(tiktokManifest.operations).filter(
      (op) => op.status === "unsupported",
    ).length;
    expect(TIKTOK_UNSUPPORTED_SUBSTITUTES).toHaveLength(unsupportedCount);
  });

  it("local substitutes exist only for the WebFlix-owned store rows", () => {
    expect(tikTokSubstituteFor("history.provider")?.substitute).toBe("webflix-local-history");
    expect(tikTokSubstituteFor("feed.for-you")?.substitute).toBe("webflix-local-library");
    expect(tikTokSubstituteFor("feed.following")?.substitute).toBe("webflix-local-library");
    // Search has no local substitute — the honest note points at the
    // compliant discovery path (paste-a-link via oEmbed) and the official app.
    expect(tikTokSubstituteFor("search.query")?.substitute).toBe("none");
    expect(tikTokSubstituteFor("search.query")?.substituteNote).toContain("oembed.resolve");
    for (const row of TIKTOK_UNSUPPORTED_SUBSTITUTES) {
      expect(row.handoffNote.length).toBeGreaterThan(0);
      expect(row.substitute === "none" || row.substitute.startsWith("webflix-local")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-package seams (connectors suite — YOUTUBE-EXPAND precedent)
// ---------------------------------------------------------------------------

describe("tiktok items feed the canonical catalog merge (end-to-end seam)", () => {
  it("mapped TikTok items merge by provider-native evidence without duplicates", async () => {
    const { mergeCatalogInto } = await import("catalog");
    const parts = parseTikTokVideoUrl(DOC_VIDEO_URL)!;
    const item = catalogItemFromOembed(oembedVideoFixture, parts)!;

    const result = mergeCatalogInto([item], [item]);
    expect(result.items).toHaveLength(1);
    expect(result.report.deduped).toBe(1);
    expect(result.report.created).toBe(0);
  });

  it("the TikTok connector shape resolves through the playback resolver seam (proven in the playback suite — structural twin here)", () => {
    // architecture-policy keeps connectors from depending on playback: the
    // playback package's own suite runs the resolver against the structural
    // twin of TIKTOK_PLAYBACK_CONNECTOR (YOUTUBE-EXPAND precedent); this side
    // asserts the constant's fields match what that lane resolves.
    const template = TIKTOK_PLAYBACK_CONNECTOR.embed.urlTemplate;
    expect(template.replace("{mediaId}", encodeURIComponent(DOC_VIDEO_ID))).toBe(
      `${TIKTOK_EMBED_URL_PREFIX}${DOC_VIDEO_ID}`,
    );
    expect(TIKTOK_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(true);
  });
});
