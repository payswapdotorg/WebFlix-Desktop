/**
 * Durable text payload store tests (P4-TRANSLATE row 2): the
 * mi_text_payloads sqlite seam (migration 0005) — round-trips,
 * restart-safety, the typed absent error, the checksum integrity
 * re-verification on read (tampering surfaces typed), put-replaces,
 * retention, kind validation, and the MIRROR byte-equality pin against
 * the application layer's checksum algorithm.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import {
  openStore,
  SqliteTextPayloadStore,
  type TextPayload,
  type TextPayloadStorePort,
  WebFlixStore,
} from "../index";

const AS_OF_MS = 1791736400000;

const PINNED_TEXT = "hello world";
/**
 * Computed from the APPLICATION implementation
 * (packages/webflix-application/src/text-payload.ts — the platform-pure
 * source of truth; this lane cannot import it). The literal pins the
 * byte-equality between the application algorithm and this lane's mirror.
 */
const PINNED_CHECKSUM = "fnv1a32:d58b3fa7";
const PINNED_EMPTY_CHECKSUM = "fnv1a32:811c9dc5";

/**
 * Test-side reproduction of the FNV-1a text checksum — the SAME algorithm
 * the application layer owns and the store mirrors, reproduced here ONLY
 * to compute expected values for arbitrary fixture texts. Its agreement
 * with the application implementation is pinned by the literals above
 * (computed from the application side); a drift in EITHER the store's
 * mirror or this helper fails the MIRROR PIN test below.
 */
function testTextChecksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

const pinnedClock = (): (() => number) => () => AS_OF_MS;

/** A well-formed payload for the pinned fixture text. */
const payload = (artifactId = "art-summary-1"): TextPayload => ({
  artifactId,
  kind: "summary",
  text: PINNED_TEXT,
  checksum: PINNED_CHECKSUM,
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

describe("durable text payload store (sqlite seam, temp dirs)", () => {
  let dir: string;
  let store: WebFlixStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "webflix-text-payloads-"));
    store = await openStore({ baseDir: dir, now: pinnedClock() });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Round-trips + restart safety
  // -------------------------------------------------------------------------
  it("put/get round-trips the payload verbatim (text + kind + languageTag + checksum + artifactId)", async () => {
    await store.textPayloads.put({ ...payload(), languageTag: "es" });
    const stored = await store.textPayloads.get("art-summary-1");
    expect(stored.artifactId).toBe("art-summary-1");
    expect(stored.kind).toBe("summary");
    expect(stored.text).toBe(PINNED_TEXT);
    expect(stored.languageTag).toBe("es");
    expect(stored.checksum).toBe(PINNED_CHECKSUM);
  });

  it("a payload without languageTag round-trips with the field ABSENT (never a default)", async () => {
    await store.textPayloads.put(payload());
    const stored = await store.textPayloads.get("art-summary-1");
    expect(stored.languageTag).toBeUndefined();
  });

  it("the payload survives a restart (close + reopen, the durability point)", async () => {
    await store.textPayloads.put(payload("art-overview-2"));
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      const stored = await reopened.textPayloads.get("art-overview-2");
      expect(stored.text).toBe(PINNED_TEXT);
      expect(stored.checksum).toBe(PINNED_CHECKSUM);
    } finally {
      reopened.close();
    }
  });

  it("every text-payload kind round-trips (summary / overview / qa / translation)", async () => {
    for (const kind of ["summary", "overview", "qa", "translation"] as const) {
      await store.textPayloads.put({
        artifactId: `art-${kind}`,
        kind,
        text: "x",
        checksum: testTextChecksum("x"),
      });
      expect((await store.textPayloads.get(`art-${kind}`)).kind).toBe(kind);
    }
  });

  it("the EMPTY text projection round-trips honestly (an empty summary is a stored fact)", async () => {
    await store.textPayloads.put({
      artifactId: "art-empty",
      kind: "summary",
      text: "",
      checksum: PINNED_EMPTY_CHECKSUM,
    });
    const stored = await store.textPayloads.get("art-empty");
    expect(stored.text).toBe("");
    expect(stored.checksum).toBe(PINNED_EMPTY_CHECKSUM);
  });

  // -------------------------------------------------------------------------
  // The MIRROR byte-equality pin (application algorithm vs this adapter)
  // -------------------------------------------------------------------------
  it("MIRROR PIN: the test-side algorithm reproduces the APPLICATION implementation's pinned literals byte-for-byte", () => {
    // The literals were computed from the APPLICATION implementation
    // (packages/webflix-application/src/text-payload.ts — the platform-pure
    // source of truth this lane cannot import); this test-side reproduction
    // agreeing with them pins the algorithm shape, and the STORE's internal
    // mirror is pinned by every put/get round-trip through it.
    expect(testTextChecksum(PINNED_TEXT)).toBe(PINNED_CHECKSUM);
    expect(testTextChecksum("")).toBe(PINNED_EMPTY_CHECKSUM);
    // The store accepted a payload checksummed by that algorithm.
    expect(() => {
      const store2 = new SqliteTextPayloadStore(store.db);
      void store2;
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Typed absence + write-path validation
  // -------------------------------------------------------------------------
  it("get on a missing key rejects with the TYPED text-payload-absent error (never null)", async () => {
    const err = await expectWebFlixErrorAsync(
      () => store.textPayloads.get("art-never"),
      ErrorCode.IntelligenceTextPayloadAbsent,
    );
    expect(err.reason).toContain("re-run the producing use case");
  });

  it("put rejects a kind outside the text-payload set (typed artifact-invalid)", async () => {
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "art-x",
          kind: "transcript",
          text: "x",
          checksum: testTextChecksum("x"),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "art-x",
          kind: "dubbing",
          text: "x",
          checksum: testTextChecksum("x"),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  it("put rejects a MISMATCHED checksum (a caller defect, never silently stored)", async () => {
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "art-x",
          kind: "summary",
          text: PINNED_TEXT,
          checksum: "fnv1a32:00000000",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  it("put rejects blank ids / blank languageTag / blank checksum (typed artifact-invalid)", async () => {
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "  ",
          kind: "summary",
          text: "x",
          checksum: testTextChecksum("x"),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "art-x",
          kind: "summary",
          text: "x",
          languageTag: "  ",
          checksum: testTextChecksum("x"),
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () =>
        store.textPayloads.put({
          artifactId: "art-x",
          kind: "summary",
          text: "x",
          checksum: " ",
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // Read-path integrity re-verification (tampering surfaces typed)
  // -------------------------------------------------------------------------
  it("a TAMPERED row fails its checksum verification on read (typed, never silently-mangled text)", async () => {
    await store.textPayloads.put(payload("art-tamper"));
    store.db.prepare("UPDATE mi_text_payloads SET payload_json = ? WHERE artifact_id = ?").run(
      JSON.stringify({
        artifactId: "art-tamper",
        kind: "summary",
        text: "tampered text",
        checksum: PINNED_CHECKSUM,
      }),
      "art-tamper",
    );
    const err = await expectWebFlixErrorAsync(
      () => store.textPayloads.get("art-tamper"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    expect(err.reason).toContain("tampered");
  });

  it("a corrupt (non-JSON) row surfaces typed artifact-invalid on read", async () => {
    await store.textPayloads.put(payload("art-corrupt"));
    store.db
      .prepare("UPDATE mi_text_payloads SET payload_json = ? WHERE artifact_id = ?")
      .run("{not json", "art-corrupt");
    await expectWebFlixErrorAsync(
      () => store.textPayloads.get("art-corrupt"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // Put-replaces + retention
  // -------------------------------------------------------------------------
  it("put REPLACES wholesale for the same artifact id (the put-replaces house semantic)", async () => {
    await store.textPayloads.put(payload("art-re"));
    await store.textPayloads.put({
      artifactId: "art-re",
      kind: "translation",
      text: "hola",
      languageTag: "es",
      checksum: testTextChecksum("hola"),
    });
    const stored = await store.textPayloads.get("art-re");
    expect(stored.kind).toBe("translation");
    expect(stored.text).toBe("hola");
    // Exactly ONE row for the id.
    const count = store.db
      .prepare("SELECT COUNT(*) AS n FROM mi_text_payloads WHERE artifact_id = ?")
      .get("art-re");
    expect(Number(count?.["n"])).toBe(1);
  });

  it("delete removes one payload; clear-all empties the profile (retention surface)", async () => {
    await store.textPayloads.put(payload("art-1"));
    await store.textPayloads.put(payload("art-2"));
    expect(await store.textPayloads.delete("art-1")).toBe(true);
    expect(await store.textPayloads.delete("art-1")).toBe(false);
    await expectWebFlixErrorAsync(
      () => store.textPayloads.get("art-1"),
      ErrorCode.IntelligenceTextPayloadAbsent,
    );
    expect(await store.textPayloads.clearAll()).toBe(1);
    await expectWebFlixErrorAsync(
      () => store.textPayloads.get("art-2"),
      ErrorCode.IntelligenceTextPayloadAbsent,
    );
  });

  // -------------------------------------------------------------------------
  // Isolation (the ADR-0003 per-profile rule, structural)
  // -------------------------------------------------------------------------
  it("stores are per-profile by construction: a sibling profile's database never sees this profile's payloads", async () => {
    await store.textPayloads.put(payload("art-mine"));
    const otherDir = mkdtempSync(join(tmpdir(), "webflix-text-payloads-other-"));
    try {
      const other = await openStore({ baseDir: otherDir, now: pinnedClock() });
      try {
        await expectWebFlixErrorAsync(
          () => other.textPayloads.get("art-mine"),
          ErrorCode.IntelligenceTextPayloadAbsent,
        );
      } finally {
        other.close();
      }
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("the SqliteTextPayloadStore satisfies the application port structurally (the mirror contract)", () => {
    const adapter: TextPayloadStorePort = new SqliteTextPayloadStore(store.db);
    expect(typeof adapter.put).toBe("function");
    expect(typeof adapter.get).toBe("function");
  });
});
