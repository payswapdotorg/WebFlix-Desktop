/**
 * ads.reviewSignals — the §2.6 AS-REPORTED reading use case tests
 * (P5-VERIFY scope row 3): the job semantics (kind/provenance/payload,
 * boundary + per-claim cooperative cancellation), the AS-REPORTED
 * discipline (every row is the stored signal VERBATIM — deep-equal to the
 * store's shape, vocabulary + provenance intact), NO AGGREGATION made
 * literal (two sources' ratings are TWO rows, never merged; one signal
 * attached twice is ONE row with both attachments; the report carries no
 * statistic over the signals' contents), the honest-empty paths (no
 * signals => the empty report; unknown record/advertiser ids resolve to
 * no claims), the advertiser + ad selectors' graph resolution, dangling
 * edge references surfaced as data (never failures), the stored
 * claims/edges/signals NEVER MUTATED (deep-equal), caller defects
 * validated before the job exists, and infrastructure failures stamping
 * the job FAILED and rethrowing typed.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode } from "webflix-contracts";
import type { AdRecord, Claim, EvidenceLink, ReviewSignal } from "webflix-contracts";
import {
  AdsReviewSignalsJobError,
  InMemoryClaimStore,
  InMemoryReviewSignalStore,
  ReadAdsReviewSignals,
  createInMemoryAdsStores,
  type ReadAdsReviewSignalsDeps,
} from "../index";

const NOW = new Date("2026-10-12T04:30:00Z");
const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months! Limited time offer.";
const provenance = {
  source: "user-import",
  observedAt: new Date("2026-10-10T00:00:00Z").toISOString(),
  importedAt: NOW.toISOString(),
  importBatchId: "batch-001",
};

const record = (id: string, advertiserIdentityId = "adv-1"): AdRecord => ({
  id,
  sourceAdId: `src-${id}`,
  advertiserIdentityId,
  creativeText: CREATIVE_TEXT,
  provenance,
});

/** A disciplined claim fixture cut by indexOf, never hand-counted. */
function spanClaim(id: string, adRecordId: string, quote: string): Claim {
  const start = CREATIVE_TEXT.indexOf(quote);
  return { id, adRecordId, quote, startOffset: start, endOffset: start + quote.length };
}

const reviewEdge = (
  id: string,
  claimId: string,
  reviewSignalId: string,
  relationship: EvidenceLink["relationship"] = "contradicts",
): EvidenceLink => ({
  kind: "independent-review",
  id,
  claimId,
  relationship,
  reviewSignalId,
  provenance,
});

const offerTermsEdge = (id: string, claimId: string): EvidenceLink => ({
  kind: "offer-terms",
  id,
  claimId,
  relationship: "supports",
  url: "https://acme.example/offer-terms",
  declaredTermsExcerpt: "50% off your first 3 months",
  provenance,
});

const signal = (id: string, source: string, extra: Partial<ReviewSignal> = {}): ReviewSignal => ({
  id,
  source,
  asReportedRating: "4.2/5",
  asReportedClassification: "excellent",
  region: "US",
  scope: "streaming services",
  provenance,
  ...extra,
});

function makeDeps(overrides: Partial<ReadAdsReviewSignalsDeps> = {}): ReadAdsReviewSignalsDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    records: stores.records,
    claims: stores.claims,
    edges: stores.evidenceEdges,
    reviewSignals: stores.reviewSignals,
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

async function seedRecordWithClaim(
  deps: ReadAdsReviewSignalsDeps,
  recordId: string,
  claimId: string,
  advertiserIdentityId = "adv-1",
): Promise<Claim> {
  await deps.records.put(record(recordId, advertiserIdentityId));
  const claim = spanClaim(claimId, recordId, "50% off your first 3 months");
  await deps.claims.put(claim);
  return claim;
}

describe("ads.reviewSignals — the §2.6 read job (as-reported, no aggregation)", () => {
  it("lists the signals attached to a record's claims AS-REPORTED: verbatim shape + provenance, attachments carried", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    const rev = signal("rev-1", "streaming-reviews.example");
    await deps.reviewSignals.append(rev);
    await deps.edges.append(reviewEdge("ev-1", claim.id, "rev-1", "contradicts"));
    const { job, report } = await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe("ads.review-signals");
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe("webflix.ads-review-signals");
    expect(job.payload["selectorKind"]).toBe("ad-record-id");
    expect(job.payload["selectorId"]).toBe("ad-1");
    expect(report).not.toBeNull();
    expect(report!.counts).toEqual({ signals: 1, unresolved: 0 });
    expect(report!.rows).toHaveLength(1);
    // AS-REPORTED: the row's signal is the STORED shape, byte-equal.
    expect(report!.rows[0]!.signal).toEqual(rev);
    expect(report!.rows[0]!.signal.provenance.source).toBe("user-import");
    expect(report!.rows[0]!.signal.provenance.observedAt).toBe(provenance.observedAt);
    expect(report!.rows[0]!.attachments).toEqual([
      { claimId: "claim-1", edgeId: "ev-1", relationship: "contradicts" },
    ]);
  });

  it("NO AGGREGATION: two sources' ratings are TWO rows, never merged into one number", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    const revA = signal("rev-a", "ratings.example", { asReportedRating: "4.2/5" });
    const revB = signal("rev-b", "watchdog.example", {
      asReportedRating: "4.2/5",
      asReportedClassification: "poor",
    });
    await deps.reviewSignals.append(revA);
    await deps.reviewSignals.append(revB);
    await deps.edges.append(reviewEdge("ev-a", claim.id, "rev-a", "supports"));
    await deps.edges.append(reviewEdge("ev-b", claim.id, "rev-b", "contradicts"));
    const { report } = await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(report!.counts.signals).toBe(2);
    expect(report!.rows.map((row) => row.signal.id)).toEqual(["rev-a", "rev-b"]);
    // Same rating string, two different sources: TWO rows, both verbatim.
    expect(report!.rows[0]!.signal.asReportedRating).toBe("4.2/5");
    expect(report!.rows[1]!.signal.asReportedRating).toBe("4.2/5");
    expect(report!.rows[0]!.signal.source).not.toBe(report!.rows[1]!.signal.source);
  });

  it("one signal attached to TWO claims of the same ad is ONE row with both attachments", async () => {
    const deps = makeDeps();
    const claimA = await seedRecordWithClaim(deps, "ad-1", "claim-a");
    const claimB = spanClaim("claim-b", "ad-1", "Limited time offer.");
    await deps.claims.put(claimB);
    const rev = signal("rev-shared", "shared.example");
    await deps.reviewSignals.append(rev);
    await deps.edges.append(reviewEdge("ev-x", claimA.id, "rev-shared", "supports"));
    await deps.edges.append(reviewEdge("ev-y", claimB.id, "rev-shared", "supports"));
    const { report } = await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(report!.counts.signals).toBe(1);
    expect(report!.rows[0]!.signal.id).toBe("rev-shared");
    expect(report!.rows[0]!.attachments).toHaveLength(2);
    expect(report!.rows[0]!.attachments.map((a) => a.edgeId)).toEqual(["ev-x", "ev-y"]);
  });

  it("the ADVERTISER selector resolves every record of that advertiser; other advertisers' signals never leak", async () => {
    const deps = makeDeps();
    await seedRecordWithClaim(deps, "ad-adv-a1", "claim-a1", "adv-A");
    await seedRecordWithClaim(deps, "ad-adv-a2", "claim-a2", "adv-A");
    await seedRecordWithClaim(deps, "ad-adv-b1", "claim-b1", "adv-B");
    const revA = signal("rev-for-a", "ratings.example");
    await deps.reviewSignals.append(revA);
    await deps.edges.append(reviewEdge("ev-a1", "claim-a1", "rev-for-a", "supports"));
    await deps.edges.append(reviewEdge("ev-a2", "claim-a2", "rev-for-a", "contextualizes"));
    const revB = signal("rev-for-b", "other.example");
    await deps.reviewSignals.append(revB);
    await deps.edges.append(reviewEdge("ev-b1", "claim-b1", "rev-for-b", "contradicts"));
    const { job, report } = await new ReadAdsReviewSignals(deps).execute({
      advertiserIdentityId: "adv-A",
    });
    expect(job.state).toBe("succeeded");
    expect(job.payload["selectorKind"]).toBe("advertiser-identity-id");
    expect(report!.counts.signals).toBe(1);
    expect(report!.rows[0]!.signal.id).toBe("rev-for-a");
    expect(report!.rows[0]!.attachments).toHaveLength(2);
    expect(report!.unresolved).toEqual([]);
  });

  it("NON-review evidence edges contribute NOTHING (only independent-review edges resolve signals)", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    await deps.edges.append(offerTermsEdge("ev-terms", claim.id));
    const { report } = await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(report!.counts).toEqual({ signals: 0, unresolved: 0 });
    expect(report!.rows).toEqual([]);
  });

  it("honest-empty paths: no attached signals, an unknown record id, and an unknown advertiser id all yield the EMPTY report", async () => {
    for (const input of [
      { adRecordId: "ad-empty" },
      { adRecordId: "ad-never" },
      { advertiserIdentityId: "adv-never" },
    ] as const) {
      const deps = makeDeps();
      const claim = await seedRecordWithClaim(deps, "ad-empty", "claim-e");
      await deps.edges.append(offerTermsEdge("ev-e", claim.id));
      const { job, report } = await new ReadAdsReviewSignals(deps).execute(input);
      expect(job.state).toBe("succeeded");
      expect(report!.rows).toEqual([]);
      expect(report!.unresolved).toEqual([]);
      expect(report!.counts).toEqual({ signals: 0, unresolved: 0 });
    }
  });

  it("a DANGLING edge reference (signal never stored) surfaces as DATA in unresolved, never a failure", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    // Appended DIRECTLY through the store (bypassing ads.linkEvidence's
    // validation) — the torn-state case the report honestly surfaces.
    await deps.edges.append(reviewEdge("ev-dangling", claim.id, "rev-never-stored"));
    const { job, report } = await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(job.state).toBe("succeeded");
    expect(report!.rows).toEqual([]);
    expect(report!.unresolved).toEqual([
      { claimId: "claim-1", edgeId: "ev-dangling", reviewSignalId: "rev-never-stored" },
    ]);
    expect(report!.counts).toEqual({ signals: 0, unresolved: 1 });
  });
});

describe("ads.reviewSignals — cancellation, both phases (§2.6)", () => {
  it("BOUNDARY cancellation: an already-aborted signal cancels the job before anything is read", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    await deps.reviewSignals.append(signal("rev-1", "ratings.example"));
    await deps.edges.append(reviewEdge("ev-1", claim.id, "rev-1"));
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new ReadAdsReviewSignals(deps).execute({
      adRecordId: "ad-1",
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each claim stops the read; report null", async () => {
    const controller = new AbortController();
    const deps = makeDeps();
    // The claim store that aborts as soon as its first claim batch resolves
    // (so the cooperative checkpoint before the FIRST claim observes the
    // aborted signal) — the claim is seeded INTO this store.
    const claims = new (class extends InMemoryClaimStore {
      override async listByAdRecordId(adRecordId: string) {
        const listed = await super.listByAdRecordId(adRecordId);
        controller.abort();
        return listed;
      }
    })();
    const deps2: ReadAdsReviewSignalsDeps = { ...deps, claims };
    await deps2.records.put(record("ad-1"));
    await deps2.claims.put(spanClaim("claim-1", "ad-1", "50% off your first 3 months"));
    const { job, report } = await new ReadAdsReviewSignals(deps2).execute({
      adRecordId: "ad-1",
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
  });
});

describe("ads.reviewSignals — the stored sources NEVER mutate", () => {
  it("claims, edges, and signals are deep-equal before and after a read", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    const rev = signal("rev-1", "ratings.example");
    await deps.reviewSignals.append(rev);
    await deps.edges.append(reviewEdge("ev-1", claim.id, "rev-1"));
    const claimsBefore = await deps.claims.list();
    const edgesBefore = await deps.edges.list();
    const signalsBefore = await deps.reviewSignals.list();
    await new ReadAdsReviewSignals(deps).execute({ adRecordId: "ad-1" });
    expect(await deps.claims.list()).toEqual(claimsBefore);
    expect(await deps.edges.list()).toEqual(edgesBefore);
    expect(await deps.reviewSignals.list()).toEqual(signalsBefore);
  });
});

describe("ads.reviewSignals — caller defects validated BEFORE the job exists (typed ads/record-invalid)", () => {
  it("rejects BOTH selectors, NEITHER selector, and blank selector ids", async () => {
    const useCase = new ReadAdsReviewSignals(makeDeps());
    const cases: readonly unknown[] = [
      { advertiserIdentityId: "adv-1", adRecordId: "ad-1" },
      {},
      { adRecordId: "  " },
      { advertiserIdentityId: "" },
    ];
    for (const input of cases) {
      let caught: unknown;
      try {
        await useCase.execute(input as never);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: unknown }).code).toBe(ErrorCode.AdsRecordInvalid);
    }
  });
});

describe("ads.reviewSignals — infrastructure failures stamp the job FAILED and rethrow typed", () => {
  it("a signal-store throw mid-read: FAILED job + AdsReviewSignalsJobError with the cause intact", async () => {
    const deps = makeDeps();
    const claim = await seedRecordWithClaim(deps, "ad-1", "claim-1");
    await deps.edges.append(reviewEdge("ev-1", claim.id, "rev-1"));
    const reviewSignals = new (class extends InMemoryReviewSignalStore {
      override async get(): Promise<never> {
        throw new Error("sqlite exploded");
      }
    })();
    let caught: unknown;
    try {
      await new ReadAdsReviewSignals({ ...deps, reviewSignals }).execute({ adRecordId: "ad-1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdsReviewSignalsJobError);
    const jobError = caught as AdsReviewSignalsJobError;
    expect(jobError.code).toBe(ErrorCode.AdsRecordInvalid);
    expect(jobError.reason).toContain("sqlite exploded");
    expect(jobError.job.state).toBe("failed");
    expect(jobError.job.lastError).toContain("ads review signals read");
  });
});
