# Work order — P7-STREAM-HANDOFF-1 (Phase-7 wave-3): streaming-service handoff, honestly

## Identity

- Work ID: P7-STREAM-HANDOFF-1
- Requirement IDs: WF-012 (streaming services); NOT WF-005, NOT any DRM
  adjacent work
- Owner: D3-lane worker (connector handoff grant)
- Branch: p7-stream-handoff-1
- Base SHA: main after the wave-1 merges (or later; clone main; record
  HEAD as BASE)
- Dispatch condition: at least one wave-1 row merged AND sandbox capacity
  free — TL2 dispatches when it is.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md and at least the P7-SEARCH-1
merge. If absent, STOP and report the blocker.

## Objective

Official streaming-service handoff paths with an honest isolated
experience — fixture-testable:

1. **NEW `packages/connectors/src/streaming/`** (a fifth provider family
   beside the existing ones, same manifest discipline): a
   `manifest.ts` declaring the streaming trio (Netflix, Prime Video,
   Paramount+) as EXTERNAL-handoff providers — per operation, the
   capability status is `unsupported-in-app` with the typed reason "DRM
   and licensed-streaming constraints — official site/player only" and a
   `deep-link` mechanism class where the provider publishes official
   deep links. ZERO network adapters, ZERO scraping, ZERO DRM-adjacent
   anything.
2. **NEW `packages/playback/src/`-adjacent handoff plan derivation** —
   ONLY if it composes additively with the existing external-deep-link
   plan kinds; otherwise the handoff mapping stays in the connectors
   manifest layer and the report says so honestly.
3. **Tests (fixture-only, hermetic)**: manifest validity (three
   providers, external-handoff class, typed unsupported reasons),
   deep-link plan derivation where additive, no in-app playback claim
   anywhere (rg proof in the report), honest isolation flags (the
   external handoff never inherits the app session).

## Honest non-goals

- NO DRM bypass, NO raw-stream promise, NO scraping, NO network, NO
  account work, NO shell/UI, NO contract edits, NO matrix edit.

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1) — exit 0; npx tsc -b --force (group 2) —
  exit 0
- pnpm test:unit — base green + new tests; pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base; pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-stream-handoff-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-STREAM-HANDOFF-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
  git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-stream-handoff-1:refs/heads/p7-stream-handoff-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-STREAM-HANDOFF-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-STREAM-HANDOFF-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
