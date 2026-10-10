# Phase-1 serial integration checklist (TL2)

Executed once per D-lane relay bundle, then for the merged whole. Owner: TL2.
Inputs: relay bundle (branch, head SHA, changed files, commands, evidence),
work-claims.md row, contract freeze 5549208 (v1.0.0).

## Per-lane gate (before any merge)

- [ ] Ledger row updated by worker? (status, head SHA, evidence) — if not, reject the bundle back to the lane.
- [ ] Branch base is exactly 5549208 (`git merge-base --is-ancestor 5549208 <branch>`).
- [ ] Changed files ⊆ the lane's allowed paths (work-claims.md row). Any file outside ownership → require-changes or TL2-arbitrated exception recorded here.
- [ ] No edits to docs/adr/**, root config, .github/workflows/** (TL2-owned; worker proposals arrive as patches inside the relay bundle, applied separately).
- [ ] `pnpm typecheck` PASS on the branch (extended gate if D1 landed it) — zero NEW violations vs the frozen baseline (70 lint warnings / 216 desktop type errors).
- [ ] `pnpm lint` PASS (no new warnings in owned paths).
- [ ] `pnpm architecture:check -- --changed` PASS (0 new violations; new roots registered at freeze).
- [ ] Lane tests: `pnpm test:unit` + `pnpm test:integration` (D2) / contract tests (D3) / E2E minimum tier (D1) — pass counts recorded; failures labeled pre-existing vs new.
- [ ] Evidence reviewed at source (screenshots/logs/commands), not from the worker's summary alone.
- [ ] D1 only: GUI smoke evidence (OS/display, routes, observed outcomes) + isolation-flag tests (cookie import unreachable when off; per-provider partition isolation) + identity test matrix (appId/AUMID/data-root/coexistence).
- [ ] D3 only: manifest rows cite official sources; no undocumented API surface (rg for innertube|SAPISID|cookie patterns in the diff); honest-state tests present; live-smoke status recorded (pending-operator-credential acceptable, clearly labeled).
- [ ] D2 only: hermetic claims labeled; migration + backup/restore round-trip evidence; CredentialPort never persists outside the OS vault in any test or code path.

## Merge order and the mirror swap

1. **D2-LOCAL first** (foundation: webflix-contracts is the leaf everything consumes).
   - [ ] Merge d2-local → integration branch `phase-1`.
   - [ ] `pnpm test:unit && pnpm test:integration` on the merge.
2. **D3-YOUTUBE second.**
   - [ ] Merge d3-youtube → phase-1.
   - [ ] Mirror swap: delete `packages/connectors/src/contract-types.ts` (and any D3 mirror files), re-point imports to `@webflix/contracts` (or the workspace name D2 registered), keep the swap commit separate and mechanical.
   - [ ] Contract round-trip tests still PASS with the real package (D3's fixtures must validate against D2's zod schemas).
3. **D1-SHELL last.**
   - [ ] Merge d1-shell → phase-1.
   - [ ] Mirror swap for `packages/webflix-shell/src/contract-types.ts` (same mechanical rule).
   - [ ] Shell renders against real application use-cases; honest-state screens exercised.

## Whole-tree gate (on the final phase-1 merge)

- [ ] `pnpm install --frozen-lockfile` clean.
- [ ] `pnpm lint` (baseline 70 warnings — zero new).
- [ ] `pnpm typecheck` incl. desktop extended configs if D1 landed them.
- [ ] `pnpm fmt:check` PASS (drift cleared at freeze; workers keep it clean).
- [ ] `pnpm architecture:check` full run — 0 violations.
- [ ] Full test suite (all lanes' tests together).
- [ ] Desktop GUI acceptance per docs/testing/desktop-acceptance.md tiers, on the exact merged SHA, with evidence recorded (OS, display, artifact, route, outcome).
- [ ] `git status` clean after gates (no emitted artifacts — D1's clean-tree guard).
- [ ] Update work-claims.md (rows → integrated, head SHAs, evidence links), requirements matrix statuses, and this file's execution log below.

## Execution log

(filled by TL2 as lanes land)
