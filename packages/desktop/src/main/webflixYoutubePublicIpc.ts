/**
 * WFX-ANON-VIEW-1 — the main-process key-free public-web transport IPC.
 *
 * youtube.com serves no CORS headers for arbitrary origins, so the
 * renderer cannot reach the public web surfaces (InnerTube + SSR pages)
 * with its own fetch: the MAIN process is the only sanctioned egress —
 * exactly the Netflix transport law (webflixNetflixIpc.ts), now for the
 * anonymous YouTube engine. This module registers exactly ONE namespaced
 * channel over exactly the webflix flavor:
 *
 *   - `webflix:youtube-public:fetch` — a bounded public-surface fetch:
 *     POST https://www.youtube.com/youtubei/v1/{search,browse,next} (the
 *     anonymous InnerTube family; the request body is built connectors-side
 *     and rides as JSON text), or GET one of the public SSR pages
 *     (/feed/trending[/{music,gaming,movies}], /@handle[/videos],
 *     /channel/<id>[/videos] — with the optional ?gl/&hl region/language
 *     params). Chrome UA + 12s timeout + one retry on 429/5xx/network,
 *     mirroring the Netflix transport's budget.
 *
 * Boundary rules (binding, mirroring webflixNetflixIpc.ts): no generic
 * invoke passthrough, no cookies, no credentials of any kind (this is the
 * ANONYMOUS path — the keyed Data-API engine keeps its own renderer-side
 * googleapis fetch, which does serve CORS), no other youtube.com paths,
 * and the flavor gate (WEBFLIX_IDENTITY unset ⇒ zero channels registered).
 */
import { ipcMain } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

export const WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL = "webflix:youtube-public:fetch";

/**
 * The bounded InnerTube endpoints (the anonymous POST family — search is
 * the engine's workhorse; browse/next stay allowlisted for the follow-up
 * watch-metadata lane). Pinned by the battery in webflixYoutubePublicIpc.test.ts.
 */
const INNERTUBE_ENDPOINTS: readonly string[] = ["search", "browse", "next"];

/** The bounded SSR page path shapes (the anonymous GET family). */
const SSR_TRENDING_PATHS: readonly string[] = [
  "/feed/trending",
  "/feed/trending/music",
  "/feed/trending/gaming",
  "/feed/trending/movies",
];

const CHANNEL_ID_PATTERN = /^\/channel\/UC[A-Za-z0-9_-]{22}(\/videos)?\/?$/;
const HANDLE_PATTERN = /^\/@[\w.-]+(\/videos)?\/?$/;
const SSR_QUERY_PATTERN = /^[a-z]{2}=[A-Za-z]{2}(?:&[a-z]{2}=[A-Za-z]{2})?$/;
/** The InnerTube POST query shape the connectors request builder emits
 * (the public key + prettyPrint=false — the key is PUBLIC, so its VALUE is
 * not pinned here; the SHAPE is). Pinned-equal to innertubeRequestUrl by
 * the battery. */
const INNERTUBE_QUERY_PATTERN = /^\?key=[^&]+&prettyPrint=false$/;

const PUBLIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 12_000;

export interface WebFlixYoutubePublicFetchResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly reason?: string;
}

export interface WebFlixYoutubePublicIpcOptions {
  /** Injectable logger (tests). */
  readonly logger?: { warn(message: string): void } | null;
  /** Injectable fetch (tests); default: the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /**
   * The baked product flavor (default: the ZCODE_PRODUCT_FLAVOR runtime
   * constant). Test seam mirroring webflixAgentWorkspaceIpc.ts.
   */
  readonly flavor?: typeof ZCODE_PRODUCT_FLAVOR;
}

/** True when the URL is one of the bounded public surfaces (https only). */
function isAllowedPublicUrl(rawMethod: unknown, rawUrl: unknown): rawUrl is string {
  if (rawMethod !== "GET" && rawMethod !== "POST") return false;
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.youtube.com") return false;
    const pathAndQuery = `${url.pathname}${url.search}`;
    if (rawMethod === "POST") {
      // /youtubei/v1/<endpoint>?key=<public key>&prettyPrint=false — the
      // exact URL shape the connectors request builder emits (pinned-equal
      // by the battery's bridge test against innertubeRequestUrl).
      const match = /^\/youtubei\/v1\/([a-z_]+)$/.exec(url.pathname);
      return match !== null && INNERTUBE_ENDPOINTS.includes(match[1]) && INNERTUBE_QUERY_PATTERN.test(url.search);
    }
    // SSR GETs: the bounded trending pages, channel pages, handle pages —
    // with only the optional gl/hl query params.
    const [path, query = ""] = pathAndQuery.split("?");
    if (query !== "" && !SSR_QUERY_PATTERN.test(query)) return false;
    if (SSR_TRENDING_PATHS.includes(path)) return true;
    if (CHANNEL_ID_PATTERN.test(path)) return true;
    return HANDLE_PATTERN.test(path);
  } catch {
    return false;
  }
}

async function fetchPublicSurface(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<WebFlixYoutubePublicFetchResult> {
  const doFetch = async (): Promise<WebFlixYoutubePublicFetchResult> => {
    try {
      const res = await fetchImpl(url, {
        method: init.method,
        headers: {
          ...(init.method === "POST"
            ? {
                "Content-Type": "application/json",
                Accept: "*/*",
                Origin: "https://www.youtube.com",
                Referer: "https://www.youtube.com/",
                "X-Origin": "https://www.youtube.com",
                "X-Youtube-Client-Name": "1",
                "X-Youtube-Client-Version": "2.20260925.08.00",
              }
            : {
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                Referer: "https://www.youtube.com/",
              }),
          "User-Agent": PUBLIC_UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        return { ok: false, reason: `youtube public upstream answered ${res.status}` };
      }
      return { ok: true, text: await res.text() };
    } catch (error) {
      return { ok: false, reason: `youtube public upstream fetch failed: ${String(error)}` };
    }
  };
  const first = await doFetch();
  if (first.ok) return first;
  // One retry — the walled/5xx class is transient at the CDN edge.
  return doFetch();
}

/** Registers the namespaced channel (idempotent-safe, flavor-gated). */
export function registerWebFlixYoutubePublicIpc(options: WebFlixYoutubePublicIpcOptions = {}): void {
  const { logger = null, fetchImpl = fetch, flavor = ZCODE_PRODUCT_FLAVOR } = options;
  if (flavor !== "webflix") {
    return;
  }

  ipcMain.handle(WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL, async (_event, payload) => {
    const request = payload as { method?: unknown; url?: unknown; bodyJson?: unknown } | undefined;
    const method = request?.method;
    const url = request?.url;
    const bodyJson =
      typeof request?.bodyJson === "string" && request.bodyJson !== "" ? request.bodyJson : undefined;
    if (
      !isAllowedPublicUrl(method, url) ||
      (method === "POST" && bodyJson === undefined) ||
      (method === "GET" && bodyJson !== undefined)
    ) {
      logger?.warn(`[webflix-youtube-public] rejected non-allowlisted request: ${String(url)}`);
      return {
        ok: false,
        reason: "Only the anonymous InnerTube endpoints and the public SSR pages are fetchable.",
      };
    }
    return fetchPublicSurface(fetchImpl, url as string, {
      method: method === "POST" ? "POST" : "GET",
      ...(bodyJson !== undefined ? { body: bodyJson } : {}),
    });
  });
}
