import { describe, expect, it } from "vitest";

import {
  PLAYER_CONTROL_IDS,
  canApply,
  deriveControls,
  type ControlApplyResult,
  type ControlCapability,
  type ControlCommand,
  type ControlContext,
  type ControlUnavailableReason,
  type ControlsAvailability,
  type PlaybackPlan,
  type PlayerControlId,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures — one literal per frozen PlaybackPlan variant (fixture-only,
// hermetic: no network, no DOM, no media engine anywhere in this file).
// ---------------------------------------------------------------------------

const EMBED_PLAN: PlaybackPlan = {
  kind: "official-embed",
  providerId: "streamo",
  embedSpec: {
    urlTemplate: "https://play.streamo.test/embed/{mediaId}?autoplay=0",
    externalId: "ext-77",
    embedUrl: "https://play.streamo.test/embed/ext-77?autoplay=0",
  },
};

const LOCAL_PLAN: PlaybackPlan = {
  kind: "local-file",
  path: "/media/library/The.Async.Adventure.mkv",
  mimeType: "video/x-matroska",
};

const WEBSITE_PLAN: PlaybackPlan = {
  kind: "isolated-website",
  url: "https://watch.streamo.test/title/ext-77",
};

const DEEP_LINK_PLAN: PlaybackPlan = {
  kind: "external-deep-link",
  url: "streamo://play/ext-77",
};

const UNAVAILABLE_PLAN: PlaybackPlan = {
  kind: "unavailable",
  reason: "requires-auth",
  recovery: {
    action: "sign-in",
    message: 'Sign in to "streamo" through its connector to stream this title.',
  },
};

const ALL_PLANS: PlaybackPlan[] = [
  EMBED_PLAN,
  LOCAL_PLAN,
  WEBSITE_PLAN,
  DEEP_LINK_PLAN,
  UNAVAILABLE_PLAN,
];

/** Compile-time exhaustive switch over the frozen PlaybackPlan union. */
function planKindOf(plan: PlaybackPlan): string {
  switch (plan.kind) {
    case "official-embed":
      return "official-embed";
    case "local-file":
      return "local-file";
    case "isolated-website":
      return "isolated-website";
    case "external-deep-link":
      return "external-deep-link";
    case "unavailable":
      return "unavailable";
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}

const ALL_CAPABILITIES: ControlCapability[] = [
  "webflix-owned-playback",
  "in-app-playable-plan",
  "webflix-hosted-surface",
  "host-declared-surface",
];

const ALL_UNAVAILABLE_REASONS: ControlUnavailableReason[] = [
  "plan-unavailable",
  "provider-governed-playback",
  "handoff-surface",
  "no-declared-caption-track",
  "handoff-not-queueable",
  "host-surface-not-declared",
];

/** Minimal structural validation of one control's typed state. */
function expectTypedState(control: unknown): void {
  expect(control).toBeDefined();
  expect(control).toHaveProperty("state");
  const typed = control as { state: string };
  expect(["available", "unavailable"]).toContain(typed.state);
}

function refusalOf(result: ControlApplyResult): string {
  if (result.ok) {
    expect.unreachable("expected a refusal, got ok");
  }
  return result.reason;
}

// ---------------------------------------------------------------------------
// Per-plan-kind control matrix (the 5x7 surface)
// ---------------------------------------------------------------------------

describe("per-plan-kind control matrix", () => {
  const HOST_DECLARED: ControlContext = {
    hostSurfaces: { miniPlayer: true, pip: true },
  };

  /**
   * The expected 5x7 matrix as data. Each cell is either
   * ["available", facts...] or ["unavailable", reason].
   */
  const MATRIX: Record<string, Record<PlayerControlId, string[]>> = {
    "official-embed": {
      playPause: ["unavailable", "provider-governed-playback"],
      seek: ["unavailable", "provider-governed-playback"],
      volume: ["unavailable", "provider-governed-playback"],
      captions: ["unavailable", "provider-governed-playback"],
      queueAdd: ["available", "in-app-playable-plan"],
      miniPlayer: ["unavailable", "host-surface-not-declared"],
      pip: ["unavailable", "host-surface-not-declared"],
    },
    "local-file": {
      playPause: ["available", "webflix-owned-playback"],
      seek: ["available", "webflix-owned-playback"],
      volume: ["available", "webflix-owned-playback"],
      captions: ["unavailable", "no-declared-caption-track"],
      queueAdd: ["available", "in-app-playable-plan"],
      miniPlayer: ["unavailable", "host-surface-not-declared"],
      pip: ["unavailable", "host-surface-not-declared"],
    },
    "isolated-website": {
      playPause: ["unavailable", "handoff-surface"],
      seek: ["unavailable", "handoff-surface"],
      volume: ["unavailable", "handoff-surface"],
      captions: ["unavailable", "handoff-surface"],
      queueAdd: ["unavailable", "handoff-not-queueable"],
      miniPlayer: ["unavailable", "handoff-surface"],
      pip: ["unavailable", "handoff-surface"],
    },
    "external-deep-link": {
      playPause: ["unavailable", "handoff-surface"],
      seek: ["unavailable", "handoff-surface"],
      volume: ["unavailable", "handoff-surface"],
      captions: ["unavailable", "handoff-surface"],
      queueAdd: ["unavailable", "handoff-not-queueable"],
      miniPlayer: ["unavailable", "handoff-surface"],
      pip: ["unavailable", "handoff-surface"],
    },
    unavailable: {
      playPause: ["unavailable", "plan-unavailable"],
      seek: ["unavailable", "plan-unavailable"],
      volume: ["unavailable", "plan-unavailable"],
      captions: ["unavailable", "plan-unavailable"],
      queueAdd: ["unavailable", "plan-unavailable"],
      miniPlayer: ["unavailable", "plan-unavailable"],
      pip: ["unavailable", "plan-unavailable"],
    },
  };

  it("derives the exact expected state for every plan kind x control (no host surfaces)", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      expect(model.planKind).toBe(plan.kind);
      expect(model.planKind).toBe(planKindOf(plan));

      const expectedRow = MATRIX[plan.kind];
      for (const id of PLAYER_CONTROL_IDS) {
        const control = model[id] as { state: string; facts?: string[]; reason?: string };
        const [wantState, wantExtra] = expectedRow[id];
        expect(control.state).toBe(wantState);
        if (wantState === "available") {
          expect(control.facts).toEqual([wantExtra]);
        } else {
          expect(control.reason).toBe(wantExtra);
        }
      }
    }
  });

  it("keeps the same matrix when a host declares floating surfaces (embed/local flip only)", () => {
    for (const plan of [EMBED_PLAN, LOCAL_PLAN]) {
      const model = deriveControls(plan, HOST_DECLARED);
      expect(model.miniPlayer).toEqual({
        state: "available",
        facts: ["webflix-hosted-surface", "host-declared-surface"],
      });
      expect(model.pip).toEqual({
        state: "available",
        facts: ["webflix-hosted-surface", "host-declared-surface"],
      });
    }
    for (const plan of [WEBSITE_PLAN, DEEP_LINK_PLAN, UNAVAILABLE_PLAN]) {
      const model = deriveControls(plan, HOST_DECLARED);
      expect(model.miniPlayer.state).toBe("unavailable");
      if (model.miniPlayer.state === "unavailable") {
        expect(model.miniPlayer.reason).toBe(
          plan.kind === "unavailable" ? "plan-unavailable" : "handoff-surface",
        );
      }
      expect(model.pip.state).toBe("unavailable");
      if (model.pip.state === "unavailable") {
        expect(model.pip.reason).toBe(
          plan.kind === "unavailable" ? "plan-unavailable" : "handoff-surface",
        );
      }
    }
  });

  it("surfaces the frozen unavailable plan's own reason as data", () => {
    const model = deriveControls(UNAVAILABLE_PLAN);
    expect(model.unavailableReason).toBe("requires-auth");
    for (const plan of [EMBED_PLAN, LOCAL_PLAN, WEBSITE_PLAN, DEEP_LINK_PLAN]) {
      expect(deriveControls(plan).unavailableReason).toBeUndefined();
    }
  });

  it("declares every fact and reason from the typed unions only", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan, HOST_DECLARED);
      for (const id of PLAYER_CONTROL_IDS) {
        const control = model[id] as { state: string; facts?: string[]; reason?: string };
        if (control.state === "available") {
          expect(control.facts?.length).toBeGreaterThan(0);
          for (const fact of control.facts ?? []) {
            expect(ALL_CAPABILITIES).toContain(fact);
          }
        } else {
          expect(ALL_UNAVAILABLE_REASONS).toContain(control.reason);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// No-dead-control invariant
// ---------------------------------------------------------------------------

describe("no-dead-control invariant", () => {
  it("every control surfaces a typed state for every plan kind", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      for (const id of PLAYER_CONTROL_IDS) {
        expectTypedState(model[id]);
      }
    }
  });

  it("the model exposes exactly the seven WF-006 controls", () => {
    expect(PLAYER_CONTROL_IDS).toEqual([
      "playPause",
      "seek",
      "volume",
      "captions",
      "queueAdd",
      "miniPlayer",
      "pip",
    ]);
    const BASE_KEYS = [
      "planKind",
      "playPause",
      "seek",
      "volume",
      "captions",
      "queueAdd",
      "miniPlayer",
      "pip",
    ];
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      const expectedKeys =
        plan.kind === "unavailable" ? [...BASE_KEYS, "unavailableReason"] : BASE_KEYS;
      expect(Object.keys(model).sort()).toEqual(expectedKeys.sort());
    }
  });

  it("unavailable controls always carry a typed reason and a non-empty detail", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      for (const id of PLAYER_CONTROL_IDS) {
        const control = model[id] as { state: string; reason?: string; detail?: string };
        if (control.state === "unavailable") {
          expect(typeof control.reason).toBe("string");
          expect(control.reason?.length).toBeGreaterThan(0);
          expect(typeof control.detail).toBe("string");
          expect(control.detail?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("captions is an honest typed state on every plan kind (never a silent no-op)", () => {
    const expected: Record<string, string> = {
      "official-embed": "provider-governed-playback",
      "local-file": "no-declared-caption-track",
      "isolated-website": "handoff-surface",
      "external-deep-link": "handoff-surface",
      unavailable: "plan-unavailable",
    };
    for (const plan of ALL_PLANS) {
      const captions = deriveControls(plan).captions;
      expect(captions.state).toBe("unavailable");
      if (captions.state === "unavailable") {
        expect(captions.reason).toBe(expected[plan.kind]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Seek bound correctness (local-file plans)
// ---------------------------------------------------------------------------

describe("seek bound correctness for local-file plans", () => {
  it("carries the known duration as the position bound", () => {
    const model = deriveControls(LOCAL_PLAN, { durationMs: 42_000 });
    expect(model.seek.state).toBe("available");
    if (model.seek.state === "available") {
      expect(model.seek.boundMs).toBe(42_000);
      expect(model.seek.facts).toEqual(["webflix-owned-playback"]);
    }
  });

  it("reports an honest null bound when the duration is unknown, zero, or negative", () => {
    expect(deriveControls(LOCAL_PLAN).seek.state).toBe("available");
    expect(deriveControls(LOCAL_PLAN, {}).seek.state).toBe("available");
    for (const durationMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const model = deriveControls(LOCAL_PLAN, { durationMs });
      expect(model.seek.state).toBe("available");
      if (model.seek.state === "available") {
        expect(model.seek.boundMs).toBeNull();
      }
    }
  });

  it("accepts seeks at 0 and exactly at the bound, refuses beyond it", () => {
    const ctx: ControlContext = { durationMs: 10_000 };
    expect(canApply({ command: "seek", positionMs: 0 }, LOCAL_PLAN, ctx)).toEqual({ ok: true });
    expect(canApply({ command: "seek", positionMs: 10_000 }, LOCAL_PLAN, ctx)).toEqual({
      ok: true,
    });
    expect(canApply({ command: "seek", positionMs: 10_001 }, LOCAL_PLAN, ctx)).toEqual({
      ok: false,
      reason: "seek-out-of-range",
      detail: "Seek position 10001ms is beyond the known duration bound 10000ms.",
    });
  });

  it("refuses negative and non-finite seek positions even without a known bound", () => {
    for (const positionMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const refusal = canApply({ command: "seek", positionMs }, LOCAL_PLAN);
      expect(refusal.ok).toBe(false);
      expect(refusal.ok === false && refusal.reason).toBe("seek-out-of-range");
    }
  });

  it("without a known duration any finite non-negative seek applies (no fabricated bound)", () => {
    expect(canApply({ command: "seek", positionMs: 999_999_999 }, LOCAL_PLAN)).toEqual({
      ok: true,
    });
  });

  it("seek is structurally refused for plans that do not declare it", () => {
    for (const plan of [EMBED_PLAN, WEBSITE_PLAN, DEEP_LINK_PLAN, UNAVAILABLE_PLAN]) {
      const refusal = canApply({ command: "seek", positionMs: 5_000 }, plan, {
        durationMs: 10_000,
      });
      expect(refusal.ok).toBe(false);
      if (refusal.ok === false) {
        expect(refusal.reason).toBe(
          plan.kind === "unavailable"
            ? "plan-unavailable"
            : plan.kind === "official-embed"
              ? "provider-governed-playback"
              : "handoff-surface",
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Volume range
// ---------------------------------------------------------------------------

describe("volume command", () => {
  it("applies within [0, 1] on local-file plans", () => {
    expect(canApply({ command: "volume", level: 0 }, LOCAL_PLAN)).toEqual({ ok: true });
    expect(canApply({ command: "volume", level: 0.5 }, LOCAL_PLAN)).toEqual({ ok: true });
    expect(canApply({ command: "volume", level: 1 }, LOCAL_PLAN)).toEqual({ ok: true });
  });

  it("refuses out-of-range and non-finite levels with a typed reason", () => {
    for (const level of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const refusal = canApply({ command: "volume", level }, LOCAL_PLAN);
      expect(refusal.ok).toBe(false);
      expect(refusal.ok === false && refusal.reason).toBe("volume-out-of-range");
    }
  });

  it("is structurally refused for every non-local plan kind", () => {
    for (const plan of [EMBED_PLAN, WEBSITE_PLAN, DEEP_LINK_PLAN, UNAVAILABLE_PLAN]) {
      expect(canApply({ command: "volume", level: 0.5 }, plan).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Refusal reasons for commands against non-supporting plans
// ---------------------------------------------------------------------------

describe("typed refusals for unsupported commands", () => {
  const RUNTIME_COMMANDS: ControlCommand[] = [
    { command: "play" },
    { command: "pause" },
    { command: "seek", positionMs: 1_000 },
    { command: "volume", level: 0.5 },
  ];

  it("refuses runtime controls on official-embed with provider-governed-playback", () => {
    for (const command of RUNTIME_COMMANDS) {
      expect(refusalOf(canApply(command, EMBED_PLAN))).toBe("provider-governed-playback");
    }
    expect(refusalOf(canApply({ command: "captions-toggle", enabled: true }, EMBED_PLAN))).toBe(
      "provider-governed-playback",
    );
  });

  it("refuses runtime controls on handoff plans with handoff-surface", () => {
    for (const plan of [WEBSITE_PLAN, DEEP_LINK_PLAN]) {
      for (const command of RUNTIME_COMMANDS) {
        expect(refusalOf(canApply(command, plan))).toBe("handoff-surface");
      }
      expect(refusalOf(canApply({ command: "captions-toggle", enabled: true }, plan))).toBe(
        "handoff-surface",
      );
    }
  });

  it("refuses every command on unavailable plans with plan-unavailable", () => {
    const commands: ControlCommand[] = [
      ...RUNTIME_COMMANDS,
      { command: "captions-toggle", enabled: true },
      { command: "queue-add", itemId: "wf-0001" },
    ];
    for (const command of commands) {
      expect(refusalOf(canApply(command, UNAVAILABLE_PLAN))).toBe("plan-unavailable");
    }
  });

  it("refuses captions-toggle on local-file with no-declared-caption-track", () => {
    expect(refusalOf(canApply({ command: "captions-toggle", enabled: true }, LOCAL_PLAN))).toBe(
      "no-declared-caption-track",
    );
    expect(refusalOf(canApply({ command: "captions-toggle", enabled: false }, LOCAL_PLAN))).toBe(
      "no-declared-caption-track",
    );
  });

  it("applies play/pause on local-file plans", () => {
    expect(canApply({ command: "play" }, LOCAL_PLAN)).toEqual({ ok: true });
    expect(canApply({ command: "pause" }, LOCAL_PLAN)).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Queue-add applicability
// ---------------------------------------------------------------------------

describe("queue-add applicability", () => {
  const QUEUE_ADD: ControlCommand = { command: "queue-add", itemId: "wf-0001" };

  it("applies for in-app playable plans (official-embed | local-file)", () => {
    expect(canApply(QUEUE_ADD, EMBED_PLAN)).toEqual({ ok: true });
    expect(canApply(QUEUE_ADD, LOCAL_PLAN)).toEqual({ ok: true });
    expect(deriveControls(EMBED_PLAN).queueAdd.state).toBe("available");
    expect(deriveControls(LOCAL_PLAN).queueAdd.state).toBe("available");
  });

  it("refuses handoff plans with handoff-not-queueable", () => {
    for (const plan of [WEBSITE_PLAN, DEEP_LINK_PLAN]) {
      expect(refusalOf(canApply(QUEUE_ADD, plan))).toBe("handoff-not-queueable");
      expect(deriveControls(plan).queueAdd.state).toBe("unavailable");
    }
  });

  it("refuses unavailable plans with plan-unavailable", () => {
    expect(refusalOf(canApply(QUEUE_ADD, UNAVAILABLE_PLAN))).toBe("plan-unavailable");
  });
});

// ---------------------------------------------------------------------------
// mini-player / PiP default-unavailable honesty
// ---------------------------------------------------------------------------

describe("mini-player / PiP honesty", () => {
  it("defaults to unavailable with host-surface-not-declared for webflix-hosted kinds", () => {
    for (const plan of [LOCAL_PLAN, EMBED_PLAN]) {
      const model = deriveControls(plan);
      expect(model.miniPlayer.state).toBe("unavailable");
      expect(model.pip.state).toBe("unavailable");
      if (model.miniPlayer.state === "unavailable") {
        expect(model.miniPlayer.reason).toBe("host-surface-not-declared");
      }
      if (model.pip.state === "unavailable") {
        expect(model.pip.reason).toBe("host-surface-not-declared");
      }
    }
  });

  it("becomes available only when the host declares the surface", () => {
    const declared = deriveControls(LOCAL_PLAN, {
      hostSurfaces: { miniPlayer: true, pip: true },
    });
    expect(declared.miniPlayer).toEqual({
      state: "available",
      facts: ["webflix-hosted-surface", "host-declared-surface"],
    });
    expect(declared.pip).toEqual({
      state: "available",
      facts: ["webflix-hosted-surface", "host-declared-surface"],
    });
  });

  it("treats the two surfaces as independent declarations", () => {
    const onlyMini = deriveControls(LOCAL_PLAN, { hostSurfaces: { miniPlayer: true } });
    expect(onlyMini.miniPlayer.state).toBe("available");
    expect(onlyMini.pip.state).toBe("unavailable");
    if (onlyMini.pip.state === "unavailable") {
      expect(onlyMini.pip.reason).toBe("host-surface-not-declared");
    }

    const onlyPip = deriveControls(EMBED_PLAN, { hostSurfaces: { pip: true } });
    expect(onlyPip.pip.state).toBe("available");
    expect(onlyPip.miniPlayer.state).toBe("unavailable");
  });

  it("never floats a handoff or unavailable plan regardless of host declarations", () => {
    for (const plan of [WEBSITE_PLAN, DEEP_LINK_PLAN, UNAVAILABLE_PLAN]) {
      const model = deriveControls(plan, {
        hostSurfaces: { miniPlayer: true, pip: true },
      });
      expect(model.miniPlayer.state).toBe("unavailable");
      expect(model.pip.state).toBe("unavailable");
    }
  });

  it("a false host declaration stays unavailable (no capability inflation)", () => {
    const model = deriveControls(LOCAL_PLAN, {
      hostSurfaces: { miniPlayer: false, pip: false },
    });
    expect(model.miniPlayer.state).toBe("unavailable");
    expect(model.pip.state).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// canApply <-> deriveControls agreement (reducer consistency)
// ---------------------------------------------------------------------------

describe("canApply agrees with deriveControls", () => {
  it("ok-ness matches availability for every plan kind and command", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      const cases: Array<[ControlCommand, ControlsAvailability[PlayerControlId]]> = [
        [{ command: "play" }, model.playPause],
        [{ command: "pause" }, model.playPause],
        [{ command: "seek", positionMs: 0 }, model.seek],
        [{ command: "volume", level: 0.5 }, model.volume],
        [{ command: "captions-toggle", enabled: true }, model.captions],
        [{ command: "queue-add", itemId: "wf-0001" }, model.queueAdd],
      ];
      for (const [command, control] of cases) {
        const expectedOk = control.state === "available";
        const result = canApply(command, plan);
        expect(result.ok).toBe(expectedOk);
      }
    }
  });

  it("refusal reasons mirror the availability reasons structurally", () => {
    for (const plan of ALL_PLANS) {
      const model = deriveControls(plan);
      const play = canApply({ command: "play" }, plan);
      if (model.playPause.state === "unavailable" && !play.ok) {
        expect(play.reason).toBe(model.playPause.reason);
      }
      const captions = canApply({ command: "captions-toggle", enabled: true }, plan);
      if (model.captions.state === "unavailable" && !captions.ok) {
        expect(captions.reason).toBe(model.captions.reason);
      }
      const queue = canApply({ command: "queue-add", itemId: "wf-0001" }, plan);
      if (model.queueAdd.state === "unavailable" && !queue.ok) {
        expect(queue.reason).toBe(model.queueAdd.reason);
      }
    }
  });

  it("seek ok-ness follows the derived bound when a duration is known", () => {
    const ctx: ControlContext = { durationMs: 8_000 };
    const model = deriveControls(LOCAL_PLAN, ctx);
    expect(model.seek.state).toBe("available");
    if (model.seek.state === "available") {
      expect(
        canApply({ command: "seek", positionMs: model.seek.boundMs ?? 0 }, LOCAL_PLAN, ctx),
      ).toEqual({ ok: true });
      expect(
        canApply({ command: "seek", positionMs: (model.seek.boundMs ?? 0) + 1 }, LOCAL_PLAN, ctx)
          .ok,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("derives identical models from identical inputs", () => {
    for (const plan of ALL_PLANS) {
      expect(deriveControls(plan)).toEqual(deriveControls(plan));
      expect(deriveControls(plan, { durationMs: 5_000 })).toEqual(
        deriveControls(plan, { durationMs: 5_000 }),
      );
    }
    expect(deriveControls(LOCAL_PLAN)).toEqual(deriveControls(LOCAL_PLAN, undefined));
  });

  it("never mutates the plan or the context", () => {
    for (const plan of ALL_PLANS) {
      const planSnapshot = JSON.stringify(plan);
      const ctx: ControlContext = { durationMs: 5_000, hostSurfaces: { miniPlayer: true } };
      const ctxSnapshot = JSON.stringify(ctx);
      deriveControls(plan, ctx);
      canApply({ command: "seek", positionMs: 1_000 }, plan, ctx);
      expect(JSON.stringify(plan)).toBe(planSnapshot);
      expect(JSON.stringify(ctx)).toBe(ctxSnapshot);
    }
  });
});
