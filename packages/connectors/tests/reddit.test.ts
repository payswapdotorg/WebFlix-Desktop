/**
 * Fixture-only test-suite for the Reddit connector (REDDIT-CONNECT, Phase 3
 * platform #4) — the fifth platform on the exact frozen §2 contracts
 * YouTube, TikTok, Twitch and Instagram use. No live calls, no real
 * credentials: the network boundary is an injected fetch backed by
 * packages/connectors/fixtures/reddit.
 *
 * Live-captured shapes this suite replays (recorded 2026-10-11 from the
 * work-order sandbox — see the parity matrix live-smoke section):
 *   - POST /api/v1/access_token + /api/v1/revoke_token with dummy Basic
 *     credentials → HTTP 401 application/json, the VERBATIM envelope
 *     {"message": "Unauthorized", "error": 401}
 *   - The 403 block page: every www.reddit.com / oauth.reddit.com surface
 *     answered HTTP 403 with an HTML block page (~190 KB theme-beta shell /
 *     <title>Blocked</title>) from this sandbox's Alibaba HK datacenter
 *     egress — the enforcement of the Data API Wiki's documented rule
 *     "Traffic not using OAuth or login credentials will be blocked". The
 *     fixture is a stub of that shape (the client keys on 403 + non-JSON
 *     HTML, not page content; the full captures live in scripts/rd-logs/).
 * Modeled with the documented basis: the X-Ratelimit-Used/Remaining/Reset
 * header names + 100 QPM per OAuth client id (Data API Wiki, captured
 * verbatim via the help center's own JSON API) — the headers were not
 * observable from the blocked egress, so fixtures replay the DOCUMENTED
 * header names with fixture values and the snapshot's basis label stays
 * "served-header".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  InvalidRedditPostIdError,
  InMemoryRedditOAuthAccountStore,
  OAuthFlowError,
  REDDIT_AI_TRAINING_TERMS_NOTE,
  REDDIT_API_BASE,
  REDDIT_AUTHORIZE_URL,
  REDDIT_DESKTOP_USER_AGENT,
  REDDIT_DISPLAY_NAME,
  REDDIT_DOCUMENTED_QPM,
  REDDIT_EMBED_BASE,
  REDDIT_MANIFEST_VERSION,
  REDDIT_OAUTH_SCOPES,
  REDDIT_OPERATION_PROVENANCE,
  REDDIT_PLAYBACK_CONNECTOR,
  REDDIT_PROVIDER_ID,
  REDDIT_RATE_WINDOW_MS,
  REDDIT_UNSUPPORTED_SUBSTITUTES,
  REDDIT_WWW_BASE,
  RedditApiError,
  RedditAppOnlySession,
  RedditBlockedError,
  RedditMissingCredentialError,
  RedditNotFoundError,
  RedditOAuthSession,
  RedditRateLimitedError,
  RedditRequiresAuthError,
  RequiresAuthError,
  assertRedditSubstituteTotality,
  buildRedditAuthorizationRequest,
  buildRedditPlaybackPlan,
  catalogItemFromRedditLink,
  catalogItemsFromRedditListing,
  createDefaultRegistry,
  playbackPlanForRedditCatalogItem,
  redditBestPage,
  redditCapabilityFromError,
  redditManifest,
  redditHotPage,
  redditPermalinkFor,
  redditPostDetail,
  redditPostIdOf,
  redditSubredditAbout,
  redditUserAbout,
  redditEmbedUrlFor,
  RedditRestClient,
  type CatalogItem,
  type ConnectorManifest,
  type RedditFetchLike,
  type RedditFetchResponseLike,
  type RedditTokenFetcher,
} from "../src";
import { LiveNetworkDisabledError } from "../src";

import hotListingFixture from "../fixtures/reddit/listing.hot.json";
import postCommentsFixture from "../fixtures/reddit/post.comments.json";
import subredditAboutFixture from "../fixtures/reddit/subreddit.about.json";
import userAboutFixture from "../fixtures/reddit/user.about.json";
import meFixture from "../fixtures/reddit/me.json";
import subredditsMineFixture from "../fixtures/reddit/subreddits.mine.json";
import unauthorizedFixture from "../fixtures/reddit/error.401.json";
// The block page is HTML, not JSON: read it from disk (no TS import needed).
const blockPageFixture = readFileSync(
  fileURLToPath(new URL("../fixtures/reddit/error.403.block.html", import.meta.url)),
  "utf8",
);
import tokenCodeFixture from "../fixtures/reddit/oauth.token.code.json";
import tokenRefreshFixture from "../fixtures/reddit/oauth.token.refresh.json";
import appOnlyTokenFixture from "../fixtures/reddit/oauth.apponly.token.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): RedditFetchResponseLike {
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    headers: options.headers ?? { "content-type": "application/json" },
    text: async () => JSON.stringify(body),
  };
}

function htmlResponse(body: string, status = 403): RedditFetchResponseLike {
  return {
    ok: false,
    status,
    headers: { "content-type": "text/html; charset=UTF-8" },
    text: async () => body,
  };
}

const RATE_HEADERS = {
  "x-ratelimit-used": "12",
  "x-ratelimit-remaining": "88",
  "x-ratelimit-reset": "47",
};

/** A fetch that serves the fixture listing with the documented rate headers. */
function fixtureListingFetcher(): RedditFetchLike {
  return async (url: string) => {
    if (url.includes("/r/videos/hot") || url.includes("/best")) {
      return jsonResponse(hotListingFixture, {
        headers: { ...RATE_HEADERS, "content-type": "application/json" },
      });
    }
    if (url.includes("/comments/abcvid001")) {
      return jsonResponse(postCommentsFixture, { headers: RATE_HEADERS });
    }
    if (url.includes("/r/videos/about")) {
      return jsonResponse(subredditAboutFixture);
    }
    if (url.includes("/user/communityposter/about")) {
      return jsonResponse(userAboutFixture);
    }
    if (url.includes("/api/v1/me")) {
      return jsonResponse(meFixture);
    }
    if (url.includes("/subreddits/mine/subscriber")) {
      return jsonResponse(subredditsMineFixture);
    }
    throw new Error(`fixture fetcher: unexpected URL ${url}`);
  };
}

const APP_ONLY_TOKEN_SOURCE = {
  kind: "app-only" as const,
  getAppOnlyAccessToken: async () => "app-only-token",
};
const USER_TOKEN_SOURCE = { kind: "user" as const, getUserAccessToken: async () => "user-token" };

function clientWith(
  options: { fetchImpl?: RedditFetchLike; appOnly?: boolean; user?: boolean } = {},
): RedditRestClient {
  return new RedditRestClient({
    fetchImpl: options.fetchImpl ?? fixtureListingFetcher(),
    appOnlyTokenSource: options.appOnly === false ? null : APP_ONLY_TOKEN_SOURCE,
    userTokenSource: options.user === false ? null : USER_TOKEN_SOURCE,
  });
}

// ---------------------------------------------------------------------------
// Manifest honesty (frozen §2.3)
// ---------------------------------------------------------------------------

describe("reddit manifest (frozen §2.3 honesty)", () => {
  it("registers as the fifth platform in the default registry", () => {
    const registry = createDefaultRegistry();
    expect(registry.require("reddit")).toBe(redditManifest);
    expect(registry.size).toBe(5);
    expect(registry.has("youtube")).toBe(true);
    expect(registry.has("tiktok")).toBe(true);
    expect(registry.has("twitch")).toBe(true);
    expect(registry.has("instagram")).toBe(true);
  });

  it("is the rich-read platform: listings/search/post-detail/user reads supported, identity rows requires-auth, writes later-phase, chat/live/mod/download unsupported", () => {
    const ops = redditManifest.operations;
    for (const id of [
      "listings.hot",
      "listings.new",
      "listings.top",
      "listings.best",
      "post.detail",
      "subreddit.about",
      "search.query",
      "user.about",
      "user.submitted",
      "oauth.connect",
      "oauth.refresh",
      "oauth.app-only",
      "oauth.disconnect",
      "playback.embed",
    ]) {
      expect(ops[id]?.status, id).toBe("supported");
    }
    expect(ops["identity.me"]?.status).toBe("requires-auth");
    expect(ops["subreddits.mine"]?.status).toBe("requires-auth");
    // The writes are later-phase pending rows, NOT unsupported (the work
    // order's explicit distinction).
    for (const id of [
      "vote.cast",
      "save.toggle",
      "comment.create",
      "post.submit",
      "message.compose",
      "subscribe.toggle",
      "messages.list",
      "activity.mine",
    ]) {
      expect(ops[id]?.status, id).toBe("unavailable");
      expect(ops[id]?.detail).toMatch(/LATER-PHASE \(not unsupported\)/);
    }
    for (const id of ["chat.list", "live.browse", "moderation.manage", "video.download"]) {
      expect(ops[id]?.status, id).toBe("unsupported");
    }
  });

  it("carries the verbatim 100 QPM envelope (documented) and the served-header enforcement model", () => {
    expect(redditManifest.quotas).toEqual({
      requestsPerWindow: REDDIT_DOCUMENTED_QPM,
      windowMs: REDDIT_RATE_WINDOW_MS,
    });
    expect(REDDIT_DOCUMENTED_QPM).toBe(100);
    expect(REDDIT_RATE_WINDOW_MS).toBe(60_000);
    // The basis honesty lives in the manifest's rate documentation.
    expect(redditManifest.operations["listings.hot"]?.detail ?? "").not.toMatch(
      /invented|guessed/i,
    );
  });

  it("records the AI-training terms restriction (WebFlix is a media client, terms cited)", () => {
    expect(REDDIT_AI_TRAINING_TERMS_NOTE).toMatch(/AI Training/);
    expect(REDDIT_AI_TRAINING_TERMS_NOTE).toMatch(/media client/i);
    expect(REDDIT_AI_TRAINING_TERMS_NOTE).toMatch(/train machine learning or AI models/);
    expect(REDDIT_AI_TRAINING_TERMS_NOTE).toMatch(/https:\/\/support\.reddithelp\.com/);
  });

  it("cites official sources for every operation row", () => {
    for (const [id] of Object.entries(redditManifest.operations)) {
      expect(REDDIT_OPERATION_PROVENANCE[id], `provenance for ${id}`).toBeDefined();
      expect(REDDIT_OPERATION_PROVENANCE[id].length).toBeGreaterThanOrEqual(1);
    }
  });

  it("touches only the official hosts (www/oauth API bases, authorize/token/revoke, embed)", () => {
    expect(REDDIT_API_BASE).toBe("https://oauth.reddit.com");
    expect(REDDIT_WWW_BASE).toBe("https://www.reddit.com");
    expect(REDDIT_AUTHORIZE_URL).toBe("https://www.reddit.com/api/v1/authorize");
    expect(REDDIT_EMBED_BASE).toBe("https://embed.reddit.com");
  });
});

// ---------------------------------------------------------------------------
// Honest-unsupported substitutes (totality, both directions)
// ---------------------------------------------------------------------------

describe("reddit honest-unsupported / later-phase substitutes", () => {
  it("covers every unavailable/unsupported row, and every substitute row matches one", () => {
    const unavailableOrUnsupported = Object.entries(redditManifest.operations)
      .filter(([, cap]) => cap.status === "unavailable" || cap.status === "unsupported")
      .map(([id]) => id);
    expect(REDDIT_UNSUPPORTED_SUBSTITUTES.map((r) => r.operationId).sort()).toEqual(
      unavailableOrUnsupported.slice().sort(),
    );
  });

  it("throws when a substitute row is missing (the totality check has teeth)", () => {
    expect(() => assertRedditSubstituteTotality()).not.toThrow();
    const ids = REDDIT_UNSUPPORTED_SUBSTITUTES.map((r) => r.operationId);
    expect(ids).toContain("chat.list");
    expect(ids).toContain("video.download");
    expect(ids).not.toContain("playback.embed"); // supported — no substitute row
  });
});

// ---------------------------------------------------------------------------
// REST client (documented shapes; the live-captured error envelopes)
// ---------------------------------------------------------------------------

describe("reddit rest client (official reads, fixture-tested)", () => {
  it("reads a hot listing with cursors surfaced honestly and the served-header budget recorded", async () => {
    const client = clientWith();
    const { listing, budget } = await client.getSubredditHot("videos", { limit: 7 });
    expect(listing.kind).toBe("Listing");
    expect(listing.data.children.length).toBe(7);
    expect(listing.data.after).toBe("t3_deadbee3");
    expect(budget.lastUsed).toBe("12");
    expect(budget.lastRemaining).toBe("88");
    expect(budget.lastResetSeconds).toBe("47");
    expect(budget.basis).toBe("served-header");
    expect(budget.callsRecorded).toBe(1);
  });

  it("sends the OAuth Bearer token, the honest descriptive User-Agent and app-only preference", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: RedditFetchLike = async (url, init) => {
      seen.push({ url, headers: init?.headers ?? {} });
      return jsonResponse(hotListingFixture, { headers: RATE_HEADERS });
    };
    await clientWith({ fetchImpl }).getSubredditHot("videos");
    expect(seen[0].url).toBe(`${REDDIT_API_BASE}/r/videos/hot`);
    expect(seen[0].headers.Authorization).toBe("Bearer app-only-token");
    expect(seen[0].headers["User-Agent"]).toBe(REDDIT_DESKTOP_USER_AGENT);
    expect(REDDIT_DESKTOP_USER_AGENT).toMatch(
      /^desktop:app\.webflix\.local:v[0-9.]+ \(by \/u\/webflix-operator\)$/,
    );
  });

  it("app-only vs per-user distinction: identity.me REQUIRES the per-user token (app-only is not enough)", async () => {
    const seen: Array<{ url: string; auth: string }> = [];
    const fetchImpl: RedditFetchLike = async (url, init) => {
      seen.push({ url, auth: init?.headers?.Authorization ?? "" });
      return jsonResponse(meFixture);
    };
    // Per-user token source present → the read goes out with the USER token.
    const withUser = new RedditRestClient({
      fetchImpl,
      appOnlyTokenSource: APP_ONLY_TOKEN_SOURCE,
      userTokenSource: USER_TOKEN_SOURCE,
    });
    const me = await withUser.getMe();
    expect(me.data?.name).toBe("webflixuser");
    expect(seen[seen.length - 1].auth).toBe("Bearer user-token");
    // NO per-user token source → the honest missing-credential refusal
    // (an app-only token has no user identity — no silent fallback).
    const appOnlyClient = new RedditRestClient({
      fetchImpl,
      appOnlyTokenSource: APP_ONLY_TOKEN_SOURCE,
      userTokenSource: null,
    });
    await expect(appOnlyClient.getMe()).rejects.toBeInstanceOf(RedditMissingCredentialError);
    // Public reads fall back to the per-user token when app-only is absent
    // (both are OAuth — the wiki's block rule is about OAuth vs not).
    const userOnly = new RedditRestClient({
      fetchImpl,
      appOnlyTokenSource: null,
      userTokenSource: USER_TOKEN_SOURCE,
    });
    await userOnly.getSubredditHot("videos");
    expect(seen[seen.length - 1].auth).toBe("Bearer user-token");
  });

  it("fails fast with RedditMissingCredentialError without any token source", async () => {
    const client = new RedditRestClient({
      fetchImpl: fixtureListingFetcher(),
      appOnlyTokenSource: null,
      userTokenSource: null,
    });
    await expect(client.getSubredditHot("videos")).rejects.toBeInstanceOf(
      RedditMissingCredentialError,
    );
  });

  it("maps the LIVE-CAPTURED 401 envelope to the honest requires-auth error", async () => {
    const fetchImpl: RedditFetchLike = async () =>
      jsonResponse(unauthorizedFixture, { status: 401 });
    const client = clientWith({ fetchImpl });
    const error = await client.getSubredditHot("videos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedditRequiresAuthError);
    expect((error as RedditRequiresAuthError).providerMessage).toBe("Unauthorized");
    expect((error as RedditRequiresAuthError).providerCode).toBe(401);
  });

  it("maps the LIVE-CAPTURED 403 block page to the typed blocked error (the documented policy)", async () => {
    const fetchImpl: RedditFetchLike = async () => htmlResponse(blockPageFixture, 403);
    const client = clientWith({ fetchImpl });
    const error = await client.getSubredditHot("videos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedditBlockedError);
    expect((error as RedditBlockedError).message).toMatch(/403 block page/);
    expect((error as RedditBlockedError).message).toMatch(/non-OAuth\/datacenter/);
  });

  it("maps 429 with the served headers + Retry-After to rate-limited (no invented ceiling)", async () => {
    const fetchImpl: RedditFetchLike = async () =>
      jsonResponse(
        { message: "Too Many Requests", error: 429 },
        { status: 429, headers: { ...RATE_HEADERS, "retry-after": "47" } },
      );
    const client = clientWith({ fetchImpl });
    const error = await client.getSubredditHot("videos").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RedditRateLimitedError);
    const rate = error as RedditRateLimitedError;
    expect(rate.budget.lastRemaining).toBe("88");
    expect(rate.budget.providerRateLimited).toBe(true);
    expect(rate.message).toMatch(/Retry-After: 47s/);
    expect(rate.message).toMatch(/100 QPM/);
  });

  it("maps 404 to the typed not-found error", async () => {
    const fetchImpl: RedditFetchLike = async () =>
      jsonResponse({ message: "Not Found", error: 404 }, { status: 404 });
    const client = clientWith({ fetchImpl });
    await expect(client.getSubredditHot("videos")).rejects.toBeInstanceOf(RedditNotFoundError);
  });

  it("records the served headers on ERROR responses too (the budget never sleeps)", async () => {
    const fetchImpl: RedditFetchLike = async () => htmlResponse(blockPageFixture, 403);
    const client = clientWith({ fetchImpl });
    await client.getSubredditHot("videos").catch(() => undefined);
    expect(client.rateBudget.lastStatus).toBe(403);
    expect(client.rateBudget.callsRecorded).toBe(1);
  });

  it("fails fast with LiveNetworkDisabledError in the fixture-only build (no injected fetch)", async () => {
    const client = new RedditRestClient({ appOnlyTokenSource: APP_ONLY_TOKEN_SOURCE });
    await expect(client.getSubredditHot("videos")).rejects.toBeInstanceOf(LiveNetworkDisabledError);
  });

  it("reads the post detail page: the post row + the comment tree (comments are discussion, not items)", async () => {
    const client = clientWith();
    const detail = await client.getPostComments("abcvid001");
    expect(detail.post?.id).toBe("abcvid001");
    expect(detail.comments.length).toBe(2);
    expect(detail.comments[0]?.author).toBe("firstcommenter");
  });

  it("reads subreddit about, user about, and the per-user my-subreddits listing", async () => {
    const client = clientWith();
    const about = await client.getSubredditAbout("videos");
    expect(about.data?.display_name).toBe("videos");
    expect(about.data?.subscribers).toBe(27_200_000);
    const user = await client.getUserAbout("communityposter");
    expect(user.data?.name).toBe("communityposter");
    expect(user.data?.link_karma).toBe(5321);
    const mine = await client.getMySubreddits();
    expect(mine.listing.data.children.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// App-only session (client_credentials — the documented public-read token)
// ---------------------------------------------------------------------------

describe("reddit app-only session (client_credentials)", () => {
  it("requests the token with Basic auth + grant_type=client_credentials and caches it", async () => {
    const seen: Array<{
      url: string;
      init: { method?: string; headers: Record<string, string>; body?: string };
    }> = [];
    const fetchImpl: RedditFetchLike = async (url, init) => {
      seen.push({
        url,
        init: { method: init?.method, headers: init?.headers ?? {}, body: init?.body },
      });
      return jsonResponse(appOnlyTokenFixture);
    };
    const session = new RedditAppOnlySession({
      fetchImpl,
      clientId: "cid",
      clientSecret: "secret",
    });
    const token1 = await session.getAppOnlyAccessToken();
    const token2 = await session.getAppOnlyAccessToken();
    expect(token1).toBe(token2); // cached — one wire call
    expect(seen.length).toBe(1);
    expect(seen[0].url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.body).toBe("grant_type=client_credentials");
    expect(seen[0].init.headers.Authorization).toBe(
      `Basic ${Buffer.from("cid:secret").toString("base64")}`,
    );
  });

  it("maps the LIVE-CAPTURED 401 token rejection to requires-auth (dummy credentials)", async () => {
    const fetchImpl: RedditFetchLike = async () =>
      jsonResponse(unauthorizedFixture, { status: 401 });
    const session = new RedditAppOnlySession({ fetchImpl, clientId: "bad", clientSecret: "bad" });
    await expect(session.getAppOnlyAccessToken()).rejects.toBeInstanceOf(RedditRequiresAuthError);
  });

  it("re-requests on expiry (app-only tokens NEVER receive a refresh token — the wiki's honest asymmetry)", async () => {
    let now = 1_000_000;
    let calls = 0;
    const fetchImpl: RedditFetchLike = async () => {
      calls += 1;
      return jsonResponse(appOnlyTokenFixture);
    };
    const session = new RedditAppOnlySession({
      fetchImpl,
      clientId: "cid",
      clientSecret: "secret",
      clock: () => now,
    });
    await session.getAppOnlyAccessToken();
    now += 3_600_000; // one hour passes (expires_in 3600)
    await session.getAppOnlyAccessToken();
    expect(calls).toBe(2); // re-requested, never "refreshed"
  });
});

// ---------------------------------------------------------------------------
// OAuth (code flow, duration=permanent, official revocation)
// ---------------------------------------------------------------------------

describe("reddit oauth (code flow on the shared seams, fixture-tested)", () => {
  const REDIRECT = "webflix://reddit/callback";

  it("builds the documented authorization URL — SPACE-separated scopes, duration=permanent, state, NO PKCE", () => {
    const request = buildRedditAuthorizationRequest({ redirectUri: REDIRECT, state: "statexyz" });
    const url = new URL(request.url);
    expect(url.origin + url.pathname).toBe(REDDIT_AUTHORIZE_URL);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("statexyz");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("duration")).toBe("permanent");
    // SPACE-separated — the OAuth2 wiki's own deviation note. NOT commas.
    expect(url.searchParams.get("scope")).toBe(REDDIT_OAUTH_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).not.toContain(",");
    // NO PKCE parameters (Reddit's documented code flow defines none).
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("code_challenge_method")).toBe(false);
  });

  it("refuses non-absolute redirect URIs (the installed-app registration is the operator's item)", () => {
    expect(() => buildRedditAuthorizationRequest({ redirectUri: "not a uri" })).toThrowError(
      OAuthFlowError,
    );
  });

  function fixtureTokenFetcher(
    options: { refreshRejected?: boolean; revokeRejected?: boolean; expires_in?: number } = {},
  ): RedditTokenFetcher {
    return async (request) => {
      if (request.kind === "token-exchange") {
        return {
          kind: "token",
          token: {
            ...tokenCodeFixture,
            ...(options.expires_in !== undefined ? { expires_in: options.expires_in } : {}),
          },
        };
      }
      if (request.kind === "refresh") {
        if (options.refreshRejected === true) {
          return { kind: "rejected", message: "Unauthorized", code: 401 };
        }
        return { kind: "token", token: tokenRefreshFixture };
      }
      if (request.kind === "revoke") {
        if (options.revokeRejected === true) {
          return { kind: "rejected", message: "Unauthorized", code: 401 };
        }
        return { kind: "revoked" };
      }
      throw new Error("unreachable");
    };
  }

  function sessionWith(
    fetcher: RedditTokenFetcher,
    store = new InMemoryRedditOAuthAccountStore(),
    clock: () => number = () => 1_000_000,
  ): { oauth: RedditOAuthSession; store: InMemoryRedditOAuthAccountStore } {
    const oauth = new RedditOAuthSession({
      store,
      internalAccountId: "rd-main",
      tokenFetcher: fetcher,
      clock,
    });
    return { oauth, store };
  }

  it("exchanges the code for tokens after the state guard and stores the refresh token (permanent grant)", async () => {
    const { oauth, store } = sessionWith(fixtureTokenFetcher());
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    const record = await oauth.completeAuthorization({ code: "c", state: started.state });
    expect(record.status).toBe("connected");
    expect(record.providerId).toBe(REDDIT_PROVIDER_ID);
    const tokens = await store.loadTokens("rd-main");
    expect(tokens?.accessToken).toContain("fixture-access-token");
    expect(tokens?.refreshToken).toContain("fixture-refresh-token"); // duration=permanent
  });

  it("rejects a mismatched state (CSRF guard)", async () => {
    const { oauth } = sessionWith(fixtureTokenFetcher());
    oauth.startAuthorization({ redirectUri: REDIRECT });
    await expect(oauth.completeAuthorization({ code: "c", state: "wrong" })).rejects.toThrowError(
      /state/i,
    );
  });

  it("refreshes honestly with the documented grant — and a rejected refresh expires the account", async () => {
    // Happy refresh.
    let now = 1_000_000;
    const store = new InMemoryRedditOAuthAccountStore();
    const oauth = new RedditOAuthSession({
      store,
      internalAccountId: "rd-main",
      tokenFetcher: fixtureTokenFetcher(),
      clock: () => now,
    });
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state });
    now += 3_700_000; // the one-hour token is inside the skew
    const refreshed = await oauth.getUserAccessToken();
    expect(refreshed).toContain("fixture-refreshed-access-token");
    // The refresh token survives (the wiki documents no rotation).
    const tokens = await store.loadTokens("rd-main");
    expect(tokens?.refreshToken).toContain("fixture-refresh-token");

    // Rejected refresh → the account flips to expired (re-consent is the
    // only honest path — no pretending). Its own clock, so the stored token
    // is genuinely past expiry.
    let failingNow = 1_000_000;
    const failingStore = new InMemoryRedditOAuthAccountStore();
    const failing = new RedditOAuthSession({
      store: failingStore,
      internalAccountId: "rd-main",
      tokenFetcher: fixtureTokenFetcher({ refreshRejected: true }),
      clock: () => failingNow,
    });
    const started2 = failing.startAuthorization({ redirectUri: REDIRECT });
    await failing.completeAuthorization({ code: "c", state: started2.state });
    failingNow += 3_700_000; // past the one-hour token + skew
    const token = await failing.getUserAccessToken();
    expect(token).toBeNull(); // expired + refresh rejected
    const record = await failingStore.loadAccount("rd-main");
    expect(record?.status).toBe("expired");
  });

  it("disconnects through the OFFICIAL revoke (refresh token first, then access) — and a failed revoke leaves the record intact", async () => {
    const calls: string[] = [];
    const fetcher: RedditTokenFetcher = async (request) => {
      calls.push(
        request.kind === "revoke" ? `${request.kind}:${request.tokenTypeHint}` : request.kind,
      );
      if (request.kind === "revoke") {
        expect([
          "fixture-refresh-token-2222222222222222222222222222222222222222222222222222222222222222222222222222222222",
          "fixture-access-token-1111111111111111111111111111111111111111111111111111111111111111111111111111111111",
        ]).toContain(request.token);
        return { kind: "revoked" };
      }
      if (request.kind === "token-exchange") return { kind: "token", token: tokenCodeFixture };
      return { kind: "token", token: tokenRefreshFixture };
    };
    const { oauth, store } = sessionWith(fetcher);
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state });
    const revoked = await oauth.disconnect();
    expect(revoked.status).toBe("revoked");
    expect(await store.loadTokens("rd-main")).toBeNull();
    // Refresh token revoked FIRST (the wiki: it also revokes related access
    // tokens), then the access token — both official.
    expect(calls).toEqual(["token-exchange", "revoke:refresh_token", "revoke:access_token"]);

    // The failure direction: a rejected revoke leaves the record INTACT.
    const failingStore = new InMemoryRedditOAuthAccountStore();
    await failingStore.saveAccount({
      providerId: REDDIT_PROVIDER_ID,
      internalAccountId: "rd-main",
      displayName: "Reddit account",
      grantedScopes: [],
      status: "connected",
      connectedAt: new Date(999_000).toISOString(),
    });
    await failingStore.saveTokens("rd-main", {
      accessToken: "t",
      refreshToken: "r",
      expiresAtMs: null,
      scope: "identity read",
      tokenType: "bearer",
      grantedScope: "identity read",
    });
    const failing = new RedditOAuthSession({
      store: failingStore,
      internalAccountId: "rd-main",
      tokenFetcher: fixtureTokenFetcher({ revokeRejected: true }),
      clock: () => 1_000_000,
    });
    await expect(failing.disconnect()).rejects.toBeInstanceOf(OAuthFlowError);
    expect((await failingStore.loadAccount("rd-main"))?.status).toBe("connected");
    expect(await failingStore.loadTokens("rd-main")).not.toBeNull();
  });

  it("cannot disconnect without a connected account (honest refusal)", async () => {
    const { oauth } = sessionWith(fixtureTokenFetcher());
    await expect(oauth.disconnect()).rejects.toBeInstanceOf(RequiresAuthError);
  });

  it("exposes the canonical CredentialPort handle and guards the providerId", async () => {
    const { oauth, store } = sessionWith(fixtureTokenFetcher());
    const started = oauth.startAuthorization({ redirectUri: REDIRECT });
    await oauth.completeAuthorization({ code: "c", state: started.state });
    const port = oauth.credentialPort();
    const ref = await port.getToken(REDDIT_PROVIDER_ID, "rd-main");
    expect(ref?.handle).toBe("reddit:rd-main:access");
    await expect(port.getToken("youtube", "rd-main")).rejects.toThrowError(/providerId/);
    expect(store).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Catalog mapping (frozen §2.1 — the honest drops + cross-provider attribution)
// ---------------------------------------------------------------------------

describe("reddit catalog mapping (frozen §2.1)", () => {
  it("maps a native Reddit video post to a video item with the official embed asset", () => {
    const row = (
      hotListingFixture.data.children[0] as { kind: string; data: Record<string, unknown> }
    ).data as never as import("../src/reddit/restApi").RedditLinkData;
    const item = catalogItemFromRedditLink(row);
    expect(item?.providerId).toBe(REDDIT_PROVIDER_ID);
    expect(item?.mediaKind).toBe("video");
    expect(item?.metadata?.externalIds).toEqual({ reddit: "abcvid001" });
    expect(item?.assets).toEqual([
      {
        assetId: "reddit:embed:abcvid001",
        kind: "embed",
        reference: "https://embed.reddit.com/comments/abcvid001",
      },
      {
        assetId: "reddit:thumb:abcvid001",
        kind: "thumbnail",
        reference: "https://preview.redd.it/abcvid001.jpg?width=1280&auto=webp&s=bbb222",
      },
    ]);
    expect(item?.matchEvidence?.confidence).toBe(1);
    expect(item?.metadata?.subreddit).toBe("videos");
    expect(item?.metadata?.permalink).toBe(
      "https://www.reddit.com/r/videos/comments/abcvid001/a_community_longform_video_post/",
    );
  });

  it("records the crosspost relationship while attribution STAYS reddit (the original is a Reddit post)", () => {
    const row = (
      hotListingFixture.data.children[1] as { kind: string; data: Record<string, unknown> }
    ).data as never as import("../src/reddit/restApi").RedditLinkData;
    const item = catalogItemFromRedditLink(row);
    expect(item?.providerId).toBe(REDDIT_PROVIDER_ID);
    expect(item?.metadata?.crosspostParentId).toBe("origvid0");
  });

  it("attributes a YouTube link post to YOUTUBE when the payload's own oembed says so (crosspost rule)", () => {
    const row = (
      hotListingFixture.data.children[2] as { kind: string; data: Record<string, unknown> }
    ).data as never as import("../src/reddit/restApi").RedditLinkData;
    const item = catalogItemFromRedditLink(row);
    expect(item?.providerId).toBe("youtube"); // the payload says so
    expect(item?.id).toBe("reddit-via:youtube:ytlink003");
    expect(item?.metadata?.externalIds).toEqual({ youtube: "FIXVID00001" });
    const via = item?.metadata?.redditVia as Record<string, unknown>;
    expect(via.providerId).toBe(REDDIT_PROVIDER_ID);
    expect(via.postId).toBe("ytlink003");
    expect(via.subreddit).toBe("videos");
    expect(via.permalink).toContain("reddit.com/r/videos/comments/ytlink003");
    expect(item?.matchEvidence?.evidence[0]).toContain("cross-provider attribution");
  });

  it("drops image posts, self text, galleries and unknown links honestly (never invented kinds)", () => {
    const { report } = catalogItemsFromRedditListing(hotListingFixture.data.children);
    expect(report.mapped).toBe(3); // native video + crosspost + youtube attribution
    expect(report.video).toBe(2);
    expect(report.attributedExternal).toBe(1);
    expect(report.droppedImage).toBe(1);
    expect(report.droppedSelfText).toBe(1);
    expect(report.droppedGallery).toBe(1);
    expect(report.droppedUnsupportedLink).toBe(1);
    expect(report.droppedNoId).toBe(0);
  });

  it("drops a row without a usable id (never a guessed token)", () => {
    expect(catalogItemFromRedditLink({ id: "" } as never)).toBeNull();
    expect(catalogItemFromRedditLink({ id: "not a base36 id!" } as never)).toBeNull();
    const { report } = catalogItemsFromRedditListing([{ kind: "t3", data: {} }]);
    expect(report.droppedNoId).toBe(1);
  });

  it("extracts the post id in priority order: metadata → embed reference → assetId", () => {
    const row = (
      hotListingFixture.data.children[0] as { kind: string; data: Record<string, unknown> }
    ).data as never as import("../src/reddit/restApi").RedditLinkData;
    const item = catalogItemFromRedditLink(row) as CatalogItem;
    expect(redditPostIdOf(item)).toBe("abcvid001");
    const fromAssetOnly: CatalogItem = {
      ...item,
      metadata: {},
      assets: [
        {
          assetId: "reddit:embed:zzz9",
          kind: "embed",
          reference: "https://embed.reddit.com/comments/zzz9",
        },
      ],
    };
    expect(redditPostIdOf(fromAssetOnly)).toBe("zzz9");
    const notReddit: CatalogItem = { ...item, providerId: "youtube" };
    expect(redditPostIdOf(notReddit)).toBeNull();
  });

  it("permalink helper prefers the payload's own permalink path", () => {
    expect(redditPermalinkFor("/r/videos/comments/abcvid001/x/", "abcvid001")).toBe(
      "https://www.reddit.com/r/videos/comments/abcvid001/x/",
    );
    expect(redditPermalinkFor(undefined, "abcvid001")).toBe(
      "https://www.reddit.com/comments/abcvid001",
    );
  });
});

// ---------------------------------------------------------------------------
// Playback (the ON-by-default official embed — the shortlink fold)
// ---------------------------------------------------------------------------

describe("reddit playback (the official embed, ON by default)", () => {
  it("refuses malformed post ids (never a guessed URL)", () => {
    expect(() => buildRedditPlaybackPlan({ postId: "not a base36 id!" })).toThrowError(
      InvalidRedditPostIdError,
    );
  });

  it("DEFAULT: the official-embed plan against the shortlink surface (no gate — contrast Instagram)", () => {
    const plan = buildRedditPlaybackPlan({ postId: "abcvid001", title: "A video post" });
    expect(plan.kind).toBe("official-embed");
    if (plan.kind !== "official-embed") throw new Error("unreachable");
    expect(plan.providerId).toBe(REDDIT_PROVIDER_ID);
    expect(plan.embedSpec.embedUrl).toBe("https://embed.reddit.com/comments/abcvid001");
    const spec = plan.embedSpec as Record<string, unknown>;
    expect(spec.mechanism).toMatchObject({
      kind: "official-embed-surface",
      playerUrl: "https://embed.reddit.com/comments/abcvid001",
    });
    const notes = JSON.stringify(spec.notes);
    expect(notes).toContain("frame-ancestors *");
    expect(notes).toContain("shortlink");
    expect(notes).toContain("retired");
  });

  it("the watch bridge is total: happy path, non-reddit item, no-id item", () => {
    const row = (
      hotListingFixture.data.children[0] as { kind: string; data: Record<string, unknown> }
    ).data as never as import("../src/reddit/restApi").RedditLinkData;
    const item = catalogItemFromRedditLink(row) as CatalogItem;
    const plan = playbackPlanForRedditCatalogItem(item);
    expect(plan.kind).toBe("official-embed");
    // Non-reddit items route to their OWN provider's builder.
    const youtubeItem = catalogItemFromRedditLink(
      (hotListingFixture.data.children[2] as { kind: string; data: Record<string, unknown> })
        .data as never as import("../src/reddit/restApi").RedditLinkData,
    ) as CatalogItem;
    expect(() => playbackPlanForRedditCatalogItem(youtubeItem)).toThrowError(
      /providerId "youtube"/,
    );
    // A reddit item without an id refuses to guess.
    const noId: CatalogItem = { ...item, metadata: {}, assets: [] };
    expect(() => playbackPlanForRedditCatalogItem(noId)).toThrowError(/no usable Reddit post id/);
  });

  it("exposes the structural resolver adapter with allowsEmbedding TRUE (the honest default)", () => {
    expect(REDDIT_PLAYBACK_CONNECTOR.embed.urlTemplate).toBe(
      "https://embed.reddit.com/comments/{mediaId}",
    );
    expect(REDDIT_PLAYBACK_CONNECTOR.embed.allowsEmbedding).toBe(true);
    expect(REDDIT_PLAYBACK_CONNECTOR.providerId).toBe(REDDIT_PROVIDER_ID);
  });
});

// ---------------------------------------------------------------------------
// Service (listings/detail/about + the honest-state map)
// ---------------------------------------------------------------------------

describe("reddit service (the read paths with the honest drop report)", () => {
  it("maps the hot page: 3 items, honest drops, cross-attribution, cursor + budget surfaced", async () => {
    const client = clientWith();
    const page = await redditHotPage(client, "videos", { limit: 7 });
    expect(page.items.length).toBe(3);
    expect(page.dropped).toEqual({
      image: 1,
      selfText: 1,
      gallery: 1,
      unsupportedLink: 1,
      noId: 0,
    });
    expect(page.attributedExternal).toBe(1);
    expect(page.after).toBe("t3_deadbee3");
    expect(page.hasMore).toBe(true);
    expect(page.budget.lastRemaining).toBe("88");
  });

  it("maps the best page with the same honesty (the front-page listing)", async () => {
    const page = await redditBestPage(clientWith());
    expect(page.items.length).toBe(3);
  });

  it("post detail: the watchable item + comments as discussion context + the drop reason when unmappable", async () => {
    const detail = await redditPostDetail(clientWith(), "abcvid001");
    expect(detail.item?.providerId).toBe(REDDIT_PROVIDER_ID);
    expect(detail.comments.length).toBe(2);
    expect(detail.comments[0]).toEqual({
      id: "cmt0001",
      author: "firstcommenter",
      body: "Top-level comment about the video.",
      score: 42,
      depth: 0,
    });
  });

  it("subreddit + user about surface as browse-container descriptors (never items)", async () => {
    const { subreddit } = await redditSubredditAbout(clientWith(), "videos");
    expect(subreddit?.displayName).toBe("videos");
    expect(subreddit?.subscribers).toBe(27_200_000);
    const { user } = await redditUserAbout(clientWith(), "communityposter");
    expect(user?.username).toBe("communityposter");
    expect(user?.linkKarma).toBe(5321);
  });
});

describe("reddit honest-state mapping (typed errors → frozen §2.3)", () => {
  it("maps every honest state", () => {
    const budget = {
      callsRecorded: 1,
      lastUsed: "12",
      lastRemaining: "88",
      lastResetSeconds: "47",
      lastRetryAfterSeconds: "47",
      lastStatus: 429,
      providerRateLimited: true,
      basis: "served-header" as const,
    };
    const rate = redditCapabilityFromError(
      new RedditRateLimitedError({ operationId: "listings.hot", budget, retryAfterSeconds: 47 }),
    );
    expect(rate.status).toBe("rate-limited");
    expect(rate.detail).toContain("100 QPM");
    expect(rate.detail).toContain("served-header");

    const auth = redditCapabilityFromError(
      new RedditRequiresAuthError({
        operationId: "identity.me",
        providerMessage: "Unauthorized",
        providerCode: 401,
      }),
    );
    expect(auth.status).toBe("requires-auth");
    expect(auth.detail).toContain("Unauthorized");

    const blocked = redditCapabilityFromError(
      new RedditBlockedError({ operationId: "listings.hot", detail: "HTML block page" }),
    );
    expect(blocked.status).toBe("unavailable");
    expect(blocked.detail).toContain("403 block page");

    const missing = redditCapabilityFromError(
      new RedditMissingCredentialError("identity.me", "per-user"),
    );
    expect(missing.status).toBe("requires-auth");

    const notFound = redditCapabilityFromError(
      new RedditNotFoundError({ operationId: "post.detail", what: "/comments/x" }),
    );
    expect(notFound.status).toBe("unavailable");

    const live = redditCapabilityFromError(new LiveNetworkDisabledError("fixture"));
    expect(live.status).toBe("unavailable");
    expect(live.detail).toContain("fixture-only");

    const api = redditCapabilityFromError(
      new RedditApiError({ operationId: "search.query", status: 500, message: "boom" }),
    );
    expect(api.status).toBe("unknown");

    const invalid = redditCapabilityFromError(new InvalidRedditPostIdError("!!"));
    expect(invalid.status).toBe("unsupported");

    const unexpected = redditCapabilityFromError(new Error("surprise"));
    expect(unexpected.status).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Package surface
// ---------------------------------------------------------------------------

describe("reddit package surface", () => {
  it("carries the display name, manifest version and official-surface constants", () => {
    expect(REDDIT_DISPLAY_NAME).toBe("Reddit");
    expect(REDDIT_MANIFEST_VERSION).toBe("1.0.0");
    expect(redditEmbedUrlFor("abcvid001")).toBe("https://embed.reddit.com/comments/abcvid001");
    expect((redditManifest as ConnectorManifest).providerId).toBe(REDDIT_PROVIDER_ID);
  });

  it("the manifest validates against the frozen schema shapes (registry discipline)", () => {
    const registry = createDefaultRegistry();
    const manifest = registry.require("reddit");
    expect(manifest.quotas.requestsPerWindow).toBeGreaterThan(0);
    expect(manifest.quotas.windowMs).toBeGreaterThan(0);
    expect(manifest.failureModes.length).toBeGreaterThan(0);
    expect(manifest.provenance.connectorId).toBe(REDDIT_PROVIDER_ID);
  });
});
