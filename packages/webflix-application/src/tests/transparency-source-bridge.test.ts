/**
 * The transparency-source IMPORT BRIDGE tests (P5-SOURCES scope row 4) —
 * the MAPPING TEST: when an adapter DOES become authorized, its
 * observations flow through the existing P5-STORES ads.import seam
 * UNCHANGED. The proof runs the whole honest path hermetically: the
 * LABELED fixture-replay double replays an ok result with observations
 * (no real source access), the bridge maps them into the ads.import
 * input shape (our ids + import stamps minted; every source-reported
 * field carried VERBATIM), and ads.import runs over the in-memory store
 * doubles — the STORED records are then asserted field-by-field
 * byte-equal to what the source reported (creativeText, creativeUrls,
 * regions, periods, sourceAdId, observedAt — unchanged), the identity
 * rows carry the source-reported advertiser facts, and the provenance
 * states the source + the stamps. Plus: the deterministic id minting
 * order (identity first, then record, per observation), the
 * observations array NEVER MUTATED (deep-equal), the honest empty batch
 * for zero observations, the NO-DEDUP rule (two observations reporting
 * the same advertiser = two identity rows — an identity-equality
 * judgment is NOT this order's), and the typed ads/source-invalid
 * caller-defect surface (blank source/batch id, non-ISO importedAt, a
 * malformed observation).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode } from "webflix-contracts";
import type { TransparencyObservation } from "webflix-contracts";
import {
  FixtureReplayTransparencySource,
  ImportAds,
  META_AD_LIBRARY_SOURCE_ID,
  mapObservationsToImportBatch,
  createInMemoryAdsStores,
} from "../index";

const NOW = new Date("2026-10-12T06:30:00Z");
const OBSERVED_AT = new Date("2026-10-10T00:00:00Z").toISOString();

const OBSERVATIONS: TransparencyObservation[] = [
  {
    sourceAdId: "999123",
    advertiser: {
      sourceAdvertiserId: "page-77",
      names: ["Acme Streaming", "Acme Streaming GmbH"],
      regions: ["US", "DE"],
      verificationState: "source-reported-verified",
    },
    creativeText: "Watch Acme — 50% off your first 3 months!",
    creativeUrls: ["https://acme.example/offer"],
    regions: ["US", "DE"],
    periods: [{ start: OBSERVED_AT, end: NOW.toISOString() }],
    observedAt: OBSERVED_AT,
  },
  {
    advertiser: { names: ["Beta Ads Ltd"] },
    creativeText: "Beta — try free for 30 days",
  },
];

/** The id generator the bridge test pins: sequential, human-readable. */
function seqIds(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe("mapObservationsToImportBatch — the mapping itself", () => {
  it("maps each observation to ONE identity + ONE record with our ids + stamps and every source-reported field VERBATIM", () => {
    const batch = mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: OBSERVATIONS,
      importBatchId: "batch-001",
      importedAt: NOW.toISOString(),
      generateId: seqIds("id"),
    });
    expect(batch.identities).toHaveLength(2);
    expect(batch.records).toHaveLength(2);

    const [identity, secondIdentity] = batch.identities;
    const [record, secondRecord] = batch.records;
    // The identity carries the source-reported advertiser facts, verbatim.
    expect(identity).toEqual({
      id: "id-1", // identity minted FIRST, per observation
      source: META_AD_LIBRARY_SOURCE_ID,
      sourceAdvertiserId: "page-77",
      names: ["Acme Streaming", "Acme Streaming GmbH"],
      regions: ["US", "DE"],
      verificationState: "source-reported-verified",
      reportedAt: OBSERVED_AT, // the exposure instant the identity report rode
    });
    expect(secondIdentity).toEqual({
      id: "id-3",
      source: META_AD_LIBRARY_SOURCE_ID,
      names: ["Beta Ads Ltd"],
    });
    // The record carries the source-reported ad facts, verbatim, paired
    // to its identity, with the provenance stating source + stamps.
    expect(record).toEqual({
      id: "id-2", // the record id minted SECOND
      sourceAdId: "999123",
      advertiserIdentityId: "id-1",
      creativeText: "Watch Acme — 50% off your first 3 months!",
      creativeUrls: ["https://acme.example/offer"],
      regions: ["US", "DE"],
      periods: [{ start: OBSERVED_AT, end: NOW.toISOString() }],
      provenance: {
        source: META_AD_LIBRARY_SOURCE_ID,
        observedAt: OBSERVED_AT,
        importedAt: NOW.toISOString(),
        importBatchId: "batch-001",
      },
    });
    // Honest-absent optionals stay ABSENT on the second observation.
    expect(secondRecord!).toEqual({
      id: "id-4",
      advertiserIdentityId: "id-3",
      creativeText: "Beta — try free for 30 days",
      provenance: {
        source: META_AD_LIBRARY_SOURCE_ID,
        importedAt: NOW.toISOString(),
        importBatchId: "batch-001",
      },
    });
    expect("sourceAdId" in secondRecord!).toBe(false);
    expect("observedAt" in secondRecord!.provenance).toBe(false);
  });

  it("NO DEDUP: two observations reporting the same advertiser yield two identity rows (no identity-equality judgment)", () => {
    const sameAdvertiser: TransparencyObservation[] = [
      { advertiser: { sourceAdvertiserId: "page-77" }, creativeText: "ad one" },
      { advertiser: { sourceAdvertiserId: "page-77" }, creativeText: "ad two" },
    ];
    const batch = mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: sameAdvertiser,
      importBatchId: "batch-002",
      importedAt: NOW.toISOString(),
      generateId: seqIds("x"),
    });
    expect(batch.identities).toHaveLength(2);
    expect(batch.records).toHaveLength(2);
  });

  it("ZERO observations => the honest EMPTY batch (never a fabricated row)", () => {
    const batch = mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: [],
      importBatchId: "batch-003",
      importedAt: NOW.toISOString(),
      generateId: seqIds("id"),
    });
    expect(batch.identities).toEqual([]);
    expect(batch.records).toEqual([]);
  });

  it("the observations array is NEVER MUTATED (deep-equal after the mapping)", () => {
    const before = JSON.parse(JSON.stringify(OBSERVATIONS));
    mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: OBSERVATIONS,
      importBatchId: "batch-004",
      importedAt: NOW.toISOString(),
      generateId: seqIds("id"),
    });
    expect(OBSERVATIONS).toEqual(before);
  });

  it("the id minting order is deterministic: identity then record, in observation order", () => {
    const ids: string[] = [];
    mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: OBSERVATIONS,
      importBatchId: "batch-005",
      importedAt: NOW.toISOString(),
      generateId: () => {
        ids.push(`mint-${ids.length + 1}`);
        return ids[ids.length - 1]!;
      },
    });
    expect(ids).toEqual(["mint-1", "mint-2", "mint-3", "mint-4"]);
  });
});

describe("mapObservationsToImportBatch — the typed caller-defect surface", () => {
  const valid = {
    source: META_AD_LIBRARY_SOURCE_ID,
    observations: OBSERVATIONS,
    importBatchId: "batch-x",
    importedAt: NOW.toISOString(),
    generateId: seqIds("id"),
  };
  const cases: readonly [string, unknown][] = [
    ["a blank source", { ...valid, source: "  " }],
    ["a blank importBatchId", { ...valid, importBatchId: "" }],
    ["a non-ISO importedAt", { ...valid, importedAt: "not-a-date" }],
    ["a missing id generator", { ...valid, generateId: undefined }],
    [
      "a malformed observation (advertiser identifying nothing)",
      { ...valid, observations: [{ creativeText: "no advertiser" }] },
    ],
  ];
  for (const [name, input] of cases) {
    it(`rejects ${name} with the typed ads/source-invalid error`, () => {
      expect(() => mapObservationsToImportBatch(input as never)).toThrowError(
        expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }),
      );
    });
  }
});

describe("THE MAPPING TEST — observations flow through ads.import UNCHANGED", () => {
  it("the authorized path end-to-end: the double's ok result -> the bridge -> ads.import -> the STORED rows carry the source-reported fields byte-equal", async () => {
    // 1. The LABELED double replays an authorized source's ok result
    //    (fixture data — no real source access, no network).
    const source = new FixtureReplayTransparencySource({
      manifest: {
        source: META_AD_LIBRARY_SOURCE_ID,
        displayName: "Meta Ad Library",
        accessState: "available",
        coverageNote: "fixture manifest for the authorized-path test",
      },
      result: { status: "ok", observations: OBSERVATIONS },
    });
    const result = await source.query({ searchTerms: "acme" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // 2. The bridge maps the observations into the ads.import input shape.
    const batch = mapObservationsToImportBatch({
      source: source.manifest.source,
      observations: result.observations,
      importBatchId: "batch-import-001",
      importedAt: NOW.toISOString(),
      generateId: seqIds("ac"),
    });

    // 3. ads.import runs the batch through the REAL import seam (the
    //    in-memory store doubles — the same hermetic substrate the seam's
    //    own tests use).
    const stores = createInMemoryAdsStores();
    let jobSeq = 0;
    const importAds = new ImportAds({
      identities: stores.identities,
      records: stores.records,
      claims: stores.claims,
      reviewSignals: stores.reviewSignals,
      clock: { now: () => NOW },
      generateId: () => `import-job-${(jobSeq += 1)}`,
    });
    const { job, report } = await importAds.execute({
      importBatchId: "batch-import-001",
      identities: batch.identities,
      records: batch.records,
      claims: [],
    });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({ accepted: 4, rejected: 0, total: 4 });

    // 4. THE PROOF: the stored rows carry the source-reported fields
    //    UNCHANGED — the flow lands byte-equal.
    const storedFirst = await stores.records.get(batch.records[0]!.id);
    expect(storedFirst).toEqual(batch.records[0]);
    expect(storedFirst.creativeText).toBe(OBSERVATIONS[0]!.creativeText);
    expect(storedFirst.creativeUrls).toEqual(OBSERVATIONS[0]!.creativeUrls);
    expect(storedFirst.regions).toEqual(OBSERVATIONS[0]!.regions);
    expect(storedFirst.periods).toEqual(OBSERVATIONS[0]!.periods);
    expect(storedFirst.sourceAdId).toBe(OBSERVATIONS[0]!.sourceAdId);
    expect(storedFirst.provenance.source).toBe(META_AD_LIBRARY_SOURCE_ID);
    expect(storedFirst.provenance.observedAt).toBe(OBSERVATIONS[0]!.observedAt);
    expect(storedFirst.provenance.importBatchId).toBe("batch-import-001");
    const storedSecond = await stores.records.get(batch.records[1]!.id);
    expect(storedSecond.creativeText).toBe(OBSERVATIONS[1]!.creativeText);

    const storedIdentity = await stores.identities.get(batch.identities[0]!.id);
    expect(storedIdentity).toEqual(batch.identities[0]);
    expect(storedIdentity.names).toEqual(OBSERVATIONS[0]!.advertiser.names);
    expect(storedIdentity.verificationState).toBe(OBSERVATIONS[0]!.advertiser.verificationState);
    expect(storedIdentity.sourceAdvertiserId).toBe(OBSERVATIONS[0]!.advertiser.sourceAdvertiserId);
  });

  it("re-importing the SAME mapped batch is idempotent per the seam's replace rule (the authorized flow's recovery)", async () => {
    const batch = mapObservationsToImportBatch({
      source: META_AD_LIBRARY_SOURCE_ID,
      observations: [OBSERVATIONS[0]!],
      importBatchId: "batch-import-002",
      importedAt: NOW.toISOString(),
      generateId: seqIds("rr"),
    });
    const stores = createInMemoryAdsStores();
    let jobSeq = 0;
    const importAds = new ImportAds({
      identities: stores.identities,
      records: stores.records,
      claims: stores.claims,
      reviewSignals: stores.reviewSignals,
      clock: { now: () => NOW },
      generateId: () => `import-job-${(jobSeq += 1)}`,
    });
    const input = {
      importBatchId: "batch-import-002",
      identities: batch.identities,
      records: batch.records,
      claims: [] as never[],
    };
    const first = await importAds.execute(input);
    const second = await importAds.execute(input);
    expect(first.job.state).toBe("succeeded");
    expect(second.job.state).toBe("succeeded");
    expect(second.report!.counts).toEqual({ accepted: 2, rejected: 0, total: 2 });
    const stored = await stores.records.get(batch.records[0]!.id);
    expect(stored).toEqual(batch.records[0]);
  });
});
