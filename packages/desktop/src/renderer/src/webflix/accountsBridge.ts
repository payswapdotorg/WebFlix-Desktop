/**
 * P9-UI-1 (requirement 5) — the renderer-side account bridge accessor.
 *
 * The Accounts surface talks to the REAL main-process OS vault
 * (P8-VAULT-1's createOsVaultAccountStore) through the explicitly
 * permissioned preload bridge (`window.webflixAccounts`, exposed by
 * packages/desktop/src/preload/webflixAccountBridge.ts over the
 * narrowly-scoped IPC channels registered by
 * packages/desktop/src/main/webflixAccountIpc.ts).
 *
 * Boundary rules this module encodes:
 *   - Tokens NEVER cross the bridge. The bridge's typed payloads carry only
 *     the minimal status vocabulary below (vault availability + the
 *     renderer-safe ProviderAccountRecord shapes). There is no method that
 *     could return a token, by construction.
 *   - Fail-closed everywhere: when the bridge is ABSENT (a plain web build,
 *     a test DOM, or a runtime that did not load the preload module), the
 *     accessor returns null and the host renders the typed
 *     "bridge unavailable" honest state — it never fabricates accounts and
 *     never pretends the vault was queried.
 *   - The payload interfaces here are the renderer-side MIRROR of the main
 *     module's payload types; the P9-UI-1 battery pins the channel strings
 *     and payload shapes on both sides (see __tests__/accountsBridge.test.ts
 *     and webflixAccountIpc.test.ts).
 */
import type { ProviderAccountRecord } from "../../../../../webflix-contracts/src/index.js";

/** One account pointer the renderer knows about (provider + internal id). */
export interface WebFlixAccountPointer {
  readonly providerId: string;
  readonly internalAccountId: string;
}

/** The OS vault's honest availability, as reported by the main process. */
export interface WebFlixAccountVaultStatus {
  /** False when safeStorage/secure storage is unavailable (fail-closed) or the vault cannot be constructed. */
  readonly available: boolean;
  /** The typed refusal reason when unavailable; null when available. */
  readonly reason: string | null;
}

/** The typed accounts status — the ONLY account data the renderer ever receives. */
export interface WebFlixAccountsStatus {
  readonly vault: WebFlixAccountVaultStatus;
  /** Real vault records for the pointers asked about; absent pointers simply do not appear. */
  readonly accounts: readonly ProviderAccountRecord[];
}

/** The typed connect outcome. In this build connect is honestly UNAVAILABLE (no operator OAuth client). */
export interface WebFlixConnectOutcome {
  readonly ok: boolean;
  readonly code: "connect-unavailable" | "invalid-provider";
  /** The honest human-readable reason, verbatim from the main process. */
  readonly reason: string;
}

/** The typed disconnect outcome — the real two-leg composition result, verbatim. */
export interface WebFlixDisconnectOutcome {
  readonly ok: boolean;
  readonly vaultRemoved: boolean;
  readonly partitionCleared: boolean;
  readonly errors: readonly string[];
}

/** The preload-exposed account bridge surface (see preload/webflixAccountBridge.ts). */
export interface WebFlixAccountsBridge {
  getStatus(pointers: readonly WebFlixAccountPointer[]): Promise<WebFlixAccountsStatus>;
  connect(providerId: string): Promise<WebFlixConnectOutcome>;
  disconnect(pointer: WebFlixAccountPointer): Promise<WebFlixDisconnectOutcome>;
}

declare global {
  interface Window {
    readonly webflixAccounts?: WebFlixAccountsBridge;
  }
}

/**
 * The live bridge, or null when it is not present. Callers MUST treat null
 * as the typed "bridge unavailable" state (fail-closed) — never retry-storm
 * and never invent data.
 */
export function getWebFlixAccountsBridge(): WebFlixAccountsBridge | null {
  const candidate = (globalThis as { window?: { webflixAccounts?: unknown } }).window
    ?.webflixAccounts;
  if (candidate == null || typeof candidate !== "object") {
    return null;
  }
  const bridge = candidate as Partial<WebFlixAccountsBridge>;
  if (
    typeof bridge.getStatus !== "function" ||
    typeof bridge.connect !== "function" ||
    typeof bridge.disconnect !== "function"
  ) {
    return null;
  }
  return bridge as WebFlixAccountsBridge;
}

/** The typed "bridge unavailable" status the host renders when the bridge is absent. */
export function bridgeUnavailableStatus(): WebFlixAccountsStatus {
  return {
    vault: {
      available: false,
      reason:
        "account-bridge-unavailable — the desktop account bridge is not present in this runtime, " +
        "so no account state can be shown (fail-closed; nothing is invented)",
    },
    accounts: [],
  };
}
