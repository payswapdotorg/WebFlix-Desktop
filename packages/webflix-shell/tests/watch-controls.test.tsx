// @vitest-environment jsdom
//
// WatchScreen player-controls strip tests (P7-COMPOSE-1 — the WF-006 surface
// half, mounting the MERGED P7-PLAYER-1 typed ControlsAvailability matrix
// AS-IS). The jsdom docblock above is mandatory: the package-local
// vitest.config.ts defaults to the node environment, and these tests need a
// DOM. Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the strip is driven by a ControlsAvailability-SHAPED prop (the shell's
//   structural PlayerControlsView — the playback package's deriveControls()
//   output satisfies it as-is; the shell never imports the engine package,
//   per the architecture-policy dependency rules);
// - every one of the seven controls renders its TYPED state: available with
//   the capability facts that back it, unavailable with its typed reason
//   AND the engine's own detail sentence, verbatim;
// - NO dead controls: the strip renders zero buttons — no command handlers
//   exist at this surface (the hosts wire commands in their own rows), so
//   nothing interactive is ever faked;
// - mini-player / PiP render declared-unavailable by default with the
//   host-surface-not-declared reason (the engine's own honest default when
//   the host declared no floating surfaces);
// - the seek row states the known bound, or the explicit unknown — never a
//   fabricated one;
// - FIXTURE-ONLY: the control models below are shell-local literals that
//   MIRROR the engine's published 5x7 matrix and detail sentences verbatim
//   (packages/playback/src/controls.ts); the engine's own battery pins the
//   derivation — these tests pin the RENDERING.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { WatchScreen } from "../src/index";
import type { PlaybackPlan, PlayerControlsView } from "../src/index";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures (the engine's deriveControls outputs, mirrored verbatim) ----------

const LOCAL_PLAN: PlaybackPlan = {
  kind: "local-file",
  path: "/media/library/The.Async.Adventure.mkv",
  mimeType: "video/x-matroska",
};

const EMBED_PLAN: PlaybackPlan = {
  kind: "official-embed",
  providerId: "streamo",
  embedSpec: {
    urlTemplate: "https://play.streamo.test/embed/{mediaId}?autoplay=0",
    externalId: "ext-77",
    embedUrl: "https://play.streamo.test/embed/ext-77?autoplay=0",
  },
};

/** deriveControls(LOCAL_PLAN, { durationMs: 42_000 }) — mirrored verbatim. */
const LOCAL_CONTROLS: PlayerControlsView = {
  planKind: "local-file",
  playPause: { state: "available", facts: ["webflix-owned-playback"] },
  seek: { state: "available", facts: ["webflix-owned-playback"], boundMs: 42_000 },
  volume: { state: "available", facts: ["webflix-owned-playback"] },
  captions: {
    state: "unavailable",
    reason: "no-declared-caption-track",
    detail:
      "The local-file plan declares no caption track; captions stay a typed unavailable state until one is declared.",
  },
  queueAdd: { state: "available", facts: ["in-app-playable-plan"] },
  miniPlayer: {
    state: "unavailable",
    reason: "host-surface-not-declared",
    detail:
      'The host has not declared a mini-player surface for "local-file" playback; it defaults to unavailable rather than claiming integration.',
  },
  pip: {
    state: "unavailable",
    reason: "host-surface-not-declared",
    detail:
      'The host has not declared a picture-in-picture surface for "local-file" playback; it defaults to unavailable rather than claiming integration.',
  },
};

/** deriveControls(EMBED_PLAN) — mirrored verbatim (provider-governed refusals). */
const EMBED_CONTROLS: PlayerControlsView = {
  planKind: "official-embed",
  playPause: {
    state: "unavailable",
    reason: "provider-governed-playback",
    detail:
      'The "streamo" embedded player owns play/pause; the plan declares no host-side control API.',
  },
  seek: {
    state: "unavailable",
    reason: "provider-governed-playback",
    detail:
      'The "streamo" embedded player owns seeking; the plan declares no host-side control API.',
  },
  volume: {
    state: "unavailable",
    reason: "provider-governed-playback",
    detail:
      'The "streamo" embedded player owns volume; the plan declares no host-side control API.',
  },
  captions: {
    state: "unavailable",
    reason: "provider-governed-playback",
    detail: 'Captions live inside the "streamo" embedded player and are not declared to the host.',
  },
  queueAdd: { state: "available", facts: ["in-app-playable-plan"] },
  miniPlayer: {
    state: "unavailable",
    reason: "host-surface-not-declared",
    detail:
      'The host has not declared a mini-player surface for "official-embed" playback; it defaults to unavailable rather than claiming integration.',
  },
  pip: {
    state: "unavailable",
    reason: "host-surface-not-declared",
    detail:
      'The host has not declared a picture-in-picture surface for "official-embed" playback; it defaults to unavailable rather than claiming integration.',
  },
};

const CONTROL_IDS = [
  "playPause",
  "seek",
  "volume",
  "captions",
  "queueAdd",
  "miniPlayer",
  "pip",
] as const;

// ---------- the strip ----------

describe("WatchScreen: the player-controls strip (WF-006 surface)", () => {
  it("renders the honest not-derived state when no controls model is passed", () => {
    render(<WatchScreen title="holiday.mp4" plan={LOCAL_PLAN} />);
    expect(screen.getByTestId("watch-controls")).toBeTruthy();
    expect(screen.getByTestId("watch-controls-empty").textContent).toContain(
      "No player-controls model has been derived for this plan yet",
    );
    expect(screen.queryByTestId("watch-controls-plankind")).toBeNull();
    // Nothing is invented in the meantime — no typed rows either.
    for (const id of CONTROL_IDS) {
      expect(screen.queryByTestId(`watch-control-${id}`)).toBeNull();
    }
  });

  it("every one of the seven controls renders its typed state for a local-file model", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    expect(screen.getByTestId("watch-controls-plankind").textContent).toContain("local-file");
    for (const id of CONTROL_IDS) {
      expect(screen.getByTestId(`watch-control-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId("watch-control-playPause").textContent).toContain("Available");
    expect(screen.getByTestId("watch-control-playPause").textContent).toContain(
      "webflix-owned-playback",
    );
    expect(screen.getByTestId("watch-control-volume").textContent).toContain("Available");
    expect(screen.getByTestId("watch-control-queueAdd").textContent).toContain(
      "in-app-playable-plan",
    );
  });

  it("the seek row states the KNOWN bound when the duration is known", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    const seek = screen.getByTestId("watch-control-seek");
    expect(seek.textContent).toContain("Available");
    expect(seek.textContent).toContain("Seek bound: 42000ms (the known item duration).");
  });

  it("the seek row states the honest UNKNOWN when no duration bound exists — never a fabricated one", () => {
    const unknownBound: PlayerControlsView = {
      ...LOCAL_CONTROLS,
      seek: { state: "available", facts: ["webflix-owned-playback"], boundMs: null },
    };
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={unknownBound} />);
    expect(screen.getByTestId("watch-control-seek").textContent).toContain(
      "Seek bound: unknown — the item duration is not known, so none is fabricated.",
    );
  });

  it("captions surfaces its typed reason and the engine's own detail sentence, verbatim", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    const captions = screen.getByTestId("watch-control-captions");
    expect(captions.textContent).toContain("Unavailable");
    expect(captions.textContent).toContain("no-declared-caption-track");
    expect(captions.textContent).toContain(
      "The local-file plan declares no caption track; captions stay a typed unavailable state until one is declared.",
    );
  });

  it("mini-player and PiP are declared-unavailable by default with the honest host reason", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    const mini = screen.getByTestId("watch-control-miniPlayer");
    const pip = screen.getByTestId("watch-control-pip");
    expect(mini.textContent).toContain("Unavailable");
    expect(mini.textContent).toContain("host-surface-not-declared");
    expect(mini.textContent).toContain(
      'The host has not declared a mini-player surface for "local-file" playback; it defaults to unavailable rather than claiming integration.',
    );
    expect(pip.textContent).toContain("host-surface-not-declared");
  });

  it("a host-declared surface flips the typed state — available with its facts", () => {
    const declared: PlayerControlsView = {
      ...LOCAL_CONTROLS,
      miniPlayer: {
        state: "available",
        facts: ["webflix-hosted-surface", "host-declared-surface"],
      },
      pip: { state: "available", facts: ["webflix-hosted-surface", "host-declared-surface"] },
    };
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={declared} />);
    expect(screen.getByTestId("watch-control-miniPlayer").textContent).toContain("Available");
    expect(screen.getByTestId("watch-control-miniPlayer").textContent).toContain(
      "webflix-hosted-surface · host-declared-surface",
    );
    expect(screen.getByTestId("watch-control-pip").textContent).toContain("Available");
  });

  it("an official-embed model refuses the runtime controls with the provider-governed reason", () => {
    render(<WatchScreen title="Ext 77" plan={EMBED_PLAN} controls={EMBED_CONTROLS} />);
    expect(screen.getByTestId("watch-controls-plankind").textContent).toContain("official-embed");
    const playPause = screen.getByTestId("watch-control-playPause");
    expect(playPause.textContent).toContain("Unavailable");
    expect(playPause.textContent).toContain("provider-governed-playback");
    expect(playPause.textContent).toContain(
      'The "streamo" embedded player owns play/pause; the plan declares no host-side control API.',
    );
    expect(screen.getByTestId("watch-control-queueAdd").textContent).toContain("Available");
  });

  it("an unavailable plan surfaces its own typed reason in the plan-kind line; all controls refuse", () => {
    const unavailablePlan: PlaybackPlan = {
      kind: "unavailable",
      reason: "requires-auth",
      recovery: {
        action: "sign-in",
        message: 'Sign in to "streamo" through its connector to stream this title.',
      },
    };
    const unavailableControls: PlayerControlsView = {
      planKind: "unavailable",
      unavailableReason: "requires-auth",
      playPause: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      seek: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      volume: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      captions: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      queueAdd: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      miniPlayer: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
      pip: {
        state: "unavailable",
        reason: "plan-unavailable",
        detail:
          "Playback is unavailable (requires-auth); no control applies until a playable plan is resolved.",
      },
    };
    render(<WatchScreen title="Ext 77" plan={unavailablePlan} controls={unavailableControls} />);
    expect(screen.getByTestId("watch-controls-plankind").textContent).toContain("unavailable");
    expect(screen.getByTestId("watch-controls-plankind").textContent).toContain("requires-auth");
    for (const id of CONTROL_IDS) {
      expect(screen.getByTestId(`watch-control-${id}`).textContent).toContain("Unavailable");
      expect(screen.getByTestId(`watch-control-${id}`).textContent).toContain("plan-unavailable");
    }
  });

  it("NO dead controls: the strip renders zero buttons (no handlers exist at this surface)", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    const strip = screen.getByTestId("watch-controls");
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
  });

  it("the strip composes with the existing plan body — the local player still renders", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={LOCAL_CONTROLS} />);
    expect(screen.getByTestId("watch-local-player")).toBeTruthy();
    expect(screen.getByTestId("watch-controls")).toBeTruthy();
  });

  it("the strip composes with the official-embed body — the iframe still renders", () => {
    render(<WatchScreen title="Ext 77" plan={EMBED_PLAN} controls={EMBED_CONTROLS} />);
    expect(screen.getByTestId("watch-embed")).toBeTruthy();
    expect(screen.getByTestId("watch-controls")).toBeTruthy();
  });

  it("the null controls prop is the same honest not-derived state as the absent one", () => {
    render(<WatchScreen title="The Async Adventure" plan={LOCAL_PLAN} controls={null} />);
    expect(screen.getByTestId("watch-controls-empty").textContent).toContain(
      "No player-controls model has been derived for this plan yet",
    );
  });
});
