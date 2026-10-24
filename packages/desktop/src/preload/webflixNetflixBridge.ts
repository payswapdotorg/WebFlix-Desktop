/**
 * WFX-NETFLIX-SOURCE-1 — the narrowly scoped preload bridge for the Netflix
 * second source's transport (the bounded Tudum pool fetch + the play
 * hand-off's system-browser open).
 *
 * Boundary rules (all binding, mirroring webflixAgentBridge.ts and the main
 * module webflixNetflixIpc.ts):
 *   - EXACTLY PERMISSIONED surface: two methods over two namespaced
 *     channels. No generic invoke passthrough.
 *   - Flavor-gated: exposed ONLY in the baked webflix flavor.
 *   - The channel strings MUST equal the main module's exported constants.
 *
 * Registration is idempotent-safe: self-registers at import evaluation
 * (the preload bundle imports this module exactly once, from index.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

export const WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL = "webflix:netflix-upstream:fetch";
export const WEBFLIX_NETFLIX_OPEN_URL_CHANNEL = "webflix:netflix-upstream:open-url";

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

type ElectronLike = {
  contextBridge: { exposeInMainWorld: (apiKey: string, api: unknown) => void };
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
};

function registerWebFlixNetflixPreloadBridge(electron: ElectronLike): void {
  if (ZCODE_PRODUCT_FLAVOR !== "webflix") {
    return;
  }
  const bridge: WebFlixNetflixBridge = {
    async fetchUpstream(url) {
      return (await electron.ipcRenderer.invoke(WEBFLIX_NETFLIX_UPSTREAM_FETCH_CHANNEL, {
        url,
      })) as WebFlixNetflixFetchResult;
    },
    async openUrl(url) {
      return (await electron.ipcRenderer.invoke(WEBFLIX_NETFLIX_OPEN_URL_CHANNEL, {
        url,
      })) as WebFlixNetflixOpenUrlResult;
    },
  };
  electron.contextBridge.exposeInMainWorld("webflixNetflix", bridge);
}

registerWebFlixNetflixPreloadBridge({ contextBridge, ipcRenderer });
