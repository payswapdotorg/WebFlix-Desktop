/**
 * HomeFeedPort producer (WFX-PROVIDER-SLICE-1) — the honest home compose.
 *
 * YouTube publishes NO home-feed API for third-party clients (AUDIT-
 * SOURCES §8), so the surface is a DOCUMENTED compose:
 *   - a continue-watching rail from the injected WebFlix-OWNED local
 *     history store (WebFlix facts, works offline);
 *   - a shorts shelf — shorts-classified rows (media-cards.ts rule) from
 *     the same page;
 *   - a growing long-form grid over the official trending chart
 *     (videos.list chart=mostPopular, 1 unit per page; the append cursor
 *     is the chart's own nextPageToken).
 *
 * THE COMPOSITION NOTE LAW (frozen): the ready view's compositionNote
 * always names this compose. Per-section honest states: when the provider
 * page answers an honest state (rate-limited/unavailable/...), the
 * provider sections carry section-state rows with that phase while the
 * LOCAL continue rail still renders — and the surface's top-level phase
 * is the provider's phase (schema-legal: the frozen HomeFeedView allows
 * sections on the non-ready phases; this is the maximal-honest reading —
 * the compose never hides what still works, never fabricates what does
 * not). Without a configured API key (the handle law) the surface answers
 * requires-auth with the same partial-local-sections treatment.
 *
 * Category chips are honestly EMPTY: no official home-category surface is
 * wired, and fabricated chips would be dead controls. A caller-supplied
 * category rides through to the chart call as videoCategoryId (official
 * semantics).
 */
import type { HomeFeedPort, HomeFeedView, HomeSectionView } from "webflix-contracts";
import type { ContinueCardView, MediaPageRequest, OperationCapability, VideoCardView } from "webflix-contracts";
import type { MediaWatchHistorySource } from "./media-history-port";
import {
  continueCardFromEntry,
  detailFromCapability,
  isShortRow,
  surfacePhaseFromCapability,
  videoCardFromRow,
} from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle, YouTubeSourcePage } from "./youtube-source-port";

export const HOME_FEED_COMPOSITION_NOTE =
  "Composed from the provider's trending surface (the official Data API chart, or the key-free public web trending feed — the web app's own anonymous path) with a duration/title-classified shorts shelf and the WebFlix-local continue-watching rail — YouTube publishes no home-feed API for third-party clients.";

export const HOME_FEED_APPEND_COMPOSITION_NOTE =
  "Append page of the home compose: the provider trending surface's next page, split into the shorts-classified shelf and the long-form grid — no official home-feed API exists for third-party clients.";

export interface HomeFeedProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** The WebFlix-owned local history seam (the continue rail; works without a key). */
  readonly history: MediaWatchHistorySource;
  /** Default region for the trending chart (official regionCode semantics). */
  readonly defaultRegionCode?: string;
  /** Chart rows per page (1..50, official maxResults bound; default 24). */
  readonly trendingMaxResults?: number;
}

const CONTINUE_SECTION_LIMIT = 12;

/** The honest home-feed compose over the official trending chart + local history. */
export class YouTubeHomeFeedProducer implements HomeFeedPort {
  private readonly deps: HomeFeedProducerDeps;

  constructor(deps: HomeFeedProducerDeps) {
    this.deps = deps;
  }

  async getHomeFeed(request: MediaPageRequest & { category?: string }): Promise<HomeFeedView> {
    const now = this.deps.clock.now();
    const continueSection = await this.continueSection(now);

    if (this.deps.source.kind !== "source") {
      return this.requiresAuthView(this.deps.source.detail, continueSection);
    }

    const page = await this.deps.source.source.trending({
      ...(this.deps.defaultRegionCode !== undefined
        ? { regionCode: this.deps.defaultRegionCode }
        : {}),
      ...(request.category !== undefined ? { videoCategoryId: request.category } : {}),
      ...(this.deps.trendingMaxResults !== undefined ? { maxResults: this.deps.trendingMaxResults } : {}),
      // A caller-supplied limit OVERRIDES the configured page size (documented
      // precedence; identical rule in every producer).
      ...(request.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
    });
    if (page.kind === "honest-state") {
      return this.providerPhaseView(page.capability, continueSection);
    }
    return this.readyView(page.value, now, continueSection, request.category);
  }

  async getHomeFeedAppend(cursor: string, request?: MediaPageRequest): Promise<HomeFeedView> {
    if (this.deps.source.kind !== "source") {
      return {
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }
    const now = this.deps.clock.now();
    const page = await this.deps.source.source.trending({
      pageToken: cursor,
      ...(this.deps.trendingMaxResults !== undefined ? { maxResults: this.deps.trendingMaxResults } : {}),
      // A caller-supplied limit OVERRIDES the configured page size (documented precedence).
      ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
    });
    if (page.kind === "honest-state") {
      return {
        phase: surfacePhaseFromCapability(page.capability),
        detail: detailFromCapability(page.capability),
      };
    }
    const sections = providerSectionsOf(page.value, now);
    if (sections.length === 0) {
      return { phase: "empty", detail: "No further trending pages are available." };
    }
    return {
      phase: "ready",
      chips: [],
      selectedChip: null,
      sections,
      nextCursor: page.value.nextPageToken,
      compositionNote: HOME_FEED_APPEND_COMPOSITION_NOTE,
    };
  }

  // ---- internals -------------------------------------------------------------

  private async continueSection(now: Date): Promise<HomeSectionView | null> {
    try {
      const entries = await this.deps.history.listContinueWatching(CONTINUE_SECTION_LIMIT);
      if (entries.length === 0) return null;
      const items: ContinueCardView[] = entries.map((entry) => continueCardFromEntry(entry, now));
      return {
        kind: "continue-watching",
        sectionId: "home:continue-watching",
        title: "Continue watching",
        items,
      };
    } catch (error) {
      // A failing LOCAL store is a section-level honest state, never a crash.
      return {
        kind: "section-state",
        sectionId: "home:continue-watching",
        title: "Continue watching",
        phase: "unavailable",
        detail: `the local continue-watching store failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private requiresAuthView(detail: string, continueSection: HomeSectionView | null): HomeFeedView {
    return {
      phase: "requires-auth",
      detail: `${detail} — the local continue-watching rail still renders; the trending grid and shorts shelf need the key.`,
      sections: this.sectionsWith(continueSection, {
        kind: "section-state",
        sectionId: "home:trending",
        title: "Trending",
        phase: "requires-auth",
        detail: "the official YouTube Data API key is not configured",
      }),
    };
  }

  private providerPhaseView(
    capability: OperationCapability,
    continueSection: HomeSectionView | null,
  ): HomeFeedView {
    const phase = surfacePhaseFromCapability(capability);
    return {
      phase,
      detail: detailFromCapability(capability),
      sections: this.sectionsWith(continueSection, {
        kind: "section-state",
        sectionId: "home:trending",
        title: "Trending",
        phase,
        detail: detailFromCapability(capability),
      }),
    };
  }

  private readyView(
    page: YouTubeSourcePage,
    now: Date,
    continueSection: HomeSectionView | null,
    category: string | undefined,
  ): HomeFeedView {
    const sections = this.sectionsWith(continueSection, ...providerSectionsOf(page, now));
    if (sections.length === 0) {
      return { phase: "empty", detail: "Nothing to show: the trending chart and local history are both empty." };
    }
    return {
      phase: "ready",
      chips: [],
      selectedChip: category ?? null,
      sections,
      nextCursor: page.nextPageToken,
      compositionNote: HOME_FEED_COMPOSITION_NOTE,
    };
  }

  private sectionsWith(
    continueSection: HomeSectionView | null,
    ...providerSections: HomeSectionView[]
  ): HomeSectionView[] {
    const sections: HomeSectionView[] = [];
    if (continueSection !== null) sections.push(continueSection);
    sections.push(...providerSections);
    return sections;
  }
}

/** The provider-backed sections of one chart page: shorts shelf + long-form grid. */
function providerSectionsOf(page: YouTubeSourcePage, now: Date): HomeSectionView[] {
  const shorts: VideoCardView[] = [];
  const longForm: VideoCardView[] = [];
  for (const row of page.rows) {
    if (isShortRow(row)) shorts.push(videoCardFromRow(row, now));
    else longForm.push(videoCardFromRow(row, now));
  }
  const sections: HomeSectionView[] = [];
  if (shorts.length > 0) {
    sections.push({
      kind: "shorts-shelf",
      sectionId: "home:shorts",
      title: "Shorts",
      shorts,
    });
  }
  if (longForm.length > 0) {
    sections.push({
      kind: "video-grid",
      sectionId: "home:trending-grid",
      title: "Trending",
      videos: longForm,
      layout: "grid",
    });
  }
  return sections;
}

function clampLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
