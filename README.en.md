# WebFlix Desktop

WebFlix is a desktop-first Universal Entertainment OS. This English README intentionally mirrors the root README so the GitHub English README entry remains product-aligned; the repository docs linked below are authoritative.

WebFlix is built on the desktop/application substrate of [zai-org/ZCode](https://github.com/zai-org/ZCode). Its first platform goal is a meaningful alternative interface to YouTube using each user's own authorized YouTube account where supported. Once that integration is proven, the same provider/account architecture expands to other major social platforms. [WebFlix 2.0](https://github.com/payswapdotorg/WebFlix-2.0) remains a behavioral/integration reference, not a runtime dependency or shared-account backend.

## Product direction

**Delivery order:** (1) a source-reviewed, per-user YouTube interface; (2) the next major social platforms selected by capability, user value and feasibility; (3) the wider entertainment OS features. The core domain stays provider-neutral.

- Federated media catalog and search across supported providers.
- Long videos, shorts, livestreams, podcasts and creator content.
- Local media plus authorized torrent discovery, downloads and playback.
- Personal library, progress, queues, playlists and collections.
- Replaceable recommenders/models, user-defined objectives, friend recommendations and explainable feedback loops.
- Swappable transcription, summaries, audio/video overviews, translation, subtitles, dubbing and TTS engines.
- Ad Center for supported transparency-library search and evidence-based advertiser, claim, offer and review assessment.
- Desktop first; platform-neutral contracts for later web/mobile clients.

These are target capabilities, not claims that each integration already works. Use the requirements matrix and evidence ledger to establish status. YouTube-specific access must use each user's own authorization, preserve required player and advertising behavior, and meet the current policy requirement for sufficient independent value; API access alone does not authorize a feature-for-feature clone. See the [YouTube API developer policies](https://developers.google.com/youtube/terms/developer-policies-guide) and provider-policy-matrix.md.

## Authoritative implementation documents

- [TL2 handoff](docs/plans/tl2-handoff.md)
- [Architecture lock](docs/architecture/architecture-lock.md)
- [Upstream baseline](docs/architecture/upstream-baseline.md)
- [Requirements matrix](docs/product/requirements-matrix.md)
- [Roadmap and workstreams](docs/plans/desktop-roadmap.md)
- [Worker protocol](docs/plans/worker-protocol.md)
- [Work claims](docs/plans/work-claims.md)
- [Desktop acceptance](docs/testing/desktop-acceptance.md)

Use the pinned toolchain from mise.toml. Useful root commands include **pnpm bootstrap**, **pnpm dev:desktop:test**, **pnpm lint**, **pnpm typecheck**, **pnpm fmt:check**, **pnpm verify:pre-push** and **pnpm architecture:report**. Read [local development](docs/operations/local-development.md) before starting production-configured processes.

Architecture, contracts, source capabilities, data ownership and verification evidence must live in this repository, not in conversations or worker memory. Preserve upstream licensing and third-party notices.