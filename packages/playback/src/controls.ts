/**
 * packages/playback/src/controls.ts
 *
 * P7-PLAYER-1 (WF-006): the capability-aware player-controls seam.
 *
 * This module is the TYPED control layer the composition row (P7-COMPOSE-1)
 * binds to WatchScreen — pure functions over the FROZEN §2.2 PlaybackPlan
 * union, fixture-testable, no media engine, no DOM, no host integration.
 *
 * Honesty model (typed against exactly what the plan declares):
 *
 *   local-file        — WebFlix renders and controls its own playback
 *                       surface: play/pause/seek/volume available. Seek
 *                       carries a position bound when the duration is
 *                       known (host input); without one it is honest
 *                       `boundMs: null`, never a fabricated bound.
 *   official-embed    — the provider's embedded player owns the runtime
 *                       controls; the plan declares NO host-side control
 *                       API (embedSpec is load-time parameters only), so
 *                       play/pause/seek/volume/captions surface as
 *                       unavailable with a provider-governed reason.
 *   isolated-website /
 *   external-deep-link — playback happens on a surface outside WebFlix's
 *                       player; every runtime control is refused with a
 *                       handoff reason.
 *   unavailable       — nothing to control; every control surfaces the
 *                       plan-unavailable reason (plus the frozen plan's
 *                       own typed reason as data).
 *
 * Captions: NO frozen plan variant declares a caption track. The honest
 * availability is therefore unavailable-everywhere (typed reason per plan
 * kind) — a typed state the UI renders, never a dead control. If a future
 * contract variant declares caption data, this seam extends additively.
 *
 * Queue-add: the WebFlix queue holds plans that start playback in-app
 * (official-embed | local-file, per isPlayablePlan in resolve.ts). Handoff
 * plans re-open an outside surface when dequeued — not queued in-app
 * playback — so they are refused with a typed reason, not silently no-oped.
 *
 * mini-player / PiP: availability is DECLARED, not claimed. It takes BOTH
 * a plan kind whose playback surface is WebFlix-hosted (local-file or
 * official-embed) AND an explicit host surface capability input; the host
 * input defaults to undeclared, so the default state is unavailable with
 * the host-surface-not-declared reason. Surfaces are DATA here — no host
 * integration is claimed by this module.
 *
 * canApply(cmd, plan) matches the work order's two-argument applicability
 * check; the optional third `context` parameter carries the honest inputs
 * the plan itself does not declare (known duration for the seek bound,
 * host surface capabilities). Omitted, both checks degrade to their
 * declared defaults — never to fabricated capabilities.
 */

import type { PlaybackPlan, UnavailableReason } from "webflix-contracts";

// ---------------------------------------------------------------------------
// Control surface and availability shapes
// ---------------------------------------------------------------------------

/** The seven controls of the WF-006 player surface, in canonical order. */
export const PLAYER_CONTROL_IDS = [
  "playPause",
  "seek",
  "volume",
  "captions",
  "queueAdd",
  "miniPlayer",
  "pip",
] as const;

/** Typed id of one control on the player-controls surface. */
export type PlayerControlId = (typeof PLAYER_CONTROL_IDS)[number];

/** Typed capability facts backing an available control (never empty). */
export type ControlCapability =
  /** WebFlix renders and controls its own player surface (local-file). */
  | "webflix-owned-playback"
  /** The plan starts playback inside WebFlix (official-embed | local-file). */
  | "in-app-playable-plan"
  /** The playback surface is hosted inside a WebFlix window/webview. */
  | "webflix-hosted-surface"
  /** The host explicitly declared this floating-surface capability. */
  | "host-declared-surface";

/** Typed reasons a control can be unavailable (honest states, never dead). */
export type ControlUnavailableReason =
  /** The plan itself is unavailable — there is nothing to control. */
  | "plan-unavailable"
  /** The provider's own embedded player owns the runtime controls. */
  | "provider-governed-playback"
  /** Playback happens on an outside surface (isolated webview / external app). */
  | "handoff-surface"
  /** The plan declares no caption track data for captions to act on. */
  | "no-declared-caption-track"
  /** The WebFlix queue only holds in-app playable plans. */
  | "handoff-not-queueable"
  /** The host did not declare this floating surface (mini-player/PiP default). */
  | "host-surface-not-declared";

/** An available control, with the typed capability facts that back it. */
export interface ControlAvailable {
  state: "available";
  facts: ControlCapability[];
}

/** An unavailable control, with its typed reason and a readable explanation. */
export interface ControlUnavailable {
  state: "unavailable";
  reason: ControlUnavailableReason;
  detail: string;
}

/** Per-control availability: available with facts, or unavailable with a reason. */
export type ControlAvailability = ControlAvailable | ControlUnavailable;

/** An available seek control; the position bound is data, null when unknown. */
export interface SeekAvailable extends ControlAvailable {
  /** Upper seek bound in ms when the item duration is known; null otherwise. */
  boundMs: number | null;
}

/** Seek-specific availability (adds the position bound to the union). */
export type SeekAvailability = SeekAvailable | ControlUnavailable;

/**
 * Per-control typed availability for one plan — the 5x7 matrix row.
 * Every control always carries a typed state; there are no dead controls.
 */
export interface ControlsAvailability {
  /** The plan variant this availability was derived from. */
  planKind: PlaybackPlan["kind"];
  /** Present iff planKind is "unavailable": the frozen plan's own typed reason. */
  unavailableReason?: UnavailableReason;
  playPause: ControlAvailability;
  seek: SeekAvailability;
  volume: ControlAvailability;
  captions: ControlAvailability;
  queueAdd: ControlAvailability;
  miniPlayer: ControlAvailability;
  pip: ControlAvailability;
}

/** The derived player-controls model (the work order's name for a derived row). */
export type PlayerControlsModel = ControlsAvailability;

// ---------------------------------------------------------------------------
// Host inputs the plan does not declare
// ---------------------------------------------------------------------------

/** Floating-surface capabilities the HOST declares (as data, default off). */
export interface HostSurfaceCapabilities {
  /** Host can float an always-on-top mini-player surface over WebFlix playback. */
  miniPlayer?: boolean;
  /** Host OS supports picture-in-picture for WebFlix-hosted playback surfaces. */
  pip?: boolean;
}

/** Honest host inputs for derivation and applicability checks. */
export interface ControlContext {
  /**
   * Known item duration in ms (e.g. PlaybackProgress.durationMs).
   * Omitted, zero or negative means "not yet known" — the seek bound stays
   * honestly null and no range check is fabricated.
   */
  durationMs?: number;
  /** Host-declared floating surfaces; defaults to none declared. */
  hostSurfaces?: HostSurfaceCapabilities;
}

// ---------------------------------------------------------------------------
// Control commands and the applicability check
// ---------------------------------------------------------------------------

/** Typed commands the player-controls seam can be asked to apply. */
export type ControlCommand =
  | { command: "play" }
  | { command: "pause" }
  | { command: "seek"; positionMs: number }
  | { command: "volume"; level: number }
  | { command: "captions-toggle"; enabled: boolean }
  | { command: "queue-add"; itemId: string };

/** Typed refusal reasons for canApply: structural reasons plus payload ranges. */
export type ControlRefusalReason =
  | ControlUnavailableReason
  | "seek-out-of-range"
  | "volume-out-of-range";

/** Result of the pure applicability check: ok, or a typed refusal. */
export type ControlApplyResult =
  | { ok: true }
  | { ok: false; reason: ControlRefusalReason; detail: string };

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function knownDurationMs(context: ControlContext | undefined): number | null {
  const ms = context?.durationMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null;
}

function available(facts: ControlCapability[]): ControlAvailable {
  return { state: "available", facts };
}

function unavailable(reason: ControlUnavailableReason, detail: string): ControlUnavailable {
  return { state: "unavailable", reason, detail };
}

/** Every control is unavailable because the plan itself is unavailable. */
function allPlanUnavailable(
  plan: Extract<PlaybackPlan, { kind: "unavailable" }>,
): ControlsAvailability {
  const why = `Playback is unavailable (${plan.reason}); no control applies until a playable plan is resolved.`;
  return {
    planKind: "unavailable",
    unavailableReason: plan.reason,
    playPause: unavailable("plan-unavailable", why),
    seek: unavailable("plan-unavailable", why),
    volume: unavailable("plan-unavailable", why),
    captions: unavailable("plan-unavailable", why),
    queueAdd: unavailable("plan-unavailable", why),
    miniPlayer: unavailable("plan-unavailable", why),
    pip: unavailable("plan-unavailable", why),
  };
}

/**
 * Floating-surface availability (mini-player / PiP) as declared data.
 * Available only when BOTH the plan kind hosts playback inside a WebFlix
 * surface (local-file or official-embed) AND the host declared the
 * capability; every other combination is a typed unavailable state.
 */
function surfaceAvailability(
  planKind: PlaybackPlan["kind"],
  declared: boolean,
  control: "mini-player" | "picture-in-picture",
): ControlAvailability {
  if (planKind !== "local-file" && planKind !== "official-embed") {
    return unavailable(
      "handoff-surface",
      `A ${control} surface cannot be declared for a "${planKind}" plan: playback runs on an outside surface.`,
    );
  }
  if (!declared) {
    return unavailable(
      "host-surface-not-declared",
      `The host has not declared a ${control} surface for "${planKind}" playback; it defaults to unavailable rather than claiming integration.`,
    );
  }
  return available(["webflix-hosted-surface", "host-declared-surface"]);
}

/**
 * Derives the per-control typed availability from a PlaybackPlan.
 * Pure: identical plan + context always yield an identical model, and the
 * plan is never mutated. This is the WF-006 honest matrix — every control
 * surfaces a typed available/unavailable state, never a silent no-op.
 */
export function deriveControls(plan: PlaybackPlan, context?: ControlContext): ControlsAvailability {
  const durationMs = knownDurationMs(context);
  const host = context?.hostSurfaces;

  switch (plan.kind) {
    case "local-file":
      return {
        planKind: "local-file",
        playPause: available(["webflix-owned-playback"]),
        seek: {
          state: "available",
          facts: ["webflix-owned-playback"],
          boundMs: durationMs,
        },
        volume: available(["webflix-owned-playback"]),
        captions: unavailable(
          "no-declared-caption-track",
          "The local-file plan declares no caption track; captions stay a typed unavailable state until one is declared.",
        ),
        queueAdd: available(["in-app-playable-plan"]),
        miniPlayer: surfaceAvailability(plan.kind, host?.miniPlayer === true, "mini-player"),
        pip: surfaceAvailability(plan.kind, host?.pip === true, "picture-in-picture"),
      };

    case "official-embed":
      return {
        planKind: "official-embed",
        playPause: unavailable(
          "provider-governed-playback",
          `The "${plan.providerId}" embedded player owns play/pause; the plan declares no host-side control API.`,
        ),
        seek: unavailable(
          "provider-governed-playback",
          `The "${plan.providerId}" embedded player owns seeking; the plan declares no host-side control API.`,
        ),
        volume: unavailable(
          "provider-governed-playback",
          `The "${plan.providerId}" embedded player owns volume; the plan declares no host-side control API.`,
        ),
        captions: unavailable(
          "provider-governed-playback",
          `Captions live inside the "${plan.providerId}" embedded player and are not declared to the host.`,
        ),
        queueAdd: available(["in-app-playable-plan"]),
        miniPlayer: surfaceAvailability(plan.kind, host?.miniPlayer === true, "mini-player"),
        pip: surfaceAvailability(plan.kind, host?.pip === true, "picture-in-picture"),
      };

    case "isolated-website":
    case "external-deep-link": {
      const why =
        plan.kind === "isolated-website"
          ? "Playback runs on the provider's site inside an isolated webview; WebFlix controls nothing there."
          : "Playback is handed to an external application; WebFlix controls nothing there.";
      return {
        planKind: plan.kind,
        playPause: unavailable("handoff-surface", why),
        seek: unavailable("handoff-surface", why),
        volume: unavailable("handoff-surface", why),
        captions: unavailable("handoff-surface", why),
        queueAdd: unavailable(
          "handoff-not-queueable",
          "The WebFlix queue holds in-app playable plans (official-embed | local-file); handoff plans are not queued.",
        ),
        miniPlayer: surfaceAvailability(plan.kind, false, "mini-player"),
        pip: surfaceAvailability(plan.kind, false, "picture-in-picture"),
      };
    }

    case "unavailable":
      return allPlanUnavailable(plan);
  }
}

// ---------------------------------------------------------------------------
// Applicability check
// ---------------------------------------------------------------------------

/** Structural gate shared by the runtime-control commands (play/pause/seek/volume). */
function runtimeControlGate(plan: PlaybackPlan): ControlApplyResult | null {
  switch (plan.kind) {
    case "local-file":
      return null; // WebFlix owns the playback surface — the command may apply.
    case "official-embed":
      return {
        ok: false,
        reason: "provider-governed-playback",
        detail: `The "${plan.providerId}" embedded player owns this control; the plan declares no host-side control API.`,
      };
    case "isolated-website":
      return {
        ok: false,
        reason: "handoff-surface",
        detail:
          "Playback runs on the provider's site in an isolated webview; WebFlix cannot apply this command.",
      };
    case "external-deep-link":
      return {
        ok: false,
        reason: "handoff-surface",
        detail: "Playback is handed to an external application; WebFlix cannot apply this command.",
      };
    case "unavailable":
      return {
        ok: false,
        reason: "plan-unavailable",
        detail: `Playback is unavailable (${plan.reason}); no command applies.`,
      };
  }
}

function seekRangeCheck(positionMs: number, boundMs: number | null): ControlApplyResult | null {
  if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
    return {
      ok: false,
      reason: "seek-out-of-range",
      detail: `Seek position must be a finite non-negative number of ms, got ${String(positionMs)}.`,
    };
  }
  if (boundMs !== null && positionMs > boundMs) {
    return {
      ok: false,
      reason: "seek-out-of-range",
      detail: `Seek position ${positionMs}ms is beyond the known duration bound ${boundMs}ms.`,
    };
  }
  return null;
}

function volumeRangeCheck(level: number): ControlApplyResult | null {
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1) {
    return {
      ok: false,
      reason: "volume-out-of-range",
      detail: `Volume level must be a finite number within [0, 1], got ${String(level)}.`,
    };
  }
  return null;
}

/**
 * Captions-toggle refusal — exhaustive over every frozen plan kind. No plan
 * variant declares a caption track, so this is honestly a refusal today,
 * with the typed reason each kind deserves (never a silent no-op).
 */
function captionsRefusal(plan: PlaybackPlan): ControlApplyResult {
  switch (plan.kind) {
    case "local-file":
      return {
        ok: false,
        reason: "no-declared-caption-track",
        detail: "The local-file plan declares no caption track to toggle.",
      };
    case "official-embed":
      return {
        ok: false,
        reason: "provider-governed-playback",
        detail: `Captions live inside the "${plan.providerId}" embedded player and are not declared to the host.`,
      };
    case "isolated-website":
      return {
        ok: false,
        reason: "handoff-surface",
        detail:
          "Playback runs on the provider's site in an isolated webview; captions are not declared to WebFlix.",
      };
    case "external-deep-link":
      return {
        ok: false,
        reason: "handoff-surface",
        detail:
          "Playback is handed to an external application; captions are not declared to WebFlix.",
      };
    case "unavailable":
      return {
        ok: false,
        reason: "plan-unavailable",
        detail: `Playback is unavailable (${plan.reason}); no command applies.`,
      };
  }
}

/**
 * Pure applicability check for one command against a plan: ok, or a typed
 * refusal reason. Agrees with deriveControls by construction — the
 * structural gates mirror the derivation matrix exactly. Payload range
 * refusals (seek/volume) apply only when the command's plan-side gate
 * already passes. Note captions-toggle is refused for EVERY frozen plan
 * kind today (typed reason per kind) — that is the honest answer, not a
 * dead command; the queue-add payload (itemId) is the queue store's to
 * validate in its own row.
 */
export function canApply(
  command: ControlCommand,
  plan: PlaybackPlan,
  context?: ControlContext,
): ControlApplyResult {
  switch (command.command) {
    case "play":
    case "pause":
      return runtimeControlGate(plan) ?? { ok: true };

    case "seek": {
      const gate = runtimeControlGate(plan);
      if (gate) return gate;
      return seekRangeCheck(command.positionMs, knownDurationMs(context)) ?? { ok: true };
    }

    case "volume": {
      const gate = runtimeControlGate(plan);
      if (gate) return gate;
      return volumeRangeCheck(command.level) ?? { ok: true };
    }

    case "captions-toggle":
      return captionsRefusal(plan);

    case "queue-add": {
      switch (plan.kind) {
        case "official-embed":
        case "local-file":
          return { ok: true };
        case "isolated-website":
        case "external-deep-link":
          return {
            ok: false,
            reason: "handoff-not-queueable",
            detail:
              "The WebFlix queue holds in-app playable plans (official-embed | local-file); handoff plans are not queued.",
          };
        case "unavailable":
          return {
            ok: false,
            reason: "plan-unavailable",
            detail: `Playback is unavailable (${plan.reason}); there is nothing to queue.`,
          };
      }
    }
  }
}
