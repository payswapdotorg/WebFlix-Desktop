# Work claim ledger

TL2 must update this file before dispatching new work. The table is the authoritative concurrency lock; branches and messages alone are not a claim.

## Active work

| Work ID | Phase | Owner | Base SHA | Allowed paths | Dependencies | Status | Evidence |
|---|---|---|---|---|---|---|---|
| TL2-BOOT-001 | Phase 0 | TL2 | 29628c9acdb81b703bbd4080c207a0e7ce5e276e (reconfirm actual HEAD) | root docs, architecture policy after baseline inspection, integration metadata | none | ready-to-start | Add final commit SHA and exact gates after execution |
| AUDIT-DESKTOP | Phase 0 | Worker 1 | TL2 records confirmed base SHA | read-only: packages/desktop, app identity, packaging, renderer/security and UI | TL2-BOOT-001 baseline pin | unclaimed | Link source-backed audit report and commands |
| AUDIT-DATA | Phase 0 | Worker 2 | TL2 records confirmed base SHA | read-only: packages/shared, rpc, services storage, migrations, test infra | TL2-BOOT-001 baseline pin | unclaimed | Link source-backed audit report and commands |
| AUDIT-SOURCES | Phase 0 | Worker 3 | TL2 records confirmed base SHA | read-only: providers, media/playback, old WebFlix reference, torrents/media engines/Ad Center candidates | TL2-BOOT-001 baseline pin | unclaimed | Link source-backed audit report and commands |
| D1-SHELL | Phase 1 | Worker 1 | set after contract freeze | packages/desktop and assigned UI shell paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and GUI evidence |
| D2-LOCAL | Phase 1 | Worker 2 | set after contract freeze | webflix contracts/domain/application/local-library paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and persistence evidence |
| D3-PLAYBACK | Phase 1 | Worker 3 | set after contract freeze | catalog/connectors/playback/local file adapter paths only | D1 contract freeze | blocked-on-prerequisite | Link PR/commit and playback evidence |

## Claim rules

- TL2 replaces the provisional baseline with the exact inspected origin/main SHA before any implementation.
- Workers claim rows before editing. Phase 0 audit rows can be assigned in parallel; those lanes are read-only.
- Phase 1 rows cannot start until TL2 records the contract freeze commit and narrows allowed paths.
- One active writer per path. A new overlapping assignment waits or gets a new disjoint path set.
- On completion, change status, base/head SHA, touched paths, commands/results, acceptance evidence and remaining limitations.
- A reverted, stale or superseded claim remains in the history section; never erase evidence.

## Completed work

This section starts empty for code/features. Architecture documents created during repository setup are recorded in their GitHub commit history; they do not imply that product feature requirements are implemented or tested.