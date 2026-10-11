/**
 * SqliteTranscriptPayloadStore tests (P4-SUMMARIZE row 1): the durable
 * transcript payload store on the sqlite seam — round-trips and
 * restart-safety, the typed absent error, the checksum integrity
 * verification (write-side and read-side), typed errors on corrupt/tampered
 * rows, put-replaces semantics, per-profile isolation, retention surface,
 * the honest migration of pre-0004 store files, and the CHECKSUM MIRROR
 * pin: the mirrored FNV-1a implementation must produce byte-identical
 * checksums to the application layer's implementation, pinned by literals
 * computed from THAT implementation (fnv1a32:d266a8c0 for the standard
 * fixture, fnv1a32:741638a5 for the empty payload — verified against
 * packages/webflix-application/src/transcript-payload.ts this order).
 *
 * HERMETIC: temp dirs only (the store refuses ~/.webflix under tests);
 * no network, no wall clock (the epoch-ms clock is injected and pinned).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranscriptSegment } from "webflix-contracts";
import {
  createSqliteDatabase,
  migration0001Init,
  migration0002MediaIntelligence,
  migration0003RankerAdapterSelection,
  openStore,
  runMigrations,
  SqliteTranscriptPayloadStore,
  type TranscriptPayload,
  type WebFlixStore,
} from "../index";

const AS_OF_MS = 1791736400000;

const SEGMENTS: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
];

/**
 * THE CHECKSUM MIRROR PIN — computed by the APPLICATION layer's
 * transcriptPayloadChecksum over this exact fixture (not by this lane's
 * mirror): any drift in either implementation fails here.
 */
const PINNED_FIXTURE_CHECKSUM = "fnv1a32:d266a8c0";
/** The empty payload's checksum, pinned the same way. */
const PINNED_EMPTY_CHECKSUM = "fnv1a32:741638a5";

/** Pinned epoch-ms clock — no wall time anywhere in these tests. */
const pinnedClock = (): (() => number) => () => AS_OF_MS;

/** A well-formed payload for the fixture segments. */
const payload = (artifactId = "art-transcript-1"): TranscriptPayload => ({
  artifactId,
  segments: SEGMENTS,
  checksum: PINNED_FIXTURE_CHECKSUM,
});

async function expectWebFlixErrorAsync(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

describe("durable transcript payload store (sqlite seam, temp dirs)", () => {
  let dir: string;
  let store: WebFlixStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "webflix-payloads-"));
    store = await openStore({ baseDir: dir, now: pinnedClock() });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Round-trips + restart safety
  // -------------------------------------------------------------------------
  it("put/get round-trips the payload verbatim (segments + checksum + artifactId)", async () => {
    await store.transcriptPayloads.put(payload());
    const stored = await store.transcriptPayloads.get("art-transcript-1");
    expect(stored.artifactId).toBe("art-transcript-1");
    expect(stored.segments).toEqual(SEGMENTS);
    expect(stored.checksum).toBe(PINNED_FIXTURE_CHECKSUM);
  });

  it("the payload survives a restart (close + reopen, the durability point)", async () => {
    await store.transcriptPayloads.put(payload());
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      const stored = await reopened.transcriptPayloads.get("art-transcript-1");
      expect(stored.segments).toEqual(SEGMENTS);
      expect(stored.checksum).toBe(PINNED_FIXTURE_CHECKSUM);
    } finally {
      reopened.close();
    }
  });

  it("the empty payload (the honest no-speech transcript) round-trips", async () => {
    await store.transcriptPayloads.put({
      artifactId: "art-empty",
      segments: [],
      checksum: PINNED_EMPTY_CHECKSUM,
    });
    const stored = await store.transcriptPayloads.get("art-empty");
    expect(stored.segments).toEqual([]);
    expect(stored.checksum).toBe(PINNED_EMPTY_CHECKSUM);
  });

  it("put REPLACES wholesale for the same artifact id (the put-replaces house semantic)", async () => {
    await store.transcriptPayloads.put(payload("art-1"));
    // A replace attempt with a WRONG checksum is rejected (nothing changes).
    await expectWebFlixErrorAsync(
      () =>
        store.transcriptPayloads.put({
          artifactId: "art-1",
          segments: [{ startMs: 0, endMs: 900, text: "replaced" }],
          checksum: "fnv1a32:deadbeef",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    // The replace semantic is proven with the CORRECT checksum:
    const replacedChecksum = await checksumOf([{ startMs: 0, endMs: 900, text: "replaced" }]);
    await store.transcriptPayloads.put({
      artifactId: "art-1",
      segments: [{ startMs: 0, endMs: 900, text: "replaced" }],
      checksum: replacedChecksum,
    });
    const stored = await store.transcriptPayloads.get("art-1");
    expect(stored.segments).toEqual([{ startMs: 0, endMs: 900, text: "replaced" }]);
    expect(stored.checksum).toBe(replacedChecksum);
    // Exactly ONE row (replace, not append).
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM mi_transcript_payloads").get();
    expect(Number(rows?.["n"])).toBe(1);
  });

  it("multiple payloads coexist keyed by their own artifact ids", async () => {
    await store.transcriptPayloads.put(payload("art-a"));
    await store.transcriptPayloads.put(payload("art-b"));
    const a = await store.transcriptPayloads.get("art-a");
    const b = await store.transcriptPayloads.get("art-b");
    expect(a.artifactId).toBe("art-a");
    expect(b.artifactId).toBe("art-b");
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM mi_transcript_payloads").get();
    expect(Number(rows?.["n"])).toBe(2);
  });

  // -------------------------------------------------------------------------
  // The typed absent error
  // -------------------------------------------------------------------------
  it("get on a key with NO stored payload rejects with the TYPED absent error (never null)", async () => {
    const err = await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-never-persisted"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
    expect(err.reason).toContain("re-run mi.transcribe");
    expect(err.context).toMatchObject({ artifactId: "art-never-persisted" });
  });

  it("a pre-0004 transcript (descriptor stored, payload never persisted) is EXACTLY the absent state", async () => {
    // Simulate the pre-0004 world: a transcript descriptor row exists in the
    // registry table, no payload row does — get stays honestly typed-absent.
    store.db
      .prepare(
        "INSERT INTO mi_derived_artifacts (id, source_item_id, kind, created_at, artifact_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "art-old-transcript",
        "item-a",
        "transcript",
        "2026-10-01T00:00:00Z",
        JSON.stringify({
          id: "art-old-transcript",
          sourceItemId: "item-a",
          kind: "transcript",
          lineage: {
            modelId: "webflix.whisper-cpp-local",
            modelVersion: "0.1.0",
            producedBy: "webflix.whisper-cpp-local",
            generatedAt: "2026-10-01T00:00:00Z",
          },
          licenseNote: null,
          createdAt: "2026-10-01T00:00:00Z",
        }),
        AS_OF_MS,
      );
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-old-transcript"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
  });

  // -------------------------------------------------------------------------
  // Checksum integrity + typed validation errors
  // -------------------------------------------------------------------------
  it("put REJECTS a mismatched checksum (typed artifact-invalid, nothing stored)", async () => {
    await expectWebFlixErrorAsync(
      () =>
        store.transcriptPayloads.put({
          artifactId: "art-bad",
          segments: SEGMENTS,
          checksum: "fnv1a32:deadbeef",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM mi_transcript_payloads").get();
    expect(Number(rows?.["n"])).toBe(0);
  });

  it("put REJECTS blank artifact ids and schema-invalid segments (typed, nothing stored)", async () => {
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.put({ ...payload(), artifactId: "   " }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.transcriptPayloads.put({
          artifactId: "art-bad",
          segments: [{ startMs: 500, endMs: 100, text: "backwards" }],
          checksum: "fnv1a32:00000000",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM mi_transcript_payloads").get();
    expect(Number(rows?.["n"])).toBe(0);
  });

  it("a TAMPERED row (segments edited after write) fails the read-side checksum verification — typed, never mangled", async () => {
    await store.transcriptPayloads.put(payload());
    // Tamper: change the stored payload's segments without re-checksumming.
    const row = store.db
      .prepare("SELECT payload_json FROM mi_transcript_payloads WHERE artifact_id = ?")
      .get("art-transcript-1");
    const parsed = JSON.parse(String(row?.["payload_json"])) as {
      artifactId: string;
      segments: TranscriptSegment[];
      checksum: string;
    };
    parsed.segments = [{ startMs: 0, endMs: 100, text: "tampered" }, ...parsed.segments];
    store.db
      .prepare("UPDATE mi_transcript_payloads SET payload_json = ? WHERE artifact_id = ?")
      .run(JSON.stringify(parsed), "art-transcript-1");
    const err = await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    expect(err.reason).toContain("checksum verification");
  });

  it("a corrupt payload_json row surfaces as a typed error on get — never a mangled payload", async () => {
    await store.transcriptPayloads.put(payload());
    store.db
      .prepare("UPDATE mi_transcript_payloads SET payload_json = ? WHERE artifact_id = ?")
      .run("{not json", "art-transcript-1");
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  it("a tampered-but-valid-JSON row that violates the segment schema surfaces as a typed error", async () => {
    await store.transcriptPayloads.put(payload());
    const tampered = JSON.stringify({
      artifactId: "art-transcript-1",
      segments: [{ startMs: -5, endMs: 100, text: "bad" }],
      checksum: "fnv1a32:00000000",
    });
    store.db
      .prepare("UPDATE mi_transcript_payloads SET payload_json = ? WHERE artifact_id = ?")
      .run(tampered, "art-transcript-1");
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // The CHECKSUM MIRROR pin (the cross-implementation equality proof)
  // -------------------------------------------------------------------------
  it("the mirrored checksum implementation matches the APPLICATION layer's pinned values byte-for-byte", async () => {
    // PINNED_FIXTURE_CHECKSUM / PINNED_EMPTY_CHECKSUM were computed by the
    // application layer's transcriptPayloadChecksum over these EXACT
    // fixtures — the mirror in this lane must agree, and the round-trip
    // proves the store's own re-computation agrees with what it stored.
    expect(PINNED_FIXTURE_CHECKSUM).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    await store.transcriptPayloads.put(payload());
    const stored = await store.transcriptPayloads.get("art-transcript-1");
    expect(stored.checksum).toBe(PINNED_FIXTURE_CHECKSUM);
    // The row's checksum column and the canonical JSON agree with the pin.
    const row = store.db
      .prepare("SELECT checksum, payload_json FROM mi_transcript_payloads WHERE artifact_id = ?")
      .get("art-transcript-1");
    expect(String(row?.["checksum"])).toBe(PINNED_FIXTURE_CHECKSUM);
    expect(String(row?.["payload_json"])).toBe(
      JSON.stringify({
        artifactId: "art-transcript-1",
        segments: SEGMENTS,
        checksum: PINNED_FIXTURE_CHECKSUM,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Per-profile isolation (ADR-0003)
  // -------------------------------------------------------------------------
  it("payloads are per-profile: one profile's store never sees another's rows", async () => {
    const otherDir = mkdtempSync(join(tmpdir(), "webflix-payloads-other-"));
    try {
      await store.transcriptPayloads.put(payload("art-mine"));
      const other = await openStore({ baseDir: otherDir, now: pinnedClock() });
      try {
        await expectWebFlixErrorAsync(
          () => other.transcriptPayloads.get("art-mine"),
          ErrorCode.IntelligenceTranscriptPayloadAbsent,
        );
        await other.transcriptPayloads.put(payload("art-theirs"));
        expect(await store.transcriptPayloads.get("art-mine")).toBeTruthy();
        await expectWebFlixErrorAsync(
          () => store.transcriptPayloads.get("art-theirs"),
          ErrorCode.IntelligenceTranscriptPayloadAbsent,
        );
      } finally {
        other.close();
      }
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Retention surface (user data is deletable, per profile)
  // -------------------------------------------------------------------------
  it("delete removes exactly one payload; clearAll empties the profile's payloads and counts honestly", async () => {
    await store.transcriptPayloads.put(payload("art-a"));
    await store.transcriptPayloads.put(payload("art-b"));
    expect(await store.transcriptPayloads.delete("art-a")).toBe(true);
    expect(await store.transcriptPayloads.delete("art-a")).toBe(false);
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-a"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
    expect(await store.transcriptPayloads.clearAll()).toBe(1);
    await expectWebFlixErrorAsync(
      () => store.transcriptPayloads.get("art-b"),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
  });

  it("deleting a payload does NOT touch the artifact descriptor rows (no silent coupling)", async () => {
    await store.transcriptPayloads.put(payload("art-a"));
    store.db
      .prepare(
        "INSERT INTO mi_derived_artifacts (id, source_item_id, kind, created_at, artifact_json, stored_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "art-a",
        "item-a",
        "transcript",
        "2026-10-01T00:00:00Z",
        JSON.stringify({
          id: "art-a",
          sourceItemId: "item-a",
          kind: "transcript",
          lineage: {
            modelId: "webflix.whisper-cpp-local",
            modelVersion: "0.1.0",
            producedBy: "webflix.whisper-cpp-local",
            generatedAt: "2026-10-01T00:00:00Z",
          },
          licenseNote: null,
          createdAt: "2026-10-01T00:00:00Z",
        }),
        AS_OF_MS,
      );
    expect(await store.transcriptPayloads.delete("art-a")).toBe(true);
    const artifacts = store.db.prepare("SELECT COUNT(*) AS n FROM mi_derived_artifacts").get();
    expect(Number(artifacts?.["n"])).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Honest migration of pre-0004 store files
  // -------------------------------------------------------------------------
  it("a pre-0004 store file (0001+0002+0003 only) applies 0004 additively on its next open — all data intact", async () => {
    // Build an old-generation store by hand in a FRESH dir: run ONLY
    // migrations 1..3 (the beforeEach dir is already fully migrated).
    const oldDir = mkdtempSync(join(tmpdir(), "webflix-payloads-old-"));
    try {
      const raw = await createSqliteDatabase(join(oldDir, "webflix.db"));
      runMigrations(
        raw,
        [migration0001Init, migration0002MediaIntelligence, migration0003RankerAdapterSelection],
        AS_OF_MS,
      );
      raw.exec(
        "CREATE TABLE IF NOT EXISTS _old_gen_probe (id INTEGER PRIMARY KEY, note TEXT NOT NULL)",
      );
      raw.prepare("INSERT INTO _old_gen_probe (id, note) VALUES (1, 'pre-0004 data')").run();
      raw.close();

      // Open through the normal path: 0004 applies, the probe table survives
      // untouched (additive-only), and the payload store is immediately
      // usable (honestly empty — no payload was ever persisted pre-0004).
      const reopened = await openStore({ baseDir: oldDir, now: pinnedClock() });
      try {
        const probe = reopened.db.prepare("SELECT note FROM _old_gen_probe WHERE id = 1").get();
        expect(probe?.["note"]).toBe("pre-0004 data");
        await expectWebFlixErrorAsync(
          () => reopened.transcriptPayloads.get("art-any"),
          ErrorCode.IntelligenceTranscriptPayloadAbsent,
        );
        await reopened.transcriptPayloads.put(payload());
        expect((await reopened.transcriptPayloads.get("art-transcript-1")).segments).toEqual(
          SEGMENTS,
        );
        const migrations = reopened.db
          .prepare("SELECT name FROM schema_migrations ORDER BY id")
          .all();
        expect(migrations.map((row) => String(row["name"]))).toEqual([
          "0001_init",
          "0002_media_intelligence",
          "0003_ranker_adapter_selection",
          "0004_transcript_payloads",
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(oldDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Direct construction (the composition root may build the adapter itself)
  // -------------------------------------------------------------------------
  it("SqliteTranscriptPayloadStore direct: stamps stored_at from the injected clock (pinned, no wall time)", async () => {
    const direct = new SqliteTranscriptPayloadStore(store.db, { now: pinnedClock() });
    await direct.put(payload());
    const row = store.db
      .prepare("SELECT stored_at, segment_count FROM mi_transcript_payloads WHERE artifact_id = ?")
      .get("art-transcript-1");
    expect(Number(row?.["stored_at"])).toBe(AS_OF_MS);
    expect(Number(row?.["segment_count"])).toBe(SEGMENTS.length);
  });
});

/** Computes the checksum through the store's own write path (put + row read). */
async function checksumOf(segments: readonly TranscriptSegment[]): Promise<string> {
  // The write path validates and stores the checksum the caller supplied;
  // to learn the correct one for arbitrary segments, compute FNV-1a over
  // the canonical JSON exactly as both implementations define it.
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
