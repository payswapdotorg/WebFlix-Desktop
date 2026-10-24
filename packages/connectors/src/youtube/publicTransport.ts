/**
 * WFX-ANON-VIEW-1 — the key-free PUBLIC WEB transport constants + request
 * builders for the anonymous YouTube engine (the web app's own anonymous
 * path, ported verbatim from payswapdotorg/webflix-2.0 src/lib/youtube/
 * {innertube,ssr}.ts — the deployed site's anonymous browsing surface).
 *
 * WHY THIS EXISTS (the operator's ruling, recorded in the ADR-0003 addendum
 * and freeze §9.5's WFX-ANON-VIEW-1 addendum): the desktop app must show
 * videos with ZERO sign-in and zero operator credentials — the same exact
 * UX as the web app. The web app's anonymous path never touches the
 * official Data API v3 (that stays a per-user/keyed overlay): it rides
 * youtube.com's own public InnerTube endpoints with YouTube's public
 * hard-coded WEB client key, plus SSR reads of the public trending /
 * channel pages. Both are unauthenticated, key-free, and browser-shaped.
 *
 * LAWS (binding, mirroring liveComposition.ts):
 *   - RENDERER-SAFE: no node builtins (no Buffer, no crypto) — this module
 *     is bundled into the Electron renderer exactly like the rest of the
 *     connectors slice. base64 via the universal btoa.
 *   - NO SECRETS, NO COOKIES, NO AUTH: the anonymous engine sends no
 *     credential of any kind. The SAPISIDHASH/OAuth machinery of the web
 *     app is deliberately NOT ported — per-user auth stays the Data-API
 *     overlay's concern.
 *   - THE TRANSPORT IS INJECTED: a PublicHttpFetch seam (the renderer wires
 *     it to the main-process IPC bridge — youtube.com serves no CORS, so
 *     the main process is the only sanctioned egress; tests inject fixture
 *     fetches). This module only builds requests; it never fetches.
 */

// ---------------------------------------------------------------------------
// The public upstream constants (the web app's own values, byte-for-byte)
// ---------------------------------------------------------------------------

/**
 * YouTube's PUBLIC hard-coded WEB InnerTube key — shipped by youtube.com's
 * own web client to every anonymous visitor (env-overridable upstream, but
 * the desktop pins the constant: the anonymous engine carries no secrets).
 */
export const YOUTUBE_PUBLIC_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/** The InnerTube base every anonymous browser client POSTs to. */
export const YOUTUBE_PUBLIC_INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1";

/** The WEB client context youtube.com's own pages send. */
export const YOUTUBE_PUBLIC_WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20260925.08.00",
  hl: "en",
  gl: "US",
} as const;

/** The browser User-Agent shape the public endpoints expect. */
export const YOUTUBE_PUBLIC_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The SSR page base (trending pages, channel pages). */
export const YOUTUBE_PUBLIC_SSR_BASE = "https://www.youtube.com";

/** The canonical hotlinked card thumbnail (zero egress cost, CDN-public). */
export function publicVideoThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** The response shape the injected transport resolves with. */
export interface PublicHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The transport seam: one HTTP call. The renderer binds this to the
 * main-process IPC bridge (no CORS in the renderer); tests bind fixture
 * fetches. Retries/timeouts live at the transport (the main IPC mirrors
 * the Netflix transport's one-retry budget) — this layer stays single-shot.
 */
export type PublicHttpFetch = (
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string },
) => Promise<PublicHttpResponse>;

// ---------------------------------------------------------------------------
// InnerTube request builders (pure — no fetching here)
// ---------------------------------------------------------------------------

/** The request URL for one InnerTube endpoint (the public key rides it). */
export function innertubeRequestUrl(endpoint: string): string {
  return `${YOUTUBE_PUBLIC_INNERTUBE_BASE}/${endpoint}?key=${encodeURIComponent(
    YOUTUBE_PUBLIC_INNERTUBE_KEY,
  )}&prettyPrint=false`;
}

/** The browser-shaped headers every anonymous InnerTube POST carries. */
export function innertubeRequestHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": YOUTUBE_PUBLIC_BROWSER_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    "X-Origin": "https://www.youtube.com",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": YOUTUBE_PUBLIC_WEB_CLIENT.clientVersion,
  };
}

/** The headers an anonymous SSR page GET carries. */
export function ssrRequestHeaders(): Record<string, string> {
  return {
    "User-Agent": YOUTUBE_PUBLIC_BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.youtube.com/",
  };
}

/**
 * The InnerTube POST body: the WEB client context (with an optional region
 * override riding context.client.gl — the parameter youtube.com's own reads
 * carry) merged with the endpoint body. A body that ships its own
 * `context` still wins (the caller stated the exact shape).
 */
export function innertubeRequestBody(
  body: Record<string, unknown>,
  gl?: string,
): string {
  const context =
    gl !== undefined
      ? { context: { client: { ...YOUTUBE_PUBLIC_WEB_CLIENT, gl } } }
      : { context: { client: { ...YOUTUBE_PUBLIC_WEB_CLIENT } } };
  return JSON.stringify({ ...context, ...body });
}

// ---------------------------------------------------------------------------
// The SSR ytInitialData extractor (the web app's verified regex)
// ---------------------------------------------------------------------------

/**
 * The extraction regex verified by the web app's research log: YouTube
 * never emits a literal `</script>` inside the JSON (it escapes the slash),
 * so the lazy match is safe.
 */
export const YT_PUBLIC_INITIAL_DATA_RE = /var ytInitialData = ({[\s\S]*?});<\/script>/;

/** Pure extractor — throws when the page carries no ytInitialData. */
export function extractYtInitialData(html: string): Record<string, unknown> {
  const match = html.match(YT_PUBLIC_INITIAL_DATA_RE);
  if (match === null) {
    throw new Error("ytInitialData not found in page HTML");
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The search `params` builder (the web app's verified protobuf encoding)
// ---------------------------------------------------------------------------

export type PublicSearchSort = "relevance" | "date" | "views" | "rating";
export type PublicSearchUploadDate = "hour" | "today" | "week" | "month" | "year";
export type PublicSearchType = "video" | "channel" | "playlist" | "shorts" | "movie";

export interface PublicSearchFilters {
  sort?: PublicSearchSort;
  uploadDate?: PublicSearchUploadDate;
  type?: PublicSearchType;
}

const SORT_VALUES: Record<PublicSearchSort, number | undefined> = {
  relevance: undefined,
  rating: 1,
  date: 2,
  views: 3,
};

const UPLOAD_DATE_VALUES: Record<PublicSearchUploadDate, number> = {
  hour: 1,
  today: 2,
  week: 3,
  month: 4,
  year: 5,
};

const TYPE_VALUES: Record<PublicSearchType, number> = {
  video: 1,
  channel: 2,
  playlist: 3,
  movie: 4,
  shorts: 9,
};

// --- minimal protobuf writer (renderer-safe: btoa, no Buffer) ---------------

function varintBytes(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return out;
}

function varintField(field: number, value: number): number[] {
  return [...varintBytes((field << 3) | 0), ...varintBytes(value)];
}

function lenDelimited(field: number, payload: number[]): number[] {
  return [...varintBytes((field << 3) | 2), ...varintBytes(payload.length), ...payload];
}

function bytesToBase64(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Builds the base64 `params` for a filtered search (the encoding the web app
 * ground-truthed against the recorded filter menu + live probes). Empty or
 * relevance-only filters yield "" (the endpoint treats a missing param as
 * no filters).
 */
export function buildPublicSearchParam(filters: PublicSearchFilters = {}): string {
  const filterMessage: number[] = [];
  if (filters.uploadDate !== undefined) {
    filterMessage.push(...varintField(1, UPLOAD_DATE_VALUES[filters.uploadDate]));
  }
  if (filters.type !== undefined) {
    filterMessage.push(...varintField(2, TYPE_VALUES[filters.type]));
  }
  const message: number[] = [];
  const sortValue = filters.sort !== undefined ? SORT_VALUES[filters.sort] : undefined;
  if (sortValue !== undefined) {
    message.push(...varintField(1, sortValue));
  }
  if (filterMessage.length > 0) {
    message.push(...lenDelimited(2, filterMessage));
  }
  return bytesToBase64(message);
}

// ---------------------------------------------------------------------------
// Row provenance (the public engine's honest evidence strings)
// ---------------------------------------------------------------------------

/** The provenance evidence a public-surface row carries (never a secret). */
export function publicProvenance(surface: string, videoId: string): string {
  return `public-web: youtube.com ${surface} row videoId=${videoId} (the web app's own anonymous path — no key, no sign-in)`;
}
