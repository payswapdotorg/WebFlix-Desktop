/**
 * The federated-search source adapter over the YouTube engine
 * (WFX-PROVIDER-SLICE-1 deliverable 3): a real-transport SearchSourcePort
 * implementation — structurally compatible with the application package's
 * `SearchSourcePort` (webflix-application/src/ports.ts) — so the existing
 * `FederatedSearch` use case can fan out to the official YouTube Data API
 * source behind the SAME seam the labeled fixtures used. The registry
 * composition (which sources join a registry) stays TL2/app-side.
 *
 * Laws carried from the port's own contract:
 *   - HONEST STATES AS DATA: an unconfigured (requires-auth), unsupported,
 *     rate-limited or otherwise unavailable source RESOLVES with that typed
 *     state in its SearchOutcome — never a thrown access error, never
 *     fabricated items.
 *   - STATUS MAPPING (documented vocabulary decision): the frozen
 *     SearchOutcome classes are ok | partial-failure | timeout |
 *     auth-required | unsupported — there is NO provider-rate-limited
 *     class. Mapping (engine capability → outcome):
 *       requires-auth → auth-required (reason names the key configuration)
 *       unsupported   → unsupported
 *       rate-limited | unavailable | unknown | degraded
 *                     → partial-failure with items: [] and the full honest
 *                       reason (a source that could not answer, surfaced in
 *                       coverage — never hidden, never retried silently).
 *     The missing rate-limited class is recorded as a freeze-deviation
 *     proposal for TL2 (the capability vocabulary has it; the search
 *     outcome vocabulary does not).
 *   - CANCELLATION AT THE BOUNDARY: an already-aborted call rejects with the
 *     typed common/cancelled WebFlixError and produces no outcome.
 *   - SOURCE-REPORTED ONLY: ok items are the canonical CatalogItems the
 *     engine's catalogMapping produced — verbatim, never re-ranked here.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { SearchOutcome, SearchRequest } from "webflix-contracts";
import type { YouTubeCatalogSourceAdapter } from "./mediaSource";
import { YOUTUBE_MEDIA_SOURCE_ADAPTER_VERSION } from "./mediaSource";

/** The registry source id this adapter serves (the fixture set used "fixture-youtube-like"). */
export const YOUTUBE_SEARCH_SOURCE_ID = "youtube";

export interface YouTubeSearchSourceOptions {
  /** Registry source id (default "youtube"); overridable for test registries. */
  readonly sourceId?: string;
  /** This adapter's version (default the media-source adapter version). */
  readonly version?: string;
  /** Max results per page (official API bound: 1..50; default 25). */
  readonly maxResults?: number;
}

/** The real-transport federated-search source over the official Data API engine. */
export class YouTubeSearchSource {
  readonly descriptor: { readonly source: string; readonly version: string };
  private readonly engine: YouTubeCatalogSourceAdapter;
  private readonly maxResults: number;

  constructor(engine: YouTubeCatalogSourceAdapter, options: YouTubeSearchSourceOptions = {}) {
    this.engine = engine;
    this.descriptor = {
      source: options.sourceId ?? YOUTUBE_SEARCH_SOURCE_ID,
      version: options.version ?? YOUTUBE_MEDIA_SOURCE_ADAPTER_VERSION,
    };
    this.maxResults = Math.min(50, Math.max(1, Math.floor(options.maxResults ?? 25)));
  }

  async search(request: SearchRequest, options?: { signal?: AbortSignal }): Promise<SearchOutcome> {
    // Boundary cancellation (the port contract, same as every real adapter must).
    if (options?.signal?.aborted === true) {
      throw new WebFlixError({
        code: ErrorCode.Cancelled,
        reason: "the YouTube search-source call was cancelled at the adapter boundary",
        retryable: false,
        context: { phase: "source-boundary", source: this.descriptor.source },
      });
    }
    const query = typeof request?.query === "string" ? request.query.trim() : "";
    if (query === "") {
      return {
        status: "ok",
        items: [],
      };
    }
    const limit = request.limits?.[this.descriptor.source];
    const outcome = await this.engine.searchVideos({
      q: query,
      maxResults: limit !== undefined ? Math.min(50, Math.max(1, limit)) : this.maxResults,
      pageToken: request.cursors?.[this.descriptor.source],
    });
    if (outcome.kind === "honest-state") {
      const capability = outcome.capability;
      const reason =
        capability.detail ??
        `the YouTube source answered the honest state "${capability.status}" without detail`;
      if (capability.status === "requires-auth") {
        return {
          status: "auth-required",
          reason: `YouTube search requires an official Data API v3 key — none is configured. ${reason}`,
        };
      }
      if (capability.status === "unsupported") {
        return { status: "unsupported", reason };
      }
      // rate-limited / unavailable / unknown / degraded — see module docblock.
      return { status: "partial-failure", reason, items: [] };
    }
    const page = outcome.value;
    const outcomeBase: SearchOutcome =
      page.rows.length === 0
        ? { status: "ok", items: [] }
        : {
            status: "ok",
            items: page.rows.map((row) => row.item),
            ...(page.nextPageToken !== null ? { nextCursor: page.nextPageToken } : {}),
          };
    return outcomeBase;
  }
}
