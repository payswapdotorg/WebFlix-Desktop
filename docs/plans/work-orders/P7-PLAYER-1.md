# Work order — P7-PLAYER-1 (Phase-7 row 2): player controls, honestly

## Identity

- Work ID: P7-PLAYER-1
- Requirement IDs: WF-006 (player controls); NOT WF-005 (playback
  resolution stays as-is)
- Owner: D1-lane worker (playback package grant)
- Branch: p7-player-1
- Base SHA: main @ 61c37a4 (or later; clone main; record HEAD as BASE)
- Dispatch condition: phase7-expanded-rows-plan.md merged on main —
  SATISFIED; TL2 dispatched.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md and the P6-PWA-1 merge
(61c37a4 or later). If absent at your base, STOP and report the blocker.

## Objective

A capability-aware player-controls layer — pure, typed, fixture-testable:

1. **NEW file `packages/playback/src/controls.ts`** + additive export in
   `packages/playback/src/index.ts` (one `export * from "./controls.js";`
   line; existing exports untouched):
   - `PlayerControlsModel`: derived FROM an existing `PlaybackPlan`
     variant (official-embed | local-file | isolated-website |
     external-deep-link | unavailable) — a pure function
     `deriveControls(plan: PlaybackPlan): ControlsAvailability`
   - `ControlsAvailability`: per-control typed availability —
     pause/play, seek (with a position bound when known), volume,
     captions, queue-add, mini-player, PiP — each `available` with
     capability facts, or `unavailable` with a typed reason (never a
     dead control)
   - `ControlCommand` union (typed commands: play/pause/seek/volume/
     captions-toggle/queue-add) + a pure reducer/applicability check
     `canApply(cmd, plan)` returning ok or a typed refusal reason
   - mini-player/PiP: availability is DECLARED by the plan kind and
     host capability input (a parameter, defaulting unavailable) — no
     host integration claimed
2. **Tests (fixture-only)** — NEW `packages/playback/src/__tests__/`
   (or the repo's existing playback test location — follow the local
   convention): the per-plan-kind control matrix (all five plan variants
   + unavailable), refusal reasons for commands against plans that don't
   support them, seek bound correctness for local-file plans, queue-add
   applicability, mini-player/PiP default-unavailable honesty, and the
   no-dead-control invariant (every control surfaces a typed state).

## Honest non-goals

- NO real media engine, NO Electron/webview integration, NO actual
  playback — this is the typed control layer the hosts will bind to in
  the composition row.
- NO shell/UI changes — WatchScreen wiring is the P7-COMPOSE-1 row.
- NO contract edits — typed strictly against the frozen webflix-contracts
  PlaybackPlan union (contracts stay 0.11.0; the wave's 0.12.0 bump is
  the search lane's, do not touch it in your branch).
- NO queue persistence (a store is out of scope), NO captions parsing.
- NO matrix edit (status advance is TL2's ruling).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green + the new control tests
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (NO push)

- Commits on branch p7-player-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-PLAYER-1 row -> delivered in
  docs/plans/work-claims.md).
- git bundle create /tmp/p7-player-1-bundle.txt <base>..p7-player-1,
  upload to tmpfiles.org (rename .txt), verify GET + cmp, URL + sha256 in
  the report. Upload EARLY, re-verify at the end. ALSO: if the upload
  fails or the entry dies, paste the bundle's base64 between
  BUNDLE_B64_BEGIN / BUNDLE_B64_END marker lines in the report as the
  fallback transport.
- Final report with VERBATIM ENGLISH markers:
  === P7-PLAYER-1 REPORT BEGIN === (BASE / BRANCH / GATES / TEST RESULTS /
  MATRIX IMPACT / FOLLOW-UP ORDERS / HONEST LIMITS / BUNDLE)
  === P7-PLAYER-1 REPORT END ===

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
