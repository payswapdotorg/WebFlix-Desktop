# Phase 7 — expanded-row plan (post-Phase-6 backlog burn-down)

Owner: TL2. Authored 2026-10-13. This plan sequences the remaining
`planned`/`audit-pending` rows of the requirements matrix after the
Phase-6 completion ruling (61c37a4). It follows the same binding laws as
phase6-clients-plan.md; where this doc is silent, the desktop roadmap's
phase descriptions and the worker protocol govern.

## Binding constraints

1. **Additive-only contracts.** Every new public shape lands as a NEW
   sibling module under `packages/webflix-contracts/src/` with a minor
   version bump and one additive `export *` line in the entrypoint. Frozen
   §2 shapes are never edited. One lane owns the contracts file per wave
   (this wave: the search lane only).
2. **Disjoint paths per wave.** Wave-1 lanes touch three disjoint package
   sets (contracts+application / playback / application-retention). Shared
   files (`webflix-shell/src/states.ts`, `index.ts`, AppShell) are NOT
   touched by wave 1 — they belong to the wave-2 composition row, exactly
   per the DESKTOP-COMPOSITION-1 precedent.
3. **Fixture-honest tests.** No live provider calls, no network. A
   fixture/mocked test proves only its stated contract behavior. The
   report says which class each gate ran in.
4. **Honest states, never dead controls.** Unsupported/absent
   capabilities surface as typed, explained states — no silent no-ops.
5. **Matrix honesty.** Workers do not edit the requirements matrix; any
   status advance is TL2's ruling on the delivered evidence.
6. **One session = one task.** Workers deliver on a dedicated branch,
   gates green, git-bundle relay to tmpfiles.org, verbatim ENGLISH report
   markers. TL2 reviews at the station, reproduces gates, merges, pushes.

## Wave 1 (parallel, three disjoint lanes)

| Row | Work ID | Requirement | Owner lane | Owned paths (summary) |
|-----|---------|-------------|------------|------------------------|
| 1 | P7-SEARCH-1 | WF-009 federated search | D3 | contracts/src/search.ts (NEW, 0.12.0) + entrypoint export; webflix-application federated-search use case + tests |
| 2 | P7-PLAYER-1 | WF-006 player controls | D1 | packages/playback/src/controls.ts (NEW) + entrypoint export + tests; typed against frozen PlaybackPlan |
| 3 | P7-RETENTION-1 | WF-021 history/retention controls | D2 | webflix-application history-retention use cases + retention stores (NEW files) + tests |

All three base on main @ 61c37a4 (or later; record HEAD as BASE).

## Wave 2 (after wave-1 merges)

| Row | Work ID | Requirement | Notes |
|-----|---------|-------------|-------|
| 4 | P7-COMPOSE-1 | (mount) WF-006/009/021 surfaces | Single-owner shell composition row: SearchScreen federated states + WatchScreen controls surface + retention/settings surface; states.ts/index.ts/AppShell edits live HERE |
| 5 | P7-AD-MEMORY-1 | WF-029 ad personal memory | ads package + application additive; explicit opt-in scopes; no ambient observation |

## Wave 3 (candidates, time permitting)

- P7-GUEST-1 (WF-003 guest viewing) — honest auth gates by capability.
- P7-STREAM-HANDOFF-1 (WF-012) — official website/deep-link isolated
  handoff paths; no DRM promises.
- P7-AUDIT-ISOLATION-1 (WF-030) + P7-AUDIT-RELEASE-1 (WF-034) — the two
  `audit-pending` rows; read-only audit deliveries.
- WF-013/014/015 (torrent trio) stay parked pending the engine/rights
  investigation; WF-020 friend recommendations stays parked on the consent
  model; WF-031 optional sync stays pinned deferred per the Phase-6
  mobile ruling until explicitly re-opened.

## Critical path

P7-SEARCH-1 + P7-PLAYER-1 + P7-RETENTION-1 (parallel) → P7-COMPOSE-1 →
P7-AD-MEMORY-1 → wave-3 candidates. Reviews are serial at the TL2 station
in delivery order.
