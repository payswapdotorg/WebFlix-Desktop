# Desktop roadmap and parallel workstreams

Owner: TL2. Status is updated in the repo alongside claims/evidence.
Ordering is dependency-aware; independent lanes should run concurrently when their file ownership does not overlap.

## Phase 0 — audit and architecture lock (parallel, read-only)

These three audits start concurrently after TL2 confirms actual fork HEAD and creates isolated development/test profile instructions.

### Audit A — Worker 1: desktop host, identity and UX substrate

Scope: packages/desktop; relevant app identity, packaging and UI shell files.

Deliver:
- Product identity inventory: app display name, bundle IDs, Windows AppUserModelId, custom protocols/file associations, app data roots, updater feed, signing config, telemetry/analytics, crash reporting, remote origins and feature flags.
- Electron trust-boundary inventory: BrowserWindow/webContents construction, preload exposure, IPC registration/validation, remote browser/WebContents/session configuration, navigation/permissions/download paths.
- Shell/navigation/theme/accessibility/layout inventory and current GUI/E2E capabilities.
- Commands actually run for lint/typecheck/build/launch/E2E; exact baseline SHA and outcomes.
- Retain/adapt/isolate/remove recommendations with source paths and tests.

Do not make concurrent edits during Phase 0.

### Audit B — Worker 2: contracts, persistence and local-library foundation

Scope: packages/shared, packages/rpc, packages/services storage/database paths and schema/migration/test infrastructure.

Deliver:
- Existing storage implementations and their actual use sites, transaction/migration/backup/recovery behavior, data-root selection and test isolation.
- Current platform contract and public-entrypoint patterns.
- Credential storage/secrets/logging and profile boundaries.
- Recommended smallest viable local store and the data ownership map for local library/progress/collections/jobs.
- Contract and package ownership proposal aligned to architecture-lock.md.
- Source-backed findings and tests actually run.

Do not modify shared contracts or schema during Phase 0.

### Audit C — Worker 3: providers, playback, torrents and media intelligence

Scope: inherited provider/model runtime, web/server playback/browser adapters, current WebFlix 2.0 integration/reference repo and target engine landscape.

Deliver:
- Existing source/provider APIs, playback plan feasibility, official embed/deep-link options and source-specific limitations.
- Torrent engine candidate/license/maintenance/security investigation; avoid selecting a permanent engine before contract/packaging review.
- Candidate media metadata/probe/ASR/translation/TTS/overview engines with licenses and OS packaging constraints.
- Ad-transparency source candidate capabilities and access/coverage constraints; no assumption of a global catalog.
- Provider policy rows with official sources, open questions and required smoke tests.
- No credentials, operator cookies, or real private media in report artifacts.

Do not implement provider integration during Phase 0.

### TL2 during Phase 0

- Recheck fork and upstream current HEAD, pin actual base SHA.
- Reconcile the three audit reports against the binding documents.
- Lock package roots, contract ownership, dependency direction and first vertical-slice requirements.
- Add new WebFlix modules to architecture-policy.yaml as source roots are created; set managed=true with owner/public entrypoint/dependency/layer rules.
- Define the exact test/build commands that exist in the actual repository and add missing first-class acceptance scripts.
- Resolve contradictory findings in ADRs. Keep unknowns explicit and continue independent work.

## Phase 1 — first real desktop vertical slice (parallel after contract freeze)

### Lane D1 — Worker 1: WebFlix desktop shell and product identity

Owns packages/desktop plus a specifically assigned WebFlix UI shell subtree. TL2 owns shared root/config files.

Deliver: separate development data root; verified WebFlix product strings and desktop identity; navigation shell; local library/watch surface frame; loading/empty/error/offline states; accessible controls; packaging identity tests; actual desktop GUI smoke.

### Lane D2 — Worker 2: contracts/domain/local persistence

Owns packages/webflix-contracts, packages/webflix-domain, packages/webflix-application and packages/local-library; any new schema files in explicitly assigned product roots. TL2 owns architecture policy/root workspace and cross-lane public contract decisions.

Deliver: validated canonical catalog/local-library/playback/progress/collection contracts; migration-backed local store; path-safe file/folder indexing; local library and collection CRUD; resume/watch state; backup/restore behavior; hermetic tests.

### Lane D3 — Worker 3: connector registry and local playback adapter

Owns packages/catalog, packages/connectors and packages/playback; the first local-media adapter may live in the specific path TL2 assigns after package mapping. TL2 owns shared public contracts and architecture policy.

Deliver: manifest registry, per-operation capability statuses, typed playback-plan contract usage, real local file connector/player path, source/engine status and errors, contract tests plus actual local playback E2E.

### TL2 integration and quality gate

- Finalize shared contracts before implementation lanes start; workers do not redefine them independently.
- Keep shared UI changes assigned to one worker at a time.
- Review each branch against baseline SHA and path ownership.
- Merge only after changed-file gates and the complete regression suite pass.
- Run real desktop acceptance on the merged build; package a distributable and record artifact/test evidence.
- Keep requirements matrix status honest; feature code or fixture tests alone do not imply external-source verification.

## Phase 2 — first external source

Add one supported external source behind the connector contract, with capability/policy review, account isolation where needed, source provenance, quota/timeout handling, source smoke test and GUI acceptance. Choose the first provider from evidence and feasibility—not from assumed universal access.

## Phase 3 — multi-source media OS

Add approved social/creator sources, official streaming-service browser/deep-link surfaces, torrent metadata/download/local playback, unified playlists/queue and source coverage UX. Each provider is a separate claim and integration gate.

## Phase 4 — recommendations and media intelligence

Add built-in ranking, user objectives, feedback, explainability, experiment/evaluation loop, user-selected model/ranker adapters, transcripts, summaries, audio/video overviews, translation, dubbing/TTS and Q&A. Use cancellable jobs and original/derived artifact separation.

## Phase 5 — Ad Center

Add supported transparency libraries, advertiser identity, claim extraction, evidence graph, independent review signals, offer verification and explainable qualification. Never promise global ad coverage; keep Ad Center separate from organic recommendations.

## Phase 6 — web and mobile clients

Reuse contracts and application use cases after desktop boundaries are stable. Do not block first desktop acceptance on future clients.

## Critical path

Actual WebFlix desktop identity → contract freeze → local persistence/catalog → real local playback → restart/resume → packaged desktop acceptance → first reviewed external connector. Everything not on this path may proceed in parallel only when ownership and dependencies are explicit.