/**
 * SearchPagePort producer (WFX-PROVIDER-SLICE-1) — the search page over the
 * official Data API.
 *
 * Composition (documented, quota-aware):
 *   - first page: search.list type=video (100 units) + search.list
 *     type=channel (100 units) for the channel rail + the engine's
 *     documented enrichment read (1 unit) for the video facts;
 *   - append pages (cursor set): the video search ONLY (100 + 1 units) —
 *     the channel rail is a first-page fact, never re-queried;
 *   - budgetNote always carries the quota ledger's post-call snapshot.
 *
 * WHERE THE HONEST STATES LAND (a documented shape decision): the frozen
 * SearchPageData carries NO phase field — the media-views contract states
 * "the honest-phase mapping is the shell's". This producer therefore NEVER
 * THROWS: every engine honest state resolves as SearchPageData with empty
 * videos/channels, nextCursor null, and budgetNote carrying the honest
 * state (capability status + reason) so the shell can phase its own UI
 * from the note's vocabulary. Examples:
 *   - no key      → budgetNote "search requires an official key … (requires-auth)"
 *   - quota spent → budgetNote "search is rate-limited: … (rate-limited)"
 *   - network     → budgetNote "search is unavailable: … (unavailable)"
 * The capability mapping itself happens in the connectors-side engine via
 * searchCapabilityFromError (the frozen §2.3 vocabulary) — this producer
 * only renders it.
 */
import type { SearchPageData, SearchPagePort } from "webflix-contracts";
import type { MediaPageRequest } from "webflix-contracts";
import { channelCardFromSummary, detailFromCapability, videoCardFromRow } from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle, YouTubeSourceBudgetSnapshot } from "./youtube-source-port";

export interface SearchPageProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
}

/** The search-page producer over the official Data API engine. */
export class YouTubeSearchPageProducer implements SearchPagePort {
  private readonly deps: SearchPageProducerDeps;

  constructor(deps: SearchPageProducerDeps) {
    this.deps = deps;
  }

  async searchPage(query: string, request?: MediaPageRequest): Promise<SearchPageData> {
    const trimmed = typeof query === "string" ? query.trim() : "";
    if (trimmed === "") {
      return {
        query: typeof query === "string" ? query : "",
        videos: [],
        channels: [],
        nextCursor: null,
        budgetNote: "empty query — nothing was searched (no quota was spent).",
      };
    }

    if (this.deps.source.kind !== "source") {
      return {
        query: trimmed,
        videos: [],
        channels: [],
        nextCursor: null,
        budgetNote: `YouTube search requires an official Data API v3 key — none is configured (requires-auth). ${this.deps.source.detail}`,
      };
    }

    const now = this.deps.clock.now();
    const engine = this.deps.source.source;
    const isAppendPage = request?.cursor !== undefined;
    const maxResults = request?.limit !== undefined ? clampLimit(request.limit) : undefined;

    const videoOutcome = await engine.searchVideos({
      q: trimmed,
      ...(maxResults !== undefined ? { maxResults } : {}),
      ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
    });
    if (videoOutcome.kind === "honest-state") {
      return {
        query: trimmed,
        videos: [],
        channels: [],
        nextCursor: null,
        budgetNote: honestSearchNote(videoOutcome.capability.status, detailFromCapability(videoOutcome.capability)),
      };
    }
    const page = videoOutcome.value;
    const videos = page.rows.map((row) => videoCardFromRow(row, now));

    // The channel rail is a FIRST-PAGE fact (documented quota decision:
    // appending never re-spends the 100-unit channel search).
    let channels: SearchPageData["channels"] = [];
    let budget: YouTubeSourceBudgetSnapshot = page.budget;
    if (!isAppendPage) {
      const channelOutcome = await engine.searchChannels({
        q: trimmed,
        ...(maxResults !== undefined ? { maxResults: Math.min(8, maxResults) } : { maxResults: 8 }),
      });
      if (channelOutcome.kind === "ok") {
        channels = channelOutcome.value.channels.map((summary) => channelCardFromSummary(summary));
      } else {
        // The channel rail failing does not fail the video results — the
        // note reports it honestly alongside the video budget.
        return {
          query: trimmed,
          videos,
          channels: [],
          nextCursor: page.nextPageToken,
          budgetNote: `${budgetNoteOf(budget)} — the channel rail is unavailable (${channelOutcome.capability.status}: ${detailFromCapability(channelOutcome.capability)}).`,
        };
      }
    }

    return {
      query: trimmed,
      videos,
      channels,
      nextCursor: page.nextPageToken,
      budgetNote: budgetNoteOf(budget),
    };
  }
}

function honestSearchNote(status: string, detail: string): string {
  return `YouTube search answered the honest state "${status}" — no results this page. ${detail}`;
}

function budgetNoteOf(budget: YouTubeSourceBudgetSnapshot): string {
  return `YouTube search budget: ${budget.unitsRemainingToday.toLocaleString("en-US")} of ${budget.unitsLimitToday.toLocaleString("en-US")} units remain today (~${budget.searchCallsRemainingToday} searches).`;
}

function clampLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
