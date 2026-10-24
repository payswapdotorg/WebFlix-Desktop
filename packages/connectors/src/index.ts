/**
 * connectors — public surface.
 *
 * ADR-0003: official surfaces only. This package is fixture-tested only; live
 * smoke tests are pending-operator-credential per the connectors work order.
 * Contract types come from the canonical webflix-contracts (the lane-local
 * mirror was removed at integration; MIRROR-RECON reconciled the manifest,
 * registry, OAuth session and playback builder to the frozen §2 shapes).
 */
export * from "webflix-contracts";
export * from "./registry";
export * from "./youtube/manifest";
export * from "./youtube/dataApi";
export * from "./youtube/oauth";
export * from "./youtube/playback";
export * from "./youtube/catalogMapping";
export * from "./youtube/service";
export * from "./youtube/substitutes";
// WFX-PROVIDER-SLICE-1 (Worker 2): the media-producer vertical slice over the
// official Data API engine — the engine adapter (structurally compatible with
// webflix-application's YouTubeCatalogSource port; compatibility pinned by the
// integration suite's compile-time assignments), the LIVE composition root
// (freeze §9.5 key law: injected key source, real fetch, typed requires-auth
// outcome without a key), and the real-transport federated-search source.
export * from "./youtube/mediaSource";
export * from "./youtube/liveComposition";
export * from "./youtube/searchSourceAdapter";
// WFX-ANON-VIEW-1: the KEY-FREE PUBLIC WEB engine — the web app's own
// anonymous path (InnerTube + SSR with the public WEB client key, zero
// credentials) as the desktop's default YouTube source; the keyed Data-API
// composition above stays the optional operator overlay. Sanctioned by the
// operator's ruling + the ADR-0003 addendum + the freeze §9.5 addendum.
export * from "./youtube/publicTransport";
export * from "./youtube/publicText";
export * from "./youtube/publicMapping";
export * from "./youtube/publicChannelMapping";
export * from "./youtube/publicSource";
export * from "./youtube/publicComposition";
// TikTok — second platform on the same frozen contracts (TIKTOK-CONNECT).
// NOTE: tiktok/oauth.ts deliberately does NOT re-export the provider-neutral
// OAuth substrate it imports from ./youtube/oauth (PKCE pair, state guard,
// transitions, store types) — the package index already exports those once
// via the YouTube module; a second `export *` of the same names would make
// them ambiguous.
export * from "./tiktok/manifest";
export * from "./tiktok/displayApi";
export * from "./tiktok/oembed";
export * from "./tiktok/catalogMapping";
export * from "./tiktok/playback";
export * from "./tiktok/oauth";
export * from "./tiktok/service";
export * from "./tiktok/substitutes";
// Twitch — third platform on the same frozen contracts (TWITCH-CONNECT).
// NOTE: twitch/oauth.ts deliberately does NOT re-export the provider-neutral
// OAuth substrate it imports from ./youtube/oauth (same discipline as
// tiktok/oauth — the package index exports those names once via the YouTube
// module; a second `export *` would make them ambiguous).
export * from "./twitch/manifest";
export * from "./twitch/helixApi";
export * from "./twitch/oauth";
export * from "./twitch/catalogMapping";
export * from "./twitch/playback";
export * from "./twitch/service";
export * from "./twitch/substitutes";
// Instagram — fourth platform, honesty-forward by design (INSTAGRAM-CONNECT:
// professional-account Graph reads + Facebook Login + the honest-unsupported
// totality for every discovery surface the platform does not offer
// officially). NOTE: instagram/oauth.ts deliberately does NOT re-export the
// provider-neutral OAuth substrate it imports from ./youtube/oauth (same
// discipline as tiktok/twitch — the package index exports those names once
// via the YouTube module; a second `export *` would make them ambiguous).
export * from "./instagram/manifest";
export * from "./instagram/graphApi";
export * from "./instagram/oembed";
export * from "./instagram/oauth";
export * from "./instagram/catalogMapping";
export * from "./instagram/playback";
export * from "./instagram/service";
export * from "./instagram/substitutes";
// Reddit — fifth platform: the REST read surface + the official embed
// (REDDIT-CONNECT). Same collision-safety discipline as tiktok/twitch/
// instagram: the provider-neutral OAuth substrate names are exported once via
// the youtube module; the reddit module exports only Reddit-suffixed names.
export * from "./reddit/manifest";
export * from "./reddit/restApi";
export * from "./reddit/oauth";
export * from "./reddit/catalogMapping";
export * from "./reddit/playback";
export * from "./reddit/service";
export * from "./reddit/substitutes";
// WFX-NETFLIX-SOURCE-1 — the second source's Tudum reader: the bounded 8-pool
// matrix + the SSR-cache parser + the injectable upstream seam + the deeplink
// law + the hub/title composition (ported from the web app's
// src/lib/netflix/* — the Prisma mirror + My List are documented out of
// desktop scope). Names are Netflix-prefixed throughout; no collisions with
// the platform families above.
export * from "./netflix/types";
export * from "./netflix/deeplink";
export * from "./netflix/upstream";
export * from "./netflix/top10";
export * from "./netflix/catalog";
