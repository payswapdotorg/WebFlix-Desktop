# Work order — P7-COMPOSE-1 (Phase-7 row 4): mount the wave-1 surfaces in the shell

## Identity

- Work ID: P7-COMPOSE-1
- Requirement IDs: WF-006 + WF-009 + WF-021 (surface halves — the engines
  are the wave-1 rows); explicitly NOT their engine rework
- Owner: D2-lane worker (shell composition grant)
- Branch: p7-compose-1
- Base SHA: main AFTER the P7-SEARCH-1 + P7-PLAYER-1 + P7-RETENTION-1
  merges (clone main; record HEAD as BASE; verify all three rows are
  `merged` in work-claims.md)
- Dispatch condition: all three wave-1 rows merged on main — NOT YET
  SATISFIED; TL2 dispatches when it is.

## Precondition (hard)

All three wave-1 rows (P7-SEARCH-1, P7-PLAYER-1, P7-RETENTION-1) are
`merged` in docs/plans/work-claims.md at your base. If any is not,
STOP and report the blocker instead of improvising.

## Objective

The DESKTOP-COMPOSITION-1 precedent applied to the wave-1 engines —
mounts AS-IS, zero engine changes:

1. **SearchScreen (WF-009 surface)**: extend the existing
   `SearchScreen.tsx` + `states.ts` search state with the federated
   coverage view — per-source outcome rows (ok / partial-failure /
   timeout / auth-required / unsupported, with counts + honest reasons),
   a source-coverage summary line, and partial-failure presentation that
   NEVER hides a failed source. Props stay flat + optional; the screen
   composes from `FederatedSearchResult`-shaped view data passed in.
2. **WatchScreen (WF-006 surface)**: extend `WatchScreen.tsx` with a
   controls strip driven by a `ControlsAvailability`-shaped prop — every
   control renders its typed state (available / unavailable-with-reason);
   no dead controls; mini-player/PiP surfaces as declared-unavailable by
   default with the honest reason.
3. **Retention surface (WF-021 surface)**: a settings-style surface
   (either a new `SettingsScreen.tsx` or a section in an existing screen
   — follow AppShell composition conventions) with: tracking
   pause/resume control, scoped reset (history | progress | feedback |
   all) with a confirm step, and the data-boundary explanation view
   (local / provider-owned / derived per record class).
4. **Composition + tests**: AppShell wiring for the new surface(s),
   states.ts additions, index.ts exports, and component tests for all
   three surfaces (the webflix-shell component-test battery).

## Honest non-goals

- NO changes under packages/webflix-contracts, webflix-application,
  playback, catalog, connectors (the engines are MERGED — mount as-is).
- NO live data wiring, NO host-app integration (desktop/web-client hosts
  adopt the surfaces in their own rows).
- NO new engine capabilities, no capability inflation.
- NO matrix edit (status advance is TL2's ruling).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green + the new component tests
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new
- pnpm --filter webflix-shell test:components — prior battery + new, all
  green

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-compose-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-COMPOSE-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
    git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-compose-1:refs/heads/p7-compose-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-COMPOSE-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-COMPOSE-1 REPORT END ===
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
