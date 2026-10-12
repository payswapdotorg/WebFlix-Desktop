/**
 * ads.verify — the §2.6 verification use case tests (P5-VERIFY scope row
 * 2): the job semantics (kind/provenance/payload, boundary + per-claim
 * cooperative cancellation), the typed-outcome derivation made literal
 * over resolved evidence (a claim with NO evidence => the honest bare
 * UNCHECKED record; a contradicting review signal => contradicted with
 * the signal id named; a matching offer-terms excerpt => verified; edges
 * that carry nothing comparable => not-verifiable with the sources named
 * — NEVER a fabricated verified: an empty checks list can never yield
 * verified, structurally + by test), the domain state-machine invariant
 * re-run over every minted record (unchecked bare, checked full), the
 * FIXED comparison rules unit-pinned (numeric token set-inclusion, text
 * substring, no separator normalization, reviews never verify), the
 * record-id selector's honest surface (mixed outcomes; unknown record =>
 * the honest empty report), the sources NEVER MUTATED (deep-equal),
 * caller defects validated before the job exists, infrastructure
 * failures stamping the job FAILED and rethrowing typed, idempotent
 * re-runs under a pinned clock+id generator, and the sha256-pinned
 * DETERMINISM CORPUS (same evidence => byte-identical verification set).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCode } from "webflix-contracts";
import type { Claim, EvidenceLink, OfferVerification, ReviewSignal } from "webflix-contracts";
import { validateOfferVerificationState } from "webflix-domain";
import {
  AdsVerifyOffersJobError,
  InMemoryOfferVerificationStore,
  VerifyAdsOffers,
  createInMemoryAdsStores,
  textComparisonVerifies,
  type AdsVerificationReport,
  type VerifyAdsOffersDeps,
} from "../index";

const NOW = new Date("2026-10-12T04:00:00Z");
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

const offerTermsEdge = (
  id: string,
  claimId: string,
  excerpt: string | undefined,
  relationship: EvidenceLink["relationship"] = "supports",
): EvidenceLink => ({
  kind: "offer-terms",
  id,
  claimId,
  relationship,
  url: "https://acme.example/offer-terms",
  ...(excerpt !== undefined ? { declaredTermsExcerpt: excerpt } : {}),
  provenance,
});

const factEdge = (
  id: string,
  claimId: string,
  asReportedText: string | undefined,
): EvidenceLink => ({
  kind: "source-reported-fact",
  id,
  claimId,
  relationship: "supports",
  url: "https://acme.example/facts",
  ...(asReportedText !== undefined ? { asReportedText } : {}),
  provenance,
});

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

const userDocEdge = (id: string, claimId: string): EvidenceLink => ({
  kind: "user-imported-document",
  id,
  claimId,
  relationship: "contextualizes",
  documentId: "doc-42",
  provenance,
});

const signal = (id: string, source: string, extra: Partial<ReviewSignal> = {}): ReviewSignal => ({
  id,
  source,
  asReportedRating: "3.1/5",
  asReportedClassification: "mixed",
  provenance,
  ...extra,
});

function makeDeps(overrides: Partial<VerifyAdsOffersDeps> = {}): VerifyAdsOffersDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    claims: stores.claims,
    edges: stores.evidenceEdges,
    reviewSignals: stores.reviewSignals,
    verifications: stores.offerVerifications,
    clock: { now: () => NOW },
    generateId: () => `verif-${(seq += 1)}`,
    ...overrides,
  };
}

async function seedClaim(deps: VerifyAdsOffersDeps, one: Claim): Promise<Claim> {
  await deps.claims.put(one);
  return one;
}

function checkedOf(report: AdsVerificationReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "checked");
}

function rejectedOf(report: AdsVerificationReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "rejected");
}

/** Every minted record must satisfy the domain state-machine invariant. */
function expectInvariantHolds(record: OfferVerification): void {
  expect(validateOfferVerificationState(record)).toEqual([]);
}

describe("the FIXED comparison rules (textComparisonVerifies, unit-pinned)", () => {
  it("NUMERIC rule: both sides carry tokens — set inclusion, byte-equal", () => {
    expect(textComparisonVerifies("Save $9.99 today", "terms: $9.99 per month")).toBe(true);
    expect(textComparisonVerifies("Save $9.99 today", "terms: $19.99 after trial")).toBe(false);
    expect(textComparisonVerifies("50% off 3 months", "50% off your first 3 months")).toBe(true);
    expect(textComparisonVerifies("50% off 3 months", "25% off your first 2 months")).toBe(false);
  });

  it("NO separator normalization: 9,99 and 9.99 are DIFFERENT tokens (documented limit)", () => {
    expect(textComparisonVerifies("only 9.99", "Preis: 9,99")).toBe(false);
  });

  it("TEXT rule: the trimmed claim quote as a byte-equal substring of the evidence", () => {
    expect(
      textComparisonVerifies(
        "Money back guarantee",
        "Full terms: Money back guarantee, no questions asked",
      ),
    ).toBe(true);
    expect(textComparisonVerifies("Money back guarantee", "Refunds within 30 days")).toBe(false);
  });

  it("a numberless claim against a numberless text falls to the TEXT rule only", () => {
    expect(textComparisonVerifies("Cancel anytime", "Cancel anytime you like")).toBe(true);
    expect(textComparisonVerifies("Cancel anytime", "no cancellation")).toBe(false);
  });
});

describe("ads.verify — the §2.6 job (happy path + honest report)", () => {
  it("verifies a claim against a MATCHING offer-terms excerpt: job succeeded, checks list names the node + kind + what was compared, the record carries the full evidence + instant", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(
      offerTermsEdge("ev-terms-1", claim.id, "Offer: 50% off your first 3 months. Cancel anytime."),
    );
    const { job, report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe("ads.verify");
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe("webflix.ads-verify");
    expect(job.provenance.connectorVersion).toBe("1.0.0");
    expect(job.payload["selectorKind"]).toBe("claim-ids");
    expect(report).not.toBeNull();
    expect(report!.counts).toEqual({
      checked: 1,
      rejected: 0,
      total: 1,
      verified: 1,
      notVerifiable: 0,
      contradicted: 0,
      unchecked: 0,
    });
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.disposition).toBe("appended");
    expect(outcome.verification.outcome).toBe("verified-against-declared-source");
    expect(outcome.verification.claimId).toBe(claim.id);
    expect(outcome.verification.checkedAt).toBe(NOW.toISOString());
    expect(outcome.verification.declaredSources).toHaveLength(1);
    const check = outcome.verification.declaredSources![0]!;
    expect(check.source).toContain('offer-terms evidence node "ev-terms-1"');
    expect(check.source).toContain(
      "numeric/text comparison of the claim quote against the declared terms excerpt",
    );
    expect(check.source).toContain("(verifies)");
    expect(check.url).toBe("https://acme.example/offer-terms");
    expect(check.asReported).toBe("Offer: 50% off your first 3 months. Cancel anytime.");
    expectInvariantHolds(outcome.verification);
    // Stored + retrievable through the verification store.
    expect(await deps.verifications.get(outcome.verification.id)).toEqual(outcome.verification);
  });

  it("a claim with NO linked evidence => the honest BARE unchecked record (empty checks can never yield verified)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-bare", "ad-1", CREATIVE_TEXT, "Limited time offer."),
    );
    const { job, report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({
      checked: 1,
      rejected: 0,
      total: 1,
      verified: 0,
      notVerifiable: 0,
      contradicted: 0,
      unchecked: 1,
    });
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("unchecked");
    expect(outcome.verification.checkedAt).toBeUndefined();
    expect(outcome.verification.declaredSources).toBeUndefined();
    expectInvariantHolds(outcome.verification);
    // The domain invariant rejects the fabricated-verified counterpart:
    // an unchecked record carrying evidence is a defect.
    expect(
      validateOfferVerificationState({
        ...outcome.verification,
        declaredSources: [{ source: "invented" }],
      }).map((violation) => violation.code),
    ).toEqual(["unchecked-carries-evidence"]);
  });

  it("a CONTRADICTING review signal => contradicted, the signal id named in the checks list", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-contr", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.reviewSignals.append(
      signal("rev-1", "streaming-reviews.example", { asReportedClassification: "misleading" }),
    );
    await deps.edges.append(reviewEdge("ev-rev-1", claim.id, "rev-1", "contradicts"));
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    expect(report!.counts.contradicted).toBe(1);
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("contradicted");
    expect(outcome.verification.declaredSources).toHaveLength(1);
    const check = outcome.verification.declaredSources![0]!;
    expect(check.source).toContain('review signal "rev-1"');
    expect(check.source).toContain("(contradicts)");
    expect(check.asReported).toBe("3.1/5 / misleading");
    expectInvariantHolds(outcome.verification);
  });

  it("honesty first: a declared contradiction OUTWEIGHS a matching excerpt", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-mixed", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(
      offerTermsEdge("ev-terms-ok", claim.id, "50% off your first 3 months, honestly"),
    );
    await deps.reviewSignals.append(signal("rev-2", "watchdog.example"));
    await deps.edges.append(reviewEdge("ev-rev-2", claim.id, "rev-2", "contradicts"));
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("contradicted");
    // Both checks still named — the full evidence list, whichever way it went.
    expect(outcome.verification.declaredSources).toHaveLength(2);
    expectInvariantHolds(outcome.verification);
  });

  it("edges that carry NOTHING comparable => not-verifiable, the sources still named (the honest tried)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-nv", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    // An offer-terms edge with a URL but NO excerpt: nothing to compare.
    await deps.edges.append(offerTermsEdge("ev-terms-bare", claim.id, undefined));
    // A user-imported document: a reference, no text on the edge.
    await deps.edges.append(userDocEdge("ev-doc-1", claim.id));
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    expect(report!.counts.notVerifiable).toBe(1);
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("not-verifiable");
    expect(outcome.verification.declaredSources).toHaveLength(2);
    expect(outcome.verification.checkedAt).toBe(NOW.toISOString());
    const sources = outcome.verification.declaredSources!.map((one) => one.source);
    expect(sources[0]).toContain('offer-terms evidence node "ev-terms-bare"');
    expect(sources[0]).toContain("terms location declared, no excerpt to compare (not comparable)");
    expect(sources[1]).toContain('user-imported-document evidence node "ev-doc-1"');
    expectInvariantHolds(outcome.verification);
  });

  it("a review signal NEVER verifies (its vocabulary is carried verbatim, never re-interpreted)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-rev-only", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.reviewSignals.append(
      signal("rev-3", "ratings.example", { asReportedRating: "5/5" }),
    );
    await deps.edges.append(reviewEdge("ev-rev-3", claim.id, "rev-3", "supports"));
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const outcome = checkedOf(report!)[0]!;
    // A supporting 5/5 review is NOT an offer declaration — not-verifiable,
    // with the vocabulary visible as-reported and the declared polarity named.
    expect(outcome.verification.outcome).toBe("not-verifiable");
    const check = outcome.verification.declaredSources![0]!;
    expect(check.source).toContain("(supports)");
    expect(check.source).toContain("carried as-reported, never re-interpreted");
    expect(check.asReported).toBe("5/5 / mixed");
  });

  it("a MISMATCHING offer-terms excerpt does-not-verify (text absence is never a contradiction — derived contradictions are forbidden)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-mismatch", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(
      offerTermsEdge("ev-terms-mismatch", claim.id, "Terms: 25% off your first 1 month."),
    );
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("not-verifiable");
    expect(outcome.verification.declaredSources![0]!.source).toContain("(does not verify)");
  });

  it("a source-reported-fact with matching numbers verifies too (the text-comparable kinds)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("claim-fact", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(
      factEdge("ev-fact-1", claim.id, "The ad discloses 50% off for 3 months"),
    );
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const outcome = checkedOf(report!)[0]!;
    expect(outcome.verification.outcome).toBe("verified-against-declared-source");
    expect(outcome.verification.declaredSources![0]!.source).toContain(
      "source-reported-fact evidence node",
    );
  });

  it("honest mixed report: verified / unchecked / not-verifiable / contradicted / absent-claim with counts that add up", async () => {
    const deps = makeDeps();
    const c1 = await seedClaim(
      deps,
      spanClaim("c-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    const c2 = await seedClaim(
      deps,
      spanClaim("c-2", "ad-1", CREATIVE_TEXT, "Limited time offer."),
    );
    const c3 = await seedClaim(
      deps,
      spanClaim("c-3", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    const c4 = await seedClaim(
      deps,
      spanClaim("c-4", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(offerTermsEdge("e-1", c1.id, "50% off your first 3 months"));
    await deps.edges.append(offerTermsEdge("e-3", c3.id, undefined));
    await deps.reviewSignals.append(signal("r-1", "streaming-reviews.example"));
    await deps.edges.append(reviewEdge("e-4", c4.id, "r-1", "contradicts"));
    const { job, report } = await new VerifyAdsOffers(deps).execute({
      claimIds: ["c-never", c4.id, c1.id, c2.id, c3.id],
    });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({
      checked: 4,
      rejected: 1,
      total: 5,
      verified: 1,
      notVerifiable: 1,
      contradicted: 1,
      unchecked: 1,
    });
    const rejected = rejectedOf(report!)[0]!;
    expect(rejected.code).toBe(ErrorCode.AdsClaimAbsent);
    expect(rejected.claimId).toBe("c-never");
    expect(rejected.reason).toContain("ads.extractClaims");
  });
});

describe("ads.verify — the record-id selector (the honest resolution surface)", () => {
  it("verifies EVERY stored claim of the record, in deterministic claim order", async () => {
    const deps = makeDeps();
    await deps.claims.put(
      spanClaim("r-claim-1", "ad-9", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.claims.put(spanClaim("r-claim-2", "ad-9", CREATIVE_TEXT, "Limited time offer."));
    await deps.edges.append(offerTermsEdge("r-ev-1", "r-claim-1", "50% off your first 3 months"));
    const { job, report } = await new VerifyAdsOffers(deps).execute({ adRecordId: "ad-9" });
    expect(job.state).toBe("succeeded");
    expect(job.payload["selectorKind"]).toBe("ad-record-id");
    expect(job.payload["selectorId"]).toBe("ad-9");
    expect(report!.counts.total).toBe(2);
    expect(checkedOf(report!).map((outcome) => outcome.claimId)).toEqual([
      "r-claim-1",
      "r-claim-2",
    ]);
    expect(report!.counts.verified).toBe(1);
    expect(report!.counts.unchecked).toBe(1);
  });

  it("an unknown record id and a claimless record BOTH yield the honest EMPTY report (no invented distinction)", async () => {
    for (const adRecordId of ["ad-never", "ad-no-claims"]) {
      const deps = makeDeps();
      const { job, report } = await new VerifyAdsOffers(deps).execute({ adRecordId });
      expect(job.state).toBe("succeeded");
      expect(report!.outcomes).toEqual([]);
      expect(report!.counts.total).toBe(0);
      expect(await deps.verifications.list()).toEqual([]);
    }
  });
});

describe("ads.verify — cancellation, both phases (§2.6)", () => {
  it("BOUNDARY cancellation: an already-aborted signal cancels the job, nothing stored", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("cx-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(offerTermsEdge("cx-e-1", claim.id, "50% off your first 3 months"));
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new VerifyAdsOffers(deps).execute({
      claimIds: [claim.id],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(await deps.verifications.list()).toEqual([]);
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each claim stops the batch; the completed claim's verification stays; report null", async () => {
    const controller = new AbortController();
    const deps = makeDeps();
    await seedClaim(deps, spanClaim("cx-a", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"));
    await seedClaim(deps, spanClaim("cx-b", "ad-1", CREATIVE_TEXT, "Limited time offer."));
    const verifications = new (class extends InMemoryOfferVerificationStore {
      override async append(verification: OfferVerification) {
        const appended = await super.append(verification);
        controller.abort();
        return appended;
      }
    })();
    const deps2 = { ...deps, verifications };
    const { job, report } = await new VerifyAdsOffers(deps2).execute({
      claimIds: ["cx-a", "cx-b"],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    // The FIRST claim's verification stays (per-claim atomicity); the
    // second claim was never reached.
    const stored = await deps2.verifications.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.claimId).toBe("cx-a");
  });
});

describe("ads.verify — the sources NEVER mutate + idempotent re-runs", () => {
  it("the stored claims, edges, and review signals are deep-equal before and after a run", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("im-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(offerTermsEdge("im-e-1", claim.id, "50% off your first 3 months"));
    await deps.reviewSignals.append(signal("im-r-1", "ratings.example"));
    await deps.edges.append(reviewEdge("im-e-2", claim.id, "im-r-1", "contextualizes"));
    const claimsBefore = await deps.claims.list();
    const edgesBefore = await deps.edges.list();
    const signalsBefore = await deps.reviewSignals.list();
    await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    expect(await deps.claims.list()).toEqual(claimsBefore);
    expect(await deps.edges.list()).toEqual(edgesBefore);
    expect(await deps.reviewSignals.list()).toEqual(signalsBefore);
  });

  it("an IDEMPOTENT re-run mints NEW records (each run is a check instant); re-APPENDING an existing id duplicates (store idempotency, byte-identical)", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("idem-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(offerTermsEdge("idem-e-1", claim.id, "50% off your first 3 months"));
    const first = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const firstRecord = checkedOf(first.report!)[0]!.verification;
    const storeAfterFirst = await deps.verifications.list();
    // A re-run is a NEW check instant: a fresh id, a new appended row with
    // the same typed outcome over the same evidence (the honest history).
    const second = await new VerifyAdsOffers(deps).execute({ claimIds: [claim.id] });
    const secondRecord = checkedOf(second.report!)[0]!.verification;
    expect(secondRecord.id).not.toBe(firstRecord.id);
    expect(secondRecord.outcome).toBe(firstRecord.outcome);
    expect(await deps.verifications.list()).toHaveLength(2);
    // The STORE's own idempotency: re-appending an existing id is a
    // duplicate returning the stored record — never a second row.
    const reappend = await deps.verifications.append(firstRecord);
    expect(reappend.outcome).toBe("duplicate");
    expect(await deps.verifications.list()).toEqual([...storeAfterFirst, secondRecord]);
  });
});

describe("ads.verify — caller defects validated BEFORE the job exists (typed ads/verification-invalid)", () => {
  it("rejects BOTH selectors, NEITHER selector, a blank record id, a blank claim id, and duplicate claim ids", async () => {
    const useCase = new VerifyAdsOffers(makeDeps());
    const cases: readonly [unknown, string][] = [
      [{ claimIds: ["c-1"], adRecordId: "ad-1" }, "BOTH"],
      [{}, "NEITHER"],
      [{ adRecordId: "  " }, "blank record id"],
      [{ claimIds: ["  "] }, "blank claim id"],
      [{ claimIds: ["c-1", "c-1"] }, "duplicate claim ids"],
    ];
    for (const [input, what] of cases) {
      let caught: unknown;
      try {
        await useCase.execute(input as never);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const wfe = caught as { code?: unknown };
      expect(wfe.code).toBe(ErrorCode.AdsVerificationInvalid);
      expect(String((caught as Error).message).length).toBeGreaterThan(0);
      expect(what.length).toBeGreaterThan(0);
    }
  });
});

describe("ads.verify — infrastructure failures stamp the job FAILED and rethrow typed", () => {
  it("a verification-store throw mid-run: FAILED job + AdsVerifyOffersJobError with the cause intact", async () => {
    const deps = makeDeps();
    const claim = await seedClaim(
      deps,
      spanClaim("err-1", "ad-1", CREATIVE_TEXT, "50% off your first 3 months"),
    );
    await deps.edges.append(offerTermsEdge("err-e-1", claim.id, "50% off your first 3 months"));
    const verifications = new (class extends InMemoryOfferVerificationStore {
      override async append(): Promise<never> {
        throw new Error("sqlite exploded");
      }
    })();
    let caught: unknown;
    try {
      await new VerifyAdsOffers({ ...deps, verifications }).execute({ claimIds: [claim.id] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdsVerifyOffersJobError);
    const jobError = caught as AdsVerifyOffersJobError;
    expect(jobError.code).toBe(ErrorCode.AdsVerificationInvalid);
    expect(jobError.reason).toContain("sqlite exploded");
    expect(jobError.job.state).toBe("failed");
    expect(jobError.job.lastError).toContain("ads verify");
  });
});

// ---------------------------------------------------------------------------
// The determinism corpus (sha256-pinned)
// ---------------------------------------------------------------------------

/**
 * Builds the corpus's fixed evidence world over one creative text: five
 * claims, each with a distinct evidence configuration (verifying terms /
 * mismatching terms / no excerpt / contradicting review / none at all) +
 * the signals the review edges reference. Pure fixture data, no clock.
 */
async function buildCorpus(deps: VerifyAdsOffersDeps): Promise<readonly string[]> {
  const claimIds = [
    "corpus-claim-1",
    "corpus-claim-2",
    "corpus-claim-3",
    "corpus-claim-4",
    "corpus-claim-5",
  ];
  for (const [index, claimId] of claimIds.entries()) {
    await deps.claims.put(
      spanClaim(
        claimId,
        "corpus-ad",
        CREATIVE_TEXT,
        index % 2 === 0 ? "50% off your first 3 months" : "Limited time offer.",
      ),
    );
  }
  await deps.edges.append(
    offerTermsEdge("corpus-ev-1", "corpus-claim-1", "50% off your first 3 months. Cancel anytime."),
  );
  await deps.edges.append(
    offerTermsEdge("corpus-ev-2", "corpus-claim-2", "Terms: 25% off the first month only."),
  );
  await deps.edges.append(offerTermsEdge("corpus-ev-3", "corpus-claim-3", undefined));
  await deps.reviewSignals.append(signal("corpus-rev-1", "streaming-reviews.example"));
  await deps.edges.append(
    reviewEdge("corpus-ev-4", "corpus-claim-4", "corpus-rev-1", "contradicts"),
  );
  // corpus-claim-5 carries NO evidence (the honest unchecked case).
  return claimIds;
}

describe("determinism corpus (same evidence => byte-identical verification set, sha256-pinned)", () => {
  const pin = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

  it("the whole corpus is byte-identical across runs and matches the pinned sha256", async () => {
    const runOnce = async (): Promise<readonly OfferVerification[]> => {
      const deps = makeDeps();
      const claimIds = await buildCorpus(deps);
      const { report } = await new VerifyAdsOffers(deps).execute({ claimIds });
      return checkedOf(report!).map((outcome) => outcome.verification);
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("270676771a2102138fd7a806a112505e907ebaf0c1a6ec15531e793984c5fe60");
    // The corpus covers every typed outcome (the honest full-spectrum
    // read-out, deterministically derived).
    const outcomes = first.map((record) => record.outcome).sort();
    expect(outcomes).toEqual([
      "contradicted",
      "not-verifiable",
      "not-verifiable",
      "unchecked",
      "verified-against-declared-source",
    ]);
  });

  it("each corpus claim pins its own digest", async () => {
    const deps = makeDeps();
    const claimIds = await buildCorpus(deps);
    const { report } = await new VerifyAdsOffers(deps).execute({ claimIds });
    const byClaim = new Map(
      checkedOf(report!).map((outcome) => [outcome.claimId, outcome.verification]),
    );
    const expected: readonly [string, string][] = [
      ["corpus-claim-1", "77ff925adb0d05e6f167f957718fd99d17708a15e305df493c9d1ff91738707e"],
      ["corpus-claim-2", "6bf78a1d740fee01ad122607514600a4d2174618f92d60d0849a8811e69b8859"],
      ["corpus-claim-3", "cd5911f8968596d128548c41c37f735ca8d82c0677d5e1f4dd769ddddbc8c909"],
      ["corpus-claim-4", "45d61ac18071ba1e2358abb375ec3cf229afc9274c666dd3c79bbd15828fda15"],
      ["corpus-claim-5", "8178c9f6970a159655a9268b4c9a968766c844ad86e9343e4d25598ef6f7d94b"],
    ];
    for (const [claimId, expectedPin] of expected) {
      expect(pin(byClaim.get(claimId))).toBe(expectedPin);
    }
  });
});
