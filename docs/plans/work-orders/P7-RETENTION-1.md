# Work order — P7-RETENTION-1 (Phase-7 row 3): history/retention controls, honestly

## Identity

- Work ID: P7-RETENTION-1
- Requirement IDs: WF-021 (history/retention controls); NOT WF-031
  (no sync), NOT WF-020 (no friend data)
- Owner: D2-lane worker (application retention grant)
- Branch: p7-retention-1
- Base SHA: main @ 61c37a4 (or later; clone main; record HEAD as BASE)
- Dispatch condition: phase7-expanded-rows-plan.md merged on main —
  SATISFIED; TL2 dispatched.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md and the P6-PWA-1 merge
(61c37a4 or later). If absent at your base, STOP and report the blocker.

## Objective

Local retention controls with an explicit local/provider boundary —
fixture-testable use cases:

1. **NEW files in `packages/webflix-application/src/`** (registered in
   the package's public entry exports, additive only):
   - `history-retention.ts` — use cases: `pauseHistoryTracking` /
     `resumeHistoryTracking` (a persisted preference), `resetLocalData`
     (scoped: history | progress | feedback | all — WebFlix-owned local
     records ONLY), `getRetentionState` (the boundary view model), and
     `describeDataBoundaries` — a typed, i18n-ready boundary explanation:
     for each record class, whether it is WebFlix-local, provider-owned
     (untouchable from here), or derived (deletable locally, source
     remains provider-side). Deletes only ever claim the confirmed
     WebFlix-local scope.
   - `in-memory-retention-stores.ts` — the fixture in-memory stores for
     the retention preference + the scoped records (history/progress/
     feedback), following the in-memory-\*-stores.ts precedents.
   - The existing progress/feedback/history use cases (e.g.
     `track-playback-progress.ts`, `record-feedback.ts`) gain a
     pause-aware guard ONLY if it composes additively via the store (no
     signature rewrites; if a guard cannot be added additively, deliver
     the guard at the store seam and note it honestly).
2. **Tests (fixture-only, hermetic)** — the WF-021 test list: preference
   persistence across store restarts, reset semantics per scope (only
   the confirmed scope is cleared), scope isolation (history reset never
   touches feedback), provider-boundary honesty (provider-owned records
   are reported as not deletable here — never silently dropped or
   claimed), pause actually stops new local history writes while paused.

## Honest non-goals

- NO provider API deletion calls — provider-owned data is explained,
  never touched (the boundary IS the feature).
- NO shell/UI changes — the settings surface is the P7-COMPOSE-1 row.
- NO contract edits (contracts stay 0.11.0 in this branch — the wave's
  0.12.0 bump is the search lane's, do not touch it).
- NO sync, NO export/import, NO telemetry.
- NO matrix edit (status advance is TL2's ruling).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green + the new retention tests
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-retention-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-RETENTION-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
    git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-retention-1:refs/heads/p7-retention-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-RETENTION-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-RETENTION-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
