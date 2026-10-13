# Work order — P7-AUDIT-ISOLATION-1 (Phase-7 wave-3): account-isolation audit (WF-030)

## Identity

- Work ID: P7-AUDIT-ISOLATION-1
- Requirement IDs: WF-030 (account isolation — the `audit-pending` row)
- Owner: D2-lane worker (read-only audit grant)
- Branch: p7-audit-isolation-1
- Base SHA: main after the wave-1 merges (or later; clone main; record
  HEAD as BASE)
- Dispatch condition: wave-1 merges landing AND sandbox capacity free —
  TL2 dispatches when it is.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md. If absent, STOP and report
the blocker.

## Objective (READ-ONLY audit — zero product-code changes)

The WF-030 audit delivery: verify, with source-cited evidence, that
provider accounts, tokens and writes are scoped to the connecting
user/profile:

1. **Cross-profile isolation audit**: trace every provider-account
   storage/lookup path (connector auth adapters, account records,
   credential ports) — does any path read another profile's account?
   Cite files/lines; record the verdict per path.
2. **Disconnect/re revoke audit**: trace the disconnect/revoke flows —
   do credentials die with the disconnect? Is revocation propagated to
   every cache/store layer? Cite evidence.
3. **Operator-session leakage audit**: grep + trace for any shared
   operator cookie/CDP-broker reuse (the forbidden legacy pattern from
   ADR-0003) — verify NONE exists in the current tree.
4. **Test-coverage map**: which isolation behaviors have tests, which
   lack them — name the exact missing test cases (do NOT write them in
   this row; they are a follow-up order's payload).
5. **The report IS the deliverable** — commit it as
   `docs/audits/account-isolation-audit-2026-10-13.md` (source-backed,
   every claim cites path + line evidence, honest unknowns section).

## Honest non-goals

- ZERO product-code changes, ZERO test changes — this row delivers an
  audit document ONLY (plus the ledger-row status commit).
- No credentials, no provider accounts, no live provider calls.
- NO matrix edit (the audit-pending → audited transition is TL2's
  ruling on this evidence).

## Gates

- npx tsc -b --force both groups — exit 0 (unchanged tree must hold)
- pnpm test:unit — exact base green (the tree is untouched)
- pnpm lint — zero NEW; pnpm fmt:check — PASS
- pnpm architecture:check — 0/0/0

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-audit-isolation-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-AUDIT-ISOLATION-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
    git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-audit-isolation-1:refs/heads/p7-audit-isolation-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-AUDIT-ISOLATION-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-AUDIT-ISOLATION-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
