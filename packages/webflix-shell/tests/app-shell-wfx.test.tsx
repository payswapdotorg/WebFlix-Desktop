// @vitest-environment jsdom
//
// AppShell media-first chrome + route-model tests (WFX-UX-SHELL-1,
// deliverables 1–2). The jsdom docblock above is mandatory. Run from the
// package: pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: the views below are tests/fixtures.ts
// literals shaped like the frozen §9 contracts — never live data):
// - the shell chrome: collapsible sidebar (groups + aria-current + icon
//   rail with preserved accessible names), global search (navigates the
//   ROUTE MODEL and reports), account status, agent toggle, and the
//   ADR-0003 independent-value footer on every route;
// - the route model mirrors the frozen MediaRoute set: mount-time route +
//   params, controlled-route sync (the agent bridge's openRoute), and
//   onNavigate reports for user navigation;
// - the persistent watch dock (freeze §9.6): the player survives
//   non-watch navigation as the SAME DOM node, the main surface hides on
//   the watch route, and the watch route without a mounted surface renders
//   the honest nothing-playing panel;
// - keyboard accessibility: nav buttons are real <button>s in DOM order,
//   focus-visible styling is declared by the shell stylesheet;
// - the WFX view props flow to the screens (homeFeed → the media feed,
//   channelView → ChannelScreen, …) and the flat callbacks report.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AppShell, NAV_ITEMS } from "../src/index";
import type { MediaRoute, RouteParams } from "../src/index";
import {
  FIXTURE_EMBED_PLAN,
  fixtureChannelView,
  fixtureHomeFeedReady,
  fixtureHomeSections,
  fixtureShortsView,
  fixtureSubscriptionsView,
  fixtureTrendingView,
} from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

const watchState = { title: "Fixture video", plan: FIXTURE_EMBED_PLAN };

describe("AppShell — the media-first chrome (deliverable 1)", () => {
  it("renders the top chrome: brand, global search, account status, agent toggle", () => {
    render(<AppShell />);
    const chrome = screen.getByTestId("shell-top-chrome");
    expect(chrome.tagName).toBe("HEADER");
    expect(chrome.textContent).toContain("WebFlix");
    expect(screen.getByTestId("global-search-input")).toBeTruthy();
    expect(screen.getByTestId("global-search-submit")).toBeTruthy();
    expect(screen.getByTestId("account-status").textContent).toContain("Not signed in");
    expect(screen.getByTestId("agent-panel-toggle")).toBeTruthy();
  });

  it("the account status reflects connected accounts honestly and opens Accounts", () => {
    const onNavigate = vi.fn();
    render(
      <AppShell
        onNavigate={onNavigate}
        accounts={[
          {
            providerId: "youtube",
            internalAccountId: "acc-1",
            displayName: "me@example.com",
            grantedScopes: ["youtube.readonly"],
            status: "connected",
            connectedAt: "2026-01-01T00:00:00Z",
            expiresAt: "2027-01-01T00:00:00Z",
          },
        ]}
      />,
    );
    const status = screen.getByTestId("account-status");
    expect(status.textContent).toContain("1 account connected");
    fireEvent.click(status);
    expect(onNavigate).toHaveBeenCalledWith("accounts", {});
  });

  it("the sidebar renders every nav group destination; Ad Center + MI Evaluation stay reachable", () => {
    render(<AppShell />);
    const nav = screen.getByTestId("primary-nav");
    const ids = Array.from(nav.querySelectorAll('[data-testid^="nav-"]')).map(
      (el) => el.getAttribute("data-testid")!.slice(4),
    );
    expect(ids).toEqual(NAV_ITEMS.map((item) => item.id));
    expect(ids).toContain("ads");
    expect(ids).toContain("evaluation");
    expect(ids).toContain("history");
    expect(ids).toContain("shorts");
    expect(ids).toContain("subscriptions");
    expect(ids).toContain("trending");
  });

  it("nav buttons are keyboard-accessible controls with aria-current on the active route", () => {
    const onNavigate = vi.fn();
    render(<AppShell onNavigate={onNavigate} />);
    const home = screen.getByTestId("nav-home");
    expect(home.tagName).toBe("BUTTON");
    expect(home.getAttribute("aria-current")).toBe("page");
    const shorts = screen.getByTestId("nav-shorts");
    expect(shorts.getAttribute("aria-current")).toBeNull();
    fireEvent.click(shorts);
    expect(onNavigate).toHaveBeenCalledWith("shorts", {});
    expect(screen.getByTestId("nav-shorts").getAttribute("aria-current")).toBe("page");
  });

  it("the collapse toggle flips the sidebar to the icon rail while preserving accessible names", () => {
    render(<AppShell />);
    const toggle = screen.getByTestId("sidebar-collapse-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("primary-nav");
    fireEvent.click(toggle);
    expect(screen.getByTestId("sidebar-collapse-toggle").getAttribute("aria-expanded")).toBe(
      "false",
    );
    // The rail keeps every destination + its accessible name (visually
    // hidden labels, not removed).
    const shorts = screen.getByTestId("nav-shorts");
    expect(shorts.textContent).toContain("Shorts");
    expect(screen.getByTestId("primary-nav").style.width).toBe("");
    expect(screen.getByTestId("sidebar").style.width).toBe("72px");
  });

  it("the ADR-0003 independent-value footer is permanent chrome on every route", () => {
    const { rerender } = render(<AppShell initialRoute="home" />);
    expect(screen.getByTestId("independent-value-notice").textContent).toContain(
      "not affiliated with",
    );
    rerender(<AppShell initialRoute="shorts" shortsView={fixtureShortsView()} />);
    expect(screen.getByTestId("independent-value-notice")).toBeTruthy();
  });

  it("the shell declares its focus-visible stylesheet once", () => {
    render(<AppShell />);
    const style = document.querySelector('[data-testid="wfx-shell-styles"]');
    expect(style?.textContent).toContain(":focus-visible");
  });
});

describe("AppShell — the global search (top chrome → the route model)", () => {
  it("submitting a query navigates the search route WITH params + reports the query", () => {
    const onNavigate = vi.fn();
    const onSearchSubmit = vi.fn();
    render(<AppShell onNavigate={onNavigate} onSearchSubmit={onSearchSubmit} />);
    const input = screen.getByTestId("global-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  donut tutorial  " } });
    fireEvent.submit(screen.getByTestId("global-search-form"));
    expect(onNavigate).toHaveBeenCalledWith("search", { query: "donut tutorial" });
    expect(onSearchSubmit).toHaveBeenCalledWith("donut tutorial");
    // The search screen's input is prefilled from the route param.
    expect((screen.getByTestId("search-input") as HTMLInputElement).value).toBe(
      "donut tutorial",
    );
  });

  it("an empty query navigates the search route WITHOUT params (no fabricated query)", () => {
    const onNavigate = vi.fn();
    render(<AppShell onNavigate={onNavigate} />);
    fireEvent.change(screen.getByTestId("global-search-input"), { target: { value: "   " } });
    fireEvent.submit(screen.getByTestId("global-search-form"));
    expect(onNavigate).toHaveBeenCalledWith("search", {});
  });
});

describe("AppShell — the route model (the frozen MediaRoute mirror)", () => {
  it("mounts the initial route + params (the deep-link path)", () => {
    render(
      <AppShell initialRoute="channel" initialRouteParams={{ channelId: "chan-1", channelTab: "shorts" }} channelView={fixtureChannelView()} />,
    );
    expect(screen.getByTestId("channel-root")).toBeTruthy();
    expect(screen.getByTestId("channel-tab-shorts").getAttribute("aria-current")).toBe("page");
  });

  it("a controlled route change (the agent bridge's openRoute) switches the surface", async () => {
    const controlled = (route: MediaRoute, params: RouteParams = {}) => ({ route, params });
    const { rerender } = render(<AppShell route={controlled("home")} />);
    expect(screen.queryByTestId("home-feed-root")).toBeNull(); // legacy home (no producer wired)

    rerender(<AppShell route={controlled("trending")} trendingView={fixtureTrendingView()} />);
    await waitFor(() => {
      expect(screen.getByTestId("trending-root")).toBeTruthy();
    });

    rerender(<AppShell route={controlled("shorts")} shortsView={fixtureShortsView()} />);
    await waitFor(() => {
      expect(screen.getByTestId("shorts-root")).toBeTruthy();
    });
  });

  it("the legacy initialScreen prop still works (additive evolution)", () => {
    render(<AppShell initialScreen="library" />);
    expect(screen.getByTestId("library-collections-empty")).toBeTruthy();
  });
});

describe("AppShell — the WFX view props flow to the screens", () => {
  it("homeFeed renders the media-first feed instead of the legacy summary", () => {
    render(<AppShell homeFeed={fixtureHomeFeedReady(fixtureHomeSections())} />);
    expect(screen.getByTestId("home-feed-root")).toBeTruthy();
    expect(screen.getByTestId("home-section-grid-1")).toBeTruthy();
    expect(screen.queryByText("Welcome to WebFlix")).toBeNull();
  });

  it("subscriptionsView renders the degradeNote surface", () => {
    render(<AppShell initialRoute="subscriptions" subscriptionsView={fixtureSubscriptionsView()} />);
    expect(screen.getByTestId("subscriptions-degrade-note")).toBeTruthy();
  });

  it("card play + channel open report through the flat callbacks", () => {
    const onPlayCard = vi.fn();
    const onOpenChannel = vi.fn();
    render(
      <AppShell
        homeFeed={fixtureHomeFeedReady(fixtureHomeSections())}
        onPlayCard={onPlayCard}
        onOpenChannel={onOpenChannel}
      />,
    );
    fireEvent.click(screen.getByTestId("video-card-yt-item-1-play"));
    expect(onPlayCard).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("video-card-yt-item-1-channel"));
    expect(onOpenChannel).toHaveBeenCalledWith({ channelId: "chan-1" });
  });
});

describe("AppShell — the persistent watch dock (freeze §9.6)", () => {
  it("the player survives non-watch navigation as the SAME iframe node", () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <AppShell initialRoute="home" watchState={watchState} onNavigate={onNavigate} />,
    );
    const iframe = screen.getByTestId("watch-embed");
    expect(screen.getByTestId("watch-dock")).toBeTruthy();
    expect(screen.getByTestId("watch-compact-root")).toBeTruthy(); // docked variant

    // Navigate through the sidebar: the dock + player persist.
    fireEvent.click(screen.getByTestId("nav-search"));
    expect(onNavigate).toHaveBeenCalledWith("search", {});
    expect(screen.getByTestId("watch-dock")).toBeTruthy();
    expect(screen.getByTestId("watch-embed")).toBe(iframe);

    // And back to the watch route: full-surface layout, same player.
    fireEvent.click(screen.getByTestId("nav-home"));
    rerender(<AppShell initialRoute="home" watchState={watchState} onNavigate={onNavigate} route={{ route: "watch", params: {} }} />);
    expect(screen.getByTestId("watch-full-root")).toBeTruthy();
    expect(screen.getByTestId("watch-embed")).toBe(iframe);
  });

  it("the watch route hides the main surface (the player IS the main content)", () => {
    render(<AppShell initialRoute="watch" watchState={watchState} />);
    const main = screen.getByTestId("shell-main");
    expect(main.style.display).toBe("none");
    expect(screen.getByTestId("watch-full-root")).toBeTruthy();
  });

  it("the watch route without a mounted surface renders the honest nothing-playing panel", () => {
    render(<AppShell initialRoute="watch" />);
    const panel = screen.getByTestId("watch-nothing-playing");
    expect(panel.getAttribute("role")).toBe("status");
    expect(panel.textContent).toContain("Nothing is playing");
  });

  it("theater toggle flows to the watch surface and reports to the host", () => {
    const onWatchToggleTheater = vi.fn();
    render(
      <AppShell
        initialRoute="watch"
        watchState={{ ...watchState, related: [] }}
        onWatchToggleTheater={onWatchToggleTheater}
      />,
    );
    fireEvent.click(screen.getByTestId("watch-theater-toggle"));
    expect(onWatchToggleTheater).toHaveBeenCalledOnce();
    expect(screen.getByTestId("watch-theater-toggle").textContent).toBe("Default view");
  });
});

describe("AppShell — the skip link follows the active surface", () => {
  it("points at the main surface on browse routes and the watch dock on the watch route", () => {
    const { rerender } = render(<AppShell initialRoute="home" />);
    expect(screen.getByTestId("skip-to-content").getAttribute("href")).toBe("#shell-main");
    rerender(<AppShell watchState={watchState} route={{ route: "watch", params: {} }} />);
    expect(screen.getByTestId("skip-to-content").getAttribute("href")).toBe("#watch-dock");
    // The dock carries the id the skip link targets.
    expect(document.getElementById("watch-dock")).toBe(screen.getByTestId("watch-dock"));
  });
});
