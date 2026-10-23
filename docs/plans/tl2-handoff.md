# TL2 final implementation handoff

Audience: new technical lead TL2. This document plus the linked architecture/requirements/testing files is the complete handoff. No access to the conversation is required or expected.

## Mandate

Implement WebFlix Desktop from the ZCode fork as a desktop-first Universal Entertainment OS. The first platform goal is a useful, policy-reviewed alternative interface to YouTube using each user's own authorized YouTube account; once that integration is proven, generalize to become a primary interface for other major social platforms. Make this repository the only source of truth. Deliver a real, testable desktop product using TL2 plus three parallel workers. Do not assume this architecture is implemented merely because the docs exist.

Read in order:

1. ../architecture/architecture-lock.md
2. ../architecture/upstream-baseline.md
3. ../architecture/capability-registry.md
4. ../architecture/data-ownership.md
5. ../architecture/security-boundaries.md
6. ../architecture/provider-policy-matrix.md
7. ../adr/0001-webflix-product-boundaries.md
8. ../adr/0002-provider-capabilities-and-playback.md
9. ../adr/0003-youtube-first-per-user-identity.md
10. ../product/requirements-matrix.md
11. desktop-roadmap.md
12. worker-protocol.md
13. work-claims.md
14. ../testing/desktop-acceptance.md
15. ../operations/local-development.md

## Starting baseline

Repository: https://github.com/payswapdotorg/WebFlix-Desktop
Upstream: https://github.com/zai-org/ZCode
Existing WebFlix reference: https://github.com/payswapdotorg/WebFlix-2.0

The inspected initial commit was 29628c9acdb81b703bbd4080c207a0e7ce5e276e, also observed on upstream during setup. Verify actual branch/remote/HEAD before work and update upstream-baseline.md and work-claims.md if needed. Do not assume external deployment or feature claims imply the fork is configured safely.

## Execute in this order

## Priority product UX order (added 2026-10-23)

The next visible-product goal is to make the desktop experience media-first and WebFlix-native, while preserving ZCode's agent, model-provider and long-running task capabilities. Read and execute `docs/plans/work-orders/WFX-DESKTOP-WEBFLIX-UX-1.md` as the dedicated source-of-truth work order. It is based on source review of both this desktop fork and the current WebFlix 2.0 reference; it defines the code landmarks, safe OAuth/media boundaries, TL + three-worker ownership, agent-to-UI action contract, and actual Electron GUI acceptance.

Before dispatch, refresh both repo SHAs and reconcile `docs/plans/work-claims.md`. Do not overwrite or double-claim ongoing work. Treat the web app as a behavioral/visual reference, not a Next.js site to wrap or a backend to trust blindly. Merge only after real desktop GUI evidence; report live OAuth or source tests as BLOCKED when credentials or authorization are absent.


### A. Verify repository and baseline

- Confirm current origin, upstream remote, default branch, HEAD and ancestry.
- Verify the fork includes the intended ZCode source state.
- Read existing AGENTS.md and architecture-policy.yaml, run workspace freshness check, dependency/architecture reports, lint/typecheck and relevant baseline tests. Record exact outcomes and pre-existing failures.
- Inventory root package scripts and existing desktop GUI/E2E mechanisms. Do not invent test commands; add/maintain real scripts when a new acceptance capability is needed.
- Audit app identity, IPC/security, credentials, data root, telemetry, updater, external service origins and licensing.
- Do not modify provider behavior or rewrite broad upstream modules during this audit.

### B. Complete the three independent audits

Assign the Phase 0 rows in work-claims.md to workers 1–3 simultaneously. They are read-only, share the same pinned base SHA and produce source-backed reports. The TL consolidates them; no waiting for chat architect.

### C. Freeze architecture and contracts

- Resolve audit findings using the locked decisions and focused ADRs.
- Lock package roots, public entrypoints, domain ownership, event/command semantics, failure vocabulary and versioning before dependent code work.
- TL2 owns root package/workspace/config and architecture-policy changes.
- For each module root created, make it a managed architecture module with owner, dependencies, public entrypoints and layers. Keep no-cycle/no-deep-import policy active.
- Define canonical catalog, provider asset, connector manifest/capability status, playback plan/failure, local library/progress/collection and background-job contracts. Add schemas and contract tests before parallel implementation.
- Record a contract-freeze SHA and update Phase 1 claims.

### D. Implement Phase 1 in parallel

Dispatch D1-SHELL, D2-LOCAL and D3-YOUTUBE as disjoint lanes per desktop-roadmap.md.

- Worker 1: distinct WebFlix identity, secure Electron shell, navigation and YouTube-oriented product shell.
- Worker 2: canonical product contracts/domain/application, provider account ownership/credential ports and migration-backed local library/progress.
- Worker 3: connector/capability registry and the first real per-user YouTube authorization, browse/search/watch and supported account-operation path. Use the official API/player or another explicitly reviewed authorized path; keep unsupported operations honest.
- Worker 2's local media path remains the local/offline baseline. Worker 3 does not edit Worker 2's persistence files.
- No worker edits shared root/policy/contracts without TL2 coordination. Keep public interfaces stable after freeze.

### E. Integrate and prove the YouTube-first vertical slice

The first release candidate must launch the actual packaged Electron desktop app with WebFlix identity; connect the test user's own YouTube account through a reviewed supported authorization path; browse/search real YouTube results; open and play selected content through the appropriate official playback path; exercise the first supported account operation(s); and demonstrate that all authorization and state belong to that test user. In parallel, the local-first baseline must import/open/play local media, save library/collection and progress, restart/resume, work without login/cloud and handle offline/missing/unsupported cases. Preserve required player/advertising behavior and WebFlix's independent value. If a desired operation is not supported/allowed, document the limitation instead of inventing access.

Run exact lint/typecheck/format/architecture/build/test commands, relevant desktop GUI/E2E tests and target-platform packaging/smoke. Fix issues as part of the implementation wave, not after user testing is requested.

### F. Expand the product in dependency order

After the YouTube-first slice is accepted: close the highest-value supported YouTube capability gaps; integrate the next social platforms using the same per-user account and connector contracts; then expand unified multi-source catalog/queues, user-authorized torrent functionality, recommendation objectives and learning/evaluation, replaceable media-intelligence jobs, Ad Center transparency search and evidence-based qualification, optional cloud sync, and future web/mobile clients.

Do not block the core product on broad third-party coverage. Never claim a provider action is supported until the policy matrix, contract tests, actual source smoke and user-visible limitation are in place.

## Scope and product requirements

The product must preserve all of these as goals without faking present implementation:

- public viewing without WebFlix login when source policy allows;
- long/short videos, live, podcasts and creator media;
- local-first library, playlists, progress and playback;
- a YouTube-first interface for each user's own authorized YouTube account, followed by primary interfaces for more major social platforms;
- torrent-first-class discovery/download/streaming for user-authorized content;
- cross-provider search with coverage and source-specific playback plans;
- built-in recommendation baseline, selectable model/ranker, user objectives, friend recommendations, retention controls and explainability;
- summaries, audio/video overviews, captions, translation, dubbing/TTS and Q&A through replaceable jobs;
- Ad Center across supported ad-transparency libraries with advertiser identity, claims, offer verification and independent review evidence;
- platform-neutral application contracts for future web/mobile clients.

## Critical constraints

- Do not wrap the old Next.js app in Electron.
- Treat YouTube as the first platform integration and use each end user's own authorization; do not share the old operator YouTube session among users.
- Do not promise full YouTube parity until the per-operation API/player/browser capability and policy matrix supports it.
- Current YouTube API policies require significant independent value when mimicking native YouTube UX and restrict changes/removal of required player behavior and ads. Check https://developers.google.com/youtube/terms/developer-policies-guide and https://developers.google.com/youtube/terms/api-services-terms-of-service; seek compliance guidance if needed.
- Do not use undocumented scraping/private endpoints/cookie replay as silent fallbacks for unsupported capabilities.
- Do not assume all streaming platforms allow in-app playback or raw streams.
- Do not treat OpenRTB as a searchable inventory of every ad.
- Do not claim ad qualification truth without source-backed evidence; unknown is not false.
- Do not add hidden tracking, passive ad observation or cross-source linking without separate opt-in consent.
- Do not expose unrestricted IPC/filesystem/process access or move provider cookies into renderer storage.
- Do not require cloud/account for local file playback.
- Preserve upstream and third-party license notices.
- Do not widen architecture baselines just to make checks green.
- Do not claim testing that was not actually executed.

## Parallelism and quality

Use work-claims.md as a concurrency lock. One owner per path, one branch per lane, source-backed handoff packet, contract freeze, serial integration, full acceptance on the exact merge SHA. Workers can independently investigate or build code only after dependencies/contracts are stable. TL2 is the decision and merge authority; there is no routine need to consult this conversation.

## Current continuation priority — Ubuntu desktop

The product owner has explicitly directed TL2 to get a downloadable Ubuntu build ready, and has specified that the visible UI must be WebFlix, not ZCode. This is the immediate continuation after the already-ordered Phase-8 secure-vault work; do not treat the earlier Phase-1 implementation roadmap as evidence that packaging/product UI is already complete.

- Source of truth: `docs/plans/work-orders/P9-UBUNTU-WEBFLIX-1.md`; concurrency lock: `docs/plans/work-claims.md`.
- `P8-VAULT-1` is currently assigned to the D1/Worker-1 lane and remains the hard dependency for final real per-user account connection. Do not double-book Worker 1: run P8-VAULT-1 there; dispatch Worker 2 to `P9-LINUX-1` (Ubuntu 24.04 x86_64 `.deb` + AppImage CI/artifacts) and Worker 3 to `P9-QA-1` (packaged-smoke harness/evidence preparation) in parallel on the permitted disjoint paths. Start `P9-UI-1` with Worker 1 as soon as the vault work has merged/released that lane; the UI order and claim are already queued. Account IPC composition and final release-candidate acceptance must wait until the vault merge.
- TL2 owns integration, exact-SHA regression gates and merge decisions. If the real worker assignment differs, refresh `docs/plans/work-claims.md` first and maintain one active owner per path; never skip or silently reassign a claim.
- Do not mark the app ready because docs/tests/dev mode are green. The package must launch from the packaged Ubuntu artifact, present WebFlix branding throughout, exercise real local-media/UI pathways, and preserve ZCode's separate identity/behavior.
- Current observed blocker evidence: there were no GitHub releases/assets or Actions workflow runs; the renderer HTML still used a ZCode title/startup mark and the desktop renderer still booted the inherited ZCode root. The new work order contains the detailed requirements and evidence checklist.
- Provide the operator a direct link to the downloadable workflow artifact plus install/launch instructions. Do not publish a public production release or enable a WebFlix updater feed using the still-proposed identity metadata/feed.

## Completion report

When Phase 1 is accepted, commit an evidence-backed status update naming:

- exact merged main SHA and upstream base;
- files/modules and requirement IDs delivered;
- architecture policy results;
- lint, typecheck, format, build and tests with exact commands, exit codes and totals;
- desktop E2E/GUI flows, OS and packaging artifact;
- any actual provider smoke test and its source/region/account scope;
- remaining failure modes, blocked requirements and next lane owners.

Update README links only if the authoritative docs move. The implementation repository and this handoff must remain sufficient for any subsequent TL to continue.

## WFX wave completion record (2026-10-23 — WFX-DESKTOP-WEBFLIX-UX-1 / GitHub issue #3)

The media-first transformation landed as five ledger lanes (freeze + three
workers + TL2 integration), all closed in `docs/plans/work-claims.md`:

- Freeze e1dd80f — contracts 0.14.0 (`ui-actions.ts` + `media-views.ts`) + freeze §9.
- WFX-UX-SHELL-1 c95de42 — the media-first shell (sidebar/top chrome/every
  surface/persistent watch dock/agent-panel slot).
- WFX-PROVIDER-SLICE-1 8e31071 — the official Data-API producers +
  ChannelResolutionPort + policy-matrix rows.
- WFX-AGENT-BRIDGE-1 9f45149 — the agent runtime admission + AgentPanel +
  the typed UI-action bridge + the webflix_ui MCP tool.
- WFX-INTEGRATE-1 6e25669/9383f35/a3f3d29 — the integrated host + the GUI
  journey (17 PASS / 0 FAIL / 3 honest BLOCKED) + the parity/evidence matrix
  (`docs/testing/wfx-parity-evidence.md` — the wave's authoritative status,
  including the BLOCKED gates and the F2 dev-path follow-up).

Standing BLOCKED gates (honest, with unblock steps): the live MrBeast
journey needs the operator's official Data API key (`WEBFLIX_YOUTUBE_API_KEY`
env or `<dataRoot>/youtube-api-key` — zero code changes once provisioned);
the packaged-tier chat-surface mount + live provider round-trips need the
packaging run (the P9 workflow) + provider credentials. Native desktop
YouTube OAuth remains BLOCKED on the operator-provisioned client (AS-Q3).

Next continuation candidates: the operator provisions the key → the live
journey gate; the packaging workflow re-run with the WFX GUI tier; the F2
dev-path CLI-home follow-up; the durable local-library/history bridge.
