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

### Audit C — Worker 3: YouTube-first account interface, provider policies and media engines

Scope: inherited provider/model runtime, web/server playback/browser adapters, current WebFlix 2.0 integration/reference repo and target provider/engine landscape.

Deliver:
- A YouTube capability-by-capability inventory: browse/search, metadata, official playback, account auth, subscriptions/history/playlists/comments/likes/creator surfaces where supported, and actions not supported by official interfaces.
- Per-user OAuth/session/account ownership plan. Identify why the old operator-cookie/CDP broker is not reusable as a multi-user identity.
- Current official YouTube policies/terms mapped to the desired interface, including independent value, playback/advertising behavior, API-data constraints and restricted access patterns; identify questions requiring compliance guidance.
- Candidate next social platforms ranked by user value, supported capabilities, auth, region, pricing/quota and policy.
- Torrent engine candidate/license/maintenance/security investigation, plus candidate media metadata/probe/ASR/translation/TTS/overview engines and ad-transparency source access constraints.
- Provider policy rows with official source links, open questions and required smoke tests.
- No credentials, operator cookies, or real private media in report artifacts.

Do not implement provider integration during Phase 0.

### TL2 during Phase 0

- Recheck fork and upstream current HEAD, pin actual base SHA.
- Reconcile the three audit reports against the binding documents.
- Lock package roots, contract ownership, dependency direction and first vertical-slice requirements.
- Add new WebFlix modules to architecture-policy.yaml as source roots are created; set managed=true with owner/public entrypoint/dependency/layer rules.
- Define the exact test/build commands that exist in the actual repository and add missing first-class acceptance scripts.
- Resolve contradictory findings in ADRs. Keep unknowns explicit and continue independent work.

## Phase 1 — YouTube-first desktop vertical slice (parallel after contract freeze)

### Lane D1 — Worker 1: WebFlix desktop shell and product identity

Owns packages/desktop plus a specifically assigned WebFlix UI shell subtree. TL2 owns shared root/config files.

Deliver: separate development data root; verified WebFlix product strings and desktop identity; navigation shell; YouTube-oriented home/search/watch shell; connected-account surfaces; loading/empty/error/offline states; accessible controls; packaging identity tests; actual desktop GUI smoke. Product UI must visibly distinguish WebFlix from YouTube and leave room for the independent value required by current policy.

### Lane D2 — Worker 2: contracts/domain/local persistence

Owns packages/webflix-contracts, packages/webflix-domain, packages/webflix-application and packages/local-library; any new schema files in explicitly assigned product roots. TL2 owns architecture policy/root workspace and cross-lane public contract decisions.

Deliver: validated canonical catalog/provider-account/local-library/playback/progress/collection contracts; migration-backed local store; path-safe file/folder indexing; local library and collection CRUD; user/profile-scoped provider identity/credential-port contracts; resume/watch state; backup/restore behavior; hermetic tests.

### Lane D3 — Worker 3: connector registry and first YouTube integration

Owns packages/catalog, packages/connectors and packages/playback plus the assigned YouTube adapter path. TL2 owns shared public contracts and architecture policy.

Deliver: manifest registry, per-operation capability statuses, typed playback-plan contract, per-user YouTube authorization through a reviewed supported flow, the first real YouTube browse/search/watch path using official APIs/player where required, honest auth/unsupported states, policy evidence, and contract tests plus actual YouTube desktop smoke. Worker 2's local-library vertical slice remains the local/offline baseline; D3 does not edit Worker 2's owned persistence files.

### TL2 integration and quality gate

- Finalize shared contracts before implementation lanes start; workers do not redefine them independently.
- Keep shared UI changes assigned to one worker at a time.
- Review each branch against baseline SHA and path ownership.
- Merge only after changed-file gates and the complete regression suite pass.
- Run real desktop acceptance on the merged build; package a distributable and record artifact/test evidence.
- Keep requirements matrix status honest; feature code or fixture tests alone do not imply external-source verification.

## Phase 2 — expand the YouTube interface and close the first platform gap list

Fill the highest-value YouTube browse/watch/account paths that are both technically available and allowed by source policy. Keep a per-operation parity matrix; inaccessible actions stay honest and may require user handoff to the official YouTube application/site. Obtain compliance review/audit when the intended API-client experience is uncertain. Do not use scraping/private endpoint/cookie-replay as an undocumented gap filler.

## Phase 3 — next social-platform interfaces

Select the next platform by current supported API/embedding/browser operations, user value, authorization UX, coverage, quota/cost and restrictions. Reuse the same connector, account isolation, capability, playback and evidence contracts across Instagram, TikTok, X, Snapchat and future sources. Only then expand into wider social discovery, creator surfaces, streaming-service handoffs and legal torrent/local-media capabilities.

## Phase 4 — recommendations and media intelligence

Add built-in ranking, user objectives, feedback, explainability, experiment/evaluation loop, user-selected model/ranker adapters, transcripts, summaries, audio/video overviews, translation, dubbing/TTS and Q&A. Use cancellable jobs and original/derived artifact separation.

## Phase 5 — Ad Center

Add supported transparency libraries, advertiser identity, claim extraction, evidence graph, independent review signals, offer verification and explainable qualification. Never promise global ad coverage; keep Ad Center separate from organic recommendations.

## Phase 6 — web and mobile clients

Reuse contracts and application use cases after desktop boundaries are stable. Do not block first desktop acceptance on future clients.

## Critical path

Actual WebFlix desktop identity → YouTube policy/capability audit → per-user account and playback contracts → local persistence + first YouTube browse/search/watch path in parallel → restart/resume and account isolation → packaged desktop acceptance → expanded YouTube capability matrix → next social-platform selection. Everything not on this path may proceed in parallel only when ownership and dependencies are explicit.