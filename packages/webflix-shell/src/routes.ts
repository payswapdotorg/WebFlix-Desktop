// Route model (WFX-UX-SHELL-1) — the shell's mirror of the FROZEN
// webflix-contracts MediaRoute set (freeze §9, ui-actions.ts).
//
// The shell never invents routes: every navigable surface is one of the
// frozen `MediaRoute` values, and the parameters it may carry are exactly
// the frozen `RouteParams` keys (a route reads only the keys it owns —
// same law the contract states). `watch` and `channel` are CONTENT routes:
// they are reached through card actions, the agent bridge's openRoute, or
// deep links — never through the sidebar, which lists the browse surfaces.
//
// Import conventions follow the package's existing rules: contract types
// come from the "webflix-contracts" entrypoint (re-exported through the
// shell barrel), never from connector or application internals.

import type { MediaRoute, RouteParams } from "webflix-contracts";
import { theme } from "./theme";

export type { MediaRoute, RouteParams };

/** The shell's full route state: one frozen route + its params. */
export interface RouteState {
  readonly route: MediaRoute;
  readonly params: RouteParams;
}

/** Builds a route state (params default to empty — never fabricated). */
export function routeState(route: MediaRoute, params: RouteParams = {}): RouteState {
  return { route, params };
}

/**
 * Value equality over the frozen RouteParams keys (the controlled-route
 * sync uses it so a host echoing our own onNavigate reports cannot loop).
 */
export function paramsEqual(a: RouteParams, b: RouteParams): boolean {
  return (
    a.query === b.query &&
    a.itemId === b.itemId &&
    a.channelId === b.channelId &&
    a.handle === b.handle &&
    a.channelTab === b.channelTab &&
    a.category === b.category &&
    a.region === b.region
  );
}

/**
 * The surfaces whose ports paginate with a cursor. The shell reports these
 * to the host through the flat `onLoadMorePage` callback; the host owns the
 * actual port call (freeze §9: ports are interfaces, implemented app-side).
 */
export type LoadMoreSurface = "home" | "search" | "channel" | "trending" | "shorts";

/**
 * The surfaces that can answer an honest retry-able phase (unavailable /
 * status-unknown). One flat callback keeps the AppShell prop surface small
 * while every screen's retry control still works.
 */
export type RetrySurface =
  | "home"
  | "channel"
  | "trending"
  | "shorts"
  | "subscriptions"
  | "history"
  | "search";

/** The chip-filtered surfaces (home feed + trending chart). */
export type ChipSurface = "home" | "trending";

/**
 * Sidebar navigation groups (the reference pattern): a primary media row, a
 * "You" group, an Explore group, and the management destinations. The flat
 * NAV_ITEMS list (AppShell) is derived from these groups so the two can
 * never drift — the composition tests pin both shapes.
 */
export interface NavGroup {
  readonly label: string;
  readonly items: readonly { id: Exclude<MediaRoute, "watch" | "channel">; label: string }[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "WebFlix",
    items: [
      { id: "home", label: "Home" },
      { id: "search", label: "Search" },
      { id: "shorts", label: "Shorts" },
    ],
  },
  {
    label: "You",
    items: [
      { id: "subscriptions", label: "Subscriptions" },
      { id: "library", label: "Library" },
      { id: "history", label: "History" },
    ],
  },
  {
    label: "Explore",
    items: [{ id: "trending", label: "Trending" }],
  },
  {
    label: "Manage",
    items: [
      { id: "accounts", label: "Accounts" },
      { id: "ads", label: "Ad Center" },
      { id: "evaluation", label: "MI Evaluation" },
      { id: "settings", label: "Settings" },
    ],
  },
];

/** Every sidebar nav id (derived — the AppShell's ScreenId vocabulary). */
export type NavRoute = Exclude<MediaRoute, "watch" | "channel">;

/** Flat nav items in visual order (the composition tests pin these labels). */
export const NAV_ITEMS: readonly { id: NavRoute; label: string }[] = NAV_GROUPS.flatMap(
  (group) => group.items,
);

/**
 * Narrow-viewport probe for the responsive sidebar. Feature-detected: jsdom
 * (and any host without matchMedia) answers the fallback instead of
 * throwing — the honest "cannot probe" answer, never a guess.
 */
export function isNarrowViewport(fallback = false): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return fallback;
  }
  try {
    return window.matchMedia(`(max-width: ${theme.layout.narrowViewportPx}px)`).matches;
  } catch {
    return fallback;
  }
}
