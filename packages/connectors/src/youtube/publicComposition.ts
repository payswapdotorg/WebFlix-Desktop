/**
 * WFX-ANON-VIEW-1 — the LIVE key-free public-web composition root.
 *
 * This is the ONLY sanctioned way the anonymous engine comes to life, and
 * the DEFAULT engine of the desktop app per the operator's ruling ("you
 * shouldn't need to sign in before you can start viewing videos — the same
 * exact UX as the web app"): the web app's own anonymous path (InnerTube +
 * SSR, public WEB client key, zero credentials) ported into the connectors
 * layer. The keyed Data-API composition (liveComposition.ts) becomes an
 * OPTIONAL overlay — when an operator key IS configured it takes precedence
 * exactly as before (official surfaces, quota ledger); with no key the
 * desktop now boots into the public engine instead of the requires-auth
 * wall. See the freeze §9.5 WFX-ANON-VIEW-1 addendum.
 *
 * Laws (mirroring liveComposition.ts):
 *   - the TRANSPORT is injected (PublicHttpFetch): the renderer binds the
 *     main-process IPC bridge (youtube.com serves no CORS — the main
 *     process is the only sanctioned egress); tests bind fixture fetches.
 *     A missing transport is a typed `unavailable` OUTCOME OBJECT, never a
 *     thrown crash — the callers map it onto the frozen honest phases.
 *   - NO SECRETS EXIST on this path: no key, no cookie, no OAuth — the
 *     composition outcome carries no credential material (there is none).
 *   - NEVER THROWS: the answer is `{ kind: "live", source }` or the typed
 *     honest `unavailable` outcome.
 */
import { YouTubePublicSourceAdapter } from "./publicSource";
import type { PublicHttpFetch } from "./publicTransport";

/** The composition outcome: the live anonymous engine, or the honest unavailable state. */
export type LivePublicYouTubeCompositionOutcome =
  | {
      readonly kind: "live";
      /** The key-free public-web engine feeding the media-producer use cases. */
      readonly source: YouTubePublicSourceAdapter;
    }
  | {
      readonly kind: "unavailable";
      /** Why the public engine could not be built (never credential material). */
      readonly detail: string;
    };

/** Where an unbuilt public engine is honestly reported to point at. */
export const YOUTUBE_PUBLIC_COMPOSITION_HINT =
  "The key-free public web engine needs a transport — the desktop wires the main-process IPC bridge (youtube.com serves no CORS)";

export interface CreatePublicYouTubeCompositionOptions {
  /** REQUIRED: the injected transport (bridge- or fixture-backed). */
  readonly fetchImpl?: PublicHttpFetch;
  /** ISO instant stamped onto mapped rows (tests inject a fixed clock). */
  readonly observedAt?: () => string;
  /** Soft-TTL for the engine's trending/shorts/channel page cache. */
  readonly cacheTtlMs?: number;
}

/**
 * Builds the key-free public-web composition. NEVER THROWS for a missing
 * transport: the answer is the typed `unavailable` outcome object callers
 * map onto the frozen honest phases.
 */
export function createPublicYouTubeComposition(
  options: CreatePublicYouTubeCompositionOptions = {},
): LivePublicYouTubeCompositionOutcome {
  if (typeof options?.fetchImpl !== "function") {
    return {
      kind: "unavailable",
      detail: `No public web transport was injected into the composition root — ${YOUTUBE_PUBLIC_COMPOSITION_HINT}.`,
    };
  }
  return {
    kind: "live",
    source: new YouTubePublicSourceAdapter(options.fetchImpl, {
      ...(options.observedAt !== undefined ? { observedAt: options.observedAt } : {}),
      ...(options.cacheTtlMs !== undefined ? { cacheTtlMs: options.cacheTtlMs } : {}),
    }),
  };
}
