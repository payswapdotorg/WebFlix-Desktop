/**
 * Durable Ad Center store tests (P5-STORES row 2): the ad_* sqlite seam
 * (migration 0006) — round-trips (full + honest-absent), restart
 * durability, the typed ads/*-absent errors, the FNV-1a checksum
 * re-verification on read (tampering surfaces typed — both the payload
 * column and the checksum column), put-replaces vs append-only
 * idempotency, the record version history surface (listBySourceAdId),
 * retention delete, the pre-0006-migration regression (an 0001–0005 store
 * file applies 0006 forward with all prior data intact), and per-profile
 * isolation (ADR-0003).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  AdRecord,
  AdvertiserIdentity,
  Claim,
  EvidenceLink,
  ReviewSignal,
} from "webflix-contracts";
import {
  ALL_MIGRATIONS,
  createSqliteDatabase,
  openStore,
  runMigrations,
  SqliteTextPayloadStore,
  WebFlixStore,
  type AdRecordStorePort,
  type AdvertiserIdentityStorePort,
  type ClaimStorePort,
  type EvidenceEdgeStorePort,
  type ReviewSignalStorePort,
} from "../index";

const AS_OF_MS = 1791736400000;
const ISO = "2026-10-12T00:00:00Z";
const ISO_LATER = "2026-10-20T12:30:00Z";
const pinnedClock = (): (() => number) => () => AS_OF_MS;

const provenance = {
  source: "meta-ad-library",
  observedAt: ISO,
  importedAt: ISO_LATER,
  importBatchId: "batch-001",
};

const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months!";

const identity: AdvertiserIdentity = {
  id: "adv-1",
  source: "meta-ad-library",
  sourceAdvertiserId: "page-77",
  names: ["Acme Streaming"],
  regions: ["US", "DE"],
  verificationState: "source-reported-verified",
  reportedAt: ISO,
};

const record: AdRecord = {
  id: "ad-1",
  sourceAdId: "999123",
  advertiserIdentityId: "adv-1",
  creativeText: CREATIVE_TEXT,
  creativeUrls: ["https://acme.example/offer"],
  regions: ["US", "DE"],
  periods: [{ start: ISO, end: ISO_LATER }],
  provenance,
};

const claim: Claim = {
  id: "claim-1",
  adRecordId: "ad-1",
  quote: "50% off your first 3 months",
  startOffset: CREATIVE_TEXT.indexOf("50% off your first 3 months"),
  endOffset:
    CREATIVE_TEXT.indexOf("50% off your first 3 months") + "50% off your first 3 months".length,
};

const edge: EvidenceLink = {
  kind: "source-reported-fact",
  id: "ev-1",
  claimId: "claim-1",
  relationship: "supports",
  url: "https://acme.example/terms",
  asReportedText: "50% off applies to the first 3 months",
  provenance,
};

const reviewEdge: EvidenceLink = {
  kind: "independent-review",
  id: "ev-2",
  claimId: "claim-1",
  relationship: "contradicts",
  reviewSignalId: "rev-1",
  provenance,
};

const signal: ReviewSignal = {
  id: "rev-1",
  source: "streaming-reviews.example",
  asReportedRating: "3.1/5",
  asReportedClassification: "mixed",
  region: "US",
  scope: "streaming services",
  provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
};

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

describe("durable Ad Center stores (sqlite seam, temp dirs)", () => {
  let dir: string;
  let store: WebFlixStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "webflix-ads-stores-"));
    store = await openStore({ baseDir: dir, now: pinnedClock() });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // The migration itself
  // -------------------------------------------------------------------------

  it("migration 0006 creates the five ad_* tables and is recorded exactly once", async () => {
    const rows = store.db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all();
    expect(rows).toHaveLength(6);
    expect(rows[5]["name"]).toBe("0006_ad_center_stores");
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ad_%'")
      .all()
      .map((row) => String(row["name"]))
      .sort();
    expect(tables).toEqual([
      "ad_claims",
      "ad_evidence_edges",
      "ad_identities",
      "ad_records",
      "ad_review_signals",
    ]);
    // NO foreign key into catalog/intelligence tables (separation is
    // structural): the ads tables' DDL references no other table.
    for (const table of tables) {
      const ddl = String(
        store.db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table)?.["sql"],
      );
      expect(ddl).not.toMatch(/REFERENCES/i);
    }
  });

  // -------------------------------------------------------------------------
  // AdvertiserIdentity store
  // -------------------------------------------------------------------------

  it("identity put/get round-trips verbatim (all fields, deep equality)", async () => {
    await store.ads.identities.put(identity);
    expect(await store.ads.identities.get("adv-1")).toEqual(identity);
  });

  it("an honest-absent identity round-trips with every optional ABSENT", async () => {
    const minimal: AdvertiserIdentity = { id: "adv-2", source: "user-import" };
    await store.ads.identities.put(minimal);
    const stored = await store.ads.identities.get("adv-2");
    expect(stored).toEqual(minimal);
    expect(stored.sourceAdvertiserId).toBeUndefined();
    expect(stored.names).toBeUndefined();
    expect(stored.verificationState).toBeUndefined();
  });

  it("identity put REPLACES wholesale for the same id (exactly one row)", async () => {
    await store.ads.identities.put(identity);
    await store.ads.identities.put({ id: "adv-1", source: "meta-ad-library", names: ["Acme AG"] });
    const stored = await store.ads.identities.get("adv-1");
    expect(stored.names).toEqual(["Acme AG"]);
    expect(stored.regions).toBeUndefined();
    const count = store.db
      .prepare("SELECT COUNT(*) AS n FROM ad_identities WHERE id = ?")
      .get("adv-1");
    expect(Number(count?.["n"])).toBe(1);
  });

  it("identity get on a missing id rejects with the TYPED ads/identity-absent error", async () => {
    const err = await expectWebFlixErrorAsync(
      () => store.ads.identities.get("adv-never"),
      ErrorCode.AdsIdentityAbsent,
    );
    expect(err.reason).toContain("import");
  });

  it("a TAMPERED identity payload fails its checksum on read (typed, never mangled)", async () => {
    await store.ads.identities.put({ ...identity, names: ["Acme Streaming"] });
    store.db
      .prepare("UPDATE ad_identities SET identity_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...identity, names: ["Acme Hacked"] }), "adv-1");
    const err = await expectWebFlixErrorAsync(
      () => store.ads.identities.get("adv-1"),
      ErrorCode.AdsRecordInvalid,
    );
    expect(err.reason).toContain("tampered");
  });

  it("a TAMPERED checksum column surfaces typed on read too", async () => {
    await store.ads.identities.put(identity);
    store.db
      .prepare("UPDATE ad_identities SET checksum = ? WHERE id = ?")
      .run("fnv1a32:00000000", "adv-1");
    await expectWebFlixErrorAsync(
      () => store.ads.identities.get("adv-1"),
      ErrorCode.AdsRecordInvalid,
    );
  });

  it("a corrupt (non-JSON) identity row surfaces typed on read", async () => {
    await store.ads.identities.put(identity);
    store.db
      .prepare("UPDATE ad_identities SET identity_json = ? WHERE id = ?")
      .run("{not json", "adv-1");
    await expectWebFlixErrorAsync(
      () => store.ads.identities.get("adv-1"),
      ErrorCode.AdsRecordInvalid,
    );
  });

  it("identities survive a restart (close + reopen, the durability point)", async () => {
    await store.ads.identities.put(identity);
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      expect(await reopened.ads.identities.get("adv-1")).toEqual(identity);
      expect(await reopened.ads.identities.list()).toEqual([identity]);
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // AdRecord store
  // -------------------------------------------------------------------------

  it("record put/get round-trips verbatim; list is deterministic ((stored_at, id) order)", async () => {
    await store.ads.records.put({ ...record, id: "ad-2" });
    await store.ads.records.put(record);
    expect(await store.ads.records.get("ad-1")).toEqual(record);
    // The pinned clock gives both rows the same stored_at, so the
    // deterministic order tiebreaks by id — the documented (stored_at, id).
    const ids = (await store.ads.records.list()).map((stored) => stored.id);
    expect(ids).toEqual(["ad-1", "ad-2"]);
  });

  it("an honest-absent record (no sourceAdId, no creative) round-trips ABSENT", async () => {
    const minimal: AdRecord = {
      id: "ad-bare",
      advertiserIdentityId: "adv-1",
      provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
    };
    await store.ads.records.put(minimal);
    const stored = await store.ads.records.get("ad-bare");
    expect(stored).toEqual(minimal);
    expect(stored.sourceAdId).toBeUndefined();
    expect(stored.creativeText).toBeUndefined();
    expect(stored.creativeUrls).toBeUndefined();
    expect(stored.provenance.observedAt).toBeUndefined();
  });

  it("record put REPLACES wholesale for the same id (one row, new batch provenance)", async () => {
    await store.ads.records.put(record);
    const reimported: AdRecord = {
      ...record,
      provenance: { ...provenance, importBatchId: "batch-009", importedAt: ISO_LATER },
    };
    await store.ads.records.put(reimported);
    expect(await store.ads.records.get("ad-1")).toEqual(reimported);
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM ad_records WHERE id = ?").get("ad-1");
    expect(Number(count?.["n"])).toBe(1);
  });

  it("listBySourceAdId is the VERSION HISTORY: prior batches stay, ordered", async () => {
    // Batch 001 version, then a batch-002 version of the same source ad:
    // the store appends both rows; history is never overwritten.
    await store.ads.records.put(record);
    await store.ads.records.put({
      ...record,
      id: "ad-1-v2",
      creativeText: "Watch Acme — 60% off your first 3 months!",
      provenance: { ...provenance, importBatchId: "batch-002" },
    });
    const versions = await store.ads.records.listBySourceAdId("meta-ad-library", "999123");
    expect(versions.map((stored) => stored.id)).toEqual(["ad-1", "ad-1-v2"]);
    expect(await store.ads.records.listBySourceAdId("meta-ad-library", "never-seen")).toEqual([]);
    // A record with NO sourceAdId never matches (no dedup magic without it).
    expect(await store.ads.records.listBySourceAdId("user-import", "999123")).toEqual([]);
  });

  it("record get on a missing id rejects with the TYPED ads/record-absent error", async () => {
    const err = await expectWebFlixErrorAsync(
      () => store.ads.records.get("ad-never"),
      ErrorCode.AdsRecordAbsent,
    );
    expect(err.reason).toContain("import");
  });

  it("a TAMPERED record payload fails its checksum on read (typed)", async () => {
    await store.ads.records.put(record);
    store.db.prepare("UPDATE ad_records SET record_json = ? WHERE id = ?").run(
      JSON.stringify({
        ...record,
        creativeText: "Watch Acme — 100% free forever (tampered)",
      }),
      "ad-1",
    );
    const err = await expectWebFlixErrorAsync(
      () => store.ads.records.get("ad-1"),
      ErrorCode.AdsRecordInvalid,
    );
    expect(err.reason).toContain("tampered");
  });

  it("record delete removes exactly one row (the replace path's building block)", async () => {
    await store.ads.records.put(record);
    expect(await store.ads.records.delete("ad-1")).toBe(true);
    expect(await store.ads.records.delete("ad-1")).toBe(false);
    await expectWebFlixErrorAsync(() => store.ads.records.get("ad-1"), ErrorCode.AdsRecordAbsent);
  });

  it("records survive a restart, version history included", async () => {
    await store.ads.records.put(record);
    await store.ads.records.put({
      ...record,
      id: "ad-1-v2",
      provenance: { ...provenance, importBatchId: "batch-002" },
    });
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      const versions = await reopened.ads.records.listBySourceAdId("meta-ad-library", "999123");
      expect(versions).toHaveLength(2);
      expect(versions[0]).toEqual(record);
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // Claim store
  // -------------------------------------------------------------------------

  it("claim put/get round-trips verbatim; listByAdRecordId is the attachment surface", async () => {
    await store.ads.claims.put(claim);
    expect(await store.ads.claims.get("claim-1")).toEqual(claim);
    expect(await store.ads.claims.listByAdRecordId("ad-1")).toEqual([claim]);
    expect(await store.ads.claims.listByAdRecordId("ad-other")).toEqual([]);
  });

  it("claim put REPLACES wholesale for the same id (the id is the idempotency key)", async () => {
    await store.ads.claims.put(claim);
    await store.ads.claims.put({ ...claim, quote: "50% off", startOffset: 13, endOffset: 21 });
    const stored = await store.ads.claims.get("claim-1");
    expect(stored.quote).toBe("50% off");
    const count = store.db
      .prepare("SELECT COUNT(*) AS n FROM ad_claims WHERE id = ?")
      .get("claim-1");
    expect(Number(count?.["n"])).toBe(1);
  });

  it("claim get on a missing id rejects with the TYPED ads/claim-absent error", async () => {
    await expectWebFlixErrorAsync(
      () => store.ads.claims.get("claim-never"),
      ErrorCode.AdsClaimAbsent,
    );
  });

  it("a TAMPERED claim payload fails its checksum on read (typed)", async () => {
    await store.ads.claims.put(claim);
    store.db
      .prepare("UPDATE ad_claims SET claim_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...claim, quote: "0% off (tampered)" }), "claim-1");
    await expectWebFlixErrorAsync(() => store.ads.claims.get("claim-1"), ErrorCode.AdsClaimInvalid);
  });

  it("claims survive a restart; a claim stays readable after its record is deleted", async () => {
    await store.ads.records.put(record);
    await store.ads.claims.put(claim);
    expect(await store.ads.records.delete("ad-1")).toBe(true);
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      // The keyed-stores honesty rule: no cascade, the claim stays readable.
      expect(await reopened.ads.claims.get("claim-1")).toEqual(claim);
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // EvidenceEdge store (append-only)
  // -------------------------------------------------------------------------

  it("edge append + get round-trips every variant (all four node kinds)", async () => {
    const offerTerms: EvidenceLink = {
      kind: "offer-terms",
      id: "ev-3",
      claimId: "claim-1",
      relationship: "contextualizes",
      url: "https://acme.example/offer-terms",
      declaredTermsExcerpt: "Offer applies to new subscribers only",
      provenance,
    };
    const userDoc: EvidenceLink = {
      kind: "user-imported-document",
      id: "ev-4",
      claimId: "claim-1",
      relationship: "supports",
      documentId: "doc-42",
      provenance: { ...provenance, source: "user-import" },
    };
    for (const one of [edge, reviewEdge, offerTerms, userDoc]) {
      const appended = await store.ads.evidenceEdges.append(one);
      expect(appended.outcome).toBe("appended");
      expect(await store.ads.evidenceEdges.get(one.id)).toEqual(one);
    }
    expect(await store.ads.evidenceEdges.listByClaim("claim-1")).toHaveLength(4);
    expect(await store.ads.evidenceEdges.listByClaim("claim-other")).toEqual([]);
  });

  it("edge append is IDEMPOTENT by id: the stored one wins, never a second row", async () => {
    await store.ads.evidenceEdges.append(edge);
    const again = await store.ads.evidenceEdges.append({
      ...edge,
      asReportedText: "tampered re-append attempt",
    });
    expect(again.outcome).toBe("duplicate");
    if (again.outcome === "duplicate") {
      expect(again.existing).toEqual(edge);
    }
    const count = store.db
      .prepare("SELECT COUNT(*) AS n FROM ad_evidence_edges WHERE id = ?")
      .get("ev-1");
    expect(Number(count?.["n"])).toBe(1);
    expect(await store.ads.evidenceEdges.get("ev-1")).toEqual(edge);
  });

  it("edge get on a missing id rejects with the TYPED ads/evidence-absent error", async () => {
    await expectWebFlixErrorAsync(
      () => store.ads.evidenceEdges.get("ev-never"),
      ErrorCode.AdsEvidenceAbsent,
    );
  });

  it("a TAMPERED edge payload fails its checksum on read (typed)", async () => {
    await store.ads.evidenceEdges.append(edge);
    store.db
      .prepare("UPDATE ad_evidence_edges SET edge_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...edge, relationship: "contradicts" }), "ev-1");
    await expectWebFlixErrorAsync(
      () => store.ads.evidenceEdges.get("ev-1"),
      ErrorCode.AdsEvidenceInvalid,
    );
  });

  it("edges survive a restart; the append idempotency survives too", async () => {
    await store.ads.evidenceEdges.append(edge);
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      expect(await reopened.ads.evidenceEdges.get("ev-1")).toEqual(edge);
      const again = await reopened.ads.evidenceEdges.append(edge);
      expect(again.outcome).toBe("duplicate");
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // ReviewSignal store (append-only)
  // -------------------------------------------------------------------------

  it("signal append + get round-trips verbatim; honest-absent fields stay absent", async () => {
    const minimal: ReviewSignal = {
      id: "rev-2",
      source: "watchdog.example",
      asReportedClassification: "unverified claims",
      provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-002" },
    };
    for (const one of [signal, minimal]) {
      const appended = await store.ads.reviewSignals.append(one);
      expect(appended.outcome).toBe("appended");
      expect(await store.ads.reviewSignals.get(one.id)).toEqual(one);
    }
    const storedMinimal = await store.ads.reviewSignals.get("rev-2");
    expect(storedMinimal.asReportedRating).toBeUndefined();
    expect(storedMinimal.region).toBeUndefined();
    expect(storedMinimal.scope).toBeUndefined();
  });

  it("signal append is IDEMPOTENT by id (the stored one wins, one row)", async () => {
    await store.ads.reviewSignals.append(signal);
    const again = await store.ads.reviewSignals.append(signal);
    expect(again.outcome).toBe("duplicate");
    const count = store.db
      .prepare("SELECT COUNT(*) AS n FROM ad_review_signals WHERE id = ?")
      .get("rev-1");
    expect(Number(count?.["n"])).toBe(1);
  });

  it("signal get on a missing id rejects with the TYPED ads/review-signal-absent error", async () => {
    await expectWebFlixErrorAsync(
      () => store.ads.reviewSignals.get("rev-never"),
      ErrorCode.AdsReviewSignalAbsent,
    );
  });

  it("a TAMPERED signal payload fails its checksum on read (typed)", async () => {
    await store.ads.reviewSignals.append(signal);
    store.db
      .prepare("UPDATE ad_review_signals SET signal_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...signal, asReportedRating: "5/5 (tampered)" }), "rev-1");
    await expectWebFlixErrorAsync(
      () => store.ads.reviewSignals.get("rev-1"),
      ErrorCode.AdsRecordInvalid,
    );
  });

  it("signals survive a restart", async () => {
    await store.ads.reviewSignals.append(signal);
    store.close();
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      expect(await reopened.ads.reviewSignals.get("rev-1")).toEqual(signal);
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // Pre-0006 migration regression (additive-only, forward application)
  // -------------------------------------------------------------------------

  it("a PRE-0006 store file (0001–0005) applies 0006 forward with all prior data intact", async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), "webflix-ads-pre0006-"));
    // Build a store file that stopped at 0005 (a real pre-P5-STORES file).
    const db = await createSqliteDatabase(join(dir, "webflix.db"));
    runMigrations(db, ALL_MIGRATIONS.slice(0, 5));
    const textStore = new SqliteTextPayloadStore(db);
    await textStore.put({
      artifactId: "art-pre-0006",
      kind: "summary",
      text: "pre-0006 payload",
      checksum: "fnv1a32:373f2325",
    });
    db.close();
    // Reopen with the FULL list: 0006 applies forward, nothing is lost.
    const reopened = await openStore({ baseDir: dir, now: pinnedClock() });
    try {
      const migrations = reopened.db.prepare("SELECT id FROM schema_migrations ORDER BY id").all();
      expect(migrations).toHaveLength(6);
      const payload = await reopened.textPayloads.get("art-pre-0006");
      expect(payload.text).toBe("pre-0006 payload");
      // The ads tables exist and are HONESTLY EMPTY (pre-import state).
      expect(await reopened.ads.records.list()).toEqual([]);
      expect(await reopened.ads.identities.list()).toEqual([]);
      expect(await reopened.ads.claims.list()).toEqual([]);
      expect(await reopened.ads.evidenceEdges.list()).toEqual([]);
      expect(await reopened.ads.reviewSignals.list()).toEqual([]);
      await expectWebFlixErrorAsync(
        () => reopened.ads.records.get("anything"),
        ErrorCode.AdsRecordAbsent,
      );
    } finally {
      reopened.close();
    }
  });

  // -------------------------------------------------------------------------
  // Per-profile isolation (ADR-0003, structural)
  // -------------------------------------------------------------------------

  it("ads stores are per-profile: a sibling profile's database never sees this profile's rows", async () => {
    await store.ads.identities.put(identity);
    await store.ads.records.put(record);
    await store.ads.claims.put(claim);
    await store.ads.evidenceEdges.append(edge);
    await store.ads.reviewSignals.append(signal);
    const otherDir = mkdtempSync(join(tmpdir(), "webflix-ads-stores-other-"));
    try {
      const other = await openStore({ baseDir: otherDir, now: pinnedClock() });
      try {
        await expectWebFlixErrorAsync(
          () => other.ads.identities.get("adv-1"),
          ErrorCode.AdsIdentityAbsent,
        );
        await expectWebFlixErrorAsync(
          () => other.ads.records.get("ad-1"),
          ErrorCode.AdsRecordAbsent,
        );
        await expectWebFlixErrorAsync(
          () => other.ads.claims.get("claim-1"),
          ErrorCode.AdsClaimAbsent,
        );
        await expectWebFlixErrorAsync(
          () => other.ads.evidenceEdges.get("ev-1"),
          ErrorCode.AdsEvidenceAbsent,
        );
        await expectWebFlixErrorAsync(
          () => other.ads.reviewSignals.get("rev-1"),
          ErrorCode.AdsReviewSignalAbsent,
        );
      } finally {
        other.close();
      }
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("the sqlite adapters satisfy the application ports structurally (mirror contract)", () => {
    const identities: AdvertiserIdentityStorePort = store.ads.identities;
    const records: AdRecordStorePort = store.ads.records;
    const claims: ClaimStorePort = store.ads.claims;
    const evidenceEdges: EvidenceEdgeStorePort = store.ads.evidenceEdges;
    const reviewSignals: ReviewSignalStorePort = store.ads.reviewSignals;
    expect(typeof identities.put).toBe("function");
    expect(typeof records.listBySourceAdId).toBe("function");
    expect(typeof records.delete).toBe("function");
    expect(typeof claims.listByAdRecordId).toBe("function");
    expect(typeof evidenceEdges.append).toBe("function");
    expect(typeof reviewSignals.append).toBe("function");
  });
});
