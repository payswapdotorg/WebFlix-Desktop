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
