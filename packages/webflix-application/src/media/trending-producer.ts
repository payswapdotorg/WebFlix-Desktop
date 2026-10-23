/**
 * TrendingPort producer (WFX-PROVIDER-SLICE-1) — the trending chart
 * surface over the official Data API (videos.list chart=mostPopular,
 * 1 unit per page; region/category ride through with official semantics).
 *
 * Honest laws:
 *   - region echoes what the composition knows: the provider's served-
 *     region echo when the engine page carries one, else the requested
 *     region, else null (the provider default chart) — never a guess.
 *   - chips are honestly EMPTY: no official category-list surface is wired
 *     (videoCategories.list is a later order if sanctioned), and fabricated
 *     chips would be dead controls. A caller-supplied category rides
 *     through as the official videoCategoryId.
 */
import type { MediaPageRequest, TrendingPort, TrendingView, VideoCardView } from "webflix-contracts";
import { detailFromCapability, phaseFromCapability, videoCardFromRow } from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle } from "./youtube-source-port";

export interface TrendingProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** Chart rows per page (1..50, official bound; default 24). */
  readonly trendingMaxResults?: number;
}

/** The trending-chart producer over the official Data API engine. */
export class YouTubeTrendingProducer implements TrendingPort {
  private readonly deps: TrendingProducerDeps;

  constructor(deps: TrendingProducerDeps) {
    this.deps = deps;
  }

  async trending(
    input: { region?: string; category?: string },
    request?: MediaPageRequest,
  ): Promise<TrendingView> {
    const region = typeof input?.region === "string" && input.region !== "" ? input.region : undefined;
    const category =
      typeof input?.category === "string" && input.category !== "" ? input.category : undefined;

    if (this.deps.source.kind !== "source") {
      return {
        region: region ?? null,
        chips: [],
        selectedChip: category ?? null,
        videos: [],
        nextCursor: null,
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }

    const now = this.deps.clock.now();
    const page = await this.deps.source.source.trending({
      ...(region !== undefined ? { regionCode: region } : {}),
      ...(category !== undefined ? { videoCategoryId: category } : {}),
      ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
      ...(this.deps.trendingMaxResults !== undefined ? { maxResults: this.deps.trendingMaxResults } : {}),
      // A caller-supplied limit OVERRIDES the configured page size (documented precedence).
      ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
    });
    if (page.kind === "honest-state") {
      return {
        region: region ?? null,
        chips: [],
        selectedChip: category ?? null,
        videos: [],
        nextCursor: null,
        phase: phaseFromCapability(page.capability),
        detail: detailFromCapability(page.capability),
      };
    }

    const videos: VideoCardView[] = page.value.rows.map((row) => videoCardFromRow(row, now));
    const servedRegion = page.value.regionCode ?? region ?? null;
    if (videos.length === 0) {
      return {
        region: servedRegion,
        chips: [],
        selectedChip: category ?? null,
        videos: [],
        nextCursor: null,
        phase: "empty",
        detail: "The official trending chart returned no rows for this region/category.",
      };
    }
    return {
      region: servedRegion,
      chips: [],
      selectedChip: category ?? null,
      videos,
      nextCursor: page.value.nextPageToken,
      phase: "ready",
    };
  }
}

function clampLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
