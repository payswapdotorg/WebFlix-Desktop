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

import type { CatalogItem, CapabilityStatus, OperationCapability } from "webflix-contracts";

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
  | { readonly phase: "results"; readonly query: string; readonly items: readonly CatalogItem[] }
  | { readonly phase: "empty"; readonly query: string }
  | {
      readonly phase: "requires-auth";
      readonly query: string;
      readonly providerId: string;
    }
  | { readonly phase: "rate-limited"; readonly query: string; readonly detail?: string }
  | { readonly phase: "unsupported"; readonly query: string; readonly detail?: string }
  | { readonly phase: "unavailable"; readonly query: string; readonly detail?: string }
  | {
      readonly phase: "degraded";
      readonly query: string;
      readonly items: readonly CatalogItem[];
      readonly detail?: string;
    }
  | { readonly phase: "status-unknown"; readonly query: string; readonly detail?: string };

/**
 * Map a capability probe (§2.3) onto the search results area.
 *
 * The provider being searched is caller context (the frozen
 * OperationCapability carries no providerId); pass it so the requires-auth
 * panel can offer the correct connect action.
 */
export function searchStateFromCapability(
  query: string,
  providerId: string,
  capability: OperationCapability,
  items?: readonly CatalogItem[],
): SearchState {
  const detail = capability.detail === "" ? undefined : capability.detail;
  switch (capability.status) {
    case "supported":
      return items && items.length > 0
        ? { phase: "results", query, items }
        : { phase: "empty", query };
    case "requires-auth":
      return { phase: "requires-auth", query, providerId };
    case "rate-limited":
      return { phase: "rate-limited", query, detail };
    case "unsupported":
      return { phase: "unsupported", query, detail };
    case "unavailable":
      return { phase: "unavailable", query, detail };
    case "degraded":
      // Partial results are shown, clearly flagged — never hidden, never
      // dressed up as fully ready.
      return { phase: "degraded", query, items: items ?? [], detail };
    case "unknown":
      return { phase: "status-unknown", query, detail };
  }
}
