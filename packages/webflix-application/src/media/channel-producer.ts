/**
 * ChannelPort producer (WFX-PROVIDER-SLICE-1) — the channel surface over
 * the official Data API.
 *
 * Composition (documented, quota-aware — 4 units per channel page):
 *   - channels.list by id OR by handle (the official forHandle param —
 *     the engine's channelByHandle path; 1 unit) for the header (snippet +
 *     statistics + contentDetails + brandingSettings);
 *   - the channel's uploads shelf via channelUploadsCatalog (channels.list
 *     contentDetails + playlistItems.list = 2 units) plus the documented
 *     enrichment read (1 unit) so durations/view counts exist for labels
 *     and shorts classification;
 *   - append pages (channelAppend): playlistItems.list + enrichment
 *     (2 units), paged on the playlist's own nextPageToken.
 *
 * Honest laws:
 *   - availableTabs lists ONLY tabs the loaded data supports: "videos"
 *     always (the uploads shelf), "shorts" only when the loaded page
 *     actually contains shorts-classified rows, "about" only when the
 *     provider reported a description. "home", "live" and "playlists" are
 *     never claimed (no composed home tab, no live-surface data, and the
 *     frozen ChannelView carries no playlists field — each an honest
 *     absence, recorded in the policy matrix).
 *   - Shorts classification: the documented media-cards rule (not live AND
 *     positive duration ≤ 60s OR #Shorts title marker).
 *   - Phase-gated variants (requires-auth / honest states / not-found)
 *     carry the REQUESTED identity (the caller's channelId or handle) as
 *     the placeholder header — no provider facts are invented; the phase +
 *     detail carry the honest state (a documented shape decision: the
 *     frozen ChannelView requires a channel header on every phase).
 */
import type { ChannelHeaderView, ChannelPort, ChannelView, MediaPageRequest, VideoCardView } from "webflix-contracts";
import {
  channelHeaderFromSummary,
  detailFromCapability,
  isShortRow,
  phaseFromCapability,
  videoCardFromRow,
} from "./media-cards";
import type { ClockPort } from "../ports";
import type { YouTubeCatalogSourceHandle, YouTubeVideoRow } from "./youtube-source-port";

export interface ChannelProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** Uploads rows per page (1..50, official bound; default 24). */
  readonly uploadsMaxResults?: number;
}

/** The channel-surface producer over the official Data API engine. */
export class YouTubeChannelProducer implements ChannelPort {
  private readonly deps: ChannelProducerDeps;

  constructor(deps: ChannelProducerDeps) {
    this.deps = deps;
  }

  async channel(
    input: { channelId?: string; handle?: string; tab?: string },
    request?: MediaPageRequest,
  ): Promise<ChannelView> {
    const requestedId = input?.channelId;
    const requestedHandle = input?.handle;
    if ((typeof requestedId !== "string" || requestedId === "") && (typeof requestedHandle !== "string" || requestedHandle === "")) {
      return {
        channel: placeholderHeader("unknown", "Channel"),
        availableTabs: [],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: "unavailable",
        detail: "a channel surface requires a channelId or a handle — none was requested.",
      };
    }

    if (this.deps.source.kind !== "source") {
      return {
        channel: placeholderHeader(requestedId, requestedHandle),
        availableTabs: [],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }

    const engine = this.deps.source.source;
    const now = this.deps.clock.now();

    // The official lookup path: by id when given, else by handle (forHandle).
    const lookup =
      typeof requestedId === "string" && requestedId !== ""
        ? await engine.channelById(requestedId)
        : await engine.channelByHandle(requestedHandle ?? "");
    if (lookup.kind === "honest-state") {
      const phase = phaseFromCapability(lookup.capability);
      return {
        channel: placeholderHeader(requestedId, requestedHandle),
        availableTabs: [],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase,
        detail: detailFromCapability(lookup.capability),
      };
    }
    const channel = lookup.value.channel;
    if (channel === null) {
      return {
        channel: placeholderHeader(requestedId, requestedHandle),
        availableTabs: [],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: "unavailable",
        detail: `YouTube reports no channel for ${
          typeof requestedId === "string" && requestedId !== "" ? `id "${requestedId}"` : `handle "${requestedHandle}"`
        }.`,
      };
    }

    const header: ChannelHeaderView = channelHeaderFromSummary(channel);
    const uploads = await engine.channelUploads({
      channelId: channel.channelId,
      ...(this.deps.uploadsMaxResults !== undefined ? { maxResults: this.deps.uploadsMaxResults } : {}),
      ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
      ...(request?.cursor !== undefined ? { pageToken: request.cursor } : {}),
    });
    if (uploads.kind === "honest-state") {
      // Identity is known, the videos shelf is not — partial-honest view.
      return {
        channel: header,
        availableTabs: availableTabsOf(header, []),
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: phaseFromCapability(uploads.capability),
        detail: detailFromCapability(uploads.capability),
      };
    }

    return channelReadyView(header, uploads.value.rows, now, uploads.value.nextPageToken);
  }

  async channelAppend(channelId: string, cursor: string, request?: MediaPageRequest): Promise<ChannelView> {
    if (this.deps.source.kind !== "source") {
      return {
        // The append's header is the requested identity (the caller already
        // holds the real one — documented shape decision, no quota re-spent).
        channel: placeholderHeader(channelId, undefined),
        availableTabs: ["videos"],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: "requires-auth",
        detail: this.deps.source.detail,
      };
    }
    const now = this.deps.clock.now();
    const uploads = await this.deps.source.source.channelUploads({
      channelId,
      pageToken: cursor,
      ...(this.deps.uploadsMaxResults !== undefined ? { maxResults: this.deps.uploadsMaxResults } : {}),
      // A caller-supplied limit OVERRIDES the configured page size (documented precedence).
      ...(request?.limit !== undefined ? { maxResults: clampLimit(request.limit) } : {}),
    });
    if (uploads.kind === "honest-state") {
      return {
        channel: placeholderHeader(channelId, undefined),
        availableTabs: ["videos"],
        videos: [],
        shorts: [],
        nextCursor: null,
        phase: phaseFromCapability(uploads.capability),
        detail: detailFromCapability(uploads.capability),
      };
    }
    return channelReadyView(placeholderHeader(channelId, undefined), uploads.value.rows, now, uploads.value.nextPageToken);
  }
}

function channelReadyView(
  header: ChannelHeaderView,
  rows: readonly YouTubeVideoRow[],
  now: Date,
  nextCursor: string | null,
): ChannelView {
  const videos: VideoCardView[] = [];
  const shorts: VideoCardView[] = [];
  for (const row of rows) {
    if (isShortRow(row)) shorts.push(videoCardFromRow(row, now));
    else videos.push(videoCardFromRow(row, now));
  }
  return {
    channel: header,
    availableTabs: availableTabsOf(header, shorts),
    videos,
    shorts,
    nextCursor,
    phase: "ready",
  };
}

function availableTabsOf(header: ChannelHeaderView, shorts: readonly VideoCardView[]): ChannelView["availableTabs"] {
  const tabs: ChannelView["availableTabs"] = ["videos"];
  if (shorts.length > 0) tabs.push("shorts");
  if (typeof header.description === "string" && header.description !== "") tabs.push("about");
  return tabs;
}

function placeholderHeader(channelId: string | undefined, handle: string | undefined): ChannelHeaderView {
  // The REQUESTED identity as the placeholder (no provider facts invented).
  const id = typeof channelId === "string" && channelId !== "" ? channelId : `handle:${handle ?? "unknown"}`;
  const title = typeof handle === "string" && handle !== "" ? handle : (channelId ?? "Channel");
  return { channelId: id, title, verified: false };
}

function clampLimit(limit: number): number {
  return Math.min(50, Math.max(1, Math.floor(limit)));
}
