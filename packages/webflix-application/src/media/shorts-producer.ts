/**
 * ShortsPort producer (WFX-PROVIDER-SLICE-1) — the shorts surface.
 *
 * THE DOCUMENTED HONEST COMPOSE (no official shorts-feed API exists for
 * third-party clients — AUDIT-SOURCES §8): shorts-classified rows from
 * the official trending chart (videos.list chart=mostPopular, 1 unit per
 * page), using the media-cards classification rule (not live AND positive
 * duration ≤ 60s OR #Shorts title marker). The append cursor pages the
 * SAME chart and re-classifies — each append page costs another unit.
 * The compose note rides the view's `detail` (the frozen ShortsView
 * carries no dedicated compositionNote field — detail is its note slot).
 */
import type { MediaPageRequest, ShortsPort, ShortsView, VideoCardView } from "webflix-contracts";
import { detailFromCapability, isShortRow, phaseFromCapability, videoCardFromRow } from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle } from "./youtube-source-port";

export const SHORTS_COMPOSE_NOTE =
  "Composed from the official YouTube Data API trending chart (videos.list chart=mostPopular) using the documented classification rule — duration ≤ 60s or a #Shorts title marker. YouTube publishes no shorts-feed API for third-party clients.";

export interface ShortsProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** Chart rows examined per page (1..50, official bound; default 24). */
  readonly trendingMaxResults?: number;
}

/** The shorts-surface producer (the documented honest compose). */
export class YouTubeShortsProducer implements ShortsPort {
  private readonly deps: ShortsProducerDeps;

  constructor(deps: ShortsProducerDeps) {
    this.deps = deps;
  }

  async shorts(request?: MediaPageRequest): Promise<ShortsView> {
    if (this.deps.source.kind !== "source") {
      return {
        shorts: [],
        nextCursor: null,
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }

    const now = this.deps.clock.now();
    const page = await this.deps.source.source.trending({
      ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
      ...(this.deps.trendingMaxResults !== undefined ? { maxResults: this.deps.trendingMaxResults } : {}),
      // A caller-supplied limit OVERRIDES the configured page size (documented precedence).
      ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
    });
    if (page.kind === "honest-state") {
      return {
        shorts: [],
        nextCursor: null,
        phase: phaseFromCapability(page.capability),
        detail: detailFromCapability(page.capability),
      };
    }

    const shorts: VideoCardView[] = page.value.rows
      .filter((row) => isShortRow(row))
      .map((row) => videoCardFromRow(row, now));
    if (shorts.length === 0) {
      return {
        shorts: [],
        nextCursor: null,
        phase: "empty",
        detail: `${SHORTS_COMPOSE_NOTE} — no classified shorts on this chart page.`,
      };
    }
    return {
      shorts,
      nextCursor: page.value.nextPageToken,
      phase: "ready",
      detail: SHORTS_COMPOSE_NOTE,
    };
  }
}

function clampLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
