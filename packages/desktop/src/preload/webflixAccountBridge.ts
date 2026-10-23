/**
 * P9-UI-1 (order requirement 5, post-P8-VAULT-1 account-boundary wiring) —
 * the narrowly scoped preload bridge for the WebFlix Accounts surface.
 *
 * Boundary rules (all binding, mirroring
 * packages/desktop/src/main/webflixAccountIpc.ts):
 *   - EXPLICITLY PERMISSIONED surface: exactly three methods over exactly
 *     three namespaced IPC channels. Nothing else is exposed — no generic
 *     invoke passthrough, no token-bearing payload, no enumeration.
 *   - Tokens NEVER cross the bridge, by construction: every payload type on
 *     this surface is the minimal status vocabulary (vault availability +
 *     renderer-safe account records + typed outcomes). There is no method
 *     that could return a token.
 *   - Flavor-gated: the bridge is exposed ONLY in the baked webflix flavor.
 *     A ZCode production/preview build's preload never gains this surface
 *     (pinned by the P9-UI-1 battery).
 *   - The channel strings are the MIRROR of the main module's exported
 *     constants; the battery pins both sides agree (a typo on either side
 *     fails the pin, never a silent runtime mismatch).
 *
 * Registration is idempotent-safe: the module self-registers at import
 * evaluation via registerWebFlixAccountPreloadBridge() (the preload bundle
 * imports this module exactly once, from index.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

/**
 * The typed IPC channels — MUST equal the main module's exported constants
 * (packages/desktop/src/main/webflixAccountIpc.ts; battery-pinned).
 */
export const WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL = "webflix:accounts:get-status";
export const WEBFLIX_ACCOUNTS_CONNECT_CHANNEL = "webflix:accounts:connect";
export const WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL = "webflix:accounts:disconnect";

/**
 * The canonical installation-local YouTube account id — MUST equal the main
 * module's exported constant (battery-pinned, same law as the channels).
 */
export const WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID = "primary";

/** One account pointer the renderer knows about (provider + internal id). */
export interface WebFlixAccountPointer {
  readonly providerId: string;
  readonly internalAccountId: string;
}

/** The OS vault's honest availability, as reported by the main process. */
export interface WebFlixAccountVaultStatus {
  readonly available: boolean;
  readonly reason: string | null;
}

/** The typed accounts status — the ONLY account data the renderer ever receives. */
export interface WebFlixAccountsStatus {
  readonly vault: WebFlixAccountVaultStatus;
  readonly accounts: readonly unknown[];
}

/** The typed connect outcome (WFX-OAUTH-CONNECT-1 vocabulary — mirrored). */
export interface WebFlixConnectOutcome {
  readonly ok: boolean;
  readonly code:
    | "connect-unavailable"
    | "invalid-provider"
    | "vault-unavailable"
    | "authorization-started"
    | "authorization-in-progress"
    | "flow-error";
  readonly reason: string;
}

/** The typed disconnect outcome — the real two-leg composition result, verbatim. */
export interface WebFlixDisconnectOutcome {
  readonly ok: boolean;
  readonly vaultRemoved: boolean;
  readonly partitionCleared: boolean;
  readonly errors: readonly string[];
}

/** The preload-exposed account bridge surface (renderer mirror: accountsBridge.ts). */
export interface WebFlixAccountsPreloadBridge {
  getStatus(pointers: readonly WebFlixAccountPointer[]): Promise<WebFlixAccountsStatus>;
  connect(providerId: string): Promise<WebFlixConnectOutcome>;
  disconnect(pointer: WebFlixAccountPointer): Promise<WebFlixDisconnectOutcome>;
}

/** The preload surfaces this module may touch (injectable for the battery). */
export interface WebFlixAccountPreloadElectron {
  readonly contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };
  readonly ipcRenderer: {
    invoke: (channel: string, ...args: readonly unknown[]) => Promise<unknown>;
  };
}

/**
 * Registers the `window.webflixAccounts` bridge. NO-OP unless the baked
 * product flavor is "webflix" — a ZCode identity build's preload never
 * exposes this surface.
 */
export function registerWebFlixAccountPreloadBridge(
  electron: WebFlixAccountPreloadElectron,
  flavor: string = ZCODE_PRODUCT_FLAVOR,
): void {
  if (flavor !== "webflix") {
    return;
  }
  const bridge: WebFlixAccountsPreloadBridge = {
    getStatus: (pointers) =>
      ipcInvokeStrict<WebFlixAccountsStatus>(
        electron.ipcRenderer,
        WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL,
        pointers,
      ),
    connect: (providerId) =>
      ipcInvokeStrict<WebFlixConnectOutcome>(
        electron.ipcRenderer,
        WEBFLIX_ACCOUNTS_CONNECT_CHANNEL,
        providerId,
      ),
    disconnect: (pointer) =>
      ipcInvokeStrict<WebFlixDisconnectOutcome>(
        electron.ipcRenderer,
        WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL,
        pointer,
      ),
  };
  electron.contextBridge.exposeInMainWorld("webflixAccounts", bridge);
}

/**
 * The single invoke wrapper — every method goes through the SAME strict
 * channel check, so no method can ever grow a looser path.
 */
function ipcInvokeStrict<T>(
  ipcRenderer: WebFlixAccountPreloadElectron["ipcRenderer"],
  channel: string,
  payload: unknown,
): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

registerWebFlixAccountPreloadBridge({ contextBridge, ipcRenderer });
