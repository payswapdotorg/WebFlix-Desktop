/**
 * WFX-ANON-VIEW-1 — the key-free PUBLIC WEB engine's hermetic battery
 * (fixture transport only, ZERO live network, ZERO credentials — the
 * network boundary is an injected PublicHttpFetch backed by
 * tests/fixtures/youtube-public/*, the established convention; every
 * fixture is a REAL trimmed capture: the InnerTube search response, the
 * walled public-mode trending nudge, a logged-out trending grid, and the
 * @MrBeast channel page).
 *
 * What this suite pins, block by block:
 *   1. THE PUBLIC COMPOSITION ROOT: no transport answers the TYPED
 *      `unavailable` outcome object (never a thrown crash); a transport
 *      builds the live engine.
 *   2. THE ENGINE ADAPTER (YouTubePublicSourceAdapter) over the fixtures:
 *      search (real rows carrying the canonical CatalogItem + continuation
 *      cursor), channel search (real channelRenderer summaries), the
 *      trending ladder (SSR grid → rows; the walled nudge page → the
 *      search-compose fallback STILL serves real rows; a dead transport →
 *      the typed unavailable honest state), channel lookups by id AND by
 *      handle (the real pageHeaderViewModel facts), the uploads grid, the
 *      shorts feed, and the quota-free budget note.
 *   3. THE STRUCTURAL PORT PINNING: the adapter satisfies the
 *      application-owned YouTubeCatalogSource port — the compile-time
 *      assignment against the REAL app-side port declaration (type-only
 *      import, erased at runtime), exactly like the keyed sibling.
 *   4. THE REQUEST BUILDERS + TOTAL PARSERS: the InnerTube request shape
 *      (URL key, WEB client context, browser headers, no cookie/no auth)
 *      and the verified search-param protobuf encodings (the web app's
 *      recorded menu values byte-for-byte); the duration/count/age parsers
 *      are total (never throw, never invent).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildPublicSearchParam,
  extractYtInitialData,
  innertubeRequestBody,
  innertubeRequestHeaders,
  innertubeRequestUrl,
  ssrRequestHeaders,
  type PublicHttpFetch,
} from "../src/youtube/publicTransport";
import { createPublicYouTubeComposition } from "../src/youtube/publicComposition";
import {
  YOUTUBE_PUBLIC_BUDGET_NOTE,
  YOUTUBE_PUBLIC_SHORTS_SEED_QUERY,
  YouTubePublicSourceAdapter,
} from "../src/youtube/publicSource";
import { publicRowsFromResponse, publicSearchContinuationToken } from "../src/youtube/publicMapping";
import { channelSummaryFromPageResponse } from "../src/youtube/publicChannelMapping";
import {
  parseCompactCount,
  parseDurationSec,
  parseSpelledCount,
  parseViewCount,
  relativeAgeToDate,
  runsText,
} from "../src/youtube/publicText";

// The REAL app-side port declaration — TYPE-ONLY import (erased at runtime:
// no cross-package runtime edge; the compile-time assignment below is the
// drift pin the connectors typecheck enforces over tests/).
import type { YouTubeCatalogSource as AppEnginePort } from "../../webflix-application/src/media/youtube-source-port";

const FIXTURES = new URL("./fixtures/youtube-public/", import.meta.url);

const searchResponse = JSON.parse(
  readFileSync(new URL("search-mrbeast.json", FIXTURES), "utf8"),
) as unknown;
const trendingNudgeHtml = readFileSync(new URL("trending-nudge.html", FIXTURES), "utf8");
const trendingGridHtml = readFileSync(new URL("trending-grid.html", FIXTURES), "utf8");
const channelHtml = readFileSync(new URL("channel-mrbeast.html", FIXTURES), "utf8");

interface RecordedRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
}

/** The fixture transport: records every call, answers from the fixtures. */
function fixtureTransport(options: {
  readonly trendingHtml: string;
  readonly searchResponse: unknown;
  readonly channelHtml?: string;
}): { fetch: PublicHttpFetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const channelHtml = options.channelHtml;
  const fetch: PublicHttpFetch = async (url, init) => {
    requests.push({ method: init.method, url, ...(init.body !== undefined ? { body: init.body } : {}) });
    if (init.method === "POST") {
      return { ok: true, status: 200, text: async () => JSON.stringify(options.searchResponse) };
    }
    if (url.startsWith("https://www.youtube.com/feed/trending")) {
      return { ok: true, status: 200, text: async () => options.trendingHtml };
    }
    if (channelHtml !== undefined && url.startsWith("https://www.youtube.com/")) {
      return { ok: true, status: 200, text: async () => channelHtml };
    }
    return { ok: false, status: 404, text: async () => "" };
  };
  return { fetch, requests };
}

/** A dead transport — every call throws (the honest-state path). */
const deadTransport: PublicHttpFetch = async () => {
  throw new Error("fixture: the transport is dead");
};

const FIXED_OBSERVED_AT = "2026-10-24T00:00:00.000Z";

function engineWith(fetch: PublicHttpFetch): YouTubePublicSourceAdapter {
  return new YouTubePublicSourceAdapter(fetch, { observedAt: () => FIXED_OBSERVED_AT });
}

// ---------------------------------------------------------------------------
// 1. The public composition root
// ---------------------------------------------------------------------------

describe("WFX-ANON-VIEW-1: the public composition root", () => {
  it("no transport answers the typed unavailable outcome — never a throw", () => {
    const outcome = createPublicYouTubeComposition({});
    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") {
      expect(outcome.detail).toContain("No public web transport was injected");
    }
  });

  it("a transport builds the live key-free engine", () => {
    const { fetch } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const outcome = createPublicYouTubeComposition({ fetchImpl: fetch, observedAt: () => FIXED_OBSERVED_AT });
    expect(outcome.kind).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// 2. The engine adapter over the fixtures
// ---------------------------------------------------------------------------

describe("WFX-ANON-VIEW-1: the public engine adapter", () => {
  it("search answers REAL rows — canonical CatalogItems + the continuation cursor", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.searchVideos({ q: "MrBeast" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBeGreaterThan(0);
    const first = outcome.value.rows[0]!;
    // Canonical discipline: videoId in metadata.externalIds.youtube, the
    // official youtube-nocookie embed asset, the hotlinked thumbnail.
    expect(first.item.providerId).toBe("youtube");
    expect((first.item.metadata as { externalIds?: { youtube?: string } }).externalIds?.youtube).toBe(
      first.item.id.replace(/^youtube:video:/, ""),
    );
    expect(first.item.assets?.some((asset) => asset.kind === "embed")).toBe(true);
    expect(first.item.assets?.some((asset) => asset.kind === "thumbnail")).toBe(true);
    // Real display facts from the real capture (the MrBeast search page).
    expect(first.item.title).not.toBe("");
    expect(first.durationMs).toBeGreaterThan(0);
    expect(first.viewCount).toBeGreaterThan(0);
    expect(first.channelTitle).toBeDefined();
    expect(outcome.value.nextPageToken).toBeTypeOf("string");
    expect(outcome.value.budget.note).toBe(YOUTUBE_PUBLIC_BUDGET_NOTE);
    // The request was the anonymous InnerTube shape (no cookie, no auth).
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toContain("https://www.youtube.com/youtubei/v1/search?key=");
    expect(request.body).toContain('"query":"MrBeast"');
    expect(request.body).toContain('"clientName":"WEB"');
    expect(Object.keys(innertubeRequestHeaders()).some((h) => h.toLowerCase() === "cookie")).toBe(false);
  });

  it("the continuation page rides the token as the InnerTube continuation body", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.searchVideos({ q: "MrBeast", pageToken: "TOKEN-1" });
    expect(outcome.kind).toBe("ok");
    const request = requests[0]!;
    expect(request.body).toContain('"continuation":"TOKEN-1"');
  });

  it("channel search answers REAL channelRenderer summaries", async () => {
    const { fetch } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.searchChannels({ q: "MrBeast" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.channels.length).toBeGreaterThan(0);
    const mrBeast = outcome.value.channels[0]!;
    expect(mrBeast.title).toBe("MrBeast");
    expect(mrBeast.channelId).toBe("UCX6OQ3DkcsbYNE6H8uQQuVA");
    expect(mrBeast.handle).toBe("@MrBeast");
    expect(mrBeast.subscriberCount).toBe(523000000);
  });

  it("the trending ladder: the SSR grid page answers its real rows", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.trending({ regionCode: "US" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBeGreaterThan(0);
    expect(outcome.value.rows[0]!.durationMs).toBeGreaterThan(0);
    expect(outcome.value.regionCode).toBe("US");
    // Exactly ONE SSR GET — no fallback POST ran (the grid served).
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(requests[0]!.url).toContain("https://www.youtube.com/feed/trending?gl=US");
  });

  it("the trending ladder: the WALLED nudge page falls back to search-compose — real rows, honestly", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingNudgeHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.trending({});
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBeGreaterThan(0);
    // The ladder ran BOTH rungs: the SSR GET then the search POST.
    expect(requests[0]!.method).toBe("GET");
    expect(requests[1]!.method).toBe("POST");
    expect(requests[1]!.body).toContain('"query":"trending"');
    expect(requests[1]!.body).toContain('"params"');
  });

  it("the trending ladder: a dead SSR AND a dead search answers the typed unavailable state", async () => {
    const engine = engineWith(deadTransport);
    const outcome = await engine.trending({});
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind === "honest-state") {
      expect(outcome.capability.status).toBe("unavailable");
      expect(outcome.capability.detail).toContain("public web transport failed");
    }
  });

  it("channelById answers the real pageHeaderViewModel facts", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingNudgeHtml, searchResponse, channelHtml });
    const engine = engineWith(fetch);
    const outcome = await engine.channelById("UCX6OQ3DkcsbYNE6H8uQQuVA");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.channel?.title).toBe("MrBeast");
    expect(outcome.value.channel?.subscriberCount).toBe(523000000);
    expect(requests[0]!.url).toBe("https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA");
  });

  it("channelByHandle strips the doubled @ and reads the canonical page", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingNudgeHtml, searchResponse, channelHtml });
    const engine = engineWith(fetch);
    const outcome = await engine.channelByHandle("@MrBeast");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.channel?.title).toBe("MrBeast");
    expect(requests[0]!.url).toBe("https://www.youtube.com/@MrBeast");
  });

  it("channelById maps the provider's own 404 to { channel: null } — an ok outcome", async () => {
    const notFound: PublicHttpFetch = async () => ({ ok: false, status: 404, text: async () => "" });
    const engine = engineWith(notFound);
    const outcome = await engine.channelById("UCX6OQ3DkcsbYNE6H8uQQuVA");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.value.channel).toBeNull();
    }
  });

  it("channelUploads answers the real /videos grid rows", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingNudgeHtml, searchResponse, channelHtml });
    const engine = engineWith(fetch);
    const outcome = await engine.channelUploads({ channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA" });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBeGreaterThan(0);
    expect(outcome.value.rows[0]!.viewCount).toBeGreaterThan(0);
    expect(requests[0]!.url).toBe("https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA/videos");
  });

  it("shortsFeed rides the seed query through the search transport", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingNudgeHtml, searchResponse });
    const engine = engineWith(fetch);
    const outcome = await engine.shortsFeed({});
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.rows.length).toBeGreaterThan(0);
    expect(requests[0]!.body).toContain(`"query":"${YOUTUBE_PUBLIC_SHORTS_SEED_QUERY}"`);
  });

  it("a dead transport on search answers the typed unavailable state (never a throw)", async () => {
    const engine = engineWith(deadTransport);
    const outcome = await engine.searchVideos({ q: "MrBeast" });
    expect(outcome.kind).toBe("honest-state");
    if (outcome.kind === "honest-state") {
      expect(outcome.capability.status).toBe("unavailable");
    }
  });

  it("the soft-TTL cache serves the second trending call without a second SSR GET", async () => {
    const { fetch, requests } = fixtureTransport({ trendingHtml: trendingGridHtml, searchResponse });
    const engine = engineWith(fetch);
    await engine.trending({});
    await engine.trending({});
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. The structural port pinning (compile-time — see the suite docblock)
// ---------------------------------------------------------------------------

describe("WFX-ANON-VIEW-1: the structural port pinning", () => {
  it("YouTubePublicSourceAdapter satisfies the app-owned YouTubeCatalogSource port", () => {
    const assignment: AppEnginePort = new YouTubePublicSourceAdapter(deadTransport, {
      observedAt: () => FIXED_OBSERVED_AT,
    });
    expect(typeof assignment.searchVideos).toBe("function");
    expect(typeof assignment.trending).toBe("function");
    expect(typeof assignment.budget).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 4. The request builders + the total parsers
// ---------------------------------------------------------------------------

describe("WFX-ANON-VIEW-1: the request builders", () => {
  it("the InnerTube request URL carries the PUBLIC web key and prettyPrint=false", () => {
    expect(innertubeRequestUrl("search")).toBe(
      "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false",
    );
  });

  it("the request headers are browser-shaped with NO cookie and NO authorization", () => {
    const headers = innertubeRequestHeaders();
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
    expect(headers.Origin).toBe("https://www.youtube.com");
    expect(headers["X-Youtube-Client-Name"]).toBe("1");
    expect(headers.Cookie).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
  });

  it("the SSR headers are browser-shaped with NO cookie", () => {
    const headers = ssrRequestHeaders();
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
    expect(headers.Cookie).toBeUndefined();
  });

  it("the request body carries the WEB client context (region override optional)", () => {
    const body = JSON.parse(innertubeRequestBody({ query: "lofi" })) as {
      context: { client: Record<string, string> };
      query: string;
    };
    expect(body.context.client.clientName).toBe("WEB");
    expect(body.context.client.gl).toBe("US");
    expect(body.query).toBe("lofi");
    const regional = JSON.parse(innertubeRequestBody({ query: "lofi" }, "GB")) as {
      context: { client: Record<string, string> };
    };
    expect(regional.context.client.gl).toBe("GB");
  });

  it("the search-param encodings match the web app's recorded menu values byte-for-byte", () => {
    expect(buildPublicSearchParam({ type: "video" })).toBe("EgIQAQ==");
    expect(buildPublicSearchParam({ type: "shorts" })).toBe("EgIQCQ==");
    expect(buildPublicSearchParam({ uploadDate: "today" })).toBe("EgIIAg==");
    expect(buildPublicSearchParam({})).toBe("");
    expect(buildPublicSearchParam({ sort: "views", uploadDate: "week", type: "video" })).toBe(
      "CAMSBAgDEAE=",
    );
  });

  it("extractYtInitialData throws the honest error on a page without the payload", () => {
    expect(() => extractYtInitialData("<html>no data here</html>")).toThrow(/ytInitialData not found/);
  });
});

describe("WFX-ANON-VIEW-1: the total parsers (ported verbatim)", () => {
  it("parseDurationSec: clock and word forms; null on garbage", () => {
    expect(parseDurationSec("12:34")).toBe(754);
    expect(parseDurationSec("1:02:03")).toBe(3723);
    expect(parseDurationSec("9 minutes, 26 seconds")).toBe(566);
    expect(parseDurationSec("nonsense")).toBeNull();
    expect(parseDurationSec(null)).toBeNull();
  });

  it("the count parsers: compact, views, spelled, no-views", () => {
    expect(parseCompactCount("1.2M")).toBe(1_200_000);
    expect(parseCompactCount("5,561,627")).toBe(5_561_627);
    expect(parseViewCount("No views")).toBe(0);
    expect(parseViewCount("1.2M views")).toBe(1_200_000);
    expect(parseSpelledCount("345 thousand views")).toBe(345_000);
    expect(parseCompactCount("garbage")).toBeNull();
  });

  it("relativeAgeToDate derives the approximate ISO instant from the real text (the fixed 365-day year / 30-day month the web app's own approximation uses)", () => {
    const now = new Date("2026-10-24T00:00:00.000Z");
    expect(relativeAgeToDate("16 years ago", now)).toBe("2010-10-28T00:00:00.000Z");
    expect(relativeAgeToDate("4mo ago", now)).toBe("2026-06-26T00:00:00.000Z");
    expect(relativeAgeToDate("Streamed 2y ago", now)).toBe("2024-10-24T00:00:00.000Z");
    expect(relativeAgeToDate(null, now)).toBeUndefined();
    expect(relativeAgeToDate("yesterday", now)).toBeUndefined();
  });

  it("runsText reads all three YouTube text encodings", () => {
    expect(runsText("plain")).toBe("plain");
    expect(runsText({ simpleText: "simple" })).toBe("simple");
    expect(runsText({ content: "content" })).toBe("content");
    expect(runsText({ runs: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(runsText(null)).toBe("");
  });
});

describe("WFX-ANON-VIEW-1: the fixture walkers (the real captures)", () => {
  it("the search fixture yields rows and a continuation token", () => {
    const rows = publicRowsFromResponse(searchResponse, {
      observedAt: FIXED_OBSERVED_AT,
      surface: "search feed",
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(publicSearchContinuationToken(searchResponse)).toBeTypeOf("string");
  });

  it("the nudge fixture yields ZERO rows (the walled public-mode page)", () => {
    const rows = publicRowsFromResponse(extractYtInitialData(trendingNudgeHtml), {
      observedAt: FIXED_OBSERVED_AT,
      surface: "trending page",
    });
    expect(rows).toHaveLength(0);
  });

  it("the channel fixture yields the header summary", () => {
    const summary = channelSummaryFromPageResponse(extractYtInitialData(channelHtml));
    expect(summary?.title).toBe("MrBeast");
    expect(summary?.channelId).toBe("UCX6OQ3DkcsbYNE6H8uQQuVA");
    expect(summary?.subscriberCount).toBe(523000000);
  });
});
