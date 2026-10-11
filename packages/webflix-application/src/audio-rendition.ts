/**
 * AudioRendition — the persisted AUDIO rendition of a derived artifact
 * (P4-TRANSLATE row 2, the TTS side: mi.tts success persists the
 * synthesized audio as a payload rendition ATTACHED TO THE SOURCE
 * ARTIFACT).
 *
 * AUDIO-AS-RENDITION, binding: synthesized audio is NOT a derived artifact
 * — the DerivedArtifact kind enum is CLOSED at six kinds and this order
 * adds none. A rendition is a SIDE RECORD keyed BY the source artifact id:
 * it carries its OWN lineage (the engine adapter's identity, the voice,
 * the deterministic inputsHash over the synthesis inputs) plus the audio
 * bytes and the engine-produced content type. The SOURCE artifact's
 * descriptor is never read-mutated-written by this path (the source is
 * fetched for validation only; nothing in this module can write a
 * descriptor) — pinned by deep-equal tests.
 *
 * The rendition's OWN lineage, stated honestly:
 * - `engine.id` / `engine.label` / `engine.version` are the WebFlix
 *   ADAPTER's own identity (our code — always known);
 * - `engineVersion` / `modelLineage` are facts read from the ENGINE'S OWN
 *   output when it reported them, ABSENT otherwise (never guessed);
 * - `voiceId` is the voice identity the caller requested and the engine
 *   resolved (the engine rejects unknown voices typed — a stored
 *   rendition's voiceId is always a voice the engine actually used);
 * - `inputsHash` is FNV-1a 32-bit over (source artifact id + the source
 *   text's checksum + engine id + engine version + voice id) —
 *   deterministic, no wall clock, no randomness, honest about WHAT varied.
 *
 * The DURABLE store (local-library, migration 0005 `mi_audio_renditions`)
 * keys its own table by rendition id and indexes the source artifact id
 * (renditions LIST by source — the attachment surface); the IN-MEMORY
 * default lives in in-memory-intelligence-stores.ts. Both are structural
 * mirrors of the SAME port (./ports.ts). The checksum algorithm lives
 * HERE, in the platform-pure application layer (the transcript-payload
 * precedent), so both adapters and every caller agree on it byte-for-byte.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TtsEngineDescriptor } from "webflix-contracts";

/** One persisted audio rendition attached to a source artifact. */
export interface AudioRendition {
  /** The rendition's own id (generated UPFRONT by the use case — put-before-listing ordering). */
  readonly renditionId: string;
  /** The SOURCE derived-artifact id this rendition is attached to (never mutated). */
  readonly sourceArtifactId: string;
  /** The engine adapter's own identity (OUR code's — always known). */
  readonly engine: Pick<TtsEngineDescriptor, "id" | "label" | "version">;
  /** The engine binary's own version string when IT reported one; absent otherwise (never guessed). */
  readonly engineVersion?: string;
  /** Model lineage read from the engine's own output when reported; absent otherwise. */
  readonly modelLineage?: string;
  /** The voice identity the engine resolved and used. */
  readonly voiceId: string;
  /** Deterministic digest of the synthesis inputs (see module doc). */
  readonly inputsHash: string;
  /** The audio's content type, engine-produced (e.g. "audio/wav"). */
  readonly contentType: string;
  /** The synthesized audio bytes, exactly as the engine wrote them out. */
  readonly audio: Uint8Array;
  /** When the rendition was persisted (the injected clock's ISO instant). */
  readonly createdAt: string;
}

/**
 * The rendition inputsHash: FNV-1a 32-bit over the exact tuple
 * (source artifact id + the source text's checksum + engine id + engine
 * version + voice id) — no wall clock, no randomness. NOT a cryptographic
 * claim — a stable identity for the rendition's lineage (same inputs =>
 * same hash, forever; a different voice or text => a different hash).
 */
export function ttsRenditionInputsHash(input: {
  readonly sourceArtifactId: string;
  readonly textChecksum: string;
  readonly engineId: string;
  readonly engineVersion: string;
  readonly voiceId: string;
}): string {
  const parts = [
    input.sourceArtifactId,
    input.textChecksum,
    input.engineId,
    input.engineVersion,
    input.voiceId,
  ];
  const text = parts.join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Defensive shape validation shared by every AudioRenditionStore
 * implementation on WRITE: non-blank ids/voice/contentType, a
 * Uint8Array audio payload, and a non-blank inputsHash. Violations are
 * typed IntelligenceArtifactInvalid WebFlixErrors.
 */
export function assertValidAudioRendition(rendition: AudioRendition): void {
  if (typeof rendition.renditionId !== "string" || rendition.renditionId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition renditionId must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.renditionId" },
    });
  }
  if (
    typeof rendition.sourceArtifactId !== "string" ||
    rendition.sourceArtifactId.trim().length === 0
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition sourceArtifactId must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.sourceArtifactId", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.engine.id !== "string" || rendition.engine.id.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition engine.id must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.engine.id", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.engine.label !== "string" || rendition.engine.label.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition engine.label must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.engine.label", renditionId: rendition.renditionId },
    });
  }
  if (
    typeof rendition.engine.version !== "string" ||
    rendition.engine.version.trim().length === 0
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition engine.version must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.engine.version", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.voiceId !== "string" || rendition.voiceId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition voiceId must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.voiceId", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.inputsHash !== "string" || rendition.inputsHash.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition inputsHash must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.inputsHash", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.contentType !== "string" || rendition.contentType.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition contentType must be a non-blank string",
      retryable: false,
      context: { subject: "AudioRendition.contentType", renditionId: rendition.renditionId },
    });
  }
  if (!(rendition.audio instanceof Uint8Array)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition audio must be a Uint8Array",
      retryable: false,
      context: { subject: "AudioRendition.audio", renditionId: rendition.renditionId },
    });
  }
  if (rendition.audio.length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason:
        "audio rendition audio must be non-empty (an engine that wrote no audio is a failed run, never an empty rendition)",
      retryable: false,
      context: { subject: "AudioRendition.audio", renditionId: rendition.renditionId },
    });
  }
  if (typeof rendition.createdAt !== "string" || rendition.createdAt.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition createdAt must be a non-blank ISO string",
      retryable: false,
      context: { subject: "AudioRendition.createdAt", renditionId: rendition.renditionId },
    });
  }
}
