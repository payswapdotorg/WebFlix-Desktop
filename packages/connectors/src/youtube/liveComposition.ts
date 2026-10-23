/**
 * The LIVE YouTube Data API composition root (WFX-PROVIDER-SLICE-1 — freeze
 * §9.5 DATA API KEY LAW).
 *
 * This is the ONLY sanctioned way a real-network YouTubeDataApiClient comes
 * to life:
 *
 *   - the official YouTube Data API v3 key is READ FROM AN INJECTED
 *     `YouTubeApiKeySource` port (a CredentialsSource-style seam). The KEY
 *     VALUE arrives app-side/desktop-side — from user-level configuration
 *     (env `WEBFLIX_YOUTUBE_API_KEY` and/or a Settings surface persisting
 *     under the WebFlix data root, per freeze §9.5). This package NEVER
 *     reads env itself, never persists keys, never logs them (the ledger
 *     redacts `key=REDACTED` — see dataApi.ts), and the composition outcome
 *     carries NO key material. The implementing CredentialsSource lives
 *     app-side/desktop-side, NOT in connectors.
 *   - NO KEY ⇒ a typed `requires-auth` OUTCOME OBJECT (never a thrown
 *     crash): callers map `{ kind: "requires-auth" }` onto the frozen
 *     honest phases (MediaViewPhase "requires-auth") — every Data-API-backed
 *     surface answers requires-auth honestly, and fixtures label themselves.
 *     A key source that itself fails (I/O error, vault unavailable) is
 *     treated as no-key — the honest state, never a crash.
 *   - the fetch implementation defaults to the GLOBAL fetch (the REAL
 *     network). Fixture builds inject their own fetch; omitting fetchImpl
 *     on a raw YouTubeDataApiClient remains the fixture-only refusal
 *     (LiveNetworkDisabledError) — this factory is the live path.
 *   - OAuth: an optional AccessTokenProvider (the ./oauth session) rides
 *     along for authorized-account calls; account-scoped composition is a
 *     later order's concern.
 */
import type { AccessTokenProvider, FetchLike } from "./dataApi";
import { YouTubeDataApiClient } from "./dataApi";
import { YouTubeCatalogSourceAdapter } from "./mediaSource";

/**
 * The injected credential seam (freeze §9.5): returns the official YouTube
 * Data API v3 key VALUE, or null when none is configured. Implementations
 * live app-side/desktop-side (user-level config / OS vault); connectors
 * stays credential-free except this injected value. SecretFreeString
 * discipline: the value never appears in logs, outcomes, or renderer-visible
 * strings.
 */
export interface YouTubeApiKeySource {
  getApiKey(): Promise<string | null>;
}

/** The composition outcome: the live engine, or the honest requires-auth state. */
export type LiveYouTubeCompositionOutcome =
  | {
      readonly kind: "live";
      /** The real-network client (quota-ledgered, official surfaces only). */
      readonly client: YouTubeDataApiClient;
      /** The engine adapter feeding the media-producer use cases. */
      readonly source: YouTubeCatalogSourceAdapter;
    }
  | {
      readonly kind: "requires-auth";
      /** Why the Data API is unavailable + where the key is configured. Never key material. */
      readonly detail: string;
    };

/** Where an unconfigured key is honestly reported to point at (freeze §9.5). */
export const YOUTUBE_API_KEY_CONFIGURATION_HINT =
  "Configure the official YouTube Data API v3 key in WebFlix settings (persisted under the WebFlix data root) or via the WEBFLIX_YOUTUBE_API_KEY environment variable";

export interface CreateLiveYouTubeCompositionOptions {
  /** REQUIRED: the injected key source (the value arrives app-side). */
  readonly apiKeySource: YouTubeApiKeySource;
  /**
   * Defaults to the GLOBAL fetch (the real network). Tests inject a fixture
   * fetch; this default is exactly what makes the composition LIVE.
   */
  readonly fetchImpl?: FetchLike;
  /** Optional authorized-account token source (the ./oauth session). */
  readonly accessTokenProvider?: AccessTokenProvider;
  /** Local daily budget in official units (defaults to the official 10,000/day). */
  readonly quotaLimitToday?: number;
  /** Injectable clock for the quota ledger's day rollover. */
  readonly clock?: () => number;
}

/**
 * Builds the live Data API composition. NEVER THROWS for a missing key:
 * the answer is the typed `requires-auth` outcome object callers map onto
 * the frozen honest phases.
 */
export async function createLiveYouTubeComposition(
  options: CreateLiveYouTubeCompositionOptions,
): Promise<LiveYouTubeCompositionOutcome> {
  if (!options?.apiKeySource || typeof options.apiKeySource.getApiKey !== "function") {
    return {
      kind: "requires-auth",
      detail: `No YouTube API key source was injected into the composition root — ${YOUTUBE_API_KEY_CONFIGURATION_HINT}.`,
    };
  }

  let apiKey: string | null = null;
  try {
    apiKey = await options.apiKeySource.getApiKey();
  } catch {
    // A failing key source (vault unavailable, config unreadable) is the
    // honest no-key state — never a crash, never a fabricated key.
    apiKey = null;
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return {
      kind: "requires-auth",
      detail: `No official YouTube Data API v3 key is configured — every Data-API-backed surface answers requires-auth until one is. ${YOUTUBE_API_KEY_CONFIGURATION_HINT}.`,
    };
  }

  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  const client = new YouTubeDataApiClient({
    fetchImpl,
    apiKey,
    ...(options.accessTokenProvider !== undefined
      ? { accessTokenProvider: options.accessTokenProvider }
      : {}),
    ...(options.quotaLimitToday !== undefined ? { quotaLimitToday: options.quotaLimitToday } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
  });
  return { kind: "live", client, source: new YouTubeCatalogSourceAdapter(client) };
}
