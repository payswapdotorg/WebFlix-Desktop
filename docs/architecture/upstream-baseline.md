# Upstream baseline and reuse policy

## Pinned baseline

- Product repository: payswapdotorg/WebFlix-Desktop.
- Upstream: https://github.com/zai-org/ZCode.
- Baseline commit observed at initial lock: 29628c9acdb81b703bbd4080c207a0e7ce5e276e.
- The same commit was observed on the fork main during setup.
- Reviewed upstream metadata reports ZCode 3.14.3, Node >=24, pnpm 10.33.2 and Electron 41.0.3 for packages/desktop at that source state.
- Before code changes, TL2 must fetch current upstream and fork main. If main moved, record the actual checked-out HEAD here and in the first work claim.

## Reusable substrate inventory

| Area | Initial disposition | Required review |
|---|---|---|
| Electron main/preload/window lifecycle | Retain and adapt | App identity, permissions, protocol schemes, IPC trust, updater/signing settings |
| packages/shared and packages/rpc | Reuse where appropriate | Keep messages typed/versioned; avoid leaking product concepts into public WebFlix APIs |
| packages/ui | Reuse selectively | Product shell, visual identity, accessibility, licensing/assets |
| packages/services | Reuse infrastructure, not as a catch-all | Owners, persistence, credentials, logs and runtime side effects |
| Provider/model infrastructure | Adapt behind WebFlix ports | Separate inference provider from recommendation/media policy |
| Web client/server | Optional; audit dependencies | No assumption that old Next.js WebFlix is a desktop runtime dependency |
| apps/zcode-cli and agent runtime | Optional, reviewed reuse | Review permissions, telemetry and fit; coding-agent workflows are not default media UX |
| Architecture checker | Retain and strengthen | Add managed product modules and changed-file checks |
| Existing storage infrastructure | Evaluate behind a port | Verify migrations, durability, data paths, privacy and profile isolation |

## Reuse rules

1. Prefer small adapters around proven primitives instead of copying whole subsystems.
2. Preserve upstream remotes/history and all license/notice files.
3. Do not mass-rename internal @zcode imports as a branding sweep; plan renames with caller/dependency/test evidence.
4. Before distributing, inventory application names, bundle IDs, Windows AppUserModelId, protocol schemes, updater feed, installer identity, user-data root, logs, telemetry destinations, service origins and feature flags. None may accidentally point to the ZCode identity/configuration.
5. Create a WebFlix development data root isolated from any installed ZCode profile. Never import ZCode sessions or credentials automatically.
6. Review LICENSE, NOTICE.md and THIRD-PARTY-NOTICES.md. First-party Apache-2.0 does not replace third-party notices or grant rights to provider media/assets.
7. Inherited behavior is not automatically WebFlix functionality. Mark it audit-pending until source, UX, identity and acceptance are verified.
8. Upstream updates require a selected commit, diff inspection, inherited and WebFlix test run, conflict notes and an update to this file.

## Baseline audit deliverable

TL2 records each retained subsystem with exact source paths, callers, behavior, external effects, data/credential boundaries, tests run, disposition (retain/adapt/isolate/remove), owner and follow-up. This is a source-backed audit, not a prose-only summary.