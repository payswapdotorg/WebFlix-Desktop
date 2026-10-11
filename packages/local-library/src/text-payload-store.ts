import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { DerivedArtifactKind } from "webflix-contracts";
import { toSqlParam, type SqliteDatabase } from "./db/adapter";

/**
 * Durable text payload store (P4-TRANSLATE row 2) on the local-library
 * storage seam — the TEXT projections of non-transcript derived artifacts
 * (kinds summary / overview / qa / translation), keyed by their artifact id
 * in the OWN `mi_text_payloads` table (additive migration 0005, the
 * 0002/0003/0004 rules).
 *
 * PORT MIRROR NOTE (the LocalStorePort / 0002 precedent, verbatim in
 * spirit): the port interface and the payload record below mirror the
 * shape of the application layer's TextPayloadStore and TextPayload
 * (packages/webflix-application/src/ports.ts + text-payload.ts); both sides
 * are structurally typed, so this adapter satisfies the application port
 * without a cross-package dependency from this lane. The composition root
 * wires them in a later order (explicitly NOT this order's scope).
 *
 * CHECKSUM MIRROR, stated honestly: the FNV-1a 32-bit checksum below is a
 * STRUCTURAL MIRROR of the application layer's textPayloadChecksum (the
 * algorithm lives in the platform-pure application layer so every caller
 * and both adapters agree on it byte-for-byte; this lane cannot import it,
 * so the function is mirrored here). Byte-equality between the two
 * implementations is PINNED by a literal constant in this suite's tests —
 * the value the application implementation produces for the pinned fixture
 * — so a drift in either implementation fails the gate. The checksum is an
 * IDENTITY checksum (accidental-corruption detection), NOT a cryptographic
 * claim.
 *
 * Per-profile isolation (ADR-0003): this adapter binds to ONE profile-scoped
 * SqliteDatabase handle. No adapter ever crosses profiles.
 *
 * Honesty rules enforced here (the 0004 store's rules, verbatim in intent):
 * - SHAPE validation on write AND read: the kind is checked against the
 *   text-payload kind set, and the checksum is RE-COMPUTED and compared on
 *   both paths — a corrupt or tampered row surfaces as a typed WebFlixError
 *   (IntelligenceArtifactInvalid), never as silently-mangled text;
 * - ABSENCE IS TYPED: `get` on a key with no stored row rejects with the
 *   typed intelligence/text-payload-absent error (never null, never an
 *   empty substitute) — the pre-0005 artifact state;
 * - `put` replaces wholesale for the same artifact id (the put-replaces
 *   house semantic);
 * - the store does NOT know the artifact registry (documented);
 * - no telemetry, no network, no randomness: the only stamp is the
 *   injected clock's epoch-ms (`stored_at`).
 */

/** The text-payload kind set this store persists (the application mirror). */
const TEXT_PAYLOAD_KINDS: readonly string[] = ["summary", "overview", "qa", "translation"];

/** Narrows a stored/written kind string to the text-payload kind set. */
function isTextPayloadKind(value: string): value is DerivedArtifactKind {
  return TEXT_PAYLOAD_KINDS.includes(value);
}

/** The persisted text payload of one (non-transcript) derived artifact (structural mirror). */
export interface TextPayload {
  readonly artifactId: string;
  readonly kind: DerivedArtifactKind;
  /** The kind's documented text projection (MAY be empty — an honest empty artifact). */
  readonly text: string;
  readonly languageTag?: string;
  readonly checksum: string;
}

/** Per-profile text payload store (structural port mirror). */
export interface TextPayloadStorePort {
  /** Persists (or replaces) the payload for one derived artifact id. */
  put(payload: TextPayload): Promise<void>;
  /**
   * The stored payload; rejects with the typed absent error when none was
   * persisted (never null — absence is typed and surfaced).
   */
  get(artifactId: string): Promise<TextPayload>;
}

export interface TextPayloadStoreOptions {
  /** Injectable epoch-ms clock (tests pin it; default Date.now). */
  now?: () => number;
}

/** Durable TextPayloadStore: rows in `mi_text_payloads`. */
export class SqliteTextPayloadStore implements TextPayloadStorePort {
  private readonly db: SqliteDatabase;
  private readonly clock: () => number;

  constructor(db: SqliteDatabase, options: TextPayloadStoreOptions = {}) {
    this.db = db;
    this.clock = options.now ?? (() => Date.now());
  }

  async put(payload: TextPayload): Promise<void> {
    const validated = validatePayloadShape(payload);
    this.db
      .prepare(
        "INSERT INTO mi_text_payloads (artifact_id, kind, language_tag, checksum, payload_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(artifact_id) DO UPDATE SET kind = excluded.kind, language_tag = excluded.language_tag, " +
          "checksum = excluded.checksum, payload_json = excluded.payload_json, stored_at = excluded.stored_at",
      )
      .run(
        toSqlParam(validated.artifactId),
        toSqlParam(validated.kind),
        toSqlParam(validated.languageTag ?? null),
        toSqlParam(validated.checksum),
        toSqlParam(canonicalPayloadJson(validated)),
        toSqlParam(this.clock()),
      );
  }

  async get(artifactId: string): Promise<TextPayload> {
    const row = this.db
      .prepare("SELECT payload_json FROM mi_text_payloads WHERE artifact_id = ?")
      .get(toSqlParam(artifactId));
    if (row === undefined) {
      throw textPayloadAbsent(artifactId);
    }
    return parseStoredPayload(row["payload_json"]);
  }

  /** Deletes one payload by artifact id; true when it existed (retention surface). */
  async delete(artifactId: string): Promise<boolean> {
    return (
      this.db
        .prepare("DELETE FROM mi_text_payloads WHERE artifact_id = ?")
        .run(toSqlParam(artifactId)).changes > 0
    );
  }

  /** Clear-all per profile; returns the number of payloads removed (retention surface). */
  async clearAll(): Promise<number> {
    return this.db.prepare("DELETE FROM mi_text_payloads").run().changes;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of the payload record: fixed key order (artifactId, kind,
 * text, languageTag only when present, checksum), no whitespace — the
 * byte-exact serialization the store round-trips through. MIRROR intent of
 * the application layer's record shape (see the module doc).
 */
function canonicalPayloadJson(payload: TextPayload): string {
  return JSON.stringify({
    artifactId: payload.artifactId,
    kind: payload.kind,
    text: payload.text,
    ...(payload.languageTag !== undefined ? { languageTag: payload.languageTag } : {}),
    checksum: payload.checksum,
  });
}

/**
 * The payload checksum: FNV-1a 32-bit over the text, formatted
 * `fnv1a32:<8 hex digits>`. MIRROR of the application layer's
 * textPayloadChecksum (see the module doc — byte-equality pinned by
 * tests). NOT a cryptographic claim.
 */
function mirroredTextPayloadChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

/** Defensive write-path validation: shape + checksum agreement, typed errors. */
function validatePayloadShape(payload: TextPayload): TextPayload {
  if (typeof payload.artifactId !== "string" || payload.artifactId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "text payload artifactId must be a non-blank string",
      retryable: false,
      context: { subject: "TextPayload.artifactId" },
    });
  }
  if (typeof payload.kind !== "string" || !isTextPayloadKind(payload.kind)) {
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
  const expected = mirroredTextPayloadChecksum(payload.text);
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
  return payload;
}

/**
 * Parses the stored canonical-JSON column back into the payload record and
 * re-verifies the checksum — corrupt or tampered rows surface as typed
 * WebFlixErrors (never silently-mangled payloads). Mirrors the 0004
 * parseStored precedent plus the integrity re-check.
 */
function parseStoredPayload(raw: unknown): TextPayload {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(typeof raw === "string" ? raw : String(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid JSON";
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored text payload row is not valid JSON: ${detail}`,
      retryable: false,
      context: {
        subject: "TextPayload",
        stored: typeof raw === "string" ? raw.slice(0, 120) : raw,
      },
    });
  }
  if (typeof parsedJson !== "object" || parsedJson === null || Array.isArray(parsedJson)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored text payload row is not a JSON object",
      retryable: false,
      context: { subject: "TextPayload" },
    });
  }
  const record = parsedJson as Record<string, unknown>;
  const artifactId = record["artifactId"];
  const kind = record["kind"];
  const text = record["text"];
  const languageTag = record["languageTag"];
  const checksum = record["checksum"];
  if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored text payload row has a blank artifactId",
      retryable: false,
      context: { subject: "TextPayload.artifactId" },
    });
  }
  if (typeof kind !== "string" || !isTextPayloadKind(kind)) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored text payload row has a kind outside ${TEXT_PAYLOAD_KINDS.join(", ")}: ${JSON.stringify(kind)}`,
      retryable: false,
      context: { subject: "TextPayload.kind", artifactId },
    });
  }
  if (typeof text !== "string") {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored text payload row has a non-string text field",
      retryable: false,
      context: { subject: "TextPayload.text", artifactId },
    });
  }
  if (
    languageTag !== undefined &&
    (typeof languageTag !== "string" || languageTag.trim().length === 0)
  ) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored text payload row has a blank languageTag",
      retryable: false,
      context: { subject: "TextPayload.languageTag", artifactId },
    });
  }
  if (typeof checksum !== "string" || checksum.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: "stored text payload row has a blank checksum",
      retryable: false,
      context: { subject: "TextPayload.checksum", artifactId },
    });
  }
  const expected = mirroredTextPayloadChecksum(text);
  if (checksum !== expected) {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceArtifactInvalid,
      reason: `stored text payload failed its checksum verification: row says ${checksum}, text hashes to ${expected} — the row is corrupt or was tampered with`,
      retryable: false,
      context: { subject: "TextPayload.checksum", artifactId, expected, stored: checksum },
    });
  }
  return {
    artifactId,
    kind,
    text,
    ...(languageTag !== undefined ? { languageTag } : {}),
    checksum,
  };
}

/** The typed absent error (mirror of the application layer's factory). */
function textPayloadAbsent(artifactId: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.IntelligenceTextPayloadAbsent,
    reason:
      `no stored text payload for artifact "${artifactId}" — ` +
      "the artifact predates text-projection persistence or its producing run never persisted one; re-run the producing use case (mi.summarize / mi.overview / mi.qa / mi.translate) to produce a payload-backed artifact",
    retryable: false,
    context: { artifactId },
  });
}
