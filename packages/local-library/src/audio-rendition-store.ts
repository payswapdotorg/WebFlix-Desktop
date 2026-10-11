import { ErrorCode, WebFlixError } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";

/**
 * Durable audio rendition store (P4-TRANSLATE row 2, the TTS side) on the
 * local-library storage seam — the AUDIO renditions attached to source
 * derived artifacts, keyed by rendition id in the OWN `mi_audio_renditions`
 * table (additive migration 0005, the 0002/0003/0004 rules with ONE
 * documented deviation: the audio bytes are a BLOB column — the canonical
 * form of bytes — instead of a JSON column; the structured record lives in
 * `metadata_json`).
 *
 * AUDIO-AS-RENDITION (binding): synthesized audio is NOT a derived
 * artifact — the kind enum stays closed. A rendition row is a SIDE record
 * keyed BY the source artifact id: its OWN lineage (engine adapter
 * identity + run-reported engine facts + the voice + the deterministic
 * inputsHash) plus the bytes and content type. The SOURCE artifact's
 * descriptor is never touched by this store (no foreign key into the
 * registry or originals, deliberately — a rendition may honestly outlive
 * its source descriptor and stays readable).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface and the rendition record below mirror the
 * shape of the application layer's AudioRenditionStore and AudioRendition
 * (packages/webflix-application/src/ports.ts + audio-rendition.ts); both
 * sides are structurally typed, so this adapter satisfies the application
 * port without a cross-package dependency from this lane. The composition
 * root wires them in a later order (explicitly NOT this order's scope).
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE
 * profile-scoped SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here:
 * - SHAPE validation on write (the application layer's assertValid rules,
 *   mirrored): non-blank ids/voice/contentType/inputsHash, a non-empty
 *   Uint8Array audio payload (an engine that wrote no audio is a FAILED
 *   run — never persisted as an empty rendition);
 * - INTEGRITY re-verified on read: the stored `byte_length` must match the
 *   BLOB's actual length AND the metadata record's byteLength — a corrupt
 *   or tampered row surfaces as a typed WebFlixError
 *   (IntelligenceArtifactInvalid), never as silently-truncated audio;
 * - LISTING is the attachment surface: `listBySource` returns the source
 *   artifact's renditions in deterministic (stored_at, rendition_id) order
 *   — the metadata's createdAt carries the same ordering fact;
 * - no telemetry, no network, no randomness: the only stamps are the
 *   injected clock's epoch-ms (`stored_at`) and the record's own
 *   createdAt (the use case's injected clock).
 */

/** One persisted audio rendition attached to a source artifact (structural mirror). */
export interface AudioRendition {
  readonly renditionId: string;
  /** The SOURCE derived-artifact id this rendition is attached to (never mutated). */
  readonly sourceArtifactId: string;
  /** The engine adapter's own identity (OUR code's — always known). */
  readonly engine: { readonly id: string; readonly label: string; readonly version: string };
  /** The engine binary's own version string when IT reported one; absent otherwise (never guessed). */
  readonly engineVersion?: string;
  /** Model lineage read from the engine's own output when reported; absent otherwise. */
  readonly modelLineage?: string;
  readonly voiceId: string;
  readonly inputsHash: string;
  readonly contentType: string;
  readonly audio: Uint8Array;
  readonly createdAt: string;
}

/** Per-profile audio rendition store (structural port mirror). */
export interface AudioRenditionStorePort {
  /** Persists one rendition (id-keyed; a re-put of the same id replaces). */
  put(rendition: AudioRendition): Promise<void>;
  /** The source artifact's renditions, deterministic order; empty when none (honest). */
  listBySource(sourceArtifactId: string): Promise<readonly AudioRendition[]>;
  /** Deletes one rendition by id; true when it existed (retention surface). */
  delete(renditionId: string): Promise<boolean>;
  /** Deletes every rendition attached to one source artifact; returns how many (retention surface). */
  deleteBySource(sourceArtifactId: string): Promise<number>;
  /** Clear-all per profile; returns the number of renditions removed (retention surface). */
  clearAll(): Promise<number>;
}

export interface AudioRenditionStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable AudioRenditionStore: rows in `mi_audio_renditions`. */
export class SqliteAudioRenditionStore implements AudioRenditionStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: AudioRenditionStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(rendition: AudioRendition): Promise<void> {
    const validated = validateRenditionShape(rendition);
    this.db
      .prepare(
        "INSERT INTO mi_audio_renditions " +
          "(rendition_id, source_artifact_id, engine_id, engine_version, model_lineage, voice_id, inputs_hash, content_type, byte_length, metadata_json, audio, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(rendition_id) DO UPDATE SET source_artifact_id = excluded.source_artifact_id, " +
          "engine_id = excluded.engine_id, engine_version = excluded.engine_version, model_lineage = excluded.model_lineage, " +
          "voice_id = excluded.voice_id, inputs_hash = excluded.inputs_hash, content_type = excluded.content_type, " +
          "byte_length = excluded.byte_length, metadata_json = excluded.metadata_json, audio = excluded.audio, " +
          "stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(validated.renditionId),
        toSqlParam(validated.sourceArtifactId),
        toSqlParam(validated.engine.id),
        toSqlParam(validated.engineVersion ?? null),
        toSqlParam(validated.modelLineage ?? null),
        toSqlParam(validated.voiceId),
        toSqlParam(validated.inputsHash),
        toSqlParam(validated.contentType),
        toSqlParam(validated.audio.length),
        toSqlParam(canonicalMetadataJson(validated)),
        toSqlParam(validated.audio),
        toSqlParam(this.clock()),
      );
  }

  async listBySource(sourceArtifactId: string): Promise<readonly AudioRendition[]> {
    const rows = this.db
      .prepare(
        "SELECT metadata_json, audio, byte_length FROM mi_audio_renditions " +
          "WHERE source_artifact_id = ? ORDER BY stored_at ASC, rendition_id ASC",
      )
      .all(toSqlParam(sourceArtifactId));
    return rows.map((row) =>
      parseStoredRendition(row["metadata_json"], row["audio"], row["byte_length"]),
    );
  }

  async delete(renditionId: string): Promise<boolean> {
    return (
      this.db
        .prepare("DELETE FROM mi_audio_renditions WHERE rendition_id = ?")
        .run(toSqlParam(renditionId)).changes > 0
    );
  }

  async deleteBySource(sourceArtifactId: string): Promise<number> {
    return this.db
      .prepare("DELETE FROM mi_audio_renditions WHERE source_artifact_id = ?")
      .run(toSqlParam(sourceArtifactId)).changes;
  }

  async clearAll(): Promise<number> {
    return this.db.prepare("DELETE FROM mi_audio_renditions").run().changes;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the rendition's STRUCTURED record: fixed key order
 * (renditionId, sourceArtifactId, engine {id,label,version}, engineVersion
 * + modelLineage only when present, voiceId, inputsHash, contentType,
 * byteLength, createdAt), no whitespace — the round-trip source of truth
 * for everything EXCEPT the bytes (the BLOB column owns those; byteLength
 * is duplicated as the integrity cross-check).
 */
function canonicalMetadataJson(rendition: AudioRendition): string {
  return JSON.stringify({
    renditionId: rendition.renditionId,
    sourceArtifactId: rendition.sourceArtifactId,
    engine: {
      id: rendition.engine.id,
      label: rendition.engine.label,
      version: rendition.engine.version,
    },
    ...(rendition.engineVersion !== undefined ? { engineVersion: rendition.engineVersion } : {}),
    ...(rendition.modelLineage !== undefined ? { modelLineage: rendition.modelLineage } : {}),
    voiceId: rendition.voiceId,
    inputsHash: rendition.inputsHash,
    contentType: rendition.contentType,
    byteLength: rendition.audio.length,
    createdAt: rendition.createdAt,
  });
}

/** Defensive write-path validation: shape + a non-empty audio payload, typed errors. */
function validateRenditionShape(rendition: AudioRendition): AudioRendition {
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
  if (
    typeof rendition.engine?.id !== "string" ||
    rendition.engine.id.trim().length === 0 ||
    typeof rendition.engine?.label !== "string" ||
    rendition.engine.label.trim().length === 0 ||
    typeof rendition.engine?.version !== "string" ||
    rendition.engine.version.trim().length === 0
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition engine must carry non-blank id, label and version",
      retryable: false,
      context: { subject: "AudioRendition.engine", renditionId: rendition.renditionId },
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
  if (typeof rendition.createdAt !== "string" || rendition.createdAt.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "audio rendition createdAt must be a non-blank ISO string",
      retryable: false,
      context: { subject: "AudioRendition.createdAt", renditionId: rendition.renditionId },
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
  return rendition;
}

/**
 * Parses a stored row back into the rendition record, cross-checking the
 * BLOB's length against BOTH the byte_length column and the metadata's
 * byteLength — a corrupt or tampered row surfaces as a typed WebFlixError
 * (never silently-truncated audio).
 */
function parseStoredRendition(
  rawMetadata: unknown,
  rawAudio: unknown,
  rawByteLength: unknown,
): AudioRendition {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof rawMetadata === "string" ? rawMetadata : String(rawMetadata));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored audio rendition row has invalid metadata JSON: ${detail}`,
      retryable: false,
      context: { subject: "AudioRendition.metadata" },
    });
  }
  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored audio rendition metadata is not a JSON object",
      retryable: false,
      context: { subject: "AudioRendition.metadata" },
    });
  }
  const record = parsedJson as Record<string, unknown>;
  const engine = record["engine"];
  if (
    typeof record["renditionId"] !== "string" ||
    record["renditionId"].trim().length === 0 ||
    typeof record["sourceArtifactId"] !== "string" ||
    record["sourceArtifactId"].trim().length === 0 ||
    typeof engine !== "object" ||
    engine === null ||
    Array.isArray(engine) ||
    typeof (engine as Record<string, unknown>)["id"] !== "string" ||
    typeof (engine as Record<string, unknown>)["label"] !== "string" ||
    typeof (engine as Record<string, unknown>)["version"] !== "string" ||
    typeof record["voiceId"] !== "string" ||
    record["voiceId"].trim().length === 0 ||
    typeof record["inputsHash"] !== "string" ||
    typeof record["contentType"] !== "string" ||
    record["contentType"].trim().length === 0 ||
    typeof record["createdAt"] !== "string" ||
    record["createdAt"].trim().length === 0
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored audio rendition metadata is missing required non-blank fields",
      retryable: false,
      context: { subject: "AudioRendition.metadata" },
    });
  }
  const engineRecord = engine as Record<string, string>;
  const engineVersion = record["engineVersion"];
  const modelLineage = record["modelLineage"];
  if (
    (engineVersion !== undefined && typeof engineVersion !== "string") ||
    (modelLineage !== undefined && typeof modelLineage !== "string")
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored audio rendition metadata has non-string optional lineage fields",
      retryable: false,
      context: { subject: "AudioRendition.metadata" },
    });
  }
  if (!(rawAudio instanceof Uint8Array)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored audio rendition row has a non-BLOB audio column",
      retryable: false,
      context: { subject: "AudioRendition.audio", renditionId: record["renditionId"] },
    });
  }
  const audio = new Uint8Array(rawAudio);
  const storedByteLength =
    typeof rawByteLength === "number" ? rawByteLength : Number(rawByteLength);
  if (audio.length === 0 || storedByteLength !== audio.length) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored audio rendition failed its length verification: byte_length column says ${String(rawByteLength)}, the BLOB holds ${audio.length} — the row is corrupt or was tampered with`,
      retryable: false,
      context: {
        subject: "AudioRendition.audio",
        renditionId: record["renditionId"],
        columnByteLength: rawByteLength,
        blobLength: audio.length,
      },
    });
  }
  const metadataByteLength = record["byteLength"];
  if (metadataByteLength !== undefined && metadataByteLength !== audio.length) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored audio rendition metadata byteLength (${String(metadataByteLength)}) disagrees with the BLOB (${audio.length}) — the row is corrupt or was tampered with`,
      retryable: false,
      context: {
        subject: "AudioRendition.metadata.byteLength",
        renditionId: record["renditionId"],
        metadataByteLength,
        blobLength: audio.length,
      },
    });
  }
  return {
    renditionId: record["renditionId"],
    sourceArtifactId: record["sourceArtifactId"],
    engine: {
      id: engineRecord["id"],
      label: engineRecord["label"],
      version: engineRecord["version"],
    },
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    ...(modelLineage !== undefined ? { modelLineage } : {}),
    voiceId: record["voiceId"],
    inputsHash: record["inputsHash"],
    contentType: record["contentType"],
    audio,
    createdAt: record["createdAt"],
  };
}
