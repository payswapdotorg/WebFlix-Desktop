/**
 * Per-user Reddit OAuth 2.0 (code flow) — the fifth provider on the exact
 * canonical §2.5/§2.6 seams YouTube, TikTok, Twitch and Instagram use
 * (frozen ProviderAccountRecord vocabulary, CredentialPort getToken →
 * CredentialRef HANDLE, connector-local OAuthAccountStore persistence;
 * MR-FD4/MR-FD6 precedent for the id/write sides).
 *
 * PROVIDER-NEUTRAL SUBSTRATE REUSE: the CSRF state guard, the frozen
 * account-status state machine (connected → expired → revoked), the
 * derive/transition helpers and the store/token TYPES in ../youtube/oauth
 * are provider-neutral by construction. They are IMPORTED here, not forked —
 * static reuse of the same package's OAuth substrate (the tiktok/twitch/
 * instagram precedent).
 *
 * REDDIT-SPECIFIC OFFICIAL MECHANICS (the OAuth2 wiki, raw markdown read
 * live 2026-10-11; URLs in ./manifest):
 *   - authorization: GET https://www.reddit.com/api/v1/authorize with
 *     client_id, response_type=code, state (the CSRF guard), redirect_uri,
 *     duration=permanent (the ONLY way to receive a refresh token — "All
 *     bearer tokens expire after 1 hour") and scope as a SPACE-separated
 *     list (the wiki's own note: "This is a slight deviation from the
 *     OAuth 2.0 specification, which states scopes should normally be
 *     space-separated" — Reddit actually USES spaces; Facebook-style commas
 *     or Google-style anything are NOT sent; asserted by fixture test).
 *     NO PKCE parameters — the OAuth2 wiki's code flow defines none (the
 *     client_secret authenticates the exchange via HTTP Basic auth).
 *   - token exchange: POST https://www.reddit.com/api/v1/access_token with
 *     HTTP Basic auth (client_id:client_secret — the wiki: "You must supply
 *     your OAuth2 client's credentials via HTTP Basic Auth"),
 *     grant_type=authorization_code&code&redirect_uri →
 *     {"access_token":…,"token_type":"bearer","expires_in":…,"scope":…,
 *      "refresh_token":…} (refresh_token present because duration=permanent).
 *   - refresh: POST the same endpoint with
 *     grant_type=refresh_token&refresh_token=… → a fresh one-hour bearer
 *     token. Refresh tokens themselves are long-lived (the wiki documents
 *     no rotation — the session keeps the stored refresh token unless a
 *     response carries a new one, never inventing one).
 *   - revocation (OFFICIAL, like Twitch/Instagram): POST
 *     https://www.reddit.com/api/v1/revoke_token with token +
 *     token_type_hint (Basic auth) — the wiki's "revoking tokens" section:
 *     "When a client is completely done with a token, it can POST to the
 *     following URL to permanently revoke the token" and "Revoking a
 *     refresh token will also revoke any related access tokens!" Live-
 *     verified 2026-10-11: the endpoint answered a dummy-Basic probe with
 *     the verbatim JSON 401 {"message":"Unauthorized","error":401}. A
 *     FAILED revoke leaves the local record intact and retryable
 *     (fixture-tested); vault-side tokens are destroyed only after the
 *     provider confirms.
 *
 * OPERATOR ITEM — honestly the LIGHTEST credential chain of the five
 * platforms (the parity matrix records the contrast with Meta's): Reddit
 * apps are SELF-SERVE — the operator creates one at reddit.com/prefs/apps
 * (no app review, no business verification; the installed-app type is the
 * documented desktop-app pattern per the App Types wiki). The remaining
 * operator duties are honest configuration, not gates: fill in the
 * client_id/secret, register the redirect URI, and set the descriptive
 * User-Agent (the Data API Wiki's format + its "NEVER lie about your
 * User-Agent" rule). Fixture-tested only: the token fetcher is injected
 * and the default fails with LiveNetworkDisabledError.
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
  REDDIT_AUTHORIZE_URL,
  REDDIT_DISPLAY_NAME,
  REDDIT_OAUTH_SCOPES,
  REDDIT_PROVIDER_ID,
} from "./manifest";

// ---------------------------------------------------------------------------
// Configuration — official endpoints, placeholder app credentials (NO real
// secret; the operator registers a self-serve app at reddit.com/prefs/apps)
// ---------------------------------------------------------------------------

export interface RedditLoginConfig {
  clientId: string;
  /** The app secret — MAIN-PROCESS ONLY, never renderer-visible. */
  clientSecret: string;
  scopes: readonly string[];
}

export const REDDIT_CLIENT_ID = "WEBFLIX-DESKTOP-REDDIT-APP-ID-PENDING-OPERATOR-PROVISIONING";
export const REDDIT_CLIENT_SECRET =
  "WEBFLIX-DESKTOP-REDDIT-APP-SECRET-PENDING-OPERATOR-PROVISIONING";

export const REDDIT_LOGIN_CONFIG: RedditLoginConfig = {
  clientId: REDDIT_CLIENT_ID,
  clientSecret: REDDIT_CLIENT_SECRET,
  scopes: REDDIT_OAUTH_SCOPES,
};

// ---------------------------------------------------------------------------
// Vault-side tokens (Reddit superset of the shared StoredOAuthTokens)
// ---------------------------------------------------------------------------

/**
 * Reddit vault-side token record. Extends the shared StoredOAuthTokens with
 * the Reddit flow's own fields: the long-lived refresh token
 * (duration=permanent grants) and the granted scope string. Vault-side ONLY
 * (renderer-safe records never carry these).
 */
export interface RedditStoredTokens extends StoredOAuthTokens {
  /** The long-lived refresh token (present for duration=permanent grants). */
  refreshToken: string | null;
  /** The scope string the provider reported on the last token response. */
  grantedScope: string | null;
}

/**
 * Account + token persistence for the Reddit connector: same seam as the
 * shared OAuthAccountStore (renderer-safe records on one side, raw tokens
 * vault-side), with the Reddit token superset on the vault side.
 */
export interface RedditOAuthAccountStore {
  loadAccount(internalAccountId: string): Promise<ProviderAccountRecord | null>;
  saveAccount(record: ProviderAccountRecord): Promise<void>;
  removeAccount(internalAccountId: string): Promise<void>;
  loadTokens(internalAccountId: string): Promise<RedditStoredTokens | null>;
  saveTokens(internalAccountId: string, tokens: RedditStoredTokens): Promise<void>;
  removeTokens(internalAccountId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Authorization request (code flow; Reddit parameter set — SPACE scopes,
// duration=permanent, NO PKCE)
// ---------------------------------------------------------------------------

export interface BuildRedditAuthorizationRequestOptions {
  /**
   * The registered redirect URI — an EXPLICIT input (the installed-app type
   * the App Types wiki documents for desktop apps allows arbitrary schemes
   * like a WebFlix deep link or loopback; the operator registers the exact
   * URI when creating the app at reddit.com/prefs/apps).
   */
  redirectUri: string;
  state?: string;
  scopes?: readonly string[];
  /** Defaults to "permanent" — the only duration that yields a refresh token. */
  duration?: "permanent" | "temporary";
  config?: RedditLoginConfig;
}

export interface RedditAuthorizationRequest {
  url: string;
  redirectUri: string;
  state: string;
  scopes: readonly string[];
  duration: "permanent" | "temporary";
}

function randomState(): string {
  // A 32-hex-digit CSRF token (the shared substrate's createPkcePair is
  // PKCE-shaped; Reddit's code flow needs an unguessable state string).
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

export function buildRedditAuthorizationRequest(
  options: BuildRedditAuthorizationRequestOptions,
): RedditAuthorizationRequest {
  const config = options.config ?? REDDIT_LOGIN_CONFIG;
  if (
    typeof options?.redirectUri !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(options.redirectUri)
  ) {
    throw new OAuthFlowError(
      "redirectUri must be an absolute URI (the installed-app type the OAuth2 wiki documents for desktop apps; the operator registers the exact URI when creating the app at reddit.com/prefs/apps)",
    );
  }
  const scopes = options.scopes ?? config.scopes;
  const state = options.state ?? randomState();
  const duration = options.duration ?? "permanent";
  const url = new URL(REDDIT_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("duration", duration);
  url.searchParams.set("scope", scopes.join(" "));
  // Deliberately NO code_challenge / code_challenge_method — Reddit's
  // documented code flow defines no PKCE parameters (the client_secret
  // authenticates the exchange via HTTP Basic auth); sending them would be
  // invented input (asserted by fixture test). NO Facebook-comma scopes, no
  // Google/TikTok parameters either.
  return { url: url.toString(), redirectUri: options.redirectUri, state, scopes, duration };
}

// ---------------------------------------------------------------------------
// Token endpoint boundary (injected; no live calls in this package)
// ---------------------------------------------------------------------------

/** The official token response body (code exchange + refresh). */
export interface RedditTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  /** Present for duration=permanent code exchanges; absent on refreshes. */
  refresh_token?: string;
}

export type RedditEndpointRequest =
  | { kind: "token-exchange"; code: string; redirectUri: string }
  | { kind: "refresh"; refreshToken: string }
  | { kind: "revoke"; token: string; tokenTypeHint: "access_token" | "refresh_token" };

export type RedditEndpointResult =
  | { kind: "token"; token: RedditTokenResponse }
  /**
   * The provider confirmed the revocation (the wiki documents a successful
   * revoke as a normal 2xx; the typed seam keeps the confirmation honest).
   */
  | { kind: "revoked" }
  /**
   * The provider rejected the request with the live-captured JSON shape
   * {"message":"Unauthorized","error":401} (or a sibling envelope).
   */
  | { kind: "rejected"; message: string | null; code: number | null };

export type RedditTokenFetcher = (request: RedditEndpointRequest) => Promise<RedditEndpointResult>;

export const liveNetworkDeniedRedditFetcher: RedditTokenFetcher = async () => {
  throw new LiveNetworkDisabledError(
    "connectors/reddit oauth: live token endpoints are disabled (fixture-only; the live consent flow is pending the operator's self-serve Reddit app — operator item, reddit.com/prefs/apps)",
  );
};

// ---------------------------------------------------------------------------
// Session — flow + lifecycle over RedditOAuthAccountStore; canonical
// CredentialPort (frozen §2.6)
// ---------------------------------------------------------------------------

export interface RedditOAuthSessionOptions {
  store: RedditOAuthAccountStore;
  /** Installation-local id of the linked account (frozen §2.5 vocabulary). */
  internalAccountId: string;
  config?: RedditLoginConfig;
  tokenFetcher?: RedditTokenFetcher;
  clock?: () => number;
  expirySkewMs?: number;
}

/**
 * The per-user Reddit account session. Same lifecycle discipline as the
 * other four platforms: connect → (expiry-aware reads) → refresh →
 * disconnect (OFFICIAL revoke; failed revoke leaves the record intact and
 * retryable). Implements the REST client's RedditUserTokenSource.
 */
export class RedditOAuthSession {
  private readonly store: RedditOAuthAccountStore;
  private readonly internalAccountId: string;
  private readonly config: RedditLoginConfig;
  private readonly tokenFetcher: RedditTokenFetcher;
  private readonly nowFn: () => number;
  private readonly expirySkewMs: number;
  private pendingState: { state: string; redirectUri: string } | null = null;

  constructor(options: RedditOAuthSessionOptions) {
    this.store = options.store;
    this.internalAccountId = options.internalAccountId;
    this.config = options.config ?? REDDIT_LOGIN_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedRedditFetcher;
    this.nowFn = options.clock ?? (() => Date.now());
    this.expirySkewMs = options.expirySkewMs ?? 60_000;
  }

  /** Builds the authorization request and remembers the CSRF state. */
  startAuthorization(options: {
    redirectUri: string;
    scopes?: readonly string[];
  }): RedditAuthorizationRequest {
    const request = buildRedditAuthorizationRequest({
      redirectUri: options.redirectUri,
      scopes: options.scopes,
      config: this.config,
    });
    this.pendingState = { state: request.state, redirectUri: request.redirectUri };
    return request;
  }

  /**
   * Exchanges the authorization code after the state guard. The response's
   * refresh_token (duration=permanent) lands vault-side; the account record
   * flips to connected.
   */
  async completeAuthorization(options: {
    code: string;
    state: string;
  }): Promise<ProviderAccountRecord> {
    if (this.pendingState === null) {
      throw new OAuthFlowError(
        "no authorization request is in flight — call startAuthorization first",
      );
    }
    if (options.state !== this.pendingState.state) {
      throw new StateMismatchError(
        `reddit oauth: authorization state mismatch (expected the state from startAuthorization, got "${options.state}") — possible CSRF, refusing the exchange`,
      );
    }
    const redirectUri = this.pendingState.redirectUri;
    const result = await this.tokenFetcher({
      kind: "token-exchange",
      code: options.code,
      redirectUri,
    });
    this.pendingState = null;
    if (result.kind !== "token") {
      const rejection = result.kind === "rejected" ? result : null;
      throw new RequiresAuthError(
        `Reddit code exchange was rejected (${rejection?.message ?? "unauthorized"}) — restart the consent flow`,
      );
    }
    const expiresAtMs =
      typeof result.token.expires_in === "number" && result.token.expires_in > 0
        ? this.nowFn() + result.token.expires_in * 1000
        : null;
    await this.store.saveTokens(this.internalAccountId, {
      accessToken: result.token.access_token,
      refreshToken:
        typeof result.token.refresh_token === "string" ? result.token.refresh_token : null,
      expiresAtMs,
      scope: typeof result.token.scope === "string" ? result.token.scope : "",
      tokenType: result.token.token_type ?? "bearer",
      grantedScope: typeof result.token.scope === "string" ? result.token.scope : null,
    });
    const record: ProviderAccountRecord = {
      providerId: REDDIT_PROVIDER_ID,
      internalAccountId: this.internalAccountId,
      displayName: "Reddit account",
      grantedScopes: this.config.scopes.slice(),
      status: "connected",
      connectedAt: new Date(this.nowFn()).toISOString(),
    };
    await this.store.saveAccount(record);
    return record;
  }

  /** The current renderer-safe account record (or null before connect). */
  async loadAccount(): Promise<ProviderAccountRecord | null> {
    return this.store.loadAccount(this.internalAccountId);
  }

  /**
   * A live access token — refreshing first when the stored one is inside
   * the expiry skew (an EXPIRED access token refreshes honestly; an expired
   * REFRESH path surfaces RequiresAuthError — re-consent is the only way).
   */
  async getUserAccessToken(): Promise<string | null> {
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (tokens === null) return null;
    const expired =
      tokens.expiresAtMs !== null && tokens.expiresAtMs - this.expirySkewMs <= this.nowFn();
    if (!expired) return tokens.accessToken;
    try {
      return await this.refreshAccessToken();
    } catch {
      // The refresh path failed (rejected refresh token / no refresh token):
      // mark the account expired and surface the honest re-auth state.
      const record = await this.store.loadAccount(this.internalAccountId);
      if (record !== null) {
        await this.store.saveAccount(transitionAccount(record, "expired"));
      }
      return null;
    }
  }

  /**
   * Refreshes the access token via grant_type=refresh_token. Reddit's wiki
   * documents no rotation: the stored refresh token stays unless the
   * response carries a new one.
   */
  async refreshAccessToken(): Promise<string> {
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (tokens === null) {
      throw new RequiresAuthError("no Reddit tokens are stored — complete the consent flow first");
    }
    if (tokens.refreshToken === null || tokens.refreshToken === "") {
      throw new RequiresAuthError(
        "the stored grant has no refresh token (duration=permanent grants carry one; re-consent is required)",
      );
    }
    const result = await this.tokenFetcher({ kind: "refresh", refreshToken: tokens.refreshToken });
    if (result.kind !== "token") {
      const rejection = result.kind === "rejected" ? result : null;
      throw new RequiresAuthError(
        `Reddit refresh was rejected (${rejection?.message ?? "unauthorized"}) — re-consent is the only honest path`,
      );
    }
    const nextRefresh =
      typeof result.token.refresh_token === "string" && result.token.refresh_token !== ""
        ? result.token.refresh_token
        : tokens.refreshToken;
    const expiresAtMs =
      typeof result.token.expires_in === "number" && result.token.expires_in > 0
        ? this.nowFn() + result.token.expires_in * 1000
        : null;
    await this.store.saveTokens(this.internalAccountId, {
      accessToken: result.token.access_token,
      refreshToken: nextRefresh,
      expiresAtMs,
      scope:
        typeof result.token.scope === "string" && result.token.scope !== ""
          ? result.token.scope
          : tokens.scope,
      tokenType: result.token.token_type ?? "bearer",
      grantedScope:
        typeof result.token.scope === "string" ? result.token.scope : tokens.grantedScope,
    });
    return result.token.access_token;
  }

  /**
   * Disconnect through the OFFICIAL revocation (POST /api/v1/revoke_token —
   * both the access and refresh tokens are revoked so the provider-side
   * grant is fully destroyed). A FAILED revoke leaves the local record
   * intact and retryable; the vault-side tokens are destroyed only after
   * the provider confirms (the Twitch/Instagram precedent).
   */
  async disconnect(): Promise<ProviderAccountRecord> {
    const record = await this.store.loadAccount(this.internalAccountId);
    const tokens = await this.store.loadTokens(this.internalAccountId);
    if (record === null || tokens === null) {
      throw new RequiresAuthError("no Reddit account is connected for this session");
    }
    if (record.status !== "connected") {
      throw new InvalidTransitionError(
        `cannot disconnect from account status "${record.status}" — only a connected account may revoke`,
      );
    }
    // Revoke the refresh token FIRST when present — the wiki: "Revoking a
    // refresh token will also revoke any related access tokens!" — then the
    // access token itself (both calls official; both failures leave intact).
    if (tokens.refreshToken !== null && tokens.refreshToken !== "") {
      const refreshResult = await this.tokenFetcher({
        kind: "revoke",
        token: tokens.refreshToken,
        tokenTypeHint: "refresh_token",
      });
      if (refreshResult.kind !== "revoked") {
        const rejection = refreshResult.kind === "rejected" ? refreshResult : null;
        throw new OAuthFlowError(
          `Reddit rejected the refresh-token revocation (${rejection?.message ?? "unauthorized"}) — the local record stays intact and the disconnect is retryable`,
        );
      }
    }
    const accessResult = await this.tokenFetcher({
      kind: "revoke",
      token: tokens.accessToken,
      tokenTypeHint: "access_token",
    });
    if (accessResult.kind !== "revoked") {
      const rejection = accessResult.kind === "rejected" ? accessResult : null;
      throw new OAuthFlowError(
        `Reddit rejected the access-token revocation (${rejection?.message ?? "unauthorized"}) — the local record stays intact and the disconnect is retryable`,
      );
    }
    const revoked = transitionAccount(record, "revoked");
    await this.store.saveAccount(revoked);
    await this.store.removeTokens(this.internalAccountId);
    return revoked;
  }

  /**
   * Canonical §2.5/§2.6 CredentialPort view of this session (main-process).
   * Resolves an opaque CredentialRef HANDLE for (providerId,
   * internalAccountId) — never a token.
   */
  credentialPort(): CredentialPort {
    return {
      getToken: async (providerId: string, internalAccountId: string) => {
        if (providerId !== REDDIT_PROVIDER_ID) {
          throw new RequiresAuthError(
            `reddit oauth session: providerId "${providerId}" is not "${REDDIT_PROVIDER_ID}"`,
          );
        }
        const record = await this.store.loadAccount(internalAccountId);
        const tokens = await this.store.loadTokens(internalAccountId);
        const status = deriveAccountStatus(record, this.nowFn());
        if (!record || !tokens || status === null || status === "revoked") {
          throw new RequiresAuthError(
            `reddit oauth: no usable credential for account "${internalAccountId}" (status: ${
              status ?? "no linked account"
            })`,
          );
        }
        return { handle: `reddit:${internalAccountId}:access` };
      },
    };
  }

  /** The frozen-vocabulary status derivation (connected → expired → revoked). */
  deriveStatus(record: ProviderAccountRecord | null): OAuthAccountStatus | null {
    return deriveAccountStatus(record, this.nowFn());
  }
}

// ---------------------------------------------------------------------------
// In-memory store (test substrate; the vault owns the real one)
// ---------------------------------------------------------------------------

/** A test/in-memory RedditOAuthAccountStore. */
export class InMemoryRedditOAuthAccountStore implements RedditOAuthAccountStore {
  private readonly accounts = new Map<string, ProviderAccountRecord>();
  private readonly tokens = new Map<string, RedditStoredTokens>();

  async loadAccount(id: string): Promise<ProviderAccountRecord | null> {
    return this.accounts.get(id) ?? null;
  }
  async saveAccount(record: ProviderAccountRecord): Promise<void> {
    this.accounts.set(record.internalAccountId, { ...record });
  }
  async removeAccount(id: string): Promise<void> {
    this.accounts.delete(id);
  }
  async loadTokens(id: string): Promise<RedditStoredTokens | null> {
    return this.tokens.get(id) ?? null;
  }
  async saveTokens(id: string, next: RedditStoredTokens): Promise<void> {
    this.tokens.set(id, { ...next });
  }
  async removeTokens(id: string): Promise<void> {
    this.tokens.delete(id);
  }
}

export { REDDIT_DISPLAY_NAME };
