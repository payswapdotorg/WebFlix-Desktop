import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-NETFLIX-SOURCE-1 — the transport-boundary battery for the WebFlix
 * Netflix IPC surface (packages/desktop/src/main/webflixNetflixIpc.ts) and
 * its preload mirror (packages/desktop/src/preload/webflixNetflixBridge.ts).
 *
 * Pinned here (all binding):
 *   - The channel strings on the main side and the preload side AGREE (a
 *     typo on either side fails this battery, never a silent mismatch).
 *   - Registration is flavor-gated: only the baked webflix flavor registers
 *     the channels; a zcode flavor registers NOTHING.
 *   - The fetch channel is URL-ALLOWLISTED to exactly the 8 Tudum pool pages
 *     (https://www.netflix.com + a POOLS path — pinned-equal against the
 *     connectors' POOLS matrix so main never drifts from the source layer);
 *     every other netflix.com path, scheme, or host is refused typed.
 *   - The bounded fetch budget: one retry on failure (a failing impl is
 *     called exactly twice), the marker-gated success passes the bytes.
 *   - The open-url channel accepts ONLY netflix.com /watch/<id> and
 *     /title/<id> deep links and hands them to the system-browser opener;
 *     anything else is refused typed.
 *
 * Electron is mocked (the webflixAccountIpc.test.ts pattern: an
 * ipcMain.handle recorder); webflixNetflixIpc.ts and webflixNetflixBridge.ts
 * are the REAL source.
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
  registerWebFlixNetflixIpc,
  WEBFLIX_NETFLIX_OPEN_URL_CHANNEL,
  WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL,
} from "./webflixNetflixIpc.js";
import { WEBFLIX_NETFLIX_OPEN_URL_CHANNEL as PRELOAD_OPEN_CHANNEL, WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL as PRELOAD_FETCH_CHANNEL } from "../preload/webflixNetflixBridge.js";
import { ALL_POOL_KEYS, POOLS } from "../../../connectors/src/netflix/top10.js";

const POOL_URLS = ALL_POOL_KEYS.map((key) => `https://www.netflix.com${POOLS[key].path}`);

function register(fetchImpl?: typeof fetch, flavor?: "webflix"): void {
  registerWebFlixNetflixIpc({
    logger: null,
    ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    ...(flavor !== undefined ? { flavor } : {}),
  });
}

async function invokeFetch(url: unknown): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const handler = hoisted.ipcHandlers.get(WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL);
  expect(handler).toBeTruthy();
  return (await handler?.(undefined, { url })) as { ok: boolean; text?: string; reason?: string };
}

async function invokeOpen(url: unknown): Promise<{ ok: boolean; reason?: string }> {
  const handler = hoisted.ipcHandlers.get(WEBFLIX_NETFLIX_OPEN_URL_CHANNEL);
  expect(handler).toBeTruthy();
  return (await handler?.(undefined, { url })) as { ok: boolean; reason?: string };
}

beforeEach(() => {
  hoisted.ipcHandlers.clear();
});

describe("webflixNetflixIpc — the channel + flavor laws", () => {
  it("the main-side and preload-side channel strings AGREE", () => {
    expect(WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL).toBe(PRELOAD_FETCH_CHANNEL);
    expect(WEBFLIX_NETFLIX_OPEN_URL_CHANNEL).toBe(PRELOAD_OPEN_CHANNEL);
  });

  it("registers its two channels only in the webflix flavor", () => {
    register(undefined, "webflix");
    expect(hoisted.ipcHandlers.has(WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL)).toBe(true);
    expect(hoisted.ipcHandlers.has(WEBFLIX_NETFLIX_OPEN_URL_CHANNEL)).toBe(true);
  });

  it("a non-webflix flavor registers NOTHING (zero ZCode-build surface)", () => {
    register(undefined, "production");
    expect(hoisted.ipcHandlers.size).toBe(0);
  });
});

describe("webflixNetflixIpc — the pool-page fetch allowlist", () => {
  it("accepts exactly the 8 Tudum pool pages (pinned-equal to the connectors POOLS matrix)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "netflix.reactContext.models.graphql bytes" })) as unknown as typeof fetch;
    register(fetchImpl, "webflix");
    for (const url of POOL_URLS) {
      const result = await invokeFetch(url);
      expect(result.ok).toBe(true);
      expect(result.text).toBe("netflix.reactContext.models.graphql bytes");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("refuses every other netflix.com path, host, and scheme typed", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => "bytes" })) as unknown as typeof fetch;
    register(fetchImpl, "webflix");
    for (const bad of [
      "https://www.netflix.com/watch/81757047", // deep link, not a pool page
      "https://www.netflix.com/tudum/top10/anything-else",
      "http://www.netflix.com/tudum/top10/", // not https
      "https://netflix.com/tudum/top10/", // wrong host
      "https://evil.example.com/tudum/top10/",
      "not a url",
      undefined,
      42,
    ]) {
      const result = await invokeFetch(bad);
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe("string");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a failing upstream exactly once (the bounded budget)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("edge walled");
    }) as unknown as typeof fetch;
    register(fetchImpl, "webflix");
    const result = await invokeFetch(POOL_URLS[0]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes a non-ok upstream status through typed (no body read)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;
    register(fetchImpl, "webflix");
    const result = await invokeFetch(POOL_URLS[0]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("403");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("webflixNetflixIpc — the play hand-off open", () => {
  it("opens netflix.com watch/title deep links in the system browser", async () => {
    const openExternal = vi.fn(async () => {});
    registerWebFlixNetflixIpc({ logger: null, flavor: "webflix", openExternal });
    for (const url of ["https://www.netflix.com/watch/81757047", "https://www.netflix.com/title/81757047/"]) {
      const result = await invokeOpen(url);
      expect(result.ok).toBe(true);
    }
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it("refuses every other URL typed (the ADR 0002 §1 law)", async () => {
    const openExternal = vi.fn(async () => {});
    registerWebFlixNetflixIpc({ logger: null, flavor: "webflix", openExternal });
    for (const bad of [
      "https://www.netflix.com/browse",
      "https://www.netflix.com/watch/not-a-number",
      "http://www.netflix.com/watch/81757047",
      "https://evil.example.com/watch/81757047",
      "javascript:alert(1)",
      undefined,
    ]) {
      const result = await invokeOpen(bad);
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe("string");
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reports a failed system-browser open typed (never a fake success)", async () => {
    const openExternal = vi.fn(async () => {
      throw new Error("no default browser");
    });
    registerWebFlixNetflixIpc({ logger: null, flavor: "webflix", openExternal });
    const result = await invokeOpen("https://www.netflix.com/watch/81757047");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("system browser");
  });
});
