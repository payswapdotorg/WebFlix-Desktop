// Public entrypoint for webflix-shell (D1 lane).
//
// Screens + shell chrome, the honest-state vocabulary (freeze §2.3), the
// WebFlix theme, and the canonical contract types re-exported from
// webflix-contracts (the lane-local mirror was removed at integration;
// MIRROR-RECON re-pointed every component and fixture at the frozen shapes).

export * from "webflix-contracts";
export * from "./states";
export * from "./theme";

export { AppShell, NAV_ITEMS } from "./components/AppShell";
export type { AppShellProps, ScreenId } from "./components/AppShell";
export { HomeScreen } from "./components/HomeScreen";
export type { HomeScreenProps } from "./components/HomeScreen";
export { SearchScreen } from "./components/SearchScreen";
export type { SearchScreenProps } from "./components/SearchScreen";
export { WatchScreen } from "./components/WatchScreen";
export type { WatchScreenProps } from "./components/WatchScreen";
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
