// @vitest-environment jsdom
//
// D1 shell component tests (webflix-shell).
// The jsdom docblock above is mandatory: the shared repo-root vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the repo root: ./node_modules/.bin/vitest run --config vitest.config.ts

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  AccountsScreen,
  AppShell,
  HomeScreen,
  HONEST_COPY,
  LibraryScreen,
  SearchScreen,
  WatchScreen,
  describeCapability,
  searchStateFromCapability,
  theme,
  toHonestState,
} from "../src/index";
import type {
  CapabilityStatus,
  CatalogItem,
  LibraryCollection,
  PlaybackPlan,
  ProviderAccountRecord,
} from "../src/index";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures ----------

function catalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "yt-donut",
    title: "Blender donut tutorial",
    providerId: "youtube",
    kind: "stream",
    ...overrides,
  };
}

const connectedAccount: ProviderAccountRecord = {
  accountId: "acc-1",
  providerId: "youtube",
  displayName: "me@example.com",
  state: "connected",
  scopes: ["youtube.readonly"],
  tokenExpiresAt: "2026-01-01T00:00:00Z",
};

const expiredAccount: ProviderAccountRecord = {
  accountId: "acc-2",
  providerId: "youtube",
  displayName: "stale@example.com",
  state: "expired",
};

const revokedAccount: ProviderAccountRecord = {
  accountId: "acc-3",
  providerId: "youtube",
  displayName: "revoked@example.com",
  state: "revoked",
};

const sampleCollection: LibraryCollection = {
  id: "col-1",
  name: "Weekend watch",
  description: "Saved for later.",
  itemIds: ["yt-donut", "yt-spline"],
};

const localEntry: CatalogItem = catalogItem({
  id: "loc-holiday",
  title: "holiday.mp4",
  providerId: "local",
  kind: "local-file",
});

// ---------- AppShell ----------

describe("AppShell", () => {
  it("renders Home by default with the brand and the permanent independent-value notice (ADR-0003)", () => {
    render(<AppShell />);
    expect(screen.getByText("Welcome to WebFlix")).toBeTruthy();
    expect(screen.getByTestId("independent-value-notice").textContent).toBe(theme.notice.text);
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBe("page");
  });

  it("navigation switches screens and tracks aria-current", () => {
    render(
      <AppShell
        accounts={[connectedAccount]}
        collections={[sampleCollection]}
        localEntries={[localEntry]}
      />,
    );

    fireEvent.click(screen.getByTestId("nav-search"));
    expect(screen.getByTestId("search-idle")).toBeTruthy();
    expect(screen.queryByText("Welcome to WebFlix")).toBeNull();
    expect(screen.getByTestId("nav-search").getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBeNull();

    fireEvent.click(screen.getByTestId("nav-library"));
    expect(screen.getByText("Weekend watch")).toBeTruthy();
    expect(screen.getByText("holiday.mp4")).toBeTruthy();

    fireEvent.click(screen.getByTestId("nav-accounts"));
    expect(screen.getByTestId("account-card-connected")).toBeTruthy();
    expect(screen.getByText("me@example.com")).toBeTruthy();

    fireEvent.click(screen.getByTestId("nav-home"));
    expect(screen.getByText("Welcome to WebFlix")).toBeTruthy();
    expect(screen.getByTestId("account-summary")).toBeTruthy();
  });
});

// ---------- HomeScreen ----------

describe("HomeScreen", () => {
  it("shows honest empty states when there are no accounts and no history", () => {
    const onNavigate = vi.fn();
    render(<HomeScreen onNavigate={onNavigate} />);
    expect(screen.getByTestId("home-accounts-empty").textContent).toMatch(/no accounts connected/i);
    expect(screen.getByTestId("home-library-empty").textContent).toMatch(
      /nothing in your library/i,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to Accounts" }));
    expect(onNavigate).toHaveBeenCalledWith("accounts");
    fireEvent.click(screen.getByRole("button", { name: "Browse Library" }));
    expect(onNavigate).toHaveBeenCalledWith("library");
  });

  it("summarizes connected accounts and offers playback for recent items", () => {
    const onPlay = vi.fn();
    render(
      <HomeScreen accounts={[connectedAccount]} recentItems={[catalogItem()]} onPlay={onPlay} />,
    );
    const summary = screen.getByTestId("account-summary");
    expect(summary.textContent).toContain("me@example.com");
    expect(summary.textContent).toContain("youtube");
    expect(summary.textContent).toContain("connected");

    fireEvent.click(screen.getByRole("button", { name: "Play Blender donut tutorial" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(catalogItem());
  });
});

// ---------- SearchScreen ----------

describe("SearchScreen", () => {
  it("shows the honest idle prompt before any search", () => {
    render(<SearchScreen state={{ phase: "idle" }} />);
    expect(screen.getByTestId("search-idle").textContent).toMatch(/type a query/i);
  });

  it("shows a loading state while the query is in flight", () => {
    render(<SearchScreen state={{ phase: "loading", query: "donut" }} />);
    expect(screen.getByTestId("search-loading").textContent).toMatch(/loading/i);
  });

  it("submits the typed query", () => {
    const onSubmit = vi.fn();
    render(<SearchScreen state={{ phase: "idle" }} onSubmit={onSubmit} />);
    const input = screen.getByTestId("search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "donut" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSubmit).toHaveBeenCalledWith("donut");
  });

  it("lists results and plays a selected item", () => {
    const onSelectItem = vi.fn();
    render(
      <SearchScreen
        state={{ phase: "results", query: "donut", items: [catalogItem()] }}
        onSelectItem={onSelectItem}
      />,
    );
    expect(screen.getByTestId("search-results").textContent).toContain("Blender donut tutorial");
    fireEvent.click(screen.getByRole("button", { name: "Play Blender donut tutorial" }));
    expect(onSelectItem).toHaveBeenCalledWith(catalogItem());
  });

  it("shows an honest empty state when the search finished with no results", () => {
    render(<SearchScreen state={{ phase: "empty", query: "zzz" }} />);
    expect(screen.getByTestId("search-empty").textContent).toMatch(/nothing here yet/i);
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  it("requires-auth offers a connect action instead of fake results", () => {
    const onConnect = vi.fn();
    render(
      <SearchScreen
        state={{ phase: "requires-auth", query: "donut", providerId: "youtube" }}
        onConnect={onConnect}
      />,
    );
    expect(screen.getByTestId("search-requires-auth").textContent).toMatch(/sign-in required/i);
    fireEvent.click(screen.getByRole("button", { name: "Connect account" }));
    expect(onConnect).toHaveBeenCalledWith("youtube");
  });

  it("rate-limited says so and offers retry — never fake results", () => {
    const onRetry = vi.fn();
    render(
      <SearchScreen
        state={{ phase: "rate-limited", query: "donut", retryAfterSeconds: 90 }}
        onRetry={onRetry}
      />,
    );
    const panel = screen.getByTestId("search-rate-limited");
    expect(panel.textContent).toMatch(/rate limited/i);
    expect(panel.textContent).toContain("90");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("search-results")).toBeNull();
  });

  it("unsupported renders the unsupported panel with the reason and no dead play control", () => {
    render(
      <SearchScreen
        state={{
          phase: "unsupported",
          query: "donut",
          reason: "This provider has no search API in M1.",
        }}
      />,
    );
    const panel = screen.getByTestId("search-unsupported");
    expect(panel.textContent).toMatch(/unsupported/i);
    expect(panel.textContent).toContain("This provider has no search API in M1.");
    // Honest by design: 'unsupported' must NOT render a playable/dead control.
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  it('status-unknown renders "Status unknown" (freeze §2.3) rather than guessing', () => {
    render(<SearchScreen state={{ phase: "status-unknown", query: "donut" }} />);
    expect(screen.getByTestId("search-status-unknown").textContent).toContain("Status unknown");
  });
});

// ---------- WatchScreen ----------

describe("WatchScreen", () => {
  it("renders the official embed for an official-embed plan", () => {
    const plan: PlaybackPlan = {
      strategy: "official-embed",
      itemId: "yt-donut",
      title: "Blender donut tutorial",
      embedUrl: "https://www.youtube.com/embed/abc123",
    };
    render(<WatchScreen plan={plan} />);
    const frame = screen.getByTestId("watch-embed") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("https://www.youtube.com/embed/abc123");
    expect(screen.queryByTestId("watch-unavailable")).toBeNull();
  });

  it("renders a local file player for a local-file plan", () => {
    const plan: PlaybackPlan = {
      strategy: "local-file",
      itemId: "loc-holiday",
      title: "holiday.mp4",
      filePath: "file:///home/z/Videos/holiday.mp4",
      mimeType: "video/mp4",
    };
    render(<WatchScreen plan={plan} />);
    const player = screen.getByTestId("watch-local-player") as HTMLVideoElement;
    expect(player.tagName).toBe("VIDEO");
    expect(player.getAttribute("src")).toBe("file:///home/z/Videos/holiday.mp4");
    expect(screen.queryByTestId("watch-embed")).toBeNull();
  });

  it("renders the unavailable panel with reason + recovery — no player, no dead button", () => {
    const plan: PlaybackPlan = {
      strategy: "unavailable",
      itemId: "yt-donut",
      title: "Blender donut tutorial",
      reason: "The uploader disabled embedding.",
      recovery: "Open the video on the provider site, or pick another item.",
    };
    render(<WatchScreen plan={plan} />);
    const panel = screen.getByTestId("watch-unavailable");
    expect(panel.textContent).toContain("The uploader disabled embedding.");
    expect(panel.textContent).toContain(
      "Open the video on the provider site, or pick another item.",
    );
    expect(screen.queryByTestId("watch-embed")).toBeNull();
    expect(screen.queryByTestId("watch-local-player")).toBeNull();
    // No onClose wired → no Back control; nothing on screen is dead.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a Back control only when a close handler is provided", () => {
    const plan: PlaybackPlan = {
      strategy: "unavailable",
      itemId: "x",
      title: "T",
      reason: "r",
      recovery: "do this",
    };
    const onClose = vi.fn();
    const { rerender } = render(<WatchScreen plan={plan} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<WatchScreen plan={plan} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

// ---------- LibraryScreen ----------

describe("LibraryScreen", () => {
  it("renders collections and local entries with playback", () => {
    const onPlay = vi.fn();
    render(
      <LibraryScreen
        collections={[sampleCollection]}
        localEntries={[localEntry]}
        onPlay={onPlay}
      />,
    );
    expect(screen.getByText("Weekend watch")).toBeTruthy();
    expect(screen.getByText("holiday.mp4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play holiday.mp4" }));
    expect(onPlay).toHaveBeenCalledWith(localEntry);
  });

  it("shows honest empty states when the library is genuinely empty", () => {
    render(<LibraryScreen />);
    expect(screen.getByTestId("library-collections-empty").textContent).toMatch(
      /no collections yet/i,
    );
    expect(screen.getByTestId("library-local-empty").textContent).toMatch(/no local files yet/i);
  });
});

// ---------- AccountsScreen ----------

describe("AccountsScreen", () => {
  it("renders per-provider cards for every honest account state", () => {
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <AccountsScreen
        accounts={[connectedAccount, expiredAccount, revokedAccount]}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />,
    );

    expect(screen.getByTestId("account-card-connected").textContent).toContain("Connected");
    expect(screen.getByTestId("account-card-expired").textContent).toContain("Expired");
    expect(screen.getByTestId("account-card-revoked").textContent).toContain("Revoked");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledWith("acc-1");

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(onConnect).toHaveBeenCalledWith("youtube");

    // The revoked card's action is labelled exactly 'Connect'.
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith("youtube");
  });

  it("offers a truthful not-connected card with a Connect action", () => {
    const onConnect = vi.fn();
    render(<AccountsScreen accounts={[]} onConnect={onConnect} />);
    expect(screen.getByTestId("account-card-not-connected-youtube").textContent).toMatch(
      /not connected/i,
    );
    fireEvent.click(screen.getByTestId("connect-youtube"));
    expect(onConnect).toHaveBeenCalledWith("youtube");
  });
});

// ---------- honest-state vocabulary + theme ----------

describe("honest-state vocabulary (freeze §2.3)", () => {
  it("maps every CapabilityStatus onto the vocabulary — unknown → status-unknown", () => {
    const statuses: CapabilityStatus[] = [
      { kind: "available" },
      { kind: "requires-auth", providerId: "youtube" },
      { kind: "rate-limited", providerId: "youtube", retryAfterSeconds: 30 },
      { kind: "unsupported", providerId: "youtube", reason: "no search API in M1" },
      { kind: "unavailable", reason: "upstream 500" },
      { kind: "unknown", detail: "capability probe timed out" },
    ];
    expect(statuses.map(toHonestState)).toEqual([
      "ready",
      "requires-auth",
      "rate-limited",
      "unsupported",
      "unavailable",
      "status-unknown",
    ]);
  });

  it('unknown renders as "Status unknown" and still offers a recovery action — never a dead end', () => {
    expect(HONEST_COPY["status-unknown"].title).toBe("Status unknown");
    expect(HONEST_COPY["status-unknown"].actionLabel).toBe("Check again");
  });

  it("describeCapability surfaces the provider reason verbatim", () => {
    const described = describeCapability({
      kind: "unsupported",
      providerId: "youtube",
      reason: "no search API in M1",
    });
    expect(described.state).toBe("unsupported");
    expect(described.detail).toBe("no search API in M1");
  });

  it("searchStateFromCapability keeps search honest for available-but-empty probes", () => {
    expect(searchStateFromCapability("donut", { kind: "available" }, []).phase).toBe("empty");
    expect(searchStateFromCapability("donut", { kind: "available" }, [catalogItem()]).phase).toBe(
      "results",
    );
    expect(searchStateFromCapability("donut", { kind: "unknown", detail: "x" }).phase).toBe(
      "status-unknown",
    );
  });
});

describe("theme", () => {
  it("the WebFlix identity is present and visibly not YouTube", () => {
    expect(theme.name).toBe("WebFlix");
    expect(theme.colors.accent.toLowerCase()).not.toBe("#ff0000");
    expect(theme.notice.text).toMatch(/independent/i);
    expect(theme.notice.text).toMatch(/not affiliated/i);
  });
});
