/**
 * Durable media-intelligence store tests (P4-ARTIFACTS rows 1 + 2): the
 * sqlite-backed ObjectiveStore / FeedbackStore / ArtifactRegistry on the
 * local-library seam — round-trips through close+reopen (restart-safety),
 * feedback idempotency surviving restarts, per-profile isolation, the
 * honest migration of pre-0002 store files, retention/deletion honesty
 * (individual + clear-all; dangling lineage = explicit marker at list),
 * and typed errors on corrupt rows.
 *
 * HERMETIC: temp dirs only (the store refuses ~/.webflix under tests);
 * no network, no wall clock (the epoch-ms clock is injected and pinned).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { CatalogItem, DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import {
  createIntelligenceStores,
  openStore,
  type IntelligenceStores,
  type WebFlixStore,
} from "../index";

const AS_OF = "2026-10-11T08:00:00Z";
const AS_OF_MS = 1791705600000;

const objective = (over: Partial<UserObjective> = {}): UserObjective => ({
  topicFocuses: ["rust", "cooking"],
  exclusions: ["yoga"],
  timeBudgets: { perSessionMinutes: 30 },
  declaredAt: AS_OF,
  ...over,
});

const explicitFeedback = (id: string, itemId: string): FeedbackEvent => ({
  id,
  itemId,
  channel: "explicit",
  kind: "pin",
  provenance: { surface: "recommendation-card", capturedAt: AS_OF },
});

const implicitFeedback = (id: string, itemId: string): FeedbackEvent => ({
  id,
  itemId,
  channel: "implicit",
  kind: "watched-fraction",
  value: 0.62,
  provenance: { surface: "watch-screen", capturedAt: AS_OF },
});

const artifact = (id: string, sourceItemId: string): DerivedArtifact => ({
  id,
  sourceItemId,
  kind: "transcript",
  lineage: {
    modelId: "whisper-small",
    modelVersion: "2026-09",
    producedBy: "webflix.transcribe.adapter",
    generatedAt: AS_OF,
  },
  licenseNote: null,
  createdAt: AS_OF,
});

const catalogItem = (id: string, title: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title,
  mediaKind: "video",
  assets: [],
  matchEvidence: undefined,
  availability: undefined,
  metadata: {},
});

/** Pinned epoch-ms clock — no wall time anywhere in these tests. */
const pinnedClock = (): (() => number) => () => AS_OF_MS;

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

describe("durable MI stores (sqlite seam, temp dirs)", () => {
  let dir: string;
  const opened: WebFlixStore[] = [];

  const open = async (baseDir: string): Promise<WebFlixStore> => {
    const store = await openStore({ baseDir, now: pinnedClock() });
    opened.push(store);
    return store;
  };

  const storesOf = (store: WebFlixStore): IntelligenceStores =>
    createIntelligenceStores(store.db, { now: pinnedClock() });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "webflix-mi-stores-"));
  });

  afterEach(() => {
    for (const store of opened.splice(0)) {
      try {
        store.close();
      } catch {
        // already closed
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Row 1 — durability: round-trip + restart-safety
  // -------------------------------------------------------------------------

  describe("durability round-trips (write -> close -> reopen -> read identical)", () => {
    it("objectives round-trip identically through a restart", async () => {
      const first = await open(dir);
      const written = objective();
      await storesOf(first).objectives.put(written);
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).objectives.get();
      expect(read).toEqual(written);
    });

    it("feedback events round-trip identically through a restart (explicit + implicit)", async () => {
      const first = await open(dir);
      const stores = storesOf(first);
      const events = [explicitFeedback("fb-001", "item-a"), implicitFeedback("fb-002", "item-b")];
      for (const event of events) await stores.feedback.append(event);
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).feedback.list();
      expect(read).toHaveLength(2);
      expect(read).toEqual(events);
      expect(await storesOf(reopened).feedback.get("fb-001")).toEqual(events[0]);
      expect(await storesOf(reopened).feedback.get("missing")).toBeNull();
    });

    it("artifact descriptors round-trip identically through a restart (lineage preserved)", async () => {
      const first = await open(dir);
      const stores = storesOf(first);
      const descriptors: DerivedArtifact[] = [
        artifact("art-1", "item-a"),
        { ...artifact("art-2", "item-b"), kind: "summary", licenseNote: "check the model license" },
      ];
      for (const descriptor of descriptors) await stores.artifacts.put(descriptor);
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).artifacts.list();
      expect(read).toEqual(descriptors);
      expect(await storesOf(reopened).artifacts.get("art-1")).toEqual(descriptors[0]);
      expect(await storesOf(reopened).artifacts.get("missing")).toBeNull();
    });

    it("transcript-kind artifacts (P4-TRANSCRIBE pipeline shape) survive a restart with lineage intact", async () => {
      // The exact descriptor shape mi.transcribe stores: engine adapter as
      // model, the binary's own lineage reports, the deterministic
      // inputsHash digest, whisper.cpp's license note.
      const transcript: DerivedArtifact = {
        id: "art-tr-1",
        sourceItemId: "item-a",
        kind: "transcript",
        lineage: {
          modelId: "webflix.whisper-cpp-local",
          modelVersion: "1.7.4",
          producedBy: "webflix.whisper-cpp-local",
          generatedAt: AS_OF,
          inputsHash: "fnv1a32:1a2b3c4d",
        },
        licenseNote: "whisper.cpp is MIT licensed; model files carry their own licenses",
        createdAt: AS_OF,
      };
      // The honest-floor shape too: a run that reported no binary lineage
      // falls back to the ADAPTER's own version (never a guess).
      const floorTranscript: DerivedArtifact = {
        id: "art-tr-2",
        sourceItemId: "item-b",
        kind: "transcript",
        lineage: {
          modelId: "webflix.whisper-cpp-local",
          modelVersion: "0.1.0",
          producedBy: "webflix.whisper-cpp-local",
          generatedAt: AS_OF,
          inputsHash: "fnv1a32:00000000",
        },
        licenseNote: null,
        createdAt: AS_OF,
      };
      const first = await open(dir);
      const stores = storesOf(first);
      await stores.artifacts.put(transcript);
      await stores.artifacts.put(floorTranscript);
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).artifacts.list();
      expect(read).toEqual([transcript, floorTranscript]);
      expect(await storesOf(reopened).artifacts.get("art-tr-1")).toEqual(transcript);
      // listWithLineage keeps resolving the sources (no dangling markers).
      const withLineage = await storesOf(reopened).artifacts.listWithLineage([
        catalogItem("item-a", "Rust Compiler Deep Dive"),
        catalogItem("item-b", "Advanced Pasta Making"),
      ]);
      const transcripts = withLineage.filter((entry) => entry.descriptor.kind === "transcript");
      expect(transcripts).toHaveLength(2);
      expect(transcripts.every((entry) => entry.lineage === "attached")).toBe(true);
    });

    it("text-intelligence artifacts (P4-SUMMARIZE pipeline shape) survive a restart with lineage + payloads intact", async () => {
      // The exact descriptor shapes mi.summarize / mi.overview / mi.qa store:
      // the built-in extractive model identity, the deterministic inputsHash
      // digest, null license (our own deterministic code), PLUS the paired
      // transcript payload in the migration-0004 store.
      const summary: DerivedArtifact = {
        id: "art-sum-1",
        sourceItemId: "item-a",
        kind: "summary",
        lineage: {
          modelId: "webflix.extractive.v1",
          modelVersion: "v1",
          producedBy: "webflix.built-in-summary-engine",
          generatedAt: AS_OF,
          inputsHash: "fnv1a32:d266a8c0",
        },
        licenseNote: null,
        createdAt: AS_OF,
      };
      const overview: DerivedArtifact = {
        id: "art-ov-1",
        sourceItemId: "item-a",
        kind: "overview",
        lineage: { ...summary.lineage, inputsHash: "fnv1a32:1a2b3c4d" },
        licenseNote: null,
        createdAt: AS_OF,
      };
      const qa: DerivedArtifact = {
        id: "art-qa-1",
        sourceItemId: "item-b",
        kind: "qa",
        lineage: { ...summary.lineage, inputsHash: "fnv1a32:00000000" },
        licenseNote: null,
        createdAt: AS_OF,
      };
      const first = await open(dir);
      const stores = storesOf(first);
      await stores.artifacts.put(summary);
      await stores.artifacts.put(overview);
      await stores.artifacts.put(qa);
      await first.transcriptPayloads.put({
        artifactId: "art-sum-1",
        segments: [
          { startMs: 0, endMs: 1500, text: "hello" },
          { startMs: 1500, endMs: 3000, text: "brave" },
          { startMs: 3000, endMs: 4500, text: "world" },
        ],
        checksum: "fnv1a32:d266a8c0",
      });
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).artifacts.list();
      // The registry's deterministic (createdAt, id) order: all three share
      // the pinned instant, so the tie-break is the id (alphabetical).
      expect(read).toEqual([overview, qa, summary]);
      // The PAIRED payload survived the same restart, checksum verified on read.
      const payload = await reopened.transcriptPayloads.get("art-sum-1");
      expect(payload.checksum).toBe("fnv1a32:d266a8c0");
      expect(payload.segments).toHaveLength(3);
      // listWithLineage keeps resolving both sources (no dangling markers).
      const withLineage = await storesOf(reopened).artifacts.listWithLineage([
        catalogItem("item-a", "Rust Compiler Deep Dive"),
        catalogItem("item-b", "Advanced Pasta Making"),
      ]);
      const kinds = withLineage
        .filter((entry) => ["summary", "overview", "qa"].includes(entry.descriptor.kind))
        .map((entry) => entry.descriptor.kind);
      expect(kinds.sort()).toEqual(["overview", "qa", "summary"]);
      expect(withLineage.every((entry) => entry.lineage === "attached")).toBe(true);
    });

    it("feedback idempotency SURVIVES a restart: same id re-append is a duplicate, never a second row", async () => {
      const first = await open(dir);
      const event = explicitFeedback("fb-001", "item-a");
      const stores = storesOf(first);
      expect((await stores.feedback.append(event)).outcome).toBe("appended");
      first.close();

      const reopened = await open(dir);
      const reStores = storesOf(reopened);
      const again = await reStores.feedback.append(event);
      expect(again.outcome).toBe("duplicate");
      if (again.outcome === "duplicate") expect(again.existing).toEqual(event);
      expect((await reStores.feedback.list()).length).toBe(1);
    });

    it("objective put replaces wholesale across restarts (current goals only)", async () => {
      const first = await open(dir);
      const stores = storesOf(first);
      await stores.objectives.put(objective());
      await stores.objectives.put(objective({ topicFocuses: ["cooking"], exclusions: [] }));
      first.close();

      const reopened = await open(dir);
      const read = await storesOf(reopened).objectives.get();
      expect(read).toEqual(objective({ topicFocuses: ["cooking"], exclusions: [] }));
    });

    it("listing order is deterministic and stable across restarts", async () => {
      const first = await open(dir);
      const stores = storesOf(first);
      for (const id of ["fb-b", "fb-a", "fb-c"]) {
        await stores.feedback.append(explicitFeedback(id, "item-a"));
      }
      await stores.artifacts.put(artifact("art-b", "item-a"));
      await stores.artifacts.put(artifact("art-a", "item-a"));
      const beforeFeedback = await stores.feedback.list();
      const beforeArtifacts = await stores.artifacts.list();
      first.close();

      const reopened = await open(dir);
      const reStores = storesOf(reopened);
      expect(await reStores.feedback.list()).toEqual(beforeFeedback);
      expect(await reStores.artifacts.list()).toEqual(beforeArtifacts);
    });
  });

  // -------------------------------------------------------------------------
  // Row 1 — per-profile isolation (ADR-0003)
  // -------------------------------------------------------------------------

  describe("per-profile isolation", () => {
    it("data never crosses profiles: separate baseDirs hold separate stores", async () => {
      const dirA = join(dir, "profile-a");
      const dirB = join(dir, "profile-b");
      const storeA = await open(dirA);
      const storeB = await open(dirB);

      await storesOf(storeA).objectives.put(objective());
      await storesOf(storeA).feedback.append(explicitFeedback("fb-001", "item-a"));
      await storesOf(storeA).artifacts.put(artifact("art-1", "item-a"));

      expect(await storesOf(storeB).objectives.get()).toBeNull();
      expect(await storesOf(storeB).feedback.list()).toEqual([]);
      expect(await storesOf(storeB).artifacts.list()).toEqual([]);
      expect(await storesOf(storeB).feedback.get("fb-001")).toBeNull();
    });

    it("the WebFlixStore.intelligence getter serves the same profile's data", async () => {
      const store = await open(dir);
      await store.intelligence.objectives.put(objective());
      store.close();
      const reopened = await open(dir);
      expect(await reopened.intelligence.objectives.get()).toEqual(objective());
    });
  });

  // -------------------------------------------------------------------------
  // Row 1 — honest migration for pre-existing store files
  // -------------------------------------------------------------------------

  describe("migration honesty (0002_media_intelligence)", () => {
    it("a fresh store records all migrations and creates the mi_* tables", async () => {
      const store = await open(dir);
      const rows = store.db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all();
      // P4-ADAPTERS row 2 appended 0003_ranker_adapter_selection,
      // P4-SUMMARIZE row 1 appended 0004_transcript_payloads, and
      // P4-TRANSLATE row 2 appended 0005_text_and_audio_payloads — the set
      // is [0001, 0002, 0003, 0004, 0005] now (honest pin update, the
      // 2→3→4→5 chain of the P4-ARTIFACTS 1→2 precedent).
      expect(rows).toHaveLength(5);
      expect(rows[0]["name"]).toBe("0001_init");
      expect(rows[1]["name"]).toBe("0002_media_intelligence");
      expect(rows[2]["name"]).toBe("0003_ranker_adapter_selection");
      expect(rows[3]["name"]).toBe("0004_transcript_payloads");
      expect(rows[4]["name"]).toBe("0005_text_and_audio_payloads");
      const tables = store.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mi_%' ORDER BY name",
        )
        .all()
        .map((row) => String(row["name"]));
      expect(tables).toEqual([
        "mi_audio_renditions",
        "mi_derived_artifacts",
        "mi_feedback_events",
        "mi_objectives",
        "mi_ranker_selection",
        "mi_text_payloads",
        "mi_transcript_payloads",
      ]);
    });

    it("a pre-0002 store file (0001 only, mi tables absent) migrates honestly on reopen — library data intact", async () => {
      // Build a store, add real library data, then regress the file to its
      // pre-0002 shape: drop the mi tables and the 0002 migration row.
      // This is exactly what a store file created before P4-ARTIFACTS looks like.
      const store = await open(dir);
      const mediaPath = join(dir, "video.mp4");
      writeFileSync(mediaPath, "x");
      store.local.addLibraryEntry({ path: mediaPath });
      store.db.exec(
        "DROP TABLE mi_objectives; DROP TABLE mi_feedback_events; DROP TABLE mi_derived_artifacts;",
      );
      store.db.exec("DELETE FROM schema_migrations WHERE id = 2;");
      store.close();

      const reopened = await open(dir);
      const rows = reopened.db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all();
      expect(rows).toHaveLength(5);
      // Pre-existing library data survived the additive migration untouched.
      expect(reopened.local.listLibraryEntries()).toHaveLength(1);
      // The MI stores are immediately usable on the migrated file.
      await reopened.intelligence.objectives.put(objective());
      expect(await reopened.intelligence.objectives.get()).toEqual(objective());
    });

    it("reopening applies nothing further (exactly-once across reopens)", async () => {
      const first = await open(dir);
      first.close();
      const second = await open(dir);
      second.close();
      const third = await open(dir);
      const count = third.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get();
      // 5 = [0001, 0002, 0003, 0004, 0005] (P4-TRANSLATE appended 0005 —
      // honest pin update, the 3→4→5 step of the 1→2→3 chain).
      expect(Number(count?.["n"])).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Row 1 — defensive validation (write + read)
  // -------------------------------------------------------------------------

  describe("typed validation honesty", () => {
    it("rejects schema-invalid writes with the typed feedback-invalid error", async () => {
      const stores = storesOf(await open(dir));
      const bad = {
        ...explicitFeedback("fb-bad", "item-a"),
        channel: "telepathy",
      } as unknown as FeedbackEvent;
      await expectWebFlixErrorAsync(
        () => stores.feedback.append(bad),
        ErrorCode.IntelligenceFeedbackInvalid,
      );
    });

    it("rejects schema-invalid artifact writes with the typed artifact-invalid error", async () => {
      const stores = storesOf(await open(dir));
      const bad = { ...artifact("art-bad", "item-a"), kind: "tts" } as unknown as DerivedArtifact;
      await expectWebFlixErrorAsync(
        () => stores.artifacts.put(bad),
        ErrorCode.IntelligenceArtifactInvalid,
      );
    });

    it("surfaces a tampered/corrupt stored row as a typed error at read — never a mangled contract object", async () => {
      const store = await open(dir);
      const stores = storesOf(store);
      await stores.feedback.append(explicitFeedback("fb-001", "item-a"));
      store.db.exec("UPDATE mi_feedback_events SET event_json = '{not json' WHERE id = 'fb-001'");
      const wfe = await expectWebFlixErrorAsync(
        () => stores.feedback.get("fb-001"),
        ErrorCode.IntelligenceFeedbackInvalid,
      );
      expect(wfe.reason).toContain("not valid JSON");
    });
  });

  // -------------------------------------------------------------------------
  // Row 2 — retention / deletion honesty
  // -------------------------------------------------------------------------

  describe("retention and deletion honesty (user data rules)", () => {
    it("objectives: clear() deletes the current objective (back to never-set)", async () => {
      const stores = storesOf(await open(dir));
      await stores.objectives.put(objective());
      expect(await stores.objectives.clear()).toBe(true);
      expect(await stores.objectives.get()).toBeNull();
      expect(await stores.objectives.clear()).toBe(false);
    });

    it("feedback: individual delete removes exactly one event; clearAll empties the profile's history", async () => {
      const store = await open(dir);
      const stores = storesOf(store);
      await stores.feedback.append(explicitFeedback("fb-001", "item-a"));
      await stores.feedback.append(explicitFeedback("fb-002", "item-b"));
      await stores.feedback.append(explicitFeedback("fb-003", "item-c"));

      expect(await stores.feedback.delete("fb-002")).toBe(true);
      expect(await stores.feedback.delete("fb-002")).toBe(false);
      expect((await stores.feedback.list()).map((event) => event.id)).toEqual(["fb-001", "fb-003"]);

      expect(await stores.feedback.clearAll()).toBe(2);
      expect(await stores.feedback.list()).toEqual([]);
      expect(await stores.feedback.clearAll()).toBe(0);
      // Deletion is durable too.
      store.close();
      const reopened = await open(dir);
      expect(await storesOf(reopened).feedback.list()).toEqual([]);
    });

    it("artifacts: individual delete + clearAll are durable and counted", async () => {
      const store = await open(dir);
      const stores = storesOf(store);
      await stores.artifacts.put(artifact("art-1", "item-a"));
      await stores.artifacts.put(artifact("art-2", "item-b"));

      expect(await stores.artifacts.delete("art-1")).toBe(true);
      expect(await stores.artifacts.delete("art-1")).toBe(false);
      expect((await stores.artifacts.list()).map((descriptor) => descriptor.id)).toEqual(["art-2"]);

      expect(await stores.artifacts.clearAll()).toBe(1);
      expect(await stores.artifacts.list()).toEqual([]);
      store.close();
      const reopened = await open(dir);
      expect(await storesOf(reopened).artifacts.list()).toEqual([]);
    });

    it("deleting an original NEVER silently cascades: dangling descriptors stay stored and are listed with the explicit dangling marker", async () => {
      const store = await open(dir);
      const stores = storesOf(store);
      const withSource = artifact("art-1", "item-a");
      const withSource2: DerivedArtifact = { ...artifact("art-2", "item-a"), kind: "summary" };
      const dangling = artifact("art-3", "item-gone");
      for (const descriptor of [withSource, withSource2, dangling]) {
        await stores.artifacts.put(descriptor);
      }

      // The original item-a is deleted from the caller's catalog snapshot:
      // the registry keeps EVERY descriptor and reports lineage honestly.
      const catalog = [catalogItem("item-x", "Unrelated")];
      const statuses = await stores.artifacts.listWithLineage(catalog);
      expect(statuses).toHaveLength(3);
      const byId = new Map(statuses.map((status) => [status.descriptor.id, status]));
      expect(byId.get("art-1")).toMatchObject({ lineage: "dangling", sourceItemId: "item-a" });
      expect(byId.get("art-2")).toMatchObject({ lineage: "dangling", sourceItemId: "item-a" });
      expect(byId.get("art-3")).toMatchObject({ lineage: "dangling", sourceItemId: "item-gone" });
      // Still fully readable — never hidden, never rejected at read.
      expect(await stores.artifacts.get("art-1")).toEqual(withSource);
      expect((await stores.artifacts.list()).length).toBe(3);

      // With the original present in the snapshot, the same descriptors are attached.
      const withOriginal = [
        catalogItem("item-a", "Rust Systems Programming"),
        catalogItem("item-gone", "Gone"),
      ];
      const attached = await stores.artifacts.listWithLineage(withOriginal);
      expect(attached.filter((status) => status.lineage === "attached")).toHaveLength(3);

      // The dangling-marker status is durable information about the SNAPSHOT,
      // not stored state: a fresh read against the original catalog re-attaches.
      store.close();
      const reopened = await open(dir);
      const reopenedStatuses = await storesOf(reopened).artifacts.listWithLineage(withOriginal);
      expect(reopenedStatuses.filter((status) => status.lineage === "attached")).toHaveLength(3);
    });

    it("deleteBySource is the EXPLICIT bulk path for one original's derivations (a choice, never a cascade)", async () => {
      const stores = storesOf(await open(dir));
      await stores.artifacts.put(artifact("art-1", "item-a"));
      await stores.artifacts.put(artifact("art-2", "item-a"));
      await stores.artifacts.put(artifact("art-3", "item-b"));

      expect(await stores.artifacts.deleteBySource("item-a")).toBe(2);
      expect((await stores.artifacts.list()).map((descriptor) => descriptor.id)).toEqual(["art-3"]);
      expect(await stores.artifacts.deleteBySource("item-a")).toBe(0);
    });

    it("no silent retention: clearAll on the profile removes feedback AND artifacts AND the objective", async () => {
      const store = await open(dir);
      const stores = storesOf(store);
      await stores.objectives.put(objective());
      await stores.feedback.append(explicitFeedback("fb-001", "item-a"));
      await stores.artifacts.put(artifact("art-1", "item-a"));

      expect(await stores.feedback.clearAll()).toBe(1);
      expect(await stores.artifacts.clearAll()).toBe(1);
      expect(await stores.objectives.clear()).toBe(true);
      store.close();
      const reopened = await open(dir);
      const reStores = storesOf(reopened);
      expect(await reStores.objectives.get()).toBeNull();
      expect(await reStores.feedback.list()).toEqual([]);
      expect(await reStores.artifacts.list()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Structural port compatibility surface (LocalStorePort precedent)
  // -------------------------------------------------------------------------

  describe("port surface", () => {
    it("exposes exactly the application-port member shapes (structural mirror)", async () => {
      const stores = storesOf(await open(dir));
      // Compile-time structural compatibility is the contract; the runtime
      // assertions pin the member surface this seam must keep stable.
      expect(typeof stores.objectives.get).toBe("function");
      expect(typeof stores.objectives.put).toBe("function");
      expect(typeof stores.feedback.append).toBe("function");
      expect(typeof stores.feedback.get).toBe("function");
      expect(typeof stores.feedback.list).toBe("function");
      expect(typeof stores.artifacts.put).toBe("function");
      expect(typeof stores.artifacts.get).toBe("function");
      expect(typeof stores.artifacts.list).toBe("function");
    });
  });
});
