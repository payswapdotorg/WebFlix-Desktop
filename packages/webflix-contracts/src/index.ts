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

// Errors: ErrorCode, WebFlixError.
export * from "./errors";
