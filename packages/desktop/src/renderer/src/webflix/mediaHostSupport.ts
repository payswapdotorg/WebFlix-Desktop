/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the media-host support
 * modules: the session watch-history adapter, the honest account seam, the
 * documented budgetNote→phase mapping, and the default producers build
 * (the key IPC → live composition → producer bundle).
 *
 * Extracted from boot.tsx for the repo's max-lines law; behavior is
 * byte-equivalent to the integrated host's original inline definitions.
 */
import type { CatalogItem, SearchPageData } from "../../../../../webflix-contracts/src/index.js";
import type { VideoCardView } from "../../../../../webflix-contracts/src/media-views.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import { YOUTUBE_PROVIDER_ID } from "./searchFlow.js";
import { createLiveYouTubeComposition } from "../../../../../connectors/src/youtube/liveComposition.js";
import { createYouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { MediaWatchHistorySource } from "../../../../../webflix-application/src/media/media-history-port.js";
import type { SubscriptionsAccountSource } from "../../../../../webflix-application/src/media/subscriptions-account-port.js";
import type { getWebFlixAgentWorkspaceBridge } from "./agentWorkspaceBridge.js";

// ---------------------------------------------------------------------------
// The session watch-history adapter (WebFlix-owned facts; the durable store
// is the local-library seam's later order — stated in the UI, never implied).
// ---------------------------------------------------------------------------

interface SessionHistoryRecord {
  readonly item: CatalogItem;
  readonly card: VideoCardView | null;
  positionMs: number;
  durationMs?: number;
  watchedAt: string;
}

export interface SessionHistorySource extends MediaWatchHistorySource {
  recordWatch(item: CatalogItem, card: VideoCardView | null, durationMs?: number): void;
  recordProgress(itemId: string, positionMs: number, durationMs?: number): void;
}

export function createSessionHistorySource(): SessionHistorySource {
  const records = new Map<string, SessionHistoryRecord>();
  const clock = (): string => new Date().toISOString();
  const toEntries = (list: readonly SessionHistoryRecord[]) =>
    list.map((record) => ({
      itemId: record.item.id,
      item: record.item,
      positionMs: record.positionMs,
      ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      watchedAt: record.watchedAt,
    }));
  return {
    recordWatch(item, card, durationMs) {
      records.set(item.id, {
        item,
        card,
        positionMs: 0,
        ...(durationMs !== undefined ? { durationMs } : {}),
        watchedAt: clock(),
      });
    },
    recordProgress(itemId, positionMs, durationMs) {
      const existing = records.get(itemId);
      if (existing === undefined) return;
      existing.positionMs = positionMs;
      if (durationMs !== undefined) existing.durationMs = durationMs;
      existing.watchedAt = clock();
    },
    async listContinueWatching(limit) {
      const all = [...records.values()]
        .sort((a, b) => (a.watchedAt < b.watchedAt ? 1 : -1))
        .filter((record) => {
          if (record.durationMs === undefined) return true;
          return record.positionMs < record.durationMs * 0.95;
        });
      return toEntries(all.slice(0, limit ?? all.length));
    },
    async listHistory(limit) {
      const all = [...records.values()].sort((a, b) => (a.watchedAt < b.watchedAt ? 1 : -1));
      return toEntries(all.slice(0, limit ?? all.length));
    },
  };
}

/** The honest not-connected account seam (connect is honestly unavailable in this build). */
export function createNotConnectedAccountSource(): SubscriptionsAccountSource {
  return {
    connectionState() {
      return "not-configured";
    },
    async listSubscribedChannels() {
      return [];
    },
  };
}

/**
 * The documented shape decision's shell-side half (WFX-PROVIDER-SLICE-1):
 * the SearchPageData carries NO phase — the producer lands every honest
 * state in budgetNote with a "(requires-auth)" / "(rate-limited)" /
 * "(unavailable)" vocabulary marker. THIS host owns the phase mapping.
 */
export function searchPhaseFromPageData(query: string, data: SearchPageData): SearchState {
  const note = data.budgetNote ?? "";
  if (data.videos.length === 0 && data.channels.length === 0 && note !== "") {
    if (note.includes("(requires-auth)")) {
      return { phase: "requires-auth", query, providerId: YOUTUBE_PROVIDER_ID };
    }
    if (note.includes("(rate-limited)")) {
      return { phase: "rate-limited", query, detail: note };
    }
    if (note.includes("(unavailable)")) {
      return { phase: "unavailable", query, detail: note };
    }
    if (note.includes("(empty)")) {
      return { phase: "empty", query };
    }
  }
  if (data.videos.length === 0 && data.channels.length === 0) {
    return { phase: "empty", query };
  }
  return { phase: "results", query, items: data.videos.map((card) => card.item) };
}

/**
 * The default producers build: the key IPC → the live composition → the
 * producer bundle. No key ⇒ the honest requires-auth handle (freeze §9.5 —
 * every Data-API surface answers requires-auth; nothing is invented).
 */
export async function createDefaultMediaProducers(
  agentWorkspaceBridge: ReturnType<typeof getWebFlixAgentWorkspaceBridge>,
  historySource: MediaWatchHistorySource,
): Promise<YouTubeMediaProducers> {
  if (agentWorkspaceBridge === null) {
    return createYouTubeMediaProducers({
      clock: () => Date.now(),
      source: {
        kind: "requires-auth",
        detail:
          "The YouTube Data API key bridge is unavailable in this runtime — every Data-API-backed surface answers requires-auth (fail-closed; nothing is invented).",
      },
      history: historySource,
      account: createNotConnectedAccountSource(),
    });
  }
  const keyResult = await agentWorkspaceBridge.getYouTubeApiKey();
  const composition = await createLiveYouTubeComposition({
    apiKeySource: { getApiKey: async () => keyResult.key },
  });
  const handle =
    composition.kind === "live"
      ? { kind: "source" as const, source: composition.source }
      : { kind: "requires-auth" as const, detail: composition.detail };
  return createYouTubeMediaProducers({
    clock: () => Date.now(),
    source: handle,
    history: historySource,
    account: createNotConnectedAccountSource(),
  });
}
