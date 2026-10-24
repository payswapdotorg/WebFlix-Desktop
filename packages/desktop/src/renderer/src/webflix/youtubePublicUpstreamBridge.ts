/**
 * WFX-ANON-VIEW-1 — the renderer-side fail-closed client for the key-free
 * public web transport bridge (mirrors netflixUpstreamBridge.ts exactly;
 * see preload/webflixYoutubePublicBridge.ts and main/webflixYoutubePublicIpc.ts
 * for the boundary law) + the transport adapter the public engine consumes.
 */

export interface WebFlixYoutubePublicFetchRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly bodyJson?: string;
}

export interface WebFlixYoutubePublicFetchResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly reason?: string;
}

export interface WebFlixYoutubePublicBridge {
  fetchUpstream(request: WebFlixYoutubePublicFetchRequest): Promise<WebFlixYoutubePublicFetchResult>;
}

declare global {
  interface Window {
    readonly webflixYoutubePublic?: WebFlixYoutubePublicBridge;
  }
}

/**
 * The live bridge, or null when absent (fail-closed — the honest typed
 * "public web transport unavailable" state; the composition then hands the
 * producers the requires-auth handle; nothing is invented).
 */
export function getWebFlixYoutubePublicBridge(): WebFlixYoutubePublicBridge | null {
  const candidate = (globalThis as { window?: { webflixYoutubePublic?: unknown } }).window
    ?.webflixYoutubePublic;
  if (candidate == null || typeof candidate !== "object") {
    return null;
  }
  const bridge = candidate as Partial<WebFlixYoutubePublicBridge>;
  if (typeof bridge.fetchUpstream !== "function") {
    return null;
  }
  return bridge as WebFlixYoutubePublicBridge;
}

/** The structural response the connectors public engine's transport consumes. */
export interface BridgePublicResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The bridge-backed public web transport: each call crosses the
 * main-process IPC (the only sanctioned youtube.com egress — the renderer's
 * own fetch cannot reach it: no CORS). A bridge-side failure throws so the
 * engine's honest-state mapping treats it as a dead transport — the honest
 * unavailable phase, never fabricated rows. GET/POST mirror the connector's
 * request shapes (POST rides the InnerTube JSON body verbatim).
 */
export function bridgeYoutubePublicFetch(
  bridge: () => WebFlixYoutubePublicBridge | null,
): (
  url: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string },
) => Promise<BridgePublicResponse> {
  return async (url, init) => {
    const live = bridge();
    if (live === null) {
      throw new Error("The key-free public web transport bridge is unavailable in this runtime.");
    }
    const result = await live.fetchUpstream({
      method: init.method,
      url,
      ...(init.body !== undefined ? { bodyJson: init.body } : {}),
    });
    if (!result.ok || typeof result.text !== "string") {
      throw new Error(result.reason ?? "The public web upstream transport refused the fetch.");
    }
    const text = result.text;
    return { ok: true, status: 200, text: async () => text };
  };
}
