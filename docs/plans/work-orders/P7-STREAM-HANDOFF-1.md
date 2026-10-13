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

## Transport (NO push)

Same as the wave-1 orders: branch commits + separate delivered-status
ledger commit; git bundle → base64 in the report between BUNDLE_B64_BEGIN / BUNDLE_B64_END markers (PRIMARY transport — tmpfiles is unreachable from the station; sha256 + size lines); verbatim ENGLISH markers:
=== P7-STREAM-HANDOFF-1 REPORT BEGIN === (BASE / BRANCH / GATES / TEST
RESULTS / MATRIX IMPACT / FOLLOW-UP ORDERS / HONEST LIMITS / BUNDLE)
=== P7-STREAM-HANDOFF-1 REPORT END ===

Reminder: an honest failure beats a fabricated pass. ENGLISH markers.
