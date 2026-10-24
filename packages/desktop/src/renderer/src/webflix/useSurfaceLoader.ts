/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the route-driven media
 * surface loader: one effect that fills the per-route view state from the
 * producers (honest per-surface phases; null = not loaded). Extracted from
 * boot.tsx for the max-lines law.
 */
import { useEffect, useRef } from "react";
import type {
  ChannelView,
  HistoryView,
  HomeFeedView,
  MediaRoute,
  NetflixHomeView,
  NetflixTitleView,
  RouteParams,
  ShortsView,
  SubscriptionsView,
  TrendingView,
  VideoCardView,
} from "../../../../../webflix-contracts/src/media-views.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { NetflixPort } from "../../../../../webflix-contracts/src/media-views.js";

export interface SurfaceLoaderDeps {
  readonly getProducers: () => YouTubeMediaProducers | null;
  readonly producersReady: boolean;
  readonly route: { route: MediaRoute; params: RouteParams };
  readonly registerCards: (cards: readonly VideoCardView[] | undefined | null) => void;
  readonly runSearch: (query: string) => void;
  readonly isSearchPending: (query: string) => boolean;
  readonly setHomeFeed: (view: HomeFeedView | null) => void;
  readonly setTrendingView: (view: TrendingView | null) => void;
  readonly setShortsView: (view: ShortsView | null) => void;
  readonly setSubscriptionsView: (view: SubscriptionsView | null) => void;
  readonly setHistoryView: (view: HistoryView | null) => void;
  readonly setChannelView: (view: ChannelView | null) => void;
  // ---- WFX-NETFLIX-SOURCE-1 (the second source's loader deps). ----
  readonly getNetflixProducer: () => NetflixPort | null;
  readonly netflixHome: NetflixHomeView | null;
  readonly netflixTitleView: NetflixTitleView | null;
  readonly setNetflixHome: (view: NetflixHomeView | null) => void;
  readonly setNetflixTitleView: (view: NetflixTitleView | null) => void;
}

/** Loads each route's surface once (null state + ready producers). */
export function useSurfaceLoader(deps: SurfaceLoaderDeps): void {
  // WFX-NETFLIX-SOURCE-1: the title id the CURRENT netflixTitleView answered
  // (error views carry title:null, so the requested id is tracked here).
  const netflixTitleIdRef = useRef<number | null>(null);
  const {
    getProducers,
    producersReady,
    route,
    registerCards,
    runSearch,
    isSearchPending,
    setHomeFeed,
    setTrendingView,
    setShortsView,
    setSubscriptionsView,
    setHistoryView,
    setChannelView,
  } = deps;
  // The per-surface "already loaded?" checks read the CURRENT view state;
  // the host passes the null checks through these closures (the effect
  // re-runs on route changes; each surface loads once until retried).
  useEffect(() => {
    const producers = getProducers();
    if (!producersReady || producers === null) return;
    const { route: currentRoute, params } = route;
    let active = true;
    if (currentRoute === "home" && deps.homeFeed === null) {
      void producers.homeFeed
        .getHomeFeed({})
        .then((view) => {
          if (!active) return;
          if (view.phase === "ready") {
            for (const section of view.sections) {
              if (section.kind === "video-grid") registerCards(section.videos);
              if (section.kind === "shorts-shelf") registerCards(section.shorts);
              if (section.kind === "continue-watching") registerCards(section.items);
            }
          }
          setHomeFeed(view);
        })
        .catch(() => {
          if (active) setHomeFeed({ phase: "unavailable", detail: "The home feed could not load." });
        });
    }
    if (currentRoute === "trending" && deps.trendingView === null) {
      void producers.trending
        .trending({})
        .then((view) => {
          if (!active) return;
          registerCards(view.videos);
          setTrendingView(view);
        })
        .catch(() => {
          if (active)
            setTrendingView({
              region: null,
              chips: [],
              videos: [],
              nextCursor: null,
              phase: "unavailable",
              detail: "Trending could not load.",
            });
        });
    }
    if (currentRoute === "shorts" && deps.shortsView === null) {
      void producers.shorts
        .shorts()
        .then((view) => {
          if (!active) return;
          registerCards(view.shorts);
          setShortsView(view);
        })
        .catch(() => {
          if (active)
            setShortsView({ shorts: [], nextCursor: null, phase: "unavailable", detail: "Shorts could not load." });
        });
    }
    if (currentRoute === "subscriptions" && deps.subscriptionsView === null) {
      void producers.subscriptions
        .subscriptions()
        .then((view) => {
          if (!active) return;
          registerCards(view.videos);
          setSubscriptionsView(view);
        })
        .catch(() => {
          if (active)
            setSubscriptionsView({
              channels: [],
              videos: [],
              phase: "unavailable",
              detail: "Subscriptions could not load.",
            });
        });
    }
    if (currentRoute === "history" && deps.historyView === null) {
      void producers.history
        .history()
        .then((view) => {
          if (!active) return;
          setHistoryView(view);
        })
        .catch(() => {
          if (active) setHistoryView({ groups: [], phase: "unavailable", detail: "History could not load." });
        });
    }
    if (currentRoute === "channel" && deps.channelView === null) {
      if (params.channelId !== undefined || params.handle !== undefined) {
        void producers.channel
          .channel({
            ...(params.channelId !== undefined ? { channelId: params.channelId } : {}),
            ...(params.handle !== undefined ? { handle: params.handle } : {}),
            ...(params.channelTab !== undefined ? { tab: params.channelTab } : {}),
          })
          .then((view) => {
            if (!active) return;
            registerCards(view.videos);
            registerCards(view.shorts);
            setChannelView(view);
          })
          .catch(() => {
            if (active)
              setChannelView({
                channel: {
                  channelId: params.channelId ?? params.handle ?? "unknown",
                  title: "Channel unavailable",
                },
                availableTabs: ["videos"],
                videos: [],
                shorts: [],
                nextCursor: null,
                phase: "unavailable",
                detail: "The channel could not load.",
              });
          });
      }
    }
    if (currentRoute === "search" && params.query !== undefined && isSearchPending(params.query)) {
      runSearch(params.query);
    }
    // WFX-NETFLIX-SOURCE-1: the second source's loads (the hub when no
    // itemId rides the route; the title detail when one does). Both are
    // self-correcting on the route params: a different country view or a
    // different title id reloads even when a previous view is still mounted
    // (deep title→title navigation rides the shell's own navigate).
    if (currentRoute === "netflix" && params.itemId === undefined) {
      const netflixProducer = deps.getNetflixProducer();
      const country =
        typeof params.region === "string" && params.region !== "" ? params.region : "Global";
      const stale = deps.netflixHome !== null && deps.netflixHome.country !== country;
      if (netflixProducer !== null && (deps.netflixHome === null || stale)) {
        void netflixProducer
          .netflixHome({ country })
          .then((view) => {
            if (active) deps.setNetflixHome(view);
          })
          .catch(() => {
            if (active)
              deps.setNetflixHome({
                country,
                rails: [],
                hero: null,
                catalogSize: 0,
                sourceNote: "",
                phase: "unavailable",
                detail: "The Netflix hub could not load.",
              });
          });
      }
    }
    if (currentRoute === "netflix" && params.itemId !== undefined) {
      const netflixProducer = deps.getNetflixProducer();
      const netflixId = Number(params.itemId);
      if (netflixProducer !== null) {
        if (Number.isInteger(netflixId) && netflixId > 0) {
          const alreadyLoaded =
            deps.netflixTitleView !== null && netflixTitleIdRef.current === netflixId;
          if (!alreadyLoaded) {
            netflixTitleIdRef.current = netflixId;
            void netflixProducer
              .netflixTitle({ netflixId })
              .then((view) => {
                if (active) deps.setNetflixTitleView(view);
              })
              .catch(() => {
                if (active)
                  deps.setNetflixTitleView({
                    title: null,
                    countryRanks: [],
                    relatedTitles: [],
                    phase: "unavailable",
                    detail: "The Netflix title page could not load.",
                  });
              });
          }
        } else {
          deps.setNetflixTitleView({
            title: null,
            countryRanks: [],
            relatedTitles: [],
            phase: "unsupported",
            detail: "The Netflix title id in the route is not a valid number.",
          });
        }
      }
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    route,
    producersReady,
    deps.homeFeed,
    deps.trendingView,
    deps.shortsView,
    deps.subscriptionsView,
    deps.historyView,
    deps.channelView,
    deps.netflixHome,
    deps.netflixTitleView,
  ]);
}
