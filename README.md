# WebFlix Desktop

**WebFlix is a desktop-first Universal Entertainment OS.** This repository is the authoritative source of truth for its product requirements, architecture, contracts, implementation plan, tests, security boundaries and release evidence.

WebFlix is built from the desktop/application substrate in [zai-org/ZCode](https://github.com/zai-org/ZCode). The initial platform goal is to make WebFlix a meaningful alternative interface to YouTube using each user's own authorized YouTube account where supported. After that first integration is proven, generalize the connector and account model to become a primary interface for more major social platforms. The existing [WebFlix 2.0 web app](https://github.com/payswapdotorg/WebFlix-2.0) is a behavioral and integration reference, not a runtime dependency or a shared-account backend.

## Product direction

**Delivery order:** (1) a source-reviewed, per-user YouTube interface; (2) the next major social platforms selected by capability, user value and integration feasibility; (3) the wider entertainment OS capabilities. The architecture remains provider-neutral so the YouTube-first implementation does not become a hard-coded single-provider domain.

- One catalog and federated search across supported media providers.
- Long-form video, shorts, livestreams, podcasts and creator content.
- First-class local media and authorized torrent discovery, downloads and playback.
- Source-aware playlists, queues, collections, progress and personal library.
- Recommendation systems with a built-in baseline, selectable models/rankers, friend recommendations, explainability, feedback and user-controlled objectives.
- Interchangeable media-intelligence engines for transcription, summaries, audio/video overviews, translation, subtitles, dubbing and text-to-speech.
- An Ad Center that queries supported ad-transparency sources and evaluates claims, offers, advertiser identity and independent reviews with evidence and uncertainty displayed.
- A desktop-first experience with platform-neutral domain contracts for future web/mobile clients.

These are target capabilities, not claims that each integration is already working. The requirements matrix and evidence ledger are the status authority.

YouTube integration must use each user's own authorization and preserve the standard playback/advertising experience required by the applicable YouTube terms. The goal is broad useful interface coverage, but API access does not authorize a feature-for-feature clone by itself: WebFlix must provide sufficient independent value, clearly distinguish platform data, and verify each operation against current policy. See the [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies-guide) and record the integration decision in the provider policy matrix.

## Repository source of truth

1. [TL2 implementation handoff](docs/plans/tl2-handoff.md)
2. [Architecture lock](docs/architecture/architecture-lock.md)
3. [Desktop roadmap and workstreams](docs/plans/desktop-roadmap.md)
4. [Requirements and status matrix](docs/product/requirements-matrix.md)
5. [Desktop acceptance criteria](docs/testing/desktop-acceptance.md)
6. [Worker protocol](docs/plans/worker-protocol.md) and [claim ledger](docs/plans/work-claims.md)
7. [Upstream baseline and reuse policy](docs/architecture/upstream-baseline.md)
8. [YouTube-first per-user strategy ADR](docs/adr/0003-youtube-first-per-user-identity.md)
9. [Provider policy matrix](docs/architecture/provider-policy-matrix.md)

When a document, issue comment, external chat or worker summary conflicts with the checked-in requirements and decisions, follow the repository. Record changes as a reviewed ADR/documentation change; do not silently drift.

## Inherited substrate

The baseline observed during setup is ZCode commit 29628c9acdb81b703bbd4080c207a0e7ce5e276e, present in both upstream and this fork during review. Reconfirm actual HEAD before implementation and keep it recorded in [upstream-baseline.md](docs/architecture/upstream-baseline.md).

The inherited monorepo includes Electron desktop host, shared React UI, platform contracts/RPC, services, model providers, web client/server and agent runtime. These are substrate capabilities, not evidence that WebFlix product features are implemented.

## Development entry points

Use the toolchain pinned in mise.toml and package.json:

- Install/bootstrap: **pnpm bootstrap**
- Desktop development: **pnpm dev:desktop:test**
- Lint: **pnpm lint**
- Typecheck: **pnpm typecheck**
- Format check: **pnpm fmt:check**
- Pre-push checks: **pnpm verify:pre-push**
- Architecture report: **pnpm architecture:report**
- Desktop bundle options: **pnpm bundle:desktop -- --help**

Read [local development](docs/operations/local-development.md) before running production-configured commands. Do not use production provider accounts or data for fixture tests. Only report commands that were actually run.

## Definition of done

A feature needs a real contract, implementation, tests and visible supported/unsupported states. The actual Electron app must be launched and exercised in GUI/E2E tests; browser-only component tests are insufficient. Release claims must name the commit SHA, gates, test results, artifact and remaining limitations. See [acceptance criteria](docs/testing/desktop-acceptance.md).

## Licensing and upstream preservation

This repository retains upstream history and third-party notices. Review LICENSE, NOTICE.md and THIRD-PARTY-NOTICES.md before modifying or distributing inherited components. The upstream Apache-2.0 license does not automatically license third-party services, media, branding, assets or protected content.
