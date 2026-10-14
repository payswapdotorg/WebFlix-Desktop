// Honest-state vocabulary — freeze §2.3 (binding).
//
// §2.3 reconciliation (MIRROR-RECON, 2026-10-11): this module originally
// treated CapabilityStatus as a lane-local discriminated union of rich objects
// ({kind: "available"|"requires-auth"|…, reason?, providerId?, connectUrl?,
// retryAfterSeconds?, detail?}). The FROZEN §2.3 vocabulary is a string enum —
// supported|requires-auth|unsupported|unavailable|rate-limited|degraded|unknown
// — and the per-operation detail lives on OperationCapability.detail (§2.3),
// not on the status itself. The status→UI mapping is re-expressed against the
// frozen enum; human-readable context (reasons, reset hints) flows through
// OperationCapability.detail verbatim.
//
// Status vocabulary map (mirror → frozen §2.3):
//   available        → supported
//   requires-auth    → requires-auth   (providerId/connectUrl were mirror-only
//                                        fields; the provider is caller context)
//   rate-limited     → rate-limited    (structured retryAfterSeconds is not a
//                                        frozen field — the reset hint arrives
//                                        as capability.detail text; filed as
//                                        freeze-deviation MR-FD1 for TL2)
//   unsupported      → unsupported     (mirror reason → capability.detail)
//   unavailable      → unavailable     (mirror reason → capability.detail)
//   (no mirror)      → degraded        (new in the frozen vocabulary — mapped
//                                        to its own honest state, never
//                                        collapsed into ready or unavailable)
//   unknown          → unknown         (mirror detail → capability.detail)
//
// Rules encoded here:
//   1. Every CapabilityStatus maps to exactly one UI state — the mapping is
//      total, with a fail-fast guard, so no fallback can invent a success.
//   2. `unknown` maps to 'status-unknown' and renders as "Status unknown".
//      It is never collapsed into 'ready', a fake error, or a dead control.
//      `degraded` maps to 'degraded' and never masquerades as fully ready.
//   3. A state either explains itself plainly, or explains itself AND offers
//      one recovery action. Controls are never shown without a real handler;
//      where nothing can be done, the state says so instead of showing a dead
//      button.

import type {
  CatalogItem,
  CapabilityStatus,
  FederatedSearchResult,
  OperationCapability,
  PlaybackPlan,
  SearchOutcomeClass,
  UnavailableReason,
} from "webflix-contracts";

/** The exhaustive honest-state vocabulary (freeze §2.3). */
export const HONEST_STATES = [
  "ready",
  "loading",
  "empty",
  "requires-auth",
  "rate-limited",
  "unsupported",
  "unavailable",
  "degraded",
  "status-unknown",
] as const;

export type HonestState = (typeof HONEST_STATES)[number];

/** CapabilityStatus → UI state. Total over every frozen CapabilityStatus. */
export function toHonestState(status: CapabilityStatus): HonestState {
  switch (status) {
    case "supported":
      return "ready";
    case "requires-auth":
      return "requires-auth";
    case "rate-limited":
      return "rate-limited";
    case "unsupported":
      return "unsupported";
    case "unavailable":
      return "unavailable";
    case "degraded":
      return "degraded";
    case "unknown":
      // Freeze §2.3: an inconclusive probe is reported as unknown, honestly.
      return "status-unknown";
    default: {
      // Exhaustiveness guard: if the freeze grows a new status, this fails fast
      // instead of rendering a dishonest state.
      const unhandled: never = status;
      throw new Error(`Unhandled CapabilityStatus: ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface HonestCopy {
  /** Short heading rendered to the user, verbatim. */
  readonly title: string;
  /** One or two sentences saying exactly what is (and is not) known. */
  readonly message: string;
  /** Label for the single recovery control, or null when nothing can be done — the state still explains itself. Absent is honest; dead is not. */
  readonly actionLabel: string | null;
}

export const HONEST_COPY: Record<HonestState, HonestCopy> = {
  ready: {
    title: "Ready",
    message: "Available now.",
    actionLabel: null,
  },
  loading: {
    title: "Loading…",
    message: "Checking what is actually available — nothing is assumed.",
    actionLabel: null,
  },
  empty: {
    title: "Nothing here yet",
    message: "The search finished and found no results. That is everything we know.",
    actionLabel: null,
  },
  "requires-auth": {
    title: "Sign-in required",
    message: "This capability needs a connected account before it can show anything.",
    actionLabel: "Connect account",
  },
  "rate-limited": {
    title: "Rate limited",
    message:
      "The provider quota is exhausted, so results are withheld rather than faked. Try again later.",
    actionLabel: null,
  },
  unsupported: {
    title: "Unsupported",
    message: "The current provider does not support this, so there is genuinely nothing to show.",
    actionLabel: null,
  },
  unavailable: {
    title: "Unavailable",
    message: "The provider could not serve this right now.",
    actionLabel: "Retry",
  },
  degraded: {
    title: "Degraded",
    message:
      "The provider is serving reduced or partial results right now. What you see below is what it actually returned.",
    actionLabel: null,
  },
  "status-unknown": {
    title: "Status unknown",
    message: "The capability check did not complete, so WebFlix cannot claim anything either way.",
    actionLabel: "Check again",
  },
};

/** OperationCapability → everything a screen needs to render one honest panel. */
export function describeCapability(capability: OperationCapability): {
  state: HonestState;
  copy: HonestCopy;
  detail?: string;
} {
  const state = toHonestState(capability.status);
  const copy = HONEST_COPY[state];
  return {
    state,
    copy,
    detail: capability.detail === "" ? undefined : capability.detail,
  };
}

/** Result-area phases for the Search screen — HonestState plus search bookends. */
export type SearchState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading"; readonly query: string }
  | {
      readonly phase: "results";
      readonly query: string;
      readonly items: readonly CatalogItem[];
      readonly budget?: SearchBudgetView;
    }
  | { readonly phase: "empty"; readonly query: string; readonly budget?: SearchBudgetView }
  | {
      readonly phase: "requires-auth";
      readonly query: string;
      readonly providerId: string;
    }
  | {
      readonly phase: "rate-limited";
      readonly query: string;
      readonly detail?: string;
      readonly budget?: SearchBudgetView;
    }
  | { readonly phase: "unsupported"; readonly query: string; readonly detail?: string }
  | { readonly phase: "unavailable"; readonly query: string; readonly detail?: string }
  | {
      readonly phase: "degraded";
      readonly query: string;
      readonly items: readonly CatalogItem[];
      readonly detail?: string;
      readonly budget?: SearchBudgetView;
    }
  | { readonly phase: "status-unknown"; readonly query: string; readonly detail?: string }
  // P7-COMPOSE-1 (WF-009 surface): the completed federated search — the
  // additive union member carrying the merged result verbatim.
  | FederatedSearchPhase;

/**
 * Shell-local view of the provider search budget (YOUTUBE-EXPAND: "surface
 * remaining-quota honestly in the shell"). STRUCTURAL by design: the app
 * layer maps the connector-side budget snapshot onto this view — the shell
 * never imports the connectors package (architecture-policy dependency
 * rules), and the view carries only what is rendered.
 */
export interface SearchBudgetView {
  /** ok | low | exhausted — the connector-side honest budget states. */
  readonly state: "ok" | "low" | "exhausted";
  readonly unitsRemainingToday: number;
  readonly unitsLimitToday: number;
  readonly searchCallsRemainingToday: number;
  /** True when the PROVIDER itself reported the day's quota exhausted. */
  readonly providerReportedExhaustion: boolean;
}

/**
 * One honest sentence about the remaining search budget. Quota is a
 * first-class UX state (the 100-calls/day default cap is real), so the
 * number is shown plainly — never hidden, never padded, never fabricated.
 * "Next quota day" is deliberately vague where the reset instant is
 * provider-side and not exposed by any official endpoint we call.
 */
export function budgetLine(view: SearchBudgetView): string {
  const units = `${view.unitsRemainingToday} of ${view.unitsLimitToday} quota units left today`;
  switch (view.state) {
    case "ok":
      return `Search budget: ${view.searchCallsRemainingToday} searches left today · ${units}.`;
    case "low":
      return `Search budget is running low: ${view.searchCallsRemainingToday} ${
        view.searchCallsRemainingToday === 1 ? "search" : "searches"
      } left today · ${units}.`;
    case "exhausted":
      return view.providerReportedExhaustion
        ? "Daily search quota is exhausted — the provider reported it. No search calls are made until the next quota day."
        : "Daily search budget is exhausted. No search calls are made until the next quota day.";
  }
}

/**
 * Map a capability probe (§2.3) onto the search results area.
 *
 * The provider being searched is caller context (the frozen
 * OperationCapability carries no providerId); pass it so the requires-auth
 * panel can offer the correct connect action. The optional budget view
 * (SearchBudgetView) is attached to the phases where quota is part of the
 * honest picture: results, empty, degraded, rate-limited.
 */
export function searchStateFromCapability(
  query: string,
  providerId: string,
  capability: OperationCapability,
  items?: readonly CatalogItem[],
  budget?: SearchBudgetView,
): SearchState {
  const detail = capability.detail === "" ? undefined : capability.detail;
  switch (capability.status) {
    case "supported":
      return items && items.length > 0
        ? { phase: "results", query, items, budget }
        : { phase: "empty", query, budget };
    case "requires-auth":
      return { phase: "requires-auth", query, providerId };
    case "rate-limited":
      return { phase: "rate-limited", query, detail, budget };
    case "unsupported":
      return { phase: "unsupported", query, detail };
    case "unavailable":
      return { phase: "unavailable", query, detail };
    case "degraded":
      // Partial results are shown, clearly flagged — never hidden, never
      // dressed up as fully ready.
      return { phase: "degraded", query, items: items ?? [], detail, budget };
    case "unknown":
      return { phase: "status-unknown", query, detail };
  }
}

// ---------------------------------------------------------------------------
// Federated search coverage (P7-COMPOSE-1 — the WF-009 surface half, mounting
// the MERGED P7-SEARCH-1 contract shapes AS-IS: zero engine changes)
// ---------------------------------------------------------------------------

/**
 * One per-source honest row of the federated coverage view — the flattened
 * join of a {@link FederatedSearchResult}'s coverage row with its outcomes
 * entry. `reason` is the outcome's own honest reason (null only for `ok`,
 * which carries none); `returned` is the row tally only, never a
 * completeness claim. Mirrored here as the VIEW the SearchScreen renders;
 * the shapes it reads are the contract's own (a declared shell dependency).
 */
export interface FederatedSourceRowView {
  /** The source id — the registry id space, verbatim. */
  readonly source: string;
  /** The outcome class this source answered with. */
  readonly outcome: SearchOutcomeClass;
  /** Row tallies only: the rows the source returned (0 for non-item states). */
  readonly returned: number;
  /** How long this source's call took, in milliseconds. */
  readonly elapsedMs: number;
  /** The non-ok outcome's own reason, verbatim; null for `ok` (it has none). */
  readonly reason: string | null;
}

/**
 * Flattens a federated result into the per-source coverage rows the screen
 * renders — one row per coverage entry, in the result's stable fan-out
 * order. NEVER hides a source: the mapping is total over `coverage` (the
 * contract's superRefine pins coverage/outcomes agreement; a smuggled-in
 * result missing an outcomes entry still renders its coverage row, with no
 * reason rather than a fabricated one).
 */
export function federatedSourceRows(
  result: FederatedSearchResult,
): readonly FederatedSourceRowView[] {
  return result.coverage.map((row) => {
    const outcome = result.outcomes[row.source];
    const reason = outcome !== undefined && outcome.status !== "ok" ? outcome.reason : null;
    return {
      source: row.source,
      outcome: row.outcome,
      returned: row.counts.returned,
      elapsedMs: row.elapsedMs,
      reason,
    };
  });
}

/** The outcome classes in canonical display order. */
const OUTCOME_CLASS_ORDER: readonly SearchOutcomeClass[] = [
  "ok",
  "partial-failure",
  "timeout",
  "auth-required",
  "unsupported",
];

/**
 * The one-line source-coverage summary: how many sources answered, the
 * tally per outcome class, and the merged-item count. Plain counts only —
 * never a completeness claim (a source with 0 rows answered honestly too).
 */
export function federatedCoverageSummaryLine(result: FederatedSearchResult): string {
  const tally = new Map<SearchOutcomeClass, number>();
  for (const row of result.coverage) {
    tally.set(row.outcome, (tally.get(row.outcome) ?? 0) + 1);
  }
  const parts = OUTCOME_CLASS_ORDER.filter((cls) => (tally.get(cls) ?? 0) > 0).map(
    (cls) => `${tally.get(cls)} ${cls}`,
  );
  const total = result.coverage.length;
  const merged = result.items.length;
  return `Source coverage: ${total} ${total === 1 ? "source" : "sources"} answered — ${parts.join(", ")} · ${merged} merged ${merged === 1 ? "item" : "items"}.`;
}

/** Result-area phase for a completed FEDERATED search (WF-009 surface). */
export interface FederatedSearchPhase {
  readonly phase: "federated";
  readonly query: string;
  /**
   * The federated result, verbatim as the contract defines it — per-source
   * outcomes, coverage rows, and the merged item view. The screen composes
   * from this AS-IS; nothing is recomputed or re-ranked here.
   */
  readonly result: FederatedSearchResult;
  readonly budget?: SearchBudgetView;
}

/** The search state for a completed federated search (additive union member). */
export function federatedSearchState(
  query: string,
  result: FederatedSearchResult,
  budget?: SearchBudgetView,
): SearchState {
  return { phase: "federated", query, result, budget };
}

// ---------------------------------------------------------------------------
// Player-controls view (P7-COMPOSE-1 — the WF-006 surface half, mounting the
// MERGED P7-PLAYER-1 typed ControlsAvailability matrix AS-IS)
// ---------------------------------------------------------------------------

/**
 * The seven WF-006 controls in canonical order — the structural VIEW of the
 * playback package's PLAYER_CONTROL_IDS (the engine's own ids, mirrored so
 * this module stays the single rendering vocabulary).
 */
export const PLAYER_CONTROL_IDS_VIEW = [
  "playPause",
  "seek",
  "volume",
  "captions",
  "queueAdd",
  "miniPlayer",
  "pip",
] as const;
export type PlayerControlIdView = (typeof PLAYER_CONTROL_IDS_VIEW)[number];

/**
 * An available control, with the typed capability facts that back it
 * (STRUCTURAL: the engine's ControlAvailability accepts as-is — the shell
 * never imports the playback package, per the architecture-policy
 * dependency rules; the app layer passes the derived matrix directly).
 */
export interface PlayerControlAvailableView {
  readonly state: "available";
  readonly facts: readonly string[];
}

/** An unavailable control, with its typed reason and readable explanation. */
export interface PlayerControlUnavailableView {
  readonly state: "unavailable";
  readonly reason: string;
  readonly detail: string;
}

/** Per-control availability: available with facts, or unavailable with a reason. */
export type PlayerControlAvailabilityView =
  | PlayerControlAvailableView
  | PlayerControlUnavailableView;

/** An available seek control; the position bound is data, null when unknown. */
export interface PlayerSeekAvailableView extends PlayerControlAvailableView {
  readonly boundMs: number | null;
}

/** Seek-specific availability (adds the position bound to the union). */
export type PlayerSeekAvailabilityView = PlayerSeekAvailableView | PlayerControlUnavailableView;

/**
 * The ControlsAvailability-shaped view one plan's controls strip renders:
 * the plan variant it was derived from plus the seven typed control states.
 * STRUCTURAL by design (the SearchBudgetView precedent): the playback
 * package's deriveControls() output satisfies this shape as-is through
 * TypeScript structural typing — no mapping code, no engine import, no
 * invented defaults. The host derives and passes; the shell renders.
 */
export interface PlayerControlsView {
  /** The plan variant this availability was derived from. */
  readonly planKind: PlaybackPlan["kind"];
  /** Present iff planKind is "unavailable": the frozen plan's own typed reason. */
  readonly unavailableReason?: UnavailableReason;
  readonly playPause: PlayerControlAvailabilityView;
  readonly seek: PlayerSeekAvailabilityView;
  readonly volume: PlayerControlAvailabilityView;
  readonly captions: PlayerControlAvailabilityView;
  readonly queueAdd: PlayerControlAvailabilityView;
  readonly miniPlayer: PlayerControlAvailabilityView;
  readonly pip: PlayerControlAvailabilityView;
}

/** The non-seek control ids (the seek row renders its own honest bound line). */
export type PlayerNonSeekControlIdView = Exclude<PlayerControlIdView, "seek">;

/** Human labels for the seven controls (display order = canonical order). */
export const PLAYER_CONTROL_LABELS: Record<PlayerControlIdView, string> = {
  playPause: "Play / pause",
  seek: "Seek",
  volume: "Volume",
  captions: "Captions",
  queueAdd: "Add to queue",
  miniPlayer: "Mini-player",
  pip: "Picture-in-picture",
};

/**
 * The honest seek-bound sentence for an available seek control: the known
 * duration bound, or the explicit "not known" statement — never a
 * fabricated bound. Unavailable seek controls render their own typed state
 * instead (this line is not for them).
 */
export function seekBoundLine(seek: PlayerSeekAvailableView): string {
  return seek.boundMs === null
    ? "Seek bound: unknown — the item duration is not known, so none is fabricated."
    : `Seek bound: ${seek.boundMs}ms (the known item duration).`;
}
