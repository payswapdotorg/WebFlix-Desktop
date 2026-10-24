/**
 * WFX-ANON-VIEW-1 — the KEY-FREE PUBLIC WEB engine behind the media
 * producers: `YouTubePublicSourceAdapter`, structurally satisfying the same
 * app-owned `YouTubeCatalogSource` port as the official Data-API adapter
 * (mediaSource.ts) — the compatibility is pinned by compile-time assignment
 * in the hermetic suite, exactly like its keyed sibling.
 *
 * WHAT THIS ENGINE IS (the operator's ruling — "you shouldn't need to sign
 * in before you can start viewing videos, I want the same exact UX as the
 * web app"): the web app's own anonymous data path, ported. No Data-API
 * key, no account, no cookies — every surface answers with REAL
 * youtube.com public-web data:
 *   - search        POST /youtubei/v1/search (the public WEB client key)
 *   - channel rail  the same search, type=channel params
 *   - trending      SSR /feed/trending[/{music,gaming,movies}]?gl= — with
 *                   the web app's documented public-mode fallback ladder:
 *                   a walled/empty SSR page (the What-to-Watch nudge on
 *                   logged-out datacenter egress) is filled with REAL
 *                   popular-this-week search data (sort=views, week, video)
 *   - channels      SSR /channel/<id> and /@handle pages (+ /videos grids)
 *   - shorts        the public search feed ("viral shorts" — the web app's
 *                   SHORTS_SEED_QUERY); classification stays the app
 *                   layer's documented duration/marker rule
 *
 * HONEST-STATE LAW (identical to the keyed adapter): every method resolves
 * `{ kind: "ok", value }` or `{ kind: "honest-state", capability }` — a
 * dead transport maps to the typed unavailable capability, never a thrown
 * error at the port boundary, never fabricated rows. The trending ladder
 * degrades rung-by-rung BEFORE answering an honest state (SSR →
 * search-compose → honest unavailable), exactly like the deployed site.
 */
import type { OperationCapability } from "webflix-contracts";
import type { YouTubeChannelSummary, YouTubeSourcePage, YouTubeVideoRow } from "./mediaSource";
import {
  buildPublicSearchParam,
  extractYtInitialData,
  innertubeRequestBody,
  innertubeRequestHeaders,
  innertubeRequestUrl,
  ssrRequestHeaders,
  YOUTUBE_PUBLIC_SSR_BASE,
  type PublicHttpFetch,
} from "./publicTransport";
import {
  publicRowsFromResponse,
  publicSearchContinuationToken,
} from "./publicMapping";
import { channelSummaryFromChannelRenderer, channelSummaryFromPageResponse } from "./publicChannelMapping";
import { walkTree } from "./publicText";

/** The budget note the public engine's quota-free ledger surfaces. */
export const YOUTUBE_PUBLIC_BUDGET_NOTE =
  "YouTube search rides the key-free public web surface (the web app's own anonymous path) — no Data API quota applies.";

/** The shorts feed's seed query (the web app's SHORTS_SEED_QUERY). */
export const YOUTUBE_PUBLIC_SHORTS_SEED_QUERY = "viral shorts";

/** The search-compose seed per trending category (the web app's table). */
const TRENDING_CATEGORY_SEARCH_TERMS: Record<string, string> = {
  now: "trending",
  music: "music",
  gaming: "gaming",
  movies: "movies",
};

/** Data-API videoCategoryId → the SSR trending category path segment. */
function trendingCategoryPath(videoCategoryId: string | undefined): string {
  switch (videoCategoryId) {
    case "10":
      return "/music";
    case "20":
      return "/gaming";
    case "1":
    case "30":
      return "/movies";
    default:
      return "";
  }
}

function trendingSearchTerm(videoCategoryId: string | undefined): string {
  const key =
    videoCategoryId === "10"
      ? "music"
      : videoCategoryId === "20"
        ? "gaming"
        : videoCategoryId === "1" || videoCategoryId === "30"
          ? "movies"
          : "now";
  return TRENDING_CATEGORY_SEARCH_TERMS[key] ?? "trending";
}

const honestUnavailable = (detail: string): { kind: "honest-state"; capability: OperationCapability } => ({
  kind: "honest-state",
  capability: { status: "unavailable", detail },
});

export interface YouTubePublicSourceAdapterOptions {
  /** ISO instant stamped onto mapped rows (tests inject a fixed clock). */
  readonly observedAt?: () => string;
  /** Soft-TTL for the trending/shorts/channel page cache (default 60s). */
  readonly cacheTtlMs?: number;
}

/**
 * The key-free public-web engine. The transport is INJECTED (the renderer
 * binds the main-process IPC bridge; tests bind fixture fetches) — this
 * class never fetches on its own.
 */
export class YouTubePublicSourceAdapter {
  private readonly fetchImpl: PublicHttpFetch;
  private readonly observedAt: () => string;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(fetchImpl: PublicHttpFetch, options: YouTubePublicSourceAdapterOptions = {}) {
    this.fetchImpl = fetchImpl;
    this.observedAt = options.observedAt ?? (() => new Date().toISOString());
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  // ---- the port surface (structurally the app-owned YouTubeCatalogSource) ---

  /** POST /youtubei/v1/search — real public results, continuation-paged. */
  async searchVideos(input: {
    q: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<{ kind: "ok"; value: YouTubeSourcePage } | { kind: "honest-state"; capability: OperationCapability }> {
    try {
      const body =
        input.pageToken !== undefined && input.pageToken !== ""
          ? innertubeRequestBody({ continuation: input.pageToken })
          : innertubeRequestBody({ query: input.q });
      const response = await this.postJson("search", body);
      const rows = publicRowsFromResponse(response, {
        observedAt: this.observedAt(),
        surface: "search feed",
        ...(input.maxResults !== undefined ? { limit: input.maxResults } : {}),
      });
      return {
        kind: "ok",
        value: {
          rows,
          nextPageToken: publicSearchContinuationToken(response),
          budget: this.budget(),
        },
      };
    } catch (error) {
      return honestUnavailable(this.transportDetail("search", error));
    }
  }

  /** The same search with type=channel params — the channel rail + resolution. */
  async searchChannels(input: {
    q: string;
    maxResults?: number;
  }): Promise<
    | { kind: "ok"; value: { readonly channels: readonly YouTubeChannelSummary[] } }
    | { kind: "honest-state"; capability: OperationCapability }
  > {
    try {
      const body = innertubeRequestBody({
        query: input.q,
        params: buildPublicSearchParam({ type: "channel" }),
      });
      const response = await this.postJson("search", body);
      const channels: YouTubeChannelSummary[] = [];
      const seen = new Set<string>();
      for (const renderer of walkTree(response, "channelRenderer")) {
        const summary = channelSummaryFromChannelRenderer(renderer);
        if (summary === null || seen.has(summary.channelId)) continue;
        seen.add(summary.channelId);
        channels.push(summary);
      }
      const limit = input.maxResults ?? 8;
      return { kind: "ok", value: { channels: channels.slice(0, limit) } };
    } catch (error) {
      return honestUnavailable(this.transportDetail("channel search", error));
    }
  }

  /**
   * The trending ladder (the web app's documented path): the SSR category
   * page first; a walled/empty page (logged-out datacenter egress serves
   * the What-to-Watch nudge) is filled with REAL popular-this-week search
   * data. Only a dead transport answers an honest state.
   */
  async trending(input: {
    regionCode?: string;
    videoCategoryId?: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<{ kind: "ok"; value: YouTubeSourcePage } | { kind: "honest-state"; capability: OperationCapability }> {
    if (input.pageToken !== undefined && input.pageToken !== "") {
      // Append pages ride the search-compose continuation (the only ladder
      // rung that carries one — documented).
      return this.searchVideos({
        q: trendingSearchTerm(input.videoCategoryId),
        pageToken: input.pageToken,
        ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
      });
    }
    const limit = input.maxResults ?? 24;
    const categoryPath = trendingCategoryPath(input.videoCategoryId);
    const region =
      typeof input.regionCode === "string" && /^[A-Z]{2}$/.test(input.regionCode)
        ? input.regionCode
        : undefined;
    const path = `/feed/trending${categoryPath}${region !== undefined ? `?gl=${region}&hl=en` : "?hl=en"}`;
    try {
      const cached = this.cachedRows(`ssr:${path}`);
      if (cached !== undefined && cached.length > 0) {
        return { kind: "ok", value: this.page(cached, null, region) };
      }
      const html = await this.getText(`${YOUTUBE_PUBLIC_SSR_BASE}${path}`);
      const rows = publicRowsFromResponse(extractYtInitialData(html), {
        observedAt: this.observedAt(),
        surface: "trending page",
        limit,
      });
      if (rows.length > 0) {
        this.storeRows(`ssr:${path}`, rows);
        return { kind: "ok", value: this.page(rows, null, region) };
      }
    } catch {
      // SSR failure → the search-compose rail still serves real data.
    }
    // public-mode fallback: real popular-this-week videos for the category.
    try {
      const body = innertubeRequestBody(
        { query: trendingSearchTerm(input.videoCategoryId), params: buildPublicSearchParam({ sort: "views", uploadDate: "week", type: "video" }) },
        region,
      );
      const response = await this.postJson("search", body);
      const rows = publicRowsFromResponse(response, {
        observedAt: this.observedAt(),
        surface: "trending search-compose",
        limit,
      });
      return {
        kind: "ok",
        value: this.page(rows, publicSearchContinuationToken(response), region),
      };
    } catch (error) {
      return honestUnavailable(this.transportDetail("trending", error));
    }
  }

  /** SSR /channel/<id> — the provider's own page is the lookup. */
  async channelById(
    channelId: string,
  ): Promise<
    | { kind: "ok"; value: { readonly channel: YouTubeChannelSummary | null } }
    | { kind: "honest-state"; capability: OperationCapability }
  > {
    return this.channelPage(`/channel/${encodeURIComponent(channelId)}`);
  }

  /** SSR /@handle — the canonical channel page for a handle. */
  async channelByHandle(
    handle: string,
  ): Promise<
    | { kind: "ok"; value: { readonly channel: YouTubeChannelSummary | null } }
    | { kind: "honest-state"; capability: OperationCapability }
  > {
    const bare = handle.replace(/^[@\s/]+/, "").trim();
    return this.channelPage(`/@${bare}`);
  }

  /** The channel's uploads grid — the /videos tab's richItemRenderer grid. */
  async channelUploads(input: {
    channelId: string;
    maxResults?: number;
    pageToken?: string;
  }): Promise<{ kind: "ok"; value: YouTubeSourcePage } | { kind: "honest-state"; capability: OperationCapability }> {
    const key = `/channel/${encodeURIComponent(input.channelId)}/videos`;
    try {
      const cached = this.cachedRows(`ssr:${key}`);
      if (cached !== undefined) {
        return { kind: "ok", value: this.page(cached.slice(0, input.maxResults ?? cached.length), null) };
      }
      const html = await this.getText(`${YOUTUBE_PUBLIC_SSR_BASE}${key}`);
      const rows = publicRowsFromResponse(extractYtInitialData(html), {
        observedAt: this.observedAt(),
        surface: "channel uploads grid",
        ...(input.maxResults !== undefined ? { limit: input.maxResults } : {}),
      });
      this.storeRows(`ssr:${key}`, rows);
      return { kind: "ok", value: this.page(rows, null) };
    } catch (error) {
      return honestUnavailable(this.transportDetail("channel uploads", error));
    }
  }

  /**
   * The shorts feed — the public search feed over the web app's seed query
   * ("viral shorts"). Classification stays the app layer's documented
   * duration/marker rule (the rows carry real durations).
   */
  async shortsFeed(input: {
    maxResults?: number;
    pageToken?: string;
  }): Promise<{ kind: "ok"; value: YouTubeSourcePage } | { kind: "honest-state"; capability: OperationCapability }> {
    return this.searchVideos({
      q: YOUTUBE_PUBLIC_SHORTS_SEED_QUERY,
      ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
      ...(input.pageToken !== undefined ? { pageToken: input.pageToken } : {}),
    });
  }

  /** The quota-free ledger view (the note overrides the unit math upstream). */
  budget(): {
    state: "ok" | "low" | "exhausted";
    unitsUsedToday: number;
    unitsLimitToday: number;
    unitsRemainingToday: number;
    searchCallsRemainingToday: number;
    note?: string;
  } {
    return {
      state: "ok",
      unitsUsedToday: 0,
      unitsLimitToday: 0,
      unitsRemainingToday: 0,
      searchCallsRemainingToday: 0,
      note: YOUTUBE_PUBLIC_BUDGET_NOTE,
    };
  }

  // ---- internals -------------------------------------------------------------

  private page(
    rows: readonly YouTubeVideoRow[],
    nextPageToken: string | null,
    regionCode?: string,
  ): YouTubeSourcePage {
    return {
      rows,
      nextPageToken,
      budget: this.budget(),
      ...(regionCode !== undefined ? { regionCode } : {}),
    };
  }

  private async postJson(endpoint: string, body: string): Promise<unknown> {
    const response = await this.fetchImpl(innertubeRequestUrl(endpoint), {
      method: "POST",
      headers: innertubeRequestHeaders(),
      body,
    });
    if (!response.ok) {
      throw new Error(`youtubei/${endpoint} answered HTTP ${response.status}`);
    }
    return JSON.parse(await response.text()) as unknown;
  }

  private async getText(url: string): Promise<string> {
    const response = await this.fetchImpl(url, { method: "GET", headers: ssrRequestHeaders() });
    if (!response.ok) {
      throw new Error(`the public page answered HTTP ${response.status}`);
    }
    return response.text();
  }

  private async channelPage(
    path: string,
  ): Promise<
    | { kind: "ok"; value: { readonly channel: YouTubeChannelSummary | null } }
    | { kind: "honest-state"; capability: OperationCapability }
  > {
    try {
      const html = await this.getText(`${YOUTUBE_PUBLIC_SSR_BASE}${path}`);
      const data = extractYtInitialData(html);
      const summary = channelSummaryFromPageResponse(data);
      if (summary === null) {
        // The page exists but carries no channel header — the provider's
        // own "no such channel" answer (an ok outcome with null).
        return { kind: "ok", value: { channel: null } };
      }
      return { kind: "ok", value: { channel: summary } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP 40[04]/.test(message)) {
        // The provider's own not-found answer — an ok outcome with null.
        return { kind: "ok", value: { channel: null } };
      }
      return honestUnavailable(this.transportDetail("channel lookup", error));
    }
  }

  private transportDetail(surface: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `the key-free public web transport failed on the ${surface}: ${message}`;
  }

  private cachedRows(key: string): readonly YouTubeVideoRow[] | undefined {
    const entry = this.cache.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value as readonly YouTubeVideoRow[];
  }

  private storeRows(key: string, rows: readonly YouTubeVideoRow[]): void {
    if (this.cache.size > 32) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, value: rows });
  }
}
