// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-ANON-VIEW-1 — the default-producers composition battery (the
 * operator's ruling made executable): with NO Data-API key configured the
 * desktop composes the KEY-FREE PUBLIC WEB engine (the web app's own
 * anonymous path through the main-process transport bridge), so every
 * surface boots into real videos with ZERO sign-in; only when NEITHER
 * engine can be built (no key AND no public bridge) does the honest
 * requires-auth handle ride. A configured key keeps the official Data-API
 * engine's precedence — the public bridge is then NOT consulted.
 *
 * The agent workspace bridge is faked (the key IPC's answer); the public
 * transport bridge is the REAL renderer binding driven by a fixture-backed
 * window.webflixYoutubePublic stub; createDefaultMediaProducers and the
 * producer bundle are the REAL source.
 */

import { createDefaultMediaProducers } from "../mediaHostSupport";
import type { WebFlixYoutubePublicFetchResult } from "../youtubePublicUpstreamBridge";

interface AgentBridgeLike {
  getYouTubeApiKey(): Promise<{ key: string | null; source: string | null }>;
}

function agentBridgeWithKey(key: string | null): AgentBridgeLike {
  return { getYouTubeApiKey: async () => ({ key, source: key !== null ? "fixture" : null }) };
}

const SEARCH_FIXTURE = JSON.stringify({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  {
                    videoRenderer: {
                      videoId: "FIXANON0001",
                      title: { runs: [{ text: "An anonymous fixture video" }] },
                      ownerText: {
                        runs: [
                          {
                            text: "Fixture Channel",
                            navigationEndpoint: {
                              browseEndpoint: { browseId: "UCFIXTURE00001", canonicalBaseUrl: "/@fixture" },
                            },
                          },
                        ],
                      },
                      lengthText: { simpleText: "3:30" },
                      viewCountText: { simpleText: "1,234,567 views" },
                      publishedTimeText: { simpleText: "2 days ago" },
                    },
                  },
                ],
              },
            },
            {
              itemSectionRenderer: {
                contents: [
                  {
                    continuationItemRenderer: {
                      continuationEndpoint: {
                        continuationCommand: { token: "FIXTURE-PUBLIC-NEXT-PAGE" },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
});

interface PublicCall {
  readonly method: string;
  readonly url: string;
  readonly bodyJson?: string;
}

function installPublicBridge(answer: (call: PublicCall) => WebFlixYoutubePublicFetchResult): PublicCall[] {
  const calls: PublicCall[] = [];
  const bridge = {
    async fetchUpstream(request: { method: "GET" | "POST"; url: string; bodyJson?: string }) {
      calls.push({ method: request.method, url: request.url, ...(request.bodyJson !== undefined ? { bodyJson: request.bodyJson } : {}) });
      return answer({ method: request.method, url: request.url, ...(request.bodyJson !== undefined ? { bodyJson: request.bodyJson } : {}) });
    },
  };
  Object.defineProperty(window, "webflixYoutubePublic", { value: bridge, configurable: true });
  return calls;
}

const noopHistory = {
  listContinueWatching: async () => [],
  listHistory: async () => [],
};

beforeEach(() => {
  Object.defineProperty(window, "webflixYoutubePublic", { value: undefined, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WFX-ANON-VIEW-1: createDefaultMediaProducers — the anonymous default engine", () => {
  it("NO key + the public bridge present: the search surface answers REAL public rows (zero sign-in)", async () => {
    const calls = installPublicBridge(() => ({ ok: true, text: SEARCH_FIXTURE }));
    const producers = await createDefaultMediaProducers(
      agentBridgeWithKey(null) as never,
      noopHistory,
    );
    const data = await producers.searchPage.searchPage("fixture query");
    expect(data.videos.length).toBeGreaterThan(0);
    expect(data.videos[0]!.item.title).toBe("An anonymous fixture video");
    expect(data.videos[0]!.viewsLabel).toContain("1.2M");
    expect(data.nextCursor).toBe("FIXTURE-PUBLIC-NEXT-PAGE");
    // The egress was the ANONYMOUS InnerTube POST (no credentials).
    expect(calls).toHaveLength(2); // the video search + the channel rail search
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("https://www.youtube.com/youtubei/v1/search?key=");
    expect(calls[0]!.bodyJson).toContain('"query":"fixture query"');
    // The quota-free budget note (the honest no-quota ledger).
    expect(data.budgetNote).toContain("key-free public web surface");
  });

  it("NO key + NO public bridge: the honest fail-closed requires-auth handle (nothing invented)", async () => {
    const producers = await createDefaultMediaProducers(
      agentBridgeWithKey(null) as never,
      noopHistory,
    );
    const data = await producers.searchPage.searchPage("fixture query");
    expect(data.videos).toHaveLength(0);
    expect(data.budgetNote).toContain("(requires-auth)");
    expect(data.budgetNote).toContain("No public web transport was injected");
  });

  it("a configured key keeps the Data-API engine's precedence — the public bridge is NOT consulted", async () => {
    const calls = installPublicBridge(() => ({ ok: true, text: SEARCH_FIXTURE }));
    const googleapis = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        // A Data-API-shaped search response (one keyed row).
        return new Response(
          JSON.stringify({
            regionCode: "US",
            nextPageToken: "KEYED-NEXT",
            items: [
              {
                kind: "youtube#searchResult",
                id: { kind: "youtube#video", videoId: "FIXKEYED001" },
                snippet: {
                  title: "A keyed fixture video",
                  channelId: "UCFIXTURE00002",
                  channelTitle: "Keyed Channel",
                  publishedAt: "2026-10-20T00:00:00Z",
                  thumbnails: { default: { url: "https://i.ytimg.com/vi/FIXKEYED001/default.jpg" } },
                },
              },
            ],
          }),
          { status: 200 },
        );
      });
    const producers = await createDefaultMediaProducers(
      agentBridgeWithKey("FIXTURE-OPERATOR-KEY") as never,
      noopHistory,
    );
    const data = await producers.searchPage.searchPage("fixture query");
    expect(data.videos[0]!.item.title).toBe("A keyed fixture video");
    expect(calls).toHaveLength(0);
    expect(googleapis).toHaveBeenCalled();
    googleapis.mockRestore();
  });

  it("the anonymous home feed surfaces the trending ladder's public rows", async () => {
    // The SSR trending page answers the walled nudge (no rows); the
    // search-compose fallback then answers REAL rows — the ladder.
    installPublicBridge((call) => {
      if (call.method === "GET") return { ok: true, text: "<html><body>nudge</body></html>" };
      return { ok: true, text: SEARCH_FIXTURE };
    });
    const producers = await createDefaultMediaProducers(
      agentBridgeWithKey(null) as never,
      noopHistory,
    );
    const view = await producers.homeFeed.getHomeFeed({});
    expect(view.phase).toBe("ready");
    expect(view.sections?.some((section) => section.kind === "video-grid")).toBe(true);
    expect(view.compositionNote).toContain("key-free public web trending feed");
  });
});
