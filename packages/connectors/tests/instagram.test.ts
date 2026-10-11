/**
 * Fixture-only test-suite for the Instagram connector (INSTAGRAM-CONNECT,
 * Phase 3 platform #3) — the fourth platform on the exact frozen §2
 * contracts YouTube, TikTok and Twitch use. No live calls, no real
 * credentials: the network boundary is an injected fetch backed by
 * packages/connectors/fixtures/instagram.
 *
 * Live-captured shapes this suite replays (recorded 2026-10-11 from the
 * work-order sandbox — see the parity matrix live-smoke section):
 *   - graph.instagram.com unauthenticated /me → HTTP 400, application/json,
 *     {"error":{"message":"Invalid OAuth 2.0 Access Token",
 *     "type":"IGApiException","code":190,"error_data":{},"fbtrace_id":"…"}}
 *   - graph.facebook.com unauthenticated /me → HTTP 400,
 *     {"error":{"message":"An active access token must be used to query
 *      information about the current user.","type":"OAuthException",
 *      "code":2500,"fbtrace_id":"…"}}
 *   - instagram_oembed, dead shortcode → HTTP 400 code 24 subcode 2207045
 *     "Media Not Found … does not exist or you don't have permission to
 *     embed it."
 *   - instagram_oembed, the doc-example public post, UNAUTHENTICATED →
 *     HTTP 200 with the FULL oEmbed payload (blockquote.instagram-media +
 *     the //platform.instagram.com/en_US/embeds.js loader) — the star
 *     fixture of this work order, replayed below; the manifest still holds
 *     the row at requires-auth pending the operator's app review.
 * Modeled (UNVERIFIED basis, labeled in the fixture): the Graph
 * request-limit error envelope (code 4) — the rate-limiting doc confirms
 * throttle errors but its error-code table is client-rendered and did not
 * extract from this sandbox.
 */
import { describe, expect, it } from "vitest";

import {
  INSTAGRAM_ACCOUNT_PROVENANCE,
  INSTAGRAM_API_VERSION,
  INSTAGRAM_BUC_DOCUMENTED_FORMULA,
  INSTAGRAM_DISPLAY_NAME,
  INSTAGRAM_DOCUMENTED_DESKTOP_REDIRECT_URI,
  INSTAGRAM_GRAPH_BASE,
  INSTAGRAM_LOGIN_CONFIG,
  INSTAGRAM_MANIFEST_VERSION,
  INSTAGRAM_MODELED_HOURLY_APPROXIMATION,
  INSTAGRAM_OAUTH_SCOPES,
  INSTAGRAM_OPERATION_PROVENANCE,
  INSTAGRAM_OEMBED_EMBEDS_JS_URL,
  INSTAGRAM_PLAYBACK_CONNECTOR,
  INSTAGRAM_PROVIDER_ID,
  INSTAGRAM_RATE_WINDOW_MS,
  INSTAGRAM_UNSUPPORTED_SUBSTITUTES,
  INSTAGRAM_WATCH_PROVENANCE,
  InvalidInstagramShortcodeError,
  InvalidInstagramUrlError,
  InvalidTransitionError,
  InstagramApiError,
  InstagramDiscoveredAccount,
  InstagramGraphClient,
  InstagramMissingCredentialError,
  InstagramNotFoundError,
  InstagramOAuthSession,
  InstagramOembedClient,
  InstagramOembedMediaNotEmbeddableError,
  InstagramRateLimitedError,
  InstagramRequiresAuthError,
  OAuthFlowError,
  parseInstagramMediaUrl,
  playbackPlanForInstagramCatalogItem,
  RequiresAuthError,
  StateMismatchError,
  assertInstagramSubstitutesCoverManifest,
  buildInstagramPlaybackPlan,
  buildInstagramAuthorizationRequest,
  catalogItemFromGraphMedia,
  catalogItemsFromGraphMediaPage,
  createDefaultRegistry,
  discoverMyInstagramAccounts,
  instagramCapabilityFromError,
  instagramEmbedUrlFor,
  instagramManifest,
  instagramShortcodeOf,
  isInstagramReelItem,
  isInstagramReelRow,
  myInstagramMedia,
  type CatalogItem,
  type ConnectorManifest,
  type InstagramFetchLike,
  type InstagramFetchResponseLike,
  type InstagramStoredTokens,
  type InstagramTokenFetcher,
  type ProviderAccountRecord,
} from "../src";
import { LiveNetworkDisabledError } from "../src";

import accountsFixture from "../fixtures/instagram/graph.me.accounts.json";
import pageIgFixture from "../fixtures/instagram/graph.page.instagram_business_account.json";
import profileFixture from "../fixtures/instagram/graph.ig-user.profile.json";
import mediaFixture from "../fixtures/instagram/graph.ig-user.media.json";
import accountInsightsFixture from "../fixtures/instagram/graph.ig-user.insights.json";
import mediaInsightsFixture from "../fixtures/instagram/graph.media.insights.json";
import invalidTokenFixture from "../fixtures/instagram/error.190.json";
import tokenRequiredFixture from "../fixtures/instagram/error.2500.json";
import notEmbeddableFixture from "../fixtures/instagram/error.oembed.not-embeddable.json";
import rateLimitedFixture from "../fixtures/instagram/error.rate-limited.json";
import oembedSuccessFixture from "../fixtures/instagram/oembed.success.json";
import shortLivedTokenFixture from "../fixtures/instagram/oauth.token.short-lived.json";
import longLivedTokenFixture from "../fixtures/instagram/oauth.token.long-lived.json";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Fixture helpers (all network is injected; nothing leaves the process)
// ---------------------------------------------------------------------------

interface InstagramFixtureInit {
  status?: number;
  headers?: Record<string, string>;
}

function jsonResponse(body: unknown, init: InstagramFixtureInit = {}): InstagramFetchResponseLike {
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
  ) => InstagramFetchResponseLike;
}

function fixtureFetch(routes: Route[]): InstagramFetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    calls.push(url);
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`fixture fetch: no route matched ${url}`);
    return route.respond(url, init);
  }) as InstagramFetchLike & { calls: string[] };
  fetchFn.calls = calls;
  return fetchFn;
}

const FIXED_USER_TOKEN = { getUserAccessToken: async () => "webflix-fixture-user-token" };

function graphClient(fetch: InstagramFetchLike): InstagramGraphClient {
  return new InstagramGraphClient({
    fetchImpl: fetch,
    userAccessTokenProvider: FIXED_USER_TOKEN,
    clock: () => NOW,
  });
}

function memoryInstagramStore() {
  const accounts = new Map<string, ProviderAccountRecord>();
  const vault = new Map<string, InstagramStoredTokens>();
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
    async saveTokens(id: string, tokens: InstagramStoredTokens) {
      vault.set(id, tokens);
    },
    async removeTokens(id: string) {
      vault.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest + registry
// ---------------------------------------------------------------------------

describe("instagram manifest (frozen §2.3 honesty)", () => {
  it("registers as the fourth platform in the default registry (reddit joined fifth at REDDIT-CONNECT)", () => {
    const registry = createDefaultRegistry();
    expect(registry.size).toBe(5);
    for (const providerId of ["youtube", "tiktok", "twitch", "instagram", "reddit"]) {
      expect(registry.has(providerId)).toBe(true);
    }
    const manifest = registry.require("instagram") as ConnectorManifest;
    expect(manifest.providerId).toBe(INSTAGRAM_PROVIDER_ID);
  });

  it("is honesty-forward: most browse rows unsupported, reads requires-auth, playback unavailable", () => {
    const statuses = Object.values(instagramManifest.operations).map((op) => op.status);
    const count = (status: string) => statuses.filter((s) => s === status).length;
    expect(count("unsupported")).toBeGreaterThanOrEqual(16);
    expect(count("requires-auth")).toBe(5); // profile, media, 2× insights, oEmbed (pending app review)
    expect(count("supported")).toBe(3); // oauth connect / long-lived / disconnect
    expect(count("unavailable")).toBe(1); // playback.embed — the honest watch default
  });

  it("records the professional-accounts-only gate on every read row", () => {
    for (const id of ["profile.read", "media.list", "insights.account", "insights.media"]) {
      expect(instagramManifest.operations[id]?.status).toBe("requires-auth");
      expect(instagramManifest.operations[id]?.detail).toMatch(/professional/i);
    }
  });

  it("records the Basic Display removal with the changelog citation", () => {
    const row = instagramManifest.operations["basic-display.profile"];
    expect(row?.status).toBe("unsupported");
    expect(row?.detail).toMatch(/December 4, 2024/);
    expect(row?.detail).toMatch(/deprecated/);
  });

  it("records the hashtag-search reality check (audit says removed; live docs say gated)", () => {
    const row = instagramManifest.operations["hashtags.search"];
    expect(row?.status).toBe("unsupported");
    expect(row?.detail).toMatch(/REMOVED 2024/);
    expect(row?.detail).toMatch(/App Review/);
    expect(row?.detail).toMatch(/Instagram Public Content Access/);
  });

  it("carries the BUC rate basis, the unverified envelope and NO region claim", () => {
    expect(instagramManifest.quotas?.requestsPerWindow).toBe(
      INSTAGRAM_MODELED_HOURLY_APPROXIMATION,
    );
    expect(instagramManifest.quotas?.windowMs).toBe(INSTAGRAM_RATE_WINDOW_MS);
    expect(INSTAGRAM_BUC_DOCUMENTED_FORMULA).toMatch(/4800 \* Number of Impressions/);
    expect(instagramManifest.regions).toEqual([]);
  });

  it("cites official sources for every operation row", () => {
    const operationIds = Object.keys(instagramManifest.operations);
    expect(operationIds.length).toBeGreaterThanOrEqual(25);
    for (const id of operationIds) {
      const citations = INSTAGRAM_OPERATION_PROVENANCE[id];
      expect(citations, `operation ${id} must carry provenance citations`).toBeDefined();
      expect(citations.length).toBeGreaterThan(0);
    }
    expect(INSTAGRAM_ACCOUNT_PROVENANCE.length).toBeGreaterThan(0);
    expect(INSTAGRAM_WATCH_PROVENANCE.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Substitutes totality (both directions)
// ---------------------------------------------------------------------------

describe("instagram honest-unsupported substitutes", () => {
  it("covers every unsupported row, and every substitute row matches one", () => {
    expect(() => assertInstagramSubstitutesCoverManifest()).not.toThrow();
    expect(INSTAGRAM_UNSUPPORTED_SUBSTITUTES.length).toBe(
      Object.values(instagramManifest.operations).filter((op) => op.status === "unsupported")
        .length,
    );
  });

  it("throws when a substitute row is missing (the totality check has teeth)", () => {
    const rows = INSTAGRAM_UNSUPPORTED_SUBSTITUTES.filter((r) => r.operationId !== "feed.home");
    const missing = rows.find(
      (r) => r.operationId === "feed.home", // sanity: filtered out above
    );
    expect(missing).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Graph client — discovery chain, reads, errors, usage ledger
// ---------------------------------------------------------------------------

describe("instagram graph client (official reads, fixture-tested)", () => {
  it("walks the documented two-step discovery chain (/me/accounts → page ?fields=instagram_business_account)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) =>
          url.startsWith(`${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/me/accounts`),
        respond: () => jsonResponse(accountsFixture),
      },
      {
        match: (url) =>
          url.startsWith(`${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/134895793791914?`),
        respond: () => jsonResponse(pageIgFixture),
      },
    ]);
    const client = graphClient(fetch);
    const accounts: InstagramDiscoveredAccount[] = await discoverMyInstagramAccounts(client);
    expect(accounts).toEqual([
      { pageId: "134895793791914", pageName: "Metricsaurus", igUserId: "17841405822304914" },
    ]);
    // The two documented hops, in order.
    expect(fetch.calls[0]).toContain("/me/accounts");
    expect(fetch.calls[1]).toContain("/134895793791914");
    expect(fetch.calls[1]).toContain("fields=instagram_business_account");
  });

  it("skips pages without a linked Instagram account (honest absence)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/me/accounts"),
        respond: () =>
          jsonResponse({
            data: [
              { id: "111", name: "No IG Page" },
              { id: "134895793791914", name: "Metricsaurus" },
            ],
          }),
      },
      {
        match: (url) => url.includes("/111?"),
        respond: () => jsonResponse({ id: "111" }),
      },
      {
        match: (url) => url.includes("/134895793791914?"),
        respond: () => jsonResponse(pageIgFixture),
      },
    ]);
    const accounts = await graphClient(fetch).discoverInstagramAccounts();
    expect(accounts.map((a) => a.pageId)).toEqual(["134895793791914"]);
  });

  it("reads the own profile with the documented field set", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914?"),
        respond: () => jsonResponse(profileFixture),
      },
    ]);
    const profile = await graphClient(fetch).getInstagramUserProfile("17841405822304914");
    expect(profile.username).toBe("metricsaurus");
    expect(profile.media_count).toBe(42);
    expect(fetch.calls[0]).toContain("fields=");
    for (const field of ["username", "followers_count", "media_count", "profile_picture_url"]) {
      expect(fetch.calls[0]).toContain(field);
    }
    expect(fetch.calls[0]).toContain("access_token=");
  });

  it("reads own media with cursor paging surfaced honestly", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914/media"),
        respond: () => jsonResponse(mediaFixture),
      },
    ]);
    const page = await graphClient(fetch).getInstagramMedia("17841405822304914");
    expect(page.data?.length).toBe(5);
    expect(page.paging?.cursors?.after).toBe("QVFIU1ZANbkTQeE5s");
    expect(typeof page.paging?.next).toBe("string");
  });

  it("reads account and media insights with metric/period parameters", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914/insights"),
        respond: (url) => {
          expect(url).toContain("metric=impressions%2Creach%2Cprofile_views");
          expect(url).toContain("period=day");
          return jsonResponse(accountInsightsFixture);
        },
      },
      {
        match: (url) => url.includes("/17895695668004550/insights"),
        respond: (url) => {
          expect(url).toContain("metric=engagement%2Creach");
          return jsonResponse(mediaInsightsFixture);
        },
      },
    ]);
    const client = graphClient(fetch);
    const accountInsights = await client.getAccountInsights("17841405822304914", {
      metric: ["impressions", "reach", "profile_views"],
      period: "day",
    });
    expect(accountInsights.data?.map((m) => m.name)).toEqual([
      "impressions",
      "reach",
      "profile_views",
    ]);
    const mediaInsights = await client.getMediaInsights("17895695668004550", {
      metric: ["engagement", "reach"],
    });
    expect(mediaInsights.data?.[0]?.values?.[0]?.value).toBe(8);
  });

  it("maps the live-captured code 190 envelope to an honest requires-auth error", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914?"),
        respond: () => jsonResponse(invalidTokenFixture, { status: 400 }),
      },
    ]);
    await expect(
      graphClient(fetch).getInstagramUserProfile("17841405822304914"),
    ).rejects.toBeInstanceOf(InstagramRequiresAuthError);
  });

  it("maps the live-captured code 2500 unauthenticated /me envelope to requires-auth", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914?"),
        respond: () => jsonResponse(tokenRequiredFixture, { status: 400 }),
      },
    ]);
    await expect(
      graphClient(fetch).getInstagramUserProfile("17841405822304914"),
    ).rejects.toBeInstanceOf(InstagramRequiresAuthError);
  });

  it("maps the modeled request-limit envelope (code 4, UNVERIFIED basis) to rate-limited", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914/media"),
        respond: () => jsonResponse(rateLimitedFixture, { status: 400 }),
      },
    ]);
    await expect(graphClient(fetch).getInstagramMedia("17841405822304914")).rejects.toBeInstanceOf(
      InstagramRateLimitedError,
    );
  });

  it("maps 404 to a typed not-found error and unknown errors to InstagramApiError", async () => {
    const notFound = fixtureFetch([
      {
        match: () => true,
        respond: () =>
          jsonResponse(
            { error: { message: "nope", type: "OAuthException", code: 806 } },
            { status: 404 },
          ),
      },
    ]);
    await expect(
      graphClient(notFound).getInstagramMedia("17841405822304914"),
    ).rejects.toBeInstanceOf(InstagramNotFoundError);

    const other = fixtureFetch([
      {
        match: () => true,
        respond: () =>
          jsonResponse(
            { error: { message: "weird", type: "FacebookApiException", code: 1 } },
            { status: 500 },
          ),
      },
    ]);
    await expect(graphClient(other).getInstagramMedia("17841405822304914")).rejects.toBeInstanceOf(
      InstagramApiError,
    );
  });

  it("fails fast with InstagramMissingCredentialError without a token source", async () => {
    const client = new InstagramGraphClient({ clock: () => NOW });
    await expect(client.discoverInstagramAccounts()).rejects.toBeInstanceOf(
      InstagramMissingCredentialError,
    );
  });

  it("records the provider's X-App-Usage / X-Business-Use-Case-Usage headers verbatim — and NEVER blocks pre-flight", async () => {
    const usageHeaders = {
      "x-app-usage": '{"call_count":28,"total_cputime":25,"total_time":20}',
      "x-business-use-case-usage": '{"17841405822304914":[{"call_count":10}]}',
    };
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914/media"),
        respond: () => jsonResponse(mediaFixture, { headers: usageHeaders }),
      },
    ]);
    const client = graphClient(fetch);
    // Five calls straight through "used" headers — the ledger observes, it
    // never blocks (the provider's own throttle is the only enforcement).
    for (let i = 0; i < 5; i += 1) {
      await client.getInstagramMedia("17841405822304914");
    }
    const budget = client.getUsageBudget();
    expect(budget.state).toBe("ok");
    expect(budget.providerReportedRateLimit).toBe(false);
    expect(budget.appUsageHeader).toBe(usageHeaders["x-app-usage"]);
    expect(budget.businessUseCaseUsageHeader).toBe(usageHeaders["x-business-use-case-usage"]);
    expect(budget.callsRecorded).toBe(5);
    expect(budget.basis).toMatch(/4800 \* Number of Impressions/);
    expect(client.getLedger().every((e) => e.outcome === "success")).toBe(true);
  });

  it("marks the budget provider-rate-limited only when the provider itself throttles", async () => {
    const fetch = fixtureFetch([
      {
        match: () => true,
        respond: () => jsonResponse(rateLimitedFixture, { status: 429 }),
      },
    ]);
    const client = graphClient(fetch);
    await expect(client.getInstagramMedia("17841405822304914")).rejects.toBeInstanceOf(
      InstagramRateLimitedError,
    );
    const budget = client.getUsageBudget();
    expect(budget.state).toBe("provider-rate-limited");
    expect(budget.providerReportedRateLimit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// oEmbed client (the live-verified anonymous success + the gated production row)
// ---------------------------------------------------------------------------

describe("instagram oembed client", () => {
  const successClient = new InstagramOembedClient({
    fetchImpl: fixtureFetch([
      {
        match: (url) => url.includes("/instagram_oembed"),
        respond: () => jsonResponse(oembedSuccessFixture),
      },
    ]),
  });

  it("accepts only canonical post/reel URLs (profile URLs and other hosts refused before I/O)", () => {
    expect(parseInstagramMediaUrl("https://www.instagram.com/p/fA9uwTtkSN/")?.shortcode).toBe(
      "fA9uwTtkSN",
    );
    expect(parseInstagramMediaUrl("https://www.instagram.com/reel/CxYzAbCdEfG/")?.kind).toBe(
      "reel",
    );
    expect(parseInstagramMediaUrl("https://www.instagram.com/metricsaurus/")).toBeNull();
    expect(parseInstagramMediaUrl("https://example.com/p/fA9uwTtkSN/")).toBeNull();
    expect(() =>
      successClient.resolveEmbed("https://www.instagram.com/metricsaurus/"),
    ).rejects.toThrow(InvalidInstagramUrlError);
  });

  it("replays the LIVE-CAPTURED anonymous success: the doc-example post's full embed markup", async () => {
    const payload = await successClient.resolveEmbed("https://www.instagram.com/p/fA9uwTtkSN/");
    // Verbatim live capture, 2026-10-11: unauthenticated oEmbed answered 200
    // for the doc-example public post — recorded as evidence, not a gate waiver.
    expect(payload.type).toBe("rich");
    expect(payload.width).toBe(658);
    expect(payload.html).toContain("blockquote");
    expect(payload.html).toContain("instagram-media");
    expect(payload.html).toContain("https://www.instagram.com/p/fA9uwTtkSN/");
    expect(payload.html).toContain(INSTAGRAM_OEMBED_EMBEDS_JS_URL);
  });

  it("maps the live-captured code 24 / subcode 2207045 envelope to the not-embeddable error", async () => {
    const client = new InstagramOembedClient({
      fetchImpl: fixtureFetch([
        {
          match: () => true,
          respond: () => jsonResponse(notEmbeddableFixture, { status: 400 }),
        },
      ]),
    });
    try {
      await client.resolveEmbed("https://www.instagram.com/p/DEADBEEF123/");
      throw new Error("expected resolveEmbed to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(InstagramOembedMediaNotEmbeddableError);
      const typed = error as InstagramOembedMediaNotEmbeddableError;
      expect(typed.code).toBe(24);
      expect(typed.errorSubcode).toBe(2207045);
      expect(typed.message).toContain("permission to embed it");
    }
  });

  it("maps token errors to requires-auth and throttle errors to rate-limited", async () => {
    const authClient = new InstagramOembedClient({
      fetchImpl: fixtureFetch([
        { match: () => true, respond: () => jsonResponse(invalidTokenFixture, { status: 400 }) },
      ]),
    });
    await expect(
      authClient.resolveEmbed("https://www.instagram.com/p/fA9uwTtkSN/"),
    ).rejects.toBeInstanceOf(InstagramRequiresAuthError);

    const throttledClient = new InstagramOembedClient({
      fetchImpl: fixtureFetch([
        { match: () => true, respond: () => jsonResponse(rateLimitedFixture, { status: 429 }) },
      ]),
    });
    await expect(
      throttledClient.resolveEmbed("https://www.instagram.com/p/fA9uwTtkSN/"),
    ).rejects.toBeInstanceOf(InstagramRateLimitedError);
  });

  it("fails fast without an injected fetch (fixture-only build)", async () => {
    const client = new InstagramOembedClient();
    await expect(
      client.resolveEmbed("https://www.instagram.com/p/fA9uwTtkSN/"),
    ).rejects.toBeInstanceOf(LiveNetworkDisabledError);
  });
});

// ---------------------------------------------------------------------------
// Catalog mapping (honest mediaKind + drops)
// ---------------------------------------------------------------------------

describe("instagram catalog mapping (frozen §2.1)", () => {
  const reelRow = mediaFixture.data[0];
  const feedVideoRow = mediaFixture.data[1];
  const imageRow = mediaFixture.data[2];
  const carouselRow = mediaFixture.data[3];
  const reelNoShortcode = mediaFixture.data[4];

  it("maps a REELS video to the short-form kind with the /reel/ embed asset", () => {
    expect(isInstagramReelRow(reelRow)).toBe(true);
    const item = catalogItemFromGraphMedia(reelRow);
    expect(item?.mediaKind).toBe("short");
    expect(item?.providerId).toBe(INSTAGRAM_PROVIDER_ID);
    expect(item?.id).toBe("instagram:video:17895695668004550");
    expect((item?.metadata?.externalIds as Record<string, unknown>)?.instagram).toBe(
      "17895695668004550",
    );
    expect(item?.metadata?.instagramShortcode).toBe("CxYzAbCdEfG");
    expect(item?.metadata?.mediaProductType).toBe("REELS");
    expect(item?.metadata?.permalink).toBe("https://www.instagram.com/reel/CxYzAbCdEfG/");
    const embed = item?.assets.find((a) => a.kind === "embed");
    expect(embed?.reference).toBe(instagramEmbedUrlFor("reel", "CxYzAbCdEfG"));
    const thumb = item?.assets.find((a) => a.kind === "thumbnail");
    expect(thumb?.reference).toContain("reel-thumb.jpg");
    expect(item?.availability).toBeUndefined(); // never fabricated
  });

  it("maps a FEED video to the video kind with the /p/ embed asset", () => {
    const item = catalogItemFromGraphMedia(feedVideoRow);
    expect(item?.mediaKind).toBe("video");
    const embed = item?.assets.find((a) => a.kind === "embed");
    expect(embed?.reference).toBe("https://www.instagram.com/p/CxFeedVid01/embed/");
  });

  it("drops image posts and carousel albums honestly (no photo kind in the frozen enum)", () => {
    expect(catalogItemFromGraphMedia(imageRow)).toBeNull();
    expect(catalogItemFromGraphMedia(carouselRow)).toBeNull();
    const { items, report } = catalogItemsFromGraphMediaPage(mediaFixture.data);
    expect(items.length).toBe(3);
    expect(report.droppedImage).toBe(1);
    expect(report.droppedCarousel).toBe(1);
    expect(report.droppedNoId).toBe(0);
    expect(report.mapped).toBe(3);
  });

  it("maps a video without a shortcode to an item with NO embed asset (no guessed token)", () => {
    const item = catalogItemFromGraphMedia(reelNoShortcode);
    expect(item?.mediaKind).toBe("short");
    expect(item?.assets).toEqual([]);
    expect(instagramShortcodeOf(item as CatalogItem)).toBeNull();
  });

  it("extracts the shortcode from metadata, externalIds and embed references in priority order", () => {
    const fromMeta = catalogItemFromGraphMedia(reelRow);
    expect(instagramShortcodeOf(fromMeta as CatalogItem)).toBe("CxYzAbCdEfG");
    expect(isInstagramReelItem(fromMeta as CatalogItem)).toBe(true);

    const onlyReference: CatalogItem = {
      id: "instagram:video:x",
      providerId: INSTAGRAM_PROVIDER_ID,
      title: "x",
      mediaKind: "video",
      assets: [
        {
          assetId: "instagram:embed:CxFeedVid01",
          kind: "embed",
          reference: "https://www.instagram.com/p/CxFeedVid01/embed/",
        },
      ],
      metadata: {},
    };
    expect(instagramShortcodeOf(onlyReference)).toBe("CxFeedVid01");
    expect(isInstagramReelItem(onlyReference)).toBe(false);

    const reelByReference: CatalogItem = {
      ...onlyReference,
      assets: [
        {
          assetId: "instagram:embed:CxYzAbCdEfG",
          kind: "embed",
          reference: "https://www.instagram.com/reel/CxYzAbCdEfG/embed/",
        },
      ],
    };
    expect(isInstagramReelItem(reelByReference)).toBe(true);

    expect(
      instagramShortcodeOf({
        id: "youtube:video:1",
        providerId: "youtube",
        title: "not instagram",
        mediaKind: "video",
        assets: [],
        metadata: {},
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OAuth (Facebook Login for Business on the shared seams)
// ---------------------------------------------------------------------------

describe("instagram oauth (Facebook Login for Business, fixture-tested)", () => {
  const REDIRECT = INSTAGRAM_DOCUMENTED_DESKTOP_REDIRECT_URI;

  it("builds the documented manual-flow authorization URL — comma scopes, state, NO PKCE", () => {
    const request = buildInstagramAuthorizationRequest({
      redirectUri: REDIRECT,
      state: "fixture-state",
    });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe(INSTAGRAM_LOGIN_CONFIG.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("fixture-state");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_OAUTH_SCOPES.join(","));
    // Facebook's documented manual flow defines NO PKCE parameters — sending
    // them would be invented input.
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
    // And no Google/TikTok parameters either.
    expect(url.searchParams.has("access_type")).toBe(false);
    expect(url.searchParams.has("client_key")).toBe(false);
  });

  it("refuses non-absolute redirect URIs (the App Dashboard registration is the operator's item)", () => {
    expect(() => buildInstagramAuthorizationRequest({ redirectUri: "not-a-url" })).toThrow(
      OAuthFlowError,
    );
  });

  function session(fetcher: InstagramTokenFetcher) {
    const store = memoryInstagramStore();
    const oauth = new InstagramOAuthSession({
      store,
      internalAccountId: "ig-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    return { store, oauth };
  }

  it("exchanges the code for a short-lived token after the state guard", async () => {
    const fetcher: InstagramTokenFetcher = async (request) => {
      expect(request.kind).toBe("token-exchange");
      if (request.kind === "token-exchange") {
        expect(request.redirectUri).toBe(REDIRECT);
      }
      return { kind: "token", token: shortLivedTokenFixture };
    };
    const { store, oauth } = session(fetcher);
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    const record = await oauth.completeAuthorization({
      code: "fixture-code",
      state: started.state,
      displayName: "Metricsaurus",
      facebookUserId: "134895793791914",
    });
    expect(record.providerId).toBe(INSTAGRAM_PROVIDER_ID);
    expect(record.status).toBe("connected");
    expect(record.displayName).toBe("Metricsaurus");
    expect(record.grantedScopes).toEqual([...INSTAGRAM_OAUTH_SCOPES]);
    const tokens = await store.loadTokens("ig-main");
    expect(tokens?.accessToken).toBe(shortLivedTokenFixture.access_token);
    expect(tokens?.facebookUserId).toBe("134895793791914");
    expect(tokens?.longLived).toBe(false);
  });

  it("rejects a mismatched state (CSRF guard)", async () => {
    const { oauth } = session(async () => ({ kind: "token", token: shortLivedTokenFixture }));
    oauth.startAuthorization({ redirectUri: REDIRECT });
    await expect(
      oauth.completeAuthorization({ code: "c", state: "wrong-state" }),
    ).rejects.toBeInstanceOf(StateMismatchError);
  });

  it("exchanges for a long-lived token — and an EXPIRED token honestly requires re-login", async () => {
    const fetcher: InstagramTokenFetcher = async (request) => {
      if (request.kind === "token-exchange") {
        return { kind: "token", token: shortLivedTokenFixture };
      }
      expect(request.kind).toBe("exchange-long-lived");
      return { kind: "token", token: longLivedTokenFixture };
    };
    const { store, oauth } = session(fetcher);
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state, facebookUserId: "u1" });
    const record = await oauth.exchangeLongLived();
    expect(record.status).toBe("connected");
    const tokens = await store.loadTokens("ig-main");
    expect(tokens?.longLived).toBe(true);
    expect(tokens?.accessToken).toBe(longLivedTokenFixture.access_token);

    // The documented caveat: an expired token cannot be exchanged.
    const staleStore = memoryInstagramStore();
    staleStore.vault.set("ig-main", {
      accessToken: "stale",
      refreshToken: null,
      expiresAtMs: NOW - 1000,
      scope: "instagram_basic",
      tokenType: "bearer",
      facebookUserId: "u1",
      dataAccessExpiresAtMs: null,
      longLived: false,
    });
    staleStore.accounts.set("ig-main", {
      providerId: INSTAGRAM_PROVIDER_ID,
      internalAccountId: "ig-main",
      displayName: "IG",
      grantedScopes: [],
      status: "connected",
      connectedAt: new Date(NOW - 7200_000).toISOString(),
      expiresAt: new Date(NOW - 1000).toISOString(),
    });
    const staleSession = new InstagramOAuthSession({
      store: staleStore,
      internalAccountId: "ig-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    await expect(staleSession.exchangeLongLived()).rejects.toBeInstanceOf(RequiresAuthError);
  });

  it("marks the account expired when the provider rejects the exchange with code 190", async () => {
    const fetcher: InstagramTokenFetcher = async () => ({
      kind: "rejected",
      code: 190,
      message: "Invalid OAuth 2.0 Access Token",
    });
    const store = memoryInstagramStore();
    store.vault.set("ig-main", {
      accessToken: "soon-stale",
      refreshToken: null,
      expiresAtMs: NOW + 3600_000,
      scope: "instagram_basic",
      tokenType: "bearer",
      facebookUserId: "u1",
      dataAccessExpiresAtMs: null,
      longLived: false,
    });
    store.accounts.set("ig-main", {
      providerId: INSTAGRAM_PROVIDER_ID,
      internalAccountId: "ig-main",
      displayName: "IG",
      grantedScopes: [],
      status: "connected",
      connectedAt: new Date(NOW - 1000).toISOString(),
    });
    const oauth = new InstagramOAuthSession({
      store,
      internalAccountId: "ig-main",
      tokenFetcher: fetcher,
      clock: () => NOW,
    });
    await expect(oauth.exchangeLongLived()).rejects.toBeInstanceOf(RequiresAuthError);
    expect((await store.loadAccount("ig-main"))?.status).toBe("expired");
  });

  it("disconnects through the OFFICIAL revocation — and a failed revoke leaves the record intact", async () => {
    const calls: string[] = [];
    const fetcher: InstagramTokenFetcher = async (request) => {
      calls.push(request.kind);
      if (request.kind === "revoke") {
        expect(request.userId).toBe("u1");
        return { kind: "revoked" };
      }
      return { kind: "token", token: shortLivedTokenFixture };
    };
    const { store, oauth } = session(fetcher);
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({
      code: "c",
      state: started.state,
      facebookUserId: "u1",
    });
    const revoked = await oauth.disconnect();
    expect(revoked.status).toBe("revoked");
    expect(await store.loadTokens("ig-main")).toBeNull();
    expect(calls).toContain("revoke");

    // The failure direction: the provider rejects the revoke → record INTACT.
    const failingStore = memoryInstagramStore();
    failingStore.vault.set("ig-main", {
      accessToken: "t",
      refreshToken: null,
      expiresAtMs: NOW + 3600_000,
      scope: "instagram_basic",
      tokenType: "bearer",
      facebookUserId: "u1",
      dataAccessExpiresAtMs: null,
      longLived: true,
    });
    failingStore.accounts.set("ig-main", {
      providerId: INSTAGRAM_PROVIDER_ID,
      internalAccountId: "ig-main",
      displayName: "IG",
      grantedScopes: [],
      status: "connected",
      connectedAt: new Date(NOW - 1000).toISOString(),
    });
    const failing = new InstagramOAuthSession({
      store: failingStore,
      internalAccountId: "ig-main",
      tokenFetcher: async (request) =>
        request.kind === "revoke"
          ? { kind: "rejected", code: 190, message: "token invalid mid-flight" }
          : { kind: "token", token: shortLivedTokenFixture },
      clock: () => NOW,
    });
    await expect(failing.disconnect()).rejects.toBeInstanceOf(OAuthFlowError);
    expect((await failingStore.loadAccount("ig-main"))?.status).toBe("connected");
    expect(await failingStore.loadTokens("ig-main")).not.toBeNull();
  });

  it("cannot disconnect without the Facebook user id (the revocation target)", async () => {
    const { oauth } = session(async () => ({ kind: "token", token: shortLivedTokenFixture }));
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state });
    await expect(oauth.disconnect()).rejects.toBeInstanceOf(RequiresAuthError);
  });

  it("exposes the canonical CredentialPort handle and guards the providerId", async () => {
    const { oauth } = session(async () => ({ kind: "token", token: shortLivedTokenFixture }));
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state });
    const port = oauth.credentialPort();
    const ref = await port.getToken(INSTAGRAM_PROVIDER_ID, "ig-main");
    expect(ref.handle).toBe("instagram:ig-main");
    await expect(port.getToken("youtube", "ig-main")).rejects.toBeInstanceOf(RequiresAuthError);
  });

  it("acknowledges only revoked accounts (frozen transition discipline)", async () => {
    const fetcher: InstagramTokenFetcher = async (request) =>
      request.kind === "revoke"
        ? { kind: "revoked" }
        : { kind: "token", token: shortLivedTokenFixture };
    const { store, oauth } = session(fetcher);
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state, facebookUserId: "u1" });
    await expect(oauth.acknowledgeRevocation()).rejects.toBeInstanceOf(InvalidTransitionError);
    await oauth.disconnect();
    await expect(oauth.acknowledgeRevocation()).resolves.toBeUndefined();
    expect(await store.loadAccount("ig-main")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Playback (the honest default + the approved-credential path)
// ---------------------------------------------------------------------------

describe("instagram playback (work-order default: honest unavailable)", () => {
  it("refuses malformed shortcodes", () => {
    expect(() => buildInstagramPlaybackPlan({ shortcode: "x!" })).toThrow(
      InvalidInstagramShortcodeError,
    );
    expect(() => buildInstagramPlaybackPlan({ shortcode: "" })).toThrow(
      InvalidInstagramShortcodeError,
    );
  });

  it("DEFAULT: unavailable{requires-auth} + open-provider-app handoff with the permalink", () => {
    const plan = buildInstagramPlaybackPlan({ shortcode: "fA9uwTtkSN" });
    expect(plan.kind).toBe("unavailable");
    if (plan.kind !== "unavailable") throw new Error("unreachable");
    expect(plan.reason).toBe("requires-auth");
    expect(plan.recovery?.action).toBe("open-provider-app");
    expect(plan.recovery?.url).toBe("https://www.instagram.com/p/fA9uwTtkSN/");
    expect(plan.recovery?.message).toMatch(/app review/i);
  });

  it("approved path: the official-embed plan against the documented embed page (/p/ and /reel/)", () => {
    const post = buildInstagramPlaybackPlan({ shortcode: "CxFeedVid01", embedApproved: true });
    if (post.kind !== "official-embed")
      throw new Error(`expected official-embed, got ${post.kind}`);
    expect(post.providerId).toBe(INSTAGRAM_PROVIDER_ID);
    expect(post.embedSpec.embedUrl).toBe("https://www.instagram.com/p/CxFeedVid01/embed/");
    expect(post.embedSpec.mechanism).toMatchObject({ kind: "official-embed-page" });

    const reel = buildInstagramPlaybackPlan({
      shortcode: "CxYzAbCdEfG",
      isReel: true,
      embedApproved: true,
    });
    if (reel.kind !== "official-embed") throw new Error("unreachable");
    expect(reel.embedSpec.embedUrl).toBe("https://www.instagram.com/reel/CxYzAbCdEfG/embed/");
    expect(String(reel.embedSpec.notes)).toMatch(/x-frame-options/i);
  });

  it("the watch bridge is total: non-Instagram, no-shortcode, default and approved", () => {
    const youtubeItem: CatalogItem = {
      id: "youtube:video:1",
      providerId: "youtube",
      title: "not instagram",
      mediaKind: "video",
      assets: [],
      metadata: {},
    };
    const wrongProvider = playbackPlanForInstagramCatalogItem(youtubeItem);
    expect(wrongProvider).toMatchObject({ kind: "unavailable", reason: "unsupported" });

    const noShortcode: CatalogItem = {
      id: "instagram:video:1",
      providerId: INSTAGRAM_PROVIDER_ID,
      title: "no shortcode",
      mediaKind: "short",
      assets: [],
      metadata: { externalIds: { instagram: "17895695668004550" } },
    };
    const noToken = playbackPlanForInstagramCatalogItem(noShortcode);
    expect(noToken).toMatchObject({ kind: "unavailable", reason: "unsupported" });
    if (noToken.kind !== "unavailable") throw new Error("unreachable");
    expect(noToken.recovery?.action).toBe("open-provider-app");

    const reelItem = catalogItemFromGraphMedia(mediaFixture.data[0]);
    if (reelItem === null) throw new Error("fixture reel row must map");
    const defaultPlan = playbackPlanForInstagramCatalogItem(reelItem);
    expect(defaultPlan).toMatchObject({ kind: "unavailable", reason: "requires-auth" });

    const approvedPlan = playbackPlanForInstagramCatalogItem(reelItem, { embedApproved: true });
    expect(approvedPlan.kind).toBe("official-embed");
    if (approvedPlan.kind !== "official-embed") throw new Error("unreachable");
    expect(approvedPlan.embedSpec.embedUrl).toBe(
      "https://www.instagram.com/reel/CxYzAbCdEfG/embed/",
    );
  });

  it("exposes the structural resolver adapter with allowsEmbedding FALSE (the honest default)", () => {
    expect(INSTAGRAM_PLAYBACK_CONNECTOR).toMatchObject({
      id: "instagram",
      providerId: INSTAGRAM_PROVIDER_ID,
      version: INSTAGRAM_MANIFEST_VERSION,
    });
    expect(INSTAGRAM_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(false);
    expect(INSTAGRAM_PLAYBACK_CONNECTOR.embed.urlTemplate).toBe(
      "https://www.instagram.com/p/{mediaId}/embed/",
    );
  });
});

// ---------------------------------------------------------------------------
// Service glue + honest-state mapping
// ---------------------------------------------------------------------------

describe("instagram service (media page with the honest drop report)", () => {
  it("maps the fixture page: 3 items, 1 image drop, 1 carousel drop, budget surfaced", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("/17841405822304914/media"),
        respond: () => jsonResponse(mediaFixture),
      },
    ]);
    const client = graphClient(fetch);
    const page = await myInstagramMedia(client, "17841405822304914");
    expect(page.items.length).toBe(3);
    expect(page.dropped).toEqual({ image: 1, carousel: 1, noId: 0 });
    expect(page.after).toBe("QVFIU1ZANbkTQeE5s");
    expect(page.hasMore).toBe(true);
    expect(page.budget.basis).toMatch(/4800/);
  });
});

describe("instagram honest-state mapping (typed errors → frozen §2.3)", () => {
  it("maps every honest state", () => {
    const rate = instagramCapabilityFromError(
      new InstagramRateLimitedError({
        operationId: "media.list",
        status: 429,
        message: "throttled",
      }),
    );
    expect(rate.status).toBe("rate-limited");

    const auth = instagramCapabilityFromError(
      new InstagramRequiresAuthError({
        operationId: "profile.read",
        status: 400,
        code: 190,
        message: "Invalid OAuth 2.0 Access Token",
      }),
    );
    expect(auth.status).toBe("requires-auth");

    const missing = instagramCapabilityFromError(
      new InstagramMissingCredentialError({ operationId: "media.list", message: "no token" }),
    );
    expect(missing.status).toBe("requires-auth");

    const notFound = instagramCapabilityFromError(
      new InstagramNotFoundError({ operationId: "insights.media", status: 404, message: "gone" }),
    );
    expect(notFound.status).toBe("unavailable");

    const apiError = instagramCapabilityFromError(
      new InstagramApiError({ operationId: "media.list", status: 500, message: "boom" }),
    );
    expect(apiError.status).toBe("unavailable");

    const offline = instagramCapabilityFromError(
      new LiveNetworkDisabledError("fixture-only build"),
    );
    expect(offline.status).toBe("unknown");

    const unexpected = instagramCapabilityFromError(new Error("surprise"));
    expect(unexpected.status).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Package-surface sanity
// ---------------------------------------------------------------------------

describe("instagram package surface", () => {
  it("carries the display name, manifest version and official-surface constants", () => {
    expect(INSTAGRAM_DISPLAY_NAME).toBe("Instagram");
    expect(INSTAGRAM_MANIFEST_VERSION).toBe("1.0.0");
    expect(INSTAGRAM_GRAPH_BASE).toBe("https://graph.facebook.com");
    expect(INSTAGRAM_API_VERSION).toBe("v26.0");
  });
});
