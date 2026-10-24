/**
 * WFX-NETFLIX-SOURCE-1 — the renderer-side fail-closed client for the
 * Netflix transport bridge (mirrors agentWorkspaceBridge.ts exactly; see
 * preload/webflixNetflixBridge.ts and main/webflixNetflixIpc.ts for the
 * boundary law) + the upstream adapter the connector seam consumes.
 */

export interface WebFlixNetflixFetchResult {
  readonly ok: boolean;
  readonly text?: string;
  readonly reason?: string;
}

export interface WebFlixNetflixOpenUrlResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface WebFlixNetflixBridge {
  fetchUpstream(url: string): Promise<WebFlixNetflixFetchResult>;
  openUrl(url: string): Promise<WebFlixNetflixOpenUrlResult>;
}

declare global {
  interface Window {
    readonly webflixNetflix?: WebFlixNetflixBridge;
  }
}

/**
 * The live bridge, or null when absent (fail-closed — the honest typed
 * "Netflix transport unavailable" state; the producer then answers the
 * unavailable phase; nothing is invented).
 */
export function getWebFlixNetflixBridge(): WebFlixNetflixBridge | null {
  const candidate = (globalThis as { window?: { webflixNetflix?: unknown } }).window?.webflixNetflix;
  if (candidate == null || typeof candidate !== "object") {
    return null;
  }
  const bridge = candidate as Partial<WebFlixNetflixBridge>;
  if (typeof bridge.fetchUpstream !== "function" || typeof bridge.openUrl !== "function") {
    return null;
  }
  return bridge as WebFlixNetflixBridge;
}

/** The structural response the connector's upstream seam consumes. */
interface BridgeUpstreamResponse {
  readonly ok: boolean;
  text(): Promise<string>;
}

/**
 * The bridge-backed upstream fetch for the connector seam: each call crosses
 * the main-process IPC (the only sanctioned netflix.com egress — the
 * renderer's own fetch cannot reach it: no CORS). A bridge-side failure
 * throws so the connector's bounded retry + last-good ladder treats it as a
 * dead upstream — the honest unavailable phase, never fabricated rows.
 */
export function bridgeNetflixUpstreamFetch(
  bridge: () => WebFlixNetflixBridge | null,
): (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<BridgeUpstreamResponse> {
  return async (url) => {
    const live = bridge();
    if (live === null) {
      throw new Error("The Netflix transport bridge is unavailable in this runtime.");
    }
    const result = await live.fetchUpstream(url);
    if (!result.ok || typeof result.text !== "string") {
      throw new Error(result.reason ?? "The Netflix upstream transport refused the fetch.");
    }
    const text = result.text;
    return { ok: true, text: async () => text };
  };
}
