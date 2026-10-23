/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the LIVE-STATE mirror +
 * the visible-media context builder (freeze §9.1): the bridge is created
 * ONCE per handlers record, so every context read goes through this
 * post-commit snapshot of the host's own state — never a stale closure,
 * never a DOM scrape. Extracted from boot.tsx for the max-lines law.
 */
import { useCallback, useEffect, useRef } from "react";
import type { VisibleMediaContext } from "../../../../../webflix-contracts/src/index.js";
import type {
  ChannelView,
  HistoryView,
  HomeFeedView,
  SearchPageData,
  ShortsView,
  SubscriptionsView,
  TrendingView,
  VideoCardView,
} from "../../../../../webflix-contracts/src/media-views.js";
import type { WatchSurfaceState } from "../../../../../webflix-shell/src/components/AppShell.js";
import type { WebFlixAccountsStatus } from "./accountsBridge.js";

export interface LiveMediaState {
  readonly route: { route: VisibleMediaContext["route"]; params: VisibleMediaContext["params"] };
  readonly homeFeed: HomeFeedView | null;
  readonly searchPage: SearchPageData | null;
  readonly channelView: ChannelView | null;
  readonly trendingView: TrendingView | null;
  readonly shortsView: ShortsView | null;
  readonly subscriptionsView: SubscriptionsView | null;
  readonly historyView: HistoryView | null;
  readonly watchState: WatchSurfaceState | null;
  readonly accountsStatus: WebFlixAccountsStatus | null;
  readonly agentPanelVisible: boolean;
  readonly agentPanelWidth: number | null;
}

/**
 * Mirrors the host state into a post-commit ref and answers the frozen
 * VisibleMediaContext from it (visibleItemIds capped at 25 by the contract).
 */
export function useLiveMediaContext(state: LiveMediaState): () => VisibleMediaContext {
  const liveRef = useRef(state);
  useEffect(() => {
    liveRef.current = state;
  });

  return useCallback((): VisibleMediaContext => {
    const current = liveRef.current;
    const visibleItems: string[] = [];
    const pushCards = (cards: readonly VideoCardView[] | null | undefined) => {
      if (cards === undefined || cards === null) return;
      for (const card of cards) {
        if (visibleItems.length >= 25) return;
        visibleItems.push(card.item.id);
      }
    };
    if (current.route.route === "home" && current.homeFeed?.phase === "ready") {
      for (const section of current.homeFeed.sections) {
        if (section.kind === "video-grid") pushCards(section.videos);
        if (section.kind === "shorts-shelf") pushCards(section.shorts);
        if (section.kind === "continue-watching") pushCards(section.items);
      }
    }
    if (current.route.route === "search") pushCards(current.searchPage?.videos);
    if (current.route.route === "channel") {
      pushCards(current.channelView?.videos);
      pushCards(current.channelView?.shorts);
    }
    if (current.route.route === "trending") pushCards(current.trendingView?.videos);
    if (current.route.route === "shorts") pushCards(current.shortsView?.shorts);
    if (current.route.route === "subscriptions") pushCards(current.subscriptionsView?.videos);
    if (current.route.route === "history") {
      for (const group of current.historyView?.groups ?? []) {
        pushCards(group.items);
      }
    }
    const playing = current.watchState?.card ?? null;
    return {
      at: new Date().toISOString(),
      route: current.route.route,
      params: current.route.params,
      playingItem:
        playing === null
          ? null
          : {
              itemId: playing.item.id,
              title: playing.title,
              providerId: playing.item.providerId,
              mediaKind: playing.item.mediaKind,
            },
      watchPlanKind: current.watchState?.plan.kind ?? null,
      visibleItemIds: visibleItems,
      connections: [
        {
          providerId: "youtube",
          state:
            current.accountsStatus === null
              ? "unknown"
              : current.accountsStatus.vault.available && current.accountsStatus.accounts.length > 0
                ? "connected"
                : "not-configured",
        },
      ],
      agentPanel: { visible: current.agentPanelVisible, widthPx: current.agentPanelWidth },
      pendingChoice: null,
    };
  }, []);
}
