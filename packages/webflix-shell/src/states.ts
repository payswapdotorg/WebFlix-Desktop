// Honest-state vocabulary — freeze §2.3 (binding).
//
// Rules encoded here:
//   1. Every CapabilityStatus maps to exactly one UI state — the mapping is
//      total, with a fail-fast guard, so no fallback can invent a success.
//   2. `unknown` maps to 'status-unknown' and renders as "Status unknown".
//      It is never collapsed into 'ready', a fake error, or a dead control.
//   3. A state either explains itself plainly, or explains itself AND offers
//      one recovery action. Controls are never shown without a real handler;
//      where nothing can be done, the state says so instead of showing a dead
//      button.

import type { CapabilityStatus, CatalogItem } from './contract-types';

/** The exhaustive honest-state vocabulary (freeze §2.3). */
export const HONEST_STATES = [
  'ready',
  'loading',
  'empty',
  'requires-auth',
  'rate-limited',
  'unsupported',
  'unavailable',
  'status-unknown',
] as const;

export type HonestState = (typeof HONEST_STATES)[number];

/** CapabilityStatus → UI state. Total over every `kind` of CapabilityStatus. */
export function toHonestState(status: CapabilityStatus): HonestState {
  switch (status.kind) {
    case 'available':
      return 'ready';
    case 'requires-auth':
      return 'requires-auth';
    case 'rate-limited':
      return 'rate-limited';
    case 'unsupported':
      return 'unsupported';
    case 'unavailable':
      return 'unavailable';
    case 'unknown':
      // Freeze §2.3: an inconclusive probe is reported as unknown, honestly.
      return 'status-unknown';
    default: {
      // Exhaustiveness guard: if the freeze grows a new kind, this fails fast
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
    title: 'Ready',
    message: 'Available now.',
    actionLabel: null,
  },
  loading: {
    title: 'Loading…',
    message: 'Checking what is actually available — nothing is assumed.',
    actionLabel: null,
  },
  empty: {
    title: 'Nothing here yet',
    message: 'The search finished and found no results. That is everything we know.',
    actionLabel: null,
  },
  'requires-auth': {
    title: 'Sign-in required',
    message: 'This capability needs a connected account before it can show anything.',
    actionLabel: 'Connect account',
  },
  'rate-limited': {
    title: 'Rate limited',
    message:
      'The provider quota is exhausted, so results are withheld rather than faked. Try again later.',
    actionLabel: null,
  },
  unsupported: {
    title: 'Unsupported',
    message: 'The current provider does not support this, so there is genuinely nothing to show.',
    actionLabel: null,
  },
  unavailable: {
    title: 'Unavailable',
    message: 'The provider could not serve this right now.',
    actionLabel: 'Retry',
  },
  'status-unknown': {
    title: 'Status unknown',
    message: 'The capability check did not complete, so WebFlix cannot claim anything either way.',
    actionLabel: 'Check again',
  },
};

/** CapabilityStatus → everything a screen needs to render one honest panel. */
export function describeCapability(status: CapabilityStatus): {
  state: HonestState;
  copy: HonestCopy;
  detail?: string;
} {
  const state = toHonestState(status);
  const copy = HONEST_COPY[state];
  let detail: string | undefined;
  switch (status.kind) {
    case 'unsupported':
    case 'unavailable':
      detail = status.reason;
      break;
    case 'rate-limited':
      detail =
        status.retryAfterSeconds === undefined
          ? undefined
          : `Quota should reset in about ${status.retryAfterSeconds}s.`;
      break;
    case 'unknown':
      detail = status.detail;
      break;
    default:
      detail = undefined;
  }
  return { state, copy, detail };
}

/** Result-area phases for the Search screen — HonestState plus search bookends. */
export type SearchState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'loading'; readonly query: string }
  | { readonly phase: 'results'; readonly query: string; readonly items: readonly CatalogItem[] }
  | { readonly phase: 'empty'; readonly query: string }
  | {
      readonly phase: 'requires-auth';
      readonly query: string;
      readonly providerId: string;
      readonly connectUrl?: string;
    }
  | { readonly phase: 'rate-limited'; readonly query: string; readonly retryAfterSeconds?: number }
  | { readonly phase: 'unsupported'; readonly query: string; readonly reason: string }
  | { readonly phase: 'unavailable'; readonly query: string; readonly reason: string }
  | { readonly phase: 'status-unknown'; readonly query: string; readonly detail?: string };

/** Map a capability probe (§2.3) onto the search results area. */
export function searchStateFromCapability(
  query: string,
  status: CapabilityStatus,
  items?: readonly CatalogItem[],
): SearchState {
  switch (status.kind) {
    case 'available':
      return items && items.length > 0
        ? { phase: 'results', query, items }
        : { phase: 'empty', query };
    case 'requires-auth':
      return {
        phase: 'requires-auth',
        query,
        providerId: status.providerId,
        connectUrl: status.connectUrl,
      };
    case 'rate-limited':
      return { phase: 'rate-limited', query, retryAfterSeconds: status.retryAfterSeconds };
    case 'unsupported':
      return { phase: 'unsupported', query, reason: status.reason };
    case 'unavailable':
      return { phase: 'unavailable', query, reason: status.reason };
    case 'unknown':
      return { phase: 'status-unknown', query, detail: status.detail };
  }
}
