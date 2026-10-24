/**
 * WFX-DESKTOP-WEBFLIX-UX-1 — the WebFlix renderer boot, INTEGRATED (TL2 lane).
 *
 * The three WFX lanes composed into the real product host:
 *   - WFX-UX-SHELL-1 (Worker 1): the media-first AppShell (sidebar + top
 *     chrome + the frozen MediaRoute model + every media surface + the
 *     persistent watch dock + the agent-panel SLOT).
 *   - WFX-PROVIDER-SLICE-1 (Worker 2): the official Data-API-backed media
 *     producers over the live composition root whose key arrives through
 *     the main-process key IPC (freeze §9.5: no key ⇒ the honest
 *     requires-auth phase; the key never lives in renderer strings).
 *   - WFX-AGENT-BRIDGE-1 (Worker 3): the agent runtime admission (the SAME
 *     ServicePort handshake the ZCode boot uses), the toggleable AgentPanel
 *     with the REAL ZCode chat surface, and the frozen UI-action bridge the
 *     webflix_ui MCP tool rides.
 *
 * Support modules (extracted for the max-lines law): hostChrome.tsx (the
 * error boundary + chrome), WebFlixHostView.tsx (the view tree + shell
 * props), useAccountRetentionHandlers.ts, mediaHostSupport.ts (the session
 * history source, the budgetNote→phase mapping, the producers build),
 * useSurfaceLoader.ts (the route-driven loads), uiActionBridgeHandlers.ts
 * (the typed bridge handlers factory — the SAME use cases the UI buttons use).
 *
 * Truthfulness rules carried forward from P9-UI-1 (binding): local media
 * works with no network/credentials; search never invents results; accounts
 * come only from the real OS-vault bridge; NO provider account mutation
 * rides the bridge (freeze §9.1 consent law).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AgentActionTraceEntry,
  CatalogItem,
  ChannelView,
  HistoryView,
  HomeFeedView,
  MediaRoute,
  RouteParams,
  SearchPageData,
  ShortsView,
  SubscriptionsView,
  TrendingView,
} from "../../../../../webflix-contracts/src/index.js";
import type { VideoCardView } from "../../../../../webflix-contracts/src/media-views.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import type { LoadMoreSurface } from "../../../../../webflix-shell/src/routes.js";
import type { WatchSurfaceState } from "../../../../../webflix-shell/src/components/AppShell.js";
import { WEBFLIX_DOCUMENT_TITLE } from "./brand.js";
import { getWebFlixAccountsBridge, type WebFlixAccountsBridge } from "./accountsBridge.js";
import { getWebFlixAgentWorkspaceBridge } from "./agentWorkspaceBridge.js";
import { createLocalLibrarySession, type LocalLibrarySession } from "./localLibrarySession.js";
import { createRetentionSession, type RetentionSession } from "./retentionSession.js";
import { resolveSearchQuery } from "./searchFlow.js";
import { resolvePlayPlan, type WatchView } from "./watchPlan.js";
import { WebFlixErrorBoundary } from "./hostChrome.js";
import { WebFlixHostView } from "./WebFlixHostView.js";
import { useAccountRetentionHandlers } from "./useAccountRetentionHandlers.js";
import { createSessionHistorySource, searchPhaseFromPageData } from "./mediaHostSupport.js";
import { useSurfaceLoader } from "./useSurfaceLoader.js";
import { useProducersAndWorkspace } from "./useProducersAndWorkspace.js";
// WFX-NETFLIX-SOURCE-1: the second source's host support (the producer
// build + view state + route handler family, extracted for the max-lines law).
import { useNetflixHostSupport } from "./netflixHostSupport.js";
import { createUiActionHandlers } from "./uiActionBridgeHandlers.js";
import { useLiveMediaContext } from "./liveMediaContext.js";
// WFX lanes (relative source imports — the desktop package convention).
import { ensureAgentRuntimeAdmission } from "../agent/runtimeAdmission.js";
import type { UiActionBridge } from "../agent/uiActionBridge.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";

declare const __ZCODE_VERSION__: string | undefined;

// ---------------------------------------------------------------------------
// The agent runtime admission — installed at MODULE EVALUATION, before the
// main process's dom-ready ServicePort message can be missed (the exact
// zcodeBoot law; idempotent; zero @zcode/ui code until the panel opens).
// ---------------------------------------------------------------------------
ensureAgentRuntimeAdmission();

/** The injected host dependencies — the seams the battery fakes; production uses the real ones. */
export interface WebFlixHostDeps {
  /** The account bridge (real preload bridge, or a test double). */
  readonly accountsBridge: WebFlixAccountsBridge | null;
  /** Local-library session factory (default: createLocalLibrarySession). */
  readonly createLocalLibrary?: () => LocalLibrarySession;
  /** Retention session factory (default: createRetentionSession). */
  readonly createRetention?: () => RetentionSession;
  /** OS-path recovery for a picked file (default: the zcode preload's webUtils bridge, null off-desktop). */
  readonly resolveOsPath?: (file: File) => string | null;
  /** The product version line (default: the baked __ZCODE_VERSION__ define). */
  readonly appVersion?: string;
  /** The agent-workspace bridge (default: the real preload bridge; null = the honest unavailable state). */
  readonly agentWorkspaceBridge?: ReturnType<typeof getWebFlixAgentWorkspaceBridge>;
  /**
   * The media-producer factory (default: the real live composition — the
   * key IPC → createLiveYouTubeComposition → createYouTubeMediaProducers).
   * Tests inject a fixture-labelled double.
   */
  readonly createMediaProducers?: () => Promise<YouTubeMediaProducers | null>;
}

/**
 * The WebFlix product host: the media-first AppShell wired to the real
 * session modules, the real account bridge, the live media producers, and
 * the agent panel + typed UI-action bridge.
 */
export function WebFlixHost(deps: WebFlixHostDeps) {
  const {
    accountsBridge,
    createLocalLibrary,
    createRetention,
    resolveOsPath: resolveOsPathDep,
    appVersion,
    agentWorkspaceBridge = getWebFlixAgentWorkspaceBridge(),
    createMediaProducers,
  } = deps;
  const localLibrary = useMemo(
    () => createLocalLibrary?.() ?? createLocalLibrarySession(),
    [createLocalLibrary],
  );
  const retention = useMemo(
    () => createRetention?.() ?? createRetentionSession(),
    [createRetention],
  );
  const historySource = useMemo(() => createSessionHistorySource(), []);

  // Route state (the frozen MediaRoute model; the shell renders from this).
  const [route, setRouteState] = useState<{ route: MediaRoute; params: RouteParams }>({
    route: "home",
    params: {},
  });
  const setRoute = useCallback((nextRoute: MediaRoute, params: RouteParams = {}) => {
    setRouteState({ route: nextRoute, params });
  }, []);

  // Real session state — only what actually happened, never seeded.
  const [searchState, setSearchState] = useState<SearchState>({ phase: "idle" });
  const [localEntries, setLocalEntries] = useState<readonly CatalogItem[]>([]);
  const [recentItems, setRecentItems] = useState<readonly CatalogItem[]>([]);
  const lastQueryRef = useRef<string>("");
  const lastSearchedQueryRef = useRef<string | null>(null);

  // WFX media surfaces (the producers fill these; null = not loaded).
  const [homeFeed, setHomeFeed] = useState<HomeFeedView | null>(null);
  const [searchPage, setSearchPage] = useState<SearchPageData | null>(null);
  const [channelView, setChannelView] = useState<ChannelView | null>(null);
  const [trendingView, setTrendingView] = useState<TrendingView | null>(null);
  const [shortsView, setShortsView] = useState<ShortsView | null>(null);
  const [subscriptionsView, setSubscriptionsView] = useState<SubscriptionsView | null>(null);
  const [historyView, setHistoryView] = useState<HistoryView | null>(null);
  const [loadingMoreSurfaces, setLoadingMoreSurfacesState] = useState<readonly LoadMoreSurface[]>([]);
  const setLoadingMoreSurfaces = useCallback(
    (setter: (current: readonly LoadMoreSurface[]) => readonly LoadMoreSurface[]) => {
      setLoadingMoreSurfacesState(setter);
    },
    [],
  );

  // The persistent watch surface (freeze §9.6) + the WebFlix-local queue.
  const [watchState, setWatchState] = useState<WatchSurfaceState | null>(null);
  const [queue, setQueue] = useState<readonly VideoCardView[]>([]);

  // The agent panel (first-class shell state; the bridge rides the same handlers).
  const [agentPanelVisible, setAgentPanelVisible] = useState(false);
  const [agentPanelWidth, setAgentPanelWidth] = useState<number | null>(null);

  // The item registry: every VideoCardView the host has surfaced (the agent's
  // playCatalogItem resolves ids against THIS — a hallucinated id fails typed).
  const itemRegistryRef = useRef<Map<string, VideoCardView>>(new Map());
  const registerCards = useCallback(
    (cards: readonly VideoCardView[] | undefined | null) => {
      if (cards === undefined || cards === null) return;
      for (const card of cards) {
        itemRegistryRef.current.set(card.item.id, card);
      }
    },
    [],
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The account + retention handler family (the honest initial reads included).
  const accountHandlers = useAccountRetentionHandlers(accountsBridge, retention);

  // The producers + the agent-workspace bootstrap (the combined hook: the
  // live composition via the key IPC or the honest requires-auth handle; the
  // once-per-session MCP registration through the validated writer).
  const producersAndWorkspace = useProducersAndWorkspace({
    agentWorkspaceBridge,
    ...(createMediaProducers !== undefined ? { createMediaProducers } : {}),
    historySource,
  });

  // WFX-NETFLIX-SOURCE-1: the second source's host support (view state +
  // producer + handlers — the hook owns the family, extracted for the law).
  const netflixSupport = useNetflixHostSupport({ route, setRoute });


  // The search flow (the SAME path the UI and the agent use).
  const runSearch = useCallback(
    (query: string): { playedLink: boolean } => {
      lastQueryRef.current = query;
      lastSearchedQueryRef.current = query;
      const outcome = resolveSearchQuery(query);
      if (outcome.kind === "youtube-link") {
        setSearchState({ phase: "idle" });
        setSearchPage(null);
        localLibrary.markPlayed(outcome.catalogItem);
        setRecentItems([...localLibrary.recents()]);
        historySource.recordWatch(outcome.catalogItem, null, undefined);
        registerCards([
          { item: outcome.catalogItem, title: outcome.catalogItem.title },
        ]);
        setWatchState({
          title: outcome.catalogItem.title,
          plan: outcome.plan,
          card: { item: outcome.catalogItem, title: outcome.catalogItem.title },
          related: [],
        });
        setRoute("watch", { itemId: outcome.catalogItem.id });
        return { playedLink: true };
      }
      // Keyword path: the producers' honest phases are the truth.
      const producers = producersAndWorkspace.getProducers();
      if (producers === null) {
        setSearchState(outcome.state);
        setSearchPage(null);
        return { playedLink: false };
      }
      setSearchState({ phase: "loading", query });
      void producers.searchPage
        .searchPage(query)
        .then((data) => {
          registerCards(data.videos);
          setSearchPage(data);
          setSearchState(searchPhaseFromPageData(query, data));
        })
        .catch(() => {
          setSearchState({ phase: "unavailable", query });
          setSearchPage(null);
        });
      return { playedLink: false };
    },
    [localLibrary, registerCards, historySource, setRoute],
  );

  // The shared play path (cards, links, queue entries AND the agent bridge).
  const playCard = useCallback(
    (card: VideoCardView) => {
      registerCards([card]);
      historySource.recordWatch(card.item, card, undefined);
      localLibrary.markPlayed(card.item);
      setRecentItems([...localLibrary.recents()]);
      const view: WatchView = resolvePlayPlan(card.item, localLibrary);
      setWatchState({ title: card.title, plan: view.plan, card, related: [] });
      setQueue((current) =>
        current.some((entry) => entry.item.id === card.item.id) ? current : [...current, card],
      );
      setRoute("watch", { itemId: card.item.id });
    },
    [localLibrary, registerCards, historySource, setRoute],
  );

  useSurfaceLoader({
    getProducers: producersAndWorkspace.getProducers,
    producersReady: producersAndWorkspace.producersReady,
    route,
    registerCards,
    runSearch,
    isSearchPending: (query) => lastSearchedQueryRef.current !== query,
    setHomeFeed,
    setTrendingView,
    setShortsView,
    setSubscriptionsView,
    setHistoryView,
    setChannelView,
    homeFeed,
    trendingView,
    shortsView,
    subscriptionsView,
    historyView,
    channelView,
    getNetflixProducer: netflixSupport.getNetflixProducer,
    netflixHome: netflixSupport.netflixHome,
    netflixTitleView: netflixSupport.netflixTitleView,
    setNetflixHome: netflixSupport.setNetflixHome,
    setNetflixTitleView: netflixSupport.setNetflixTitleView,
  } as Parameters<typeof useSurfaceLoader>[0]);

  const handleImportLocalFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesPicked = (files: readonly File[]) => {
    if (files.length === 0) return;
    const resolveOsPath =
      resolveOsPathDep ??
      ((file: File) => {
        const bridge = (
          globalThis as { window?: { zcode?: { getPathForFile?: (file: File) => string | null } } }
        ).window?.zcode;
        return bridge?.getPathForFile?.(file) ?? null;
      });
    localLibrary.importFiles(files.map((file) => ({ file, osPath: resolveOsPath(file) })));
    setLocalEntries([...localLibrary.entryCatalogItems()]);
  };

  const handlePlay = (item: CatalogItem) => {
    const view = resolvePlayPlan(item, localLibrary);
    if (view.plan.kind !== "unavailable") {
      localLibrary.markPlayed(item);
      setRecentItems([...localLibrary.recents()]);
    }
    historySource.recordWatch(item, null, undefined);
    setWatchState({ title: item.title, plan: view.plan, card: null, related: [] });
    setRoute("watch", { itemId: item.id });
  };

  const handleSearchSubmit = (query: string) => {
    setRoute("search", { query });
    runSearch(query);
  };


  // The LIVE-STATE mirror + the visible-media context builder (freeze §9.1:
  // the bridge is created ONCE per handlers record — every context read goes
  // through liveMediaContext's post-commit snapshot, never a stale closure).
  const getVisibleMediaContext = useLiveMediaContext({
    route,
    homeFeed,
    searchPage,
    channelView,
    trendingView,
    shortsView,
    subscriptionsView,
    historyView,
    watchState,
    accountsStatus: accountHandlers.accountsStatus,
    agentPanelVisible,
    agentPanelWidth,
  });


  const agentPanelVisibleRef = useRef(agentPanelVisible);
  useEffect(() => {
    agentPanelVisibleRef.current = agentPanelVisible;
  });

  const uiActionHandlers = useMemo(
    () =>
      createUiActionHandlers({
        getProducers: producersAndWorkspace.getProducers,
        getRegisteredCard: (itemId) => itemRegistryRef.current.get(itemId),
        playCard,
        registerCards,
        getAgentPanelVisible: () => agentPanelVisibleRef.current,
        setAgentPanelVisible,
        setSearchPage,
        setSearchState,
        setRoute,
        handleConnect: accountHandlers.handleConnect,
        localLibrary,
        getVisibleMediaContext,
      }),
    [playCard, registerCards, setRoute, accountHandlers.handleConnect, localLibrary, getVisibleMediaContext],
  );

  const handleBridgeReady = useCallback((bridge: UiActionBridge) => {
    // The e2e/acceptance evidence hook (read-only data exposure; the journey
    // script reads the typed trace + context through it).
    const target = globalThis as {
      __webflixWfxE2e?: { bridge?: UiActionBridge; trace?: () => readonly AgentActionTraceEntry[] };
    };
    target.__webflixWfxE2e = {
      bridge,
      trace: () => bridge.trace.export(),
    };
  }, []);

  const version =
    appVersion ?? (typeof __ZCODE_VERSION__ !== "undefined" ? __ZCODE_VERSION__ : "dev");

  const watchQueueEntries = useMemo(
    () =>
      queue.map((entry) => ({
        card: entry,
        nowPlaying: watchState?.card?.item.id === entry.item.id,
      })),
    [queue, watchState],
  );
  const watchSurface: WatchSurfaceState | null =
    watchState === null ? null : { ...watchState, queue: watchQueueEntries };

  return (
    <WebFlixHostView
      route={route}
      setRoute={setRoute}
      accounts={accountHandlers.accountsStatus?.accounts ?? []}
      recentItems={recentItems}
      localEntries={localEntries}
      searchState={searchState}
      searchPage={searchPage}
      homeFeed={homeFeed}
      channelView={channelView}
      trendingView={trendingView}
      shortsView={shortsView}
      subscriptionsView={subscriptionsView}
      historyView={historyView}
      netflixHome={netflixSupport.netflixHome}
      netflixTitleView={netflixSupport.netflixTitleView}
      onSelectNetflixCountry={netflixSupport.handleNetflixCountrySelect}
      onNetflixRetry={netflixSupport.handleNetflixRetry}
      onOpenExternalUrl={netflixSupport.handleOpenExternalUrl}
      loadingMoreSurfaces={loadingMoreSurfaces}
      watchSurface={watchSurface}
      setWatchState={setWatchState}
      agentPanelVisible={agentPanelVisible}
      setAgentPanelVisible={setAgentPanelVisible}
      setAgentPanelWidth={setAgentPanelWidth}
      agentWorkspacePath={producersAndWorkspace.agentWorkspacePath}
      uiActionHandlers={uiActionHandlers}
      handleBridgeReady={handleBridgeReady}
      retentionState={accountHandlers.retentionState}
      retentionResetResult={accountHandlers.resetResult}
      connectOutcome={
        accountHandlers.connectAttempt === null
          ? null
          : {
              providerId: accountHandlers.connectAttempt.providerId,
              ok: accountHandlers.connectAttempt.outcome.ok,
              reason: accountHandlers.connectAttempt.outcome.reason,
            }
      }
      handlePlay={handlePlay}
      playCard={playCard}
      handleSearchSubmit={handleSearchSubmit}
      handleConnect={accountHandlers.handleConnect}
      handleDisconnect={accountHandlers.handleDisconnect}
      handleImportLocalFiles={handleImportLocalFiles}
      handlePauseHistory={() => {
        void accountHandlers.handlePauseHistory();
      }}
      handleResumeHistory={() => {
        void accountHandlers.handleResumeHistory();
      }}
      handleResetLocalData={(scope) => {
        void accountHandlers.handleResetLocalData(scope);
      }}
      retrySearch={() => {
        if (lastQueryRef.current !== "") {
          handleSearchSubmit(lastQueryRef.current);
        }
      }}
      setChannelView={setChannelView}
      setHomeFeed={setHomeFeed}
      setTrendingView={setTrendingView}
      registerCards={registerCards}
      getProducers={producersAndWorkspace.getProducers}
      setLoadingMoreSurfaces={setLoadingMoreSurfaces}
      accountsStatus={accountHandlers.accountsStatus}
      version={version}
      fileInputRef={fileInputRef}
      onFilesPicked={handleFilesPicked}
    />
  );
}

/**
 * The WebFlix renderer entry — boots the host on the #root element.
 * Called only from main.tsx's webflix route (baked flavor "webflix").
 */
export function bootWebFlixRenderer(): void {
  document.title = WEBFLIX_DOCUMENT_TITLE;
  const container = document.getElementById("root");
  if (container === null) {
    return;
  }
  createRoot(container).render(
    <WebFlixErrorBoundary>
      <WebFlixHost accountsBridge={getWebFlixAccountsBridge()} />
    </WebFlixErrorBoundary>,
  );
}

bootWebFlixRenderer();
