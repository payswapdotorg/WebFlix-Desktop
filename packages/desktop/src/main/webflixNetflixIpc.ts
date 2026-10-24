/**
 * WFX-NETFLIX-SOURCE-1 — the main-process Netflix transport IPC.
 *
 * netflix.com serves NO CORS headers (and robots disallow generic agents),
 * so the renderer cannot reach the Tudum pages with its own fetch: the MAIN
 * process is the only sanctioned egress. This module registers exactly two
 * namespaced channels over exactly the webflix flavor:
 *
 *   - `webflix:netflix-upstream:fetch` — a bounded pool-page fetch. The URL
 *     must be https://www.netflix.com + one of the 8 Tudum pool paths (the
 *     allowlist is pinned against the connectors POOLS matrix by test).
 *     Chrome UA + 12s timeout + one retry, mirroring the connector's budget.
 *   - `webflix:netflix-upstream:open-url` — the play hand-off: opens a
 *     netflix.com /watch/<id> or /title/<id> URL in the SYSTEM browser
 *     (shell.openExternal — the same external-handoff law the streaming
 *     family and the account connect flow use).
 *
 * Boundary rules (binding, mirroring webflixAgentWorkspaceIpc.ts): no
 * generic invoke passthrough, no cookies, no other netflix.com paths, the
 * flavor gate (WEBFLIX_IDENTITY unset ⇒ zero channels registered).
 */
import { ipcMain, shell } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

export const WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL = "webflix:netflix-upstream:fetch";
export const WEBFLIX_NETFLIX_OPEN_URL_CHANNEL = "webflix:netflix-upstream:open-url";

/**
 * The bounded Tudum pool paths (the connectors' POOLS matrix, duplicated
 * here so main never imports the connectors package; pinned-equal by the
 * battery in webflixNetflixIpc.test.ts).
 */
const POOL_PATHS: readonly string[] = [
  "/tudum/top10/",
  "/tudum/top10/tv",
  "/tudum/top10/films-non-english",
  "/tudum/top10/tv-non-english",
  "/tudum/top10/most-popular",
  "/tudum/top10/most-popular/tv",
  "/tudum/top10/most-popular/films-non-english",
  "/tudum/top10/most-popular/tv-non-english",
];

const POOL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 12_000;

export interface WebFlixNetflixFetchResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly reason?: string;
}

export interface WebFlixNetflixOpenUrlResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface WebFlixNetflixIpcOptions {
  /** Injectable logger (tests). */
  readonly logger?: { warn(message: string): void } | null;
  /** Injectable fetch (tests); default: the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable system-browser opener (tests); default: shell.openExternal. */
  readonly openExternal?: (url: string) => Promise<void>;
  /**
   * The baked product flavor (default: the ZCODE_PRODUCT_FLAVOR runtime
   * constant). Test seam mirroring webflixAgentWorkspaceIpc.ts.
   */
  readonly flavor?: typeof ZCODE_PRODUCT_FLAVOR;
}

/** True when the URL is one of the 8 bounded Tudum pool pages (https only). */
function isAllowedPoolUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.hostname !== "www.netflix.com") return false;
    return POOL_PATHS.includes(url.pathname);
  } catch {
    return false;
  }
}

/** True when the URL is a netflix.com watch/title deep link (https only). */
function isAllowedDeepLinkUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.hostname !== "www.netflix.com") return false;
    return /^\/(watch|title)\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

async function fetchPoolPage(
  fetchImpl: typeof fetch,
  url: string,
): Promise<WebFlixNetflixFetchResult> {
  const doFetch = async (): Promise<WebFlixNetflixFetchResult> => {
    try {
      const res = await fetchImpl(url, {
        headers: {
          "User-Agent": POOL_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        return { ok: false, reason: `netflix upstream answered ${res.status}` };
      }
      return { ok: true, text: await res.text() };
    } catch (error) {
      return { ok: false, reason: `netflix upstream fetch failed: ${String(error)}` };
    }
  };
  const first = await doFetch();
  if (first.ok) return first;
  // One retry — the walled/5xx class is transient at the CDN edge.
  return doFetch();
}

/** Registers the two namespaced channels (idempotent-safe, flavor-gated). */
export function registerWebFlixNetflixIpc(options: WebFlixNetflixIpcOptions = {}): void {
  const {
    logger = null,
    fetchImpl = fetch,
    openExternal = (url: string) => shell.openExternal(url),
    flavor = ZCODE_PRODUCT_FLAVOR,
  } = options;
  if (flavor !== "webflix") {
    return;
  }

  ipcMain.handle(WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL, async (_event, payload) => {
    const url = (payload as { url?: unknown } | undefined)?.url;
    if (!isAllowedPoolUrl(url)) {
      logger?.warn(`[webflix-netflix] rejected non-pool upstream url: ${String(url)}`);
      return { ok: false, reason: "Only the 8 Tudum Top 10 pool pages are fetchable." };
    }
    return fetchPoolPage(fetchImpl, url);
  });

  ipcMain.handle(WEBFLIX_NETFLIX_OPEN_URL_CHANNEL, async (_event, payload) => {
    const url = (payload as { url?: unknown } | undefined)?.url;
    if (!isAllowedDeepLinkUrl(url)) {
      logger?.warn(`[webflix-netflix] rejected non-deep-link open url: ${String(url)}`);
      return { ok: false, reason: "Only netflix.com /watch/<id> or /title/<id> links open externally." };
    }
    try {
      await openExternal(url);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `The system browser could not open the link: ${String(error)}` };
    }
  });
}
