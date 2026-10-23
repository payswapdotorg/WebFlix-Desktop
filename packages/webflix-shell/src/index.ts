// Public entrypoint for webflix-shell (D1 lane; WFX-UX-SHELL-1 extends it).
//
// Screens + shell chrome, the honest-state vocabulary (freeze §2.3), the
// WebFlix theme, the route model (freeze §9 MediaRoute mirror), the media
// card atoms (frozen §9 view shapes), the agent-panel slot, and the
// canonical contract types re-exported from webflix-contracts (the
// lane-local mirror was removed at integration; MIRROR-RECON re-pointed
// every component and fixture at the frozen shapes).

export * from "webflix-contracts";
export * from "./states";
export * from "./theme";
export * from "./routes";

export { AppShell, NAV_ITEMS } from "./components/AppShell";
export type { AppShellProps, ScreenId, WatchSurfaceState } from "./components/AppShell";
export { HomeScreen } from "./components/HomeScreen";
export type { HomeScreenProps } from "./components/HomeScreen";
export { SearchScreen } from "./components/SearchScreen";
export type { SearchScreenProps } from "./components/SearchScreen";
export { WatchScreen, DEFAULT_WATCH_ACTIONS } from "./components/WatchScreen";
export type {
  WatchScreenProps,
  WatchActionView,
  WatchQueueEntryView,
} from "./components/WatchScreen";
export { LibraryScreen } from "./components/LibraryScreen";
export type { LibraryScreenProps } from "./components/LibraryScreen";
export { AccountsScreen } from "./components/AccountsScreen";
export type { AccountsScreenProps } from "./components/AccountsScreen";
// DESKTOP-COMPOSITION-1: the three P4/P5 surfaces mount in the shell's screen
// set (ads / evaluation) and ship as public exports — props-driven, honest
// never-run null/[] defaults; host-app wiring is Phase 6.
export { AdCenterPanel } from "./components/AdCenterPanel";
export type { AdCenterPanelProps } from "./components/AdCenterPanel";
export { EvaluationPanel } from "./components/EvaluationPanel";
export type { EvaluationPanelProps } from "./components/EvaluationPanel";
export { RankerAdapterSelector } from "./components/RankerAdapterSelector";
export type { RankerAdapterSelectorProps } from "./components/RankerAdapterSelector";
// P7-COMPOSE-1 (WF-021 surface): the retention/settings screen mounts in the
// shell's screen set and ships as a public export — props-driven, honest
// never-loaded null defaults; host-app wiring is the hosts' own rows.
export { SettingsScreen } from "./components/SettingsScreen";
export type { SettingsScreenProps } from "./components/SettingsScreen";
// WFX-UX-SHELL-1: the new media surfaces + the agent-panel slot.
export { ChannelScreen } from "./components/ChannelScreen";
export type { ChannelScreenProps } from "./components/ChannelScreen";
export { TrendingScreen } from "./components/TrendingScreen";
export type { TrendingScreenProps } from "./components/TrendingScreen";
export { ShortsScreen } from "./components/ShortsScreen";
export type { ShortsScreenProps } from "./components/ShortsScreen";
export { SubscriptionsScreen } from "./components/SubscriptionsScreen";
export type { SubscriptionsScreenProps } from "./components/SubscriptionsScreen";
export { HistoryScreen } from "./components/HistoryScreen";
export type { HistoryScreenProps } from "./components/HistoryScreen";
export {
  AgentPanelSlot,
  AgentPanelSlot as AgentPanel,
  AGENT_PANEL_TOGGLE_SHORTCUT,
  createInMemoryPanelPersistence,
  useAgentPanelState,
} from "./components/AgentPanel";
export type {
  AgentPanelApi,
  AgentPanelViewState,
  AgentPanelResizeRequest,
  AgentPanelSlotProps,
  PanelPersistence,
} from "./components/AgentPanel";
// The media card atoms (frozen §9 view shapes → the reference's cards).
export { VideoCard } from "./components/media/VideoCard";
export type { VideoCardProps, VideoCardProgress } from "./components/media/VideoCard";
export { ShortsTile } from "./components/media/ShortsTile";
export type { ShortsTileProps } from "./components/media/ShortsTile";
export { ChannelCard } from "./components/media/ChannelCard";
export type { ChannelCardProps } from "./components/media/ChannelCard";
export { MediaCardGrid } from "./components/media/MediaCardGrid";
export type { MediaCardGridProps } from "./components/media/MediaCardGrid";
export { CategoryChipRow } from "./components/media/CategoryChipRow";
export type { CategoryChipRowProps } from "./components/media/CategoryChipRow";
export { MediaPhasePanel, ViewNotProvided } from "./components/media/MediaPhasePanel";
export type { MediaPhasePanelProps, ViewNotProvidedProps } from "./components/media/MediaPhasePanel";
export { LoadMoreControl, useIntersectionSentinel } from "./components/media/LoadMore";
export type { LoadMoreControlProps } from "./components/media/LoadMore";
export { Icon } from "./components/media/icons";
export type { IconProps, IconName } from "./components/media/icons";
