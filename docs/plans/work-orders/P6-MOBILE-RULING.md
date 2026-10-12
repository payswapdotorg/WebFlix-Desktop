# Work order — P6-MOBILE-RULING (Phase-6 row 4): the mobile client decision doc

## Identity

- Work ID: P6-MOBILE-RULING
- Requirement IDs: phase6-clients-plan.md sequencing row 3+ ("mobile + durable-web — LATER rulings"); desktop-roadmap.md Phase 6 ("web and mobile clients")
- Owner: D2-lane worker (docs grant)
- Branch: p6-mobile-ruling
- Base SHA: main AFTER the P6-WEB-HOST-1 merge (clone main; record HEAD as BASE)

## Precondition (hard)

P6-WEB-HOST-1 must be MERGED on main (a real web slice exists — the
"no claims until a real slice exists" bar). If apps/web-client is absent
at your base, STOP and report the blocker.

## Objective

The mobile client T R U E decision doc — docs/plans/phase6-mobile-ruling.md —
that decides, with evidence, whether/when/how a mobile client exists. This
is a RULING row: the deliverable is the decision + its reasoning + the
sequenced next orders (if any), NOT an implementation.

Scope rows:

1. **Option analysis (evidence-cited)**: the realistic mobile host
   strategies evaluated against the binding constraints (phase6 §1-§8):
   (a) responsive-web-only (the merged web host on mobile browsers —
   zero new code, what it honestly covers vs not), (b) PWA (the web host
   - installability/offline shell — what becomes possible, what stays
     dishonest to claim), (c) Capacitor-style native shell wrapping the
     same packages, (d) full React Native/Expo client (new runtime,
     contract-reuse test). Each option: reuse surface (contracts/
     application/shell consumption), honesty seams (session-only vs
     durable, unavailable engines), cost/risk, policy exposure.
2. **The ruling**: which option (or none) proceeds NOW vs LATER, with
   the reasoning; what must be true before any mobile claim (e.g. the
   durable-web row landing first, or a specific adapter existing).
3. **Requirements-matrix impact**: which WF rows (WF-020/029/031/032 —
   the web/mobile host rows) the ruling touches; status changes ONLY if
   ledger-provable (cite Work ID + SHA), else rows stay verbatim.
4. **Sequenced follow-ups**: if the ruling proceeds, the next 1-2 work
   orders drafted to work-order standard (scope + honest non-goals +
   gates + transport) — queued in the ruling doc, NOT dispatched by the
   worker (TL2 owns dispatch).

## Honest non-goals

- NO implementation, NO host code, NO contract changes, NO status
  claims not ledger-provable, NO new requirements rows.

## Gates (run all; record exact commands + totals — the docs-only proof)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # exact base green
pnpm test:integration   # green
pnpm lint               # zero NEW vs base
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components  # unchanged green
```

## Transport (NO push)

- Commits on branch p6-mobile-ruling: ONE docs commit + SEPARATE
  ledger-row update commit (P6-MOBILE-RULING row -> delivered).
- git bundle create /tmp/p6-mobile-ruling-bundle.txt <base>..p6-mobile-ruling,
  upload to tmpfiles.org, verify, URL + sha256 in the report.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== P6-MOBILE-RULING REPORT BEGIN ===
BASE: <base sha>
BRANCH: p6-mobile-ruling (head <sha>, <n> commits)
GATES: (the gate lines with real numbers)
RULING: <the decision + one-paragraph reasoning>
MATRIX IMPACT: <rows touched or "none verbatim">
FOLLOW-UP ORDERS: <drafted ids or none>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P6-MOBILE-RULING REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats a
fabricated pass. ENGLISH report markers, verbatim.
