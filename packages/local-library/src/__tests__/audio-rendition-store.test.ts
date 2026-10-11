/**
 * Durable audio rendition store tests (P4-TRANSLATE row 2, the TTS side):
 * the mi_audio_renditions sqlite seam (migration 0005) — byte-exact BLOB
 * round-trips, by-source listing in deterministic order, restart-safety,
 * the length-integrity re-verification on read (tampering surfaces typed),
 * put-replaces, retention, write-path validation, and per-profile
 * isolation. AUDIO-AS-RENDITION: no artifact kind is involved anywhere.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import {
  openStore,
  SqliteAudioRenditionStore,
  type AudioRendition,
  type AudioRenditionStorePort,
  WebFlixStore,
} from "../index";

const AS_OF_MS = 1791736400000;
const ISO_AS_OF_A = "2026-10-12T09:00:00.000Z";
const ISO_AS_OF_B = "2026-10-12T09:05:00.000Z";

const pinnedClock = (): (() => number) => () => AS_OF_MS;

const WAV_A = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const WAV_B = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

/** A well-formed rendition attached to a source artifact. */
const rendition = (over: Partial<AudioRendition> = {}): AudioRendition => ({
  renditionId: "rend-1",
  sourceArtifactId: "art-transcript-1",
  engine: { id: "webflix.piper-local-tts", label: "Piper-class TTS (local)", version: "0.1.0" },
  voiceId: "en_US-amy-medium",
  inputsHash: "fnv1a32:00112233",
  contentType: "audio/wav",
  audio: WAV_A,
  createdAt: ISO_AS_OF_A,
  ...over,
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

describe("durable audio rendition store (sqlite seam, temp dirs)", () => {
  let dir: string;
  let store: WebFlixStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "webflix-renditions-"));
    store = await openStore({ baseDir: dir, now: pinnedClock() });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Round-trips + restart safety
  // -------------------------------------------------------------------------
  it("put/listBySource round-trips the rendition verbatim (lineage + voice + bytes + contentType)", async () => {
    await store.audioRenditions.put(rendition());
    const listed = await store.audioRenditions.listBySource("art-transcript-1");
    expect(listed).toHaveLength(1);
    const stored = listed[0] as AudioRendition;
    expect(stored.renditionId).toBe("rend-1");
    expect(stored.sourceArtifactId).toBe("art-transcript-1");
    expect(stored.engine).toEqual({
      id: "webflix.piper-local-tts",
      label: "Piper-class TTS (local)",
      version: "0.1.0",
    });
    expect(stored.engineVersion).toBeUndefined();
    expect(stored.modelLineage).toBeUndefined();
    expect(stored.voiceId).toBe("en_US-amy-medium");
    expect(stored.inputsHash).toBe("fnv1a32:00112233");
    expect(stored.contentType).toBe("audio/wav");
    expect(Array.from(stored.audio)).toEqual(Array.from(WAV_A));
    expect(stored.createdAt).toBe(ISO_AS_OF_A);
  });

  it("the optional engine lineage facts round-trip when present (and stay ABSENT otherwise)", async () => {
    await store.audioRenditions.put(
      rendition({
        renditionId: "rend-full",
        engineVersion: "1.2.0",
        modelLineage: "voices/en_US-amy-medium.onnx",
      }),
    );
    const stored = (await store.audioRenditions.listBySource("art-transcript-1"))[0];
    expect(stored?.engineVersion).toBe("1.2.0");
    expect(stored?.modelLineage).toBe("voices/en_US-amy-medium.onnx");
  });

  it("the rendition survives a restart (close + reopen, the durability point)", async () => {
    await store.audioRenditions.put(rendition());
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      const listed = await reopened.audioRenditions.listBySource("art-transcript-1");
      expect(listed).toHaveLength(1);
      expect(Array.from(listed[0]!.audio)).toEqual(Array.from(WAV_A));
      expect(listed[0]!.voiceId).toBe("en_US-amy-medium");
    } finally {
      reopened.close();
    }
  });

  it("listBySource returns EMPTY for an unknown source (the honest none-attached state)", async () => {
    expect(await store.audioRenditions.listBySource("art-never")).toEqual([]);
  });

  it("listing is deterministic: (stored_at, rendition_id) order across many renditions", async () => {
    await store.audioRenditions.put(rendition({ renditionId: "rend-b", createdAt: ISO_AS_OF_A }));
    await store.audioRenditions.put(rendition({ renditionId: "rend-a", createdAt: ISO_AS_OF_A }));
    await store.audioRenditions.put(
      rendition({ renditionId: "rend-c", createdAt: ISO_AS_OF_B, audio: WAV_B }),
    );
    const listed = await store.audioRenditions.listBySource("art-transcript-1");
    expect(listed.map((item) => item.renditionId)).toEqual(["rend-a", "rend-b", "rend-c"]);
  });

  it("listing is per-source: sibling sources never see each other's renditions", async () => {
    await store.audioRenditions.put(rendition({ renditionId: "rend-1" }));
    await store.audioRenditions.put(
      rendition({ renditionId: "rend-2", sourceArtifactId: "art-summary-9" }),
    );
    expect(await store.audioRenditions.listBySource("art-transcript-1")).toHaveLength(1);
    expect(await store.audioRenditions.listBySource("art-summary-9")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Write-path validation
  // -------------------------------------------------------------------------
  it("put rejects blank ids / voice / contentType / inputsHash / createdAt (typed artifact-invalid)", async () => {
    const cases: readonly AudioRendition[] = [
      rendition({ renditionId: "" }),
      rendition({ sourceArtifactId: "  " }),
      rendition({ voiceId: "" }),
      rendition({ contentType: " " }),
      rendition({ inputsHash: "" }),
      rendition({ createdAt: " " }),
      rendition({ engine: { id: "", label: "l", version: "v" } }),
      rendition({ engine: { id: "i", label: "", version: "v" } }),
      rendition({ engine: { id: "i", label: "l", version: "" } }),
    ];
    for (const candidate of cases) {
      await expectWebFlixErrorAsync(
        () => store.audioRenditions.put(candidate),
        ErrorCode.IntelligenceArtifactInvalid,
      );
    }
    expect(await store.audioRenditions.listBySource("art-transcript-1")).toEqual([]);
  });

  it("put rejects a non-Uint8Array or EMPTY audio payload (an engine that wrote no audio is a failed run)", async () => {
    await expectWebFlixErrorAsync(
      () => store.audioRenditions.put(rendition({ audio: new Uint8Array([]) })),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    await expectWebFlixErrorAsync(
      () => store.audioRenditions.put(rendition({ audio: "not-bytes" as unknown as Uint8Array })),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // Read-path integrity re-verification (tampering surfaces typed)
  // -------------------------------------------------------------------------
  it("a TRUNCATED audio row fails its length verification on read (typed, never silently-shortened audio)", async () => {
    await store.audioRenditions.put(rendition());
    // Tamper: shrink the BLOB without updating byte_length.
    store.db
      .prepare("UPDATE mi_audio_renditions SET audio = ? WHERE rendition_id = ?")
      .run(new Uint8Array([1, 2]), "rend-1");
    const err = await expectWebFlixErrorAsync(
      () => store.audioRenditions.listBySource("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    expect(err.reason).toContain("length verification");
  });

  it("a tampered byte_length COLUMN fails the cross-check on read (typed)", async () => {
    await store.audioRenditions.put(rendition());
    store.db
      .prepare("UPDATE mi_audio_renditions SET byte_length = ? WHERE rendition_id = ?")
      .run(2, "rend-1");
    await expectWebFlixErrorAsync(
      () => store.audioRenditions.listBySource("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  it("a corrupt metadata JSON row surfaces typed artifact-invalid on read", async () => {
    await store.audioRenditions.put(rendition());
    store.db
      .prepare("UPDATE mi_audio_renditions SET metadata_json = ? WHERE rendition_id = ?")
      .run("{not json", "rend-1");
    await expectWebFlixErrorAsync(
      () => store.audioRenditions.listBySource("art-transcript-1"),
      ErrorCode.IntelligenceArtifactInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // Put-replaces + retention
  // -------------------------------------------------------------------------
  it("put REPLACES wholesale for the same rendition id (a re-synthesis of the same id)", async () => {
    await store.audioRenditions.put(rendition());
    await store.audioRenditions.put(rendition({ audio: WAV_B, voiceId: "en_US-ryan-high" }));
    const listed = await store.audioRenditions.listBySource("art-transcript-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.voiceId).toBe("en_US-ryan-high");
    expect(Array.from(listed[0]!.audio)).toEqual(Array.from(WAV_B));
  });

  it("delete / deleteBySource / clearAll form the retention surface", async () => {
    await store.audioRenditions.put(rendition({ renditionId: "rend-1" }));
    await store.audioRenditions.put(rendition({ renditionId: "rend-2" }));
    await store.audioRenditions.put(
      rendition({ renditionId: "rend-3", sourceArtifactId: "art-summary-9" }),
    );
    expect(await store.audioRenditions.delete("rend-1")).toBe(true);
    expect(await store.audioRenditions.delete("rend-1")).toBe(false);
    expect(await store.audioRenditions.deleteBySource("art-transcript-1")).toBe(1);
    expect(await store.audioRenditions.clearAll()).toBe(1);
    expect(await store.audioRenditions.listBySource("art-summary-9")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Isolation (the ADR-0003 per-profile rule, structural)
  // -------------------------------------------------------------------------
  it("stores are per-profile by construction: a sibling profile's database never sees this profile's renditions", async () => {
    await store.audioRenditions.put(rendition());
    const otherDir = mkdtempSync(join(tmpdir(), "webflix-renditions-other-"));
    try {
      const other = await openStore({ baseDir: otherDir, now: pinnedClock() });
      try {
        expect(await other.audioRenditions.listBySource("art-transcript-1")).toEqual([]);
      } finally {
        other.close();
      }
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("the SqliteAudioRenditionStore satisfies the application port structurally (the mirror contract)", () => {
    const adapter: AudioRenditionStorePort = new SqliteAudioRenditionStore(store.db);
    expect(typeof adapter.put).toBe("function");
    expect(typeof adapter.listBySource).toBe("function");
    expect(typeof adapter.delete).toBe("function");
    expect(typeof adapter.deleteBySource).toBe("function");
    expect(typeof adapter.clearAll).toBe("function");
  });
});
