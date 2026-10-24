/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the media-host support
 * modules: the session watch-history adapter, the honest account seam, the
 * documented budgetNote→phase mapping, and the default producers build
 * (the key IPC → live composition → producer bundle).
 *
 * WFX-ANON-VIEW-1 (the operator's ruling — "you shouldn't need to sign in
 * before you can start viewing videos, I want the same exact UX as the web
 * app"): the default producers build now composes the KEY-FREE PUBLIC WEB
 * engine when no Data-API key is configured — the web app's own anonymous
 * path (InnerTube + SSR through the main-process transport bridge), so the
 * app boots straight into real videos with zero sign-in. The keyed engine
 * stays the precedence when an operator key IS configured; requires-auth
 * now honestly means NEITHER engine could be built (no key AND no public
 * transport — the fail-closed non-desktop state).
 *
 * Extracted from boot.tsx for the repo's max-lines law; behavior is
 * byte-equivalent to the integrated host's original inline definitions.
 */
import type { CatalogItem, SearchPageData } from "../../../../../webflix-contracts/src/index.js";
import type { VideoCardView } from "../../../../../webflix-contracts/src/media-views.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import { YOUTUBE_PROVIDER_ID } from "./searchFlow.js";
import { createLiveYouTubeComposition } from "../../../../../connectors/src/youtube/liveComposition.js";
import { createPublicYouTubeComposition } from "../../../../../connectors/src/youtube/publicComposition.js";
import { createYouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { MediaWatchHistorySource } from "../../../../../webflix-application/src/media/media-history-port.js";
import type { SubscriptionsAccountSource } from "../../../../../webflix-application/src/media/subscriptions-account-port.js";
import type { YouTubeCatalogSourceHandle } from "../../../../../webflix-application/src/media/youtube-source-port.js";
import type { getWebFlixAgentWorkspaceBridge } from "./agentWorkspaceBridge.js";
import { bridgeYoutubePublicFetch, getWebFlixYoutubePublicBridge } from "./youtubePublicUpstreamBridge.js";

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
 * The default producers build (WFX-ANON-VIEW-1): the key IPC decides the
 * engine — a configured Data-API key takes precedence (the official
 * surfaces + quota ledger, exactly as before); NO key composes the
 * KEY-FREE PUBLIC WEB engine (the web app's own anonymous path through
 * the main-process transport bridge) so every surface boots into real
 * videos with zero sign-in. Only when NEITHER engine can be built (no key
 * AND no public transport — the fail-closed non-desktop runtime) does the
 * honest requires-auth handle ride (freeze §9.5 addendum).
 */
export async function createDefaultMediaProducers(
  agentWorkspaceBridge: ReturnType<typeof getWebFlixAgentWorkspaceBridge>,
  historySource: MediaWatchHistorySource,
): Promise<YouTubeMediaProducers> {
  if (agentWorkspaceBridge === null) {
    return createYouTubeMediaProducers({
      clock: { now: () => new Date() },
      source: {
        kind: "requires-auth",
        detail:
          "The YouTube engine bridge is unavailable in this runtime — every surface answers requires-auth (fail-closed; nothing is invented).",
      },
      history: historySource,
      account: createNotConnectedAccountSource(),
    });
  }
  const keyResult = await agentWorkspaceBridge.getYouTubeApiKey();
  const hasKey = keyResult.key !== null && keyResult.key !== "";
  const keyedComposition = hasKey
    ? await createLiveYouTubeComposition({
        apiKeySource: { getApiKey: async () => keyResult.key },
      })
    : null;
  const handle: YouTubeCatalogSourceHandle =
    keyedComposition !== null && keyedComposition.kind === "live"
      ? { kind: "source", source: keyedComposition.source }
      : // No key configured (or a failing key source — the honest no-key
        // state): the key-free public web engine IS the default engine, so
        // the anonymous UX never walls (the operator's ruling).
        publicOrClosedHandle();
  return createYouTubeMediaProducers({
    clock: { now: () => new Date() },
    source: handle,
    history: historySource,
    account: createNotConnectedAccountSource(),
  });
}

/**
 * The key-free public web engine's handle — or, when its transport bridge
 * is absent (non-desktop runtime), the honest fail-closed requires-auth
 * handle. Never fabricated rows, never a thrown crash.
 */
function publicOrClosedHandle(): YouTubeCatalogSourceHandle {
  const publicBridge = getWebFlixYoutubePublicBridge();
  const composition =
    publicBridge !== null
      ? createPublicYouTubeComposition({ fetchImpl: bridgeYoutubePublicFetch(() => publicBridge) })
      : createPublicYouTubeComposition({});
  return composition.kind === "live"
    ? { kind: "source", source: composition.source }
    : {
        kind: "requires-auth",
        detail: `${composition.detail} — every surface answers requires-auth until a transport or a Data-API key exists (fail-closed; nothing is invented).`,
      };
}
