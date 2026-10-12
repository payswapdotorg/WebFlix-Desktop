/**
 * ads.extractClaims — the §2.6 extraction use case tests (P5-CLAIMS scope
 * row 2): the job semantics (kind/provenance/payload, boundary + per-record
 * cooperative cancellation), per-record honest outcomes (extracted-with-
 * disposition / rejected-with-reason typed), the VERSION RULE made literal
 * (same extractor version + same record = idempotent put-replace, the store
 * byte-identical; a different version = a NEW provenance append, prior
 * claims untouched), the extractive discipline re-validated through the
 * domain invariant before persisting (a forged quote, a wrong-record claim,
 * duplicate minted ids — each rejects THAT record, nothing stored), the
 * SOURCE RECORD NEVER MUTATED (deep-equal), caller defects validated before
 * the job exists, and infrastructure failures (store throw, extractor
 * throw) stamping the job FAILED and rethrowing typed.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode } from "webflix-contracts";
import type { AdRecord, Claim } from "webflix-contracts";
import {
  AdsExtractClaimsJobError,
  BuiltInAdsClaimExtractor,
  ExtractAdsClaims,
  FixtureReplayAdsClaimExtractor,
  InMemoryClaimStore,
  createInMemoryAdsStores,
  type ExtractAdsClaimsDeps,
  type AdsClaimExtractionReport,
} from "../index";

const NOW = new Date("2026-10-12T03:00:00Z");
const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months! Limited time offer.";
const PLAIN_TEXT = "A plain description with no claimable phrasing at all here";

const record = (id: string, creativeText = CREATIVE_TEXT): AdRecord => ({
  id,
  sourceAdId: `src-${id}`,
  advertiserIdentityId: "adv-1",
  creativeText,
  provenance: { source: "user-import", importedAt: NOW.toISOString(), importBatchId: "batch-001" },
});

/** A disciplined claim fixture cut by indexOf, never hand-counted. */
function spanClaim(id: string, adRecordId: string, text: string, quote: string): Claim {
  const start = text.indexOf(quote);
  return { id, adRecordId, quote, startOffset: start, endOffset: start + quote.length };
}

function makeDeps(overrides: Partial<ExtractAdsClaimsDeps> = {}): ExtractAdsClaimsDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    records: stores.records,
    claims: stores.claims,
    extractor: new BuiltInAdsClaimExtractor(),
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

async function seedRecord(deps: ExtractAdsClaimsDeps, one: AdRecord): Promise<AdRecord> {
  await deps.records.put(one);
  return one;
}

function extractedOf(report: AdsClaimExtractionReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "extracted");
}

function rejectedOf(report: AdsClaimExtractionReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "rejected");
}

describe("ads.extractClaims — the §2.6 job (happy path + honest report)", () => {
  it("extracts a stored record's claims: job succeeded, provenance carries the EXTRACTOR identity, claims persisted", async () => {
    const deps = makeDeps();
    const extractor = deps.extractor;
    await seedRecord(deps, record("ad-1"));
    const { job, report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe("ads.extract-claims");
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe(extractor.id);
    expect(job.provenance.connectorVersion).toBe(extractor.version);
    expect(job.payload["extractorId"]).toBe(extractor.id);
    expect(job.payload["extractorVersion"]).toBe(extractor.version);
    expect(job.payload["recordIdsCount"]).toBe(1);
    expect(report).not.toBeNull();
    expect(report!.counts).toEqual({ extracted: 1, rejected: 0, total: 1, claims: 2 });
    const outcome = extractedOf(report!)[0]!;
    expect(outcome.disposition).toBe("inserted");
    expect(outcome.priorClaimCount).toBe(0);
    expect(outcome.claimCount).toBe(2);
    // Both claims stored, disciplined, and listable by record.
    const stored = await deps.claims.listByAdRecordId("ad-1");
    expect(stored.map((claim) => claim.id).sort()).toEqual([...outcome.claimIds].sort());
    for (const claim of stored) {
      expect(CREATIVE_TEXT.slice(claim.startOffset, claim.endOffset)).toBe(claim.quote);
    }
  });

  it("honest mixed report: extracted / absent-record / textless / no-match outcomes with counts that add up", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-good"));
    await seedRecord(deps, record("ad-plain", PLAIN_TEXT));
    await deps.records.put({ ...record("ad-textless"), creativeText: undefined });
    const { job, report } = await new ExtractAdsClaims(deps).execute({
      recordIds: ["ad-good", "ad-absent", "ad-textless", "ad-plain"],
    });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({ extracted: 3, rejected: 1, total: 4, claims: 2 });
    expect(extractedOf(report!).map((outcome) => outcome.recordId)).toEqual([
      "ad-good",
      "ad-textless",
      "ad-plain",
    ]);
    expect(rejectedOf(report!).map((outcome) => outcome.recordId)).toEqual(["ad-absent"]);
    const good = extractedOf(report!)[0]!;
    expect(good.claimCount).toBe(2);
    const absent = rejectedOf(report!)[0]!;
    expect(absent.code).toBe(ErrorCode.AdsRecordAbsent);
    expect(absent.reason).toContain("ad-absent");
    const [textless, plain] = extractedOf(report!).slice(1);
    expect(textless!.disposition).toBe("empty");
    expect(textless!.claimCount).toBe(0);
    expect(textless!.claimIds).toEqual([]);
    expect(plain!.disposition).toBe("empty");
    expect(plain!.claimCount).toBe(0);
    expect(await deps.claims.listByAdRecordId("ad-textless")).toEqual([]);
    expect(await deps.claims.listByAdRecordId("ad-plain")).toEqual([]);
  });

  it("priorClaimCount reports the record's pre-run claims (any extractor)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await deps.claims.put(
      spanClaim("manual-claim", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    const { report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    const outcome = extractedOf(report!)[0]!;
    expect(outcome.priorClaimCount).toBe(1);
  });

  it("an empty record batch is an honest trivial success (0/0/0)", async () => {
    const deps = makeDeps();
    const { job, report } = await new ExtractAdsClaims(deps).execute({ recordIds: [] });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({ extracted: 0, rejected: 0, total: 0, claims: 0 });
    expect(report!.outcomes).toEqual([]);
  });
});

describe("ads.extractClaims — the version rule (the charter, literal)", () => {
  it("SAME extractor version + same record = IDEMPOTENT replace: the store is byte-identical after a re-run", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    const useCase = new ExtractAdsClaims(deps);
    const first = await useCase.execute({ recordIds: ["ad-1"] });
    const afterFirst = await deps.claims.list();
    const second = await useCase.execute({ recordIds: ["ad-1"] });
    expect(second.job.state).toBe("succeeded");
    const outcome = extractedOf(second.report!)[0]!;
    expect(outcome.disposition).toBe("replaced");
    expect(outcome.claimIds).toEqual(extractedOf(first.report!)[0]!.claimIds);
    expect(await deps.claims.list()).toEqual(afterFirst);
  });

  it("a DIFFERENT extractor version = a NEW provenance append: prior claims untouched, both versions coexist", async () => {
    const deps = makeDeps({ extractor: new BuiltInAdsClaimExtractor() });
    await seedRecord(deps, record("ad-1"));
    // v1: the real engine. v2: the same engine with its version overridden
    // (the id template embeds the version, so v2 mints different ids).
    class V2AdsClaimExtractor extends BuiltInAdsClaimExtractor {
      override readonly version = "2.0.0";
    }
    const v1 = new ExtractAdsClaims(deps);
    const { report: v1Report } = await v1.execute({ recordIds: ["ad-1"] });
    const v1Claims = await deps.claims.listByAdRecordId("ad-1");

    const v2Deps: ExtractAdsClaimsDeps = { ...deps, extractor: new V2AdsClaimExtractor() };
    const { report: v2Report, job: v2Job } = await new ExtractAdsClaims(v2Deps).execute({
      recordIds: ["ad-1"],
    });
    expect(v2Job.provenance.connectorVersion).toBe("2.0.0");
    const v2Outcome = extractedOf(v2Report!)[0]!;
    expect(v2Outcome.disposition).toBe("inserted");
    expect(v2Outcome.priorClaimCount).toBe(v1Claims.length);
    // BOTH versions' claims are stored; the v1 rows are untouched.
    const all = await deps.claims.listByAdRecordId("ad-1");
    expect(all).toHaveLength(v1Claims.length + v2Outcome.claimCount);
    for (const claim of v1Claims) {
      expect(all.find((one) => one.id === claim.id)).toEqual(claim);
    }
    expect(extractedOf(v1Report!)[0]!.claimIds).not.toEqual(v2Outcome.claimIds);
  });

  it("claims whose ids a re-run does NOT re-produce stay stored (no delete; honest outlive)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    // Seed a claim the extractor will never mint (a prior version's span).
    await deps.claims.put(spanClaim("legacy-claim", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    // The legacy claim is still there — history is never silently dropped.
    expect(await deps.claims.get("legacy-claim")).toBeDefined();
  });
});

describe("ads.extractClaims — the source record is NEVER mutated", () => {
  it("deep-equal snapshot of the stored record before and after extraction", async () => {
    const deps = makeDeps();
    const seeded = await seedRecord(deps, record("ad-1"));
    const before = structuredClone(seeded);
    await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    expect(await deps.records.get("ad-1")).toEqual(before);
    expect(await deps.records.get("ad-1")).toEqual(seeded);
  });

  it("the caller's recordIds array is read, never mutated", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    const recordIds = ["ad-1"];
    const before = [...recordIds];
    await new ExtractAdsClaims(deps).execute({ recordIds });
    expect(recordIds).toEqual(before);
  });
});

describe("ads.extractClaims — cancellation, both phases", () => {
  it("BOUNDARY cancellation: an already-aborted signal cancels the job, nothing stored, the extractor never runs", async () => {
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: {
        "ad-1": [spanClaim("fx-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months")],
      },
    });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new ExtractAdsClaims(deps).execute({
      recordIds: ["ad-1"],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(await deps.claims.list()).toEqual([]);
    expect(fixture.calls).toEqual([]);
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each record stops the batch; the completed record's claims stay; report null", async () => {
    const controller = new AbortController();
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: {
        "ad-1": [spanClaim("fx-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months")],
        "ad-2": [spanClaim("fx-2", "ad-2", CREATIVE_TEXT, "Limited time offer.")],
      },
    });
    const claims = new (class extends InMemoryClaimStore {
      override async put(claim: Claim): Promise<void> {
        await super.put(claim);
        controller.abort();
      }
    })();
    const deps = makeDeps({ extractor: fixture, claims });
    await seedRecord(deps, record("ad-1"));
    await seedRecord(deps, record("ad-2"));
    const { job, report } = await new ExtractAdsClaims(deps).execute({
      recordIds: ["ad-1", "ad-2"],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    // ad-1's claim persisted (per-record atomicity); ad-2 never extracted.
    expect((await claims.list()).map((claim) => claim.id)).toEqual(["fx-1"]);
    expect(fixture.calls.map((call) => call.recordId)).toEqual(["ad-1"]);
    // The documented recovery: re-running the same input is idempotent.
    const rerun = await new ExtractAdsClaims({ ...deps, claims: new InMemoryClaimStore() }).execute(
      { recordIds: ["ad-1", "ad-2"] },
    );
    expect(rerun.job.state).toBe("succeeded");
  });
});

describe("ads.extractClaims — per-record rejections (typed, nothing stored for THAT record)", () => {
  it("a forged quote (not byte-equal) rejects the record with the violation code", async () => {
    // Valid offsets, forged quote — the discipline's core case.
    const forged: Claim = {
      ...spanClaim("fx-bad", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
      quote: "60% off your first 3 months",
    };
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: { "ad-1": [forged] },
    });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    const { report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("quote-not-byte-equal");
    expect(rejection.reason).toContain("extractive discipline");
    expect(await deps.claims.list()).toEqual([]);
  });

  it("a wrong-record claim (adRecordId mismatch) rejects the record with wrong-record", async () => {
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: {
        "ad-1": [spanClaim("fx-wrong", "ad-other", CREATIVE_TEXT, "50% off your first 3 months")],
      },
    });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    const { report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("wrong-record");
    expect(await deps.claims.list()).toEqual([]);
  });

  it("duplicate minted claim ids reject the record — no silent merge of distinct spans", async () => {
    const one = spanClaim("fx-dup", "ad-1", CREATIVE_TEXT, "50% off your first 3 months");
    const two = spanClaim("fx-dup", "ad-1", CREATIVE_TEXT, "Limited time offer.");
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: { "ad-1": [one, two] },
    });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    const { report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("duplicate claim id");
    expect(await deps.claims.list()).toEqual([]);
  });

  it("an out-of-bounds offsets claim rejects the record with offsets-out-of-bounds", async () => {
    const fixture = new FixtureReplayAdsClaimExtractor({
      claimsByRecordId: {
        "ad-1": [
          { id: "fx-oob", adRecordId: "ad-1", quote: "months", startOffset: 900, endOffset: 906 },
        ],
      },
    });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    const { report } = await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    const rejection = rejectedOf(report!)[0]!;
    expect(rejection.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(rejection.reason).toContain("offsets-out-of-bounds");
    expect(await deps.claims.list()).toEqual([]);
  });
});

describe("ads.extractClaims — caller defects (typed, before the job exists)", () => {
  it("a blank record id is rejected before the job exists", async () => {
    const deps = makeDeps();
    await expect(new ExtractAdsClaims(deps).execute({ recordIds: ["  "] })).rejects.toMatchObject({
      code: ErrorCode.AdsClaimInvalid,
    });
  });

  it("duplicate record ids in the batch are rejected before the job exists", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await expect(
      new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1", "ad-1"] }),
    ).rejects.toMatchObject({ code: ErrorCode.AdsClaimInvalid });
  });
});

describe("ads.extractClaims — infrastructure failures (job FAILED, cause rethrown typed)", () => {
  it("a claim-store throw mid-run stamps the job failed and rethrows through AdsExtractClaimsJobError", async () => {
    const claims = new (class extends InMemoryClaimStore {
      override async put(): Promise<void> {
        throw new Error("sqlite exploded");
      }
    })();
    const deps = makeDeps({ claims });
    await seedRecord(deps, record("ad-1"));
    let caught: unknown;
    try {
      await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdsExtractClaimsJobError);
    const jobError = caught as AdsExtractClaimsJobError;
    expect(jobError.code).toBe(ErrorCode.AdsClaimInvalid);
    expect(jobError.reason).toContain("sqlite exploded");
    expect(jobError.job.state).toBe("failed");
    expect(jobError.job.lastError).toContain("ads claim extraction");
  });

  it("an EXTRACTOR throw (the engine itself failing) stamps the job failed and rethrows typed", async () => {
    const fixture = new FixtureReplayAdsClaimExtractor({ failOnRecordIds: ["ad-1"] });
    const deps = makeDeps({ extractor: fixture });
    await seedRecord(deps, record("ad-1"));
    let caught: unknown;
    try {
      await new ExtractAdsClaims(deps).execute({ recordIds: ["ad-1"] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdsExtractClaimsJobError);
    const jobError = caught as AdsExtractClaimsJobError;
    expect(jobError.reason).toContain("injected");
    expect(jobError.job.state).toBe("failed");
    expect(await deps.claims.list()).toEqual([]);
  });
});
