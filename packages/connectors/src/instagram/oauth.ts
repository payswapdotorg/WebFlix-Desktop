/**
 * Per-user Facebook Login for Business OAuth — the fourth provider on the
 * exact canonical §2.5/§2.6 seams YouTube, TikTok and Twitch use (frozen
 * ProviderAccountRecord vocabulary, CredentialPort getToken → CredentialRef
 * HANDLE, connector-local OAuthAccountStore persistence; MR-FD6 precedent
 * for the write side).
 *
 * PROVIDER-NEUTRAL SUBSTRATE REUSE: the CSRF state guard, the frozen
 * account-status state machine (connected → expired → revoked), the
 * derive/transition helpers and the store/token TYPES in ../youtube/oauth
 * are provider-neutral by construction. They are IMPORTED here, not forked —
 * the Instagram connector never invokes any YouTube client or session code;
 * this is static reuse of the same package's OAuth substrate (the
 * architecture lock's "connectors do not call each other" is about runtime
 * composition, which stays in application services).
 *
 * INSTAGRAM-SPECIFIC OFFICIAL MECHANICS (Facebook Login docs; URLs in
 * ./manifest):
 *   - authorization (manual flow): GET
 *     https://www.facebook.com/v26.0/dialog/oauth with client_id,
 *     redirect_uri, state (the CSRF guard), response_type (code) and scope
 *     as a COMMA-separated list. NO PKCE parameters are sent — Facebook's
 *     documented manual flow defines no code_challenge parameter (the
 *     client_secret authenticates the exchange instead); sending one would
 *     be invented input (asserted by fixture test). No Google/TikTok
 *     parameters either.
 *   - redirect: the URI must be registered in the App Dashboard's Valid
 *     OAuth Redirect URIs by the OPERATOR. The documented desktop-webview
 *     pattern is https://www.facebook.com/connect/login_success.html; a
 *     WebFlix loopback listener is an operator registration decision —
 *     recorded in the parity matrix §account, never silently assumed (the
 *     builder takes the redirect URI as an explicit input).
 *   - token exchange: GET
 *     graph.facebook.com/v26.0/oauth/access_token?client_id&redirect_uri&
 *     client_secret&code → {"access_token":…,"token_type":"bearer",
 *     "expires_in":seconds} (short-lived, hours).
 *   - long-lived exchange (the Facebook refresh equivalent): GET
 *     graph.facebook.com/v26.0/oauth/access_token?grant_type=
 *     fb_exchange_token&client_id&client_secret&fb_exchange_token → a
 *     long-lived token (~60 days). DOCUMENTED CAVEATS honored honestly: an
 *     EXPIRED token cannot be exchanged (re-login is the only path — the
 *     session surfaces RequiresAuthError rather than pretending to
 *     refresh), and the call carries the app secret (main-process only).
 *   - revocation (OFFICIAL, like Twitch): DELETE
 *     graph.facebook.com/v26.0/{user-id}/permissions (user or app token)
 *     → response true; de-authorizes the app and invalidates its user
 *     tokens. A FAILED revoke leaves the local record intact and retryable
 *     — the vault-side tokens are only destroyed after the provider
 *     confirms (fixture-tested).
 *
 * OPERATOR ITEM — the heaviest credential gate chain of the four platforms
 * (recorded in full in the parity matrix §account): a Meta Business-type
 * app with the Instagram product + Facebook Login for Business configured,
 * App Review approval for instagram_basic / pages_show_list /
 * pages_read_engagement / instagram_manage_insights, and business
 * verification where the review flow demands it. Fixture-tested only: the
 * token fetcher is injected and the default fails with
 * LiveNetworkDisabledError.
 */
import {
  deriveAccountStatus,
  InvalidTransitionError,
  type OAuthAccountStatus,
  OAuthFlowError,
  RequiresAuthError,
  type StoredOAuthTokens,
  StateMismatchError,
  transitionAccount,
} from "../youtube/oauth";
import type { CredentialPort, ProviderAccountRecord } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  INSTAGRAM_API_VERSION,
  INSTAGRAM_DISPLAY_NAME,
  INSTAGRAM_LOGIN_DIALOG_BASE,
  INSTAGRAM_OAUTH_SCOPES,
  INSTAGRAM_PROVIDER_ID,
} from "./manifest";

// NOTE: the PKCE pair builder is deliberately NOT imported — Facebook's
// documented manual flow defines no PKCE parameters (see the module header).
// The shared state guard + transitions ARE reused.

// ---------------------------------------------------------------------------
// Configuration — official endpoints, placeholder app id (NO real secret)
// ---------------------------------------------------------------------------

export interface InstagramLoginConfig {
  /** The Meta app ID (Facebook Login calls it client_id). */
  appId: string;
  /** The Meta app secret — MAIN-PROCESS ONLY, never renderer-visible. */
  appSecret: string;
  scopes: readonly string[];
  apiVersion: string;
}

export const INSTAGRAM_APP_ID = "WEBFLIX-DESKTOP-INSTAGRAM-APP-ID-PENDING-OPERATOR-PROVISIONING";

export const INSTAGRAM_APP_SECRET =
  "WEBFLIX-DESKTOP-INSTAGRAM-APP-SECRET-PENDING-OPERATOR-PROVISIONING";

export const INSTAGRAM_LOGIN_CONFIG: InstagramLoginConfig = {
  appId: INSTAGRAM_APP_ID,
  appSecret: INSTAGRAM_APP_SECRET,
  scopes: INSTAGRAM_OAUTH_SCOPES,
  apiVersion: INSTAGRAM_API_VERSION,
};

/** The documented desktop-webview redirect (manual-flow doc, verbatim). */
export const INSTAGRAM_DOCUMENTED_DESKTOP_REDIRECT_URI =
  "https://www.facebook.com/connect/login_success.html";

// ---------------------------------------------------------------------------
// Vault-side tokens (Instagram superset of the shared StoredOAuthTokens)
// ---------------------------------------------------------------------------

/**
 * Instagram vault-side token record. Extends the shared StoredOAuthTokens
 * with the provider-specific fields the flow produces: the app-scoped
 * Facebook user id (the revocation target; MR-FD4 covers the frozen record's
 * lack of a provider-account-id field) and the data-access expiry the login
 * redirect reports (data_access_expiration_time). Vault-side ONLY.
 */
export interface InstagramStoredTokens extends StoredOAuthTokens {
  /** The app-scoped Facebook user id (vault-side; MR-FD4). */
  facebookUserId: string | null;
  /** Epoch ms when the data-access window expires, when reported. */
  dataAccessExpiresAtMs: number | null;
  /** True once the stored token has been exchanged for a long-lived one. */
  longLived: boolean;
}

/**
 * Account + token persistence for the Instagram connector: same seam as the
 * shared OAuthAccountStore (renderer-safe records on one side, raw tokens
 * vault-side), with the Instagram token superset on the vault side.
 */
export interface InstagramOAuthAccountStore {
  loadAccount(internalAccountId: string): Promise<ProviderAccountRecord | null>;
  saveAccount(record: ProviderAccountRecord): Promise<void>;
  removeAccount(internalAccountId: string): Promise<void>;
  loadTokens(internalAccountId: string): Promise<InstagramStoredTokens | null>;
  saveTokens(internalAccountId: string, tokens: InstagramStoredTokens): Promise<void>;
  removeTokens(internalAccountId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Authorization request (manual flow; Facebook parameter set — NO PKCE)
// ---------------------------------------------------------------------------

export interface BuildInstagramAuthorizationRequestOptions {
  /**
   * The registered redirect URI — an EXPLICIT input (Facebook requires it
   * to match the App Dashboard's Valid OAuth Redirect URIs; the documented
   * desktop pattern is INSTAGRAM_DOCUMENTED_DESKTOP_REDIRECT_URI, and a
   * WebFlix loopback listener is the operator's registration decision).
   */
  redirectUri: string;
  state?: string;
  scopes?: readonly string[];
  config?: InstagramLoginConfig;
}

export interface InstagramAuthorizationRequest {
  url: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
}

function randomState(): string {
  // A 32-hex-digit CSRF token (the shared substrate's createPkcePair is
  // PKCE-shaped; the manual flow only needs an unguessable state string).
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function buildInstagramAuthorizationRequest(
  options: BuildInstagramAuthorizationRequestOptions,
): InstagramAuthorizationRequest {
  const config = options.config ?? INSTAGRAM_LOGIN_CONFIG;
  if (typeof options?.redirectUri !== "string" || !/^https?:\/\//.test(options.redirectUri)) {
    throw new OAuthFlowError(
      "redirectUri must be an absolute http(s) URL registered in the Meta App Dashboard's Valid OAuth Redirect URIs (the documented desktop pattern is https://www.facebook.com/connect/login_success.html)",
    );
  }
  const scopes = options.scopes ?? config.scopes;
  const state = options.state ?? randomState();
  const url = new URL(`${INSTAGRAM_LOGIN_DIALOG_BASE}/${config.apiVersion}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  // Deliberately NO code_challenge / code_challenge_method — Facebook's
  // documented manual flow defines no PKCE parameters (the client_secret
  // authenticates the token exchange); sending them would be invented input
  // (asserted by fixture test). NO Google/TikTok parameters either.
  return { url: url.toString(), redirectUri: options.redirectUri, state, scopes };
}

// ---------------------------------------------------------------------------
// Token endpoint boundary (injected; no live calls in this package)
// ---------------------------------------------------------------------------

/** The official token response body (code exchange and long-lived exchange). */
export interface InstagramTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

export type InstagramEndpointRequest =
  | {
      kind: "token-exchange";
      code: string;
      redirectUri: string;
    }
  | {
      kind: "exchange-long-lived";
      accessToken: string;
    }
  | {
      kind: "revoke";
      userId: string;
    };

export type InstagramEndpointResult =
  | { kind: "token"; token: InstagramTokenResponse }
  | { kind: "revoked" }
  /**
   * The provider rejected the request with the Graph error envelope.
   * `code` is the provider's own numeric error code (e.g. 190); the session
   * maps it honestly.
   */
  | { kind: "rejected"; code: number | null; message: string };

export type InstagramTokenFetcher = (
  request: InstagramEndpointRequest,
) => Promise<InstagramEndpointResult>;

export const liveNetworkDeniedInstagramFetcher: InstagramTokenFetcher = async () => {
  throw new LiveNetworkDisabledError(
    "connectors/instagram oauth: live token endpoints are disabled (fixture-only; live consent flow is pending the operator's Meta app review chain — operator item)",
  );
};

// ---------------------------------------------------------------------------
// Session — flow + lifecycle over InstagramOAuthAccountStore; canonical
// CredentialPort (frozen §2.6)
// ---------------------------------------------------------------------------

export interface InstagramOAuthSessionOptions {
  store: InstagramOAuthAccountStore;
  /** Installation-local id of the linked account (frozen §2.5 vocabulary). */
  internalAccountId: string;
  config?: InstagramLoginConfig;
  tokenFetcher?: InstagramTokenFetcher;
  clock?: () => number;
  expirySkewMs?: number;
}

export class InstagramOAuthSession {
  private readonly store: InstagramOAuthAccountStore;
  private readonly internalAccountId: string;
  private readonly config: InstagramLoginConfig;
  private readonly tokenFetcher: InstagramTokenFetcher;
  private readonly clock: () => number;
  private readonly expirySkewMs: number;
  private readonly pending = new Map<string, { redirectUri: string; createdAt: number }>();

  constructor(options: InstagramOAuthSessionOptions) {
    this.store = options.store;
    this.internalAccountId = options.internalAccountId;
    this.config = options.config ?? INSTAGRAM_LOGIN_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedInstagramFetcher;
    this.clock = options.clock ?? Date.now;
    this.expirySkewMs = options.expirySkewMs ?? 60_000;
  }

  private now(): number {
    return this.clock();
  }

  async loadAccount(): Promise<ProviderAccountRecord | null> {
    return this.store.loadAccount(this.internalAccountId);
  }

  async status(): Promise<OAuthAccountStatus | null> {
    return deriveAccountStatus(await this.loadAccount(), this.now());
  }

  /**
   * Canonical §2.5/§2.6 CredentialPort view of this session (main-process).
   * Resolves an opaque CredentialRef HANDLE for (providerId,
   * internalAccountId) — never a token.
   *
   * P8-ISOLATION-WIRING-1 (audit §1.4/§4.2 #1a): resolve-only-own-account —
   * a foreign account id on the same store refuses with the typed
   * `RequiresAuthError` (the session view never mints another account's
   * handle; the frozen contract seam stays untouched).
   */
  credentialPort(): CredentialPort {
    return {
      getToken: async (providerId: string, internalAccountId: string) => {
        if (providerId !== INSTAGRAM_PROVIDER_ID) {
          throw new RequiresAuthError(
            `instagram oauth session: providerId "${providerId}" is not "${INSTAGRAM_PROVIDER_ID}"`,
          );
        }
        if (internalAccountId !== this.internalAccountId) {
          throw new RequiresAuthError(
            `instagram oauth session: account "${internalAccountId}" is not this session's ` +
              `account "${this.internalAccountId}" (foreign-account refusal — a session port ` +
              `resolves only its own account; audit §1.4)`,
          );
        }
        const record = await this.store.loadAccount(internalAccountId);
        const tokens = await this.store.loadTokens(internalAccountId);
        const status = deriveAccountStatus(record, this.now());
        if (!record || !tokens || status === null || status === "revoked") {
          throw new RequiresAuthError(
            `instagram oauth: no usable credential for account "${internalAccountId}" (status: ${
              status ?? "no linked account"
            })`,
          );
        }
        return { handle: `${INSTAGRAM_PROVIDER_ID}:${internalAccountId}` };
      },
    };
  }

  /** Build the manual-flow authorization URL and remember pending state. */
  startAuthorization(options: {
    redirectUri: string;
    state?: string;
    scopes?: readonly string[];
  }): InstagramAuthorizationRequest {
    const request = buildInstagramAuthorizationRequest({
      redirectUri: options.redirectUri,
      state: options.state,
      scopes: options.scopes,
      config: this.config,
    });
    this.pending.set(request.state, {
      redirectUri: request.redirectUri,
      createdAt: this.now(),
    });
    return request;
  }

  /**
   * Validate state (pending map is the CSRF guard), exchange the code for a
   * short-lived token (client-secret exchange via the injected fetcher),
   * persist vault + record.
   */
  async completeAuthorization(callback: {
    code: string;
    state: string;
    displayName?: string | null;
    facebookUserId?: string | null;
    dataAccessExpiresAtMs?: number | null;
  }): Promise<ProviderAccountRecord> {
    const pending = this.pending.get(callback.state);
    if (!pending) {
      throw new StateMismatchError("no pending authorization matches the returned state parameter");
    }
    this.pending.delete(callback.state);
    const result = await this.tokenFetcher({
      kind: "token-exchange",
      code: callback.code,
      redirectUri: pending.redirectUri,
    });
    if (result.kind === "rejected") {
      throw new OAuthFlowError(
        `instagram oauth: token exchange rejected${result.code !== null ? ` (code ${result.code})` : ""}: ${result.message}`,
      );
    }
    if (result.kind !== "token") {
      throw new OAuthFlowError(
        "instagram oauth: token exchange returned no token (a revoke result cannot answer an exchange request)",
      );
    }
    return this.persistTokens(result.token, {
      displayName: callback.displayName ?? null,
      facebookUserId: callback.facebookUserId ?? null,
      dataAccessExpiresAtMs: callback.dataAccessExpiresAtMs ?? null,
      longLived: false,
    });
  }

  /**
   * Exchange the stored short-lived token for a long-lived one (~60 days)
   * — the Facebook refresh equivalent. HONEST CAVEAT (documented): an
   * EXPIRED token cannot be exchanged; when the stored token has already
   * lapsed this surfaces RequiresAuthError (re-login is the only path)
   * instead of pretending to refresh.
   */
  async exchangeLongLived(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (!record || !tokens) {
      throw new RequiresAuthError(
        `instagram oauth: no stored account for "${this.internalAccountId}" to exchange`,
      );
    }
    const status = deriveAccountStatus(record, this.now());
    if (status === null || status === "revoked") {
      throw new RequiresAuthError(
        `instagram oauth: account "${this.internalAccountId}" is ${status ?? "not linked"}; a fresh login is required`,
      );
    }
    const expired =
      tokens.expiresAtMs !== null && tokens.expiresAtMs - this.expirySkewMs <= this.now();
    if (expired) {
      throw new RequiresAuthError(
        `instagram oauth: the stored token for "${this.internalAccountId}" has already expired — per the long-lived-tokens doc an expired token cannot be exchanged; run the login flow again`,
      );
    }
    const result = await this.tokenFetcher({
      kind: "exchange-long-lived",
      accessToken: tokens.accessToken,
    });
    if (result.kind === "rejected") {
      if (result.code === 190) {
        // Token rejected as invalid: honest expired/revoked handling.
        const expiredRecord = transitionAccount(record, "expired");
        await this.store.saveAccount(expiredRecord);
        throw new RequiresAuthError(
          `instagram oauth: provider rejected the exchange (code 190) for "${this.internalAccountId}"; account marked expired — run the login flow again`,
        );
      }
      throw new OAuthFlowError(
        `instagram oauth: long-lived exchange failed${result.code !== null ? ` (code ${result.code})` : ""}: ${result.message}`,
      );
    }
    if (result.kind !== "token") {
      throw new OAuthFlowError(
        "instagram oauth: long-lived exchange returned no token (a revoke result cannot answer an exchange request)",
      );
    }
    return this.persistTokens(result.token, {
      displayName: record.displayName,
      facebookUserId: tokens.facebookUserId,
      dataAccessExpiresAtMs: tokens.dataAccessExpiresAtMs,
      longLived: true,
      previous: tokens,
    });
  }

  /**
   * Vault-side access token for MAIN-PROCESS callers (Graph Authorization
   * via the access_token query parameter). If the stored short-lived token
   * is nearing expiry and a long-lived exchange is possible, it is performed
   * first (the refresh-equivalent); a lapsed long-lived token is an honest
   * RequiresAuthError.
   */
  async getToken(): Promise<string> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    const status = deriveAccountStatus(record, this.now());
    if (!record || !tokens || status === null || status === "revoked") {
      throw new RequiresAuthError(
        `instagram oauth: account "${this.internalAccountId}" is ${status ?? "not linked"}; no usable access token — run startAuthorization()/completeAuthorization() first`,
      );
    }
    const needsExchange =
      !tokens.longLived &&
      tokens.expiresAtMs !== null &&
      tokens.expiresAtMs - this.expirySkewMs <= this.now();
    if (needsExchange) {
      await this.exchangeLongLived();
      const refreshed = await this.store.loadTokens(this.internalAccountId);
      if (!refreshed?.accessToken) {
        throw new OAuthFlowError(
          "instagram oauth: long-lived exchange completed without an access token",
        );
      }
      return refreshed.accessToken;
    }
    return tokens.accessToken;
  }

  /**
   * Disconnect with the OFFICIAL revocation call: DELETE
   * /{user-id}/permissions (the request-revoke doc: de-authorizes the app,
   * invalidates its user tokens, answers true). A FAILED revoke leaves the
   * local record INTACT and retryable — the vault-side tokens are only
   * destroyed after the provider confirms (fixture-tested).
   */
  async disconnect(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    const status = deriveAccountStatus(record, this.now());
    if (!record || status === null) {
      throw new RequiresAuthError(
        `instagram oauth: nothing to disconnect for "${this.internalAccountId}" (status ${status ?? "not linked"})`,
      );
    }
    const userId = tokens?.facebookUserId ?? null;
    if (userId === null) {
      throw new RequiresAuthError(
        `instagram oauth: no stored Facebook user id for "${this.internalAccountId}" — cannot build the official revocation call (DELETE /{user-id}/permissions); re-connect the account or acknowledge the local record manually`,
      );
    }
    const result = await this.tokenFetcher({ kind: "revoke", userId });
    if (result.kind === "rejected") {
      // Honest failure: the provider did NOT confirm revocation — the local
      // record and tokens stay intact so the user can retry.
      throw new OAuthFlowError(
        `instagram oauth: provider rejected the revocation for "${this.internalAccountId}"${result.code !== null ? ` (code ${result.code})` : ""}: ${result.message} — the account remains connected; retry disconnect later`,
      );
    }
    const revoked = transitionAccount(record, "revoked");
    await this.store.removeTokens(this.internalAccountId);
    await this.store.saveAccount(revoked);
    return revoked;
  }

  /**
   * Removes the revoked account record so a fresh consent can begin
   * (absence of a record is the frozen not-connected state).
   */
  async acknowledgeRevocation(): Promise<void> {
    const record = await this.loadAccount();
    if (!record) {
      throw new RequiresAuthError(
        `instagram oauth: no stored account to acknowledge for "${this.internalAccountId}"`,
      );
    }
    if (record.status !== "revoked") {
      throw new InvalidTransitionError(
        `illegal oauth account transition: ${record.status} → acknowledged (only revoked accounts are acknowledged)`,
      );
    }
    await this.store.removeTokens(this.internalAccountId);
    await this.store.removeAccount(this.internalAccountId);
  }

  private async persistTokens(
    token: InstagramTokenResponse,
    context: {
      displayName: string | null;
      facebookUserId: string | null;
      dataAccessExpiresAtMs: number | null;
      longLived: boolean;
      previous?: InstagramStoredTokens;
    },
  ): Promise<ProviderAccountRecord> {
    const now = this.now();
    const expiresAtMs =
      token.expires_in !== undefined && Number.isFinite(token.expires_in)
        ? now + token.expires_in * 1000
        : null;
    const tokens: InstagramStoredTokens = {
      accessToken: token.access_token,
      refreshToken: null, // Facebook Login defines no refresh token grant.
      expiresAtMs,
      scope: this.config.scopes.join(","),
      tokenType: token.token_type ?? "bearer",
      facebookUserId: context.facebookUserId ?? context.previous?.facebookUserId ?? null,
      dataAccessExpiresAtMs:
        context.dataAccessExpiresAtMs ?? context.previous?.dataAccessExpiresAtMs ?? null,
      longLived: context.longLived,
    };
    await this.store.saveTokens(this.internalAccountId, tokens);
    const existing = await this.loadAccount();
    const record: ProviderAccountRecord = {
      providerId: INSTAGRAM_PROVIDER_ID,
      internalAccountId: this.internalAccountId,
      displayName:
        context.displayName ?? existing?.displayName ?? `${INSTAGRAM_DISPLAY_NAME} account`,
      grantedScopes: [...this.config.scopes],
      status: "connected",
      connectedAt: existing?.connectedAt ?? toIso(now),
      expiresAt: expiresAtMs !== null ? toIso(expiresAtMs) : undefined,
    };
    await this.store.saveAccount(record);
    return record;
  }
}

/**
 * The shared vocabulary + transitions (OAUTH_TRANSITIONS, deriveAccountStatus,
 * transitionAccount) stay authoritative in ../youtube/oauth — imported here,
 * never forked and never re-exported (the package index already exports them
 * once via the YouTube module; a second `export *` would make the name
 * ambiguous).
 */

/**
 * NOTE on grantedScopes: the Facebook token response carries no scope field
 * (unlike Google/TikTok); the record therefore lists the requested read-only
 * set from the config, and the manual flow's optional granted_scopes
 * response extension is not requested.
 */

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
