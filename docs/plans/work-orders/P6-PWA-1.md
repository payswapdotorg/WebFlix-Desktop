# Work order — P6-PWA-1 (Phase-6 row 7): the PWA slice, honestly

## Identity

- Work ID: P6-PWA-1
- Requirement IDs: WF-032 (web half depth — install/offline shell);
  explicitly NOT WF-031 (no sync); phase6-mobile-ruling.md §5 draft
  order 2 (this doc's source, now authoritative here)
- Owner: D2-lane worker (apps/web-client PWA grant)
- Branch: p6-pwa-1
- Base SHA: main AFTER the P6-SHELL-RESPONSIVE-1 merge (or later; clone
  main; record HEAD as BASE)
- Dispatch condition: the audit is green (P6-MOBILE-AUDIT-1 merged —
  device-emulated mobile-viewport tests green) — SATISFIED; TL2
  dispatched.

## Precondition (hard)

P6-MOBILE-AUDIT-1 must be MERGED on main (the 98/98 device-emulated
audit suite exists and is green), and apps/web-client must exist with
the composition/decompensated responsive state (post
P6-SHELL-RESPONSIVE-1). If either is absent at your base, STOP and
report the blocker instead of improvising.

## Objective

Installability, honestly — three artifacts in apps/web-client ONLY:

1. **Web manifest**: WebFlix identity per WF-001's isolation law —
   name/icons/colors, `display: standalone`. Icons generated as static
   assets (simple, honest placeholders — a solid color + the wordmark
   is fine; no fetched assets).
2. **Precache-only service worker**: registers at build output,
   precaches the static app-shell assets (the vite build's dist
   inventory), and its fetch handler serves ONLY precached assets —
   anything else falls through to the network or renders the honest
   offline state. ZERO runtime network after install for the shell.
3. **Install affordance**: a visible control whose claim is EXACTLY
   "install the app shell — media and catalog need a session; nothing
   but the shell works offline" (the honest string, pinned by tests).

Scope rows:

1. The three artifacts above, wired into the vite build
   (public/manifest.webmanifest + icons, the SW source registered,
   the install affordance in the host UI).
2. New tests (web-client suite): manifest validity (parses, standalone
   display, icons present), SW registration (the built output contains
   - registers the SW), offline-shell smoke under emulation (the
     precached shell serves with the network stubbed), install-claim
     string pins (the exact honest string above).
3. rg proof in the report: the SW source contains no runtime fetch
   targets beyond the precache list; the host adds no network tokens.

## Honest non-goals

- NO offline media/catalog claims (the affordance's string is the
  claim — nothing more).
- NO background sync/push (WF-031 untouched).
- NO analytics or telemetry EVER.
- NO native bridges, NO Capacitor anything.
- NO changes to the persistence modes or the unavailable-surface
  registry.
- NO contract changes (webflix-contracts stays 0.11.0), NO changes
  under packages/.
- NO matrix edit (any advance is TL2's call on this row's evidence).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new
- pnpm --filter webflix-shell test:components — unchanged green
- pnpm --filter web-client test — prior suite + the new PWA tests,
  all green (BUILD FIRST — the audit harness serves the built dist/)
- pnpm --filter web-client build — emits (dist incl. manifest + SW)

## Transport (NO push)

- Commits on branch p6-pwa-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P6-PWA-1 row -> delivered in
  docs/plans/work-claims.md).
- git bundle create /tmp/p6-pwa-1-bundle.txt <base>..p6-pwa-1, upload
  to tmpfiles.org (rename .txt), verify GET + cmp, URL + sha256 in the
  report. Upload EARLY, re-verify at the end. ALSO: if the upload
  fails or the entry dies, paste the bundle's base64 between
  BUNDLE_B64_BEGIN / BUNDLE_B64_END marker lines in the report as the
  fallback transport.
- Final report with VERBATIM ENGLISH markers:
  === P6-PWA-1 REPORT BEGIN === (BASE / BRANCH / GATES / AUDIT
  RESULTS / MATRIX IMPACT / FOLLOW-UP ORDERS / HONEST LIMITS / FD
  PROPOSALS / BUNDLE) === P6-PWA-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If
a gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass. ENGLISH report markers, verbatim.
