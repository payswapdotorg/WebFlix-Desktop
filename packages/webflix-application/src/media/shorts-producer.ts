/**
 * ShortsPort producer (WFX-PROVIDER-SLICE-1 + WFX-ANON-VIEW-1) — the shorts
 * surface.
 *
 * THE DOCUMENTED HONEST COMPOSE (no official shorts-feed API exists for
 * third-party clients — AUDIT-SOURCES §8): when the engine provides a
 * dedicated shorts feed (the key-free public engine's "viral shorts"
 * search feed — the web app's own shorts surface), that feed IS the
 * surface; otherwise shorts-classified rows from the trending chart
 * (videos.list chart=mostPopular, 1 unit per page) using the media-cards
 * classification rule (not live AND positive duration ≤ 60s OR #Shorts
 * title marker). The append cursor pages whichever feed served the first
 * page. The compose note rides the view's `detail` (the frozen ShortsView
 * carries no dedicated compositionNote field — detail is its note slot).
 */
import type { MediaPageRequest, ShortsPort, ShortsView, VideoCardView } from "webflix-contracts";
import { detailFromCapability, isShortRow, phaseFromCapability, videoCardFromRow } from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle } from "./youtube-source-port";

export const SHORTS_COMPOSE_NOTE =
  "Composed from the provider's shorts surface — the key-free public web feed (the web app's own anonymous path) when the engine provides one, else shorts-classified trending rows — using the documented classification rule (duration ≤ 60s or a #Shorts title marker). YouTube publishes no shorts-feed API for third-party clients.";

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
    const engine = this.deps.source.source;
    // WFX-ANON-VIEW-1: a dedicated shorts feed (the public engine) IS the
    // surface; engines without one keep the trending-classification compose.
    const dedicated = engine.shortsFeed;
    const page =
      dedicated !== undefined
        ? await dedicated.call(engine, {
            ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
            ...(this.deps.trendingMaxResults !== undefined
              ? { maxResults: this.deps.trendingMaxResults }
              : {}),
            ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
          })
        : await engine.trending({
            ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
            ...(this.deps.trendingMaxResults !== undefined
              ? { maxResults: this.deps.trendingMaxResults }
              : {}),
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
        detail: `${SHORTS_COMPOSE_NOTE} — no classified shorts on this feed page.`,
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
