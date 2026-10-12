/**
 * ads.import — the Ad Center IMPORT SEAM use case tests (P5-STORES row 3):
 * the §2.6 job semantics (boundary + per-item cooperative cancellation),
 * per-record honest outcomes (accepted-with-disposition /
 * rejected-with-reason typed), the charter's version rule made literal
 * (same source id + same batch = replace; different batch = a NEW version
 * appended; NEVER a silent overwrite of history), the seam-level
 * referential checks (identity resolution, claim-record resolution, the
 * extractive discipline through the domain invariant), id-stability
 * (identities never migrate sources; claims never re-point), the
 * originals-never-mutated rule, and infrastructure-failure handling
 * (job failed + the cause rethrown typed).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { AdRecord, AdvertiserIdentity, Claim, ReviewSignal } from "webflix-contracts";
import {
  AdsImportJobError,
  ImportAds,
  createInMemoryAdsStores,
  type ImportAdsDeps,
  type ImportAdsInput,
  type AdsImportReport,
} from "../index";
import { InMemoryAdRecordStore } from "../index";

const NOW = new Date("2026-10-12T01:00:00Z");
const ISO = "2026-10-12T00:00:00Z";
const ISO_LATER = "2026-10-20T12:30:00Z";

const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months!";

function provenance(batchId: string) {
  return {
    source: "meta-ad-library",
    observedAt: ISO,
    importedAt: ISO_LATER,
    importBatchId: batchId,
  };
}

const identity = (): AdvertiserIdentity => ({
  id: "adv-1",
  source: "meta-ad-library",
  sourceAdvertiserId: "page-77",
  names: ["Acme Streaming"],
  regions: ["US", "DE"],
  verificationState: "source-reported-verified",
  reportedAt: ISO,
});

const record = (id = "ad-1", batchId = "batch-001"): AdRecord => ({
  id,
  sourceAdId: "999123",
  advertiserIdentityId: "adv-1",
  creativeText: CREATIVE_TEXT,
  creativeUrls: ["https://acme.example/offer"],
  regions: ["US", "DE"],
  periods: [{ start: ISO, end: ISO_LATER }],
  provenance: provenance(batchId),
});

const claim = (id = "claim-1", adRecordId = "ad-1"): Claim => {
  const quote = "50% off your first 3 months";
  const start = CREATIVE_TEXT.indexOf(quote);
  return { id, adRecordId, quote, startOffset: start, endOffset: start + quote.length };
};

const signal = (id = "rev-1", batchId = "batch-001"): ReviewSignal => ({
  id,
  source: "streaming-reviews.example",
  asReportedRating: "3.1/5",
  asReportedClassification: "mixed",
  region: "US",
  scope: "streaming services",
  provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: batchId },
});

function makeDeps(overrides: Partial<ImportAdsDeps> = {}): ImportAdsDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    identities: stores.identities,
    records: stores.records,
    claims: stores.claims,
    reviewSignals: stores.reviewSignals,
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

function fullBatch(overrides: Partial<ImportAdsInput> = {}): ImportAdsInput {
  return {
    importBatchId: "batch-001",
    identities: [identity()],
    records: [record()],
    claims: [claim()],
    reviewSignals: [signal()],
    ...overrides,
  };
}

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

function rejectedOf(report: AdsImportReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "rejected");
}

function acceptedOf(report: AdsImportReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "accepted");
}

describe("ads.import — the Ad Center import seam (§2.6 job)", () => {
  // -------------------------------------------------------------------------
  // The happy path + the honest report
  // -------------------------------------------------------------------------

  it("imports a full batch: job succeeded, every item accepted with its disposition, stores hold the data", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    const input = fullBatch();
    const { job, report } = await useCase.execute(input);
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe("ads.import");
    expect(job.cancellable).toBe(true);
    expect(job.payload["importBatchId"]).toBe("batch-001");
    expect(report).not.toBeNull();
    expect(report!.counts).toEqual({ accepted: 4, rejected: 0, total: 4 });
    const dispositions = acceptedOf(report!).map((outcome) => outcome.disposition);
    expect(dispositions).toEqual(["inserted", "inserted", "inserted", "appended"]);
    expect(await deps.identities.get("adv-1")).toEqual(identity());
    expect(await deps.records.get("ad-1")).toEqual(record());
    expect(await deps.claims.get("claim-1")).toEqual(claim());
    expect(await deps.reviewSignals.get("rev-1")).toEqual(signal());
  });

  it("a batch with NO review signals (the optional array) imports cleanly", async () => {
    const deps = makeDeps();
    const input = fullBatch();
    delete (input as { reviewSignals?: unknown }).reviewSignals;
    const { job, report } = await new ImportAds(deps).execute(input);
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({ accepted: 3, rejected: 0, total: 3 });
  });

  it("ORIGINALS NEVER MUTATED: the caller's batch arrays are deep-equal after the run", async () => {
    const deps = makeDeps();
    const input = fullBatch();
    const snapshot = JSON.parse(JSON.stringify(input));
    await new ImportAds(deps).execute(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  // -------------------------------------------------------------------------
  // Caller defects validated BEFORE the job exists (typed throws, no job)
  // -------------------------------------------------------------------------

  it("a blank importBatchId is a caller defect thrown BEFORE the job exists", async () => {
    const deps = makeDeps();
    await expectWebFlixErrorAsync(
      () => new ImportAds(deps).execute(fullBatch({ importBatchId: "  " })),
      ErrorCode.AdsRecordInvalid,
    );
  });

  it("duplicate ids WITHIN one batch array are a caller defect (typed, no job)", async () => {
    const deps = makeDeps();
    const err = await expectWebFlixErrorAsync(
      () => new ImportAds(deps).execute(fullBatch({ records: [record(), record()] })),
      ErrorCode.AdsRecordInvalid,
    );
    expect(err.reason).toContain("twice");
  });

  it("a record whose provenance batch differs from the batch's is a caller defect", async () => {
    const deps = makeDeps();
    await expectWebFlixErrorAsync(
      () => new ImportAds(deps).execute(fullBatch({ records: [record("ad-1", "batch-other")] })),
      ErrorCode.AdsRecordInvalid,
    );
  });

  it("a review signal whose provenance batch differs is a caller defect", async () => {
    const deps = makeDeps();
    await expectWebFlixErrorAsync(
      () =>
        new ImportAds(deps).execute(fullBatch({ reviewSignals: [signal("rev-1", "batch-other")] })),
      ErrorCode.AdsRecordInvalid,
    );
  });

  // -------------------------------------------------------------------------
  // Cancellation, both phases
  // -------------------------------------------------------------------------

  it("BOUNDARY cancellation: an already-aborted signal cancels the job, nothing is stored", async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new ImportAds(deps).execute(
      fullBatch({ signal: controller.signal }),
    );
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(await deps.identities.list()).toEqual([]);
    expect(await deps.records.list()).toEqual([]);
    expect(await deps.claims.list()).toEqual([]);
    expect(await deps.reviewSignals.list()).toEqual([]);
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each item stops the batch; already-persisted items stay (per-record atomicity); report null", async () => {
    const controller = new AbortController();
    const records = new (class extends InMemoryAdRecordStore {
      override async put(one: AdRecord): Promise<void> {
        await super.put(one);
        controller.abort();
      }
    })();
    const deps = makeDeps({ records });
    const { job, report } = await new ImportAds(deps).execute(
      fullBatch({ records: [record("ad-1"), record("ad-2")], signal: controller.signal }),
    );
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    // The first record WAS persisted (atomic per record, not per batch);
    // the second never ran; claims referencing ad-2 never processed.
    expect((await deps.records.list()).map((one) => one.id)).toEqual(["ad-1"]);
    expect(await deps.claims.list()).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Per-record outcomes: a bad item fails THAT item typed
  // -------------------------------------------------------------------------

  it("a record referencing an UNKNOWN identity is rejected typed; the other items still import (honest counts)", async () => {
    const deps = makeDeps();
    const orphan: AdRecord = { ...record("ad-orphan"), advertiserIdentityId: "adv-nope" };
    const { report } = await new ImportAds(deps).execute(
      fullBatch({ records: [orphan, record("ad-2")], claims: [claim("claim-1", "ad-2")] }),
    );
    expect(report!.counts).toEqual({ accepted: 4, rejected: 1, total: 5 });
    const rejections = rejectedOf(report!);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.kind).toBe("record");
    expect(rejections[0]!.code).toBe(ErrorCode.AdsRecordInvalid);
    expect(rejections[0]!.reason).toContain("adv-nope");
    expect(await deps.records.get("ad-2")).toBeDefined();
  });

  it("a claim whose record was REJECTED in this batch fails referentially (the honest cascade)", async () => {
    const deps = makeDeps();
    const orphan: AdRecord = { ...record(), advertiserIdentityId: "adv-nope" };
    const input = fullBatch({
      records: [orphan],
      claims: [claim("claim-1", "ad-1")],
    });
    const { report } = await new ImportAds(deps).execute(input);
    // identity accepted; record rejected (unknown identity); claim rejected
    // (its record was never stored); signal accepted.
    expect(report!.counts).toEqual({ accepted: 2, rejected: 2, total: 4 });
    const kinds = rejectedOf(report!).map((outcome) => outcome.kind);
    expect(kinds).toEqual(["record", "claim"]);
    const claimRejection = rejectedOf(report!)[1]!;
    expect(claimRejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(claimRejection.reason).toContain("not stored");
  });

  it("the EXTRACTIVE discipline is enforced through the domain invariant: a non-byte-equal quote is rejected with the violation code", async () => {
    const deps = makeDeps();
    const forged: Claim = { ...claim(), quote: "60% off your first 3 months" };
    const { report } = await new ImportAds(deps).execute(fullBatch({ claims: [forged] }));
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("quote-not-byte-equal");
    expect(await deps.claims.list()).toEqual([]);
  });

  it("out-of-bounds claim offsets are rejected (offsets-out-of-bounds)", async () => {
    const deps = makeDeps();
    const beyond: Claim = { ...claim(), startOffset: 900, endOffset: 905 };
    const { report } = await new ImportAds(deps).execute(fullBatch({ claims: [beyond] }));
    expect(rejectedOf(report!)[0]!.reason).toContain("offsets-out-of-bounds");
  });

  it("a claim against a record with NO creative text is rejected (no-creative-text)", async () => {
    const deps = makeDeps();
    const textless: AdRecord = { ...record(), creativeText: undefined };
    const { report } = await new ImportAds(deps).execute(
      fullBatch({ records: [textless], claims: [claim()] }),
    );
    expect(rejectedOf(report!)[0]!.reason).toContain("no-creative-text");
  });

  it("a malformed record (shape violation) is rejected typed with its id surfaced", async () => {
    const deps = makeDeps();
    const malformed = { ...record(), advertiserIdentityId: "" };
    const { report } = await new ImportAds(deps).execute(fullBatch({ records: [malformed] }));
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.kind).toBe("record");
    expect(rejection.id).toBe("ad-1");
    expect(rejection.code).toBe(ErrorCode.AdsRecordInvalid);
  });

  it("a malformed review signal (neither rating nor classification) is rejected typed", async () => {
    const deps = makeDeps();
    const empty: ReviewSignal = {
      id: "rev-empty",
      source: "nobody",
      provenance: { source: "user-import", importedAt: ISO_LATER, importBatchId: "batch-001" },
    };
    const { report } = await new ImportAds(deps).execute(fullBatch({ reviewSignals: [empty] }));
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.kind).toBe("review-signal");
    expect(rejection.code).toBe(ErrorCode.AdsRecordInvalid);
  });

  // -------------------------------------------------------------------------
  // The version rule (same source id + batch = replace; different batch =
  // new version appended; NEVER a silent overwrite)
  // -------------------------------------------------------------------------

  it("SAME batch re-run: every record REPLACES (idempotent), signals DUPLICATE — no second rows, same honest counts", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    const first = await useCase.execute(fullBatch());
    expect(first.report!.counts).toEqual({ accepted: 4, rejected: 0, total: 4 });
    const second = await useCase.execute(fullBatch());
    expect(second.job.state).toBe("succeeded");
    expect(second.report!.counts).toEqual({ accepted: 4, rejected: 0, total: 4 });
    const dispositions = acceptedOf(second.report!).map((outcome) => outcome.disposition);
    expect(dispositions).toEqual(["replaced", "replaced", "replaced", "duplicate"]);
    expect(await deps.records.list()).toHaveLength(1);
    expect(await deps.identities.list()).toHaveLength(1);
    expect(await deps.claims.list()).toHaveLength(1);
    expect(await deps.reviewSignals.list()).toHaveLength(1);
  });

  it("SAME batch re-run with FRESH record ids: the new rows replace the old ones (the superseded ids are deleted explicitly)", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const retry = await useCase.execute(fullBatch({ records: [record("ad-fresh")] }));
    const recordOutcome = acceptedOf(retry.report!).find((outcome) => outcome.kind === "record")!;
    expect(recordOutcome.disposition).toBe("replaced");
    const storedIds = (await deps.records.list()).map((one) => one.id);
    expect(storedIds).toEqual(["ad-fresh"]);
    // The old row is GONE (replaced away), the new one is the stored truth.
    await expectWebFlixErrorAsync(() => deps.records.get("ad-1"), ErrorCode.AdsRecordAbsent);
  });

  it("DIFFERENT batch, same (source, sourceAdId): a NEW VERSION is APPENDED and the prior version stays untouched", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const updated = record("ad-1-v2", "batch-002");
    const second = await useCase.execute(
      fullBatch({
        importBatchId: "batch-002",
        identities: [],
        claims: [],
        records: [updated],
        reviewSignals: undefined,
      }),
    );
    const recordOutcome = acceptedOf(second.report!).find((outcome) => outcome.kind === "record")!;
    expect(recordOutcome.disposition).toBe("version-appended");
    const versions = await deps.records.listBySourceAdId("meta-ad-library", "999123");
    expect(versions.map((one) => one.id)).toEqual(["ad-1", "ad-1-v2"]);
    // The prior version is UNTOUCHED (history never silently overwritten).
    expect(versions[0]).toEqual(record());
    expect(versions[1]).toEqual(updated);
  });

  it("a record id that names a STORED record from a DIFFERENT batch is REJECTED typed (never silently overwrite history)", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const clash = record("ad-1", "batch-002");
    const second = await useCase.execute(
      fullBatch({
        importBatchId: "batch-002",
        identities: [],
        claims: [],
        records: [clash],
        reviewSignals: undefined,
      }),
    );
    const rejection = rejectedOf(second.report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsRecordInvalid);
    expect(rejection.reason).toContain("never silently overwritten");
    // The stored batch-001 record is INTACT.
    expect(await deps.records.get("ad-1")).toEqual(record());
    expect(await deps.records.listBySourceAdId("meta-ad-library", "999123")).toHaveLength(1);
  });

  it("a record id that names a stored DIFFERENT ad (same batch, other sourceAdId) is REJECTED (no id laundering)", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const otherAd: AdRecord = { ...record("ad-1", "batch-001"), sourceAdId: "other-ad" };
    const second = await useCase.execute(
      fullBatch({ identities: [], claims: [], records: [otherAd], reviewSignals: undefined }),
    );
    const rejection = rejectedOf(second.report!)[0]!;
    expect(rejection.reason).toContain("never migrates");
    expect(await deps.records.get("ad-1")).toEqual(record());
  });

  it("a record with NO sourceAdId is keyed by id alone: same batch = replace, different batch = reject", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    const bare: AdRecord = {
      id: "ad-bare",
      advertiserIdentityId: "adv-1",
      provenance: provenance("batch-001"),
    };
    await useCase.execute(fullBatch({ records: [bare], claims: [] }));
    const bareAgain: AdRecord = { ...bare, creativeText: "re-delivered" };
    const second = await useCase.execute(fullBatch({ records: [bareAgain], claims: [] }));
    const outcome = acceptedOf(second.report!).find(
      (o) => o.kind === "record" && o.id === "ad-bare",
    )!;
    expect(outcome.disposition).toBe("replaced");
    expect(await deps.records.get("ad-bare")).toEqual(bareAgain);
    const bareOtherBatch: AdRecord = { ...bare, provenance: provenance("batch-002") };
    const third = await useCase.execute(
      fullBatch({
        importBatchId: "batch-002",
        identities: [],
        claims: [],
        records: [bareOtherBatch],
        reviewSignals: undefined,
      }),
    );
    const rejection = rejectedOf(third.report!)[0]!;
    expect(rejection.reason).toContain("never silently overwritten");
  });

  // -------------------------------------------------------------------------
  // ID stability (identities never migrate sources; claims never re-point)
  // -------------------------------------------------------------------------

  it("an identity id MIGRATING between sources is rejected typed", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const migrated: AdvertiserIdentity = { ...identity(), source: "tiktok-ads" };
    const second = await useCase.execute(
      fullBatch({ identities: [migrated], records: [], claims: [], reviewSignals: undefined }),
    );
    const rejection = rejectedOf(second.report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsRecordInvalid);
    expect(rejection.reason).toContain("never migrates");
    expect((await deps.identities.get("adv-1")).source).toBe("meta-ad-library");
  });

  it("a claim id RE-POINTING at a different record is rejected typed", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    const secondAd: AdRecord = { ...record("ad-2"), sourceAdId: "999456" };
    await useCase.execute(fullBatch({ records: [record("ad-1"), secondAd] }));
    const rePointed = claim("claim-1", "ad-2");
    const second = await useCase.execute(
      fullBatch({ identities: [], records: [], claims: [rePointed], reviewSignals: undefined }),
    );
    const rejection = rejectedOf(second.report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("never re-points");
    expect((await deps.claims.get("claim-1")).adRecordId).toBe("ad-1");
  });

  it("a claim REPLACED with a different span of the SAME record updates in place (the id is the idempotency key)", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    await useCase.execute(fullBatch());
    const otherQuote = "Watch Acme";
    const updated: Claim = {
      ...claim(),
      quote: otherQuote,
      startOffset: CREATIVE_TEXT.indexOf(otherQuote),
      endOffset: CREATIVE_TEXT.indexOf(otherQuote) + otherQuote.length,
    };
    const second = await useCase.execute(
      fullBatch({ identities: [], records: [], claims: [updated], reviewSignals: undefined }),
    );
    expect(acceptedOf(second.report!)[0]!.disposition).toBe("replaced");
    expect(await deps.claims.get("claim-1")).toEqual(updated);
    expect(await deps.claims.list()).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Infrastructure failures (a store throwing mid-batch)
  // -------------------------------------------------------------------------

  it("a mid-batch infrastructure failure stamps the job FAILED and rethrows typed (the cause intact)", async () => {
    const records = new (class extends InMemoryAdRecordStore {
      override async put(one: AdRecord): Promise<void> {
        if (one.id === "ad-2") {
          throw new Error("sqlite exploded");
        }
        await super.put(one);
      }
    })();
    const deps = makeDeps({ records });
    const useCase = new ImportAds(deps);
    const err = await expectWebFlixErrorAsync(
      () =>
        useCase.execute(
          fullBatch({
            records: [record("ad-1"), record("ad-2")],
            claims: [],
            reviewSignals: undefined,
          }),
        ),
      ErrorCode.AdsRecordInvalid,
    );
    expect(err).toBeInstanceOf(AdsImportJobError);
    expect((err as AdsImportJobError).job.state).toBe("failed");
    expect((err as AdsImportJobError).job.lastError).toContain("sqlite exploded");
    // The completed record stays stored (atomic PER RECORD, documented).
    expect((await deps.records.list()).map((one) => one.id)).toEqual(["ad-1"]);
  });

  // -------------------------------------------------------------------------
  // The report's honesty invariants
  // -------------------------------------------------------------------------

  it("every report's counts add up: accepted + rejected === total === outcomes.length", async () => {
    const deps = makeDeps();
    const useCase = new ImportAds(deps);
    const orphan: AdRecord = { ...record("ad-orphan"), advertiserIdentityId: "adv-nope" };
    const { report } = await useCase.execute(
      fullBatch({ records: [orphan, record("ad-2")], claims: [claim(), claim("claim-2", "ad-2")] }),
    );
    expect(report!.outcomes).toHaveLength(report!.counts.total);
    expect(report!.counts.accepted + report!.counts.rejected).toBe(report!.counts.total);
    expect(acceptedOf(report!).length).toBe(report!.counts.accepted);
    expect(rejectedOf(report!).length).toBe(report!.counts.rejected);
  });
});
