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

// Errors: ErrorCode, WebFlixError.
export * from "./errors";
