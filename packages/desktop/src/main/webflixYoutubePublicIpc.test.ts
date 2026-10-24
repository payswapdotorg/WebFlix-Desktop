import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-ANON-VIEW-1 — the transport-boundary battery for the WebFlix
 * key-free public web IPC surface (packages/desktop/src/main/
 * webflixYoutubePublicIpc.ts) and its preload mirror
 * (packages/desktop/src/preload/webflixYoutubePublicBridge.ts).
 *
 * Pinned here (all binding, mirroring the webflixNetflixIpc battery):
 *   - The channel strings on the main side and the preload side AGREE (a
 *     typo on either side fails this battery, never a silent mismatch).
 *   - Registration is flavor-gated: only the baked webflix flavor registers
 *     the channel; a zcode flavor registers NOTHING.
 *   - The fetch channel is URL+METHOD-ALLOWLISTED to exactly the anonymous
 *     public surfaces: POST https://www.youtube.com/youtubei/v1/{search,
 *     browse,next} (a POST REQUIRES a JSON body) and GET the public SSR
 *     pages (/feed/trending[/{music,gaming,movies}], /@handle[/videos],
 *     /channel/<id>[/videos] — with only the optional gl/hl query params).
 *     Every other youtube.com path, scheme, host, method, or query is
 *     refused typed.
 *   - The bounded fetch budget: one retry on failure (a failing impl is
 *     called exactly twice), a non-ok status passes through typed.
 *   - Zero credentials ride the transport: no Cookie, no Authorization on
 *     the wire (the anonymous path's own law).
 *
 * Electron is mocked (the webflixAccountIpc.test.ts pattern: an
 * ipcMain.handle recorder); webflixYoutubePublicIpc.ts and
 * webflixYoutubePublicBridge.ts are the REAL source.
 */

const hoisted = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: readonly unknown[]) => unknown>();
  return { ipcHandlers };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: readonly unknown[]) => unknown) => {
      hoisted.ipcHandlers.set(channel, handler);
    },
  },
  contextBridge: {
    // The preload mirror self-registers at import (its law); the recorder
    // captures the exposed API so the channel agreement pin is real.
    exposeInMainWorld: (apiKey: string, api: unknown) => {
      hoisted.ipcHandlers.set(`__exposed__:${apiKey}`, () => api);
    },
  },
  ipcRenderer: {
    invoke: vi.fn(async () => {
      throw new Error("the preload bridge is not invoked in this battery");
    }),
  },
  shell: {
    openExternal: vi.fn(async () => {}),
  },
}));

import {
  registerWebFlixYoutubePublicIpc,
  WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL,
} from "./webflixYoutubePublicIpc.js";
import { WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL as PRELOAD_FETCH_CHANNEL } from "../preload/webflixYoutubePublicBridge.js";
// The connectors request builder — the BRIDGE DRIFT PIN: every URL the
// engine can build MUST pass the IPC allowlist (a builder/allowlist drift
// fails here, never silently in the running app — the live 2026-10-24
// catch: the builder's ?key=…&prettyPrint=false query was initially
// rejected by a query-less allowlist rule).
import { innertubeRequestUrl } from "../../../connectors/src/youtube/publicTransport.js";

function register(fetchImpl?: typeof fetch, flavor?: "webflix"): void {
  registerWebFlixYoutubePublicIpc({
    logger: null,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(flavor !== undefined ? { flavor } : {}),
  });
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function recordingFetch(calls: FetchCall[], impl: () => Promise<{ ok: boolean; status: number; body: string }>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const answer = await impl();
    return {
      ok: answer.ok,
      status: answer.status,
      text: async () => answer.body,
    } as Response;
  }) as typeof fetch;
}

async function invokeFetch(
  method: unknown,
  url: unknown,
  bodyJson?: unknown,
): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const handler = hoisted.ipcHandlers.get(WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL);
  expect(handler).toBeTruthy();
  return (await handler?.(undefined, {
    method,
    url,
    ...(bodyJson !== undefined ? { bodyJson } : {}),
  })) as { ok: boolean; text?: string; reason?: string };
}

beforeEach(() => {
  hoisted.ipcHandlers.clear();
});

describe("webflixYoutubePublicIpc — the channel + flavor laws", () => {
  it("the main-side and preload-side channel strings AGREE", () => {
    expect(WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL).toBe(PRELOAD_FETCH_CHANNEL);
    expect(WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL).toBe("webflix:youtube-public:fetch");
  });

  it("registers its channel only in the webflix flavor", async () => {
    register(
      recordingFetch([], () => Promise.resolve({ ok: true, status: 200, body: "{}" })),
      "webflix",
    );
    expect(hoisted.ipcHandlers.has(WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL)).toBe(true);
  });

  it("a non-webflix flavor registers NOTHING (zero ZCode-build surface)", () => {
    register(undefined as unknown as typeof fetch, "zcode" as unknown as "webflix");
    expect(hoisted.ipcHandlers.size).toBe(0);
  });
});

describe("webflixYoutubePublicIpc — the public-surface allowlist", () => {
  it("THE BRIDGE DRIFT PIN: every InnerTube URL the connectors builder emits passes the allowlist", async () => {
    register(
      recordingFetch([], () => Promise.resolve({ ok: true, status: 200, body: "{}" })),
      "webflix",
    );
    for (const endpoint of ["search", "browse", "next"]) {
      const result = await invokeFetch(
        "POST",
        innertubeRequestUrl(endpoint),
        '{"query":"lofi"}',
      );
      expect(result.ok, innertubeRequestUrl(endpoint)).toBe(true);
    }
  });

  it("accepts the anonymous InnerTube POSTs (search/browse/next, body required)", async () => {
    const calls: FetchCall[] = [];
    register(recordingFetch(calls, () => Promise.resolve({ ok: true, status: 200, body: "{}" })), "webflix");
    for (const endpoint of ["search", "browse", "next"]) {
      const result = await invokeFetch(
        "POST",
        `https://www.youtube.com/youtubei/v1/${endpoint}?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false`,
        '{"query":"lofi"}',
      );
      expect(result.ok, endpoint).toBe(true);
      expect(result.text).toBe("{}");
    }
    expect(calls).toHaveLength(3);
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.body as string)).toBe('{"query":"lofi"}');
  });

  it("accepts the public SSR GETs (trending pages, handles, channel ids — gl/hl only)", async () => {
    const calls: FetchCall[] = [];
    register(recordingFetch(calls, () => Promise.resolve({ ok: true, status: 200, body: "<html>" })), "webflix");
    const accepted = [
      "https://www.youtube.com/feed/trending",
      "https://www.youtube.com/feed/trending/music",
      "https://www.youtube.com/feed/trending/gaming",
      "https://www.youtube.com/feed/trending/movies",
      "https://www.youtube.com/feed/trending?gl=US&hl=en",
      "https://www.youtube.com/@MrBeast",
      "https://www.youtube.com/@MrBeast/videos",
      "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA",
      "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA/videos",
    ];
    for (const url of accepted) {
      const result = await invokeFetch("GET", url);
      expect(result.ok, url).toBe(true);
    }
    expect(calls).toHaveLength(accepted.length);
    expect(calls.every((call) => call.init.method === "GET")).toBe(true);
  });

  it("refuses every other path, host, scheme, method, and query typed", async () => {
    register(
      recordingFetch([], () => Promise.resolve({ ok: true, status: 200, body: "{}" })),
      "webflix",
    );
    const refused = [
      ["GET", "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false"],
      ["POST", "https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false", "{\"videoId\":\"x\"}"],
      ["POST", "https://www.youtube.com/youtubei/v1/search?extra=1", "{}"],
      ["POST", "https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8", "{}"],
      ["POST", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "{}"],
      ["GET", "https://www.youtube.com/results?search_query=lofi"],
      ["GET", "https://www.youtube.com/feed/subscriptions"],
      ["GET", "https://m.youtube.com/feed/trending"],
      ["GET", "https://youtube.com/feed/trending"],
      ["GET", "http://www.youtube.com/feed/trending"],
      ["GET", "https://evil.example.com/feed/trending"],
      ["GET", "https://www.youtube.com/@MrBeast?cookie=jar"],
      ["GET", "https://www.youtube.com/channel/NOT_A_VALID_ID"],
      ["DELETE", "https://www.youtube.com/feed/trending"],
      ["GET", "file:///etc/passwd"],
    ] as const;
    for (const [method, url, body] of refused) {
      const result = await invokeFetch(method, url, body);
      expect(result.ok, `${method} ${url}`).toBe(false);
      expect(result.reason, `${method} ${url}`).toContain("Only the anonymous InnerTube endpoints");
    }
  });

  it("refuses a POST without a body (and a GET with one) typed", async () => {
    register(
      recordingFetch([], () => Promise.resolve({ ok: true, status: 200, body: "{}" })),
      "webflix",
    );
    expect(
      (await invokeFetch("POST", "https://www.youtube.com/youtubei/v1/search?key=k&prettyPrint=false")).ok,
    ).toBe(false);
    expect(
      (await invokeFetch("GET", "https://www.youtube.com/feed/trending", "{}")).ok,
    ).toBe(false);
  });

  it("retries a failing upstream exactly once (the bounded budget)", async () => {
    let calls = 0;
    const flaky = (async (url: RequestInfo | URL, init?: RequestInit) => {
      void url;
      void init;
      calls += 1;
      const ok = calls > 1;
      return {
        ok,
        status: ok ? 200 : 503,
        text: async () => (ok ? "<html></html>" : ""),
      } as Response;
    }) as typeof fetch;
    register(flaky, "webflix");
    const result = await invokeFetch("GET", "https://www.youtube.com/feed/trending");
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("passes a non-ok upstream status through typed (no fake success)", async () => {
    register(
      recordingFetch([], () => Promise.resolve({ ok: false, status: 429, body: "" })),
      "webflix",
    );
    const result = await invokeFetch("GET", "https://www.youtube.com/feed/trending");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("429");
  });

  it("the wire carries ZERO credentials (no Cookie, no Authorization headers)", async () => {
    const calls: FetchCall[] = [];
    register(recordingFetch(calls, () => Promise.resolve({ ok: true, status: 200, body: "{}" })), "webflix");
    await invokeFetch(
      "POST",
      "https://www.youtube.com/youtubei/v1/search?key=k&prettyPrint=false",
      '{"query":"lofi"}',
    );
    await invokeFetch("GET", "https://www.youtube.com/feed/trending");
    for (const call of calls) {
      const headers = (call.init.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers).some((h) => h.toLowerCase() === "cookie")).toBe(false);
      expect(Object.keys(headers).some((h) => h.toLowerCase() === "authorization")).toBe(false);
    }
  });
});
