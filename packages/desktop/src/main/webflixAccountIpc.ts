/**
 * P9-UI-1 (order requirement 5, post-P8-VAULT-1 account-boundary wiring) —
 * the explicitly-permissioned IPC surface between the WebFlix renderer's
 * Accounts UI and the REAL main-process OS vault.
 *
 * Boundary rules (all binding, from the work order + freeze §6.2):
 *   - Tokens stay in the main-process OS vault (P8-VAULT-1's
 *     createOsVaultAccountStore). The renderer receives ONLY the minimal
 *     typed status vocabulary defined here — there is NO payload anywhere
 *     on this surface that could carry a token, by construction.
 *   - Consumption, never modification: this module CONSUMES
 *     createOsVaultAccountStore and disconnectProviderAccount (the P8-VAULT-1
 *     ruling-6 two-leg disconnect composition) exactly as exported. The
 *     vault implementation, providerDisconnectClear.ts and everything under
 *     src/main/webflix/** are untouched.
 *   - Fail-closed: when Electron safeStorage is unavailable (e.g. Linux
 *     without a keyring backend), or the WebFlix data-root identity contract
 *     is absent, the status surface answers with the typed
 *     `{ available: false, reason }` refusal — a REAL error state the UI
 *     renders, never a fallback that pretends the vault was queried.
 *   - Honesty: connect is honestly UNAVAILABLE when the environment has no
 *     operator-provisioned OAuth client (freeze AS-Q3's provisioning half is
 *     CLOSED by WFX-OAUTH-CONNECT-1: env WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID +
 *     WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET, or <dataRoot>/youtube-oauth-client.json).
 *     With the client provisioned, connect starts the REAL loopback+PKCE flow
 *     (webflix/oauthConnectFlow.ts over the frozen YouTubeOAuthSession) and
 *     the typed outcome says exactly what started — never "connected" until
 *     the vault actually holds the record.
 *   - Registration is flavor-gated: the channels exist ONLY in the baked
 *     webflix flavor (zero ZCode-build surface).
 *
 * The channel strings and payload shapes are mirrored by
 * packages/desktop/src/preload/webflixAccountBridge.ts (the preload bridge)
 * and packages/desktop/src/renderer/src/webflix/accountsBridge.ts (the
 * renderer accessor); the P9-UI-1 battery pins the mirrors agree.
 */
import { ipcMain, safeStorage as electronSafeStorage, shell } from "electron";
import type { ProviderAccountRecord } from "webflix-contracts";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { createOsVaultAccountStore, resolveWebFlixVaultDataRoot, OsVaultError } from "./webflix/osVaultAccountStore.js";
import { disconnectProviderAccount } from "./providerDisconnectClear.js";
import {
  buildYouTubeLoopbackConfig,
  createGoogleHttpTokenFetcher,
  resolveYouTubeOAuthClient,
  YouTubeConnectFlowManager,
  type YouTubeOAuthClientCredentials,
} from "./webflix/oauthConnectFlow.js";
/** The typed IPC channels (namespaced; mirror-pinned by the battery). */
export const WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL = "webflix:accounts:get-status";
export const WEBFLIX_ACCOUNTS_CONNECT_CHANNEL = "webflix:accounts:connect";
export const WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL = "webflix:accounts:disconnect";

/**
 * The canonical installation-local YouTube account id (frozen §2.5
 * vocabulary; single-account-per-installation is the current honest scope).
 * Mirrored by the preload bridge + renderer accessor; battery-pinned.
 */
export const WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID = "primary";

// ---------------------------------------------------------------------------
// Typed payload contracts — the renderer-safe mirror (accountsBridge.ts).
// Type-only imports of webflix-contracts follow the osVaultAccountStore.ts
// precedent (erased at compile time; the desktop package gains no runtime
// dependency; desktop main tsc is not a repo gate — P8-RELEASE-DRIFT-1).
// ---------------------------------------------------------------------------

/** One account pointer the renderer knows about (provider + internal id). */
export interface WebFlixAccountPointer {
  readonly providerId: string;
  readonly internalAccountId: string;
}

/** The OS vault's honest availability. */
export interface WebFlixAccountVaultStatus {
  readonly available: boolean;
  readonly reason: string | null;
}

/** The typed accounts status — the ONLY account data the renderer ever receives. */
export interface WebFlixAccountsStatus {
  readonly vault: WebFlixAccountVaultStatus;
  readonly accounts: readonly ProviderAccountRecord[];
}

/** The typed connect outcome (WFX-OAUTH-CONNECT-1 vocabulary). */
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

/** The safeStorage surface consumed here (injectable for tests). */
type SafeStorageLike = import("electron").SafeStorage;

/** The register options (all injectable for the battery). */
export interface RegisterWebFlixAccountIpcOptions {
  readonly logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  readonly safeStorage?: SafeStorageLike;
  /** Vault store factory override (tests inject a store double). */
  readonly createVaultStore?: (providerId: string) => ReturnType<typeof createOsVaultAccountStore>;
  /** The baked product flavor (default: the ZCODE_PRODUCT_FLAVOR runtime constant). */
  readonly flavor?: string;
  /** Injectable client resolution (tests); default: env then data-root file. */
  readonly resolveClient?: () => YouTubeOAuthClientCredentials | null;
  /** Injectable token fetcher factory (tests); default: the real Google HTTP fetcher. */
  readonly createTokenFetcher?: (client: YouTubeOAuthClientCredentials) => ReturnType<typeof createGoogleHttpTokenFetcher>;
  /** Injectable system-browser opener (tests); default: shell.openExternal. */
  readonly openBrowser?: (url: string) => Promise<void>;
  /** Injectable env (tests); default: process.env (reads WEBFLIX_YOUTUBE_OAUTH_OPEN). */
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable connect-flow manager (tests); default: one shared manager. */
  readonly connectManager?: YouTubeConnectFlowManager;
  /** The bounded flow lifetime override (tests; default 300s). */
  readonly flowTimeoutMs?: number;
}

/** The providers whose accounts this surface may ever address (the shell's known set — cited, not invented). */
const KNOWN_PROVIDER_IDS: ReadonlySet<string> = new Set(["youtube"]);

/** Defensive request bound: the pointer list is renderer-supplied; keep it trivially small. */
const MAX_POINTERS_PER_STATUS_REQUEST = 32;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Parses + bounds the renderer-supplied pointer list; malformed input → null (refused, typed below). */
function parsePointers(payload: unknown): WebFlixAccountPointer[] | null {
  if (!Array.isArray(payload) || payload.length > MAX_POINTERS_PER_STATUS_REQUEST) {
    return null;
  }
  const pointers: WebFlixAccountPointer[] = [];
  for (const entry of payload) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const candidate = entry as { providerId?: unknown; internalAccountId?: unknown };
    if (!isNonEmptyString(candidate.providerId) || !isNonEmptyString(candidate.internalAccountId)) {
      return null;
    }
    if (!KNOWN_PROVIDER_IDS.has(candidate.providerId.trim())) {
      return null;
    }
    pointers.push({
      providerId: candidate.providerId.trim(),
      internalAccountId: candidate.internalAccountId.trim(),
    });
  }
  return pointers;
}

/** Maps any thrown value to a short typed reason string (no token material can appear — nothing sensitive is ever in scope). */
function typedRefusalReason(error: unknown): string {
  if (error instanceof OsVaultError) {
    return `${error.code}: ${error.message}`;
  }
  return `webflix-account-ipc: ${String((error as Error)?.message ?? error)}`;
}

/**
 * The honest connect refusal wording for an environment with NO provisioned
 * operator OAuth client (WFX-OAUTH-CONNECT-1): no authorization flow can
 * start. Surfaced verbatim; never dressed up as supported.
 */
export function connectUnavailableReason(providerId: string): string {
  return (
    `Connect for "${providerId}" is not available in this environment: WebFlix has no ` +
    "operator-provisioned OAuth client configured (set WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID + " +
    "WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET in the main-process environment, or write " +
    "youtube-oauth-client.json under the WebFlix data root), so no authorization flow can " +
    "start and nothing was authorized. Official YouTube links still play through the public " +
    "embed without an account."
  );
}

/**
 * Registers the WebFlix account IPC channels. NO-OP unless the baked product
 * flavor is "webflix" — a ZCode identity build never gains this surface.
 */
export function registerWebFlixAccountIpc(options: RegisterWebFlixAccountIpcOptions): void {
  const flavor = options.flavor ?? ZCODE_PRODUCT_FLAVOR;
  if (flavor !== "webflix") {
    return;
  }
  const backend = options.safeStorage ?? electronSafeStorage;
  // The default vault factory threads the SAME backend + logger this surface
  // checked, so an injected test backend governs both the availability gate
  // and the store (the real runtime uses Electron safeStorage for both).
  const createVaultStore =
    options.createVaultStore ??
    ((providerId: string) =>
      createOsVaultAccountStore(providerId, { safeStorage: backend, logger: options.logger }));
  // The operator client resolution (WFX-OAUTH-CONNECT-1): env first, then the
  // user-managed data-root file. An unavailable data-root env contract simply
  // means the file source cannot exist → env-only (honest not-configured).
  const resolveClient =
    options.resolveClient ??
    ((): YouTubeOAuthClientCredentials | null => {
      let dataRoot: string | undefined;
      try {
        dataRoot = resolveWebFlixVaultDataRoot(options.env ?? process.env);
      } catch {
        dataRoot = undefined;
      }
      return resolveYouTubeOAuthClient({ env: options.env ?? process.env, dataRoot });
    });
  const createTokenFetcher =
    options.createTokenFetcher ??
    ((client: YouTubeOAuthClientCredentials) =>
      createGoogleHttpTokenFetcher(client.clientId, client.clientSecret));
  const connectManager =
    options.connectManager ??
    new YouTubeConnectFlowManager(
      options.flowTimeoutMs !== undefined ? { flowTimeoutMs: options.flowTimeoutMs } : {},
    );

  ipcMain.handle(
    WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL,
    async (_event, payload: unknown): Promise<WebFlixAccountsStatus> => {
      const pointers = parsePointers(payload);
      if (pointers === null) {
        options.logger.warn("[webflix-accounts] refusing a malformed status request");
        return {
          vault: {
            available: false,
            reason:
              "webflix-account-ipc: malformed status request refused (fail-closed; no account state is shown)",
          },
          accounts: [],
        };
      }

      // Fail-closed availability first: without OS secure storage the vault
      // refuses writes AND encrypted reads cannot be decrypted — the typed
      // refusal IS the real state; no account data is ever invented.
      if (!backend.isEncryptionAvailable()) {
        options.logger.warn(
          "[webflix-accounts] OS secure storage unavailable — reporting the typed fail-closed status",
        );
        return {
          vault: {
            available: false,
            reason:
              "os_vault_unavailable: Electron safeStorage is unavailable on this system " +
              "(e.g. Linux without a keyring/secret-service backend) — account sign-in cannot be " +
              "offered until OS secure storage exists; WebFlix never falls back to plaintext storage",
          },
          accounts: [],
        };
      }

      try {
        // Keyed lookups only (the frozen seam has no enumeration); absent
        // pointers simply do not appear in the response.
        const stores = new Map<string, ReturnType<typeof createVaultStore>>();
        const accounts: ProviderAccountRecord[] = [];
        for (const pointer of pointers) {
          const store = stores.get(pointer.providerId) ?? createVaultStore(pointer.providerId);
          stores.set(pointer.providerId, store);
          const record = await store.loadAccount(pointer.internalAccountId);
          if (record !== null) {
            accounts.push(record);
          }
        }
        return { vault: { available: true, reason: null }, accounts };
      } catch (error) {
        options.logger.warn(
          "[webflix-accounts] vault status read refused (fail-closed)",
          typedRefusalReason(error),
        );
        return {
          vault: { available: false, reason: typedRefusalReason(error) },
          accounts: [],
        };
      }
    },
  );

  ipcMain.handle(
    WEBFLIX_ACCOUNTS_CONNECT_CHANNEL,
    async (_event, payload: unknown): Promise<WebFlixConnectOutcome> => {
      const providerId = typeof payload === "string" ? payload.trim() : "";
      if (!isNonEmptyString(providerId) || !KNOWN_PROVIDER_IDS.has(providerId)) {
        options.logger.warn("[webflix-accounts] refusing connect for an unknown provider", payload);
        return {
          ok: false,
          code: "invalid-provider",
          reason: `webflix-account-ipc: "${String(payload)}" is not a provider this build knows; nothing was authorized.`,
        };
      }
      // Fail-closed vault gate FIRST: without OS secure storage the flow's
      // tokens could never be persisted encrypted — refusing to even start is
      // the honest state (never a plaintext fallback, never a doomed flow).
      if (!backend.isEncryptionAvailable()) {
        options.logger.warn(
          "[webflix-accounts] connect refused: OS secure storage unavailable (fail-closed; no flow starts)",
          { providerId },
        );
        return {
          ok: false,
          code: "vault-unavailable",
          reason:
            "os_vault_unavailable: Electron safeStorage is unavailable on this system (e.g. Linux " +
            "without a keyring/secret-service backend) — connect cannot be offered because the " +
            "authorization tokens could not be stored encrypted at rest; WebFlix never falls back " +
            "to plaintext storage. Nothing was authorized.",
        };
      }
      const client = resolveClient();
      if (client === null) {
        options.logger.info(
          "[webflix-accounts] connect refused: no operator OAuth client is configured in this environment",
          { providerId },
        );
        return {
          ok: false,
          code: "connect-unavailable",
          reason: connectUnavailableReason(providerId),
        };
      }
      // WFX-OAUTH-CONNECT-1: the REAL loopback+PKCE flow over the frozen
      // YouTubeOAuthSession + the OS vault store + the real Google token
      // exchange. The typed outcome carries only codes + human reasons —
      // the client secret and every token stay main-process/vault-side.
      const env = options.env ?? process.env;
      const manualOpen = env.WEBFLIX_YOUTUBE_OAUTH_OPEN?.trim() === "manual";
      const { outcome } = await connectManager.start(providerId, {
        logger: options.logger,
        store: createVaultStore(providerId),
        config: buildYouTubeLoopbackConfig(client.clientId),
        tokenFetcher: createTokenFetcher(client),
        internalAccountId: WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID,
        openBrowser: options.openBrowser ?? ((url: string) => shell.openExternal(url)),
        manualOpen,
        ...(options.flowTimeoutMs !== undefined ? { flowTimeoutMs: options.flowTimeoutMs } : {}),
      });
      if (!outcome.ok) {
        options.logger.warn("[webflix-accounts] connect flow refused/failed (typed; nothing authorized)", {
          providerId,
          code: outcome.code,
        });
      }
      return outcome;
    },
  );

  ipcMain.handle(
    WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL,
    async (_event, payload: unknown): Promise<WebFlixDisconnectOutcome> => {
      const pointer =
        typeof payload === "object" && payload !== null
          ? (payload as { providerId?: unknown; internalAccountId?: unknown })
          : {};
      if (
        !isNonEmptyString(pointer.providerId) ||
        !isNonEmptyString(pointer.internalAccountId) ||
        !KNOWN_PROVIDER_IDS.has(pointer.providerId.trim())
      ) {
        options.logger.warn(
          "[webflix-accounts] refusing an unscoped disconnect (provider + account are both required)",
          payload,
        );
        return {
          ok: false,
          vaultRemoved: false,
          partitionCleared: false,
          errors: ["invalid_disconnect_scope"],
        };
      }
      const providerId = pointer.providerId.trim();
      const accountKey = pointer.internalAccountId.trim();
      try {
        // The REAL ruling-6 composition: vault removes + scoped partition
        // clear — consumed exactly as exported, never modified.
        const result = await disconnectProviderAccount({
          logger: options.logger,
          providerId,
          accountKey,
          accountStore: createVaultStore(providerId),
        });
        return {
          ok: result.success,
          vaultRemoved: result.vaultRemoved,
          partitionCleared: result.partitionCleared,
          errors: result.errors,
        };
      } catch (error) {
        options.logger.warn(
          "[webflix-accounts] disconnect failed (typed; a retry converges — the composition is idempotent)",
          typedRefusalReason(error),
        );
        return {
          ok: false,
          vaultRemoved: false,
          partitionCleared: false,
          errors: ["disconnect_vault_remove_error", typedRefusalReason(error)],
        };
      }
    },
  );

  options.logger.info("[webflix-accounts] account IPC registered (webflix flavor)", {
    channels: [
      WEBFLIX_ACCOUNTS_GET_STATUS_CHANNEL,
      WEBFLIX_ACCOUNTS_CONNECT_CHANNEL,
      WEBFLIX_ACCOUNTS_DISCONNECT_CHANNEL,
    ],
  });
}
