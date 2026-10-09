# TL2 and worker protocol

This document is binding for TL2 and the three implementation workers. The repository, not chat memory, stores design decisions, assignments, evidence and completion status.

## Roles

### TL2 — technical lead / integrator

- Owns architecture lock, public contract changes, root package/workspace configuration, architecture policy, product identity decisions, data-ownership/security policy and cross-lane integration.
- Converts requirements into bounded work orders with explicit file ownership, dependencies, contract versions, acceptance and exact gates.
- Maintains claims and requirement statuses.
- Reviews source code, callers, tests, external side effects and actual artifacts rather than relying on summaries.
- Owns merging, full regression, desktop GUI/E2E and release claims.
- Resolves routine implementation decisions using these docs/ADRs without asking the chat architect. Only genuinely blocking product/security/legal uncertainties need escalation; independent lanes continue.

### Worker 1 — desktop shell / host / product identity

Owns the desktop host and its assigned shell/UI paths. Reviews Electron security, profile/data root, packaging identity, window/navigation/menus and GUI acceptance. Does not change canonical domain models or shared root configuration without TL2 approval.

### Worker 2 — contracts / domain / local persistence

Owns WebFlix public contracts once TL2 freezes them, domain/application/local-library paths, local schema/migrations and associated tests. Does not edit desktop main/preload files or provider connector implementation owned by another lane.

### Worker 3 — connector registry / catalog / playback / downloads

Owns catalog/connectors/playback/engine adapter paths specifically assigned by TL2. Integrates only through public contracts. Does not edit shared contracts independently or desktop identity/config files.

The file ownership map is a starting point. TL2 may assign narrower paths to prevent contention; every work order names exact paths and forbidden paths.

## Concurrent-work method

1. **Claim before dispatch.** Add a row to work-claims.md with lane ID, owner, base SHA, scope, allowed paths, forbidden/shared paths, dependencies, output artifacts, acceptance commands and status.
2. **Parallel discovery first.** During Phase 0, the three workers perform independent read-only audits at the same pinned base SHA. They do not edit the same architecture/config files.
3. **Contract freeze.** TL2 reconciles the audits and locks contract shapes, package roots and data ownership. Contract changes during implementation require TL2 decision, versioning, changelog and impact notes.
4. **Disjoint implementation.** Each worker operates on a dedicated branch and named path set. Independent tests and docs can proceed concurrently. Never use concurrent agents to edit the same file or shared global configuration.
5. **Small relay bundle.** Every lane delivers branch/commit SHA, changed files, rationale, tests, acceptance evidence, screenshots/logs where relevant and known limits. No secrets or private media in evidence.
6. **Serial integration.** TL2 checks branch base/claims, inspects code/tests/callers, runs changed-file lint/typecheck/architecture gates, integrates branches, then executes the complete regression suite and desktop acceptance on the exact merged SHA.
7. **Update state.** Merge status, requirement status, evidence and next dependency are changed in the repo. A worker status message does not complete work.

## Shared-file owners

TL2 exclusively owns: AGENTS.md, README/product index, architecture locks/ADRs, architecture-policy.yaml, root package.json, pnpm-workspace.yaml, global CI/workflows, app/release identity decision, shared public-contract decision log and work-claim ledger.

Workers may submit proposed changes to those files as a patch, but cannot merge competing edits. Contract package implementation may be delegated only after the API shape is locked.

## Work order minimum fields

- Work ID and requirement IDs.
- Objective and explicit non-goals.
- Base SHA and prerequisite commit/contract version.
- Owned paths and forbidden paths.
- Public interfaces read/written and event/state ownership.
- Parallel dependencies/merge order.
- Acceptance criteria, failure cases and expected artifacts.
- Exact commands to execute; whether tests are fixture-only or real provider/GUI tests.
- Security/privacy/policy restrictions.
- Required docs/status/evidence updates.
- Definition of done and escalation condition.

Use work-order-template.md.

## Evidence rules

- Every claimed command lists command line, environment class (unit/fixture/live/desktop/package), exit status and actual pass/fail totals.
- Provider verification names the source, region/account mode where applicable, test date and tested operations; do not put credentials in the repo.
- GUI evidence lists OS, display/scale assumptions, artifact/build ID, route/workflow and observed outcome.
- A fixture/mocked test proves only its stated contract behavior, not a live external capability.
- A Vercel/CI status is not desktop acceptance.
- Do not inflate completion by counting source files or mock UI.
- Record pre-existing failures separately; do not label them newly introduced or pretend they passed.

## Integration and conflict policy

- One branch per lane and one active owner per path.
- Do not cherry-pick/merge a worker branch before its handoff is inspectable.
- If upstream/main moves, rebase or merge only after comparing the current base and documenting conflict risks; never silently replace unreviewed work.
- If a conflict touches contracts/security/architecture policy, TL2 resolves it.
- If a work order is blocked, mark the dependency and continue independent work; do not create a fake implementation to unblock UI.
- Use small commits with meaningful subjects. Run architecture check with changed-file mode before push and again after integration.
- Keep test artifacts and logs sanitized.

## Completion status vocabulary

Unclaimed → claimed → implementing → delivered → reviewed → merged → accepted.

- Delivered: worker says files/tests/evidence are ready.
- Reviewed: TL2 inspected implementation, callers, tests and scope.
- Merged: exact commit is in the integration branch.
- Accepted: full gates and relevant desktop/provider acceptance passed on merged commit.
