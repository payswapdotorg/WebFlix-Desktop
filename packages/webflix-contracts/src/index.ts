/**
 * Public entrypoint of `webflix-contracts`.
 *
 * Every locked shape from docs/plans/contract-freeze.md §2 is exported
 * here — a zod schema for runtime validation plus the inferred TS type for
 * compile-time use. Downstream packages import contracts ONLY from this
 * entrypoint so the frozen surface stays auditable in one place.
 */

// Shared primitives (instants, regions, URLs, secret-free guards).
export * from "./internal/primitives";

// Catalog: CatalogItem, ProviderAsset, MediaKind, MatchEvidence, AvailabilityFact.
export * from "./catalog";

// Playback: PlaybackPlan union, UnavailableReason, RecoveryHint, PlaybackProgress.
export * from "./playback";

// Capability: CapabilityStatus, OperationCapability, ConnectorManifest.
export * from "./capability";

// Library: LocalLibraryEntry, Collection, LocalPlaylist, WatchedState.
export * from "./library";

// Account: ProviderAccountRecord (renderer-safe), CredentialPort (interface only).
export * from "./account";

// Jobs: JobDescriptor, JobState (cancellable, retryable, provenance-preserving).
export * from "./jobs";

// Intelligence (Phase 4, P4-CONTRACTS): UserObjective, FeedbackEvent, LibraryFact,
// RankingPolicy (+ canonical v1 weights), RankedItem/RankingResult, DerivedArtifact,
// RankerPort. P4-ADAPTERS appended RankerAdapterSelection (0.3.0). ADDITIVE per
// §3 — frozen §2.1–2.6 untouched.
export * from "./intelligence";
// The §2.7 intelligence module's P4-TRANSLATE continuation (0.5.0 -> 0.6.0
// additive section, split to its own sibling at the parent's max-lines
// limit — same entrypoint surface, byte-identical exports).
export * from "./intelligence-translate-tts";
// The §2.7 intelligence module's P4-EVALLOOP continuation (0.6.0 -> 0.7.0
// additive section, the same sibling-module precedent): the experiment/
// evaluation loop shapes — EvaluationRequest/Result/Outcome, the
// population-carrying metric shapes, the configuration union. Policy enum
// and kind enum stay closed; evaluations are NOT DerivedArtifacts.
export * from "./intelligence-evaluation";

// Ad Center (Phase 5, P5-CONTRACTS): the ads lane's own contract shapes —
// AdvertiserIdentity, AdRecord, Claim, EvidenceLink, ReviewSignal,
// OfferVerification, QualificationExplanation (0.7.0 -> 0.8.0 additive
// section). Separation starts here: this module imports only the shared
// primitives — nothing from the intelligence/ranking modules, either
// direction — and the architecture-check `ads-separation` rule pins the
// organic ranking path away from these shapes.
export * from "./ads";

// Ad Center transparency-source seam (Phase 5, P5-SOURCES — the FINAL row;
// 0.10.0 -> 0.11.0 additive sibling, same separation discipline): the
// TransparencySourcePort (interface only), the per-source manifest with
// its coverage declarations (AS the source's own terms state them), the
// query/observation/result shapes (the access states are DATA, never
// thrown), and the one genuinely-rejecting error code ads/source-invalid.
export * from "./ads-sources";

// Errors: ErrorCode, WebFlixError.
export * from "./errors";

// Federated search (Phase 7, P7-SEARCH-1): the search lane's own contract
// sibling (0.11.0 -> 0.12.0 additive, the ads-sources discipline) — the
// SearchRequest, the per-source SearchOutcome union whose access states
// are DATA never thrown, the never-hide SourceCoverage rows, the
// FederatedSearchResult with its MatchEvidence-driven merged item view
// (the frozen catalog shapes reused verbatim), and the ONE rejecting
// error code search/source-invalid on the sibling's own vocabulary.
export * from "./search";

// Ad Center personal memory (Phase 7, P7-AD-MEMORY-1 — WF-029): the ads
// lane's own memory sibling (0.12.0 -> 0.13.0 additive, the ads-sources
// discipline) — the closed AdMemoryScope union, the per-scope
// AdMemoryConsent record (grants + revocations with timestamps — consent
// is DATA, never ambient), the SavedAdRecord (an AdRecord reference +
// user note + saved-at), the UserObservation with its closed
// user-stated provenance label (never conflated with source-backed
// evidence), the AdMemoryEntry union, and the AdMemoryRefusal reasons
// (ads-memory/consent-required, ads-memory/scope-revoked) carried as
// DATA, never thrown.
export * from "./ads-memory";

// UI-action bridge (WFX-DESKTOP-WEBFLIX-UX-1 — freeze §9): the typed
// agent<->UI seam (0.13.0 -> 0.14.0 additive, the ads-sources discipline) —
// the frozen MediaRoute/RouteParams navigation model, the VisibleMediaContext
// snapshot the host answers FROM ITS OWN STATE (never a DOM scrape), the
// seven-action UiAction union (navigation/read/play only — NO provider
// account mutations ride this bridge, the freeze §9 consent law), the typed
// UiActionResult union (ok + evidence + verification context | failure |
// needs-user-choice | unsupported with the frozen capability vocabulary),
// the AgentItemSummary/AgentChannelSummary (ids + display facts — an agent
// cannot fabricate playable items), the UiActionDispatcher port (interface
// only), and the AgentActionTraceEntry for acceptance-run evidence.
export * from "./ui-actions";

// Media-surface views (WFX-DESKTOP-WEBFLIX-UX-1 — freeze §9): the frozen
// shell<->producer view seam (same 0.13.0 -> 0.14.0 additive bump) — the
// MediaViewPhase honest-state vocabulary as DATA, the card atoms
// (VideoCardView/ContinueCardView/ChannelCardView/ChannelHeaderView — each
// carrying the canonical CatalogItem VERBATIM), the HomeFeedView sections
// model (the reference's interleaved composition with per-section honest
// states), the page surfaces (SearchPageData, ChannelView, TrendingView,
// ShortsView, SubscriptionsView with its mandatory degradeNote, HistoryView),
// and the producer ports (interface only, the CredentialPort precedent):
// HomeFeedPort, SearchPagePort, ChannelPort, TrendingPort, ShortsPort,
// SubscriptionsPort, HistoryPort, and the ChannelResolutionPort behind the
// agent's resolveChannel action (newest-first uploads, typed ambiguity).
export * from "./media-views";
