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
