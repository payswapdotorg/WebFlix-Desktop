/**
 * TranscriptPayload — the durable transcript segment payload record
 * (P4-SUMMARIZE scope row 1: the P4-TRANSCRIBE recorded adjacency resolved —
 * "transcript segment payloads are NOT persisted yet").
 *
 * One record per transcript DerivedArtifact id: the engine's segments plus
 * the payload checksum. The DURABLE store (local-library, migration 0004)
 * keys its own `mi_transcript_payloads` table by `artifactId`; the IN-MEMORY
 * default below (in-memory-intelligence-stores.ts) is the pure-test default.
 * Both are structural mirrors of the SAME port (./ports.ts) — the checksum
 * algorithm lives HERE, in the platform-pure application layer, so both
 * adapters and every caller agree on it byte-for-byte.
 *
 * CHECKSUM HONESTY: the checksum is FNV-1a 32-bit over the canonical
 * segments JSON — the same digest family the transcribe/summary lineages
 * use for inputsHash. It is an IDENTITY checksum (same segments => same
 * checksum, forever; different segments => a different checksum with
 * overwhelming likelihood), NOT a cryptographic integrity claim — it detects
 * accidental corruption and tampering-by-mistake, and the durable store
 * re-verifies it on every read so a mismatched row surfaces as a TYPED
 * WebFlixError instead of silently-mangled transcript data.
 */
import { ErrorCode, TranscriptSegmentSchema, WebFlixError } from "webflix-contracts";
import type { TranscriptSegment } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";

/** The persisted payload of one transcript artifact. */
export interface TranscriptPayload {
  /** The transcript DerivedArtifact id this payload belongs to. */
  readonly artifactId: string;
  /** The transcript segments, verbatim as the engine reported them. */
  readonly segments: readonly TranscriptSegment[];
  /** The identity checksum over the canonical segments JSON (see module doc). */
  readonly checksum: string;
}

/**
 * Canonical JSON of a segment list: fixed key order (startMs, endMs, text),
 * no whitespace. This is the byte-exact serialization the checksum is
 * defined over — changing ANY byte of it changes the checksum (which is the
 * point: it is the payload's identity).
 */
export function canonicalTranscriptSegmentsJson(segments: readonly TranscriptSegment[]): string {
  return JSON.stringify(
    segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  );
}

/**
 * The payload checksum: FNV-1a 32-bit over the canonical segments JSON,
 * formatted `fnv1a32:<8 hex digits>`. Deterministic, platform-pure, no
 * wall clock, no randomness — the same segments produce the same checksum
 * on every machine, forever. NOT a cryptographic claim (see module doc).
 */
export function transcriptPayloadChecksum(segments: readonly TranscriptSegment[]): string {
  const text = canonicalTranscriptSegmentsJson(segments);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Defensive shape validation shared by every TranscriptPayloadStore
 * implementation on WRITE: each segment is re-checked through the locked
 * TranscriptSegmentSchema, the ids/checksum must be non-blank strings, and
 * the checksum must MATCH the segments (a caller passing a mismatched
 * checksum is a defect, never silently persisted). Violations are typed
 * IntelligenceArtifactInvalid WebFlixErrors — the artifact-family code this
 * payload belongs to.
 */
export function assertValidTranscriptPayload(payload: TranscriptPayload): void {
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
  const expected = transcriptPayloadChecksum(payload.segments);
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
}

/**
 * The typed absent error every TranscriptPayloadStore implementation
 * rejects with on a missing key: surfaced (never hidden, never an empty
 * substitute), with re-transcription named as the honest recovery.
 */
export function transcriptPayloadAbsent(artifactId: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.IntelligenceTranscriptPayloadAbsent,
    reason:
      `no stored transcript payload for artifact "${artifactId}" — ` +
      "the transcript predates payload persistence or was never run through it; re-run mi.transcribe to produce a payload-backed transcript",
    retryable: false,
    context: { artifactId },
  });
}
