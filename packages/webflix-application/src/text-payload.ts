/**
 * TextPayload — the durable TEXT projection record for non-transcript
 * derived artifacts (P4-TRANSLATE row 2: mi.translate reads "a stored text
 * payload by artifact id (transcript/summary/overview/qa …)" and persists
 * the translated text the same way).
 *
 * One record per derived-artifact id (kinds summary / overview / qa /
 * translation): the artifact's TEXT PROJECTION plus its identity checksum.
 * The projection rule per kind is FIXED and documented (never
 * re-interpreted by a reader):
 * - summary:    its sentence texts, joined with single spaces, source order;
 * - overview:   its chapter titles, joined with single spaces, timeline order;
 * - qa:         its span quotes, joined with single spaces, citation order;
 * - translation: the translated text, exactly as the engine produced it.
 * A transcript's text is NOT stored here — its payload is the segment list
 * in the TRANSCRIPT payload store (0004); readers project transcripts by
 * joining their segment texts (the shared reading seam in
 * mi-translate-tts.ts owns that projection too).
 *
 * The projection MAY be empty (an empty summary is an honest artifact): the
 * record stores that fact honestly — a reader handed an empty projection
 * surfaces the typed "nothing to translate/synthesize" invalid, never a
 * fabricated text.
 *
 * The DURABLE store (local-library, migration 0005 `mi_text_payloads`)
 * keys its own table by `artifactId`; the IN-MEMORY default lives in
 * in-memory-intelligence-stores.ts. Both are structural mirrors of the SAME
 * port (./ports.ts) — the checksum algorithm lives HERE, in the
 * platform-pure application layer, so both adapters and every caller agree
 * on it byte-for-byte (the transcript-payload precedent).
 *
 * CHECKSUM HONESTY: the checksum is FNV-1a 32-bit over the text itself —
 * the same digest family every MI lineage uses for inputsHash. It is an
 * IDENTITY checksum (same text => same checksum, forever), NOT a
 * cryptographic integrity claim — it detects accidental corruption and
 * tampering-by-mistake, and the durable store re-verifies it on every read
 * so a mismatched row surfaces as a TYPED WebFlixError instead of
 * silently-mangled text.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { DerivedArtifactKind } from "webflix-contracts";

/** The artifact kinds whose text projections live in the text payload store. */
export const TEXT_PAYLOAD_KINDS: readonly DerivedArtifactKind[] = [
  "summary",
  "overview",
  "qa",
  "translation",
];

/** The persisted text payload of one (non-transcript) derived artifact. */
export interface TextPayload {
  /** The derived-artifact id this text projection belongs to. */
  readonly artifactId: string;
  /** The artifact's kind — one of TEXT_PAYLOAD_KINDS (shape-checked on write AND read). */
  readonly kind: DerivedArtifactKind;
  /** The kind's documented text projection (MAY be empty — an honest empty artifact). */
  readonly text: string;
  /** The text's language tag when known (translations carry their target); absent otherwise. */
  readonly languageTag?: string;
  /** The identity checksum over the text (see module doc). */
  readonly checksum: string;
}

/**
 * The payload checksum: FNV-1a 32-bit over the text, formatted
 * `fnv1a32:<8 hex digits>`. Deterministic, platform-pure, no wall clock, no
 * randomness — the same text produces the same checksum on every machine,
 * forever. NOT a cryptographic claim (see module doc).
 */
export function textPayloadChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Defensive shape validation shared by every TextPayloadStore
 * implementation on WRITE: the id must be non-blank, the kind must be one
 * of TEXT_PAYLOAD_KINDS, the text a string (possibly empty — the honest
 * empty projection), the languageTag (when present) non-blank, and the
 * checksum must MATCH the text (a caller passing a mismatched checksum is
 * a defect, never silently persisted). Violations are typed
 * IntelligenceArtifactInvalid WebFlixErrors — the artifact-family code this
 * payload belongs to.
 */
export function assertValidTextPayload(payload: TextPayload): void {
  if (typeof payload.artifactId !== "string" || payload.artifactId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "text payload artifactId must be a non-blank string",
      retryable: false,
      context: { subject: "TextPayload.artifactId" },
    });
  }
  if (typeof payload.kind !== "string" || !TEXT_PAYLOAD_KINDS.includes(payload.kind)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `text payload kind must be one of ${TEXT_PAYLOAD_KINDS.join(", ")}, got ${JSON.stringify(payload.kind)}`,
      retryable: false,
      context: { subject: "TextPayload.kind", artifactId: payload.artifactId },
    });
  }
  if (typeof payload.text !== "string") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "text payload text must be a string (possibly empty — the honest empty projection)",
      retryable: false,
      context: { subject: "TextPayload.text", artifactId: payload.artifactId },
    });
  }
  if (
    payload.languageTag !== undefined &&
    (typeof payload.languageTag !== "string" || payload.languageTag.trim().length === 0)
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "text payload languageTag, when present, must be a non-blank string",
      retryable: false,
      context: { subject: "TextPayload.languageTag", artifactId: payload.artifactId },
    });
  }
  if (typeof payload.checksum !== "string" || payload.checksum.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "text payload checksum must be a non-blank string",
      retryable: false,
      context: { subject: "TextPayload.checksum", artifactId: payload.artifactId },
    });
  }
  const expected = textPayloadChecksum(payload.text);
  if (payload.checksum !== expected) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `text payload checksum mismatch: got ${payload.checksum}, text hashes to ${expected}`,
      retryable: false,
      context: {
        subject: "TextPayload.checksum",
        artifactId: payload.artifactId,
        expected,
      },
    });
  }
}

/**
 * The typed absent error every TextPayloadStore implementation rejects
 * with on a missing key: surfaced (never hidden, never an empty
 * substitute) with the honest recovery — re-run the producing use case
 * (mi.summarize / mi.overview / mi.qa / mi.translate) so the artifact's
 * text projection is persisted.
 */
export function textPayloadAbsent(artifactId: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.IntelligenceTextPayloadAbsent,
    reason:
      `no stored text payload for artifact "${artifactId}" — ` +
      "the artifact predates text-projection persistence or its producing run never persisted one; re-run the producing use case (mi.summarize / mi.overview / mi.qa / mi.translate) to produce a payload-backed artifact",
    retryable: false,
    context: { artifactId },
  });
}
