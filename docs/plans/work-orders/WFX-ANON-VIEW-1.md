# WFX-ANON-VIEW-1 — videos viewable with zero sign-in (the web app's anonymous path, ported)

- **Status**: DONE (2026-10-24)
- **Base**: 182a777 (post WFX-NETFLIX-P45-LOOK-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator: "you shouldn't need to sign in before you can start viewing
videos, I want the same exact UX as the web app."

The audit found the wall's root cause: every YouTube surface in the desktop
rode the official Data API v3, which requires the operator's
`WEBFLIX_YOUTUBE_API_KEY` — without it, home/trending/search/shorts/channel
all answered the frozen `requires-auth` phase, which the shell renders as
"Sign-in required / Connect account". The web app never gates anonymous
browsing on that key at all.

## What the web app actually does (audited, repo payswapdotorg/webflix-2.0 @ 663a38c)

Its anonymous path never touches the Data API v3 (that exists only for
per-user OAuth actions). Anonymous browsing rides:

- **InnerTube** — `POST https://www.youtube.com/youtubei/v1/{search,browse,next}`
  with YouTube's public, hard-coded WEB client key + browser-shaped headers;
- **SSR** — `GET https://www.youtube.com/feed/trending[/{music,gaming,movies}]`
  (the `var ytInitialData` regex extraction) and the channel pages
  (`/@handle`, `/channel/<id>`, `/videos` tabs);
- **Playback** — the official IFrame embed (already the desktop's own law);
- **Thumbnails** — hotlinked `i.ytimg.com` (already the desktop's own law).

Its documented public-mode reality (probed live from this sandbox, verified
again 2026-10-24): the SSR trending page serves the What-to-Watch nudge
(no rows) from datacenter egress, so its trending ladder falls back to
search-compose — `search {term, sort=views, uploadDate=week, type=video}` —
which still serves real rows. Search works from datacenter egress (HTTP 200,
real videoRenderer + channelRenderer payloads — re-verified live).

## The port (what this order built)

**Connectors — the key-free public web engine** (`packages/connectors/src/youtube/`):

- `publicTransport.ts` — the public upstream constants (the web app's own
  values byte-for-byte: the public InnerTube key, the WEB client context,
  the browser UA), the injected `PublicHttpFetch` seam, the request
  builders (InnerTube URL/headers/body incl. the gl region override), the
  `ytInitialData` extractor, and the search `params` protobuf writer
  (renderer-safe: btoa, no node builtins — this module bundles into the
  Electron renderer). Encodings pinned byte-for-byte against the web app's
  recorded menu values (`EgIQAQ==` type=video, `EgIQCQ==` shorts,
  `EgIIAg==` today).
- `publicText.ts` — the total parsers ported verbatim (runsText,
  parseDurationSec, the count family, relativeAgeToDate): never throw,
  never invent.
- `publicMapping.ts` — the renderer→row mappers ported (videoRenderer,
  gridVideoRenderer, lockupViewModel, richItemRenderer dispatch, the
  generic walker with dedupe, the continuation-token walker that handles
  BOTH first-page and append-page shapes), building the canonical
  CatalogItem exactly per the catalogMapping discipline (videoId in
  metadata.externalIds.youtube, the youtube-nocookie embed asset, the
  hotlinked hqdefault thumbnail asset, public-web provenance evidence).
  shortsLockupViewModel is deliberately NOT walked (no duration on those
  rows; the app layer's shorts classification is duration/marker-driven —
  the shorts surface rides the search feed instead).
- `publicChannelMapping.ts` — the channel mappers (channelRenderer search
  results with the verified subscriberCountText/videoCountText quirk; the
  pageHeaderViewModel channel-page header with the c4TabbedHeaderRenderer
  fallback).
- `publicSource.ts` — `YouTubePublicSourceAdapter`, structurally satisfying
  the app-owned `YouTubeCatalogSource` port (compile-time assignment pinned
  in the battery, exactly like the keyed sibling): searchVideos (with
  continuation paging), searchChannels (type=channel params), the trending
  ladder (SSR grid → the walled-nudge search-compose fallback → the typed
  unavailable honest state), channelById/channelByHandle (SSR pages, 404 →
  `{channel: null}` as the provider's own answer), channelUploads (the
  /videos grid), shortsFeed (the seed query "viral shorts" — the web app's
  SHORTS_SEED_QUERY), the quota-free budget ledger with its honest note,
  and a 60s soft-TTL cache for the SSR surfaces.
- `publicComposition.ts` — `createPublicYouTubeComposition({fetchImpl})`:
  the only sanctioned way the anonymous engine comes to life; a missing
  transport answers the typed `unavailable` outcome, never a throw.

**Application layer** (`packages/webflix-application/src/media/`):

- `youtube-source-port.ts` — the handle law updated (the WFX-ANON-VIEW-1
  addendum): the handle is the ENGINE, whichever root built it; the port
  gains the optional `shortsFeed` method (engines without one keep the
  trending-classification compose) and the budget snapshot gains the
  optional engine `note` (the public ledger's no-quota statement).
- `shorts-producer.ts` — uses a dedicated shorts feed when the engine
  provides one; the compose note updated to name both paths.
- `home-feed-producer.ts` — the compose notes updated to name both engines.
- `search-page-producer.ts` — the budget note branch for engine notes.

**Desktop** (`packages/desktop/`):

- `src/main/webflixYoutubePublicIpc.ts` — the ONE namespaced, flavor-gated
  channel `webflix:youtube-public:fetch` (the Netflix transport law,
  mirrored): URL+method allowlist pinned by battery (the three InnerTube
  POST endpoints with a required JSON body; the SSR GET family — the four
  trending paths, /@handle[/videos], /channel/UC…[/videos] with only
  gl/hl query params), Chrome UA + 12s timeout + one retry, ZERO
  credentials on the wire (no Cookie, no Authorization — pinned by test).
  Registered in `src/main/index.ts` beside the Netflix IPC.
- `src/preload/webflixYoutubePublicBridge.ts` — the one-method preload
  mirror (`window.webflixYoutubePublic`), imported from preload/index.ts.
- `src/renderer/src/webflix/youtubePublicUpstreamBridge.ts` — the
  fail-closed renderer client + the bridge-backed transport adapter.
- `src/renderer/src/webflix/mediaHostSupport.ts` — `createDefaultMediaProducers`
  now composes: key present → the keyed Data-API engine (precedence kept,
  behavior unchanged); NO key → the key-free public web engine through the
  transport bridge; NEITHER (no key + no bridge — the non-desktop runtime)
  → the honest fail-closed requires-auth handle.

## What did NOT change

- The keyed Data-API composition root and its §9.5 law — verbatim
  (youtube-media-slice.test.ts still pins its requires-auth-on-no-key
  outcome; that root is simply no longer the default).
- The frozen contracts (0.15.0) — zero schema changes; the honest-phase
  vocabulary, the CatalogItem discipline, the embed-only playback law all
  ride unchanged (the public rows ARE canonical CatalogItems; playback is
  the same youtube-nocookie IFrame embed).
- Subscriptions stays account-gated (the web app's own gated personal
  surface — the honest parity).
- Every zcode feature, data-testid, the Netflix lane, the frozen OS-level
  identity.

## Gates

- Connectors public battery: 29/29 (youtube-public-source.test.ts — over
  REAL trimmed captures: the live InnerTube search response, the walled
  nudge page, a logged-out trending grid, the @MrBeast channel page).
- Main IPC battery: 10/10 (webflixYoutubePublicIpc.test.ts — channel
  agreement, flavor gate, the allowlist, the retry budget, the
  zero-credentials wire pin).
- Renderer composition battery: 4/4 (youtubePublicComposition.test.tsx —
  the no-key anonymous journey answers real rows; the fail-closed
  neither-engine state; the keyed precedence pin; the home-feed ladder).
- Full unit battery: 1946/1946 (88 files; +39 over the 1907 base).
- Shell battery: 303/303. Renderer battery: 200/200 (+4).
- `pnpm typecheck` (root tsc -b): exit 0.
- `pnpm --filter connectors typecheck`: one PRE-EXISTING error
  (tests/netflix.test.ts(258,32) — verified present at base 182a777 with
  this change stashed; environment-level drift, not this lane's).
- oxlint: 0 warnings / 0 errors on every touched file (the 5 warnings in
  main/index.ts are pre-existing unused imports at base).

## Honest residuals (recorded, not hidden)

- The watch screen's related-videos rail / comments (the web app's
  `/youtubei/v1/next` compose) is a follow-up lane — the `next` endpoint is
  already allowlisted in the transport IPC for it.
- Search filters (sort/date/duration chips) ride the ported params writer
  but the desktop search UI offers none (parity: the web app's filter row
  is a follow-up if the operator wants it).
- The public engine's cache is 60s soft-TTL in-memory (the web app's
  Upstash-backed last-good ladder is heavier than the desktop needs).
- Suggest (autocomplete) is not ported (the desktop search box has no
  autocomplete surface to feed).
