# Work order — P6-MOBILE-AUDIT-1 (Phase-6 row 5): mobile-viewport verification of the web host

## Identity

- Work ID: P6-MOBILE-AUDIT-1
- Requirement IDs: WF-032 (mobile half — the ruling doc §4 records the web half already advanced); phase6-clients-plan.md Sequencing ("no mobile claims before a mobile slice runs"); phase6-mobile-ruling.md §3 (the ruling: P6-MOBILE-AUDIT-1 is the "a mobile slice runs" bar) + §5 draft order 1 (this doc's source, now authoritative here)
- Owner: D2-lane worker (apps/web-client responsive-fixes grant)
- Branch: p6-mobile-audit-1
- Base SHA: main AFTER the P6-MOBILE-RULING merge (2b4046d or later; clone main; record HEAD as BASE)

## Precondition (hard)

phase6-mobile-ruling.md must be MERGED on main (the ruling exists and
QUEUES this order), and apps/web-client must exist (P6-WEB-HOST-1 +
P6-DURABLE-WEB-1 merged: session-only + durable modes, the
unavailable-surfaces registry). If either is absent at your base, STOP
and report the blocker instead of improvising.

## Objective

Make "a mobile slice runs" TRUE and recorded — run the BUILT web host
under device emulation (mobile profiles ~375-430px + one tablet width),
record per-surface honest results for all six screens (home, search,
library, accounts, ads, evaluation) + the persistence control + the
unavailable-surface registry, and fix ONLY host-level responsive defects
in apps/web-client (CSS-level: nav wrapping, touch targets >= 44px,
overflow containment).

Scope rows:

1. **Mobile-viewport test harness**: device-emulated tests against the
   BUILT host (the `pnpm --filter web-client build` output under a
   headless browser with mobile viewport profiles ~375px, ~390px, ~430px
   - one tablet width ~768px). Per screen, per width, the tests assert:
     no horizontal document overflow; the nav is reachable and usable;
     the persistence control is usable; the degraded path (a surface
     declaring itself unavailable) is exercised.
2. **Host-level responsive fixes (CSS-level ONLY)**: fix defects the
   audit surfaces, but ONLY in apps/web-client host CSS — nav wrapping,
   touch target sizes (>= 44px), overflow containment. A defect found
   IN webflix-shell is recorded as an honest limit plus a proposed
   follow-up (a separately-sanctioned additive shell row), never
   patched in place by this order.
3. **Per-surface honest results recorded**: the report (and a results
   doc in apps/web-client or docs/plans/audits/) records, per surface
   per width: pass / fixed-by-this-row / shell-defect-recorded (with
   the proposed follow-up), with the test names that prove each cell.
4. **Gates + evidence**: the seven standard commands + the web-client
   suite (41 existing + the new mobile-viewport tests) + the build
   emits. rg evidence: zero changes under packages/.

## Honest non-goals

- NO PWA artifacts (no manifest, no service worker — P6-PWA-1 owns
  those, conditional on this audit).
- NO native work, no Capacitor/RN anything (the ruling §3: option (c)
  LATER-ONLY-WITH-FD, option (d) rejected).
- NO new features, NO contract changes (webflix-contracts stays 0.11.0),
  NO changes under packages/ — including webflix-shell (a shell defect
  is an honest limit + proposed follow-up, NEVER an in-place patch).
- NO claim beyond what the new tests prove; NO mobile-half matrix
  status advance beyond what this row's tests actually evidence (any
  matrix edit must be ledger-provable per the MATRIX-RECON-1 pattern).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new
- pnpm --filter webflix-shell test:components — unchanged 80/80
- pnpm --filter web-client test — 41 prior + the new mobile-viewport
  tests, all green
- pnpm --filter web-client build — emits

## Transport (NO push)

- Commits on branch p6-mobile-audit-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P6-MOBILE-AUDIT-1 row -> delivered in
  docs/plans/work-claims.md).
- git bundle create /tmp/p6-mobile-audit-1-bundle.txt
  <base>..p6-mobile-audit-1, upload to tmpfiles.org (rename .txt),
  verify GET + cmp, URL + sha256 in the report. Upload EARLY, re-verify
  at the end.
- Final report with VERBATIM ENGLISH markers:
  === P6-MOBILE-AUDIT-1 REPORT BEGIN === (BASE / BRANCH / GATES /
  AUDIT RESULTS / MATRIX IMPACT / FOLLOW-UP ORDERS / HONEST LIMITS /
  FD PROPOSALS / BUNDLE) === P6-MOBILE-AUDIT-1 REPORT END ===
