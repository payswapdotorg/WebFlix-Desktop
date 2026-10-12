# Work order — MATRIX-RECON-1 (Phase-6 row 1): requirements-matrix status reconciliation

## Identity

- Work ID: MATRIX-RECON-1
- Requirement IDs: phase6-clients-plan.md sequencing row 1; AGENTS.md (feature-status changes must update the matrix); the ledger's delivered evidence (P4-_ / P5-_ rows, 2026-10-09..12)
- Owner: D2-lane worker (docs grant)
- Branch: matrix-recon
- Base SHA: main head at dispatch (the DESKTOP-COMPOSITION-1 dispatch-lock commit 4c0b4b5 or later — clone main, branch from HEAD)

## Objective

docs/product/requirements-matrix.md has not been touched since the
freeze; its per-requirement statuses have drifted from the delivered
reality recorded in docs/plans/work-claims.md. Reconcile: every WF-00x
row's status column reflects what the LEDGER proves — no more, no less.

Scope rows:

1. **Status reconciliation**: for each WF row, read the ledger's
   delivered/merged rows and set the honest status. Use the existing
   status vocabulary (planned / audit-pending / in-progress / partial /
   delivered per the matrix's own conventions — do not invent new
   states). Examples the ledger proves: WF-022 (media intelligence —
   the P4 shapes + engines landed; the COMPOSITION row mounts the
   display surfaces), WF-024..WF-028 (Ad Center — the P5 rows landed:
   sources/stores/claims/verify/qualify with honest coverage limits);
   anything NOT delivered stays planned/partial with its reason.
2. **Evidence column**: each changed status cites the proving ledger
   row(s) by Work ID + merge SHA (one citation per claim, in the
   matrix's existing citation style).
3. **Honest boundary statements**: statuses distinguish "contract +
   store + use case delivered" from "user-visible surface mounted"
   (pre-/post-DESKTOP-COMPOSITION-1) — the composition row's own state
   is recorded as whatever main shows at your base.
4. **No scope creep**: matrix rows NOT provable from the ledger keep
   their current status verbatim; no new requirements, no rewording of
   requirement text, no deletions.

## Honest non-goals

- NO product requirement text changes (status + evidence columns only),
  NO new WF rows, NO contract/application/shell code changes, NO test
  changes (the matrix is docs).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each (unchanged tree)
pnpm test:unit          # 1326+ at base, all green (unchanged)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components   # 70/70 + whatever main shows at your base
```

(The gates prove the docs-only claim: the tree is UNCHANGED except
docs/product/requirements-matrix.md — the diffstat IS the evidence.)

## Transport (NO push)

- Commits on branch matrix-recon: ONE docs commit + SEPARATE
  ledger-row update commit (MATRIX-RECON-1 row -> delivered).
- git bundle create /tmp/matrix-recon-bundle.txt <base>..matrix-recon,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp), URL +
  sha256 in the report.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== MATRIX-RECON-1 REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: matrix-recon (head <sha>, <n> commits)
GATES: (the gate lines with real numbers)
DIFFSTAT: docs/product/requirements-matrix.md only (<n> rows changed)
STATUS CHANGES: <per-WF-row list: old -> new + the citing ledger Work ID/SHA>
HONEST LIMITS: <plain list — e.g. rows left unchanged and why>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== MATRIX-RECON-1 REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats a
fabricated pass. ENGLISH report markers, verbatim.
