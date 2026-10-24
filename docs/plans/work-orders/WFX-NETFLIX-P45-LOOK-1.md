# WFX-NETFLIX-P45-LOOK-1 — the web app's P45 netflix-grade hub, ported to the desktop

- **Status**: DONE (2026-10-24)
- **Base**: 4d6be95 (post WFX-NETFLIX-SOURCE-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator's conversion ruling ("all you need to do is convert to a desktop
app but still keep the features of zcode") is measured against the DEPLOYED
web app (webflix-2-0-one.vercel.app). Since WFX-NETFLIX-SOURCE-1 ported the
hub, the web app itself moved (its P43–P45): the Netflix hub became
"Netflix's own landing" — the rotating billboard replacing the header box,
the Top-10 silhouette rows, the hover-expand cards, the Netflix-style sub-nav,
the session-visible My List, and the watch/live lanes. The desktop's Netflix
surfaces were P42-era. This lane closes the visible gap: the hub now wears
the web app's CURRENT (P45) netflix-grade design, while every frozen law
(honest phases, deep-link-only netflix.com, the closed agent lane, contracts
0.15.0) stays intact.

## What shipped

The web app's P45 hub surface (payswapdotorg/webflix-2.0 @ 663a38c:
`src/app/netflix/view.tsx` + `src/components/netflix/{netflix-hero,
netflix-card,netflix-rail,my-list-button}.tsx`), ported into the desktop
shell's inline-style idiom:

1. **The rotating billboard (`netflixHero.tsx`, NEW — extracted for the
   max-lines law)** — Netflix's own landing shape: 5 stacked backdrops with
   the 1000ms crossfade, rotating every 9s (paused on hover/focus, honoring
   prefers-reduced-motion — the same guard), the N FILM/N SERIES kicker, logo
   art or the black title treatment, the TOP badge line ("#N in Movies/TV
   Shows Today", year, maturity chip, weeks-in-Top-10), the 3-line synopsis,
   the WHITE Play button + the translucent More Info + the My List button +
   the netflix.com hand-off circle, and the vertical progress dots. The
   billboard derives from the rails client-side EXACTLY like the web app
   (weekly rails flatMapped, sorted by weeklyRank, top 5) — no contract
   change: 0.15.0 stays.
2. **The P45 card family (`netflixCard.tsx` rewritten + `netflixRail.tsx`
   extracted)** — ranked: the PORTRAIT silhouette (the backdrop center-cropped
   2:3, the giant outlined numeral at 110px/3px stroke #575760 → #e50914 on
   hover, -16px overlap); default: the 16:9 tile with the hover-expand
   geometry (scale 1.08, ring 1px→2px white/10→white/70, 200ms) and the
   SIBLING-overlay info sheet (the white Play circle + the My List + circle +
   the green "Top 10" meta line + 2-line synopsis — no nested interactive
   elements; the card body's click guard ignores sheet-button clicks). The
   rail: the red TOP 10 tag on weekly headers, the hover-revealed chevron
   paging (85%-viewport smooth step, canPrev/canNext at the 8px thresholds),
   and the hidden scrollbar.
3. **The hub (`NetflixScreen.tsx` rewritten)** — the billboard IS the top of
   the page (the old header box is gone — the sr-only h1 carries the
   identity, exactly like the web app); the STICKY sub-nav (All/Movies/TV
   Shows kind tabs — client-side rail filtering like the web app — beside the
   Global/US country chips, now the soft P45 pill style); the session-scoped
   My List rail ("saved in WebFlix · this session" — the honest scope note);
   the kind-filtered rails; the full-bleed #0a0a0c canvas.
4. **The session-scoped My List (`netflixHostSupport.ts` + the wiring)** —
   the web app's per-viewer Prisma list adapted to the desktop's honesty: no
   Netflix viewer identity exists here, so the list is host-level session
   state (the retention-store precedent — it survives hub↔title route
   changes, resets with the session, and SAYS so on the surface). The toggle
   rides the full prop chain (boot → WebFlixHostView → AppShell →
   ScreenRouter): the billboard button, every card's + circle, and the title
   screen's hero button.
5. **The title detail (`NetflixTitleScreen.tsx`)** — gains the My List button
   (the web app's hero variant) beside Play; the related-titles cards gain
   the hover sheets (Play + My List circles).
6. **The palette (`netflixColors.ts`)** — the P45 deltas: rankStroke
   #5a5a66→#575760 (3px), the Top-10 meta green #46d369, the mid surface
   #141418. The frozen shell theme stays untouched (the local-palette law).

## What stayed (the frozen laws, re-verified)

- Contracts 0.15.0 UNCHANGED — the billboard computes from the rails
  client-side exactly like the web app; kind derives from the rails' own
  titles; My List is host state, not a view field.
- Playback keeps the DRM hand-off dialog (the desktop's honest path — the
  web app's cloud-desktop watch lane needs the E2B broker + a Netflix
  session, recorded as the follow-up below). Every Play surface (billboard,
  card sheet, title screen) opens the SAME dialog with the exact destination
  URL; the external open stays host-owned through the main-process IPC.
- The agent lane stays navigation-only (no visibleItemIds, no playCatalogItem
  for netflix) — untouched by this lane.
- Honest phases: the unavailable/not-provided panels and the provenance
  source note are pinned unchanged; My List states its session scope on the
  surface.
- Netflix palette stays local to netflixColors.ts; theme.ts and its pins
  untouched.

## Test pins (re-frozen + additive)

`netflix-screens.test.tsx` 10 → 15 tests (shell battery 298 → 303): the hub
pins re-frozen to the P45 structure exactly like WFX-WEB-LOOK-1 re-froze the
shell pins under the operator's look ruling (the old header-box pins — brand
chip, "Top 1" badge format — superseded; the sr-only h1, the N FILM kicker,
"#1 in Movies Today", the TOP 10 tag, the scoped position numerals now
pinned). New pins: the kind tabs filter the rails AND the billboard
(client-side, like the web app); the billboard More Info reports the title
id; a card's Play circle opens the hand-off for THAT title; the My List
roundtrip (the + circle reports, the rail renders with the honest note, the
checked state); the title screen's My List button (pressed state + toggle
report). Every pre-existing pin that still describes the truth is kept
verbatim (country chips, card clicks, hand-off dialog contract, title
detail pins).

## Gates

- Shell battery: 303/303 (18 files; +5 net pins).
- Renderer battery: 196/196 (17 files).
- Full unit battery: 1907/1907 (86 files; one transient parallel-load flake
  observed in an intermediate run — three clean runs before/after).
- `pnpm run typecheck`: exit 0.
- oxlint: 0e/0w on all 12 touched files. (Honest note: AppShell.tsx now
  measures 543 lines — its max-lines violation is PRE-EXISTING at base
  4d6be95, 534 lines; this lane's +9 prop wires are additive and the file's
  restructure is out of scope. netflixCard.tsx was split at 492 → 272 +
  netflixRail.tsx 155 to respect the law.)

## LIVE evidence (the running Electron app, real Tudum data)

`scripts/e2e/evidence/wfx/netflix-p45-look/`: the hub (the Animals billboard:
N FILM kicker, TOP #1 in Movies Today, white Play + More Info + My List,
vertical dots; the sticky sub-nav with the active All tab; the TOP 10-tagged
rails), the silhouette rail (giant outlined numerals 1–5 over the portrait
art, week of 2026-10-18), the My List rail after one + click (the honest
session note), the TV Shows tab (N SERIES, #2 in TV Shows Today — the live
data's top series rank, only the TV rail), the title detail (TOP 2, 3 weeks
in the Top 10, 13.1M hours viewed, the + My List button, the country pills,
More like this), and the play hand-off dialog (the exact destination URL
https://www.netflix.com/watch/82023496). All VLM-verified from the live app.

## Honest residuals (recorded, not hidden)

- **The watch lane + Netflix Live band are NOT ported** — the web app's
  /netflix/watch/<id> streams a cloud desktop (E2B + noVNC + a socket.io
  audio tap) behind a broker with a Netflix session (its own auth wall is
  measured-blocked). The desktop's Play stays the honest deep-link hand-off
  (the same fallback the web app itself shows when its broker is
  unreachable). The Live band is omitted rather than rendered dead. A future
  lane could port the broker as a desktop-bundled service.
- **My List is session-scoped, not durable** — a device-local list under the
  data root (the agent-workspace allow-listed-writer precedent) is the
  recorded follow-up; the surface states the scope honestly.
- **The On-Netflix search shelf** remains the WFX-NETFLIX-SOURCE-1 residual.
- Icon glyphs remain the shell's text-glyph family (▶ ‹ › ⓘ ✓ +); the
  lucide-precision pass is the standing WFX-WEB-LOOK-1 cosmetic follow-up.
