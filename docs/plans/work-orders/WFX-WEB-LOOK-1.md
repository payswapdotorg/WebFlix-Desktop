# WFX-WEB-LOOK-1 — the desktop shell wears the web product's visual system

- **Status**: DONE (2026-10-24)
- **Base**: b7ce347 (post WFX-OAUTH-CONNECT-1 main)
- **Owner**: TL3 (operator-directed takeover lane)

## The directive

The operator audited the live desktop app against the web product
(https://webflix-2-0-one.vercel.app/, repo payswapdotorg/webflix-2.0) and
ruled: "the desktop app looks nothing like the web app … all you need to do
is convert to a desktop app but still keep the features of zcode."

## Boundary ruling (what this lane changes — and what it must never touch)

**Superseded**: the earlier "deliberately NOT YouTube" VISUAL doctrine —
the teal accent, the navy canvas, the no-red mark rule, and every test pin
that enforced them. The desktop shell now carries the webflix-2.0 web
product's own design system, sourced from the web app's globals.css tokens.

**Unchanged (binding)**:
- ADR-0003's independent-VALUE doctrine: the permanent
  independent-value-notice footer, the honest-state vocabulary, the
  no-fabricated-data laws.
- The frozen OS-level identity (freeze §6.1): appId, AUMIDs, scheme,
  data roots, package names — visual identity only moved, never the
  coexistence surface.
- The ZCode agent lane: runtime admission, AgentPanel phases, the lazy
  agentChatSurface boundary, the UI-action bridge, the MCP rendezvous,
  Ctrl+J — every zcode feature keeps working on the new skin.
- Every data-testid / aria / honest-copy contract in the shell and the
  renderer (the e2e journeys and the batteries still pin them verbatim).

## The port (what actually changed)

1. `packages/webflix-shell/src/theme.ts` — the web product's palette
   (#0f0f0f canvas, #272727 secondary, #303030 borders, #f1f1f1/#aaaaaa
   text, #ff0000 primary, 8/10/12/16 radius ladder), its system font
   stack, sidebar 240 / rail 72 / watch column 402 geometry.
2. `shell-styles.ts` — web gutters, slim scrollbar, and the shell's
   single stylesheet grew the hover idioms (nav rows, chips, icon
   buttons, search focus ring, shorts-tile hover scale).
3. `TopChrome.tsx` — the 56px web topbar: host-injected brand mark +
   bold wordmark, the centered rounded-full search pill with the icon
   submit, right-side status pills; the Agent toggle keeps its testid,
   aria and shortcut, now as an active-red pill.
4. `Sidebar.tsx` — the web guide ladder: shared-canvas column (no
   divider), 44px rounded-lg rows with 24px icon gutters, active
   secondary fill, hairline group dividers.
5. `VideoCard.tsx` — the web card idiom: rounded-xl 16:9 tile, the
   rgba(0,0,0,0.8) duration badge, the channel avatar disc, red LIVE /
   Members badges, the 320px rail width.
6. `MediaCardGrid` / `CategoryChipRow` / `ShortsTile` — the web grid
   rhythm (gap-x-4 gap-y-9), borderless chip pills with the inverted
   active state, rounded-xl shorts tiles.
7. `brand.ts` + `build/webflix-icons/` — the mark is now the web
   product's OWN logo geometry (the red rounded rect + white play
   triangle from webflix-2.0 logo.tsx / favicon.svg), redrawn on the
   square 64 viewBox; the PNG set was re-rasterized from it
   (generate.py, 2026-10-24).
8. The host view — the product mark moved from a standalone row into
   the topbar (AppShell `brandMark` → TopChrome), keeping the
   `webflix-product-mark` testid; the about footer continues the shell's
   notice footer as a quiet second line.

## Gates

- Full battery: 1863/1863 (83 files) — exit 0.
- Renderer battery: 187/187 (16 files) — exit 0.
- Shell component battery: 288/288 (17 files) — exit 0 (after the theme
  pin was re-frozen to the web palette in shell.test.tsx).
- `pnpm typecheck` — exit 0. oxlint on all 24 touched files — 0 errors,
  0 warnings.
- LIVE verification (the sandbox audit stack): VLM-verified screenshots
  of home/shorts/subscriptions/library/history/trending/accounts/
  settings/watch/agent — the web topbar, sidebar and card idioms render
  in the real Electron app; the watch dock mounts the official
  youtube-nocookie embed; the agent panel still connects to the zcode
  runtime. Evidence at
  `packages/desktop/scripts/e2e/evidence/wfx/web-look/` and the sandbox
  audit console.

## Honest residual

- The web app's Netflix hub (its second source, /netflix) has no desktop
  route yet: the frozen MediaRoute set is unchanged in this lane. Porting
  the Netflix source adapter is a follow-up lane of its own (it needs the
  Tudum pool/parser moved into the desktop's producer layer).
- Icon glyph parity: the shell's hand-drawn stroke icons stay (they read
  as the same family at 22px); swapping to the web app's exact lucide
  glyphs is a follow-up cosmetic pass.
