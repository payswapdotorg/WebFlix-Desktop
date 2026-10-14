/* eslint-disable max-lines -- twitch/oauth.ts: the per-user Authorization Code + PKCE session, the
 App Access (client-credentials) token manager and the OFFICIAL revocation call form one cohesive
 official-auth unit over the id.twitch.tv/oauth2 surface (repo precedent: youtube/oauth.ts carries
 the same disable; split deferred to the module-split backlog, TL2 arbitration). */
/**
 * Twitch OAuth — two official flows on the id.twitch.tv/oauth2 surface:
 *
 *  1. PER-USER Authorization Code + PKCE (the account path):
 *     - authorize: GET {base}/authorize?client_id&redirect_uri&response_type=code
 *       &scope=<SPACE-separated>&state&code_challenge&code_challenge_method=S256
 *       (PKCE is the official flow for apps that cannot hold a secret — and
 *       even where a secret exists, Twitch supports the S256 challenge on
 *       the authorization-code grant; the verifier never leaves this
 *       process). NO Google/TikTok parameters are ever sent (no
 *       access_type/prompt, no comma-joined scopes — Twitch scopes are
 *       SPACE-separated).
 *     - token: POST {base}/token (form-encoded: client_id, client_secret,
 *       code, grant_type=authorization_code, redirect_uri, code_verifier)
 *       → {access_token, refresh_token, expires_in, scope, token_type}.
 *     - refresh: POST {base}/token (grant_type=refresh_token, refresh_token,
 *       client_id, client_secret) → a fresh token pair (Twitch rotates the
 *       refresh token on every refresh — the new one REPLACES the old).
 *     - REVOKE (the honest Twitch difference from TikTok Login Kit): Twitch
 *       DEFINES an official revocation endpoint — POST {base}/revoke
 *       (form-encoded client_id + token; 204 No Content on success).
 *       disconnect() therefore performs a REAL provider-side revocation via
 *       the injected fetcher, then destroys the vault-side tokens and marks
 *       the record revoked. A failed revoke call surfaces the error and
 *       leaves the record intact (retryable) — never a silent local-only
 *       disconnect that pretends the provider grant is gone.
 *
 *  2. APP ACCESS (client credentials, public reads):
 *     POST {base}/token?grant_type=client_credentials&client_id&client_secret
 *     → {access_token, expires_in, token_type} (bearer; NO refresh token —
 *     app tokens are re-minted, not refreshed). TwitchAppAccessSession caches
 *     the token with expiry-aware reuse (skew included) and re-mints through
 *     the injected fetcher when it goes stale.
 *
 * PROVIDER-NEUTRAL SUBSTRATE REUSE (TIKTOK-CONNECT precedent): the PKCE pair
 * builder, the CSRF state guard, the frozen account-status state machine
 * (connected → expired → revoked), the derive/transition helpers and the
 * store/token TYPES in ../youtube/oauth are provider-neutral by construction.
 * They are IMPORTED here, not forked; the Twitch connector never invokes any
 * YouTube client or session code.
 *
 * FIXTURE-TESTED ONLY: no real client id/secret and no live network calls —
 * the token fetcher is injected and the default fails with
 * LiveNetworkDisabledError. Live consent flows record as pending operator
 * Twitch client credentials (operator item, same ruling class as the Google
 * client ID and the TikTok client key).
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
  TWITCH_DISPLAY_NAME,
  TWITCH_OAUTH_BASE,
  TWITCH_OAUTH_SCOPES,
  TWITCH_PROVIDER_ID,
} from "./manifest";

// ---------------------------------------------------------------------------
// Configuration — official endpoints, placeholder client id (NO real secret)
// ---------------------------------------------------------------------------

export interface TwitchOAuthConfig {
  clientId: string;
  clientSecret: string | null;
  scopes: readonly string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint: string;
  loopbackHost: string;
  loopbackPath: string;
}

export const TWITCH_CLIENT_ID = "WEBFLIX-DESKTOP-TWITCH-CLIENT-ID-PENDING-OPERATOR-PROVISIONING";

export const TWITCH_OAUTH_CONFIG: TwitchOAuthConfig = {
  clientId: TWITCH_CLIENT_ID,
  // Desktop apps hold the secret behind the OS vault at runtime; the shipped
  // constant is a labeled placeholder (operator item).
  clientSecret: null,
  scopes: TWITCH_OAUTH_SCOPES,
  authorizationEndpoint: `${TWITCH_OAUTH_BASE}/authorize`,
  tokenEndpoint: `${TWITCH_OAUTH_BASE}/token`,
  revokeEndpoint: `${TWITCH_OAUTH_BASE}/revoke`,
  loopbackHost: "127.0.0.1",
  loopbackPath: "/oauth/callback",
};

// ---------------------------------------------------------------------------
// Vault-side tokens (Twitch superset of the shared StoredOAuthTokens)
// ---------------------------------------------------------------------------

/**
 * Twitch vault-side token record. Extends the shared StoredOAuthTokens with
 * the provider-specific fields the official token response carries: the
 * provider's own user id (the /helix/users read of the authorized account;
 * the frozen ProviderAccountRecord has no provider-account-id field —
 * MR-FD4) and the token-type marker. Vault-side ONLY.
 */
export interface TwitchStoredTokens extends StoredOAuthTokens {
  /** The provider's own user id for the authorized account (vault-side; MR-FD4). */
  twitchUserId: string | null;
}

/**
 * Account + token persistence for the Twitch connector: same seam shape as
 * the shared OAuthAccountStore (renderer-safe records one side, raw tokens
 * vault-side), with the Twitch token superset on the vault side.
 */
export interface TwitchOAuthAccountStore {
  loadAccount(internalAccountId: string): Promise<ProviderAccountRecord | null>;
  saveAccount(record: ProviderAccountRecord): Promise<void>;
  removeAccount(internalAccountId: string): Promise<void>;
  loadTokens(internalAccountId: string): Promise<TwitchStoredTokens | null>;
  saveTokens(internalAccountId: string, tokens: TwitchStoredTokens): Promise<void>;
  removeTokens(internalAccountId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Authorization request (loopback + PKCE, Twitch parameter set)
// ---------------------------------------------------------------------------

export interface BuildTwitchAuthorizationRequestOptions {
  redirectPort: number;
  state?: string;
  pkce?: PkcePair;
  config?: TwitchOAuthConfig;
}

export interface TwitchAuthorizationRequest extends PkcePair {
  url: string;
  redirectUri: string;
  state: string;
}

export function buildTwitchAuthorizationRequest(
  options: BuildTwitchAuthorizationRequestOptions,
): TwitchAuthorizationRequest {
  const config = options.config ?? TWITCH_OAUTH_CONFIG;
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
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", pkce.codeChallengeMethod);
  // Deliberately NO access_type / prompt (Google parameters) and NO
  // comma-joined scope list (TikTok Login Kit shape) — Twitch scopes are
  // SPACE-separated and the parameter set above is the official one
  // (asserted by fixture tests).
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

/** The official token/revocation response bodies (success side). */
export interface TwitchTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export type TwitchEndpointRequest =
  | { kind: "token-exchange"; code: string; codeVerifier: string; redirectUri: string }
  | { kind: "refresh"; refreshToken: string }
  | { kind: "app-access" }
  | { kind: "revoke"; token: string };

export type TwitchEndpointResult =
  | { kind: "token"; token: TwitchTokenResponse }
  | { kind: "revoked" }
  /**
   * The provider rejected the request (id.twitch.tv answers 400 with
   * {"status":400,"message":"…"} for invalid grants). `status` and
   * `message` are the provider's own values; the sessions map them honestly.
   */
  | { kind: "rejected"; status: number; message: string };

export type TwitchTokenFetcher = (request: TwitchEndpointRequest) => Promise<TwitchEndpointResult>;

export const liveNetworkDeniedTwitchFetcher: TwitchTokenFetcher = async () => {
  throw new LiveNetworkDisabledError(
    "connectors/twitch oauth: live token endpoints are disabled (fixture-only; live flows are pending operator Twitch client credentials — operator item)",
  );
};

// ---------------------------------------------------------------------------
// App Access session (client-credentials — public reads)
// ---------------------------------------------------------------------------

export interface TwitchAppAccessSessionOptions {
  config?: TwitchOAuthConfig;
  tokenFetcher?: TwitchTokenFetcher;
  clock?: () => number;
  /** Refresh skew: re-mint this many ms BEFORE expiry (default 60s). */
  expirySkewMs?: number;
}

/**
 * App Access token manager: mints client-credentials tokens on demand and
 * reuses them until (expiry − skew). App tokens have NO refresh grant — a
 * stale token is re-minted through the fetcher, exactly as the official
 * client-credentials flow defines.
 */
export class TwitchAppAccessSession {
  private readonly config: TwitchOAuthConfig;
  private readonly tokenFetcher: TwitchTokenFetcher;
  private readonly nowFn: () => number;
  private readonly expirySkewMs: number;
  private cached: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(options: TwitchAppAccessSessionOptions = {}) {
    this.config = options.config ?? TWITCH_OAUTH_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedTwitchFetcher;
    this.nowFn = options.clock ?? Date.now;
    this.expirySkewMs = options.expirySkewMs ?? 60_000;
  }

  /**
   * A usable App Access token, or null when one cannot be minted (missing
   * client secret or provider rejection — both honest nulls: the Helix
   * client turns them into its missing-credential error, never fake data).
   */
  async getAppAccessToken(): Promise<string | null> {
    const now = this.nowFn();
    if (this.cached !== null && this.cached.expiresAtMs - this.expirySkewMs > now) {
      return this.cached.accessToken;
    }
    if (this.config.clientSecret === null) {
      return null; // honestly unprovisioned — no secret, no app token
    }
    const result = await this.tokenFetcher({ kind: "app-access" });
    if (result.kind === "rejected") {
      return null; // provider rejected the mint — honest null, never a guess
    }
    if (result.kind === "revoked") {
      return null; // shape mismatch — a mint cannot answer "revoked"
    }
    this.cached = {
      accessToken: result.token.access_token,
      expiresAtMs: now + result.token.expires_in * 1000,
    };
    return this.cached.accessToken;
  }

  /** Drops the cached token (used by tests; a re-mint happens on next read). */
  invalidateCache(): void {
    this.cached = null;
  }
}

// ---------------------------------------------------------------------------
// Per-user session — flow + lifecycle over TwitchOAuthAccountStore; canonical
// CredentialPort (frozen §2.6)
// ---------------------------------------------------------------------------

export interface TwitchOAuthSessionOptions {
  store: TwitchOAuthAccountStore;
  /** Installation-local id of the linked account (frozen §2.5 vocabulary). */
  internalAccountId: string;
  config?: TwitchOAuthConfig;
  tokenFetcher?: TwitchTokenFetcher;
  clock?: () => number;
  expirySkewMs?: number;
}

export class TwitchOAuthSession {
  private readonly store: TwitchOAuthAccountStore;
  private readonly internalAccountId: string;
  private readonly config: TwitchOAuthConfig;
  private readonly tokenFetcher: TwitchTokenFetcher;
  private readonly clock: () => number;
  private readonly expirySkewMs: number;
  private readonly pending = new Map<
    string,
    { codeVerifier: string; redirectUri: string; createdAt: number }
  >();

  constructor(options: TwitchOAuthSessionOptions) {
    this.store = options.store;
    this.internalAccountId = options.internalAccountId;
    this.config = options.config ?? TWITCH_OAUTH_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedTwitchFetcher;
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
   * internalAccountId) — never a token. Same seam as the YouTube/TikTok
   * sessions (the frozen seam is provider-neutral).
   *
   * P8-ISOLATION-WIRING-1 (audit §1.4/§4.2 #1a): resolve-only-own-account —
   * a foreign account id on the same store refuses with the typed
   * `RequiresAuthError` (the session view never mints another account's
   * handle; the frozen contract seam stays untouched).
   */
  credentialPort(): CredentialPort {
    return {
      getToken: async (providerId: string, internalAccountId: string) => {
        if (providerId !== TWITCH_PROVIDER_ID) {
          throw new RequiresAuthError(
            `twitch oauth session: providerId "${providerId}" is not "${TWITCH_PROVIDER_ID}"`,
          );
        }
        if (internalAccountId !== this.internalAccountId) {
          throw new RequiresAuthError(
            `twitch oauth session: account "${internalAccountId}" is not this session's account ` +
              `"${this.internalAccountId}" (foreign-account refusal — a session port resolves ` +
              `only its own account; audit §1.4)`,
          );
        }
        const record = await this.store.loadAccount(internalAccountId);
        const tokens = await this.store.loadTokens(internalAccountId);
        const status = deriveAccountStatus(record, this.now());
        if (!record || !tokens || status === null || status === "revoked") {
          throw new RequiresAuthError(
            `twitch oauth: no usable credential for account "${internalAccountId}" (status: ${
              status ?? "no linked account"
            })`,
          );
        }
        return { handle: `${TWITCH_PROVIDER_ID}:${internalAccountId}` };
      },
    };
  }

  /** Build the loopback+PKCE authorization URL and remember pending state. */
  startAuthorization(options: {
    redirectPort: number;
    state?: string;
    pkce?: PkcePair;
  }): TwitchAuthorizationRequest {
    const request = buildTwitchAuthorizationRequest({
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

  /**
   * Validate state (pending map is the CSRF guard), exchange the code (PKCE),
   * persist vault + record. The authorized account's provider user id is
   * passed by the caller (it arrives from the /helix/users read of the
   * authorized account — kept vault-side, MR-FD4).
   */
  async completeAuthorization(callback: {
    code: string;
    state: string;
    displayName?: string | null;
    twitchUserId?: string | null;
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
        `twitch oauth: token exchange rejected (HTTP ${result.status}): ${result.message}`,
        String(result.status),
      );
    }
    if (result.kind === "revoked") {
      throw new OAuthFlowError("twitch oauth: token exchange answered a revocation shape");
    }
    return this.persistFreshTokens(result.token, {
      displayName: callback.displayName ?? null,
      twitchUserId: callback.twitchUserId ?? null,
    });
  }

  private async persistFreshTokens(
    token: TwitchTokenResponse,
    context: { displayName: string | null; twitchUserId: string | null },
  ): Promise<ProviderAccountRecord> {
    const now = this.now();
    const scope = token.scope ?? this.config.scopes.join(" ");
    const tokens: TwitchStoredTokens = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAtMs: now + token.expires_in * 1000,
      scope,
      tokenType: token.token_type ?? "bearer",
      twitchUserId: context.twitchUserId,
    };
    await this.store.saveTokens(this.internalAccountId, tokens);
    const record: ProviderAccountRecord = {
      providerId: TWITCH_PROVIDER_ID,
      internalAccountId: this.internalAccountId,
      displayName: context.displayName ?? `${TWITCH_DISPLAY_NAME} account`,
      grantedScopes: splitTwitchScopes(scope),
      status: "connected",
      connectedAt: toIso(now),
      expiresAt: tokens.expiresAtMs !== null ? toIso(tokens.expiresAtMs) : undefined,
    };
    await this.store.saveAccount(record);
    return record;
  }

  /** Vault-side access token for MAIN-PROCESS callers (Authorization headers). */
  async getUserAccessToken(): Promise<string> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    const status = deriveAccountStatus(record, this.now());
    if (!record || !tokens || status === null || status === "revoked") {
      throw new RequiresAuthError(
        `twitch oauth: account "${this.internalAccountId}" is ${
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
          "twitch oauth: refresh completed without an access token",
          "no-token",
        );
      }
      return refreshedTokens.accessToken;
    }
    return tokens.accessToken;
  }

  /**
   * Refresh grant via the official token endpoint. Twitch ROTATES the
   * refresh token on every refresh — the returned refresh_token replaces the
   * old one; when the response omits it the old grant is kept (honest
   * conservative fallback). Provider rejection (invalid grant) honestly
   * revokes the account.
   */
  async refresh(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (!record || !tokens) {
      throw new RequiresAuthError(
        `twitch oauth: no stored account for "${this.internalAccountId}" to refresh`,
      );
    }
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) {
      throw new RequiresAuthError(
        `twitch oauth: stored account for "${this.internalAccountId}" has no refresh token; re-run the loopback authorization flow`,
      );
    }
    const result = await this.tokenFetcher({ kind: "refresh", refreshToken });
    if (result.kind === "rejected") {
      // id.twitch.tv rejects dead grants with 400 ("Invalid refresh token").
      if (result.status === 400) {
        const revoked = transitionAccount(record, "revoked");
        await this.store.removeTokens(this.internalAccountId);
        await this.store.saveAccount(revoked);
        throw new RefreshFailedError(
          `twitch oauth: provider rejected refresh (HTTP ${result.status}: ${result.message}) for "${this.internalAccountId}"; account marked revoked`,
          String(result.status),
        );
      }
      throw new RefreshFailedError(
        `twitch oauth: refresh failed for "${this.internalAccountId}" (HTTP ${result.status}): ${result.message}`,
        String(result.status),
      );
    }
    if (result.kind === "revoked") {
      throw new OAuthFlowError("twitch oauth: refresh answered a revocation shape");
    }
    const now = this.now();
    const refreshedTokens: TwitchStoredTokens = {
      accessToken: result.token.access_token,
      refreshToken: result.token.refresh_token ?? refreshToken,
      expiresAtMs: now + result.token.expires_in * 1000,
      scope: result.token.scope ?? tokens.scope,
      tokenType: result.token.token_type ?? tokens.tokenType ?? "bearer",
      twitchUserId: tokens.twitchUserId,
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
   * Disconnect WITH the official revocation call: POST {base}/revoke
   * (client_id + token; 204 No Content on success) — Twitch defines a
   * revocation endpoint, so the provider-side grant is destroyed for real.
   * Only after a successful revocation are the vault-side tokens destroyed
   * and the record marked revoked; a failed revoke call surfaces the error
   * and leaves the record intact (retryable — never a silent local-only
   * disconnect). Fixture tests assert the revoke request is issued exactly
   * once and carries the stored access token.
   */
  async disconnect(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const tokens = await this.store.loadTokens(this.internalAccountId);
    const status = deriveAccountStatus(record, this.now());
    if (!record || status === null) {
      throw new RequiresAuthError(
        `twitch oauth: nothing to disconnect for "${this.internalAccountId}" (status ${status ?? "not linked"})`,
      );
    }
    const tokenToRevoke = tokens?.accessToken ?? "";
    const result = await this.tokenFetcher({ kind: "revoke", token: tokenToRevoke });
    if (result.kind === "rejected") {
      throw new OAuthFlowError(
        `twitch oauth: official revocation failed for "${this.internalAccountId}" (HTTP ${result.status}: ${result.message}); the account is left connected — retry the disconnect`,
      );
    }
    if (result.kind === "token") {
      throw new OAuthFlowError(
        "twitch oauth: revocation answered a token shape (expected 204 No Content)",
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
        `twitch oauth: no stored account to acknowledge for "${this.internalAccountId}"`,
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

/** Twitch returns scopes space-separated (official token response); accept commas too. */
function splitTwitchScopes(scope: string): string[] {
  return scope
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
