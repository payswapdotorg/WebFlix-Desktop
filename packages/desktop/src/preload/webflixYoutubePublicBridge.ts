/**
 * WFX-ANON-VIEW-1 — the narrowly scoped preload bridge for the key-free
 * public web transport (the anonymous YouTube engine's egress).
 *
 * Boundary rules (all binding, mirroring webflixNetflixBridge.ts and the
 * main module webflixYoutubePublicIpc.ts):
 *   - EXACTLY PERMISSIONED surface: one method over one namespaced channel.
 *     No generic invoke passthrough.
 *   - Flavor-gated: exposed ONLY in the baked webflix flavor.
 *   - The channel string MUST equal the main module's exported constant.
 *   - Zero credentials ride this bridge — it is the ANONYMOUS path.
 *
 * Registration is idempotent-safe: self-registers at import evaluation
 * (the preload bundle imports this module exactly once, from index.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

export const WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL = "webflix:youtube-public:fetch";

export interface WebFlixYoutubePublicFetchRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  /** The JSON request body (POSTs only — InnerTube request payloads). */
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

type ElectronLike = {
  contextBridge: { exposeInMainWorld: (apiKey: string, api: unknown) => void };
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
};

function registerWebFlixYoutubePublicPreloadBridge(electron: ElectronLike): void {
  if (ZCODE_PRODUCT_FLAVOR !== "webflix") {
    return;
  }
  const bridge: WebFlixYoutubePublicBridge = {
    async fetchUpstream(request) {
      return (await electron.ipcRenderer.invoke(
        WEBFLIX_YOUTUBE_PUBLIC_FETCH_CHANNEL,
        request,
      )) as WebFlixYoutubePublicFetchResult;
    },
  };
  electron.contextBridge.exposeInMainWorld("webflixYoutubePublic", bridge);
}

registerWebFlixYoutubePublicPreloadBridge({ contextBridge, ipcRenderer });
