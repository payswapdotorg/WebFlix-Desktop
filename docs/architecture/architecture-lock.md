# WebFlix Desktop architecture lock

Status: Binding for new WebFlix code. Changes require a reviewed ADR or explicit update to this lock.
Owner: TL2.

## 1. Product definition

WebFlix is a desktop-first Universal Entertainment OS for discovering, playing, organizing, understanding, transforming and evaluating media across supported sources. The product rollout is YouTube-first: make WebFlix a meaningful alternative interface to YouTube for each user's own authorized account, then reuse the proven provider/account architecture to become a primary interface for other major social platforms. The broader product includes long and short videos, live content, podcasts, local files, user-authorized torrent content, source-aware collections, recommendation systems, media-intelligence tools and a separate Ad Center.

Public viewing should not require a WebFlix account where a source permits unauthenticated viewing. A user must connect their own provider account only for capabilities that require authorization. No operator account or cookie jar is shared among users. Future web/mobile clients reuse platform-neutral contracts.

The existing WebFlix 2.0 app is a behavioral and technical reference; its YouTube-specific code is evidence to evaluate, not automatically an approved integration. This fork is the authoritative product repository. Neither the old app's data model nor the ZCode coding-workspace product model is the WebFlix domain model.

**YouTube policy gate:** broad interface coverage is a product goal, not blanket authorization to clone every native surface. Current YouTube API policies require sufficient independent value when an API client mimics YouTube's experience and prohibit diminishing/removing required player behaviors (including required ads), API-data misuse, unauthorized downloading and other restricted behavior. TL2 must document which operations use official APIs, official embeds or another explicitly reviewed/authorized path, request only user-authorized scopes, and obtain compliance review/audit where the use case is uncertain. Do not ship an automated scraping, private-endpoint or cookie-replay workaround merely because a feature is absent from the supported API. See the linked policy sources in §14 and ADR-0003.

## 2. Binding decisions

1. **Product identity:** WebFlix is its own product. Before distribution, isolate inherited ZCode app IDs, protocol schemes, updater channels, telemetry identity and data paths. Internal package names may be migrated incrementally; do not mass-rename them without caller and release evidence.
2. **YouTube-first, provider-neutral:** YouTube is the first integration target and the authority for YouTube-owned account state. The shared domain remains provider-neutral so the same architecture can later support other social platforms.
3. **Local-first:** local library operations, local playback and preferences must work without an account or Internet connection.
4. **Capability truthfulness:** search, metadata, playback, download, captions, comments, account actions and ad-history access are separate capabilities.
5. **Ownership:** each fact has one declared owner. Provider engagement/history remains provider-owned; WebFlix collections, local progress, preferences and derived-artifact metadata are WebFlix-owned unless sync policy says otherwise.
6. **Player truthfulness:** playback returns an explicit PlaybackPlan or typed unavailable/unsupported result; it does not assume every asset has a direct stream URL.
7. **Adapter replacement:** connectors, torrent, playback, search, ranker, ASR, translation, TTS and LLM implementations sit behind explicit versioned interfaces.
8. **Trust boundary:** UI calls validated use cases and narrow platform capabilities. Remote webpages and media metadata never receive privileged IPC or direct filesystem/process access.
9. **Evidence first:** source origin, timestamp, region/coverage, rights/retention assertions and uncertainty are first-class fields wherever relevant.
10. **Independent Ad Center:** ads, observations, claims, offers, reviews and qualification assessments are not VideoDTOs and do not silently enter ordinary recommendations.
11. **Per-user provider identity:** every connected account belongs to the user/profile that authorized it and is isolated from other users. Never port the old WebFlix 2.0 operator-cookie/broker pattern as a shared identity. Use supported OAuth/API mechanisms or separately reviewed authorized user-mediated paths; never save a user's provider password.
12. **Incremental substrate reuse:** reuse ZCode infrastructure when behavior and licensing are understood; do not broadly rewrite upstream before the first working vertical slice.
13. **No dead controls:** a visible control works, is disabled with a reason, or reports a clear unsupported state.
14. **Proof-based completion:** a file, mock, typecheck or green deploy alone does not prove that a provider or desktop workflow works.

## 3. Layered architecture

Dependency direction is inward:

- Clients: navigation, presentation and view state.
- Platform adapters: Electron host, secure IPC, local filesystem, credential vault, media host and isolated external-browser surfaces.
- Application layer: use cases and orchestration.
- Domain layer: canonical entities, ownership, invariants and pure policy.
- Ports/contracts: versioned connector, playback, storage, model, engine and job interfaces.
- Adapters: provider APIs/embeds, local database, file indexing, torrent engines, model providers, cloud storage and optional remote services.

Domain/application packages cannot import Electron, React renderer components, Next.js, provider SDKs or concrete database clients. Connectors do not call each other directly; composition belongs in application services.

## 4. Target package map

Follow workspace conventions, but create explicit product modules. TL2 must lock actual package roots and update architecture policy declarations as each root is introduced.

| Area                             | Responsibility                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| packages/desktop                 | Electron main, preload/IPC, lifecycle, native menus and release identity                 |
| packages/ui                      | Presentation components, themes and accessibility; no domain authority                   |
| packages/shared and packages/rpc | Inherited platform/transport facilities; product payloads remain versioned and validated |
| packages/webflix-contracts       | Public DTOs, schemas, events, capability and port contracts                              |
| packages/webflix-domain          | Canonical entities and ownership/policy rules                                            |
| packages/webflix-application     | Search, playback, library, recommendation, transformation and Ad Center use cases        |
| packages/catalog                 | Canonical identity, provider asset references and provenance                             |
| packages/connectors              | Provider manifests, capability checks, lifecycle and adapters                            |
| packages/playback                | Plan resolution, player lifecycle, queue and resume orchestration                        |
| packages/local-library           | Indexing, collections, local files, progress and metadata                                |
| packages/downloads               | Authorized jobs, pause/resume, verification and destination policy                       |
| packages/media-engines           | Swappable media probing, thumbnails, subtitle and local processing engines               |
| packages/recommendations         | Ranking, feedback, objectives, experiments and explanations                              |
| packages/media-intelligence      | Captions, transcription, summaries, overviews, translation, dubbing/TTS and Q&A          |
| packages/ad-center               | Ad discovery, identity, claims, evidence, reviews, offers and qualification              |
| packages/services                | Reusable host services where appropriate; never a catch-all product domain               |

The exact package creation sequence can be adapted after the baseline audit, but dependency direction and ownership cannot be silently weakened.

## 5. Catalog and identity

A CatalogItem describes media in WebFlix terms. A ProviderAsset is one source-specific representation and owns source IDs, capabilities, URLs/tokens and remote state. One catalog item may map to multiple provider assets, but title similarity alone is insufficient to merge records. Store match evidence and confidence; ambiguous matches stay separate.

Keep availability, authentication, region, media type, rights and last-checked time per source. Federated search returns source coverage and partial failures.

## 6. Playback model

The resolver selects a typed plan: official embed/player; isolated official website/browser; local file/player; source-authorized direct media; user-authorized torrent streaming; external app/deep link; or an explicit unsupported/unavailable result with reason and recovery path.

Do not require the catalog to yield a raw URL. Do not add universal DRM circumvention, signature deciphering or covert extraction. Resume/progress is WebFlix-owned and distinct from provider account history; sending progress to a provider is an explicit connector operation.

## 7. Local-first persistence and cloud

Use a versioned local structured store, with SQLite as the default target unless the audit identifies a demonstrably better inherited store. Include migrations, backup/restore, corruption handling and tests. Separate durable records from disposable caches. Local paths and history are device-scoped by default.

Cloud sync is optional. Introduce it through ports with consent, idempotency, conflict resolution and deletion semantics. Do not upload media bytes/transcripts by default; first check source rights and user authorization.

## 8. Recommendation system

Provide a built-in ranking baseline without external keys and optional user-chosen models/rankers. Keep inference provider separate from ranking policy. Users can tune discovery, enjoyment, learning, novelty, friends, sources and repetition. Do not equate watch time with happiness unless explicitly chosen. Record feedback, experiment versions, inputs and policy/model versions well enough to measure and roll back regressions.

## 9. Media intelligence

Transcription/caption extraction, summaries, audio/video overviews, translation, subtitles, dubbing/TTS and media Q&A are cancellable, retryable jobs over replaceable engines/models. Derived artifacts retain source reference, model/provider, language, creation time, status and rights/retention. Never overwrite originals. Use user-provided local media as a dependable first path when remote capabilities are limited.

## 10. Ad Center

Ad Center searches only sources with confirmed supported/authorized access. Show sources, dates, regions and categories actually queried; never claim global completeness.

Maintain separate AdAsset, AdvertiserIdentity, AdClaim, Offer, EvidenceRecord, ReviewSignal, AdObservation and versioned QualificationAssessment concepts. Classify claims as supported, partly supported, contradicted, unsupported or unable to verify. Unable to verify is not false. Expose evidence, dates, conflict, confidence and gaps. Reviews should account for recency, volume, distributions, independence, duplicate text, verification signals and repeated themes; average stars alone are inadequate.

OpenRTB is a real-time bidding protocol, not a global searchable ad catalog. Personal ad memory, ambient observation and cross-source identity linking require separate explicit consent and default off.

## 11. Connector capability and permission model

Every connector declares search, metadata, playback, authentication, engagement, downloads, captions/transcripts, historical discovery, creator operations, regions, quotas, provenance, retention and known failure modes. The UI distinguishes supported, unsupported, requires-auth, unavailable, rate-limited, degraded and unknown. A connector may implement only a subset.

See capability-registry.md and provider-policy-matrix.md.

## 12. Architecture enforcement

- Add WebFlix modules to architecture-policy.yaml as managed modules when their source roots are introduced.
- Managed modules declare owner, public entrypoints, dependencies and layers; enforce no cycles and no deep imports.
- Never expand the baseline merely to hide violations.
- Cross-module use goes through public contracts, not deep imports.
- Architecture policy, public contracts, product identity, data ownership and security-policy changes are TL2-owned.
- Requirement IDs, ADRs, work claims and evidence live in this repository.

## 13. First usable milestone

The first product milestone is a YouTube-first desktop vertical slice: the packaged Electron app launches under WebFlix identity; a user can connect their own YouTube account through an approved authorization path; browse/search/watch supported YouTube content through the best policy-compliant playback path; and use the explicitly supported account functions without another user's session being involved. A parallel local-first foundation must open a real local file, preserve WebFlix-owned library/progress state, restart/resume, and handle offline/unsupported states honestly. Do not claim full parity if any desired operation is unavailable through an approved path; record the limitation and decide it through the policy gate.

YouTube API clients must preserve required player behaviors and ads and deliver sufficient independent value under current policies. A source-backed implementation plan must distinguish available API operations, official embeds, authorized website/deep-link operations, unavailable features and anything requiring compliance guidance. After this YouTube-first milestone is proven, the next social-platform integration is chosen from current capability, authorization, policy and user-value evidence.

## 14. Policy references

- Existing WebFlix source: https://github.com/payswapdotorg/WebFlix-2.0
- ZCode upstream: https://github.com/zai-org/ZCode
- YouTube API policies: https://developers.google.com/youtube/terms/developer-policies-guide
- YouTube API Services policies: https://developers.google.com/youtube/terms/developer-policies
- YouTube Terms of Service: https://www.youtube.com/t/terms
- YouTube API Compliance Audit guidance: https://developers.google.com/youtube/terms/developer-policies-guide
- YouTube API terms: https://developers.google.com/youtube/terms/api-services-terms-of-service
- YouTube IFrame API: https://developers.google.com/youtube/iframe_api_reference
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security/
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation

Provider rollout is blocked until the policy matrix includes evidence and a reviewer records permitted operations and restrictions.
