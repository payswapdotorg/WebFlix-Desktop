import { ErrorCode, TranscriptSegmentSchema, WebFlixError } from "webflix-contracts";
import type { TranscriptSegment } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";

/**
 * Durable transcript payload store (P4-SUMMARIZE row 1) on the local-library
 * storage seam — the transcript segment payloads keyed by their transcript
 * artifact id in the OWN `mi_transcript_payloads` table (additive migration
 * 0004, the 0002/0003 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface and the payload record below mirror the shape
 * of the application layer's TranscriptPayloadStore and TranscriptPayload
 * (packages/webflix-application/src/ports.ts + transcript-payload.ts); both
 * sides are structurally typed, so this adapter satisfies the application
 * port without a cross-package dependency from this lane. The composition
 * root wires them in a later order (explicitly NOT this order's scope).
 *
 * CHECKSUM MIRROR, stated honestly: the canonical-JSON serialization and
 * the FNV-1a 32-bit checksum below are STRUCTURAL MIRRORS of the
 * application layer's transcriptPayloadChecksum (the algorithm lives in
 * the platform-pure application layer so every caller and both adapters
 * agree on it byte-for-byte; this lane cannot import it, so the functions
 * are mirrored here). Byte-equality between the two implementations is
 * PINNED by a literal constant in this suite's tests — the value the
 * application implementation produces for the pinned fixture — so a drift
 * in either implementation fails the gate. The checksum is an IDENTITY
 * checksum (accidental-corruption detection), NOT a cryptographic claim.
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle — the same per-profile store the library's own
 * LocalStore uses (openStore with the profile's baseDir). No adapter ever
 * crosses profiles.
 *
 * Honesty rules enforced here:
 * - SHAPE validation on write AND read: every segment is re-checked through
 *   the locked TranscriptSegmentSchema, and the checksum is RE-COMPUTED and
 *   compared on both paths — a corrupt or tampered row surfaces as a typed
 *   WebFlixError (IntelligenceArtifactInvalid), never as silently-mangled
 *   transcript data;
 * - ABSENCE IS TYPED: `get` on a key with no stored row rejects with the
 *   typed intelligence/transcript-payload-absent error (surfaced with
 *   re-transcription as the recovery, never null, never an empty
 *   substitute) — the pre-0004 transcript state;
 * - `put` replaces wholesale for the same artifact id (the put-replaces
 *   house semantic — a re-put of the SAME id is an idempotent refresh);
 * - the store does NOT know the artifact registry (documented): it
 *   persists what the validated use cases hand over, keyed by the id they
 *   computed — a payload row may honestly outlive its descriptor;
 * - no telemetry, no network, no randomness: the only stamp is the
 *   injected clock's epoch-ms (`stored_at`).
 */

/** The persisted payload of one transcript artifact (structural mirror). */
export interface TranscriptPayload {
  readonly artifactId: string;
  readonly segments: readonly TranscriptSegment[];
  readonly checksum: string;
}

/** Per-profile transcript payload store (structural port mirror). */
export interface TranscriptPayloadStorePort {
  /** Persists (or replaces) the payload for one transcript artifact id. */
  put(payload: TranscriptPayload): Promise<void>;
  /**
   * The stored payload; rejects with the typed absent error when none was
   * persisted (never null — absence is typed and surfaced).
   */
  get(artifactId: string): Promise<TranscriptPayload>;
}

export interface TranscriptPayloadStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable TranscriptPayloadStore: rows in `mi_transcript_payloads`. */
export class SqliteTranscriptPayloadStore implements TranscriptPayloadStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: TranscriptPayloadStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(payload: TranscriptPayload): Promise<void> {
    const validated = validatePayloadShape(payload);
    this.db
      .prepare(
        "INSERT INTO mi_transcript_payloads (artifact_id, segment_count, checksum, payload_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(artifact_id) DO UPDATE SET segment_count = excluded.segment_count, checksum = excluded.checksum, " +
          "payload_json = excluded.payload_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(validated.artifactId),
        toSqlParam(validated.segments.length),
        toSqlParam(validated.checksum),
        toSqlParam(canonicalPayloadJson(validated)),
        toSqlParam(this.clock()),
      );
  }

  async get(artifactId: string): Promise<TranscriptPayload> {
    const row = this.db
      .prepare("SELECT payload_json FROM mi_transcript_payloads WHERE artifact_id = ?")
      .get(toSqlParam(artifactId));
    if (row === undefined) {
      throw transcriptPayloadAbsent(artifactId);
    }
    return parseStoredPayload(row["payload_json"]);
  }

  /** Deletes one payload by artifact id; true when it existed (retention surface). */
  async delete(artifactId: string): Promise<boolean> {
    return (
      this.db
        .prepare("DELETE FROM mi_transcript_payloads WHERE artifact_id = ?")
        .run(toSqlParam(artifactId)).changes > 0
    );
  }

  /** Clear-all per profile; returns the number of payloads removed (retention surface). */
  async clearAll(): Promise<number> {
    return this.db.prepare("DELETE FROM mi_transcript_payloads").run().changes;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the payload record: fixed key order (artifactId,
 * segments with startMs/endMs/text, checksum), no whitespace — the
 * byte-exact serialization the checksum is defined over. MIRROR of the
 * application layer's canonicalTranscriptSegmentsJson (see the module doc).
 */
function canonicalPayloadJson(payload: TranscriptPayload): string {
  return JSON.stringify({
    artifactId: payload.artifactId,
    segments: payload.segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
    checksum: payload.checksum,
  });
}

/**
 * The payload checksum: FNV-1a 32-bit over the canonical segments JSON,
 * formatted `fnv1a32:<8 hex digits>`. MIRROR of the application layer's
 * transcriptPayloadChecksum (see the module doc — byte-equality pinned by
 * tests). NOT a cryptographic claim.
 */
function mirroredTranscriptPayloadChecksum(segments: readonly TranscriptSegment[]): string {
  const text = JSON.stringify(
    segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** Defensive write-path validation: shape + checksum agreement, typed errors. */
function validatePayloadShape(payload: TranscriptPayload): TranscriptPayload {
  if (typeof payload.artifactId !== "string" || payload.artifactId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "transcript payload artifactId must be a non-blank string",
      retryable: false,
      context: { subject: "TranscriptPayload.artifactId" },
    });
  }
  if (!Array.isArray(payload.segments)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "transcript payload segments must be an array of TranscriptSegment",
      retryable: false,
      context: { subject: "TranscriptPayload.segments", artifactId: payload.artifactId },
    });
  }
  for (const segment of payload.segments) {
    parseOrThrow(
      TranscriptSegmentSchema,
      segment,
      ErrorCode.IntelligenceArtifactInvalid,
      "TranscriptPayload.segment",
    );
  }
  if (typeof payload.checksum !== "string" || payload.checksum.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "transcript payload checksum must be a non-blank string",
      retryable: false,
      context: { subject: "TranscriptPayload.checksum", artifactId: payload.artifactId },
    });
  }
  const expected = mirroredTranscriptPayloadChecksum(payload.segments);
  if (payload.checksum !== expected) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `transcript payload checksum mismatch: got ${payload.checksum}, segments hash to ${expected}`,
      retryable: false,
      context: {
        subject: "TranscriptPayload.checksum",
        artifactId: payload.artifactId,
        expected,
      },
    });
  }
  return payload;
}

/**
 * Parses the stored canonical-JSON column back through the locked schema and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled payloads). Mirrors the 0002
 * parseStored precedent plus the integrity re-check.
 */
function parseStoredPayload(raw: unknown): TranscriptPayload {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored transcript payload row is not valid JSON: ${detail}`,
      retryable: false,
      context: {
        subject: "TranscriptPayload",
        stored: typeof raw === "string" ? raw.slice(0, 120) : raw,
      },
    });
  }
  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored transcript payload row is not a JSON object",
      retryable: false,
      context: { subject: "TranscriptPayload" },
    });
  }
  const record = parsedJson as Record<string, unknown>;
  const artifactId = record["artifactId"];
  const segments = record["segments"];
  const checksum = record["checksum"];
  if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored transcript payload row has a blank artifactId",
      retryable: false,
      context: { subject: "TranscriptPayload.artifactId" },
    });
  }
  if (!Array.isArray(segments)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored transcript payload row has a non-array segments field",
      retryable: false,
      context: { subject: "TranscriptPayload.segments", artifactId },
    });
  }
  const parsedSegments: TranscriptSegment[] = [];
  for (const segment of segments) {
    parsedSegments.push(
      parseOrThrow(
        TranscriptSegmentSchema,
        segment,
        ErrorCode.IntelligenceArtifactInvalid,
        "TranscriptPayload.segment",
      ),
    );
  }
  if (typeof checksum !== "string" || checksum.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored transcript payload row has a blank checksum",
      retryable: false,
      context: { subject: "TranscriptPayload.checksum", artifactId },
    });
  }
  const expected = mirroredTranscriptPayloadChecksum(parsedSegments);
  if (checksum !== expected) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored transcript payload failed its checksum verification: row says ${checksum}, segments hash to ${expected} — the row is corrupt or was tampered with`,
      retryable: false,
      context: { subject: "TranscriptPayload.checksum", artifactId, expected, stored: checksum },
    });
  }
  return { artifactId, segments: parsedSegments, checksum };
}

/** The typed absent error (mirror of the application layer's factory). */
function transcriptPayloadAbsent(artifactId: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.IntelligenceTranscriptPayloadAbsent,
    reason:
      `no stored transcript payload for artifact "${artifactId}" — ` +
      "the transcript predates payload persistence or was never run through it; re-run mi.transcribe to produce a payload-backed transcript",
    retryable: false,
    context: { artifactId },
  });
}
