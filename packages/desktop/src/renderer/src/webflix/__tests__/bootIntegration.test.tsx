// @vitest-environment jsdom
//
// WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the integrated host pins:
// the media producers wired into the shell, the honest phase mapping from
// the producers' budgetNote vocabulary, and the typed UI-action bridge
// dispatching through the SAME handlers the UI buttons use (freeze §9.1).
// Every producer here is a FIXTURE DOUBLE (labelled; the real live path is
// gated on the operator's Data API key — those gates stay BLOCKED).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { WebFlixHost } from "../boot.js";
import { createLocalLibrarySession } from "../localLibrarySession.js";
import type { WebFlixAccountsBridge, WebFlixAccountsStatus } from "../accountsBridge.js";
import type { YouTubeMediaProducers } from "../../../../../../webflix-application/src/media/youtube-media-composition.js";
import type {
  ChannelView,
  HomeFeedView,
  SearchPageData,
  ShortsView,
  SubscriptionsView,
  TrendingView,
  HistoryView,
} from "../../../../../../webflix-contracts/src/media-views.js";

afterEach(cleanup);

const FIXTURE_LABEL = "fixture-labelled";

function fixtureCatalogItem(id: string, title: string, mediaKind: "video" | "short" = "video") {
  const videoId = id.replace("youtube-video-", "");
  return {
    id,
    providerId: "youtube",
    title,
    mediaKind,
    assets: [],
    // The canonical catalogMapping shape (externalIds.youtube).
    metadata: { externalIds: { youtube: videoId } },
  };
}

function fixtureCard(id: string, title: string, mediaKind: "video" | "short" = "video") {
  return {
    item: fixtureCatalogItem(id, title, mediaKind),
    title,
    channelTitle: "Fixture Channel",
    durationLabel: "10:00",
    viewsLabel: "1 view",
    publishedLabel: "1 hour ago",
    badges: [],
  };
}

// Valid 11-char YouTube-style ids (the watch-plan resolver only plays
// items whose metadata.videoId matches the official 11-char pattern).
const FIXTURE_ID_1 = "youtube-video-fixturevid1";
const FIXTURE_ID_2 = "youtube-video-fixturevid2";
const FIXTURE_ID_SHORT = "youtube-video-fixtureshrt";
const FIXTURE_ID_NEW = "youtube-video-fixturenew";

/** A FIXTURE producers double: deterministic typed outcomes per scenario. */
function fixtureProducers(scenario: "ok" | "requires-auth" | "ambiguous"): YouTubeMediaProducers {
  const requiresAuthDetail =
    "No official YouTube Data API v3 key is configured (fixture requires-auth path).";
  const searchPage: SearchPageData =
    scenario === "ok"
      ? {
          query: "mrbeast",
          videos: [
            fixtureCard(FIXTURE_ID_1, "Fixture video 1"),
            fixtureCard(FIXTURE_ID_2, "Fixture video 2"),
          ],
          channels: [
            {
              channelId: "UCfixturechannel",
              title: "MrBeast (fixture)",
              handle: "@MrBeast",
              verified: true,
            },
          ],
          nextCursor: null,
          budgetNote: `${FIXTURE_LABEL} quota snapshot`,
        }
      : {
          query: "mrbeast",
          videos: [],
          channels: [],
          nextCursor: null,
          budgetNote: `YouTube search requires an official Data API v3 key — none is configured (requires-auth). ${requiresAuthDetail}`,
        };
  const homeFeed: HomeFeedView =
    scenario === "ok"
      ? {
          phase: "ready",
          chips: ["All", "Music"],
          selectedChip: "All",
          sections: [
            {
              kind: "video-grid",
              sectionId: "trending",
              title: "Trending (fixture)",
              videos: [fixtureCard(FIXTURE_ID_1, "Fixture video 1")],
              layout: "grid",
            },
            {
              kind: "shorts-shelf",
              sectionId: "shorts",
              shorts: [fixtureCard(FIXTURE_ID_SHORT, "Fixture short", "short")],
            },
          ],
          nextCursor: null,
          compositionNote: `${FIXTURE_LABEL} compose: trending + local history`,
        }
      : { phase: "requires-auth", detail: requiresAuthDetail };
  return {
    homeFeed: {
      async getHomeFeed() {
        return homeFeed;
      },
      async getHomeFeedAppend() {
        return homeFeed;
      },
    },
    searchPage: {
      async searchPage(query: string) {
        return { ...searchPage, query };
      },
    },
    channel: {
      async channel(): Promise<ChannelView> {
        return {
          channel: { channelId: "UCfixturechannel", title: "MrBeast (fixture)", verified: true },
          availableTabs: ["videos"],
          videos: [fixtureCard(FIXTURE_ID_1, "Fixture video 1")],
          shorts: [],
          nextCursor: null,
          phase: "ready",
        };
      },
      async channelAppend(): Promise<ChannelView> {
        throw new Error("not used");
      },
    },
    trending: {
      async trending(): Promise<TrendingView> {
        return {
          region: "US",
          chips: [],
          selectedChip: null,
          videos: [],
          nextCursor: null,
          phase: scenario === "ok" ? "ready" : "requires-auth",
          ...(scenario !== "ok" ? { detail: requiresAuthDetail } : {}),
        };
      },
    },
    shorts: {
      async shorts(): Promise<ShortsView> {
        return { shorts: [], nextCursor: null, phase: "ready" };
      },
    },
    subscriptions: {
      async subscriptions(): Promise<SubscriptionsView> {
        return { channels: [], videos: [], phase: "requires-auth", detail: requiresAuthDetail };
      },
    },
    history: {
      async history(): Promise<HistoryView> {
        return { groups: [], phase: "ready" };
      },
    },
    channelResolution: {
      async resolveChannel(query: string) {
        if (scenario === "requires-auth") {
          return { kind: "unavailable" as const, phase: "requires-auth" as const, detail: requiresAuthDetail };
        }
        // Query-aware (the ambiguity law): an exact handle reference
        // resolves; a bare ambiguous name asks the user.
        if (!query.trim().startsWith("@")) {
          return {
            kind: "ambiguous" as const,
            candidates: [
              { channelId: "UC1", title: "MrBeast", subscriberLabel: "346M subscribers" },
              { channelId: "UC2", title: "MrBeast 2", subscriberLabel: "12 subscribers" },
            ],
          };
        }
        return {
          kind: "resolved" as const,
          channel: {
            channelId: "UCX6OQ3DkcsbYNE6H8uQQuVA",
            title: "MrBeast (fixture)",
            handle: "@MrBeast",
            verified: true,
          },
          uploads: [
            fixtureCard(FIXTURE_ID_NEW, "Newest fixture upload"),
            fixtureCard(FIXTURE_ID_1, "Older fixture upload"),
          ],
        };
      },
    },
  };
}

function fakeLocalLibrary() {
  let counter = 0;
  return createLocalLibrarySession({
    createObjectUrl: (file: File) => `blob:webflix-test/${file.name}`,
    resolveOsPath: () => null,
    mintId: () => `integration-test-${++counter}`,
  });
}

function availableAccountsBridge(): WebFlixAccountsBridge {
  return {
    getStatus: async (): Promise<WebFlixAccountsStatus> => ({
      vault: { available: true, reason: null },
      accounts: [],
    }),
    connect: async () => ({
      ok: false,
      code: "connect-unavailable" as const,
      reason: "Connect is not available in this build — nothing was authorized.",
    }),
    disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
  };
}

function renderIntegratedHost(scenario: "ok" | "requires-auth" | "ambiguous") {
  const producers = fixtureProducers(scenario);
  return render(
    <WebFlixHost
      accountsBridge={availableAccountsBridge()}
      createLocalLibrary={fakeLocalLibrary}
      resolveOsPath={() => null}
      appVersion="9.9.9-integration-test"
      createMediaProducers={async () => producers}
    />,
  );
}

describe("the integrated host wires the media producers into the shell (fixture-labelled)", () => {
  it("the home feed renders from the producer's sections model", async () => {
    renderIntegratedHost("ok");
    await waitFor(() => {
      expect(screen.getByTestId("home-feed-root")).toBeTruthy();
    });
    expect(screen.getByTestId("home-composition-note").textContent).toContain(
      "fixture-labelled compose",
    );
    expect(screen.getByTestId("home-section-trending").textContent).toContain("Trending (fixture)");
    expect(screen.getByTestId(`video-card-${FIXTURE_ID_1}`)).toBeTruthy();
    expect(screen.getByTestId(`shorts-tile-${FIXTURE_ID_SHORT}`)).toBeTruthy();
  });

  it("the honest requires-auth phase surfaces from the producers' budgetNote vocabulary", async () => {
    renderIntegratedHost("requires-auth");
    fireEvent.click(screen.getByTestId("nav-search"));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "mrbeast" },
    });
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);
    await waitFor(() => {
      expect(screen.getByTestId("search-requires-auth")).toBeTruthy();
    });
  });

  it("a producer-backed keyword search renders real card results", async () => {
    renderIntegratedHost("ok");
    // Wait for the producers to be ready (the home feed proves it) BEFORE
    // submitting — a submit that races the producer build honestly lands
    // the legacy requires-auth state instead.
    await waitFor(() => {
      expect(screen.getByTestId("home-feed-root")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("nav-search"));
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "mrbeast" },
    });
    fireEvent.submit(screen.getByTestId("search-input").closest("form")!);
    await waitFor(() => {
      expect(screen.getByTestId("search-results")).toBeTruthy();
    });
    expect(screen.getByTestId(`video-card-${FIXTURE_ID_1}`)).toBeTruthy();
    expect(screen.getByTestId("search-channels").textContent).toContain("MrBeast (fixture)");
  });

  it("playing a card mounts the persistent watch dock with the official embed", async () => {
    renderIntegratedHost("ok");
    await waitFor(() => {
      expect(screen.getByTestId(`video-card-${FIXTURE_ID_1}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`video-card-${FIXTURE_ID_1}-play`));
    await waitFor(() => {
      expect(screen.getByTestId("watch-dock")).toBeTruthy();
    });
    expect(screen.getByTestId("watch-embed").getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/fixturevid1",
    );
  });
});

describe("the typed UI-action bridge dispatches through the same handlers (fixture-labelled)", () => {
  async function getBridge(scenario: "ok" | "requires-auth" | "ambiguous") {
    // Reset the e2e hook first — a previous test's bridge must never leak
    // into this one (the global survives React cleanup).
    delete (globalThis as { __webflixWfxE2e?: unknown }).__webflixWfxE2e;
    const producers = fixtureProducers(scenario);
    let bridge: { dispatch: (action: unknown) => Promise<unknown>; trace: { export(): unknown[] } } | null =
      null;
    const workspaceBridgeDouble = {
      ensureWorkspace: async () => ({
        ok: true,
        workspacePath: "/tmp/webflix-test-workspace",
        dataRoot: "/tmp/webflix-test-root",
        nodeCommand: "node",
        nodeArgs: ["/tmp/webflix-test-workspace/webflix-ui-mcp.mjs"],
      }),
      writeConfigs: async () => ({ ok: true }),
      getYouTubeApiKey: async () => ({ key: null, source: null }),
    };
    render(
      <WebFlixHost
        accountsBridge={availableAccountsBridge()}
        createLocalLibrary={fakeLocalLibrary}
        resolveOsPath={() => null}
        appVersion="9.9.9-bridge-test"
        createMediaProducers={async () => producers}
        agentWorkspaceBridge={workspaceBridgeDouble as never}
      />,
    );
    // The bridge exposes itself through the e2e hook once the panel opens.
    fireEvent.click(screen.getByTestId("agent-panel-toggle"));
    await waitFor(() => {
      const target = globalThis as { __webflixWfxE2e?: { bridge?: unknown } };
      expect(target.__webflixWfxE2e?.bridge).toBeTruthy();
    });
    bridge = (globalThis as { __webflixWfxE2e?: { bridge?: typeof bridge } }).__webflixWfxE2e
      ?.bridge as never;
    return bridge;
  }

  it("searchCatalog answers ok with typed items and the route follows", async () => {
    const bridge = await getBridge("ok");
    const result = (await bridge.dispatch({ action: "searchCatalog", query: "mrbeast" })) as {
      kind: string;
      items: { itemId: string; title: string }[];
      channels: { channelId: string; title: string }[];
    };
    expect(result.kind).toBe("ok");
    expect(result.items.map((item) => item.itemId)).toContain(FIXTURE_ID_1);
    expect(result.channels[0]?.title).toBe("MrBeast (fixture)");
    await waitFor(() => {
      expect(screen.getByTestId("search-results")).toBeTruthy();
    });
  });

  it("resolveChannel: resolved + newest-first uploads with evidence; ambiguous asks the user", async () => {
    const bridge = await getBridge("ok");
    const resolved = (await bridge.dispatch({ action: "resolveChannel", query: "@MrBeast" })) as {
      kind: string;
      channels: { channelId: string }[];
      items: { itemId: string }[];
      evidence: string[];
    };
    expect(resolved.kind).toBe("ok");
    expect(resolved.channels[0]?.channelId).toBe("UCX6OQ3DkcsbYNE6H8uQQuVA");
    expect(resolved.items[0]?.itemId).toBe(FIXTURE_ID_NEW);
    expect(resolved.evidence[0]).toContain("Newest fixture upload");

    const ambiguous = (await bridge.dispatch({ action: "resolveChannel", query: "MrBeast" })) as {
      kind: string;
      prompt: string;
      choices: { id: string; label: string }[];
    };
    expect(ambiguous.kind).toBe("needs-user-choice");
    expect(ambiguous.choices.length).toBe(2);
  });

  it("playCatalogItem plays through the same path as the UI buttons; a hallucinated id fails typed", async () => {
    const bridge = await getBridge("ok");
    // Register items first (search registers them in the item registry).
    await bridge.dispatch({ action: "searchCatalog", query: "mrbeast" });
    const ok = (await bridge.dispatch({
      action: "playCatalogItem",
      itemId: FIXTURE_ID_1,
    })) as { kind: string; summary: string };
    expect(ok.kind).toBe("ok");
    expect(ok.summary).toContain("Fixture video 1");
    await waitFor(() => {
      expect(screen.getByTestId("watch-dock")).toBeTruthy();
    });
    expect(screen.getByTestId("watch-embed").getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/fixturevid1",
    );

    const failure = (await bridge.dispatch({
      action: "playCatalogItem",
      itemId: "youtube-video-hallucinated",
    })) as { kind: string; code: string };
    expect(failure.kind).toBe("failure");
    expect(failure.code).toBe("item-not-found");
  });

  it("getVisibleMediaContext answers from the host's own state (never a DOM scrape)", async () => {
    const bridge = await getBridge("ok");
    await bridge.dispatch({ action: "searchCatalog", query: "mrbeast" });
    await bridge.dispatch({ action: "playCatalogItem", itemId: FIXTURE_ID_1 });
    await waitFor(() => {
      expect(screen.getByTestId("watch-dock")).toBeTruthy();
    });
    const readResult = (await bridge.dispatch({ action: "getVisibleMediaContext" })) as unknown as {
      kind: string;
      context?: {
        route: string;
        playingItem: { itemId: string; title: string } | null;
        watchPlanKind: string | null;
        agentPanel: { visible: boolean };
      };
    };
    expect(readResult.kind).toBe("ok");
    const context = readResult.context;
    expect(context?.route).toBe("watch");
    expect(context?.playingItem?.itemId).toBe(FIXTURE_ID_1);
    expect(context?.watchPlanKind).toBe("official-embed");
    expect(context?.agentPanel.visible).toBe(true);
  });

  it("the requires-auth journey answers the typed unsupported result (the honest BLOCKED gate)", async () => {
    const bridge = await getBridge("requires-auth");
    const result = (await bridge.dispatch({ action: "resolveChannel", query: "MrBeast" })) as {
      kind: string;
      capability: string;
      reason: string;
    };
    expect(result.kind).toBe("unsupported");
    expect(result.capability).toBe("requires-auth");
    expect(result.reason).toContain("requires-auth");
  });

  it("the trace records every dispatched action (the acceptance evidence surface)", async () => {
    const bridge = await getBridge("ok");
    await bridge.dispatch({ action: "searchCatalog", query: "mrbeast" });
    const trace = bridge.trace.export() as { action: { action: string }; outcomeKind: string }[];
    expect(trace.length).toBeGreaterThanOrEqual(1);
    expect(trace[trace.length - 1]?.action.action).toBe("searchCatalog");
    expect(trace[trace.length - 1]?.outcomeKind).toBe("ok");
  });
});

describe("the agent workspace bootstrap honest states", () => {
  it("with NO workspace bridge the panel content renders the typed unavailable state", () => {
    render(
      <WebFlixHost
        accountsBridge={null}
        createLocalLibrary={fakeLocalLibrary}
        resolveOsPath={() => null}
        appVersion="9.9.9-panel-test"
        createMediaProducers={async () => fixtureProducers("ok")}
        agentWorkspaceBridge={null}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-panel-toggle"));
    expect(screen.getByTestId("agent-panel")).toBeTruthy();
    expect(screen.getByTestId("agent-panel-workspace-unavailable").textContent).toContain(
      "could not be prepared",
    );
  });
});
