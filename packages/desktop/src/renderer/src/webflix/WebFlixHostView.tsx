/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the host view: builds
 * the media-first AppShell's full prop record from the host bundle and
 * renders the root tree (hidden real file picker, product mark, vault
 * banner, the shell, the honest about footer). Extracted from boot.tsx for
 * the max-lines law; every prop wire is the original one.
 */
import type { RefObject, ReactNode } from "react";
import { AppShell } from "../../../../../webflix-shell/src/components/AppShell.js";
import type { AppShellProps } from "../../../../../webflix-shell/src/components/AppShell.js";
import type { WatchSurfaceState } from "../../../../../webflix-shell/src/components/AppShell.js";
import type { CatalogItem, MediaRoute, RouteParams } from "../../../../../webflix-contracts/src/index.js";
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
import type { LoadMoreSurface } from "../../../../../webflix-shell/src/routes.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import type { ProviderAccountRecord } from "../../../../../webflix-contracts/src/index.js";
import type { RetentionScope, RetentionState, ResetLocalDataResult } from "../../../../../webflix-application/src/index.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { UiActionBridge, UiActionHandlers } from "../agent/uiActionBridge.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { webflixAboutLine } from "./brand.js";
import type { WebFlixAccountsStatus } from "./accountsBridge.js";
import { hostStyles, BrandMarkNode, StartupReadyNotifier, VaultUnavailableBanner } from "./hostChrome.js";

export interface WebFlixHostBundle {
  readonly route: { route: MediaRoute; params: RouteParams };
  readonly setRoute: (route: MediaRoute, params?: RouteParams) => void;
  readonly accounts: readonly ProviderAccountRecord[];
  readonly recentItems: readonly CatalogItem[];
  readonly localEntries: readonly CatalogItem[];
  readonly searchState: SearchState;
  readonly searchPage: SearchPageData | null;
  readonly homeFeed: HomeFeedView | null;
  readonly channelView: ChannelView | null;
  readonly trendingView: TrendingView | null;
  readonly shortsView: ShortsView | null;
  readonly subscriptionsView: SubscriptionsView | null;
  readonly historyView: HistoryView | null;
  readonly loadingMoreSurfaces: readonly LoadMoreSurface[];
  readonly watchSurface: WatchSurfaceState | null;
  readonly setWatchState: (state: WatchSurfaceState | null) => void;
  readonly agentPanelVisible: boolean;
  readonly setAgentPanelVisible: (visible: boolean) => void;
  readonly setAgentPanelWidth: (widthPx: number | null) => void;
  readonly agentWorkspacePath: string | null;
  readonly uiActionHandlers: UiActionHandlers;
  readonly handleBridgeReady: (bridge: UiActionBridge) => void;
  readonly retentionState: RetentionState | null;
  readonly retentionResetResult: ResetLocalDataResult | null;
  readonly connectOutcome: { providerId: string; ok: boolean; reason: string } | null;
  readonly handlePlay: (item: CatalogItem) => void;
  readonly playCard: (card: VideoCardView) => void;
  readonly handleSearchSubmit: (query: string) => void;
  readonly handleConnect: (providerId: string) => void;
  readonly handleDisconnect: (internalAccountId: string) => void;
  readonly handleImportLocalFiles: () => void;
  readonly handlePauseHistory: () => void;
  readonly handleResumeHistory: () => void;
  readonly handleResetLocalData: (scope: RetentionScope) => void;
  readonly retrySearch: () => void;
  readonly setChannelView: (view: ChannelView | null) => void;
  readonly setHomeFeed: (view: HomeFeedView | null) => void;
  readonly setTrendingView: (view: TrendingView | null) => void;
  readonly registerCards: (cards: readonly VideoCardView[] | undefined | null) => void;
  readonly getProducers: () => YouTubeMediaProducers | null;
  readonly setLoadingMoreSurfaces: (
    setter: (current: readonly LoadMoreSurface[]) => readonly LoadMoreSurface[],
  ) => void;
  readonly accountsStatus: WebFlixAccountsStatus | null;
  readonly version: string;
  readonly fileInputRef: RefObject<HTMLInputElement | null>;
  readonly onFilesPicked: (files: readonly File[]) => void;
}

/** The WebFlix product view tree (props built wire-for-wire from the bundle). */
export function WebFlixHostView(bundle: WebFlixHostBundle): ReactNode {
  const shellProps: AppShellProps = buildShellProps(bundle);
  return (
    <div style={hostStyles.root}>
      <StartupReadyNotifier />
      <input
        ref={bundle.fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*"
        style={hostStyles.fileInput}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="webflix-local-file-input"
        onChange={(event) => {
          bundle.onFilesPicked([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      <div style={hostStyles.shell}>
        {bundle.accountsStatus !== null && !bundle.accountsStatus.vault.available && (
          <VaultUnavailableBanner status={bundle.accountsStatus} />
        )}
        <AppShell {...shellProps} brandMark={<BrandMarkNode />} />
      </div>

      {/* About/help copy (requirement 2) — the honest product line. */}
      <footer data-testid="webflix-about-line" style={hostStyles.about}>
        {webflixAboutLine(bundle.version)}
      </footer>
    </div>
  );
}

function buildShellProps(bundle: WebFlixHostBundle): AppShellProps {
  return {
    route: bundle.route,
    onNavigate: (nextRoute, params) => {
      bundle.setRoute(nextRoute, params ?? {});
    },
    accounts: bundle.accounts,
    recentItems: bundle.recentItems,
    collections: [],
    localEntries: bundle.localEntries,
    searchState: bundle.searchState,
    searchPage: bundle.searchPage,
    onPlay: bundle.handlePlay,
    onPlayCard: bundle.playCard,
    onConnect: bundle.handleConnect,
    onDisconnect: bundle.handleDisconnect,
    onImportLocalFiles: bundle.handleImportLocalFiles,
    onSearchSubmit: bundle.handleSearchSubmit,
    homeFeed: bundle.homeFeed,
    channelView: bundle.channelView,
    trendingView: bundle.trendingView,
    shortsView: bundle.shortsView,
    subscriptionsView: bundle.subscriptionsView,
    historyView: bundle.historyView,
    loadingMoreSurfaces: bundle.loadingMoreSurfaces,
    onLoadMorePage: (surface, cursor) => {
      const producers = bundle.getProducers();
      if (producers === null) return;
      const markLoading = (on: boolean) =>
        bundle.setLoadingMoreSurfaces((current) =>
          on ? [...current, surface] : current.filter((item) => item !== surface),
        );
      markLoading(true);
      if (surface === "home") {
        void producers.homeFeed
          .getHomeFeedAppend(cursor)
          .then((view) => {
            if (view.phase === "ready") {
              for (const section of view.sections) {
                if (section.kind === "video-grid") bundle.registerCards(section.videos);
              }
              bundle.setHomeFeed(view);
            }
          })
          .catch(() => undefined)
          .finally(() => markLoading(false));
      } else if (surface === "trending") {
        void producers.trending
          .trending({})
          .then((view) => {
            bundle.registerCards(view.videos);
            bundle.setTrendingView(view);
          })
          .catch(() => undefined)
          .finally(() => markLoading(false));
      } else {
        markLoading(false);
      }
    },
    onRetrySearch: bundle.retrySearch,
    onOpenChannel: (channel) => {
      bundle.setChannelView(null);
      bundle.setRoute("channel", {
        ...(channel.channelId !== undefined ? { channelId: channel.channelId } : {}),
        ...(channel.handle !== undefined ? { handle: channel.handle } : {}),
      });
    },
    watchState: bundle.watchSurface,
    onWatchClose: () => {
      bundle.setWatchState(null);
      bundle.setRoute("home", {});
    },
    agentPanelVisible: bundle.agentPanelVisible,
    onAgentPanelStateChange: (state) => {
      bundle.setAgentPanelVisible(state.visible);
      bundle.setAgentPanelWidth(state.widthPx);
    },
    agentPanelContent: bundle.agentPanelVisible ? (api) => renderPanelContent(bundle, api) : null,
    adCenterResults: null,
    evaluationResult: null,
    rankerAdapterEntries: [],
    rankerSelectedAdapterId: null,
    rankerStatusNote:
      "No ranking adapter is wired in this desktop build — none is offered (the MI engine is a later order).",
    retentionState: bundle.retentionState,
    retentionResetResult: bundle.retentionResetResult,
    onPauseHistoryTracking: bundle.handlePauseHistory,
    onResumeHistoryTracking: bundle.handleResumeHistory,
    onResetLocalData: bundle.handleResetLocalData,
    connectOutcome: bundle.connectOutcome,
  };
}

function renderPanelContent(
  bundle: WebFlixHostBundle,
  api: { close(): void },
): ReactNode {
  if (bundle.agentWorkspacePath === null) {
    return (
      <div
        data-testid="agent-panel-workspace-unavailable"
        role="note"
        style={hostStyles.panelUnavailable}
      >
        The agent workspace could not be prepared in this runtime (the validated workspace bootstrap
        bridge is unavailable) — the ZCode agent panel needs it before it can start. Nothing is
        faked here.
        <button type="button" onClick={api.close} style={{ display: "block", marginTop: 8 }}>
          Close panel
        </button>
      </div>
    );
  }
  return (
    <AgentPanel
      workspacePath={bundle.agentWorkspacePath}
      onClose={api.close}
      uiActionHandlers={bundle.uiActionHandlers}
      onBridgeReady={bundle.handleBridgeReady}
    />
  );
}
