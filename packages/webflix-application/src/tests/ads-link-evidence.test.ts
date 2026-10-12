/**
 * ads.linkEvidence — the evidence-graph construction use case tests
 * (P5-CLAIMS scope row 3): the §2.6 job semantics (boundary + per-edge
 * cooperative cancellation), per-edge honest outcomes (accepted
 * appended/duplicate / rejected-with-reason typed through the DOMAIN
 * INVARIANT's violation vocabulary: unknown-claim, unknown-review-signal,
 * invalid shape), APPEND-ONLY idempotency by edge identity (re-running the
 * same input appends NOTHING — the stored edge wins), the EXPLICIT-INPUT
 * ONLY rule (the store holds EXACTLY the caller's edges — nothing is ever
 * derived from a claim's text), caller defects validated before the job
 * exists (duplicate edge ids), originals never mutated, and infrastructure
 * failures stamping the job FAILED and rethrowing typed.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode } from "webflix-contracts";
import type { Claim, EvidenceLink, ReviewSignal } from "webflix-contracts";
import {
  AdsLinkEvidenceJobError,
  InMemoryEvidenceEdgeStore,
  LinkAdsEvidence,
  createInMemoryAdsStores,
  type LinkAdsEvidenceDeps,
  type LinkAdsEvidenceInput,
  type AdsEvidenceLinkReport,
} from "../index";

const NOW = new Date("2026-10-12T04:00:00Z");
const ISO = "2026-10-12T00:00:00Z";
const CREATIVE_TEXT = "Watch Acme — 50% off your first 3 months!";

const claim = (id = "claim-1"): Claim => {
  const quote = "50% off your first 3 months";
  const start = CREATIVE_TEXT.indexOf(quote);
  return { id, adRecordId: "ad-1", quote, startOffset: start, endOffset: start + quote.length };
};

const signal = (id = "rev-1"): ReviewSignal => ({
  id,
  source: "streaming-reviews.example",
  asReportedRating: "4.2/5",
  provenance: { source: "user-import", importedAt: ISO, importBatchId: "batch-001" },
});

const edgeProvenance = { source: "user-import", importedAt: ISO, importBatchId: "batch-001" };

const factEdge = (id = "edge-fact"): EvidenceLink => ({
  kind: "source-reported-fact",
  id,
  claimId: "claim-1",
  relationship: "supports",
  url: "https://acme.example/offer-terms",
  asReportedText: "50% off the first three months for new subscribers",
  provenance: edgeProvenance,
});

const reviewEdge = (id = "edge-review"): EvidenceLink => ({
  kind: "independent-review",
  id,
  claimId: "claim-1",
  relationship: "contextualizes",
  reviewSignalId: "rev-1",
  provenance: edgeProvenance,
});

const termsEdge = (id = "edge-terms"): EvidenceLink => ({
  kind: "offer-terms",
  id,
  claimId: "claim-1",
  relationship: "supports",
  url: "https://acme.example/terms",
  declaredTermsExcerpt: "Offer applies to the first 3 billed months.",
  provenance: edgeProvenance,
});

const documentEdge = (id = "edge-doc"): EvidenceLink => ({
  kind: "user-imported-document",
  id,
  claimId: "claim-1",
  relationship: "contradicts",
  documentId: "user-doc-77",
  provenance: edgeProvenance,
});

function makeDeps(overrides: Partial<LinkAdsEvidenceDeps> = {}): LinkAdsEvidenceDeps {
  const stores = createInMemoryAdsStores();
  let seq = 0;
  return {
    claims: stores.claims,
    reviewSignals: stores.reviewSignals,
    edges: stores.evidenceEdges,
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

/** Deps pre-seeded with one stored claim + one stored review signal. */
async function seededDeps(
  overrides: Partial<LinkAdsEvidenceDeps> = {},
): Promise<LinkAdsEvidenceDeps> {
  const deps = makeDeps(overrides);
  await deps.claims.put(claim());
  await deps.reviewSignals.append(signal());
  return deps;
}

function acceptedOf(report: AdsEvidenceLinkReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "accepted");
}

function rejectedOf(report: AdsEvidenceLinkReport) {
  return report.outcomes.filter((outcome) => outcome.outcome === "rejected");
}

describe("ads.linkEvidence — the §2.6 job (explicit input, all four node kinds)", () => {
  it("links every typed kind: job succeeded, all edges appended and stored verbatim", async () => {
    const deps = await seededDeps();
    const input: LinkAdsEvidenceInput = {
      edges: [factEdge(), reviewEdge(), termsEdge(), documentEdge()],
    };
    const { job, report } = await new LinkAdsEvidence(deps).execute(input);
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe("ads.link-evidence");
    expect(job.cancellable).toBe(true);
    expect(job.payload["edgesCount"]).toBe(4);
    expect(report!.counts).toEqual({ accepted: 4, rejected: 0, total: 4 });
    expect(acceptedOf(report!).map((outcome) => outcome.disposition)).toEqual([
      "appended",
      "appended",
      "appended",
      "appended",
    ]);
    // Stored VERBATIM — exactly what the input provided, byte for byte.
    for (const edge of input.edges) {
      expect(await deps.edges.get(edge.id)).toEqual(edge);
    }
    expect((await deps.edges.listByClaim("claim-1")).map((edge) => edge.id).sort()).toEqual([
      "edge-doc",
      "edge-fact",
      "edge-review",
      "edge-terms",
    ]);
  });

  it("honest mixed report: a valid edge, an unknown-claim edge, an unknown-signal edge, a malformed edge", async () => {
    const deps = await seededDeps();
    const malformed = { ...factEdge("edge-bad"), url: "not-a-url" } as unknown as EvidenceLink;
    const { report } = await new LinkAdsEvidence(deps).execute({
      edges: [
        factEdge(),
        {
          kind: "independent-review",
          id: "edge-ghost-signal",
          claimId: "claim-1",
          relationship: "contextualizes",
          reviewSignalId: "rev-nope",
          provenance: edgeProvenance,
        },
        { ...factEdge("edge-ghost-claim"), claimId: "claim-nope" },
        malformed,
      ],
    });
    expect(report!.counts).toEqual({ accepted: 1, rejected: 3, total: 4 });
    const rejections = rejectedOf(report!);
    expect(rejections[0]!.code).toBe(ErrorCode.AdsEvidenceInvalid);
    expect(rejections[0]!.reason).toContain("unknown-review-signal");
    expect(rejections[1]!.reason).toContain("unknown-claim");
    expect(rejections[2]!.edgeId).toBe("edge-bad");
    expect((await deps.edges.list()).map((edge) => edge.id)).toEqual(["edge-fact"]);
  });

  it("an empty edge batch is an honest trivial success (0/0/0)", async () => {
    const deps = await seededDeps();
    const { job, report } = await new LinkAdsEvidence(deps).execute({ edges: [] });
    expect(job.state).toBe("succeeded");
    expect(report!.counts).toEqual({ accepted: 0, rejected: 0, total: 0 });
    expect(report!.outcomes).toEqual([]);
  });
});

describe("ads.linkEvidence — idempotency by edge identity (append-only)", () => {
  it("re-running the SAME input appends nothing: every outcome is a duplicate, the store is byte-identical", async () => {
    const deps = await seededDeps();
    const useCase = new LinkAdsEvidence(deps);
    const input: LinkAdsEvidenceInput = { edges: [factEdge(), reviewEdge()] };
    await useCase.execute(input);
    const afterFirst = await deps.edges.list();
    const second = await useCase.execute(input);
    expect(second.job.state).toBe("succeeded");
    expect(acceptedOf(second.report!).map((outcome) => outcome.disposition)).toEqual([
      "duplicate",
      "duplicate",
    ]);
    expect(await deps.edges.list()).toEqual(afterFirst);
    expect((await deps.edges.list()).map((edge) => edge.id).sort()).toEqual([
      "edge-fact",
      "edge-review",
    ]);
  });

  it("a DIFFERENT edge id for the same claim+node appends as a NEW edge (history is the point)", async () => {
    const deps = await seededDeps();
    await new LinkAdsEvidence(deps).execute({ edges: [factEdge("edge-1")] });
    await new LinkAdsEvidence(deps).execute({
      edges: [factEdge("edge-2")],
    });
    expect((await deps.edges.list()).map((edge) => edge.id).sort()).toEqual(["edge-1", "edge-2"]);
  });
});

describe("ads.linkEvidence — NO INFERENCE (explicit-input-only, rg-provable)", () => {
  it("the store holds EXACTLY the caller's edges — nothing is derived from any claim's text", async () => {
    const deps = await seededDeps();
    const input: LinkAdsEvidenceInput = { edges: [factEdge(), termsEdge()] };
    await new LinkAdsEvidence(deps).execute(input);
    // Exactly two rows exist; each byte-equals its input edge; the claim's
    // own text appears nowhere but the claim store.
    const stored = await deps.edges.list();
    expect(stored).toHaveLength(2);
    for (const edge of input.edges) {
      expect(stored.find((one) => one.id === edge.id)).toEqual(edge);
    }
  });

  it("a claim with rich text links NOTHING until an explicit edge names it", async () => {
    const deps = await seededDeps();
    await new LinkAdsEvidence(deps).execute({ edges: [] });
    expect(await deps.edges.listByClaim("claim-1")).toEqual([]);
  });

  it("the ORIGINALS are never mutated (the caller's edge array, deep-equal)", async () => {
    const deps = await seededDeps();
    const edges = [factEdge(), reviewEdge()];
    const before = structuredClone(edges);
    await new LinkAdsEvidence(deps).execute({ edges });
    expect(edges).toEqual(before);
  });
});

describe("ads.linkEvidence — cancellation, both phases", () => {
  it("BOUNDARY cancellation: an already-aborted signal cancels the job, nothing appended", async () => {
    const deps = await seededDeps();
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new LinkAdsEvidence(deps).execute({
      edges: [factEdge()],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(await deps.edges.list()).toEqual([]);
  });

  it("MID-RUN cooperative cancellation: the checkpoint before each edge stops the batch; appended edges stay; report null", async () => {
    const controller = new AbortController();
    const edges = new (class extends InMemoryEvidenceEdgeStore {
      override async append(
        edge: EvidenceLink,
      ): Promise<
        | { outcome: "appended"; edge: EvidenceLink }
        | { outcome: "duplicate"; existing: EvidenceLink }
      > {
        const result = await super.append(edge);
        controller.abort();
        return result;
      }
    })();
    const deps = await seededDeps({ edges });
    const { job, report } = await new LinkAdsEvidence(deps).execute({
      edges: [factEdge(), reviewEdge()],
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    // The first edge WAS appended (append-only, atomic per edge); the
    // second never ran.
    expect((await edges.list()).map((edge) => edge.id)).toEqual(["edge-fact"]);
    // The documented recovery: re-running the same input appends nothing.
    const rerun = await new LinkAdsEvidence({
      ...deps,
      edges: new InMemoryEvidenceEdgeStore(),
    }).execute({ edges: [factEdge(), reviewEdge()] });
    expect(rerun.job.state).toBe("succeeded");
  });
});

describe("ads.linkEvidence — caller defects (typed, before the job exists)", () => {
  it("duplicate edge ids within the batch are rejected before the job exists", async () => {
    const deps = await seededDeps();
    await expect(
      new LinkAdsEvidence(deps).execute({ edges: [factEdge("edge-dup"), factEdge("edge-dup")] }),
    ).rejects.toMatchObject({ code: ErrorCode.AdsEvidenceInvalid });
    expect(await deps.edges.list()).toEqual([]);
  });
});

describe("ads.linkEvidence — infrastructure failures (job FAILED, cause rethrown typed)", () => {
  it("an edge-store throw mid-batch stamps the job failed and rethrows through AdsLinkEvidenceJobError", async () => {
    const edges = new (class extends InMemoryEvidenceEdgeStore {
      override async append(): Promise<never> {
        throw new Error("sqlite exploded");
      }
    })();
    const deps = await seededDeps({ edges });
    let caught: unknown;
    try {
      await new LinkAdsEvidence(deps).execute({ edges: [factEdge()] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdsLinkEvidenceJobError);
    const jobError = caught as AdsLinkEvidenceJobError;
    expect(jobError.code).toBe(ErrorCode.AdsEvidenceInvalid);
    expect(jobError.reason).toContain("sqlite exploded");
    expect(jobError.job.state).toBe("failed");
    expect(jobError.job.lastError).toContain("ads evidence link");
  });
});
