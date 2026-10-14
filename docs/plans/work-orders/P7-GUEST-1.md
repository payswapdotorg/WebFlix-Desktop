# Work order — P7-GUEST-1 (Phase-7 wave-3): guest viewing, honestly

## Identity

- Work ID: P7-GUEST-1
- Requirement IDs: WF-003 (guest viewing); NOT WF-010 (no provider
  account work), NOT WF-011
- Owner: D3-lane worker (catalog/application guest grant)
- Branch: p7-guest-1
- Base SHA: main after the wave-1 merges (or later; clone main; record
  HEAD as BASE)
- Dispatch condition: at least one wave-1 row merged AND sandbox capacity
  free — TL2 dispatches when it is.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md and at least the P7-SEARCH-1
merge. If absent, STOP and report the blocker.

## Objective

Guest exploration with honest auth gates — fixture-testable:

1. **NEW `packages/webflix-application/src/guest-session.ts`** +
   registration in the package public entry exports: a
   `GuestSessionFactory` that mints a guest profile with NO provider
   accounts connected; a `guest-capabilities.ts` view model deriving,
   per operation, whether the guest state permits it (public browse/
   search/watch where the capability manifests already declare the
   operation available without account auth) or refuses with a typed
   `auth-required` reason pointing at the connect flow. Honest gates by
   capability — NEVER a dead action.
2. **NEW in-memory guest stores/fixture adapters** (in the tests tree)
   with a public-capability connector manifest fixture (public browse +
   search marked available; account actions marked auth-required).
3. **Tests (fixture-only, hermetic)**: fresh-profile guest session
   creation, public-capability operations resolve, account-gated
   operations refuse with typed reasons, no provider account state ever
   created for a guest, guest → connect handoff produces the
   auth-required state honestly.

## Honest non-goals

- NO real provider calls, NO credentials, NO shell/UI (composition row
  later), NO contract edits (typed against existing shapes only), NO
  matrix edit.

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1) — exit 0; npx tsc -b --force (group 2) —
  exit 0
- pnpm test:unit — base green + new tests; pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base; pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-guest-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-GUEST-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
  git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-guest-1:refs/heads/p7-guest-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-GUEST-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-GUEST-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
