# WFX-NETFLIX-SOURCE-1 — the web app's Netflix hub, ported to the desktop

- **Status**: DONE (2026-10-24)
- **Base**: c3eec14 (post WFX-ZCODE-OPEN-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator's conversion ruling ("all you need to do is convert to a desktop
app but still keep the features of zcode") left one recorded residual from
WFX-WEB-LOOK-1: "the web app's Netflix hub (its second source, /netflix) has
no desktop route yet … it needs the Tudum pool/parser moved into the
desktop's producer layer." This lane is that port.

## What shipped

The web app's Netflix second source (payswapdotorg/webflix-2.0,
`src/lib/netflix/*` + `src/app/netflix/*` + `src/components/netflix/*`),
ported end-to-end into the desktop product:

1. **Contracts (0.14.0 → 0.15.0, additive)** — `netflix` joins the frozen
   MediaRoute set (params.itemId selects the title detail; params.region the
   country view); the Netflix view family (NetflixTitleCard — the second
   source's OWN card atom, deliberately NOT a VideoCardView/CatalogItem:
   playback hands off to Netflix's official player, so the agent can never
   playCatalogItem these; NetflixRailView; NetflixHomeView with the
   source-label law's provenance note; NetflixTitleView with title:null on
   every non-ready phase — never a placeholder); the NetflixPort interface.
2. **Connectors (`packages/connectors/src/netflix/`)** — the Tudum reader
   ported: the bounded 8-pool matrix, the escape-aware SSR-cache parser
   (extractGraphqlCache / mapTop10Entity / parseTop10Page with the geo-copy
   field-wise dedupe), the category gate, the injectable upstream seam, the
   deeplink law (the only netflix.com URL builders), and the hub/title
   composition. DESKTOP DIFFERENCE: the web app's Upstash cache becomes an
   in-memory pool cache with the SAME soft/hard TTL + last-good +
   poisoning-guard semantics; the Prisma mirror + per-viewer My List +
   catalog-search index are documented out of scope (no per-user viewer for
   this source on the desktop).
3. **Main-process transport (`webflixNetflixIpc.ts` + preload bridge)** —
   netflix.com serves no CORS headers, so the renderer cannot reach the
   Tudum pages: the MAIN process is the only sanctioned egress. Two
   namespaced, flavor-gated channels: `webflix:netflix-upstream:fetch`
   (URL-allowlisted to exactly the 8 pool pages, pinned-equal against the
   connectors POOLS matrix by test; Chrome UA + 12s timeout + one retry) and
   `webflix:netflix-upstream:open-url` (the play hand-off's system-browser
   open, /watch/<id> and /title/<id> deep links only).
4. **The producer adapter (`netflixProducer.ts` + `netflixHostSupport.ts`)** —
   the NetflixPort implementation over the connector catalog, composed
   renderer-side exactly like createLiveYouTubeComposition is (the
   composition-root law; webflix-application never depends on connectors).
   The honest-phase law: a dead upstream answers `unavailable` with its
   reason — never fabricated rows; an unknown title answers the typed
   "not in the tracked Netflix catalog" view (three-way connector result:
   ready / not-found / unavailable — never conflated).
5. **The shell surfaces** — `NetflixScreen` (the hub: red N brand chip +
   "Netflix on WebFlix", the inverted-active country chips, the hero with
   Top-N badge + Play, the rails with the big outlined rank numerals riding
   the cards, the provenance footnote), `NetflixTitleScreen` (the title
   detail: hero + logo art + meta bits incl. "X.XM hours viewed this week",
   where-it-ranks pills with the red rank-1 pill, "More like this"
   neighbors, the back link), `NetflixPlayHandoff` (the ADR 0002 §1 dialog
   made UI: the NETFLIX badge, the honest DRM copy, the primary
   "Play '<title>' on Netflix ↗" reporting the EXTERNAL open to the host,
   the title-page secondary, the exact destination URL line). The Netflix
   sub-brand's own palette (#0a0a0c / #e50914) rides as local constants in
   `netflixColors.ts` — the frozen shell theme stays untouched. The nav row
   slots into the primary WebFlix group (the web app's own MAIN_NAV places
   Netflix 4th); the hand-drawn icon family gains a screen+play glyph.
6. **The agent lane stays honest** — the webflix_ui MCP tool's route enum
   gains `netflix` (navigation only); the Netflix surfaces contribute NO
   visibleItemIds (their titles are not in-app playable catalog items, so
   the agent cannot playCatalogItem them — pinned by the actionTool route
   round-trip); openRoute("netflix", …) rides the same controlled-route path.

## Gates

- Contracts freeze battery: 18/18 (the netflix route + view round-trips +
  the closed-set rejections; every 0.14.0 pin untouched).
- Connectors battery: 20/20 new (the parser against the web app's own
  proven live Tudum fixture — re-verified live from this sandbox's egress
  2026-10-24; the resilient cache: soft-TTL single-fetch, last-good on
  dead upstream, never-poisoned; the three-way title page).
- Main IPC battery: 10/10 new (channel agreement main↔preload, flavor gate,
  the 8-URL allowlist pinned-equal to POOLS, the bounded retry, the deep-link
  open laws).
- Shell battery: 298/298 (288 existing + 10 new netflix-screens pins).
- Renderer battery: 196/196 (187 existing + 9 new producer pins).
- Full main battery: 1907/1907 (84 files). Typecheck 0. Oxlint 0e/0w on the
  touched files (boot.tsx + NetflixScreen.tsx split for the 400-line law).

## LIVE evidence (the running Electron app, this sandbox)

- The hub rendered with REAL live Tudum data (week of 2026-10-18): the red N
  chip + "Netflix on WebFlix" header, Global/US country chips, the "Animals"
  hero (TOP 1 badge, meta, synopsis, red Play), the "Top 10 Movies This Week
  · Global" rail with the big outlined rank numerals 1-4 over real boxart
  (netflix-hub-live.png).
- The card click opened the title detail: hero backdrop + logo art, TOP 2
  badge, "2026 · Film · TV-MA · 3 weeks in the Top 10 · 13.1M hours viewed
  this week", the where-it-ranks country pills (BE #2 … US #2 …), the
  "More like this" same-pool rail, the "← Netflix hub" back link
  (netflix-title-detail-live.png).
- The Play opened the hand-off dialog verbatim to the web app's: NETFLIX
  badge + "Ready to play on Netflix", the DRM hand-off copy, the primary
  "Play 'Doing Life' on Netflix ↗", the title-page secondary, "Stay in
  WebFlix", and the exact destination URL line; the primary click ran the
  external-open IPC path with no crash (netflix-play-handoff-live.png).
- The US country view re-ranked the rail ("Top 10 Movies This Week · US",
  the inverted-active chip) over the same live fetch
  (netflix-us-country-view-live.png).

## Boundary ruling (what this lane never touched)

- Every zcode feature: the agent panel, the runtime admission, the
  UI-action bridge (beyond the additive route enum entry), the MCP
  rendezvous, Ctrl+J — all pinned green in the same batteries.
- The frozen OS-level identity, the YouTube provider slice, every existing
  data-testid/aria/honest-copy contract.
- No account mutations ride the Netflix surface (the freeze §9 consent law:
  the external open is a navigation, not an account operation).

## Honest residual

- The web app's My List (its per-viewer Netflix list) is not ported: the web
  app itself requires a signed-in viewer and the desktop has no Netflix
  viewer identity — a device-local list is a possible follow-up, recorded
  here rather than half-built.
- The web app's "On Netflix" search shelf (its search-page integration) is a
  possible follow-up additive lane (searchNetflixCatalog over the union
  catalog); not started here.
- The nav icon is the shell's hand-drawn family glyph (screen + play),
  consistent with the WFX-WEB-LOOK-1 cosmetic-follow-up note.
