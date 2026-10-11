/**
 * Per-user TikTok Login Kit OAuth 2.0 + PKCE — the second provider on the
 * exact canonical §2.5/§2.6 seams YouTube uses (frozen ProviderAccountRecord
 * vocabulary, CredentialPort getToken → CredentialRef HANDLE, connector-local
 * OAuthAccountStore persistence; MR-FD6 precedent for the write side).
 *
 * PROVIDER-NEUTRAL SUBSTRATE REUSE: the PKCE pair builder, the CSRF state
 * guard, the frozen account-status state machine (connected → expired →
 * revoked), the derive/transition helpers and the store/token TYPES in
 * ../youtube/oauth are provider-neutral by construction (they were built at
 * MIRROR-RECON against the frozen §2.5 vocabulary, not Google-specific
 * shapes). They are IMPORTED here, not forked — the TikTok connector never
 * invokes any YouTube client or session code; this is static reuse of the
 * same package's OAuth substrate (the architecture lock's "connectors do not
 * call each other" is about runtime composition, which stays in application
 * services).
 *
 * TIKTOK-SPECIFIC OFFICIAL MECHANICS (Login Kit docs; URLs in ./manifest):
 *   - authorization: GET https://www.tiktok.com/v2/auth/authorize/ with
 *     client_key (TikTok's name for the public app identifier), scope as a
 *     COMMA-separated list, response_type=code, redirect_uri, state, and the
 *     PKCE pair (code_challenge + code_challenge_method=S256 — the token
 *     endpoint doc: code_verifier is "required for mobile and desktop app
 *     only", i.e. PKCE is the official desktop flow).
 *     NO Google-style parameters are sent (no access_type, no prompt, no
 *     include_granted_scopes — those are accounts.google.com parameters and
 *     would be invented input for TikTok).
 *   - token exchange / refresh: POST https://open.tiktokapis.com/v2/oauth/token/
 *     (form-encoded: client_key, client_secret, code|refresh_token,
 *     grant_type, redirect_uri, code_verifier) →
 *     {"data":{"access_token","expires_in","open_id","refresh_expires_in",
 *     "refresh_token","scope","token_type"},"error":{"code","message"}}
 *     where error.code "ok" marks success. The injected token fetcher owns
 *     the encoding; this module owns the state machine.
 *   - NO OFFICIAL REVOCATION ENDPOINT exists for Login Kit user tokens: the
 *     docs define no revoke call, and the work order forbids undocumented
 *     endpoints. disconnect() is therefore LOCAL-ONLY — it destroys the
 *     vault-side tokens and marks the record revoked without any network
 *     call; the provider-side grant then lapses on TikTok's own schedule
 *     (refresh token validity: 365 days per the official token doc). This
 *     difference from Google (which has oauth2.googleapis.com/revoke) is
 *     asserted by a fixture test: disconnect() performs ZERO fetcher calls.
 *
 * FIXTURE-TESTED ONLY: no real client key and no live network calls — the
 * token fetcher is injected and the default fails with
 * LiveNetworkDisabledError. Live consent flow records as pending operator
 * TikTok client credentials (operator item, same ruling class as the Google
 * client ID in YOUTUBE-EXPAND).
 */
import {
  createPkcePair,
  deriveAccountStatus,
  InvalidTransitionError,
  type OAuthAccountStatus,
  OAuthFlowError,
  type PkcePair,
  RequiresAuthError,
  RefreshFailedError,
  type StoredOAuthTokens,
  StateMismatchError,
  transitionAccount,
} from "../youtube/oauth";
import type { CredentialPort, ProviderAccountRecord } from "webflix-contracts";
import { LiveNetworkDisabledError } from "../youtube/dataApi";
import {
  TIKTOK_AUTHORIZATION_ENDPOINT,
  TIKTOK_DISPLAY_NAME,
  TIKTOK_OAUTH_SCOPES,
  TIKTOK_PROVIDER_ID,
  TIKTOK_TOKEN_ENDPOINT,
} from "./manifest";

// ---------------------------------------------------------------------------
// Configuration — official endpoints, placeholder client key (NO real secret)
// ---------------------------------------------------------------------------

export interface TikTokLoginKitConfig {
  /** Login Kit calls the public app identifier "client_key". */
  clientKey: string;
  scopes: readonly string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  loopbackHost: string;
  loopbackPath: string;
}

export const TIKTOK_LOGIN_KIT_CLIENT_KEY =
  "WEBFLIX-DESKTOP-TIKTOK-CLIENT-KEY-PENDING-OPERATOR-PROVISIONING";

export const TIKTOK_LOGIN_KIT_CONFIG: TikTokLoginKitConfig = {
  clientKey: TIKTOK_LOGIN_KIT_CLIENT_KEY,
  scopes: TIKTOK_OAUTH_SCOPES,
  authorizationEndpoint: TIKTOK_AUTHORIZATION_ENDPOINT,
  tokenEndpoint: TIKTOK_TOKEN_ENDPOINT,
  loopbackHost: "127.0.0.1",
  loopbackPath: "/oauth/callback",
};

// ---------------------------------------------------------------------------
// Vault-side tokens (TikTok superset of the shared StoredOAuthTokens)
// ---------------------------------------------------------------------------

/**
 * TikTok vault-side token record. Extends the shared StoredOAuthTokens with
 * the provider-specific fields the official token response carries: the
 * provider's own user id (open_id — the frozen ProviderAccountRecord has no
 * provider-account-id field; MR-FD4) and the refresh grant's own expiry
 * (refresh_expires_in; official: 365 days). Vault-side ONLY — never on the
 * renderer-safe record.
 */
export interface TikTokStoredTokens extends StoredOAuthTokens {
  /** The provider's own user id (vault-side; MR-FD4 covers the record gap). */
  openId: string | null;
  /** Epoch ms when the refresh grant expires, when the provider reported one. */
  refreshExpiresAtMs: number | null;
}

/**
 * Account + token persistence for the TikTok connector: same seam as the
 * shared OAuthAccountStore (renderer-safe records on one side, raw tokens
 * vault-side), with the TikTok token superset on the vault side.
 */
export interface TikTokOAuthAccountStore {
  loadAccount(internalAccountId: string): Promise<ProviderAccountRecord | null>;
  saveAccount(record: ProviderAccountRecord): Promise<void>;
  removeAccount(internalAccountId: string): Promise<void>;
  loadTokens(internalAccountId: string): Promise<TikTokStoredTokens | null>;
  saveTokens(internalAccountId: string, tokens: TikTokStoredTokens): Promise<void>;
  removeTokens(internalAccountId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Authorization request (loopback + PKCE, TikTok parameter set)
// ---------------------------------------------------------------------------

export interface BuildTikTokAuthorizationRequestOptions {
  redirectPort: number;
  state?: string;
  pkce?: PkcePair;
  config?: TikTokLoginKitConfig;
}

export interface TikTokAuthorizationRequest extends PkcePair {
  url: string;
  redirectUri: string;
  state: string;
}

export function buildTikTokAuthorizationRequest(
  options: BuildTikTokAuthorizationRequestOptions,
): TikTokAuthorizationRequest {
  const config = options.config ?? TIKTOK_LOGIN_KIT_CONFIG;
  if (
    !Number.isInteger(options.redirectPort) ||
    options.redirectPort <= 0 ||
    options.redirectPort > 65535
  ) {
    throw new OAuthFlowError("redirectPort must be a real loopback listener port (1..65535)");
  }
  const redirectUri = `http://${config.loopbackHost}:${options.redirectPort}${config.loopbackPath}`;
  const pkce = options.pkce ?? createPkcePair();
  const state = options.state ?? createPkcePair().codeChallenge;
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
  // Deliberately NO access_type / prompt / include_granted_scopes — those are
  // Google authorization parameters; sending them to TikTok would be
  // invented input (asserted by fixture test).
  return {
    url: url.toString(),
    redirectUri,
    state,
    codeVerifier: pkce.codeVerifier,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  };
}

// ---------------------------------------------------------------------------
// Token endpoint boundary (injected; no live calls in this package)
// ---------------------------------------------------------------------------

/** The official token response body (data side; error.code "ok" = success). */
export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number;
  open_id?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export type TikTokEndpointRequest =
  | { kind: "token-exchange"; code: string; codeVerifier: string; redirectUri: string }
  | { kind: "refresh"; refreshToken: string };

export type TikTokEndpointResult =
  | { kind: "token"; token: TikTokTokenResponse }
  /**
   * The provider rejected the request with an error envelope
   * (error.code != "ok"). `code` is the provider's own error code (e.g.
   * access_token_invalid); the session maps it honestly.
   */
  | { kind: "rejected"; code: string; message: string };

export type TikTokTokenFetcher = (request: TikTokEndpointRequest) => Promise<TikTokEndpointResult>;

export const liveNetworkDeniedTikTokFetcher: TikTokTokenFetcher = async () => {
  throw new LiveNetworkDisabledError(
    "connectors/tiktok oauth: live token endpoints are disabled (fixture-only; live consent flow is pending operator TikTok client credentials — operator item)",
  );
};

// ---------------------------------------------------------------------------
// Session — flow + lifecycle over TikTokOAuthAccountStore; canonical
// CredentialPort (frozen §2.6)
// ---------------------------------------------------------------------------

export interface TikTokOAuthSessionOptions {
  store: TikTokOAuthAccountStore;
  /** Installation-local id of the linked account (frozen §2.5 vocabulary). */
  internalAccountId: string;
  config?: TikTokLoginKitConfig;
  tokenFetcher?: TikTokTokenFetcher;
  clock?: () => number;
  expirySkewMs?: number;
}

export class TikTokOAuthSession {
  private readonly store: TikTokOAuthAccountStore;
  private readonly internalAccountId: string;
  private readonly config: TikTokLoginKitConfig;
  private readonly tokenFetcher: TikTokTokenFetcher;
  private readonly clock: () => number;
  private readonly expirySkewMs: number;
  private readonly pending = new Map<
    string,
    { codeVerifier: string; redirectUri: string; createdAt: number }
  >();

  constructor(options: TikTokOAuthSessionOptions) {
    this.store = options.store;
    this.internalAccountId = options.internalAccountId;
    this.config = options.config ?? TIKTOK_LOGIN_KIT_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedTikTokFetcher;
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
   * Resolves an opaque CredentialRef HANDLE for (providerId, internalAccountId)
   * — never a token. Mirrors the YouTube session's port exactly (the frozen
   * seam is provider-neutral).
   */
  credentialPort(): CredentialPort {
    return {
      getToken: async (providerId: string, internalAccountId: string) => {
        if (providerId !== TIKTOK_PROVIDER_ID) {
          throw new RequiresAuthError(
            `tiktok oauth session: providerId "${providerId}" is not "${TIKTOK_PROVIDER_ID}"`,
          );
        }
        const record = await this.store.loadAccount(internalAccountId);
        const tokens = await this.store.loadTokens(internalAccountId);
        const status = deriveAccountStatus(record, this.now());
        if (!record || !tokens || status === null || status === "revoked") {
          throw new RequiresAuthError(
            `tiktok oauth: no usable credential for account "${internalAccountId}" (status: ${
              status ?? "no linked account"
            })`,
          );
        }
        return { handle: `${TIKTOK_PROVIDER_ID}:${internalAccountId}` };
      },
    };
  }

  /** Build the loopback+PKCE authorization URL and remember pending state. */
  startAuthorization(options: {
    redirectPort: number;
    state?: string;
    pkce?: PkcePair;
  }): TikTokAuthorizationRequest {
    const request = buildTikTokAuthorizationRequest({
      redirectPort: options.redirectPort,
      state: options.state,
      pkce: options.pkce,
      config: this.config,
    });
    this.pending.set(request.state, {
      codeVerifier: request.codeVerifier,
      redirectUri: request.redirectUri,
      createdAt: this.now(),
    });
    return request;
  }

  /** Validate state (pending map is the CSRF guard), exchange the code (PKCE), persist vault + record. */
  async completeAuthorization(callback: {
    code: string;
    state: string;
    displayName?: string | null;
  }): Promise<ProviderAccountRecord> {
    const pending = this.pending.get(callback.state);
    if (!pending) {
      throw new StateMismatchError("no pending authorization matches the returned state parameter");
    }
    this.pending.delete(callback.state);
    const result = await this.tokenFetcher({
      kind: "token-exchange",
      code: callback.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
    });
    if (result.kind === "rejected") {
      throw new RefreshFailedError(
        `tiktok oauth: token exchange rejected (error.code=${result.code}): ${result.message}`,
        result.code,
      );
    }
    return this.persistFreshTokensAsync(result.token, callback.displayName ?? null);
  }

  private async persistFreshTokensAsync(
    token: TikTokTokenResponse,
    displayName: string | null,
  ): Promise<ProviderAccountRecord> {
    const now = this.now();
    const scope = token.scope ?? this.config.scopes.join(",");
    const tokens: TikTokStoredTokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAtMs: now + token.expires_in * 1000,
      scope,
      tokenType: token.token_type ?? "Bearer",
      openId: token.open_id ?? null,
      refreshExpiresAtMs:
        token.refresh_expires_in !== undefined ? now + token.refresh_expires_in * 1000 : null,
    };
    await this.store.saveTokens(this.internalAccountId, tokens);
    const record: ProviderAccountRecord = {
      providerId: TIKTOK_PROVIDER_ID,
      internalAccountId: this.internalAccountId,
      displayName: displayName ?? `${TIKTOK_DISPLAY_NAME} account`,
      grantedScopes: splitTikTokScopes(scope),
      status: "connected",
      connectedAt: toIso(now),
      expiresAt: tokens.expiresAtMs !== null ? toIso(tokens.expiresAtMs) : undefined,
    };
    await this.store.saveAccount(record);
    return record;
  }

  /** Vault-side access token for MAIN-PROCESS callers (Authorization headers). */
  async getToken(): Promise<string> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    const status = deriveAccountStatus(record, this.now());
    if (!record || !tokens || status === null || status === "revoked") {
      throw new RequiresAuthError(
        `tiktok oauth: account "${this.internalAccountId}" is ${
          status ?? "not linked"
        }; no usable access token — run startAuthorization()/completeAuthorization() first`,
      );
    }
    const needsRefresh =
      status === "expired" ||
      (tokens.expiresAtMs !== null && tokens.expiresAtMs - this.expirySkewMs <= this.now());
    if (needsRefresh) {
      await this.refresh();
      const refreshedTokens = await this.store.loadTokens(this.internalAccountId);
      if (!refreshedTokens?.accessToken) {
        throw new RefreshFailedError(
          "tiktok oauth: refresh completed without an access token",
          "no-token",
        );
      }
      return refreshedTokens.accessToken;
    }
    return tokens.accessToken;
  }

  /** Refresh grant via the official token endpoint; provider rejection honestly revokes the account. */
  async refresh(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (!record || !tokens) {
      throw new RequiresAuthError(
        `tiktok oauth: no stored account for "${this.internalAccountId}" to refresh`,
      );
    }
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) {
      throw new RequiresAuthError(
        `tiktok oauth: stored account for "${this.internalAccountId}" has no refresh token; re-run the loopback authorization flow`,
      );
    }
    const result = await this.tokenFetcher({ kind: "refresh", refreshToken });
    if (result.kind === "rejected") {
      if (result.code === "access_token_invalid" || result.code === "invalid_grant") {
        const revoked = transitionAccount(record, "revoked");
        await this.store.removeTokens(this.internalAccountId);
        await this.store.saveAccount(revoked);
        throw new RefreshFailedError(
          `tiktok oauth: provider rejected refresh (error.code=${result.code}) for "${this.internalAccountId}"; account marked revoked`,
          result.code,
        );
      }
      throw new RefreshFailedError(
        `tiktok oauth: refresh failed for "${this.internalAccountId}" (error.code=${result.code}): ${result.message}`,
        result.code,
      );
    }
    const now = this.now();
    const refreshedTokens: TikTokStoredTokens = {
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token ?? refreshToken,
      expiresAtMs: now + result.token.expires_in * 1000,
      scope: result.token.scope ?? tokens.scope,
      tokenType: result.token.token_type ?? tokens.tokenType ?? "Bearer",
      openId: result.token.open_id ?? tokens.openId,
      refreshExpiresAtMs:
        result.token.refresh_expires_in !== undefined
          ? now + result.token.refresh_expires_in * 1000
          : tokens.refreshExpiresAtMs,
    };
    await this.store.saveTokens(this.internalAccountId, refreshedTokens);
    const refreshed: ProviderAccountRecord = {
      ...record,
      status: "connected",
      expiresAt:
        refreshedTokens.expiresAtMs !== null ? toIso(refreshedTokens.expiresAtMs) : undefined,
    };
    await this.store.saveAccount(refreshed);
    return refreshed;
  }

  /**
   * LOCAL-ONLY disconnect: Login Kit exposes NO official token-revocation
   * endpoint (the docs define none, and undocumented endpoints are forbidden
   * by ADR-0003), so this destroys the vault-side tokens and marks the
   * record revoked WITHOUT any network call — the provider-side grant lapses
   * on TikTok's own schedule (refresh token validity 365 days, official).
   * Fixture test asserts ZERO fetcher invocations.
   */
  async disconnect(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const status = deriveAccountStatus(record, this.now());
    if (!record || status === null) {
      throw new RequiresAuthError(
        `tiktok oauth: nothing to disconnect for "${this.internalAccountId}" (status ${status ?? "not linked"})`,
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
        `tiktok oauth: no stored account to acknowledge for "${this.internalAccountId}"`,
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
}

/**
 * The shared vocabulary + transitions (OAUTH_TRANSITIONS, deriveAccountStatus,
 * transitionAccount) stay authoritative in ../youtube/oauth — imported here,
 * never forked and never re-exported (the package index already exports them
 * once via the YouTube module; a second `export *` would make the name
 * ambiguous).
 */

/** TikTok returns scopes comma-separated (official token doc); accept spaces too. */
function splitTikTokScopes(scope: string): string[] {
  return scope
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
