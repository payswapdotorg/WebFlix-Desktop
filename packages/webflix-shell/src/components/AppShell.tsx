import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { theme } from "../theme";
import type {
  CatalogItem,
  ChannelView,
  Collection,
  EvaluationResult,
  HistoryView,
  HomeFeedView,
  MediaRoute,
  NetflixHomeView,
  NetflixTitleCard,
  NetflixTitleView,
  ProviderAccountRecord,
  RouteParams,
  SearchPageData,
  ShortsView,
  SubscriptionsView,
  TrendingView,
  VideoCardView,
} from "webflix-contracts";
import type {
  AdsQualificationItemOutcome,
  RankerAdapterDescriptor,
  RetentionScope,
  RetentionState,
  ResetLocalDataResult,
} from "webflix-application";
import type { SearchState } from "../states";
import type { PlayerControlsView } from "../states";
import { NAV_ITEMS, isNarrowViewport, paramsEqual } from "../routes";
import type { LoadMoreSurface, NavRoute, RetrySurface } from "../routes";
import { WatchScreen, DEFAULT_WATCH_ACTIONS } from "./WatchScreen";
import type { WatchActionView, WatchQueueEntryView } from "./WatchScreen";
import {
  AgentPanelSlot,
  useAgentPanelState,
} from "./AgentPanel";
import type { AgentPanelApi, AgentPanelViewState, PanelPersistence } from "./AgentPanel";
import { ScreenRouter } from "./shell/ScreenRouter";
import { Sidebar } from "./shell/Sidebar";
import { TopChrome } from "./shell/TopChrome";
import { FOCUS_STYLES, shellStyles } from "./shell/shell-styles";

/**
 * The shell's screen vocabulary (WFX-UX-SHELL-1): the frozen MediaRoute set
 * minus the two CONTENT routes (watch/channel — reached through card
 * actions, deep links and the agent bridge, never the sidebar). Additive
 * over the legacy ScreenId union: every legacy id is still valid.
 */
export type ScreenId = NavRoute;

// Re-exported for the barrel (the composition tests pin NAV_ITEMS' labels).
export { NAV_ITEMS };

/**
 * The watch surface state the host passes to keep the persistent player
 * mounted (freeze §9.6 — the player may persist across route transitions
 * within the visible window; the queue is WebFlix-local data).
 */
export interface WatchSurfaceState {
  readonly title: string;
  readonly plan: import("webflix-contracts").PlaybackPlan;
  readonly controls?: PlayerControlsView | null;
  /** The item's card view (metadata band facts). */
  readonly card?: VideoCardView | null;
  readonly related?: readonly VideoCardView[];
  readonly queue?: readonly WatchQueueEntryView[];
  /** The action row; defaults to the honest-unavailable trio. */
  readonly actions?: readonly WatchActionView[];
  /** Host-side theater preference (the shell tracks its own toggle too). */
  readonly theater?: boolean;
}

export interface AppShellProps {
  readonly initialScreen?: ScreenId;
  /** WFX: mount-time route (wins over initialScreen) + route params. */
  readonly initialRoute?: MediaRoute;
  readonly initialRouteParams?: RouteParams;
  /**
   * Controlled route (the agent bridge's openRoute path): when provided it
   * wins over the internal route state; user navigation still reports
   * through onNavigate so a controlled host can echo it back.
   */
  readonly route?: { readonly route: MediaRoute; readonly params: RouteParams } | null;
  /** Reports every route change (nav, global search, tabs). */
  readonly onNavigate?: (route: MediaRoute, params?: RouteParams) => void;
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly recentItems?: readonly CatalogItem[];
  readonly collections?: readonly Collection[];
  readonly localEntries?: readonly CatalogItem[];
  readonly searchState?: SearchState;
  readonly onPlay?: (item: CatalogItem) => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onDisconnect?: (accountId: string) => void;
  readonly onSearchQuery?: (query: string) => void;
  readonly onSearchSubmit?: (query: string) => void;
  readonly onRetrySearch?: () => void;
  /**
   * P9-UI-1 (order requirement 3 — the real local import path): passed
   * through to LibraryScreen; the host owns the actual file picker.
   * Absent = no import affordance rendered (never a dead control).
   */
  readonly onImportLocalFiles?: () => void;
  // DESKTOP-COMPOSITION-1 (the composition row the P4/P5 ledger rows
  // promised): the Ad Center + MI Evaluation surfaces mount props-driven,
  // flat-optional like every other screen prop. Defaults are the honest
  // never-run states — null / [] — NO faked data, NO invented defaults that
  // look like real results; the Phase-6 host app passes real data.
  /** Ad Center qualification read-outs; null = no qualification run yet. */
  readonly adCenterResults?: readonly AdsQualificationItemOutcome[] | null;
  /** The MI evaluation read-out; null = no evaluation run yet. */
  readonly evaluationResult?: EvaluationResult | null;
  /** The ranker adapter registry to offer; [] = none available (honest). */
  readonly rankerAdapterEntries?: readonly RankerAdapterDescriptor[];
  /** The stored adapter selection; null = never set (the default stays unselected). */
  readonly rankerSelectedAdapterId?: string | null;
  /** Fires with the adapter id when the user selects one (host wiring is Phase 6). */
  readonly onRankerAdapterSelectionChange?: (adapterId: string) => void;
  /** Optional honest status line; null = nothing rendered (nothing invented). */
  readonly rankerStatusNote?: string | null;
  // P7-COMPOSE-1 (WF-021 surface): the retention/settings surface mounts
  // props-driven, flat-optional like every other screen prop. Defaults are
  // the honest never-loaded states — null / null — NO faked data; the host
  // app passes the GetRetentionState output and wires the use cases.
  /** The retention state view model; null = not loaded yet (honest default). */
  readonly retentionState?: RetentionState | null;
  /** The last scoped reset's result, rendered verbatim; null = no reset yet. */
  readonly retentionResetResult?: ResetLocalDataResult | null;
  /** Fires on the explicit pause action (PauseHistoryTracking use case). */
  readonly onPauseHistoryTracking?: () => void;
  /** Fires on the explicit resume action (ResumeHistoryTracking use case). */
  readonly onResumeHistoryTracking?: () => void;
  /** Fires with the CONFIRMED scope (ResetLocalData use case). */
  readonly onResetLocalData?: (scope: RetentionScope) => void;
  /**
   * P9-UI-1 (order requirement 5 — the truthful connect outcome): the typed
   * outcome of the last REAL connect attempt, passed through to
   * AccountsScreen's honest status line. null = no attempt yet.
   */
  readonly connectOutcome?: { providerId: string; ok: boolean; reason: string } | null;

  // ---- WFX-UX-SHELL-1 (freeze §9 media-view seam): the HOST produces,
  // the shell renders. Every surface is flat-optional with an honest
  // not-provided state — never fabricated rows. ----
  /** The frozen home feed view (the media-first Home). */
  readonly homeFeed?: HomeFeedView | null;
  /** The frozen search page data (card results + channels + cursor). */
  readonly searchPage?: SearchPageData | null;
  readonly channelView?: ChannelView | null;
  readonly trendingView?: TrendingView | null;
  readonly shortsView?: ShortsView | null;
  readonly subscriptionsView?: SubscriptionsView | null;
  readonly historyView?: HistoryView | null;
  // ---- WFX-NETFLIX-SOURCE-1 (the second source's surfaces). ----
  /** The Netflix hub view (rails + hero; the honest not-provided default is null). */
  readonly netflixHome?: NetflixHomeView | null;
  /** The Netflix title-detail view (null = not loaded). */
  readonly netflixTitleView?: NetflixTitleView | null;
  /** Surfaces currently appending a page (the honest in-flight fact). */
  readonly loadingMoreSurfaces?: readonly LoadMoreSurface[];
  /** Shared card play path — the same planning the buttons use. */
  readonly onPlayCard?: (card: VideoCardView) => void;
  /** Cursor paging reports (one flat callback for every growing surface). */
  readonly onLoadMorePage?: (surface: LoadMoreSurface, cursor: string) => void;
  /** Honest retry reports from the phase panels. */
  readonly onRetrySurface?: (surface: RetrySurface) => void;
  /** Chip filter reports (home feed + trending chart). */
  readonly onSelectChip?: (surface: "home" | "trending", chip: string | null) => void;
  /** Channel tab selection (the route's channelTab param). */
  readonly onSelectChannelTab?: (tab: string) => void;
  /** Channel navigation from cards/headers. */
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  // ---- WFX-NETFLIX-SOURCE-1 (the second source's reports). ----
  /** The hub's country-view chips report here ("Global" | "US"). */
  readonly onSelectNetflixCountry?: (country: string) => void;
  /** The play hand-off's external open (the host owns the system-browser call). */
  readonly onOpenExternalUrl?: (url: string) => void;
  /** WFX-NETFLIX-P45-LOOK-1: the session-scoped My List. */
  readonly netflixMyList?: readonly NetflixTitleCard[];
  /** WFX-NETFLIX-P45-LOOK-1: the My List toggle (billboard + cards + title). */
  readonly onToggleNetflixMyList?: (title: NetflixTitleCard) => void;

  // ---- WFX watch surface (freeze §9.6 persistent player). ----
  readonly watchState?: WatchSurfaceState | null;
  readonly onWatchClose?: () => void;
  readonly onWatchToggleTheater?: () => void;
  readonly onWatchAction?: (id: string) => void;

  // ---- WFX agent panel slot (deliverable 7; content is Worker 3's). ----
  /** Lazy panel content: a node, or a render-prop receiving the close api. */
  readonly agentPanelContent?: React.ReactNode | ((api: AgentPanelApi) => React.ReactNode);
  /** WFX-WEB-LOOK-1: the host-supplied brand mark node (topbar left). */
  readonly brandMark?: React.ReactNode;
  /** Host-injected persistence; default: in-memory (session-only). */
  readonly agentPanelPersistence?: PanelPersistence;
  /** Mount-time panel state (used before/without persistence). */
  readonly agentPanelInitial?: AgentPanelViewState;
  /** External visibility control (the agent bridge's toggleAgentPanel). */
  readonly agentPanelVisible?: boolean;
  /** Reports every committed panel state change (toggle/close/resize). */
  readonly onAgentPanelStateChange?: (state: AgentPanelViewState) => void;
}

export function AppShell(props: AppShellProps) {
  const {
    initialScreen = "home",
    initialRoute,
    initialRouteParams,
    route: routeProp,
    onNavigate,
    accounts = [],
    recentItems = [],
    collections = [],
    localEntries = [],
    searchState = { phase: "idle" },
    // Honest never-run defaults (DESKTOP-COMPOSITION-1): null results, an
    // empty registry, no stored selection, no status line — the panels'
    // own factual empty states render until a host app passes real data.
    adCenterResults = null,
    evaluationResult = null,
    rankerAdapterEntries = [],
    rankerSelectedAdapterId = null,
    onRankerAdapterSelectionChange,
    rankerStatusNote = null,
    // Honest never-loaded retention defaults (P7-COMPOSE-1): null state,
    // null reset result — the settings surface's own factual empty states
    // render until a host app passes real data.
    retentionState = null,
    retentionResetResult = null,
    onPauseHistoryTracking,
    onResumeHistoryTracking,
    onResetLocalData,
    onPlay,
    onConnect,
    onDisconnect,
    onSearchQuery,
    onSearchSubmit,
    onRetrySearch,
    onImportLocalFiles,
    connectOutcome = null,
    // WFX media-view seam (honest not-provided defaults: null everywhere).
    homeFeed = null,
    searchPage = null,
    channelView = null,
    trendingView = null,
    shortsView = null,
    subscriptionsView = null,
    historyView = null,
    netflixHome = null,
    netflixTitleView = null,
    loadingMoreSurfaces = [],
    onPlayCard,
    onLoadMorePage,
    onRetrySurface,
    onSelectChip,
    onSelectChannelTab,
    onOpenChannel,
    onSelectNetflixCountry,
    netflixMyList = [],
    onToggleNetflixMyList,
    onOpenExternalUrl,
    watchState = null,
    onWatchClose,
    onWatchToggleTheater,
    onWatchAction,
    agentPanelContent,
    brandMark,
    agentPanelPersistence,
    agentPanelInitial,
    agentPanelVisible,
    onAgentPanelStateChange,
  } = props;

  // ---- route model (the frozen MediaRoute set + params) ----
  const [internalRoute, setInternalRoute] = useState<{
    route: MediaRoute;
    params: RouteParams;
  }>(() => ({
    route: initialRoute ?? initialScreen,
    params: initialRouteParams ?? {},
  }));
  const activeRoute = routeProp ?? internalRoute;
  const { route, params } = activeRoute;

  const navigate = useCallback(
    (nextRoute: MediaRoute, nextParams: RouteParams = {}) => {
      setInternalRoute({ route: nextRoute, params: nextParams });
      onNavigate?.(nextRoute, nextParams);
    },
    [onNavigate],
  );

  // Controlled-route sync (the agent bridge's openRoute path): the prop
  // wins whenever it changes; equal-by-value routes are a no-op so a host
  // echoing our own onNavigate reports cannot loop.
  useEffect(() => {
    if (routeProp === undefined || routeProp === null) return;
    setInternalRoute((current) =>
      current.route === routeProp.route && paramsEqual(current.params, routeProp.params)
        ? current
        : { route: routeProp.route, params: routeProp.params },
    );
  }, [routeProp]);

  // ---- responsive sidebar (auto-collapse on narrow viewports) ----
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const [autoNarrow, setAutoNarrow] = useState<boolean>(() => isNarrowViewport());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    try {
      const mql = window.matchMedia(`(max-width: ${theme.layout.narrowViewportPx}px)`);
      const onChange = () => setAutoNarrow(mql.matches);
      onChange();
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
      }
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    } catch {
      // matchMedia present but refused: keep the probe's honest answer.
      return;
    }
  }, []);
  const sidebarCollapsed = userCollapsed ?? autoNarrow;

  // ---- agent panel (the SLOT; content is Worker 3's lane) ----
  const panel = useAgentPanelState({
    persistence: agentPanelPersistence,
    initial: agentPanelInitial,
    onStateChange: onAgentPanelStateChange,
  });
  const { toggle: togglePanel, setVisible: setPanelVisible } = panel;
  const panelStateRef = useRef(panel.state);
  panelStateRef.current = panel.state;
  const prevPanelVisibleRef = useRef(agentPanelVisible);
  useEffect(() => {
    if (
      agentPanelVisible !== undefined &&
      agentPanelVisible !== prevPanelVisibleRef.current &&
      agentPanelVisible !== panelStateRef.current.visible
    ) {
      setPanelVisible(agentPanelVisible);
    }
    prevPanelVisibleRef.current = agentPanelVisible;
  }, [agentPanelVisible, setPanelVisible]);

  // The documented keyboard shortcut: Ctrl+J / Cmd+J (SHORTCUTS block in
  // AgentPanel.tsx). Window-scoped; cleaned up with the shell.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePanel]);

  // ---- global search (top chrome) ----
  const [globalQuery, setGlobalQuery] = useState(params.query ?? "");
  useEffect(() => {
    if (params.query !== undefined) setGlobalQuery(params.query);
  }, [params.query]);
  const handleGlobalSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = globalQuery.trim();
    if (trimmed.length === 0) {
      navigate("search");
      return;
    }
    navigate("search", { query: trimmed });
    onSearchSubmit?.(trimmed);
  };

  // ---- theater state (the shell tracks the toggle; the host is informed) ----
  const [theater, setTheater] = useState(watchState?.theater ?? false);
  const handleToggleTheater = useCallback(() => {
    setTheater((current) => !current);
    onWatchToggleTheater?.();
  }, [onWatchToggleTheater]);

  // ---- watch route facts ----
  const watchMounted = watchState !== null && watchState !== undefined;
  const onWatchRoute = route === "watch";

  const connectedCount = useMemo(
    () => accounts.filter((account) => account.status === "connected").length,
    [accounts],
  );

  const handlePlayCard = useCallback(
    (card: VideoCardView) => {
      onPlayCard?.(card);
    },
    [onPlayCard],
  );

  const handleOpenChannel = useCallback(
    (channel: { channelId?: string; handle?: string }) => {
      onOpenChannel?.(channel);
    },
    [onOpenChannel],
  );

  return (
    <div className="wfx-shell" style={shellStyles.root} data-testid="app-shell-root">
      <style data-testid="wfx-shell-styles">{FOCUS_STYLES}</style>
      <a
        href={onWatchRoute && watchMounted ? "#watch-dock" : "#shell-main"}
        data-testid="skip-to-content"
        style={shellStyles.skipLink}
      >
        Skip to content
      </a>

      <TopChrome
        globalQuery={globalQuery}
        onGlobalQueryChange={setGlobalQuery}
        onGlobalSearchSubmit={handleGlobalSearchSubmit}
        connectedCount={connectedCount}
        onOpenAccounts={() => navigate("accounts")}
        panelVisible={panel.state.visible}
        onTogglePanel={() => togglePanel()}
        brandMark={brandMark}
      />

      <div style={shellStyles.body} data-testid="shell-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setUserCollapsed(!sidebarCollapsed)}
          activeRoute={route}
          onNavigate={(navRoute) => navigate(navRoute)}
        />

        <main
          id="shell-main"
          data-testid="shell-main"
          className="wfx-scroll"
          style={onWatchRoute && watchMounted ? shellStyles.mainHidden : shellStyles.main}
        >
          <ScreenRouter
            route={route}
            params={params}
            navigate={navigate}
            accounts={accounts}
            recentItems={recentItems}
            collections={collections}
            localEntries={localEntries}
            searchState={searchState}
            onPlay={onPlay}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onSearchQuery={onSearchQuery}
            onSearchSubmit={onSearchSubmit}
            onRetrySearch={onRetrySearch}
            onImportLocalFiles={onImportLocalFiles}
            adCenterResults={adCenterResults}
            evaluationResult={evaluationResult}
            rankerAdapterEntries={rankerAdapterEntries}
            rankerSelectedAdapterId={rankerSelectedAdapterId}
            onRankerAdapterSelectionChange={onRankerAdapterSelectionChange}
            rankerStatusNote={rankerStatusNote}
            retentionState={retentionState}
            retentionResetResult={retentionResetResult}
            onPauseHistoryTracking={onPauseHistoryTracking}
            onResumeHistoryTracking={onResumeHistoryTracking}
            onResetLocalData={onResetLocalData}
            connectOutcome={connectOutcome}
            homeFeed={homeFeed}
            searchPage={searchPage}
            channelView={channelView}
            trendingView={trendingView}
            shortsView={shortsView}
            subscriptionsView={subscriptionsView}
            historyView={historyView}
            netflixHome={netflixHome}
            netflixTitleView={netflixTitleView}
            watchMounted={watchMounted}
            loadingMoreSurfaces={loadingMoreSurfaces}
            onPlayCard={onPlayCard === undefined ? undefined : handlePlayCard}
            onLoadMorePage={onLoadMorePage}
            onRetrySurface={onRetrySurface}
            onSelectChip={onSelectChip}
            onSelectChannelTab={onSelectChannelTab}
            onOpenChannel={onOpenChannel}
            onSelectNetflixCountry={onSelectNetflixCountry}
            onOpenExternalUrl={onOpenExternalUrl}
            netflixMyList={netflixMyList}
            onToggleNetflixMyList={onToggleNetflixMyList}
          />
        </main>

        {watchMounted && (
          <aside
            id="watch-dock"
            data-testid="watch-dock"
            aria-label="Now playing"
            style={onWatchRoute ? shellStyles.watchAreaMain : shellStyles.watchAreaDocked}
          >
            <WatchScreen
              title={watchState.title}
              plan={watchState.plan}
              controls={watchState.controls ?? null}
              compact={!onWatchRoute}
              theater={theater}
              onToggleTheater={handleToggleTheater}
              card={watchState.card ?? null}
              related={watchState.related}
              queue={watchState.queue}
              actions={watchState.actions ?? DEFAULT_WATCH_ACTIONS}
              onAction={onWatchAction}
              onClose={onWatchClose}
              onPlayCard={onPlayCard === undefined ? undefined : handlePlayCard}
              onOpenChannel={
                onOpenChannel === undefined
                  ? undefined
                  : (channelId) => handleOpenChannel({ channelId })
              }
            />
          </aside>
        )}

        <AgentPanelSlot
          visible={panel.state.visible}
          widthPx={panel.state.widthPx}
          onRequestClose={() => setPanelVisible(false)}
          onRequestResize={(widthPx) => panel.resize(widthPx)}
        >
          {agentPanelContent}
        </AgentPanelSlot>
      </div>

      {/* ADR-0003: the independent-value notice is permanent shell chrome. */}
      <footer data-testid="independent-value-notice" style={shellStyles.footer}>
        {theme.notice.text}
      </footer>
    </div>
  );
}
