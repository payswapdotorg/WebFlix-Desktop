// The route → screen switch (WFX-UX-SHELL-1, deliverable 2). Extracted
// from AppShell.tsx for the repo's max-lines law: one component that maps
// the FROZEN MediaRoute + RouteParams to the mounted screen, with every
// prop wired exactly as before. The `watch` content route renders its
// nothing-playing panel here when the host has no watch surface mounted
// (the watch surface itself lives in the shell's persistent dock).

import React from "react";
import type {
  CatalogItem,
  ChannelView,
  Collection,
  EvaluationResult,
  HistoryView,
  HomeFeedView,
  MediaRoute,
  NetflixHomeView,
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
import type { SearchState } from "../../states";
import type { LoadMoreSurface, RetrySurface } from "../../routes";
import { HomeScreen } from "../HomeScreen";
import { SearchScreen } from "../SearchScreen";
import { LibraryScreen } from "../LibraryScreen";
import { AccountsScreen } from "../AccountsScreen";
import { AdCenterPanel } from "../AdCenterPanel";
import { EvaluationPanel } from "../EvaluationPanel";
import { RankerAdapterSelector } from "../RankerAdapterSelector";
import { SettingsScreen } from "../SettingsScreen";
import { ChannelScreen } from "../ChannelScreen";
import { TrendingScreen } from "../TrendingScreen";
import { NetflixScreen } from "../NetflixScreen";
import { NetflixTitleScreen } from "../NetflixTitleScreen";
import { ShortsScreen } from "../ShortsScreen";
import { SubscriptionsScreen } from "../SubscriptionsScreen";
import { HistoryScreen } from "../HistoryScreen";
import { shellStyles } from "./shell-styles";

export interface ScreenRouterProps {
  readonly route: MediaRoute;
  readonly params: RouteParams;
  /** The shell's navigation entrypoint (nav buttons, tabs, cards report here). */
  readonly navigate: (route: MediaRoute, params?: RouteParams) => void;

  // ---- legacy + media data (defaults resolved by the shell) ----
  readonly accounts: readonly ProviderAccountRecord[];
  readonly recentItems: readonly CatalogItem[];
  readonly collections: readonly Collection[];
  readonly localEntries: readonly CatalogItem[];
  readonly searchState: SearchState;
  readonly onPlay?: (item: CatalogItem) => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onDisconnect?: (accountId: string) => void;
  readonly onSearchQuery?: (query: string) => void;
  readonly onSearchSubmit?: (query: string) => void;
  readonly onRetrySearch?: () => void;
  readonly onImportLocalFiles?: () => void;

  // ---- ads / evaluation (DESKTOP-COMPOSITION-1) ----
  readonly adCenterResults: readonly AdsQualificationItemOutcome[] | null;
  readonly evaluationResult: EvaluationResult | null;
  readonly rankerAdapterEntries: readonly RankerAdapterDescriptor[];
  readonly rankerSelectedAdapterId: string | null;
  readonly onRankerAdapterSelectionChange?: (adapterId: string) => void;
  readonly rankerStatusNote: string | null;

  // ---- retention / settings (P7-COMPOSE-1) ----
  readonly retentionState: RetentionState | null;
  readonly retentionResetResult: ResetLocalDataResult | null;
  readonly onPauseHistoryTracking?: () => void;
  readonly onResumeHistoryTracking?: () => void;
  readonly onResetLocalData?: (scope: RetentionScope) => void;
  readonly connectOutcome: { providerId: string; ok: boolean; reason: string } | null;

  // ---- WFX media views (freeze §9; null = honest not-provided) ----
  readonly homeFeed: HomeFeedView | null;
  readonly searchPage: SearchPageData | null;
  readonly channelView: ChannelView | null;
  readonly trendingView: TrendingView | null;
  readonly shortsView: ShortsView | null;
  readonly subscriptionsView: SubscriptionsView | null;
  readonly historyView: HistoryView | null;
  // ---- WFX-NETFLIX-SOURCE-1 (the second source's surfaces) ----
  readonly netflixHome: NetflixHomeView | null;
  readonly netflixTitleView: NetflixTitleView | null;
  /** Whether the persistent watch surface is mounted (the watch route's
   *  nothing-playing panel renders when it is not). */
  readonly watchMounted: boolean;
  readonly loadingMoreSurfaces: readonly LoadMoreSurface[];
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onLoadMorePage?: (surface: LoadMoreSurface, cursor: string) => void;
  readonly onRetrySurface?: (surface: RetrySurface) => void;
  readonly onSelectChip?: (surface: "home" | "trending", chip: string | null) => void;
  readonly onSelectChannelTab?: (tab: string) => void;
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  // ---- WFX-NETFLIX-SOURCE-1 (the second source's reports) ----
  /** The hub's country-view chips report here ("Global" | "US"). */
  readonly onSelectNetflixCountry?: (country: string) => void;
  /** The play hand-off's external open (the host owns the system-browser call). */
  readonly onOpenExternalUrl?: (url: string) => void;
}

export function ScreenRouter(props: ScreenRouterProps): React.ReactElement {
  const {
    route,
    params,
    navigate,
    accounts,
    recentItems,
    collections,
    localEntries,
    searchState,
    onPlay,
    onConnect,
    onDisconnect,
    onSearchQuery,
    onSearchSubmit,
    onRetrySearch,
    onImportLocalFiles,
    adCenterResults,
    evaluationResult,
    rankerAdapterEntries,
    rankerSelectedAdapterId,
    onRankerAdapterSelectionChange,
    rankerStatusNote,
    retentionState,
    retentionResetResult,
    onPauseHistoryTracking,
    onResumeHistoryTracking,
    onResetLocalData,
    connectOutcome,
    homeFeed,
    searchPage,
    channelView,
    trendingView,
    shortsView,
    subscriptionsView,
    historyView,
    netflixHome,
    netflixTitleView,
    watchMounted,
    loadingMoreSurfaces,
    onPlayCard,
    onLoadMorePage,
    onRetrySurface,
    onSelectChip,
    onSelectChannelTab,
    onOpenChannel,
    onSelectNetflixCountry,
    onOpenExternalUrl,
  } = props;

  const isLoadingMore = (surface: LoadMoreSurface): boolean =>
    loadingMoreSurfaces.includes(surface);

  switch (route) {
    case "home":
      return (
        <HomeScreen
          accounts={accounts}
          recentItems={recentItems}
          onNavigate={(screen) => navigate(screen)}
          onPlay={onPlay}
          feed={homeFeed}
          loadingMore={isLoadingMore("home")}
          onPlayCard={onPlayCard}
          onOpenChannel={onOpenChannel}
          onChipSelect={(chip) => onSelectChip?.("home", chip)}
          onLoadMore={(cursor) => onLoadMorePage?.("home", cursor)}
          onRetry={() => onRetrySurface?.("home")}
          onConnect={() => navigate("accounts")}
        />
      );
    case "search":
      return (
        <SearchScreen
          state={searchState}
          onQueryChange={onSearchQuery}
          onSubmit={onSearchSubmit}
          onRetry={onRetrySearch}
          onConnect={onConnect}
          onSelectItem={onPlay}
          pageData={searchPage}
          initialQuery={params.query}
          onPlayCard={onPlayCard}
          onOpenChannel={
            onOpenChannel === undefined ? undefined : (channel) => onOpenChannel(channel)
          }
          onLoadMore={(cursor) => onLoadMorePage?.("search", cursor)}
          loadingMore={isLoadingMore("search")}
        />
      );
    case "watch":
      if (!watchMounted) {
        return (
          <div
            data-testid="watch-nothing-playing"
            role="status"
            style={shellStyles.watchNothingPlaying}
          >
            <p style={shellStyles.watchNothingTitle}>Nothing is playing</p>
            <p style={shellStyles.watchNothingMessage}>
              No watch surface is mounted right now. Pick something from Home, Search or your
              Library — WebFlix will not pretend a player exists without one.
            </p>
          </div>
        );
      }
      return <></>;
    case "channel":
      return (
        <ChannelScreen
          view={channelView}
          activeTab={params.channelTab}
          onTabSelect={(tab) => {
            navigate("channel", { ...params, channelTab: tab });
            onSelectChannelTab?.(tab);
          }}
          onPlayCard={onPlayCard}
          onLoadMore={(cursor) => onLoadMorePage?.("channel", cursor)}
          onRetry={() => onRetrySurface?.("channel")}
          loadingMore={isLoadingMore("channel")}
        />
      );
    case "shorts":
      return (
        <ShortsScreen
          view={shortsView}
          onPlayCard={onPlayCard}
          onLoadMore={(cursor) => onLoadMorePage?.("shorts", cursor)}
          onRetry={() => onRetrySurface?.("shorts")}
          loadingMore={isLoadingMore("shorts")}
        />
      );
    case "trending":
      return (
        <TrendingScreen
          view={trendingView}
          onPlayCard={onPlayCard}
          onOpenChannel={onOpenChannel}
          onChipSelect={(chip) => onSelectChip?.("trending", chip)}
          onLoadMore={(cursor) => onLoadMorePage?.("trending", cursor)}
          onRetry={() => onRetrySurface?.("trending")}
          loadingMore={isLoadingMore("trending")}
        />
      );
    case "netflix":
      // WFX-NETFLIX-SOURCE-1: params.itemId selects the title detail; the
      // hub renders otherwise (params.region = the country view).
      return params.itemId !== undefined ? (
        <NetflixTitleScreen
          view={netflixTitleView}
          onBack={() => navigate("netflix", {})}
          onOpenExternal={onOpenExternalUrl}
          onOpenTitle={(netflixId) => navigate("netflix", { itemId: String(netflixId) })}
          onRetry={() => onRetrySurface?.("netflix")}
        />
      ) : (
        <NetflixScreen
          view={netflixHome}
          onSelectCountry={(country) => onSelectNetflixCountry?.(country)}
          onOpenTitle={(netflixId) => navigate("netflix", { itemId: String(netflixId) })}
          onOpenExternal={onOpenExternalUrl}
          onRetry={() => onRetrySurface?.("netflix")}
        />
      );
    case "subscriptions":
      return (
        <SubscriptionsScreen
          view={subscriptionsView}
          onPlayCard={onPlayCard}
          onOpenChannel={
            onOpenChannel === undefined ? undefined : (channel) => onOpenChannel(channel)
          }
          onRetry={() => onRetrySurface?.("subscriptions")}
        />
      );
    case "history":
      return (
        <HistoryScreen
          view={historyView}
          onPlayCard={onPlayCard}
          onOpenChannel={onOpenChannel}
          onRetry={() => onRetrySurface?.("history")}
        />
      );
    case "library":
      return (
        <LibraryScreen
          collections={collections}
          localEntries={localEntries}
          onPlay={onPlay}
          onImportLocalFiles={onImportLocalFiles}
        />
      );
    case "settings":
      return (
        <SettingsScreen
          retentionState={retentionState}
          resetResult={retentionResetResult}
          onPauseHistoryTracking={onPauseHistoryTracking}
          onResumeHistoryTracking={onResumeHistoryTracking}
          onResetLocalData={onResetLocalData}
        />
      );
    case "accounts":
      return (
        <AccountsScreen
          accounts={accounts}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          connectOutcome={connectOutcome}
        />
      );
    case "ads":
      return <AdCenterPanel results={adCenterResults} />;
    case "evaluation":
      return (
        <div style={shellStyles.screenStack} data-testid="screen-evaluation">
          <RankerAdapterSelector
            entries={rankerAdapterEntries}
            selectedAdapterId={rankerSelectedAdapterId}
            onSelectionChange={(adapterId) => onRankerAdapterSelectionChange?.(adapterId)}
            statusNote={rankerStatusNote}
          />
          <EvaluationPanel result={evaluationResult} />
        </div>
      );
    default: {
      const unhandled: never = route;
      throw new Error(`Unhandled MediaRoute: ${JSON.stringify(unhandled)}`);
    }
  }
}
