// @vitest-environment jsdom
//
// D1 shell component tests (webflix-shell).
// The jsdom docblock above is mandatory: the package-local vitest.config.ts
// defaults to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// MIRROR-RECON (2026-10-11): fixtures rewritten against the FROZEN §2 shapes
// (canonical ProviderAccountRecord with internalAccountId/status/grantedScopes,
// canonical CatalogItem with mediaKind, canonical Collection with entryIds,
// canonical PlaybackPlan union, canonical OperationCapability) with every
// behavioral intent preserved.

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
  CatalogItem,
  CapabilityStatus,
  Collection,
  PlaybackPlan,
  ProviderAccountRecord,
  SearchBudgetView,
} from "../src/index";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures ----------

const ISO = "2026-01-01T00:00:00Z";

function catalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: "yt-donut",
    title: "Blender donut tutorial",
    providerId: "youtube",
    mediaKind: "video",
    assets: [],
    metadata: {},
    ...overrides,
  };
}

const connectedAccount: ProviderAccountRecord = {
  providerId: "youtube",
  internalAccountId: "acc-1",
  displayName: "me@example.com",
  grantedScopes: ["youtube.readonly"],
  status: "connected",
  connectedAt: ISO,
  expiresAt: "2027-01-01T00:00:00Z",
};

const expiredAccount: ProviderAccountRecord = {
  providerId: "youtube",
  internalAccountId: "acc-2",
  displayName: "stale@example.com",
  grantedScopes: [],
  status: "expired",
  connectedAt: ISO,
};

const revokedAccount: ProviderAccountRecord = {
  providerId: "youtube",
  internalAccountId: "acc-3",
  displayName: "revoked@example.com",
  grantedScopes: [],
  status: "revoked",
  connectedAt: ISO,
};

const sampleCollection: Collection = {
  id: "col-1",
  name: "Weekend watch",
  kind: "manual",
  entryIds: ["yt-donut", "yt-spline"],
  createdAt: ISO,
  updatedAt: ISO,
};

const localEntry: CatalogItem = catalogItem({
  id: "loc-holiday",
  title: "holiday.mp4",
  providerId: "local",
  mediaKind: "local-file",
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

  it("lists results with the canonical mediaKind and plays a selected item", () => {
    const onSelectItem = vi.fn();
    render(
      <SearchScreen
        state={{ phase: "results", query: "donut", items: [catalogItem()] }}
        onSelectItem={onSelectItem}
      />,
    );
    expect(screen.getByTestId("search-results").textContent).toContain("Blender donut tutorial");
    expect(screen.getByTestId("search-results").textContent).toContain("video");
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

  it("rate-limited says so, surfaces the reset detail and offers retry — never fake results", () => {
    const onRetry = vi.fn();
    render(
      <SearchScreen
        state={{
          phase: "rate-limited",
          query: "donut",
          // §2.3: the reset hint arrives as OperationCapability.detail text.
          detail: "Quota should reset in about 90s.",
        }}
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

  it("unsupported renders the unsupported panel with the detail and no dead play control", () => {
    render(
      <SearchScreen
        state={{
          phase: "unsupported",
          query: "donut",
          detail: "This provider has no search API in M1.",
        }}
      />,
    );
    const panel = screen.getByTestId("search-unsupported");
    expect(panel.textContent).toMatch(/unsupported/i);
    expect(panel.textContent).toContain("This provider has no search API in M1.");
    // Honest by design: 'unsupported' must NOT render a playable/dead control.
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });

  it("degraded shows partial results flagged as degraded — never dressed up as ready", () => {
    render(<SearchScreen state={{ phase: "degraded", query: "donut", items: [catalogItem()] }} />);
    const panel = screen.getByTestId("search-degraded");
    expect(panel.textContent).toMatch(/degraded/i);
    expect(panel.textContent).toContain("Blender donut tutorial");
    // Partial results are still playable — the flag is honest, not a dead end.
    expect(screen.getByRole("button", { name: "Play Blender donut tutorial" })).toBeTruthy();
  });

  it('status-unknown renders "Status unknown" (freeze §2.3) rather than guessing', () => {
    render(<SearchScreen state={{ phase: "status-unknown", query: "donut" }} />);
    expect(screen.getByTestId("search-status-unknown").textContent).toContain("Status unknown");
  });
});

// ---------- WatchScreen ----------

describe("WatchScreen", () => {
  it("renders the official embed for an official-embed plan (§2.2 canonical)", () => {
    const plan: PlaybackPlan = {
      kind: "official-embed",
      providerId: "youtube",
      embedSpec: {
        videoId: "abc123",
        embedUrl: "https://www.youtube.com/embed/abc123",
      },
    };
    render(<WatchScreen title="Blender donut tutorial" plan={plan} />);
    const frame = screen.getByTestId("watch-embed") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("https://www.youtube.com/embed/abc123");
    expect(screen.getByText("Blender donut tutorial")).toBeTruthy();
    expect(screen.queryByTestId("watch-unavailable")).toBeNull();
  });

  it("renders a local file player for a local-file plan (§2.2 canonical)", () => {
    const plan: PlaybackPlan = {
      kind: "local-file",
      path: "file:///home/z/Videos/holiday.mp4",
      mimeType: "video/mp4",
    };
    render(<WatchScreen title="holiday.mp4" plan={plan} />);
    const player = screen.getByTestId("watch-local-player") as HTMLVideoElement;
    expect(player.tagName).toBe("VIDEO");
    expect(player.getAttribute("src")).toBe("file:///home/z/Videos/holiday.mp4");
    expect(screen.queryByTestId("watch-embed")).toBeNull();
  });

  it("renders the unavailable panel with the frozen reason + recovery hint — no player, no dead button", () => {
    const plan: PlaybackPlan = {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: "The uploader disabled embedding for this title.",
      },
    };
    render(<WatchScreen title="Blender donut tutorial" plan={plan} />);
    const panel = screen.getByTestId("watch-unavailable");
    expect(panel.textContent).toContain("unsupported");
    expect(panel.textContent).toContain("The uploader disabled embedding for this title.");
    expect(screen.queryByTestId("watch-embed")).toBeNull();
    expect(screen.queryByTestId("watch-local-player")).toBeNull();
    // No onClose wired → no Back control; nothing on screen is dead.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a Back control only when a close handler is provided", () => {
    const plan: PlaybackPlan = {
      kind: "unavailable",
      reason: "region",
      recovery: { action: "change-region", message: "do this" },
    };
    const onClose = vi.fn();
    const { rerender } = render(<WatchScreen title="T" plan={plan} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<WatchScreen title="T" plan={plan} />);
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
    expect(screen.getByText("2 items")).toBeTruthy();
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

  it("shows the granted scopes and grant expiry from the canonical record", () => {
    render(<AccountsScreen accounts={[connectedAccount]} />);
    const card = screen.getByTestId("account-card-connected");
    expect(card.textContent).toContain("youtube.readonly");
    expect(card.textContent).toContain("2027-01-01T00:00:00Z");
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
  it("maps every frozen CapabilityStatus onto the vocabulary — unknown → status-unknown, degraded stays distinct", () => {
    const statuses: CapabilityStatus[] = [
      "supported",
      "requires-auth",
      "rate-limited",
      "unsupported",
      "unavailable",
      "degraded",
      "unknown",
    ];
    expect(statuses.map(toHonestState)).toEqual([
      "ready",
      "requires-auth",
      "rate-limited",
      "unsupported",
      "unavailable",
      "degraded",
      "status-unknown",
    ]);
  });

  it('unknown renders as "Status unknown" and still offers a recovery action — never a dead end', () => {
    expect(HONEST_COPY["status-unknown"].title).toBe("Status unknown");
    expect(HONEST_COPY["status-unknown"].actionLabel).toBe("Check again");
  });

  it("describeCapability surfaces the operation detail verbatim", () => {
    const described = describeCapability({
      status: "unsupported",
      detail: "no search API in M1",
    });
    expect(described.state).toBe("unsupported");
    expect(described.detail).toBe("no search API in M1");
  });

  it("searchStateFromCapability keeps search honest for supported-but-empty probes", () => {
    expect(searchStateFromCapability("donut", "youtube", { status: "supported" }, []).phase).toBe(
      "empty",
    );
    expect(
      searchStateFromCapability("donut", "youtube", { status: "supported" }, [catalogItem()]).phase,
    ).toBe("results");
    expect(
      searchStateFromCapability("donut", "youtube", { status: "unknown", detail: "x" }).phase,
    ).toBe("status-unknown");
  });

  it("searchStateFromCapability wires the requires-auth connect action to the searched provider", () => {
    const state = searchStateFromCapability("donut", "youtube", { status: "requires-auth" });
    expect(state.phase).toBe("requires-auth");
    if (state.phase === "requires-auth") {
      expect(state.providerId).toBe("youtube");
    }
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

// ---------------------------------------------------------------------------
// YOUTUBE-EXPAND — honest quota surfacing + the connector-shaped watch plan
// ---------------------------------------------------------------------------

describe("SearchScreen: remaining-quota surfacing (YOUTUBE-EXPAND row 1)", () => {
  it("renders the budget line next to results (ok state)", () => {
    render(
      <SearchScreen
        state={{
          phase: "results",
          query: "donut",
          items: [catalogItem()],
          budget: {
            state: "ok",
            unitsRemainingToday: 9_900,
            unitsLimitToday: 10_000,
            searchCallsRemainingToday: 99,
            providerReportedExhaustion: false,
          },
        }}
      />,
    );
    const budget = screen.getByTestId("search-budget");
    expect(budget.textContent).toContain("99 searches left today");
    // budgetLine renders raw numbers (no locale formatting) — pinned here so
    // the format contract between states.ts and the screen stays explicit.
    expect(budget.textContent).toContain("9900 of 10000");
  });

  it("warns plainly in the low state and explains exhaustion in the rate-limited state", () => {
    const { rerender } = render(
      <SearchScreen
        state={{
          phase: "results",
          query: "donut",
          items: [catalogItem()],
          budget: {
            state: "low",
            unitsRemainingToday: 300,
            unitsLimitToday: 10_000,
            searchCallsRemainingToday: 3,
            providerReportedExhaustion: false,
          },
        }}
      />,
    );
    expect(screen.getByTestId("search-budget").textContent).toContain("running low");
    expect(screen.getByTestId("search-budget").textContent).toContain("3 searches");

    rerender(
      <SearchScreen
        state={{
          phase: "rate-limited",
          query: "donut",
          detail: "quota exhausted",
          budget: {
            state: "exhausted",
            unitsRemainingToday: 0,
            unitsLimitToday: 10_000,
            searchCallsRemainingToday: 0,
            providerReportedExhaustion: true,
          },
        }}
      />,
    );
    const exhausted = screen.getByTestId("search-budget").textContent ?? "";
    expect(exhausted).toContain("exhausted");
    expect(exhausted).toContain("the provider reported it");
  });

  it("renders no budget line when no snapshot was provided (nothing invented)", () => {
    render(<SearchScreen state={{ phase: "results", query: "donut", items: [catalogItem()] }} />);
    expect(screen.queryByTestId("search-budget")).toBeNull();
  });

  it("searchStateFromCapability carries the budget into the quota-relevant phases", () => {
    const budget: SearchBudgetView = {
      state: "ok",
      unitsRemainingToday: 9_900,
      unitsLimitToday: 10_000,
      searchCallsRemainingToday: 99,
      providerReportedExhaustion: false,
    };
    const results = searchStateFromCapability(
      "donut",
      "youtube",
      { status: "supported" },
      [catalogItem()],
      budget,
    );
    expect(results).toMatchObject({ phase: "results", budget });

    const empty = searchStateFromCapability(
      "donut",
      "youtube",
      { status: "supported" },
      [],
      budget,
    );
    expect(empty).toMatchObject({ phase: "empty", budget });

    // rate-limited capability (as the connectors' searchCapabilityFromError
    // produces for QuotaExceededError/RateLimitedError) + exhausted budget.
    const limited = searchStateFromCapability(
      "donut",
      "youtube",
      { status: "rate-limited", detail: "blocked locally" },
      undefined,
      {
        state: "exhausted",
        unitsRemainingToday: 0,
        unitsLimitToday: 10_000,
        searchCallsRemainingToday: 0,
        providerReportedExhaustion: false,
      },
    );
    expect(limited).toMatchObject({ phase: "rate-limited" });
    expect(limited).toHaveProperty("budget.state", "exhausted");
  });
});

describe("WatchScreen: the connector-built official-embed plan (YOUTUBE-EXPAND row 2)", () => {
  it("renders the exact plan shape the youtube connector builder emits", () => {
    // Verbatim shape of buildYouTubePlaybackPlan output (privacy-enhanced
    // domain, playerVars folded into embedUrl, iframe attribute bundle) —
    // the shell may not import the connectors package (architecture-policy),
    // so the continuity contract is the canonical §2.2 shape itself, and the
    // connectors suite pins the builder side of it.
    const plan: PlaybackPlan = {
      kind: "official-embed",
      providerId: "youtube",
      embedSpec: {
        videoId: "FIXVID00001",
        embedUrl:
          "https://www.youtube-nocookie.com/embed/FIXVID00001?autoplay=0&controls=1&rel=0&playsinline=1",
        domain: "youtube-nocookie.com",
        playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1 },
        iframe: {
          width: 560,
          height: 315,
          title: "Fixture: container gardening basics",
          allow:
            "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
          allowFullScreen: true,
          referrerPolicy: "strict-origin-when-cross-origin",
          style: "border: 0;",
        },
        notes: [
          "Official IFrame embed only (ADR-0003); no stream extraction or signature deciphering.",
          "No origin supplied: the IFrame JS API is not enabled (enablejsapi requires a pinned origin in this design).",
          "Privacy-enhanced mode (youtube-nocookie.com) is the official embed domain variant.",
        ],
        provenance: [
          {
            label: "YouTube IFrame Player API reference (official)",
            url: "https://developers.google.com/youtube/iframe_api_reference",
          },
        ],
      },
    };
    render(<WatchScreen title="Fixture: container gardening basics" plan={plan} />);
    const frame = screen.getByTestId("watch-embed") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/FIXVID00001?autoplay=0&controls=1&rel=0&playsinline=1",
    );
    expect(frame.getAttribute("title")).toBe(
      "Fixture: container gardening basics — official embed",
    );
    expect(screen.getByText(/never wraps scraped streams/)).toBeTruthy();
  });
});
