/**
 * WFX-PROVIDER-SLICE-1 (Worker 2) — the YouTube media vertical slice's
 * hermetic integration battery (fixture fetch only, ZERO live network, ZERO
 * real credentials — the network boundary is an injected fetch backed by
 * packages/connectors/fixtures/youtube/*.json, the established convention).
 *
 * What this suite pins, block by block:
 *   1. THE LIVE COMPOSITION ROOT (freeze §9.5 DATA API KEY LAW): the key
 *      VALUE arrives only through the injected YouTubeApiKeySource port; no
 *      key (absent, null, blank, or a FAILING source) answers the TYPED
 *      requires-auth OUTCOME OBJECT — never a thrown crash; a configured key
 *      builds the live client over the REAL global fetch by default (pinned
 *      by stubbing globalThis.fetch) or an injected fetch; the quota ledger
 *      redacts `key=REDACTED` while the wire request carries the real key.
 *   2. THE ENGINE ADAPTER (YouTubeCatalogSourceAdapter): search (with the
 *      documented 1-unit enrichment read merging viewCount/durationMs),
 *      channel search (snippet facts only — subscriberCount stays absent),
 *      trending chart (facts on the response), channels.list by id AND by
 *      handle (the official forHandle param — normalization pinned), the
 *      uploads shelf (channels.list contentDetails + playlistItems.list +
 *      enrichment), and every honest state as DATA (quota → rate-limited
 *      capability, network failure → unavailable, no key → requires-auth,
 *      provider no-such-channel → { channel: null }).
 *   3. THE STRUCTURAL PORT PINNING: the adapter satisfies the
 *      application-owned YouTubeCatalogSource port and the search source
 *      satisfies webflix-application's SearchSourcePort — compile-time
 *      assignments against the REAL app-side port declarations (type-only
 *      imports; erased at runtime, so no package edge exists at runtime),
 *      which is exactly how shape drift between the two packages fails the
 *      connectors typecheck.
 *   4. THE FEDERATED-SEARCH SOURCE (YouTubeSearchSource): ok pages with the
 *      canonical CatalogItems + cursor paging, the documented honest-state
 *      mapping (requires-auth → auth-required; rate-limited/quota →
 *      partial-failure with the full honest reason; unsupported →
 *      unsupported), and boundary cancellation (typed common/cancelled).
 */
import { describe, expect, it, vi } from "vitest";

import type { FetchLike, FetchResponseLike } from "../src";
import {
  LiveNetworkDisabledError,
  NotFoundError,
  YouTubeDataApiClient,
  normalizeHandleParam,
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
} from "../src";
import {
  createLiveYouTubeComposition,
  YOUTUBE_API_KEY_CONFIGURATION_HINT,
  type YouTubeApiKeySource,
} from "../src/youtube/liveComposition";
import { YouTubeCatalogSourceAdapter } from "../src/youtube/mediaSource";
import { YouTubeSearchSource } from "../src/youtube/searchSourceAdapter";
import { ErrorCode } from "webflix-contracts";
import type { CatalogItem, SearchOutcome } from "webflix-contracts";

// The REAL app-side port declarations — TYPE-ONLY imports (erased at runtime:
// no cross-package runtime edge; the compile-time assignments below are the
// drift pins the connectors typecheck enforces over tests/).
import type { YouTubeCatalogSource as AppEnginePort } from "../../webflix-application/src/media/youtube-source-port";
import type { SearchSourcePort as AppSearchSourcePort } from "../../webflix-application/src/ports";

import searchFixture from "../fixtures/youtube/search.list.q-cats.json";
import videosFixture from "../fixtures/youtube/videos.list.json";
import chartFixture from "../fixtures/youtube/videos.list.chart-mostPopular.json";
import channelsContentDetailsFixture from "../fixtures/youtube/channels.list.contentDetails.json";
import playlistItemsUploadsFixture from "../fixtures/youtube/playlistItems.list.uploads.json";
import channelSearchFixture from "../fixtures/youtube/search.list.type-channel.json";
import channelsForHandleFixture from "../fixtures/youtube/channels.list.forHandle.json";
import playlistItemsShortsLabFixture from "../fixtures/youtube/playlistItems.list.uploads-shortslab.json";
import videosShortsLabFixture from "../fixtures/youtube/videos.list.shortslab.json";
import quotaExceededFixture from "../fixtures/youtube/error.quotaExceeded.json";
import rateLimitExceededFixture from "../fixtures/youtube/error.rateLimitExceeded.json";

const FIXTURE_API_KEY = "FIXTURE-KEY-NOT-A-REAL-CREDENTIAL";
const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const OBSERVED_AT = "2026-10-23T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture helpers (all network is injected; nothing leaves the process)
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

function throwingFetch(error: Error): FetchLike {
  return async () => {
    throw error;
  };
}

const keySource = (key: string | null): YouTubeApiKeySource => ({ getApiKey: () => Promise.resolve(key) });

/** The standard happy-path route set (search/chart/lookup/uploads/enrichment). */
function standardRoutes(): FixtureRoute[] {
  return [
    {
      match: (url) => url.includes("/search?") && url.includes("type=video") && url.includes("q=cats"),
      respond: () => jsonResponse(searchFixture),
    },
    {
      match: (url) => url.includes("/search?") && url.includes("type=channel"),
      respond: () => jsonResponse(channelSearchFixture),
    },
    {
      match: (url) => url.includes("/search?") && url.includes("q=nothing-matchable"),
      respond: () => jsonResponse({ kind: "youtube#searchListResponse", items: [] }),
    },
    {
      match: (url) => url.includes("/videos?") && url.includes("chart=mostPopular"),
      respond: () => jsonResponse(chartFixture),
    },
    {
      // The enrichment id-read for the cats-search page (FIXVID00001,FIXVID00002).
      match: (url) => url.includes("/videos?") && url.includes("id=FIXVID0000"),
      respond: () => jsonResponse(videosFixture),
    },
    {
      // The enrichment id-read for the shorts-lab uploads page.
      match: (url) => url.includes("/videos?") && url.includes("id=FIXVID1000"),
      respond: () => jsonResponse(videosShortsLabFixture),
    },
    {
      match: (url) => url.includes("/channels?") && url.includes("id=UCFIXCH0000000000000001"),
      respond: () => jsonResponse(channelsContentDetailsFixture),
    },
    {
      match: (url) => url.includes("/channels?") && url.includes("id=UCFIXCH0000000000000002"),
      respond: () => jsonResponse(channelsForHandleFixture),
    },
    {
      match: (url) => url.includes("/channels?") && url.includes("forHandle="),
      respond: () => jsonResponse(channelsForHandleFixture),
    },
    {
      match: (url) => url.includes("/playlistItems?") && url.includes("playlistId=UUFIXCH0000000000000001"),
      respond: () => jsonResponse(playlistItemsUploadsFixture),
    },
    {
      match: (url) => url.includes("/playlistItems?") && url.includes("playlistId=UUFIXCH0000000000000002"),
      respond: () => jsonResponse(playlistItemsShortsLabFixture),
    },
  ];
}

function fixtureEngine(routes: FixtureRoute[] = standardRoutes()): YouTubeCatalogSourceAdapter & {
  fetch: FetchLike & { calls: string[] };
} {
  const fetch = fixtureFetch(routes);
  const client = new YouTubeDataApiClient({
    fetchImpl: fetch,
    apiKey: FIXTURE_API_KEY,
    clock: () => NOW,
  });
  const adapter = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
  return Object.assign(adapter, { fetch });
}

// ---------------------------------------------------------------------------
// 1. The live composition root (freeze §9.5)
// ---------------------------------------------------------------------------

describe("live composition root (freeze §9.5 key law)", () => {
  it("no key source injected answers the typed requires-auth outcome (never a throw)", async () => {
    const outcome = await createLiveYouTubeComposition({} as { apiKeySource: YouTubeApiKeySource });
    expect(outcome.kind).toBe("requires-auth");
    if (outcome.kind === "requires-auth") {
      expect(outcome.detail).toContain("No YouTube API key source");
      expect(outcome.detail).toContain(YOUTUBE_API_KEY_CONFIGURATION_HINT);
    }
  });

  it("a null key answers requires-auth with the configuration hint", async () => {
    const outcome = await createLiveYouTubeComposition({ apiKeySource: keySource(null) });
    expect(outcome.kind).toBe("requires-auth");
    if (outcome.kind === "requires-auth") {
      expect(outcome.detail).toContain("No official YouTube Data API v3 key is configured");
      expect(outcome.detail).toContain(YOUTUBE_API_KEY_CONFIGURATION_HINT);
    }
  });

  it("a blank key answers requires-auth (whitespace is no key)", async () => {
    const outcome = await createLiveYouTubeComposition({ apiKeySource: keySource("   ") });
    expect(outcome.kind).toBe("requires-auth");
  });

  it("a FAILING key source is the honest no-key state, never a crash", async () => {
    const failing: YouTubeApiKeySource = {
      getApiKey: () => Promise.reject(new Error("vault unavailable (fixture)")),
    };
    const outcome = await createLiveYouTubeComposition({ apiKeySource: failing });
    expect(outcome.kind).toBe("requires-auth");
  });

  it("a configured key builds the live composition over the REAL global fetch (default)", async () => {
    const globalCalls: string[] = [];
    const globalFetch = vi.fn(async (url: string) => {
      globalCalls.push(url);
      return jsonResponse(searchFixture);
    });
    vi.stubGlobal("fetch", globalFetch);
    try {
      const outcome = await createLiveYouTubeComposition({ apiKeySource: keySource(FIXTURE_API_KEY) });
      expect(outcome.kind).toBe("live");
      if (outcome.kind !== "live") return;
      const page = await outcome.source.searchVideos({ q: "cats" });
      expect(page.kind).toBe("ok");
      expect(globalCalls.length).toBeGreaterThan(0);
      expect(globalCalls[0]).toContain("key=FIXTURE-KEY-NOT-A-REAL-CREDENTIAL");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the injected fetch path works and the LEDGER redacts the key while the wire carries it", async () => {
    const outcome = await createLiveYouTubeComposition({
      apiKeySource: keySource(FIXTURE_API_KEY),
      fetchImpl: fixtureFetch(standardRoutes()),
      clock: () => NOW,
    });
    expect(outcome.kind).toBe("live");
    if (outcome.kind !== "live") return;
    const page = await outcome.source.searchVideos({ q: "cats" });
    expect(page.kind).toBe("ok");
    for (const entry of outcome.client.getLedger()) {
      expect(entry.url).toContain("key=REDACTED");
      expect(entry.url).not.toContain(FIXTURE_API_KEY);
    }
    expect(outcome.client.getUnitsUsedToday()).toBe(101); // 100 search + 1 enrichment
    expect(outcome.client.getQuotaLimitToday()).toBe(YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS);
  });

  it("the requires-auth outcome carries NO key material (only the honest detail)", async () => {
    const outcome = await createLiveYouTubeComposition({ apiKeySource: keySource(null) });
    expect(outcome.kind).toBe("requires-auth");
    // The honest branch is pure data: detail text + the configuration hint —
    // no key value can ride it (the live branch hands over the engine itself,
    // which holds the key internally exactly like any authenticated client).
    expect(JSON.stringify(outcome)).not.toContain(FIXTURE_API_KEY);
  });
});

// ---------------------------------------------------------------------------
// 2. The engine adapter over the fixture Data API
// ---------------------------------------------------------------------------

describe("YouTubeCatalogSourceAdapter (official Data API engine)", () => {
  it("searchVideos returns rows with the canonical CatalogItem + the enriched display facts", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    const { rows, nextPageToken, budget, regionCode } = outcome.value;
    expect(rows.length).toBe(2);
    const first = rows[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    // The canonical item rides verbatim (videoId in metadata.externalIds.youtube).
    expect(first.item.providerId).toBe("youtube");
    expect((first.item.metadata?.externalIds as Record<string, unknown>)?.youtube).toBe("FIXVID00001");
    expect(first.channelId).toBe("UCFIXCH0000000000000001");
    // The documented enrichment read merged viewCount + durationMs.
    expect(first.viewCount).toBe(12345);
    expect(first.durationMs).toBe(4 * 60_000 + 13_000);
    expect(first.thumbnailUrl).toContain("i.ytimg.com");
    expect(nextPageToken).toBe("FIXTURE-NEXT-PAGE-1");
    expect(regionCode).toBe("US");
    // 100 (search.list) + 1 (videos.list enrichment) charged today.
    expect(budget.unitsUsedToday).toBe(101);
    expect(budget.state).toBe("ok");
    expect(budget.searchCallsRemainingToday).toBe(98);
  });

  it("searchVideos honest-state: provider quota exhaustion maps onto the rate-limited capability (DATA, never a throw)", async () => {
    const engine = fixtureEngine([
      {
        match: (url) => url.includes("/search?"),
        respond: () => jsonResponse(quotaExceededFixture, { status: 403 }),
      },
    ]);
    const outcome = await engine.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind !== "honest-state") return;
    expect(outcome.capability.status).toBe("rate-limited");
    expect(outcome.capability.detail).toContain("daily quota is exhausted");
  });

  it("searchVideos honest-state: network failure maps onto the unavailable capability", async () => {
    const engine = fixtureEngine([]);
    const client = new YouTubeDataApiClient({ fetchImpl: throwingFetch(new Error("dns failure (fixture)")), apiKey: FIXTURE_API_KEY, clock: () => NOW });
    const adapter = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    void engine;
    const outcome = await adapter.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind !== "honest-state") return;
    expect(outcome.capability.status).toBe("unavailable");
    expect(outcome.capability.detail).toContain("network failure");
  });

  it("searchVideos honest-state: NO API KEY maps onto requires-auth (the handle law)", async () => {
    const client = new YouTubeDataApiClient({ fetchImpl: fixtureFetch(standardRoutes()), clock: () => NOW });
    const adapter = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const outcome = await adapter.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind !== "honest-state") return;
    expect(outcome.capability.status).toBe("requires-auth");
    expect(outcome.capability.detail).toContain("official API key");
  });

  it("a fixture-only client (no fetchImpl) refuses honestly with LiveNetworkDisabledError → unknown", async () => {
    const client = new YouTubeDataApiClient({ apiKey: FIXTURE_API_KEY });
    const adapter = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const outcome = await adapter.trending({});
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind !== "honest-state") return;
    expect(outcome.capability.status).toBe("unknown");
    expect(outcome.capability.detail).toContain("live network calls are disabled");
  });

  it("searchChannels returns snippet facts ONLY (subscriberCount honestly absent)", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.searchChannels({ q: "fixture" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.channels.length).toBe(3);
    const shortsLab = outcome.value.channels.find((c) => c.channelId === "UCFIXCH0000000000000002");
    expect(shortsLab).toBeDefined();
    expect(shortsLab?.title).toBe("Fixture Shorts Lab");
    expect(shortsLab?.handle).toBe("@fixtureshortslab");
    expect(shortsLab?.subscriberCount).toBeUndefined();
  });

  it("trending returns chart rows with facts already on the response (no enrichment call)", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.trending({ regionCode: "US" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    const { rows, nextPageToken } = outcome.value;
    expect(rows.length).toBe(3);
    expect(rows[0]?.viewCount).toBe(1048576);
    expect(rows[0]?.durationMs).toBe(8 * 60_000 + 31_000);
    expect(nextPageToken).toBe("FIXTURE-CHART-NEXT-PAGE-1");
    // chart read = 1 unit only.
    expect(outcome.value.budget.unitsUsedToday).toBe(1);
    expect(engine.fetch.calls.every((url) => !url.includes("id=FIXVID0000") || url.includes("chart="))).toBe(true);
  });

  it("channelById returns the full summary (statistics + uploads playlist + banner)", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.channelById("UCFIXCH0000000000000002");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    const channel = outcome.value.channel;
    expect(channel?.channelId).toBe("UCFIXCH0000000000000002");
    expect(channel?.subscriberCount).toBe(1048576);
    expect(channel?.uploadsPlaylistId).toBe("UUFIXCH0000000000000002");
    expect(channel?.bannerUrl).toContain("fixture-shorts-lab-banner");
    expect(channel?.publishedAt).toBe("2022-08-08T00:00:00Z");
  });

  it("channelById answers { channel: null } for the provider's own no-such-channel (never an error)", async () => {
    const engine = fixtureEngine([
      {
        match: (url) => url.includes("/channels?"),
        respond: () => jsonResponse({ kind: "youtube#channelListResponse", items: [] }),
      },
    ]);
    const outcome = await engine.channelById("UCFIXCH0000000000000099");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.value.channel).toBeNull();
  });

  it("channelByHandle uses the official forHandle param (normalized to a leading @)", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.channelByHandle("fixtureshortslab");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.channel?.title).toBe("Fixture Shorts Lab");
    const wire = engine.fetch.calls.find((url) => url.includes("forHandle="));
    expect(wire).toBeDefined();
    expect(wire).toContain("forHandle=%40fixtureshortslab");
    expect(wire).not.toContain("id=");
  });

  it("channelUploads composes channels.list contentDetails + playlistItems.list + the enrichment read", async () => {
    const engine = fixtureEngine();
    const outcome = await engine.channelUploads({ channelId: "UCFIXCH0000000000000002" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    const { rows, budget } = outcome.value;
    expect(rows.length).toBe(3);
    // API row order preserved here (newest-first re-sort is the producer's binding job).
    expect((rows[0]?.item.metadata?.externalIds as Record<string, unknown>)?.youtube).toBe("FIXVID10001");
    expect((rows[2]?.item.metadata?.externalIds as Record<string, unknown>)?.youtube).toBe("FIXVID10002");
    // Durations/view counts arrive through the enrichment read.
    expect(rows[0]?.durationMs).toBe(58_000);
    expect(rows[2]?.durationMs).toBe(9 * 60_000 + 30_000);
    expect(rows[2]?.viewCount).toBe(56);
    // channels.list (1) + playlistItems.list (1) + videos.list enrichment (1).
    expect(budget.unitsUsedToday).toBe(3);
  });

  it("enrichment failure degrades honestly: the page returns WITHOUT views/durations (never a throw)", async () => {
    const engine = fixtureEngine([
      {
        match: (url) => url.includes("/search?") && url.includes("type=video"),
        respond: () => jsonResponse(searchFixture),
      },
      {
        match: (url) => url.includes("/videos?") && url.includes("id=FIXVID0000"),
        respond: () => jsonResponse(quotaExceededFixture, { status: 403 }),
      },
    ]);
    const outcome = await engine.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBe(2);
    expect(outcome.value.rows[0]?.viewCount).toBeUndefined();
    expect(outcome.value.rows[0]?.durationMs).toBeUndefined();
    // The PRIMARY call succeeded and charged; the enrichment attempt charged 1 (provider error).
    expect(outcome.value.budget.unitsUsedToday).toBe(101);
  });

  it("budget() surfaces the ledger view for notes", async () => {
    const engine = fixtureEngine();
    expect(engine.budget().unitsRemainingToday).toBe(YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS);
    await engine.trending({});
    expect(engine.budget().unitsUsedToday).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2b. The official forHandle param on the raw client
// ---------------------------------------------------------------------------

describe("YouTubeDataApiClient.getChannel forHandle support (official channels.list param)", () => {
  it("normalizeHandleParam: trimmed, leading @ ensured", () => {
    expect(normalizeHandleParam("shortslab")).toBe("@shortslab");
    expect(normalizeHandleParam("@shortslab")).toBe("@shortslab");
    expect(normalizeHandleParam("  @ShortsLab  ")).toBe("@ShortsLab");
  });

  it("a handle without @ still reaches the wire normalized", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("forHandle="),
        respond: () => jsonResponse(channelsForHandleFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({ fetchImpl: fetch, apiKey: FIXTURE_API_KEY, clock: () => NOW });
    const channel = await client.getChannel({ handle: "fixtureshortslab" });
    expect(channel.id).toBe("UCFIXCH0000000000000002");
    expect(fetch.calls[0]).toContain("forHandle=%40fixtureshortslab");
  });

  it("id takes precedence when both id and handle are offered (documented tie-break)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("id=UCFIXCH0000000000000001"),
        respond: () => jsonResponse(channelsContentDetailsFixture),
      },
    ]);
    const client = new YouTubeDataApiClient({ fetchImpl: fetch, apiKey: FIXTURE_API_KEY, clock: () => NOW });
    const channel = await client.getChannel({
      id: "UCFIXCH0000000000000001",
      handle: "fixtureshortslab",
    });
    expect(channel.id).toBe("UCFIXCH0000000000000001");
    expect(fetch.calls[0]).not.toContain("forHandle=");
  });

  it("empty items answer the typed NotFoundError (the provider's no-such-handle truth)", async () => {
    const fetch = fixtureFetch([
      {
        match: (url) => url.includes("forHandle="),
        respond: () => jsonResponse({ kind: "youtube#channelListResponse", items: [] }),
      },
    ]);
    const client = new YouTubeDataApiClient({ fetchImpl: fetch, apiKey: FIXTURE_API_KEY, clock: () => NOW });
    await expect(client.getChannel({ handle: "@does-not-exist" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 3. The structural port pinning (compile-time drift pins)
// ---------------------------------------------------------------------------

describe("structural compatibility pins against the app-owned ports", () => {
  it("the engine adapter satisfies webflix-application's YouTubeCatalogSource port", async () => {
    const adapter = fixtureEngine();
    // THE PIN: this assignment fails the connectors typecheck when the
    // adapter drifts from the app-owned port (the whole point of the suite).
    const pin: AppEnginePort = adapter;
    expect(typeof pin.searchVideos).toBe("function");
    expect(typeof pin.searchChannels).toBe("function");
    expect(typeof pin.trending).toBe("function");
    expect(typeof pin.channelById).toBe("function");
    expect(typeof pin.channelByHandle).toBe("function");
    expect(typeof pin.channelUploads).toBe("function");
    expect(typeof pin.budget).toBe("function");
    const outcome = await pin.searchVideos({ q: "cats" });
    expect(outcome.kind).toBe("ok");
  });

  it("the search source satisfies webflix-application's SearchSourcePort", async () => {
    const adapter = fixtureEngine();
    const source = new YouTubeSearchSource(adapter);
    // THE PIN: assignment against the REAL app-side port declaration.
    const pin: AppSearchSourcePort = source;
    expect(pin.descriptor.source).toBe("youtube");
    expect(pin.descriptor.version).toBe("1.0.0");
    const outcome = await pin.search({ query: "cats" });
    expect(outcome.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 4. The federated-search source adapter
// ---------------------------------------------------------------------------

describe("YouTubeSearchSource (the real-transport federated-search seam)", () => {
  it("ok: canonical CatalogItems ride verbatim with the source cursor", async () => {
    const engine = fixtureEngine();
    const source = new YouTubeSearchSource(engine);
    const outcome: SearchOutcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.items.length).toBe(2);
    for (const item of outcome.items as CatalogItem[]) {
      expect(item.providerId).toBe("youtube");
      expect((item.metadata?.externalIds as Record<string, unknown>)?.youtube).toMatch(/^FIXVID\d+$/);
    }
    expect(outcome.nextCursor).toBe("FIXTURE-NEXT-PAGE-1");
  });

  it("paging: a per-source cursor rides the wire as pageToken", async () => {
    const engine = fixtureEngine();
    const source = new YouTubeSearchSource(engine);
    await source.search({ query: "cats", cursors: { youtube: "FIXTURE-NEXT-PAGE-1" } });
    const wire = engine.fetch.calls.find((url) => url.includes("pageToken=FIXTURE-NEXT-PAGE-1"));
    expect(wire).toBeDefined();
  });

  it("limits: a per-source limit rides the wire as maxResults", async () => {
    const engine = fixtureEngine();
    const source = new YouTubeSearchSource(engine);
    await source.search({ query: "cats", limits: { youtube: 1 } });
    expect(engine.fetch.calls.some((url) => url.includes("maxResults=1"))).toBe(true);
  });

  it("an empty query answers ok with zero items (no quota spent)", async () => {
    const engine = fixtureEngine();
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "   " });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.items).toEqual([]);
    expect(engine.fetch.calls.length).toBe(0);
  });

  it("NO KEY answers auth-required with the key-configuration reason (freeze §9.5 vocabulary mapping)", async () => {
    const client = new YouTubeDataApiClient({ fetchImpl: fixtureFetch(standardRoutes()), clock: () => NOW });
    const engine = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("auth-required");
    if (outcome.status === "auth-required") {
      expect(outcome.reason).toContain("official Data API v3 key");
    }
  });

  it("quota exhaustion (provider-reported) answers partial-failure with the honest reason", async () => {
    const engine = fixtureEngine([
      {
        match: (url) => url.includes("/search?"),
        respond: () => jsonResponse(quotaExceededFixture, { status: 403 }),
      },
    ]);
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("partial-failure");
    if (outcome.status === "partial-failure") {
      expect(outcome.items).toEqual([]);
      expect(outcome.reason).toContain("daily quota is exhausted");
    }
  });

  it("local budget pre-flight (search unaffordable) answers partial-failure without any wire call", async () => {
    const engine = fixtureEngine();
    const client = new YouTubeDataApiClient({
      fetchImpl: engine.fetch,
      apiKey: FIXTURE_API_KEY,
      quotaLimitToday: 50, // < the 100-unit search cost
      clock: () => NOW,
    });
    const adapter = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const source = new YouTubeSearchSource(adapter);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("partial-failure");
    if (outcome.status === "partial-failure") {
      expect(outcome.reason).toContain("blocked locally");
    }
    expect(engine.fetch.calls.length).toBe(0);
  });

  it("rate-limited (429-family) answers partial-failure with the honest reason", async () => {
    const engine = fixtureEngine([
      {
        match: (url) => url.includes("/search?"),
        respond: () =>
          jsonResponse(rateLimitExceededFixture, { status: 403, headers: { "retry-after": "42" } }),
      },
    ]);
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("partial-failure");
    if (outcome.status === "partial-failure") {
      expect(outcome.reason).toContain("rate-limited");
      expect(outcome.reason).toContain("Retry-After: 42s");
    }
  });

  it("network failure answers partial-failure (unavailable capability mapping)", async () => {
    const client = new YouTubeDataApiClient({
      fetchImpl: throwingFetch(new Error("socket hangup (fixture)")),
      apiKey: FIXTURE_API_KEY,
      clock: () => NOW,
    });
    const engine = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("partial-failure");
    if (outcome.status === "partial-failure") {
      expect(outcome.reason).toContain("network failure");
    }
  });

  it("boundary cancellation rejects with the typed common/cancelled error", async () => {
    const engine = fixtureEngine();
    const source = new YouTubeSearchSource(engine);
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.search({ query: "cats" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: ErrorCode.Cancelled });
    expect(engine.fetch.calls.length).toBe(0);
  });

  it("a fixture-only engine (LiveNetworkDisabledError) answers partial-failure (unknown capability)", async () => {
    const client = new YouTubeDataApiClient({ apiKey: FIXTURE_API_KEY });
    const engine = new YouTubeCatalogSourceAdapter(client, { observedAt: () => OBSERVED_AT });
    const source = new YouTubeSearchSource(engine);
    const outcome = await source.search({ query: "cats" });
    expect(outcome.status).toBe("partial-failure");
    if (outcome.status === "partial-failure") {
      expect(outcome.reason).toContain("live network calls are disabled");
    }
    expect(() => {
      throw new LiveNetworkDisabledError();
    }).toThrow(LiveNetworkDisabledError);
  });
});
