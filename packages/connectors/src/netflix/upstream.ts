/**
 * WFX-NETFLIX-SOURCE-1 — the Netflix upstream transport, ported from the
 * web app's src/lib/netflix/upstream.ts (the source-adapter mirror of the
 * youtube upstream seam, ADR 0002 §4).
 *
 * Every netflix.com byte WebFlix ever fetches flows through this seam:
 *   - a desktop RENDERER injects the main-process IPC-backed fetch here
 *     (netflix.com serves no CORS headers, so the renderer's own fetch
 *     cannot reach it — the main process is the only sanctioned egress);
 *   - tests inject fixture-serving fakes via `setNetflixUpstream()`;
 *   - the default is the global fetch (server-side shapes).
 *
 * The response type is STRUCTURAL (ok + text) so both a real Response and
 * a bridge-shaped answer satisfy it without adaptation.
 */

/** The minimal response shape the Tudum reader consumes. */
export interface NetflixUpstreamResponse {
  readonly ok: boolean;
  text(): Promise<string>;
}

export type NetflixUpstreamFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<NetflixUpstreamResponse>;

const defaultUpstream: NetflixUpstreamFetch = (url, init) => fetch(url, init);

let injected: NetflixUpstreamFetch | null = null;

/** The active Netflix upstream fetch (injected bridge/test fake or real fetch). */
export function netflixUpstreamFetch(): NetflixUpstreamFetch {
  return injected ?? defaultUpstream;
}

/** Inject a transport (the desktop's IPC bridge, or a test fake). */
export function setNetflixUpstream(impl: NetflixUpstreamFetch | null): void {
  injected = impl;
}

/** True while a non-default upstream is injected. */
export function isNetflixInjectedUpstream(): boolean {
  return injected !== null;
}
