/**
 * ads.qualify — the §2.6 explainable-qualification use case tests
 * (P5-QUALIFY scope row 1): the job semantics (kind/provenance/payload,
 * boundary + per-record cooperative cancellation), the deterministic v1
 * policy made literal (the standing rule — a contradiction anywhere is a
 * standing problem, honesty first; nothing verified is not-qualified with
 * the unchecked reason naming its evidence; the CURRENT-verification rule
 * — the newest read-out per claim wins; per-source signal counts, never
 * merged; dangling refs surfaced with evidence-link pointers), the honest
 * typed outcomes (explained / no-data — a claimless record is NEVER a
 * zero-dressed-as-signal explanation, the 0.10.0 shape's min(1) made
 * structural / rejected ads/record-absent with the recovery hint), every
 * minted explanation schema-validated, the sources NEVER MUTATED
 * (deep-equal over all five stores), caller defects validated before the
 * job exists, infrastructure failures stamping the job FAILED and
 * rethrowing typed (cause code intact), and the sha256-pinned determinism
 * corpus (same resolved data => byte-identical report). No fixture policy
 * double is needed anywhere: the REAL policy + the REAL in-memory store
 * doubles cover every case including cancellation (an aborting store
 * subclass — recorded as the honest no-double statement).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCode, QualificationExplanationSchema, WebFlixError } from "webflix-contracts";
import type {
  AdRecord,
  Claim,
  EvidenceLink,
  OfferVerification,
  ReviewSignal,
} from "webflix-contracts";
import {
  ADS_QUALIFY_JOB_KIND,
  ADS_QUALIFY_NO_DATA_STATEMENT,
  ADS_QUALIFY_SEAM_ID,
  AdsQualifyJobError,
  InMemoryAdRecordStore,
  InMemoryClaimStore,
  QualifyAdsRecords,
  createInMemoryAdsStores,
  type AdsQualificationExplained,
  type AdsQualificationReport,
  type QualifyAdsRecordsDeps,
} from "../index";

const NOW = new Date("2026-10-12T05:00:00Z");
const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months! Limited time offer.";

/** A disciplined claim fixture cut by indexOf, never hand-counted. */
function spanClaim(id: string, adRecordId: string, text: string, quote: string): Claim {
  const start = text.indexOf(quote);
  return { id, adRecordId, quote, startOffset: start, endOffset: start + quote.length };
}

const provenance = {
  source: "user-import",
  importedAt: NOW.toISOString(),
  importBatchId: "batch-001",
};

const record = (id: string): AdRecord => ({
  id,
  advertiserIdentityId: "advertiser-1",
  creativeText: CREATIVE_TEXT,
  provenance,
});

/** A valid verification fixture: checked states carry their full evidence + instant. */
const verification = (
  id: string,
  claimId: string,
  outcome: OfferVerification["outcome"],
): OfferVerification => ({
  id,
  claimId,
  outcome,
  ...(outcome === "unchecked"
    ? {}
    : {
        declaredSources: [{ source: `check:${id}`, asReported: "the finding, as reported" }],
        checkedAt: NOW.toISOString(),
      }),
});

const reviewEdge = (
  id: string,
  claimId: string,
  reviewSignalId: string,
  relationship: EvidenceLink["relationship"] = "supports",
): EvidenceLink => ({
  kind: "independent-review",
  id,
  claimId,
  relationship,
  reviewSignalId,
  provenance,
});

const signal = (id: string, source: string, extra: Partial<ReviewSignal> = {}): ReviewSignal => ({
  id,
  source,
  asReportedRating: "4.2/5",
  provenance,
  ...extra,
});

function makeDeps(overrides: Partial<QualifyAdsRecordsDeps> = {}): QualifyAdsRecordsDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    records: stores.records,
    claims: stores.claims,
    edges: stores.evidenceEdges,
    reviewSignals: stores.reviewSignals,
    verifications: stores.offerVerifications,
    clock: { now: () => NOW },
    generateId: () => `qualify-job-${(seq += 1)}`,
    ...overrides,
  };
}

async function seedRecord(deps: QualifyAdsRecordsDeps, one: AdRecord): Promise<AdRecord> {
  await deps.records.put(one);
  return one;
}

async function seedClaim(deps: QualifyAdsRecordsDeps, one: Claim): Promise<Claim> {
  await deps.claims.put(one);
  return one;
}

function explainedOf(report: AdsQualificationReport): AdsQualificationExplained[] {
  return report.outcomes.filter(
    (outcome): outcome is AdsQualificationExplained => outcome.outcome === "explained",
  );
}

describe("ads.qualify — the §2.6 job + the v1 standing rule (happy path)", () => {
  it("explains a qualified record: job succeeded with kind/provenance/payload, policyVersion v1, reasons carry the verification pointers, facts carry the populations", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await seedClaim(deps, spanClaim("c-3", "ad-1", CREATIVE_TEXT, "Watch Acme"));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.verifications.append(verification("v-2", "c-2", "not-verifiable"));
    // c-3 has NO verification record (the never-verified case).

    const { job, report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe(ADS_QUALIFY_JOB_KIND);
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe(ADS_QUALIFY_SEAM_ID);
    expect(job.payload).toMatchObject({ policyVersion: "v1", requestedAdRecordIdsCount: 1 });
    expect(report!.counts).toEqual({ explained: 1, noData: 0, rejected: 0, total: 1 });

    const explained = explainedOf(report!)[0]!;
    expect(explanationOf(explained).policyVersion).toBe("v1");
    expect(explained.explanation.qualified).toBe(true);
    expect(explained.facts.claimsTotal).toBe(3);
    expect(explained.facts.currentByOutcome).toEqual({
      verified: 1,
      notVerifiable: 1,
      contradicted: 0,
      unchecked: 1,
    });
    // The verified + not-verifiable reasons name their verification ids; the
    // unchecked reason names the NEVER-verified claim by its claim id.
    const reasonTexts = explained.explanation.reasons.map((reason) => reason.text);
    expect(reasonTexts).toContain("1 of 3 claims are currently verified against a declared source");
    expect(reasonTexts).toContain(
      "1 of 3 claims could not be verified against any declared source (the checks name what was tried)",
    );
    expect(reasonTexts).toContain("1 of 3 claims have no completed verification check");
    const uncheckedReason = explained.explanation.reasons.find((reason) =>
      reason.text.includes("no completed verification check"),
    )!;
    expect(uncheckedReason.evidence).toEqual([{ kind: "claim", claimId: "c-3" }]);
    const verifiedReason = explained.explanation.reasons.find((reason) =>
      reason.text.includes("currently verified"),
    )!;
    expect(verifiedReason.evidence).toEqual([
      { kind: "offer-verification", verificationId: "v-1" },
    ]);
  });

  it("NOT-qualified via contradiction, honesty first: the contradicted reason mints FIRST and outweighs verified claims", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.verifications.append(verification("v-2", "c-2", "contradicted"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(false);
    // The fixed mint order: contradicted BEFORE verified.
    expect(explained.explanation.reasons[0]!.text).toBe(
      "1 of 2 claims are currently contradicted by declared evidence",
    );
    expect(explained.explanation.reasons[0]!.evidence).toEqual([
      { kind: "offer-verification", verificationId: "v-2" },
    ]);
  });

  it("NOT-qualified via nothing-verified: all-never-verified claims => the unchecked reason with claim pointers (never a zero-dressed signal)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(false);
    expect(explained.explanation.reasons).toHaveLength(1);
    expect(explained.explanation.reasons[0]!.text).toBe(
      "2 of 2 claims have no completed verification check",
    );
    expect(explained.explanation.reasons[0]!.evidence).toEqual([
      { kind: "claim", claimId: "c-1" },
      { kind: "claim", claimId: "c-2" },
    ]);
  });

  it("a stored BARE unchecked record (ads.verify's evidenceless read-out) counts unchecked with its VERIFICATION pointer, distinct from never-verified", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.verifications.append(verification("v-bare", "c-2", "unchecked"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(true);
    const uncheckedReason = explained.explanation.reasons.find((reason) =>
      reason.text.includes("no completed verification check"),
    )!;
    expect(uncheckedReason.evidence).toEqual([
      { kind: "offer-verification", verificationId: "v-bare" },
    ]);
  });
});

describe("ads.qualify — the CURRENT-verification rule (re-verification supersedes)", () => {
  it("the NEWEST read-out per claim wins: verified-then-contradicted => contradicted NOW", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(
      verification("v-old", "c-1", "verified-against-declared-source"),
    );
    await deps.verifications.append(verification("v-new", "c-1", "contradicted"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(false);
    expect(explained.facts.currentByOutcome).toEqual({
      verified: 0,
      notVerifiable: 0,
      contradicted: 1,
      unchecked: 0,
    });
    // The current record's pointer, never the superseded one.
    expect(explained.explanation.reasons[0]!.evidence).toEqual([
      { kind: "offer-verification", verificationId: "v-new" },
    ]);
  });

  it("the reverse history — contradicted-then-verified => verified NOW, no contradicted reason (history is not current)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(verification("v-old", "c-1", "contradicted"));
    await deps.verifications.append(
      verification("v-new", "c-1", "verified-against-declared-source"),
    );

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(true);
    expect(
      explained.explanation.reasons.some((reason) => reason.text.includes("contradicted")),
    ).toBe(false);
    expect(explained.facts.currentByOutcome.contradicted).toBe(0);
  });
});

describe("ads.qualify — review signals: as-reported per-source counts, never merged", () => {
  it("two sources mint TWO per-source reasons, each naming its own signal ids; facts carry one entry per source", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.reviewSignals.append(signal("s-1", "trustpilot.example"));
    await deps.reviewSignals.append(signal("s-2", "which.example"));
    await deps.edges.append(reviewEdge("e-1", "c-1", "s-1"));
    await deps.edges.append(reviewEdge("e-2", "c-2", "s-2"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    const signalReasons = explained.explanation.reasons.filter((reason) =>
      reason.text.startsWith("review source "),
    );
    expect(signalReasons).toHaveLength(2);
    expect(signalReasons[0]!.text).toBe(
      "review source trustpilot.example reports 1 stored signal(s) attached to this ad's claims, as reported — never merged",
    );
    expect(signalReasons[0]!.evidence).toEqual([{ kind: "review-signal", reviewSignalId: "s-1" }]);
    expect(signalReasons[1]!.text).toContain("which.example reports 1");
    expect(signalReasons[1]!.evidence).toEqual([{ kind: "review-signal", reviewSignalId: "s-2" }]);
    expect(explained.facts.signalsBySource).toEqual([
      { source: "trustpilot.example", count: 1 },
      { source: "which.example", count: 1 },
    ]);
  });

  it("one signal attached to TWO claims of the same record counts ONCE (dedup by signal id)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.reviewSignals.append(signal("s-1", "trustpilot.example"));
    await deps.edges.append(reviewEdge("e-1", "c-1", "s-1"));
    await deps.edges.append(reviewEdge("e-2", "c-2", "s-1"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.facts.signalsBySource).toEqual([{ source: "trustpilot.example", count: 1 }]);
    const signalReason = explained.explanation.reasons.find((reason) =>
      reason.text.startsWith("review source "),
    )!;
    expect(signalReason.evidence).toHaveLength(1);
  });

  it("signals NEVER flip the standing in v1 (documented): a contradicted record stays not-qualified with its signals carried", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(verification("v-1", "c-1", "contradicted"));
    await deps.reviewSignals.append(signal("s-1", "trustpilot.example"));
    await deps.edges.append(reviewEdge("e-1", "c-1", "s-1"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.explanation.qualified).toBe(false);
    expect(explained.facts.signalsBySource).toEqual([{ source: "trustpilot.example", count: 1 }]);
  });
});

describe("ads.qualify — dangling references surface as data", () => {
  it("an independent-review edge whose signal is gone => the dangling reason with an evidence-link pointer, never counted", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.edges.append(reviewEdge("e-dangling", "c-1", "s-gone"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const explained = explainedOf(report!)[0]!;
    expect(explained.facts.signalsBySource).toEqual([]);
    expect(explained.facts.danglingSignalRefs).toBe(1);
    const danglingReason = explained.explanation.reasons.find((reason) =>
      reason.text.includes("no longer stored"),
    )!;
    expect(danglingReason.text).toBe(
      "1 independent-review edge(s) reference signals that are no longer stored (surfaced, never counted)",
    );
    expect(danglingReason.evidence).toEqual([
      { kind: "evidence-link", evidenceLinkId: "e-dangling" },
    ]);
  });
});

describe("ads.qualify — the honest typed outcomes", () => {
  it("a claimless record => the typed no-data outcome with its statement — NEVER a zero-dressed explanation", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-empty"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-empty"] });
    expect(report!.counts).toEqual({ explained: 0, noData: 1, rejected: 0, total: 1 });
    const noData = report!.outcomes[0]!;
    expect(noData.outcome).toBe("no-data");
    if (noData.outcome === "no-data") {
      expect(noData.adRecordId).toBe("ad-empty");
      expect(noData.statement).toBe(ADS_QUALIFY_NO_DATA_STATEMENT);
      expect(noData.statement).toContain("no stored claims");
    }
  });

  it("an unknown record id => the ads/record-absent rejection with the ads.import recovery hint", async () => {
    const deps = makeDeps();

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-ghost"] });
    expect(report!.counts).toEqual({ explained: 0, noData: 0, rejected: 1, total: 1 });
    const rejected = report!.outcomes[0]!;
    expect(rejected.outcome).toBe("rejected");
    if (rejected.outcome === "rejected") {
      expect(rejected.code).toBe(ErrorCode.AdsRecordAbsent);
      expect(rejected.reason).toContain("run ads.import over the record first");
    }
  });

  it("a mixed batch: explained + no-data + rejected in ONE run, counts add up, index order preserved", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-good"));
    await seedClaim(
      deps,
      spanClaim("c-1", "ad-good", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await seedRecord(deps, record("ad-empty"));

    const { report } = await new QualifyAdsRecords(deps).execute({
      adRecordIds: ["ad-good", "ad-empty", "ad-ghost"],
    });
    expect(report!.counts).toEqual({ explained: 1, noData: 1, rejected: 1, total: 3 });
    expect(report!.outcomes.map((outcome) => outcome.index)).toEqual([0, 1, 2]);
    expect(report!.outcomes.map((outcome) => outcome.outcome)).toEqual([
      "explained",
      "no-data",
      "rejected",
    ]);
  });

  it("an EMPTY batch is the honest empty report (not a caller defect)", async () => {
    const deps = makeDeps();
    const { job, report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: [] });
    expect(job.state).toBe("succeeded");
    expect(report!.outcomes).toEqual([]);
    expect(report!.counts).toEqual({ explained: 0, noData: 0, rejected: 0, total: 0 });
  });

  it("every minted explanation is schema-valid: reasons min 1, evidence min 1 each (the shape's own discipline)", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.reviewSignals.append(signal("s-1", "trustpilot.example"));
    await deps.edges.append(reviewEdge("e-1", "c-1", "s-1"));

    const { report } = await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    for (const explained of explainedOf(report!)) {
      const parsed = QualificationExplanationSchema.safeParse(explained.explanation);
      expect(parsed.success).toBe(true);
      expect(explained.explanation.reasons.length).toBeGreaterThanOrEqual(1);
      for (const reason of explained.explanation.reasons) {
        expect(reason.evidence.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("ads.qualify — cancellation, both phases (§2.6)", () => {
  it("BOUNDARY cancellation: an already-aborted signal cancels the job, nothing read", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new QualifyAdsRecords(deps).execute({
      adRecordIds: ["ad-1"],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each record stops the batch; report null (a read job stores nothing)", async () => {
    const controller = new AbortController();
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedRecord(deps, record("ad-2"));
    // NO fixture policy double needed: the REAL policy + REAL in-memory
    // stores + an aborting store subclass cover mid-run cancellation.
    const claims = new (class extends InMemoryClaimStore {
      override async listByAdRecordId(adRecordId: string) {
        const stored = await super.listByAdRecordId(adRecordId);
        controller.abort();
        return stored;
      }
    })();
    const deps2 = { ...deps, claims };
    const { job, report } = await new QualifyAdsRecords(deps2).execute({
      adRecordIds: ["ad-1", "ad-2"],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
  });
});

describe("ads.qualify — the sources NEVER mutate (a pure read job)", () => {
  it("records, claims, edges, signals, and verifications are deep-equal before and after a run", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedClaim(deps, spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await deps.verifications.append(verification("v-1", "c-1", "verified-against-declared-source"));
    await deps.reviewSignals.append(signal("s-1", "trustpilot.example"));
    await deps.edges.append(reviewEdge("e-1", "c-1", "s-1"));
    const before = await Promise.all([
      deps.records.list(),
      deps.claims.list(),
      deps.edges.list(),
      deps.reviewSignals.list(),
      deps.verifications.list(),
    ]);
    await new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1"] });
    const after = await Promise.all([
      deps.records.list(),
      deps.claims.list(),
      deps.edges.list(),
      deps.reviewSignals.list(),
      deps.verifications.list(),
    ]);
    expect(after).toEqual(before);
  });
});

describe("ads.qualify — caller defects, BEFORE the job exists (typed ads/record-invalid)", () => {
  it("a blank record id is a caller defect, never a job failure", async () => {
    const deps = makeDeps();
    await expect(
      new QualifyAdsRecords(deps).execute({ adRecordIds: ["  "] }),
    ).rejects.toMatchObject({
      code: ErrorCode.AdsRecordInvalid,
    });
  });

  it("a record id named twice is a caller defect (double-counting refused)", async () => {
    const deps = makeDeps();
    await expect(
      new QualifyAdsRecords(deps).execute({ adRecordIds: ["ad-1", "ad-1"] }),
    ).rejects.toMatchObject({ code: ErrorCode.AdsRecordInvalid });
  });

  it("a non-array adRecordIds is a caller defect", async () => {
    const deps = makeDeps();
    await expect(
      new QualifyAdsRecords(deps).execute({
        adRecordIds: undefined as unknown as readonly string[],
      }),
    ).rejects.toMatchObject({ code: ErrorCode.AdsRecordInvalid });
  });
});

describe("ads.qualify — infrastructure failures stamp FAILED + rethrow typed", () => {
  it("a store throwing a typed error mid-run => AdsQualifyJobError with the cause's code INTACT + the job FAILED", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    await seedRecord(deps, record("ad-2"));
    const records = new (class extends InMemoryAdRecordStore {
      override async get(id: string) {
        if (id === "ad-2") {
          throw new WebFlixError({
            code: ErrorCode.AdsVerificationInvalid,
            reason: "the verification store blew up",
            retryable: false,
            context: {},
          });
        }
        return super.get(id);
      }
    })();
    const deps2 = { ...deps, records };
    const err = await new QualifyAdsRecords(deps2)
      .execute({ adRecordIds: ["ad-1", "ad-2"] })
      .catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(AdsQualifyJobError);
    expect((err as AdsQualifyJobError).code).toBe(ErrorCode.AdsVerificationInvalid);
    expect((err as AdsQualifyJobError).job.state).toBe("failed");
    expect((err as AdsQualifyJobError).job.lastError).toContain("the verification store blew up");
  });

  it("a plain Error mid-run => wrapped typed (unrecognized failure) + the job FAILED", async () => {
    const deps = makeDeps();
    await seedRecord(deps, record("ad-1"));
    const records = new (class extends InMemoryAdRecordStore {
      override async get(id: string) {
        if (id === "ad-1") throw new Error("disk on fire");
        return super.get(id);
      }
    })();
    const deps2 = { ...deps, records };
    const err = await new QualifyAdsRecords(deps2)
      .execute({ adRecordIds: ["ad-1"] })
      .catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(AdsQualifyJobError);
    expect((err as AdsQualifyJobError).code).toBe(ErrorCode.AdsRecordInvalid);
    expect((err as AdsQualifyJobError).reason).toContain("unrecognized failure");
    expect((err as AdsQualifyJobError).job.state).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// The determinism corpus (sha256-pinned)
// ---------------------------------------------------------------------------

/**
 * Builds the corpus's fixed world: three records covering the honest
 * outcome spectrum —
 * - corpus-ad-1: 3 claims (verified + not-verifiable + never-verified) +
 *   one signal attached to TWO claims (dedup) + a dangling edge ref =>
 *   qualified;
 * - corpus-ad-2: 2 claims (a re-verified claim — older verified, NEWER
 *   contradicted — + a bare unchecked claim) + two signals from ONE
 *   source => not-qualified;
 * - corpus-ad-3: a stored record with no claims => the no-data outcome.
 */
async function buildCorpus(deps: QualifyAdsRecordsDeps): Promise<void> {
  await seedRecord(deps, record("corpus-ad-1"));
  await seedRecord(deps, record("corpus-ad-2"));
  await seedRecord(deps, record("corpus-ad-3"));
  await seedClaim(
    deps,
    spanClaim("cc-1", "corpus-ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
  );
  await seedClaim(deps, spanClaim("cc-2", "corpus-ad-1", CREATIVE_TEXT, "Limited time offer."));
  await seedClaim(deps, spanClaim("cc-3", "corpus-ad-1", CREATIVE_TEXT, "Watch Acme"));
  await seedClaim(
    deps,
    spanClaim("cc-4", "corpus-ad-2", CREATIVE_TEXT, "50% off your first 3 months"),
  );
  await seedClaim(deps, spanClaim("cc-5", "corpus-ad-2", CREATIVE_TEXT, "Limited time offer."));
  await deps.verifications.append(verification("cv-1", "cc-1", "verified-against-declared-source"));
  await deps.verifications.append(verification("cv-2", "cc-2", "not-verifiable"));
  // cc-3 never verified.
  await deps.verifications.append(
    verification("cv-3-old", "cc-4", "verified-against-declared-source"),
  );
  await deps.verifications.append(verification("cv-4-new", "cc-4", "contradicted"));
  await deps.verifications.append(verification("cv-5-bare", "cc-5", "unchecked"));
  await deps.reviewSignals.append(signal("cs-1", "trustpilot.example"));
  await deps.reviewSignals.append(signal("cs-2", "which.example"));
  await deps.reviewSignals.append(signal("cs-3", "trustpilot.example"));
  await deps.edges.append(reviewEdge("ce-1", "cc-1", "cs-1"));
  await deps.edges.append(reviewEdge("ce-2", "cc-2", "cs-1")); // same signal, second claim => dedup
  await deps.edges.append(reviewEdge("ce-3", "cc-3", "cs-2"));
  await deps.edges.append(reviewEdge("ce-4", "cc-4", "cs-3"));
  await deps.edges.append(reviewEdge("ce-5-dangling", "cc-5", "cs-gone")); // never appended
}

describe("determinism corpus (same resolved data => byte-identical report, sha256-pinned)", () => {
  const pin = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

  it("the whole corpus report is byte-identical across runs and matches the pinned sha256", async () => {
    const runOnce = async (): Promise<AdsQualificationReport> => {
      const deps = makeDeps();
      await buildCorpus(deps);
      const { report } = await new QualifyAdsRecords(deps).execute({
        adRecordIds: ["corpus-ad-1", "corpus-ad-2", "corpus-ad-3"],
      });
      return report!;
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("6d0a5e600b3e1383ea5214fa1048aa0b30eaa71475ca8cfba6bf9dc8dc0bbc24");
    // The corpus covers the honest outcome spectrum.
    expect(first.counts).toEqual({ explained: 2, noData: 1, rejected: 0, total: 3 });
    expect(explainedOf(first).map((explained) => explanationOf(explained).qualified)).toEqual([
      true,
      false,
    ]);
  });

  it("each corpus record pins its own digest", async () => {
    const deps = makeDeps();
    await buildCorpus(deps);
    const { report } = await new QualifyAdsRecords(deps).execute({
      adRecordIds: ["corpus-ad-1", "corpus-ad-2", "corpus-ad-3"],
    });
    const expected: readonly [string, string][] = [
      ["corpus-ad-1", "50978d408f6022e0a86d4254c36c25ec4883cd98b668fd27ce1e682fa4ebc2e0"],
      ["corpus-ad-2", "f66051b98a17822e8243bd2471a7db0c6ccadd797d753b1966fcaabb0d9a3d8a"],
      ["corpus-ad-3", "1e217676d9719083efa5e6ade08f438481e98b24aedc2065d63a2c64b1988e36"],
    ];
    for (const [adRecordId, expectedPin] of expected) {
      const outcome = report!.outcomes.find((item) => item.adRecordId === adRecordId)!;
      expect(pin(outcome)).toBe(expectedPin);
    }
  });

  it("INPUT SENSITIVITY: appending one newer verification changes the digest (no stale pin survives)", async () => {
    const deps = makeDeps();
    await buildCorpus(deps);
    // Re-verify cc-2 (not-verifiable => verified): a NEW read-out changes
    // corpus-ad-1's standing inputs, so the report digest MUST move.
    await deps.verifications.append(
      verification("cv-2-new", "cc-2", "verified-against-declared-source"),
    );
    const { report } = await new QualifyAdsRecords(deps).execute({
      adRecordIds: ["corpus-ad-1", "corpus-ad-2", "corpus-ad-3"],
    });
    expect(pin(report)).not.toBe(
      "6d0a5e600b3e1383ea5214fa1048aa0b30eaa71475ca8cfba6bf9dc8dc0bbc24",
    );
    expect(explainedOf(report!)[0]!.facts.currentByOutcome.verified).toBe(2);
  });
});

/** Narrows an explained outcome to its explanation (the union-safe read). */
function explanationOf(explained: AdsQualificationExplained) {
  return explained.explanation;
}
