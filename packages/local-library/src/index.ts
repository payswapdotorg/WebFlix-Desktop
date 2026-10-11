export * from "./constants";
export * from "./errors";
export * from "./fingerprint";
export * from "./paths";
export * from "./ports";
export * from "./types";

export { createSqliteDatabase, inTransaction, toSqlParam } from "./db/adapter";
export type {
  SqliteDatabase,
  SqliteEngineName,
  SqlParam,
  SqlRunResult,
  SqliteStatement,
} from "./db/adapter";

export {
  listAppliedMigrations,
  migrationHash,
  runMigrations,
  SCHEMA_MIGRATIONS_DDL,
} from "./db/migrate";
export type { AppliedMigration, Migration } from "./db/migrate";

export { migration0001Init } from "./db/migrations/0001_init";

export { LocalStore } from "./localStore";
export type { LocalStoreOptions } from "./localStore";

export { indexPath, DEFAULT_MEDIA_EXTENSIONS } from "./indexing";
export type { IndexOptions } from "./indexing";

export { createBackup, restoreBackup, sha256File } from "./backup";
export type { BackupResult, RestoreOptions, RestoreResult } from "./backup";

export { sweepProviderMetadata } from "./ttl";
export type {
  MetadataRefreshFn,
  MetadataRefreshResult,
  TtlSweepOptions,
  TtlSweepResult,
} from "./ttl";

export { ALL_MIGRATIONS, openStore, WebFlixStore } from "./store";
export type { OpenStoreOptions } from "./store";

export { migration0002MediaIntelligence } from "./db/migrations/0002_media_intelligence";
export { migration0003RankerAdapterSelection } from "./db/migrations/0003_ranker_adapter_selection";
export { migration0004TranscriptPayloads } from "./db/migrations/0004_transcript_payloads";
export { migration0005TextAndAudioPayloads } from "./db/migrations/0005_text_and_audio_payloads";

// Durable transcript payload store (P4-SUMMARIZE row 1): the transcript
// segment payloads keyed by their transcript artifact id, on this package's
// storage seam (own mi_transcript_payloads table, additive migration 0004,
// the 0002/0003 rules), exported for the composition root (a later order
// wires it — the port is a structural mirror of the application layer's
// TranscriptPayloadStore, per the LocalStorePort precedent; the FNV-1a
// checksum is a mirrored-and-test-pinned algorithm, see the module doc).
export { SqliteTranscriptPayloadStore } from "./transcript-payload-store";
export type {
  TranscriptPayload,
  TranscriptPayloadStoreOptions,
  TranscriptPayloadStorePort,
} from "./transcript-payload-store";

// Durable text payload + audio rendition stores (P4-TRANSLATE row 2): the
// TEXT projections of non-transcript derived artifacts (kinds summary /
// overview / qa / translation) keyed by artifact id, and the AUDIO
// renditions attached to source artifacts (audio-as-rendition — NO
// artifact kind is created or mutated) — on this package's storage seam
// (own mi_text_payloads + mi_audio_renditions tables, additive migration
// 0005, the 0002/0003/0004 rules with ONE documented deviation: the audio
// bytes are a BLOB column — the canonical form of bytes — with the
// structured record in metadata_json), exported for the composition root
// (a later order wires them — the ports are structural mirrors of the
// application layer's TextPayloadStore / AudioRenditionStore, per the
// LocalStorePort precedent; the FNV-1a checksum is a
// mirrored-and-test-pinned algorithm, see the module docs).
export { SqliteTextPayloadStore } from "./text-payload-store";
export type {
  TextPayload,
  TextPayloadStoreOptions,
  TextPayloadStorePort,
} from "./text-payload-store";
export { SqliteAudioRenditionStore } from "./audio-rendition-store";
export type {
  AudioRendition,
  AudioRenditionStoreOptions,
  AudioRenditionStorePort,
} from "./audio-rendition-store";

// Durable ranker-adapter selection store (P4-ADAPTERS row 2): the
// per-profile selection on this package's storage seam (own mi_ranker_selection
// table, additive migration 0003, the 0002 rules), exported for the
// composition root (a later order wires it — the port is a structural mirror
// of the application layer's RankerSelectionStore, per the LocalStorePort
// precedent).
export { SqliteRankerSelectionStore } from "./ranker-selection-store";
export type {
  RankerSelectionStoreOptions,
  RankerSelectionStorePort,
} from "./ranker-selection-store";

// Durable media-intelligence stores (P4-ARTIFACTS row 1): the MI store trio
// on this package's storage seam, exported for the composition root (a
// later order wires them — ports are structural mirrors of the application
// layer's MI ports, per the LocalStorePort precedent).
export {
  createIntelligenceStores,
  SqliteObjectiveStore,
  SqliteFeedbackStore,
  SqliteArtifactRegistry,
} from "./intelligence-stores";
export type {
  ArtifactLineageStatus,
  ArtifactRegistryPort,
  DurableArtifactRegistry,
  DurableFeedbackStore,
  DurableObjectiveStore,
  FeedbackAppendResult,
  FeedbackStorePort,
  IntelligenceStoreOptions,
  IntelligenceStores,
  ObjectiveStorePort,
} from "./intelligence-stores";

// The REAL local transcription-engine adapter (P4-TRANSCRIBE row 3b): a
// whisper.cpp-class binary discovered on THIS machine (override + PATH +
// standard locations), honestly typed engine-unavailable when absent, with
// lineage read from the binary's own output only — never guessed. Implements
// the contracts TranscriptionEnginePort DIRECTLY (the port lives in
// @webflix/contracts, so this is an allowed edge; structural typing wires it
// into mi.transcribe's `engine` dependency without any cross-package edge —
// the port-mirror precedent inverted, no mirror needed). NO engine is
// bundled; no network exists anywhere in this path; the spawn seam is
// injectable so tests replay canned children without process I/O.
export {
  discoverWhisperBinary,
  WHISPER_BINARY_NAMES,
  WHISPER_CPP_LOCAL_ENGINE_DESCRIPTOR,
  WHISPER_CPP_LOCAL_ENGINE_ID,
  WHISPER_CPP_LOCAL_ENGINE_VERSION,
  WHISPER_CPP_RECOVERY_HINT,
  WhisperCppLocalEngine,
} from "./whisper-engine";
export type {
  EngineChildProcess,
  EngineChildStreams,
  EngineProcessEnv,
  SpawnEngineBinary,
  WhisperCppLocalEngineOptions,
} from "./whisper-engine";

// The REAL local translation-engine adapter (P4-TRANSLATE row 3): an
// Argos-class binary discovered on THIS machine (WEBFLIX_ARGOS_BIN override
// + PATH + standard locations), honestly typed translation-engine-unavailable
// when absent, output parsed ONLY from the documented one-shot CLI shape,
// lineage read from the binary's own output only — never guessed. Implements
// the contracts TranslationEnginePort DIRECTLY (allowed edge; structural
// typing wires it into mi.translate's `engine` dependency). NO engine is
// bundled; no network exists anywhere in this path; the spawn seam is
// injectable so tests replay canned children without process I/O.
export {
  ARGOS_BINARY_NAMES,
  ARGOS_LOCAL_TRANSLATION_ENGINE_DESCRIPTOR,
  ARGOS_LOCAL_TRANSLATION_ENGINE_ID,
  ARGOS_LOCAL_TRANSLATION_ENGINE_VERSION,
  ARGOS_RECOVERY_HINT,
  ArgosClassLocalTranslationEngine,
  discoverArgosBinary,
} from "./argos-translation-engine";
export type {
  ArgosClassLocalTranslationEngineOptions,
  EngineChildProcess as ArgosEngineChildProcess,
  EngineChildStreams as ArgosEngineChildStreams,
  EngineProcessEnv as ArgosEngineProcessEnv,
  SpawnEngineBinary as ArgosSpawnEngineBinary,
} from "./argos-translation-engine";

// The REAL local TTS-engine adapter (P4-TRANSLATE row 3): a Piper-class
// binary discovered on THIS machine (WEBFLIX_PIPER_BIN override + PATH +
// standard locations) plus VOICE-model discovery (.onnx files; the
// WEBFLIX_PIPER_VOICE override + standard voice directories), honestly
// typed tts-engine-unavailable when the engine OR the requested voice is
// absent, audio read back from the engine's OWN output path — never
// synthesized, lineage read from the binary's own output only. Implements
// the contracts TtsEnginePort DIRECTLY (allowed edge; structural typing
// wires it into mi.tts's `engine` dependency). NO engine and NO voice model
// is bundled; no network exists anywhere in this path; every I/O seam
// (spawn, disk probes, voice listing, audio read-back, output path) is
// injectable so tests replay canned children and canned audio without ANY
// process or file I/O.
export {
  discoverPiperBinary,
  discoverPiperVoices,
  PIPER_BINARY_NAMES,
  PIPER_ENGINE_RECOVERY_HINT,
  PIPER_LOCAL_TTS_ENGINE_DESCRIPTOR,
  PIPER_LOCAL_TTS_ENGINE_ID,
  PIPER_LOCAL_TTS_ENGINE_VERSION,
  PIPER_VOICE_RECOVERY_HINT,
  PiperLocalTtsEngine,
} from "./piper-tts-engine";
export type {
  DiscoveredPiperVoice,
  EngineChildProcess as PiperEngineChildProcess,
  EngineChildStdin as PiperEngineChildStdin,
  EngineChildStreams as PiperEngineChildStreams,
  EngineProcessEnv as PiperEngineProcessEnv,
  PiperLocalTtsEngineOptions,
  SpawnEngineBinary as PiperSpawnEngineBinary,
} from "./piper-tts-engine";
