// @vitest-environment jsdom
//
// WatchScreen upgrade tests (WFX-UX-SHELL-1, deliverable 6). The jsdom
// docblock above is mandatory. Run from the package:
// pnpm --filter webflix-shell test:components
//
// Pins, honestly (FIXTURE-ONLY: the card/queue/plan literals below are
// tests/fixtures.ts shapes — never live data):
// - the theater/normal toggle works when wired, and renders disabled WITH
//   its reason when the host wired no handler (never a dead control);
// - the metadata band renders the item's card facts verbatim, with a real
//   channel button only when the handler + channelId exist;
// - the honest action row: DEFAULT_WATCH_ACTIONS is the disabled-with-reason
//   trio (freeze §9.1 — no fake like/subscribe);
// - the related rail renders video cards with the shared play path;
// - the queue strip marks the now-playing entry and offers Play on the rest;
// - THE PERSISTENT PLAYER LAW (freeze §9.6): the player element (iframe /
//   local <video>) is the SAME DOM NODE across compact ↔ normal ↔ theater
//   variant flips — the shell never remounts playback on navigation;
// - the compact dock variant shows player + title + now-playing + close
//   only — no metadata/action/related chrome.

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_WATCH_ACTIONS, WatchScreen } from "../src/index";
import type { WatchQueueEntryView } from "../src/index";
import { FIXTURE_EMBED_PLAN, fixtureVideoCard } from "./fixtures";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

const LOCAL_PLAN = {
  kind: "local-file",
  path: "/media/fixture.mkv",
  mimeType: "video/x-matroska",
} as const;

const queue: readonly WatchQueueEntryView[] = [
  { card: fixtureVideoCard(), nowPlaying: true },
  {
    card: fixtureVideoCard({
      item: { ...fixtureVideoCard().item, id: "yt-queued-2" },
      title: "Queued fixture video",
    }),
    nowPlaying: false,
  },
];

const card = fixtureVideoCard();

describe("WatchScreen — the theater/normal toggle", () => {
  it("the wired toggle fires and relabels between theater and default", () => {
    const onToggleTheater = vi.fn();
    const first = render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} theater={false} onToggleTheater={onToggleTheater} />,
    );
    const toggle = screen.getByTestId("watch-theater-toggle");
    expect(toggle.textContent).toBe("Theater mode");
    fireEvent.click(toggle);
    expect(onToggleTheater).toHaveBeenCalledOnce();
    first.unmount();

    render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} theater={true} onToggleTheater={onToggleTheater} />,
    );
    expect(screen.getByTestId("watch-theater-toggle").textContent).toBe("Default view");
  });

  it("the unwired toggle renders disabled WITH its reason (never a dead control)", () => {
    render(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} theater={false} />);
    const toggle = screen.getByTestId("watch-theater-toggle");
    expect(toggle.hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("watch-theater-toggle-reason").textContent).toBe(
      "Layout switching is not wired by this host.",
    );
  });

  it("no theater prop + no handler = no toggle at all (the legacy contract)", () => {
    render(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} />);
    expect(screen.queryByTestId("watch-theater-toggle")).toBeNull();
  });
});

describe("WatchScreen — the metadata band (the item's card facts, verbatim)", () => {
  it("renders the channel, views/published, and the source line", () => {
    render(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} card={card} />);
    const band = screen.getByTestId("watch-metadata");
    expect(band.textContent).toContain("Fixture Channel");
    expect(band.textContent).toContain("1.2M views · 3 days ago");
    expect(band.textContent).toContain("Source: youtube · video");
  });

  it("the channel row is a real button only with handler + channelId", () => {
    const onOpenChannel = vi.fn();
    const first = render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} card={card} onOpenChannel={onOpenChannel} />,
    );
    fireEvent.click(screen.getByTestId("watch-metadata-channel"));
    expect(onOpenChannel).toHaveBeenCalledWith("chan-1");
    first.unmount();

    render(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} card={card} />);
    expect(screen.getByTestId("watch-metadata-channel").tagName).toBe("P");
  });
});

describe("WatchScreen — the honest action row (freeze §9.1 consent law)", () => {
  it("DEFAULT_WATCH_ACTIONS is the disabled-with-reason trio — no fake like/subscribe", () => {
    render(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} actions={DEFAULT_WATCH_ACTIONS} />);
    for (const action of DEFAULT_WATCH_ACTIONS) {
      const button = screen.getByTestId(`watch-action-${action.id}`);
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId(`watch-action-${action.id}-reason`).textContent).toContain(
        action.reason!,
      );
    }
    expect(screen.queryByTestId("watch-action-share")).toBeNull();
  });

  it("an available action fires only with a real handler", () => {
    const onAction = vi.fn();
    render(
      <WatchScreen
        title="Fixture"
        plan={FIXTURE_EMBED_PLAN}
        actions={[
          {
            id: "save",
            label: "Save",
            available: true,
            reason: "Saving to a WebFlix collection is not wired in this surface yet.",
          },
        ]}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByTestId("watch-action-save"));
    expect(onAction).toHaveBeenCalledWith("save");
  });
});

describe("WatchScreen — the related rail + queue strip", () => {
  it("the related rail renders 'Up next' cards with the shared play path", () => {
    const onPlayCard = vi.fn();
    const related = [fixtureVideoCard()];
    render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} related={related} onPlayCard={onPlayCard} />,
    );
    const rail = screen.getByTestId("watch-related");
    expect(rail.getAttribute("aria-label")).toBe("Related videos");
    expect(rail.textContent).toContain("Up next");
    fireEvent.click(screen.getByTestId("video-card-yt-item-1-play"));
    expect(onPlayCard).toHaveBeenCalledWith(fixtureVideoCard());
  });

  it("the queue strip marks now-playing and offers Play on the other entries", () => {
    const onPlayCard = vi.fn();
    render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} queue={queue} onPlayCard={onPlayCard} />,
    );
    expect(screen.getByTestId("watch-queue-now-playing-yt-item-1")).toBeTruthy();
    expect(screen.queryByTestId("watch-queue-now-playing-yt-queued-2")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Play Queued fixture video from the queue" }),
    );
    expect(onPlayCard).toHaveBeenCalledWith(queue[1].card);
  });
});

describe("WatchScreen — THE PERSISTENT PLAYER LAW (freeze §9.6)", () => {
  it("the embed iframe is the SAME DOM node across compact ↔ full ↔ theater flips", () => {
    const { rerender } = render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact={false} />,
    );
    const iframe = screen.getByTestId("watch-embed");
    expect(screen.getByTestId("watch-full-root")).toBeTruthy();

    // Navigate away from the watch route: the host flips to compact.
    rerender(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact={true} />);
    expect(screen.getByTestId("watch-compact-root")).toBeTruthy();
    expect(screen.getByTestId("watch-embed")).toBe(iframe);

    // Come back to the watch route: full layout again.
    rerender(<WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact={false} />);
    expect(screen.getByTestId("watch-full-root")).toBeTruthy();
    expect(screen.getByTestId("watch-embed")).toBe(iframe);

    // Theater mode: same player again.
    rerender(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact={false} theater={true} onToggleTheater={() => {}} />,
    );
    expect(screen.getByTestId("watch-embed")).toBe(iframe);
  });

  it("the local <video> element is the SAME DOM node across variant flips", () => {
    const { rerender } = render(<WatchScreen title="Fixture" plan={LOCAL_PLAN} compact={false} />);
    const video = screen.getByTestId("watch-local-player");
    rerender(<WatchScreen title="Fixture" plan={LOCAL_PLAN} compact={true} />);
    expect(screen.getByTestId("watch-local-player")).toBe(video);
  });

  it("the player keeps its position when the panel-adjacent chrome changes (queue + related mount)", () => {
    const { rerender } = render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact={false} />,
    );
    const iframe = screen.getByTestId("watch-embed");
    rerender(
      <WatchScreen
        title="Fixture"
        plan={FIXTURE_EMBED_PLAN}
        compact={false}
        card={card}
        queue={queue}
        related={[fixtureVideoCard()]}
      />,
    );
    expect(screen.getByTestId("watch-embed")).toBe(iframe);
    expect(screen.getByTestId("watch-queue")).toBeTruthy();
    expect(screen.getByTestId("watch-related")).toBeTruthy();
  });
});

describe("WatchScreen — the compact dock variant (player + essentials only)", () => {
  it("renders the compact root with the player and the now-playing line", () => {
    render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact queue={queue} />,
    );
    expect(screen.getByTestId("watch-compact-root")).toBeTruthy();
    expect(screen.getByTestId("watch-embed")).toBeTruthy();
    expect(screen.getByTestId("watch-dock-now-playing").textContent).toContain(
      "Now playing in your queue: Fixture video",
    );
    // No full-surface chrome in the dock.
    expect(screen.queryByTestId("watch-metadata")).toBeNull();
    expect(screen.queryByTestId("watch-action-row")).toBeNull();
    expect(screen.queryByTestId("watch-related")).toBeNull();
    expect(screen.queryByTestId("watch-queue")).toBeNull();
  });

  it("the dock's close control fires onClose (a real handler, never dead)", () => {
    const onClose = vi.fn();
    render(
      <WatchScreen title="Fixture" plan={FIXTURE_EMBED_PLAN} compact onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId("watch-dock-close"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("WatchScreen — the unavailable plan stays honest (legacy contract preserved)", () => {
  it("renders the typed reason + recovery + Back only when wired", () => {
    const onClose = vi.fn();
    const first = render(
      <WatchScreen
        title="Fixture"
        plan={{
          kind: "unavailable",
          reason: "requires-auth",
          recovery: { action: "sign-in", message: "Connect your account to watch this." },
        }}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId("watch-unavailable-reason").textContent).toContain("requires-auth");
    expect(screen.getByTestId("watch-unavailable-recovery").textContent).toContain(
      "Connect your account to watch this.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledOnce();
    first.unmount();

    render(
      <WatchScreen
        title="Fixture"
        plan={{ kind: "unavailable", reason: "region" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
