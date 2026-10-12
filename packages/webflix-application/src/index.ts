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
// P4-TRANSCRIBE: the transcript pipeline — the first REAL derived-artifact
// producer. mi.transcribe rides the frozen §2.6 job wrapper (boundary +
// cooperative mid-run cancellation; cancelled/failed runs store NO artifact),
// and the fixture-replay engine is the DETERMINISTIC TEST DOUBLE (canned
// segments, labelled as such, no real ASR). The REAL local whisper.cpp
// adapter is node-bound (child_process/fs/os) and therefore lives on the
// local-library adapters seam (which already owns every machine-bound
// adapter) implementing the SAME contracts TranscriptionEnginePort —
// structural typing wires it into mi.transcribe's `engine` dep without a
// cross-package edge. No engine is bundled; no network exists anywhere in
// this path.
export * from "./transcribe-media-file";
export * from "./fixture-replay-engine";
// P4-SUMMARIZE: the text-intelligence producers. The transcript payload
// record + checksum (and its port, in ./ports.ts) resolve the P4-TRANSCRIBE
// recorded adjacency; mi.transcribe now persists the payload on success
// (the sanctioned amendment above). The built-in extractive engine is
// DETERMINISTIC, pure, local (no model, no network, no generative text);
// the fixture-replay summary engine is its DETERMINISTIC TEST DOUBLE; and
// mi.summarize / mi.overview / mi.qa ride the frozen §2.6 wrapper with
// lineage (webflix.extractive.v1 via webflix.built-in-summary-engine) and
// the source transcript artifact never mutated. The DURABLE payload store
// lives on the local-library seam (migration 0004) — a later order wires
// the composition root.
export * from "./transcript-payload";
export * from "./built-in-summary-engine";
export * from "./fixture-replay-summary-engine";
export * from "./mi-text-intelligence";

// P4-TRANSLATE: the translation + TTS text pipeline — the text payload and
// audio rendition records/ports, their in-memory defaults, the fixture-
// replay engine TEST DOUBLES, and mi.translate / mi.tts riding the frozen
// §2.6 wrapper (translation = a DerivedArtifact kind=translation with
// engine-reported lineage; TTS = an audio payload RENDITION attached to
// the source artifact — NO new artifact kind, the enum stays closed). The
// DURABLE stores live on the local-library seam (migration 0005) — a
// later order wires the composition root.
export * from "./text-payload";
export * from "./audio-rendition";
export * from "./fixture-replay-translation-engine";
export * from "./fixture-replay-tts-engine";
export * from "./mi-translate";
export * from "./mi-tts";

// P4-EVALLOOP: the experiment/evaluation loop — the pure metric
// computations (population-named honest metrics), the deterministic
// read-only replay core (ranker resolution + per-configuration replay),
// the mi.evaluate use case riding the frozen §2.6 wrapper (the result is
// returned in the job result — NOT a DerivedArtifact, nothing persisted),
// and the fixture-replay ranker TEST DOUBLE the evaluation tests use.
export * from "./evaluation-metrics";
export * from "./evaluation-replay";
export * from "./mi-evaluate";
export * from "./fixture-replay-ranker";

// P5-STORES (Phase-5 row 2): the Ad Center store ports (five ads-lane seams
// structurally separate from every intelligence/ranking port — phase5-ad-
// plan §3), their IN-MEMORY doubles for hermetic tests, and ads.import —
// the IMPORT SEAM, the honest path ad data enters the system until
// transparency connectors are authorized (P5-SOURCES). ads.import rides the
// frozen §2.6 wrapper (boundary + per-item cooperative cancellation),
// validates each item through the 0.8.0 schemas + the domain invariants
// (the extractive discipline), persists atomically PER RECORD with honest
// per-item outcomes (accepted-with-disposition / rejected-with-reason),
// and makes the charter's version rule literal: same source id + same
// batch = replace; different batch = a NEW version appended with
// provenance; NEVER a silent overwrite of history. The DURABLE stores live
// on the local-library seam (migration 0006 ad_* tables) — a later order
// wires the composition root.
export * from "./in-memory-ads-stores";
export * from "./ads-import";
export * from "./ads-import-rules";
export * from "./ads-import-items";
