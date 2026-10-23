/**
 * WFX-OAUTH-CONNECT-1 — the operator-provisioned OAuth client → the REAL
 * per-user loopback+PKCE connect flow (main process only).
 *
 * Boundary laws (all binding, work order
 * docs/plans/work-orders/WFX-OAUTH-CONNECT-1.md):
 *   - The connectors package stays network-free: the frozen
 *     YouTubeOAuthSession (connectors/src/youtube/oauth.ts) is consumed
 *     EXACTLY as exported — injected tokenFetcher, injected config. The
 *     session's PKCE/state/transitions code is never re-implemented here.
 *   - The client credentials are resolved the same way the Data API key is
 *     (webflixAgentWorkspaceIpc.ts precedent): main-process env FIRST
 *     (WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID + WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET),
 *     then the user-managed <dataRoot>/youtube-oauth-client.json. NEVER baked
 *     into the binary, never committed, never logged, never renderer-visible.
 *     The client SECRET only ever reaches the token-endpoint request body.
 *   - Consent opens in the SYSTEM browser via the injectable openBrowser
 *     (shell.openExternal at the IPC seam — this module itself imports NO
 *     electron API, so the battery drives it with plain doubles).
 *     WEBFLIX_YOUTUBE_OAUTH_OPEN=manual skips the launch and logs the
 *     authorization URL for manual copy (RFC 8252 §5.2.2 permits manual
 *     copy/paste; the URL carries only the public client id + single-use
 *     state/challenge — no secret material).
 *   - Tokens go ONLY to the OAuthAccountStore (the OS vault — encrypted at
 *     rest); the renderer-safe ProviderAccountRecord is the only record.
 *     Nothing on this module's typed outcomes can carry a token or the
 *     secret, by construction.
 *   - The flow is bounded: the loopback listener expires
 *     (default 300s) and cleans up. Every completion is typed + logged
 *     (info for connected, warn for failures) with NO token/secret material.
 */
import { createServer as nodeCreateServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  YouTubeOAuthSession,
  YOUTUBE_OAUTH_LOOPBACK_CONFIG,
} from "../../../../connectors/src/youtube/oauth.js";
import type {
  OAuthAccountStore,
  OAuthEndpointRequest,
  OAuthEndpointResult,
  OAuthLoopbackConfig,
  OAuthTokenFetcher,
} from "connectors";
import type { ProviderAccountRecord } from "webflix-contracts";

/** The user-managed client file (one JSON object) under the data root. */
export const WEBFLIX_YOUTUBE_OAUTH_CLIENT_FILENAME = "youtube-oauth-client.json";

/** Default loopback-listener lifetime (the honest bounded flow). */
export const DEFAULT_CONNECT_FLOW_TIMEOUT_MS = 300_000;

/** The resolved operator client. `clientSecret` is main-process-only material. */
export interface YouTubeOAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly source: "env" | "file";
}

export interface ResolveYouTubeOAuthClientDeps {
  readonly env: NodeJS.ProcessEnv;
  /** The WebFlix data root holding the client file (absolute). */
  readonly dataRoot?: string;
  /** Injectable file reader (tests). */
  readonly readClientFile?: (path: string) => string;
}

function isNonEmptyTrimmed(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves the operator-provisioned client: env first, then the data-root
 * file. Malformed/absent → null (the honest not-configured state — the
 * caller refuses connect typed; nothing is guessed, nothing is authorized).
 */
export function resolveYouTubeOAuthClient(
  deps: ResolveYouTubeOAuthClientDeps,
): YouTubeOAuthClientCredentials | null {
  const envId = deps.env.WEBFLIX_YOUTUBE_OAUTH_CLIENT_ID?.trim() ?? "";
  const envSecret = deps.env.WEBFLIX_YOUTUBE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (envId !== "" && envSecret !== "") {
    return { clientId: envId, clientSecret: envSecret, source: "env" };
  }
  if (envId !== "" || envSecret !== "") {
    // Half-provisioned env is a configuration mistake — refuse rather than
    // half-run a flow (honest not-configured, same typed outcome).
    return null;
  }
  const readFile = deps.readClientFile ?? readFileSync;
  const root = deps.dataRoot?.trim();
  if (!root || root === "") {
    return null;
  }
  const clientFile = join(root, WEBFLIX_YOUTUBE_OAUTH_CLIENT_FILENAME);
  try {
    if (!existsSync(clientFile)) {
      return null;
    }
    const parsed: unknown = JSON.parse(readFile(clientFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (!isNonEmptyTrimmed(candidate.clientId) || !isNonEmptyTrimmed(candidate.clientSecret)) {
      return null;
    }
    return {
      clientId: candidate.clientId.trim(),
      clientSecret: candidate.clientSecret.trim(),
      source: "file",
    };
  } catch {
    // An unreadable/malformed client file is the honest not-configured state.
    return null;
  }
}

/** Builds the loopback config with the REAL operator client id (public half). */
export function buildYouTubeLoopbackConfig(clientId: string): OAuthLoopbackConfig {
  return { ...YOUTUBE_OAUTH_LOOPBACK_CONFIG, clientId };
}

/** Typed endpoint error carrying Google's `error` code (never the secret). */
export class GoogleEndpointError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "GoogleEndpointError";
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface GoogleHttpTokenFetcherDeps {
  readonly fetchFn?: typeof fetch;
  readonly tokenEndpoint?: string;
  readonly revocationEndpoint?: string;
}

async function postForm(
  fetchFn: typeof fetch,
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const error =
    payload !== null && typeof payload === "object"
      ? (payload as Record<string, unknown>).error
      : undefined;
  if (!response.ok) {
    const code = typeof error === "string" ? error : `http_${response.status}`;
    // The message deliberately carries ONLY the typed error code + status —
    // the request body (which holds the secret) is never reflected.
    throw new GoogleEndpointError(`google oauth endpoint error: ${code} (status ${response.status})`, code);
  }
  if (payload === null || typeof payload !== "object") {
    throw new GoogleEndpointError("google oauth endpoint returned a non-JSON body", "invalid_response");
  }
  return payload as Record<string, unknown>;
}

/**
 * The REAL token fetcher against the official Google endpoints. The client
 * secret travels ONLY inside the POST bodies below. A Google `error` code
 * (e.g. invalid_grant / invalid_client) surfaces as GoogleEndpointError.reason
 * so the session's honest revoked-on-invalid_grant transition fires.
 */
export function createGoogleHttpTokenFetcher(
  clientId: string,
  clientSecret: string,
  deps: GoogleHttpTokenFetcherDeps = {},
): OAuthTokenFetcher {
  const fetchFn = deps.fetchFn ?? fetch;
  const tokenEndpoint = deps.tokenEndpoint ?? YOUTUBE_OAUTH_LOOPBACK_CONFIG.tokenEndpoint;
  const revocationEndpoint =
    deps.revocationEndpoint ?? YOUTUBE_OAUTH_LOOPBACK_CONFIG.revocationEndpoint;
  return async (request: OAuthEndpointRequest): Promise<OAuthEndpointResult> => {
    if (request.kind === "revoke") {
      await postForm(fetchFn, revocationEndpoint, { token: request.token });
      return { kind: "revoked" };
    }
    const form: Record<string, string> = { client_id: clientId, client_secret: clientSecret };
    if (request.kind === "token-exchange") {
      form.grant_type = "authorization_code";
      form.code = request.code;
      form.code_verifier = request.codeVerifier;
      form.redirect_uri = request.redirectUri;
    } else {
      form.grant_type = "refresh_token";
      form.refresh_token = request.refreshToken;
    }
    const payload = await postForm(fetchFn, tokenEndpoint, form);
    if (typeof payload.access_token !== "string" || payload.access_token === "") {
      throw new GoogleEndpointError("google token endpoint returned no access_token", "invalid_response");
    }
    return {
      kind: "token",
      token: {
        access_token: payload.access_token,
        expires_in: typeof payload.expires_in === "number" ? payload.expires_in : 3600,
        refresh_token: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
        scope: typeof payload.scope === "string" ? payload.scope : undefined,
        token_type: typeof payload.token_type === "string" ? payload.token_type : undefined,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// The connect flow manager — one active flow per provider, bounded lifetime
// ---------------------------------------------------------------------------

export type ConnectFlowStartCode = "authorization-started" | "authorization-in-progress" | "flow-error";

export interface ConnectFlowStartOutcome {
  readonly ok: boolean;
  readonly code: ConnectFlowStartCode;
  readonly reason: string;
}

/** start()'s result: the typed start outcome + the background completion (race-free). */
export interface ConnectFlowStartResult {
  readonly outcome: ConnectFlowStartOutcome;
  readonly completion: Promise<ConnectFlowCompletion>;
}

/** The typed BACKGROUND completion (logged; never renderer-visible). */
export type ConnectFlowCompletion =
  | { readonly ok: true; readonly code: "connected"; readonly record: ProviderAccountRecord }
  | {
      readonly ok: false;
      readonly code: "flow-error" | "flow-timeout" | "state-mismatch" | "access-denied";
      readonly reason: string;
    };

export interface StartConnectFlowOptions {
  readonly logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  /** The OS-vault-backed store (tokens + renderer-safe record land here). */
  readonly store: OAuthAccountStore;
  /** The loopback config carrying the REAL client id. */
  readonly config: OAuthLoopbackConfig;
  /** The real (or test-double) token fetcher. */
  readonly tokenFetcher: OAuthTokenFetcher;
  /** The canonical installation-local account id. */
  readonly internalAccountId: string;
  /** Opens the system browser (shell.openExternal at the IPC seam). */
  readonly openBrowser: (url: string) => Promise<void>;
  /** Manual mode: skip the browser launch; log the URL for copy/paste. */
  readonly manualOpen: boolean;
  readonly flowTimeoutMs?: number;
  readonly createHttpServer?: (handler: (req: unknown, res: unknown) => void) => Server;
  readonly now?: () => number;
}

interface ActiveFlow {
  readonly completion: Promise<ConnectFlowCompletion>;
  readonly settle: (value: ConnectFlowCompletion) => void;
  readonly startedAt: number;
  cleanup: () => void;
}

function completionPageHtml(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family: system-ui; padding: 40px;"><h2>${title}</h2><p>${body}</p></body></html>`;
}

/**
 * Single-flight manager: at most one pending authorization per provider; a
 * second connect while one waits answers the typed in-progress outcome.
 */
export class YouTubeConnectFlowManager {
  private readonly active = new Map<string, ActiveFlow>();
  private readonly flowTimeoutMs: number;
  private readonly createHttpServer: StartConnectFlowOptions["createHttpServer"];
  private readonly now: () => number;

  constructor(options: { flowTimeoutMs?: number; createHttpServer?: StartConnectFlowOptions["createHttpServer"]; now?: () => number } = {}) {
    this.flowTimeoutMs = options.flowTimeoutMs ?? DEFAULT_CONNECT_FLOW_TIMEOUT_MS;
    this.createHttpServer = options.createHttpServer ?? ((handler) => nodeCreateServer(handler));
    this.now = options.now ?? Date.now;
  }

  /** The provider ids with a pending flow (diagnostics/tests only). */
  activeProviders(): readonly string[] {
    return [...this.active.keys()];
  }

  /** The pending completion promise for a provider (tests only). */
  pendingCompletion(providerId: string): Promise<ConnectFlowCompletion> | null {
    return this.active.get(providerId)?.completion ?? null;
  }

  async start(providerId: string, options: StartConnectFlowOptions): Promise<ConnectFlowStartResult> {
    const existing = this.active.get(providerId);
    if (existing !== undefined) {
      return {
        outcome: {
          ok: false,
          code: "authorization-in-progress",
          reason: `A Google sign-in for "${providerId}" is already waiting in your system browser — finish it (or wait for it to expire) before starting another; nothing new was authorized.`,
        },
        completion: existing.completion,
      };
    }
    const timeoutMs = options.flowTimeoutMs ?? this.flowTimeoutMs;
    let settle!: (value: ConnectFlowCompletion) => void;
    const completion = new Promise<ConnectFlowCompletion>((resolve) => {
      settle = resolve;
    });
    const session = new YouTubeOAuthSession({
      store: options.store,
      internalAccountId: options.internalAccountId,
      config: options.config,
      tokenFetcher: options.tokenFetcher,
    });
    const server = this.createHttpServer((req, res) => {
      void this.handleCallback(providerId, options, session, settle, req as { url?: string }, res as {
        writeHead: (status: number, headers: Record<string, string>) => void;
        end: (body: string) => void;
      });
    });

    const closeServer = () => {
      server.close();
      server.removeAllListeners("error");
    };
    let listening = false;
    try {
      listening = await new Promise<boolean>((resolve) => {
        server.once("error", () => resolve(false));
        server.listen(0, "127.0.0.1", () => resolve(true));
      });
    } catch {
      listening = false;
    }
    if (!listening) {
      closeServer();
      const reason = "Connect could not start: the loopback redirect listener (127.0.0.1) is unavailable — nothing was authorized. Retry when the port is free.";
      settle({ ok: false, code: "flow-error", reason });
      return { outcome: { ok: false, code: "flow-error", reason }, completion };
    }
    const address = server.address();
    const redirectPort = typeof address === "object" && address !== null ? address.port : 0;
    if (redirectPort <= 0) {
      closeServer();
      const reason = "the loopback listener bound without a port — the authorization request could not be built; nothing was authorized.";
      settle({ ok: false, code: "flow-error", reason });
      return { outcome: { ok: false, code: "flow-error", reason }, completion };
    }
    let request: ReturnType<YouTubeOAuthSession["startAuthorization"]>;
    try {
      request = session.startAuthorization({ redirectPort });
    } catch (error) {
      closeServer();
      const reason = `the authorization request could not be built (${(error as Error)?.message ?? String(error)}) — nothing was authorized.`;
      settle({ ok: false, code: "flow-error", reason });
      return { outcome: { ok: false, code: "flow-error", reason }, completion };
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const clearActive = () => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      this.active.delete(providerId);
    };
    const active: ActiveFlow = { completion, settle, startedAt: this.now(), cleanup: () => { clearActive(); closeServer(); } };
    this.active.set(providerId, active);
    timeoutHandle = setTimeout(() => {
      if (!this.active.has(providerId)) return;
      active.cleanup();
      const reason = `the Google sign-in did not complete within ${Math.round(timeoutMs / 1000)}s — nothing was authorized; start Connect again`;
      options.logger.warn("[webflix-oauth] flow timed out (typed; nothing authorized)", { providerId });
      settle({ ok: false, code: "flow-timeout", reason });
    }, timeoutMs);

    if (options.manualOpen) {
      options.logger.info("[webflix-oauth] manual consent mode — open this URL in a browser to continue", {
        providerId,
        url: request.url,
      });
    } else {
      try {
        await options.openBrowser(request.url);
      } catch (error) {
        active.cleanup();
        const reason = `Connect opened no browser — the system browser could not be launched (${(error as Error)?.message ?? "openExternal failed"}); nothing was authorized.`;
        settle({ ok: false, code: "flow-error", reason });
        return { outcome: { ok: false, code: "flow-error", reason }, completion };
      }
    }

    options.logger.info("[webflix-oauth] authorization flow started (system browser consent)", {
      providerId,
      redirectPort,
      manual: options.manualOpen,
    });
    return {
      outcome: {
        ok: true,
        code: "authorization-started",
        reason: options.manualOpen
          ? "Google sign-in started in manual mode — complete the consent at the authorization URL printed in the WebFlix log; the account appears here when it finishes."
          : "Google sign-in opened in your system browser — complete the consent there; the account appears here when it finishes.",
      },
      completion,
    };
  }

  private async handleCallback(
    providerId: string,
    options: StartConnectFlowOptions,
    session: YouTubeOAuthSession,
    settle: (value: ConnectFlowCompletion) => void,
    req: { url?: string },
    res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void },
  ): Promise<void> {
    const active = this.active.get(providerId);
    if (active === undefined) {
      res.writeHead(410, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — sign-in no longer active", "This sign-in window has expired. Return to WebFlix and press Connect again."));
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${options.config.loopbackHost}`);
    } catch {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — malformed redirect", "The redirect could not be read; nothing was authorized."));
      return;
    }
    if (url.pathname !== options.config.loopbackPath) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix", "Not found."));
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    active.cleanup();
    if (error !== null) {
      const reason = `Google reported "${error}" — the consent was not completed; nothing was authorized.`;
      options.logger.warn("[webflix-oauth] consent refused at the provider", { providerId, error });
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — sign-in not completed", "You can close this tab and return to WebFlix. Nothing was authorized."));
      settle({ ok: false, code: "access-denied", reason });
      return;
    }
    if (code === null || state === null) {
      const reason = "the provider redirect carried no authorization code — nothing was authorized.";
      options.logger.warn("[webflix-oauth] callback without code/state (typed refusal)", { providerId });
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — malformed redirect", "The redirect carried no authorization code; nothing was authorized."));
      settle({ ok: false, code: "flow-error", reason });
      return;
    }
    try {
      const record = await session.completeAuthorization({ code, state });
      options.logger.info("[webflix-oauth] account connected (record persisted to the OS vault; tokens never logged)", {
        providerId,
        internalAccountId: record.internalAccountId,
        displayName: record.displayName,
      });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — account connected", "You can close this tab and return to the WebFlix app."));
      settle({ ok: true, code: "connected", record });
    } catch (error) {
      const isStateMismatch = (error as { name?: string })?.name === "StateMismatchError";
      const reason = isStateMismatch
        ? "the returned state did not match the pending request (possible CSRF) — the flow was aborted and nothing was authorized."
        : `the authorization code could not be exchanged (${(error as Error)?.message ?? String(error)}) — nothing was authorized.`;
      options.logger.warn("[webflix-oauth] authorization completion failed (typed)", {
        providerId,
        kind: isStateMismatch ? "state-mismatch" : "exchange-failure",
      });
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      res.end(completionPageHtml("WebFlix — sign-in failed", "Return to WebFlix and press Connect again. Nothing was authorized."));
      settle(
        isStateMismatch
          ? { ok: false, code: "state-mismatch", reason }
          : { ok: false, code: "flow-error", reason },
      );
    }
  }
}
