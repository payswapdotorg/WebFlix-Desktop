# Phase 6 — the mobile client ruling (P6-MOBILE-RULING decision doc)

Status: DELIVERED 2026-10-12 by the D2-lane worker (docs grant; branch
p6-mobile-ruling on base 862e452). This doc is the TRUE mobile client
decision: it rules, on ledger evidence, whether/when/how a WebFlix mobile
client exists. It binds Phase-6 mobile work exactly as phase6-clients-plan
§1-§8 binds all Phase-6 rows. The deliverable is the decision + reasoning +
matrix impact + queued follow-ups — NOT an implementation.

The bar this doc enforces (phase6-clients-plan, Sequencing rulings): "The
mobile ruling happens ONLY after P6-WEB-HOST-1 is merged and its honest
limits recorded — no mobile claims before a mobile slice runs." Both
preconditions hold at base 862e452; the ruling below keeps the second half
of that sentence true.

## 1. The evidence base (what actually exists, cited)

Everything this ruling weighs is a merged, ledger-recorded artifact. No
promise, roadmap line, or desire counts as evidence.

- The web host slice exists: P6-WEB-HOST-1 @ 7aa43a3 (merged b7242ea, TL2
  ruling 19ea900) — a NEW thin Vite + React 19 host composing the frozen
  webflix-shell AppShell (all six screens: home/search/library/accounts/
  ads/evaluation) over browser-safe webflix-application use cases. Gates
  reproduced at the merge: tsc 3x0, unit 1326/1326 (57 files), shell
  components 80/80, web-client tests 12/12, build emitted (dist 370.82 kB).
- Durable persistence exists: P6-DURABLE-WEB-1 @ 8392a30 (ruling 862e452)
  — the typed IndexedDB seam behind the PERSISTENCE_MODE union
  ("session-only" default | "durable" opt-in), exactly two persisted
  records (the mode setting + the ranker selection), graceful typed
  degradation. Gates: web-client tests 41/41 (12 app + 17 adapter + 12
  component), architecture:check 0/0/0, build emitted (dist 378.61 kB,
  gzip 111.47 kB).
- What those hosts compose (the reuse surface every mobile option will be
  measured against): the REAL use cases — QualifyAdsRecords,
  ReadTransparencySourceManifests, ResolveSelectedRanker,
  SetRankerAdapterSelection — over the in-memory doubles
  (createInMemoryAdsStores, InMemoryRankerSelectionStore), plus the typed
  unavailable-surface registry (4 declarations, each with a named desktop
  path: provider-connectors, durable-local-library, real-mi-engines,
  ad-transparency-transport).
- Runtime neutrality, rg-verified at base 862e452: webflix-application
  non-test source contains no Node/DOM globals (its only `fetch` tokens
  are the injected port declaration in ports.ts and one call through that
  port in refresh-provider-metadata.ts; the node-bound adapter is named in
  a comment as living in local-library on the desktop). webflix-contracts
  is pure TS schemas. webflix-shell is React DOM components with inline
  CSSProperties — DOM-bound by construction. local-library is
  better-sqlite3 + Node fs — Node-only by law (plan §4).
- Mobile-relevant facts of the shipped host, rg-verified at base:
  index.html carries the responsive viewport meta
  (width=device-width, initial-scale=1.0); the shell contains ZERO
  @media queries and ZERO flex-wrap declarations (the nav is a nowrap
  flex row of six ~8px/14px-padded buttons); panels constrain to
  maxWidth 640/720. No mobile-viewport or device-emulated test exists
  anywhere in the ledger — both P6 web rows test in jsdom/node only.
  IndexedDB is available in mobile browsers, so the durable mode's
  opt-in and its typed degraded path apply unchanged there.

## 2. Option analysis (the four realistic strategies vs plan §1-§8)

### (a) Responsive-web-only — the merged web host on mobile browsers

- Reuse surface: 100% and zero new code. The existing composition
  (contracts + application + shell + the persistence seam + the
  unavailable-surface registry) IS the mobile surface; a mobile browser is
  still a browser with DOM + IndexedDB.
- Honest state TODAY: it LOADS at mobile widths (viewport meta present)
  but nothing more is claimed: the shell has no responsive layout (rg:
  no @media, nowrap nav — at ~375px the nav row overflows or clips), and
  no mobile-browser run has ever been recorded. The honest sentence is
  "an unverified desktop-layout web app that renders in mobile browsers",
  not "mobile-ready".
- Honesty seams: unchanged from the web host — session-only default with
  durable opt-in; the four unavailable-surface declarations remain
  literally true on the mobile runtime (still no connectors, no Node
  engines, no local library, no ad transport).
- Cost/risk: LOWEST — verification cost only. Risks: horizontal overflow
  at small widths, sub-44px touch targets, iOS Safari IndexedDB quirks
  (storage-pressure eviction; private-mode availability — the typed
  degraded path already covers an absent IndexedDB).
- Policy exposure: none new — no store, no service worker, no new network
  surface, no new claim.

### (b) PWA — the web host + installability/offline shell

- What becomes possible: add-to-home-screen (web manifest + icons), an
  offline app SHELL (a service worker precaching static build assets),
  the two durable records surviving across launches.
- What stays dishonest to claim: offline MEDIA (playback + the local
  library are desktop-only), offline CATALOG or ad data (the in-memory
  doubles reset per session — a cache that made them look persistent
  would be a fake-durable claim, plan §4), background sync (WF-031 is
  explicitly unplanned; the web host makes ZERO network calls today and
  an SW that fetches would break the rg-provable zero-network property).
- Honesty seams: the no-tracking law (plan §6) binds the SW itself: it
  must be precache-only, runtime-network-silent after install, zero
  telemetry — provable by rg on the SW source, not promised in prose.
  The install affordance may claim exactly "install the app shell", never
  "works offline" beyond the shell.
- Cost/risk: MEDIUM — one designed row (manifest + SW + install UI +
  tests). Risks: SW update semantics vs honest versioning, iOS
  standalone-mode storage quirks, scope creep toward fabricated
  offline-data claims.
- Policy exposure: LOW — no store review, but "installable" is a public
  product claim that needs its own evidence row before WF-032 can carry
  it.

### (c) Capacitor-style native shell — the same packages in a WebView

- Reuse surface: the web host bundle runs in the WebView unchanged
  (contracts + application + shell 100%); the unavailable-surface
  registry stays literally true (a WebView is still not Node).
- The honest gap: every native capability beyond the WebView — the
  durable local library via a SQLite plugin, fs access, machine-bound
  engines — requires bridging packages that are Node-bound TODAY. That is
  a runtime-seam change to frozen packages: an FD (freeze-deviation)
  proposal per plan §2/§4, never something a client row may invent. No
  such FD exists in the ledger (P6-DURABLE-WEB-1 recorded none; this
  ruling proposes none — see §6).
- Cost/risk: HIGH — two native toolchains (iOS + Android), CI + signing +
  the WF-034 release-safety path (still audit-pending), WebView drift,
  plugin maintenance; the largest ongoing cost of the four options.
- Policy exposure: HIGHEST — store review of a media-aggregation client,
  OAuth-in-WebView provider policies, on-device key custody vs the
  key-honesty law (plan §5).
- Demand evidence: none exists and none may exist by design — the
  no-tracking law means there is no analytics to "prove" mobile demand;
  the only honest demand signal available is the PWA install path (b),
  which itself does not exist yet.

### (d) React Native / Expo — a new runtime, the contract-reuse test

- The contract-reuse test, run on evidence: webflix-contracts (pure TS
  schemas) — reusable; webflix-application (pure TS + injected ports,
  rg-verified) — reusable in principle; webflix-shell (React DOM
  components, inline CSSProperties) — NOT reusable: RN has no DOM, and
  the shell's surfaces are DOM-bound by construction.
- Plan §2/§8 consequence: an RN client cannot COMPOSE webflix-shell; it
  would require a PARALLEL mobile UI layer over the same application
  layer. That is exactly the "stop and propose an FD instead of forking"
  case — a second shell to build, test, and keep honest forever.
- Cost/risk: HIGHEST of all options (a second UI layer + native modules
  - a second component-test substrate). Policy exposure: the same store
    review as (c), plus double-surface honesty maintenance.
- Verdict: rejected for now — not impossible, but it buys nothing (a)
  and (b) do not already deliver more cheaply, and it cannot proceed
  lawfully without an FD that does not exist.

## 3. THE RULING

- PROCEEDS NOW (the standing strategy): option (a) responsive-web-only.
  The merged web host IS the WebFlix mobile surface by default — but with
  ZERO mobile claims until the verification row lands. The next order,
  P6-MOBILE-AUDIT-1 (drafted at §5, QUEUED — TL2 owns dispatch), is the
  "a mobile slice runs" bar: real mobile-viewport browser tests plus
  host-level responsive fixes, per-surface honest results recorded.
- QUEUED LATER (conditional on the audit): option (b) PWA — P6-PWA-1
  (drafted at §5, QUEUED behind the audit), bounded to manifest +
  precache-only service worker + an install affordance whose claims the
  tests pin. It proceeds only if the audit is green and TL2 dispatches.
- LATER-ONLY-WITH-FD: option (c) — no Capacitor row may start before
  (i) a mobile-seam FD for the Node-bound packages is proposed and
  ruled, (ii) the store-policy exposure is named in a dispatched order,
  and (iii) the store-path release-safety work (WF-034) is planned in
  the same ruling. None of these exist today.
- NO: option (d) — React Native/Expo is rejected until an FD sanctions
  a parallel mobile shell; there is no evidence-driven reason to pay for
  a second UI layer while (a) is unverified and (b) unbuilt.

Reasoning in one paragraph: the only mobile surface that actually exists
is the merged web host, and the binding plan's own bar — no mobile claims
before a mobile slice runs — makes verification, not construction, the
next honest step; responsive-web-only is therefore the standing strategy
because it reuses 100% of the proven composition at zero new-code cost
and zero new policy exposure. PWA is the one credible enhancement
(install + offline shell) and is cheap enough to queue behind the audit,
but its claims must be pinned by tests or it becomes a fake-durable
trap. The native shell buys capabilities (durable library on device,
store distribution) whose price is an FD-worthy runtime-seam change plus
the highest policy exposure, with zero honest demand evidence — later,
only with an FD. React Native fails the composition law outright: it
cannot reuse webflix-shell, so it is a fork of the product surface, and
plan §2 forbids exactly that without an FD.

What must be true before ANY mobile claim:

1. P6-MOBILE-AUDIT-1 is merged: device-emulated mobile-viewport tests
   green against the BUILT host, per-surface honest results in the
   ledger row (the "a mobile slice runs" bar).
2. The durable mode is verified in a mobile engine (IndexedDB opt-in
   works; the typed degraded path exercised under private-mode/quota
   conditions).
3. The unavailable-surface registry is re-read on mobile: the same four
   declarations stay true, and any mobile-only unavailability (a
   capability mobile browsers lack) is added as TYPED data, never prose.
4. No install/offline claim before P6-PWA-1 lands with its own evidence;
   no store/native claim before the (c) conditions; no RN claim ever
   absent an FD.
5. WF-032's mobile half stays unclaimed until 1-3 hold; the matrix cell
   (§4) says web half only.

## 4. Requirements-matrix impact (docs/product/requirements-matrix.md)

One row advances, ledger-provable; the other candidate rows stay
verbatim. The edit follows the MATRIX-RECON-1 pattern (status cell +
appended reconciliation note; requirement text, acceptance summaries,
the row set and the "Initial status" header unchanged).

- WF-032 (Future web/mobile — "Reuse platform-neutral contracts and
  application layer"): planned -> tested, WEB HALF ONLY. Proving ledger
  rows: P6-WEB-HOST-1 @ 7aa43a3 (merged b7242ea; a separate web client
  composes webflix-shell AppShell over the real webflix-application use
  cases; web-client tests 12/12 + shell components 80/80 + build
  emitted 370.82 kB; gates reproduced at the merge) and
  P6-DURABLE-WEB-1 @ 8392a30 (ruling 862e452; the same client gained
  the typed durable seam; web-client tests 41/41 + build 378.61 kB).
  "Separate clients call same use cases" is proven for the web client;
  the mobile half is explicitly NOT claimed — this ruling queues the
  audit that could prove it.
- WF-020 (Friend recommendations): verbatim. No friend-data surface
  exists on any host; nothing in the Phase-6 merges touches consent,
  visibility or revoke flows.
- WF-029 (Ad personal memory): verbatim. The durable-web row's
  save/forget covers the ranker-selection record only; Ad Center
  observation memory — the WF-029 outcome — is not delivered anywhere.
- WF-031 (Optional sync): verbatim. P6-DURABLE-WEB-1's honest limits
  explicitly deny server/cloud sync and cross-device claims; sync stays
  unplanned and P6-PWA-1's non-goals keep it that way.
- All other rows: out of this row's grant, untouched.

## 5. Sequenced follow-up orders (DRAFTED — queued here, NOT dispatched)

TL2 owns dispatch. Both drafts are work-order standard (scope + honest
non-goals + gates + transport); neither is dispatched by this doc.

### Draft order 1 — P6-MOBILE-AUDIT-1 (the mobile verification row)

- Work ID: P6-MOBILE-AUDIT-1. Requirement IDs: WF-032 (mobile half);
  phase6-clients-plan Sequencing row 3+ mobile. Owner: D2-lane worker
  (apps/web-client responsive fixes grant). Branch:
  p6-mobile-audit-1; base: main after the P6-MOBILE-RULING merge.
- Objective: make "a mobile slice runs" TRUE and recorded — run the
  BUILT web host under device emulation (mobile profiles ~375-430px +
  one tablet width), record per-surface honest results for all six
  screens + the persistence control + the unavailable registry, and fix
  ONLY host-level responsive defects in apps/web-client (CSS-level:
  nav wrapping, touch targets >= 44px, overflow containment).
- Honest non-goals: NO PWA artifacts (manifest/SW), NO native work, NO
  new features, NO contract changes (0.11.0 frozen), NO changes under
  packages/ — a defect found IN webflix-shell is recorded as an honest
  limit plus a proposed follow-up (a separately-sanctioned additive
  shell row), never patched in place by this order; NO claim beyond
  what the new tests prove.
- Gates: the seven standard commands (tsc group1/group2 0; test:unit
  exact-base green; test:integration 1/1; lint zero-NEW; fmt:check
  PASS; architecture:check 0) + `pnpm --filter webflix-shell
test:components` unchanged 80/80 + `pnpm --filter web-client test`
  (41 + the new mobile-viewport tests) + `pnpm --filter web-client
build` emits. New tests assert, per screen at mobile widths: no
  horizontal document overflow; the nav is reachable and usable; the
  persistence control is usable; the degraded path is exercised.
- Transport: same bundle protocol (docs+code commits, separate
  ledger-row commit, git bundle + tmpfiles.org + sha256 in the report).

### Draft order 2 — P6-PWA-1 (the PWA slice; CONDITIONAL on the audit)

- Work ID: P6-PWA-1. Requirement IDs: WF-032 (web half depth);
  explicitly NOT WF-031 (no sync). Owner: D2-lane worker
  (apps/web-client PWA grant). Branch: p6-pwa-1; base: main after the
  P6-MOBILE-AUDIT-1 merge; dispatch condition: audit green + TL2
  dispatch.
- Objective: installability, honestly — a web manifest with WebFlix
  identity (WF-001's isolation law carries over: name/icons/colors,
  standalone display), a PRECACHE-ONLY service worker (static app-shell
  assets; the fetch handler serves only precached assets and renders
  the honest offline state otherwise; ZERO runtime network after
  install), and an install affordance whose visible claim is exactly
  "install the app shell — media and catalog need a session; nothing
  but the shell works offline".
- Honest non-goals: NO offline media/catalog claims, NO background
  sync/push (WF-031 untouched), NO analytics or telemetry EVER, NO
  native bridges, NO changes to the persistence modes or the
  unavailable-surface registry, NO contract changes.
- Gates: the seven standard commands + web-client tests (prior suite +
  new: manifest validity, SW registration, offline-shell smoke under
  emulation, install-claim string pins) + web-client build emits +
  rg proof that the SW source contains no runtime fetch targets
  beyond the precache list and the host adds no network tokens.
- Transport: same bundle protocol.

## 6. Honest limits of THIS row

- Docs-only: no implementation, no host code, no contract change
  (webflix-contracts stays 0.11.0), no shell/application/domain change.
- No mobile-browser test was run by this row — the ruling is analysis
  over ledger evidence; the audit order exists precisely to create the
  missing evidence.
- No work order is dispatched by this doc; TL2 owns dispatch.
- FD PROPOSALS: none. The ruling records that options (c)/(d) REQUIRE
  an FD before any row may exist (the mobile-seam FD for (c), the
  parallel-mobile-shell FD for (d)) — a constraint, not a proposal:
  proposing either now would be premature (no honest demand evidence,
  (a) unverified, (b) unbuilt).
- The matrix advance is bounded to WF-032's web half; every other
  candidate row (WF-020/029/031) stays verbatim with reasons recorded
  in §4.
