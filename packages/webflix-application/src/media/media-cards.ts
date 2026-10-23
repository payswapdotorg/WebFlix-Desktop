/**
 * Card-view builders (WFX-PROVIDER-SLICE-1) — engine rows, channel
 * summaries and local history entries → the FROZEN card shapes
 * (`webflix-contracts/src/media-views.ts`).
 *
 * Laws encoded here:
 *   - THE CANONICAL ITEM RIDES VERBATIM: every video/continue card carries
 *     the CatalogItem exactly as the engine produced it — the UI's play
 *     path resolves through the same playback planning the buttons use.
 *     The ONE documented adjustment: shorts classification sets mediaKind
 *     "short" (a frozen MediaKind value) on the card's item copy when the
 *     classification rule fires — id/assets/metadata stay untouched, so
 *     playability is unaffected and the classification is honestly
 *     data-driven (see below).
 *   - SHORTS CLASSIFICATION RULE (documented, binding on this slice): a
 *     row classifies as a short iff it is not live AND
 *     (a) its provider-reported duration is a positive value ≤ 60,000 ms,
 *     OR (b) its title carries the #Shorts hashtag marker (case-insensitive
 *     "#shorts" or "#short" at a word boundary). Rows without a duration
 *     and without the marker stay long-form — an honest absence, never a
 *     guess (search snippets carry no durations until the documented
 *     enrichment read).
 *   - LABELS ARE PRODUCER-FORMATTED (media-labels.ts): every label comes
 *     from the deterministic en-US helpers; absent facts produce absent
 *     labels, never fabricated ones.
 *   - BADGES ARE DATA: "live" only when the provider says
 *     liveBroadcastContent === "live"; "new" when published within the
 *     last 7 days (computed on the injected clock); "progress" on continue
 *     cards with a positive position. The Data API exposes NO verified-
 *     badge or members-only field — those badges are never emitted (an
 *     honest absence, recorded in the policy matrix).
 *   - THE HONEST-PHASE MAPPING: capability statuses (frozen §2.3) map onto
 *     MediaViewPhase (frozen view vocabulary) — requires-auth →
 *     requires-auth, rate-limited → rate-limited, unsupported →
 *     unsupported, unavailable → unavailable, degraded → degraded,
 *     unknown → status-unknown.
 */
import type { MediaViewPhase, OperationCapability } from "webflix-contracts";
import type {
  ChannelCardView,
  ChannelHeaderView,
  ContinueCardView,
  VideoBadge,
  VideoCardView,
} from "webflix-contracts";
import type { MediaWatchHistoryEntry } from "./media-history-port";
import {
  clockLabel,
  createdAtLabel,
  progressLabel,
  relativePublishedLabel,
  subscriberLabel,
  videoCountLabel,
  viewsLabel,
} from "./media-labels";
import type { YouTubeChannelSummary, YouTubeVideoRow } from "./youtube-source-port";

// Re-export the deterministic label surface alongside the card builders
// (one import site for producers; media-labels.ts stays single-purpose).
export {
  compactCount,
  clockLabel,
  viewsLabel,
  relativePublishedLabel,
  subscriberLabel,
  videoCountLabel,
  progressLabel,
  createdAtLabel,
} from "./media-labels";
export type { ClockPort as MediaClockPort } from "../ports";

/** The "new" badge window: published within the last 7 days (documented rule). */
export const NEW_BADGE_WINDOW_MS = 7 * 24 * 3_600_000;

/** The shorts duration ceiling (documented classification rule): 60 seconds. */
export const SHORTS_DURATION_CEILING_MS = 60_000;

const SHORTS_TITLE_MARKER = /#shorts?\b/i;

/** The frozen view-phase vocabulary. */
export type MediaPhase = MediaViewPhase;

/** The phase a NON-READY surface view carries (loading/ready are the shell's transient states). */
export type SurfacePhase = Exclude<MediaViewPhase, "loading" | "ready">;

/** Maps a frozen capability status onto the frozen view phase (documented). */
export function phaseFromCapability(capability: OperationCapability): MediaViewPhase {
  switch (capability.status) {
    case "requires-auth":
      return "requires-auth";
    case "rate-limited":
      return "rate-limited";
    case "unsupported":
      return "unsupported";
    case "unavailable":
      return "unavailable";
    case "degraded":
      return "degraded";
    default:
      return "status-unknown";
  }
}

/** The detail line honest-state surfaces carry (the capability's own reason). */
export function detailFromCapability(capability: OperationCapability): string {
  return capability.detail ?? `the YouTube source answered "${capability.status}" without detail`;
}

/** Maps a capability onto the NON-READY phase vocabulary (home-feed surfaces). */
export function surfacePhaseFromCapability(capability: OperationCapability): SurfacePhase {
  const phase = phaseFromCapability(capability);
  return phase === "loading" || phase === "ready" ? "status-unknown" : phase;
}

/**
 * The documented shorts-classification rule (module docblock): not live AND
 * (positive duration ≤ 60s OR a #Shorts title marker).
 */
export function isShortRow(row: YouTubeVideoRow): boolean {
  if (row.liveBroadcastContent === "live") return false;
  if (row.durationMs !== undefined && Number.isFinite(row.durationMs) && row.durationMs > 0) {
    return row.durationMs <= SHORTS_DURATION_CEILING_MS;
  }
  return SHORTS_TITLE_MARKER.test(row.item.title);
}

function badgesOfRow(row: YouTubeVideoRow, now: Date): VideoBadge[] {
  const badges: VideoBadge[] = [];
  if (row.liveBroadcastContent === "live") badges.push("live");
  if (isNewlyPublished(row, now)) badges.push("new");
  return badges;
}

function isNewlyPublished(row: YouTubeVideoRow, now: Date): boolean {
  if (typeof row.publishedAt !== "string") return false;
  const publishedMs = Date.parse(row.publishedAt);
  if (!Number.isFinite(publishedMs)) return false;
  const age = now.getTime() - publishedMs;
  return age >= 0 && age <= NEW_BADGE_WINDOW_MS;
}

/**
 * A video card from an engine row. The canonical item rides verbatim —
 * with the ONE documented adjustment: a shorts-classified row's card item
 * carries mediaKind "short" (id/assets/metadata untouched).
 */
export function videoCardFromRow(row: YouTubeVideoRow, now: Date): VideoCardView {
  const short = isShortRow(row);
  return {
    item: short ? { ...row.item, mediaKind: "short" } : row.item,
    title: row.item.title,
    ...(row.channelId !== undefined ? { channelId: row.channelId } : {}),
    ...(row.channelTitle !== undefined ? { channelTitle: row.channelTitle } : {}),
    ...(row.thumbnailUrl !== undefined ? { thumbnailUrl: row.thumbnailUrl } : {}),
    ...(row.durationMs !== undefined && row.liveBroadcastContent !== "live" && clockLabel(row.durationMs) !== undefined
      ? { durationLabel: clockLabel(row.durationMs) }
      : {}),
    ...(viewsLabel(row.viewCount) !== undefined ? { viewsLabel: viewsLabel(row.viewCount) } : {}),
    ...(relativePublishedLabel(row.publishedAt, now) !== undefined
      ? { publishedLabel: relativePublishedLabel(row.publishedAt, now) }
      : {}),
    badges: badgesOfRow(row, now),
  };
}

function rowFromHistoryEntry(entry: MediaWatchHistoryEntry): YouTubeVideoRow {
  const metadata = entry.item.metadata as Record<string, unknown> | undefined;
  const channelId = typeof metadata?.channelId === "string" ? metadata.channelId : undefined;
  const channelTitle = typeof metadata?.channelTitle === "string" ? metadata.channelTitle : undefined;
  const publishedAt = typeof metadata?.publishedAt === "string" ? metadata.publishedAt : undefined;
  return {
    item: entry.item,
    ...(channelId !== undefined ? { channelId } : {}),
    ...(channelTitle !== undefined ? { channelTitle } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

/**
 * A continue-watching card from a WebFlix-owned history entry — the
 * canonical item rides verbatim (recorded at watch time), the resume facts
 * are the store's own numbers, and the "progress" badge marks an
 * in-progress item.
 */
export function continueCardFromEntry(entry: MediaWatchHistoryEntry, now: Date): ContinueCardView {
  const base = videoCardFromRow(rowFromHistoryEntry(entry), now);
  const durationMs = entry.durationMs;
  const percent =
    durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(1, Math.max(0, entry.positionMs / durationMs))
      : null;
  const badges: VideoBadge[] = entry.positionMs > 0 ? [...base.badges, "progress"] : base.badges;
  const label = progressLabel(entry.positionMs, durationMs);
  return {
    ...base,
    progressPercent: percent,
    ...(label !== undefined ? { progressLabel: label } : {}),
    ...(entry.positionMs > 0 ? { resumeAtSec: Math.floor(entry.positionMs / 1000) } : {}),
    badges,
  };
}

/** A channel card from an engine channel summary (absent facts stay absent). */
export function channelCardFromSummary(summary: YouTubeChannelSummary): ChannelCardView {
  const subscribers = subscriberLabel(summary.subscriberCount);
  const videos = videoCountLabel(summary.videoCount);
  return {
    channelId: summary.channelId,
    title: summary.title,
    ...(summary.handle !== undefined ? { handle: summary.handle } : {}),
    ...(summary.thumbnailUrl !== undefined ? { thumbnailUrl: summary.thumbnailUrl } : {}),
    ...(subscribers !== undefined ? { subscriberLabel: subscribers } : {}),
    ...(videos !== undefined ? { videoCountLabel: videos } : {}),
    // The Data API exposes no verified-badge field — verified stays false
    // (an honest absence, never a guess; recorded in the policy matrix).
    verified: false,
    ...(summary.description !== undefined ? { description: summary.description } : {}),
  };
}

/** A channel header from an engine channel summary. */
export function channelHeaderFromSummary(summary: YouTubeChannelSummary): ChannelHeaderView {
  const joined = createdAtLabel(summary.publishedAt);
  return {
    ...channelCardFromSummary(summary),
    ...(summary.bannerUrl !== undefined ? { bannerUrl: summary.bannerUrl } : {}),
    ...(joined !== undefined ? { createdAtLabel: joined } : {}),
  };
}

/** Newest-first row sort (binding on resolution/uploads/subscriptions composes). */
export function sortRowsNewestFirst(rows: readonly YouTubeVideoRow[]): YouTubeVideoRow[] {
  return [...rows].sort((a, b) => {
    const aMs = typeof a.publishedAt === "string" ? Date.parse(a.publishedAt) : Number.NaN;
    const bMs = typeof b.publishedAt === "string" ? Date.parse(b.publishedAt) : Number.NaN;
    if (Number.isFinite(aMs) && Number.isFinite(bMs)) return bMs - aMs;
    // Rows with an unknown publish instant sort last, stable.
    if (Number.isFinite(aMs)) return -1;
    if (Number.isFinite(bMs)) return 1;
    return 0;
  });
}
