# Work claim ledger

TL2 must update this file before dispatching new work. The table is the authoritative concurrency lock; branches and messages alone are not a claim.

## Active work

| Work ID | Phase | Owner | Base SHA | Allowed paths | Dependencies | Status | Evidence |
|---|---|---|---|---|---|---|---|
| TL2-BOOT-001 | Phase 0 | TL2 | 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286 (origin/main verified 2026-10-09; upstream base 29628c9 present in history) | root docs, architecture policy after baseline inspection, integration metadata | none | gates-executed | Gates at base 7a14bc9 (TL2 sandbox, 2026-10-09): `pnpm install --frozen-lockfile` PASS (node-pty electron rebuild OK); `pnpm lint` PASS (0 errors, 70 pre-existing warnings); `pnpm fmt:check` FAIL — pre-existing format drift in 50+ upstream files (baseline state, not worker-attributable; run `pnpm fmt` before Phase-1 branch integration); `pnpm typecheck` monolithic run OOM-killed (exit 137) on the 4 GB TL2 sandbox — all 11 tsc projects PASS individually (shared, rpc, provider, provider-node, services, client, server, zcode-server-cli, ui, web, desktop/tsconfig.host.json); `pnpm architecture:check -- --changed` PASS (violations 0, baseline 0, new 0). Repo public-anonymous clone verified; origin/HEAD reconfirmed. |
| AUDIT-DESKTOP | Phase 0 | Worker 1 | 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286 | read-only: packages/desktop, app identity, packaging, renderer/security and UI | TL2-BOOT-001 baseline pin | claimed (dispatched 2026-10-09, session wfx-a1-desktop) | In flight; report to be linked on delivery |
| AUDIT-DATA | Phase 0 | Worker 2 | 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286 | read-only: packages/shared, rpc, services storage, migrations, test infra | TL2-BOOT-001 baseline pin | claimed (dispatched 2026-10-09, session wfx-a2-data) | In flight; report to be linked on delivery |
| AUDIT-SOURCES | Phase 0 | Worker 3 | 7a14bc9b24a1ac6f1b30c9a55efcdfaf4b8f9286 | read-only: providers, media/playback, old WebFlix reference, torrents/media engines/Ad Center candidates | TL2-BOOT-001 baseline pin | claimed (dispatched 2026-10-09, session wfx-a3-sources) | In flight; report to be linked on delivery |
| D1-SHELL | Phase 1 | Worker 1 | set after contract freeze | packages/desktop and assigned UI shell paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and GUI evidence |
| D2-LOCAL | Phase 1 | Worker 2 | set after contract freeze | webflix contracts/domain/application/local-library paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and persistence evidence |
| D3-YOUTUBE | Phase 1 | Worker 3 | set after contract freeze | catalog/connectors/playback/local file adapter paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and playback evidence |

## Claim rules

- TL2 replaces the provisional baseline with the exact inspected origin/main SHA before any implementation.
- Workers claim rows before editing. Phase 0 audit rows can be assigned in parallel; those lanes are read-only.
- Phase 1 rows cannot start until TL2 records the contract freeze commit and narrows allowed paths.
- One active writer per path. A new overlapping assignment waits or gets a new disjoint path set.
- On completion, change status, base/head SHA, touched paths, commands/results, acceptance evidence and remaining limitations.
- A reverted, stale or superseded claim remains in the history section; never erase evidence.

## Completed work

This section starts empty for code/features. Architecture documents created during repository setup are recorded in their GitHub commit history; they do not imply that product feature requirements are implemented or tested.

## Repository setup completed

| Work ID | Owner | Base SHA | Head SHA | Scope | Status | Evidence |
|---|---|---|---|---|---|---|
| REPO-LOCK-000 | Architecture setup | 29628c9acdb81b703bbd4080c207a0e7ce5e276e | 4d6a3c41c79d4bcc224ccb2a42def684304ef2f3 | Product README, WebFlix-specific AGENTS rules, architecture lock, upstream baseline, capability/data/security/provider policies, accepted ADRs, requirements matrix, roadmap, TL2 handoff, work protocol/ledger/template, desktop acceptance, local-development guidance and PR evidence template | docs-locked | See commit https://github.com/payswapdotorg/WebFlix-Desktop/commit/4d6a3c41c79d4bcc224ccb2a42def684304ef2f3. Documentation was read back from main. No product code, desktop build or test suite is claimed as executed by this setup task. |

The row above records repository documentation setup only. TL2-BOOT-001 remains responsible for reconfirming the actual remote/base, running and documenting baseline gates, auditing inherited runtime identity and completing Phase 0 contract freeze.

## Product-direction clarification

The accepted YouTube-first, per-user account strategy is recorded in docs/adr/0003-youtube-first-per-user-identity.md. TL2 must include it in contract freeze and assign worker audit evidence for every desired YouTube operation. No shared operator session is allowed. The old app is reference evidence, not blanket approval for the old access implementation.