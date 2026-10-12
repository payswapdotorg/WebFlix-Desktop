# Work order — P6-SHELL-RESPONSIVE-1 (Phase-6 row 6): the shell's own responsive pass

## Identity

- Work ID: P6-SHELL-RESPONSIVE-1
- Requirement IDs: WF-032 (mobile half — the audit row advanced it to
  device-emulated-tested with the shell debt recorded); phase6-mobile-
  ruling.md §3 condition 3 (the unavailable-surface registry re-read on
  mobile + mobile-only unavailability as typed data); the
  P6-MOBILE-AUDIT-1 row's drafted follow-up (apps/web-client/
  MOBILE-VIEWPORT-AUDIT.md "Queued follow-up order" section, now
  authoritative here)
- Owner: D2-lane worker (packages/webflix-shell additive-styling grant)
- Branch: p6-shell-responsive-1
- Base SHA: main AFTER the P6-MOBILE-AUDIT-1 merge (7b5053f or later;
  clone main; record HEAD as BASE)

## Precondition (hard)

P6-MOBILE-AUDIT-1 must be MERGED on main (the per-surface matrix +
the shell debt record exist in apps/web-client/MOBILE-VIEWPORT-AUDIT.md),
and the web host's composition CSS must exist (apps/web-client/index.html
`nav[aria-label="Primary"] { flex-wrap: wrap; }` + the 44px min-height
rules + App.tsx minHeight 44). If either is absent at your base, STOP
and report the blocker instead of improvising.

## Objective

Move the responsive truth INTO webflix-shell — pay the shell debt the
audit row recorded and composed around. When this lands, the web host's
composition CSS in apps/web-client/index.html shrinks or disappears (the
host stops compensating; the shell's own styles carry the responsive
guarantees).

Scope rows:

1. **Additive-only shell styling** (packages/webflix-shell): the
   primary nav gains `flexWrap: wrap` and `minHeight: 44` on nav
   buttons; the search form's input + submit gain `minHeight: 44`; the
   ranker option labels gain `minHeight: 44`. ADDITIVE style props
   ONLY — the component APIs do not change (props stay
   additive-optional), no new screens, no markup rewrites.
2. **Shell geometry pinned in component tests**: the
   webflix-shell component suite (80 today) gains geometry-pinning
   tests for the wrapped nav + the 44px targets (the same geometry the
   audit's device-emulated harness measures — at the shell component
   level, rendered in the component test environment).
3. **Mobile-only unavailability review (typed data)**: re-read the
   unavailable-surface registry under the mobile lens per the ruling
   §3 condition 3 — any capability the mobile runtime lacks that the
   shell surfaces must be declared as TYPED data (the registry
   pattern), never prose. If the review finds nothing to add, record
   that finding honestly (a no-op review is an acceptable outcome).
4. **Host decompensation**: apps/web-client/index.html's composition
   CSS shrinks or disappears to the extent the shell now carries the
   guarantee; `pnpm --filter web-client test` stays 98/98 green (the
   audit harness re-proves the geometry against the BUILT host —
   build first, then test: the harness serves dist/).

## Honest non-goals

- NO component-API changes (props stay additive-optional), NO new
  screens, NO markup rewrites.
- NO contract changes (webflix-contracts stays 0.11.0), NO changes to
  application/domain/contracts.
- NO PWA artifacts (P6-PWA-1 owns those), NO native work.
- NO new architecture registrations (webflix-shell is already a
  registered module).
- NO matrix edit (this row carries no requirements-matrix path; any
  advance is TL2's call on this row's evidence).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green (1326/1326 expected)
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new
- pnpm --filter webflix-shell test:components — 80 prior + the new
  geometry tests, all green
- pnpm --filter web-client test — 98/98 unchanged green (BUILD FIRST —
  the audit harness serves the built dist/)
- pnpm --filter web-client build — emits

## Transport (NO push)

- Commits on branch p6-shell-responsive-1: code/docs commit(s) +
  SEPARATE ledger-row update commit (P6-SHELL-RESPONSIVE-1 row ->
  delivered in docs/plans/work-claims.md).
- git bundle create /tmp/p6-shell-responsive-1-bundle.txt
  <base>..p6-shell-responsive-1, upload to tmpfiles.org (rename .txt),
  verify GET + cmp, URL + sha256 in the report. Upload EARLY,
  re-verify at the end.
- Final report with VERBATIM ENGLISH markers:
  === P6-SHELL-RESPONSIVE-1 REPORT BEGIN === (BASE / BRANCH / GATES /
  AUDIT RESULTS / MATRIX IMPACT / FOLLOW-UP ORDERS / HONEST LIMITS /
  FD PROPOSALS / BUNDLE) === P6-SHELL-RESPONSIVE-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If
a gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass. ENGLISH report markers, verbatim.
