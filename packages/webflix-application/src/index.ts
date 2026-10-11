/**
 * @webflix/application — public surface (D2-LOCAL).
 *
 * Use-cases orchestrate the (pure) domain rules over the ports defined in
 * `./ports.ts`; entity shapes in `./types.ts` mirror `@webflix/domain` and are
 * bridged by adapters at the edges. Adapters implement the ports:
 *
 *   - LocalStore           -> packages/webflix-local-store
 *   - IndexingPort         -> packages/webflix-indexer
 *   - ProviderMetadataPort -> packages/webflix-providers
 *   - CredentialPort       -> desktop keychain adapter (contract re-export)
 */
export * from "./types";
export * from "./ports";
export * from "./path-safety";
export * from "./indexing-session";
export * from "./add-local-files-to-library";
export * from "./manage-collections";
export * from "./track-playback-progress";
export * from "./refresh-provider-metadata";
export * from "./run-indexing-job";
// Media intelligence (Phase 4, P4-CONTRACTS + P4-ARTIFACTS): in-memory store
// defaults (pure-test defaults — the durable adapters live on the
// local-library seam and are exported there), the built-in deterministic
// ranker (RankingPolicy v1) and the MI use cases (objectives, feedback,
// ranking job, artifact bookkeeping). The P4-FD1 mirrors collapsed to
// webflix-domain imports when the frozen edge landed (P4-ARTIFACTS row 0):
// parseOrThrow/parseIsoToEpochMs/transitionJob/the objective+lineage rules
// all come from the domain package now.
export * from "./in-memory-intelligence-stores";
export * from "./built-in-ranker";
// P4-ADAPTERS row 1: the ranker-adapter registry (static default seeded
// with exactly one entry — the built-in v1) and the selection use cases
// (set/clear validate registry-known ids; resolveSelectedRanker returns the
// active adapter with honest resolution metadata — default, selected, or
// fail-soft fallback with the typed error surfaced).
export * from "./ranker-adapter-registry";
export * from "./ranker-adapter-selection";
export * from "./set-objectives";
export * from "./record-feedback";
export * from "./generate-recommendations";
export * from "./derive-artifact-bookkeeping";
