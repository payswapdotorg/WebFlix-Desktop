/**
 * Per-user YouTube OAuth — loopback + PKCE flow DESIGN and token lifecycle.
 *
 * FLOW DESIGN (per-user, loopback + PKCE — the official installed-app flow):
 *  1. The app registers ConnectorManifests; YouTube requires OAuth with the
 *     official read-only scope set (see ./manifest).
 *  2. For a signed-in WebFlix user U, the app spawns a loopback listener on
 *     127.0.0.1:<ephemeral port> and calls startAuthorization({ redirectPort }).
 *  3. startAuthorization builds the authorization request against the official
 *     Google authorization endpoint with response_type=code, access_type=offline,
 *     prompt=consent, a single-use random `state`, and a PKCE S256 pair. The
 *     verifier never leaves this process.
 *  4. The user completes consent in the system browser; Google redirects to
 *     http://127.0.0.1:<port>/oauth/callback?code=...&state=...
 *  5. The app calls completeAuthorization({ code, state }); the state is matched
 *     against the pending request (CSRF guard) and the code is exchanged (with
 *     the verifier) at the official token endpoint.
 *  6. Tokens are stored ONLY through the CredentialPort for (providerId, userId)
 *     as a ProviderAccountRecord (freeze §2.5).
 *  7. getToken() serves access tokens from the port and transparently refreshes
 *     near/past expiry; a provider invalid_grant on refresh honestly transitions
 *     the account to 'revoked'. revoke() hits the official revocation endpoint.
 *     acknowledgeRevocation() moves 'revoked' → 'requires-auth' so the user can
 *     re-consent. No other transitions are legal (see OAUTH_TRANSITIONS).
 *
 * This module contains NO real client id and performs NO live network calls:
 * the token fetcher is injected, and the default fetcher fails with
 * LiveNetworkDisabledError (fixture-only; live smoke pending-operator-credential).
 */
import { createHash, randomBytes } from 'node:crypto';

import { LiveNetworkDisabledError } from './dataApi';
import { YOUTUBE_OAUTH_SCOPES, YOUTUBE_PROVIDER_ID } from './manifest';
import type {
  CredentialPort,
  ProviderAccountRecord,
  ProviderAccountStatus,
} from 'webflix-contracts';

/** Alias used across the OAuth surface (same lifecycle as freeze §2.5). */
export type OAuthAccountStatus = ProviderAccountStatus;

/** Access-token freshness window: refresh when expiry is within this skew. */
export const DEFAULT_EXPIRY_SKEW_MS = 60_000;

// ---------------------------------------------------------------------------
// Configuration — official endpoints, placeholder client id (NO real client id)
// ---------------------------------------------------------------------------

export interface OAuthLoopbackConfig {
  clientId: string;
  scopes: readonly string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  loopbackHost: string;
  loopbackPath: string;
}

export const YOUTUBE_OAUTH_LOOPBACK_CLIENT_ID =
  'WEBFLIX-DESKTOP-YOUTUBE-CLIENT-ID-PENDING-OPERATOR-PROVISIONING';

export const YOUTUBE_OAUTH_LOOPBACK_CONFIG: OAuthLoopbackConfig = {
  clientId: YOUTUBE_OAUTH_LOOPBACK_CLIENT_ID,
  scopes: YOUTUBE_OAUTH_SCOPES,
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  loopbackHost: '127.0.0.1',
  loopbackPath: '/oauth/callback',
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RequiresAuthError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = 'RequiresAuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RefreshFailedError extends OAuthError {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'RefreshFailedError';
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class StateMismatchError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = 'StateMismatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OAuthFlowError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthFlowError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidTransitionError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// PKCE (S256) — verifier stays in-process; only the challenge leaves
// ---------------------------------------------------------------------------

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

const PKCE_VERIFIER_BYTES = 32; // base64url → 43 chars (RFC 7636 allows 43..128)

export function createPkcePair(verifierBytes?: Buffer): PkcePair {
  const bytes = verifierBytes ?? randomBytes(PKCE_VERIFIER_BYTES);
  const codeVerifier = bytes.toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

// ---------------------------------------------------------------------------
// Authorization request + CSRF state guard
// ---------------------------------------------------------------------------

export interface BuildAuthorizationRequestOptions {
  redirectPort: number;
  state?: string;
  pkce?: PkcePair;
  config?: OAuthLoopbackConfig;
}

export interface AuthorizationRequest extends PkcePair {
  url: string;
  redirectUri: string;
  state: string;
}

export function buildAuthorizationRequest(options: BuildAuthorizationRequestOptions): AuthorizationRequest {
  const config = options.config ?? YOUTUBE_OAUTH_LOOPBACK_CONFIG;
  if (!Number.isInteger(options.redirectPort) || options.redirectPort <= 0 || options.redirectPort > 65535) {
    throw new OAuthFlowError('redirectPort must be a real loopback listener port (1..65535)');
  }
  const redirectUri = `http://${config.loopbackHost}:${options.redirectPort}${config.loopbackPath}`;
  const pkce = options.pkce ?? createPkcePair();
  const state = options.state ?? randomBytes(16).toString('base64url');
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
  return {
    url: url.toString(),
    redirectUri,
    state,
    codeVerifier: pkce.codeVerifier,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod,
  };
}

export function validateCallbackState(returnedState: string | null | undefined, expectedState: string): void {
  if (!returnedState || returnedState !== expectedState) {
    throw new StateMismatchError(
      'authorization callback state does not match the pending request (possible CSRF); aborting the flow',
    );
  }
}

// ---------------------------------------------------------------------------
// Token lifecycle state machine — authorized → expired → revoked → requires-auth
// ---------------------------------------------------------------------------

export const OAUTH_TRANSITIONS: Readonly<Record<OAuthAccountStatus, readonly OAuthAccountStatus[]>> = {
  'requires-auth': ['authorized'],
  authorized: ['expired', 'revoked'],
  expired: ['authorized', 'revoked'],
  revoked: ['requires-auth'],
};

export function canTransition(from: OAuthAccountStatus, to: OAuthAccountStatus): boolean {
  return OAUTH_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OAuthAccountStatus, to: OAuthAccountStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(`illegal oauth account transition: ${from} → ${to}`);
  }
}

/** Derives the honest current status from the stored record and the clock. */
export function deriveAccountStatus(record: ProviderAccountRecord | null, now: number): OAuthAccountStatus {
  if (!record) return 'requires-auth';
  // account status is authoritative for terminal states (revoked clears
  // credentials — the record still reports revoked, not requires-auth)
  if (record.status === 'revoked') return 'revoked';
  if (record.status === 'expired') return 'expired';
  if (!record.credentials || !record.credentials.accessToken) return 'requires-auth';
  if (record.credentials.expiresAt !== null && record.credentials.expiresAt <= now) return 'expired';
  return record.status === 'authorized' ? 'authorized' : 'requires-auth';
}

/** Pure transition helper: validates, stamps updatedAt, clears credentials on revoked/requires-auth. */
export function transitionAccount(
  record: ProviderAccountRecord,
  to: OAuthAccountStatus,
  now: number,
): ProviderAccountRecord {
  assertTransition(record.status, to);
  return {
    ...record,
    status: to,
    updatedAt: now,
    credentials: to === 'authorized' || to === 'expired' ? record.credentials : null,
  };
}

// ---------------------------------------------------------------------------
// Token endpoint boundary (injected; no live calls in this package)
// ---------------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export type OAuthEndpointRequest =
  | { kind: 'token-exchange'; code: string; codeVerifier: string; redirectUri: string }
  | { kind: 'refresh'; refreshToken: string }
  | { kind: 'revoke'; token: string };

export type OAuthEndpointResult = { kind: 'token'; token: OAuthTokenResponse } | { kind: 'revoked' };

export type OAuthTokenFetcher = (request: OAuthEndpointRequest) => Promise<OAuthEndpointResult>;

export const liveNetworkDeniedTokenFetcher: OAuthTokenFetcher = async () => {
  throw new LiveNetworkDisabledError(
    'connectors/youtube oauth: live token endpoints are disabled (fixture-only; live smoke is pending-operator-credential)',
  );
};

// ---------------------------------------------------------------------------
// Session — getToken via CredentialPort; refresh; revoke
// ---------------------------------------------------------------------------

export interface YouTubeOAuthSessionOptions {
  credentialPort: CredentialPort;
  userId: string;
  config?: OAuthLoopbackConfig;
  tokenFetcher?: OAuthTokenFetcher;
  clock?: () => number;
  expirySkewMs?: number;
}

interface PendingAuthorization {
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

export class YouTubeOAuthSession {
  private readonly credentialPort: CredentialPort;
  private readonly userId: string;
  private readonly config: OAuthLoopbackConfig;
  private readonly tokenFetcher: OAuthTokenFetcher;
  private readonly clock: () => number;
  private readonly expirySkewMs: number;
  private readonly pending = new Map<string, PendingAuthorization>();

  constructor(options: YouTubeOAuthSessionOptions) {
    this.credentialPort = options.credentialPort;
    this.userId = options.userId;
    this.config = options.config ?? YOUTUBE_OAUTH_LOOPBACK_CONFIG;
    this.tokenFetcher = options.tokenFetcher ?? liveNetworkDeniedTokenFetcher;
    this.clock = options.clock ?? Date.now;
    this.expirySkewMs = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  }

  private now(): number {
    return this.clock();
  }

  async loadAccount(): Promise<ProviderAccountRecord | null> {
    return this.credentialPort.get(YOUTUBE_PROVIDER_ID, this.userId);
  }

  async status(): Promise<OAuthAccountStatus> {
    return deriveAccountStatus(await this.loadAccount(), this.now());
  }

  /** Step 2–3 of the flow: build the loopback+PKCE authorization URL and remember pending state. */
  startAuthorization(options: { redirectPort: number; state?: string; pkce?: PkcePair }): AuthorizationRequest {
    const request = buildAuthorizationRequest({
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

  /** Step 5–6: validate state, exchange the code (PKCE), persist via CredentialPort. */
  async completeAuthorization(callback: {
    code: string;
    state: string;
    providerAccountId?: string | null;
    displayName?: string | null;
  }): Promise<ProviderAccountRecord> {
    const pending = this.pending.get(callback.state);
    if (!pending) {
      throw new StateMismatchError('no pending authorization matches the returned state parameter');
    }
    this.pending.delete(callback.state);
    const result = await this.tokenFetcher({
      kind: 'token-exchange',
      code: callback.code,
      codeVerifier: pending.codeVerifier,
      redirectUri: pending.redirectUri,
    });
    if (result.kind !== 'token') {
      throw new OAuthFlowError('token endpoint did not return a token for the authorization code');
    }
    const now = this.now();
    const record: ProviderAccountRecord = {
      providerId: YOUTUBE_PROVIDER_ID,
      userId: this.userId,
      providerAccountId: callback.providerAccountId ?? null,
      displayName: callback.displayName ?? null,
      status: 'authorized',
      linkedAt: now,
      updatedAt: now,
      credentials: {
        accessToken: result.token.access_token,
        refreshToken: result.token.refresh_token ?? null,
        expiresAt: now + result.token.expires_in * 1000,
        scope: result.token.scope ?? this.config.scopes.join(' '),
        tokenType: result.token.token_type ?? 'Bearer',
      },
    };
    await this.credentialPort.put(record);
    return record;
  }

  /** getToken via CredentialPort — refreshes transparently near/past expiry; never fakes availability. */
  async getToken(): Promise<string> {
    const record = await this.loadAccount();
    const status = deriveAccountStatus(record, this.now());
    if (!record?.credentials?.accessToken || status === 'requires-auth' || status === 'revoked') {
      throw new RequiresAuthError(
        `youtube oauth: user "${this.userId}" is ${status}; no usable access token — run startAuthorization()/completeAuthorization() first`,
      );
    }
    const expiresAt = record.credentials.expiresAt;
    const needsRefresh =
      status === 'expired' || (expiresAt !== null && expiresAt - this.expirySkewMs <= this.now());
    if (needsRefresh) {
      const refreshed = await this.refresh();
      const token = refreshed.credentials?.accessToken;
      if (!token) {
        throw new RefreshFailedError('youtube oauth: refresh completed without an access token', 'no-token');
      }
      return token;
    }
    return record.credentials.accessToken;
  }

  /** Refresh grant via the official token endpoint; invalid_grant honestly revokes the account. */
  async refresh(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    if (!record || !record.credentials) {
      throw new RequiresAuthError(`youtube oauth: no stored account for user "${this.userId}" to refresh`);
    }
    const refreshToken = record.credentials.refreshToken;
    if (!refreshToken) {
      throw new RequiresAuthError(
        `youtube oauth: stored account for user "${this.userId}" has no refresh token; re-run the loopback authorization flow`,
      );
    }
    let result: OAuthEndpointResult;
    try {
      result = await this.tokenFetcher({ kind: 'refresh', refreshToken });
    } catch (err) {
      const reason = (err as { reason?: string })?.reason ?? 'unknown';
      if (reason === 'invalid_grant') {
        const now = this.now();
        const revoked: ProviderAccountRecord = { ...record, status: 'revoked', credentials: null, updatedAt: now };
        await this.credentialPort.put(revoked);
        throw new RefreshFailedError(
          `youtube oauth: provider rejected refresh with invalid_grant for user "${this.userId}"; account marked revoked`,
          'invalid_grant',
        );
      }
      throw new RefreshFailedError(
        `youtube oauth: refresh failed for user "${this.userId}": ${(err as Error | undefined)?.message ?? String(err)}`,
        reason,
      );
    }
    if (result.kind !== 'token') {
      throw new RefreshFailedError('youtube oauth: refresh endpoint returned no token', 'no-token');
    }
    const now = this.now();
    const refreshed: ProviderAccountRecord = {
      ...record,
      status: 'authorized',
      updatedAt: now,
      credentials: {
        accessToken: result.token.access_token,
        refreshToken: result.token.refresh_token ?? refreshToken,
        expiresAt: now + result.token.expires_in * 1000,
        scope: result.token.scope ?? record.credentials.scope,
        tokenType: result.token.token_type ?? record.credentials.tokenType ?? 'Bearer',
      },
    };
    await this.credentialPort.put(refreshed);
    return refreshed;
  }

  /** Revoke at the official revocation endpoint; authorized/expired → revoked; credentials destroyed. */
  async revoke(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    const status = deriveAccountStatus(record, this.now());
    if (!record?.credentials || status === 'requires-auth') {
      throw new RequiresAuthError(
        `youtube oauth: nothing to revoke for user "${this.userId}" (status ${status})`,
      );
    }
    const token = record.credentials.accessToken ?? record.credentials.refreshToken;
    if (!token) {
      throw new RequiresAuthError(`youtube oauth: no token available to revoke for user "${this.userId}"`);
    }
    const result = await this.tokenFetcher({ kind: 'revoke', token });
    if (result.kind !== 'revoked') {
      throw new OAuthFlowError('revocation endpoint returned an unexpected response');
    }
    assertTransition(status, 'revoked');
    const now = this.now();
    const revoked: ProviderAccountRecord = { ...record, status: 'revoked', credentials: null, updatedAt: now };
    await this.credentialPort.put(revoked);
    return revoked;
  }

  /** revoked → requires-auth: the operator/user acknowledges so a fresh consent can begin. */
  async acknowledgeRevocation(): Promise<ProviderAccountRecord> {
    const record = await this.loadAccount();
    if (!record) {
      throw new RequiresAuthError(`youtube oauth: no stored account to acknowledge for user "${this.userId}"`);
    }
    assertTransition(record.status, 'requires-auth');
    const now = this.now();
    const next: ProviderAccountRecord = { ...record, status: 'requires-auth', credentials: null, updatedAt: now };
    await this.credentialPort.put(next);
    return next;
  }
}
