/**
 * ads.sourceManifests — the §2.6 manifest-listing read tests (P5-SOURCES
 * scope row 3) + the MANIFEST HONESTY TEST (scope row 4): the listing
 * carries every registered source's declaration in the registry's stable
 * order with row-tally counts by access state (counted facts, never
 * coverage promises), the boundary cancellation holds, and — the
 * charter's honesty rule — the three shipped manifests MATCH the audit's
 * recorded constraints (AUDIT-SOURCES §6 finding 13 + §11): GATC
 * blocked with the no-official-API finding and NO enumerated coverage;
 * Meta pending with the app-review + business + ID path and ONLY the
 * social-issues/elections/politics categories (regions NOT enumerated —
 * coverage varies by region); TikTok pending with the EU/US regions and
 * the research-access path. The manifests never claim MORE than their
 * sources' own terms; the audit-constraint match is asserted field by
 * field.
 */
import { describe, expect, it } from "vitest";
import {
  ADS_SOURCE_MANIFESTS_JOB_KIND,
  ADS_SOURCE_MANIFESTS_SEAM_ID,
  AdsSourceManifestsJobError,
  DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
  FixtureReplayTransparencySource,
  GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
  META_AD_LIBRARY_SOURCE_ID,
  ReadTransparencySourceManifests,
  TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
  createStaticTransparencySourceRegistry,
  type ReadTransparencySourceManifestsDeps,
} from "../index";
import { META_AD_LIBRARY_MANIFEST } from "../index";
import type { TransparencySourceManifest } from "webflix-contracts";

const NOW = new Date("2026-10-12T06:10:00Z");

function makeDeps(
  overrides: Partial<ReadTransparencySourceManifestsDeps> = {},
): ReadTransparencySourceManifestsDeps {
  let seq = 0;
  return {
    registry: DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

describe("ads.sourceManifests — the §2.6 manifest-listing read", () => {
  it("lists every registered source's declaration in the registry's stable order", async () => {
    const { job, report } = await new ReadTransparencySourceManifests(makeDeps()).execute();
    expect(job.state).toBe("succeeded");
    expect(job.kind).toBe(ADS_SOURCE_MANIFESTS_JOB_KIND);
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe(ADS_SOURCE_MANIFESTS_SEAM_ID);
    expect(report).not.toBeNull();
    expect(report!.manifests.map((manifest) => manifest.source)).toEqual([
      GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
      META_AD_LIBRARY_SOURCE_ID,
      TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
    ]);
  });

  it("the counts are the access-state row tallies (facts, never promises)", async () => {
    const { report } = await new ReadTransparencySourceManifests(makeDeps()).execute();
    expect(report!.counts).toEqual({
      sources: 3,
      available: 0,
      pendingAuthorization: 2,
      blocked: 1,
    });
  });

  it("the listing is byte-identical across runs (static registry data)", async () => {
    const first = await new ReadTransparencySourceManifests(makeDeps()).execute();
    const second = await new ReadTransparencySourceManifests(makeDeps()).execute();
    expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
  });

  it("BOUNDARY cancellation: an already-aborted signal transitions queued -> cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new ReadTransparencySourceManifests(makeDeps()).execute({
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
  });

  it("an infrastructure failure stamps the job FAILED and rethrows through the typed error", async () => {
    const breaking = {
      list(): never {
        throw new Error("registry exploded");
      },
      get: () => null,
    };
    await expect(
      new ReadTransparencySourceManifests(makeDeps({ registry: breaking })).execute(),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof AdsSourceManifestsJobError)) return false;
      expect(err.job.state).toBe("failed");
      expect(err.job.lastError).toContain("registry exploded");
      return true;
    });
  });
});

describe("the MANIFEST HONESTY TEST — the declarations match the audit's recorded constraints", () => {
  const manifests = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.list().map((entry) => entry.manifest);
  const bySource = new Map<string, TransparencySourceManifest>(
    manifests.map((manifest) => [manifest.source, manifest] as const),
  );

  it("Google Ads Transparency Center: BLOCKED, the no-official-API finding carried, NO coverage enumerated, the terms link from the audit", () => {
    const gatc = bySource.get(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID)!;
    // AUDIT-SOURCES §6 row: "Public web UI only ... No official API
    // (third-party scrapers exist — not an approved path)".
    expect(gatc.accessState).toBe("blocked");
    expect(gatc.coverageNote).toContain("Public web UI only");
    expect(gatc.authorizationPathNote).toContain("no official API");
    // The terms note geographic/age restrictions — the manifest does NOT
    // enumerate regions or categories the terms do not enumerate.
    expect(gatc.declaredRegions).toBeUndefined();
    expect(gatc.declaredCategories).toBeUndefined();
    // AUDIT-SOURCES §11: https://adstransparency.google.com (+ /terms).
    expect(gatc.termsUrl).toBe("https://adstransparency.google.com/terms");
  });

  it("Meta Ad Library: PENDING-AUTHORIZATION, the app-review + business + ID verification path, social-issues/elections/politics coverage, regions NOT enumerated", () => {
    const meta = bySource.get(META_AD_LIBRARY_SOURCE_ID)!;
    // AUDIT-SOURCES §6 row: "Requires app review + business verification
    // + ID verification; coverage: ads about social issues/elections/
    // politics by region".
    expect(meta.accessState).toBe("pending-authorization");
    expect(meta.authorizationPathNote).toContain("app review");
    expect(meta.authorizationPathNote).toContain("business verification");
    expect(meta.authorizationPathNote).toContain("ID verification");
    expect(meta.declaredCategories).toEqual(["social issues", "elections", "politics"]);
    // "by region" — the region set is NOT enumerated by the terms; the
    // manifest does not invent one.
    expect(meta.declaredRegions).toBeUndefined();
    expect(meta.coverageNote).toContain("varying by region");
    // AUDIT-SOURCES §11: the ads_archive docs link.
    expect(meta.termsUrl).toBe("https://developers.facebook.com/docs/ads_archive");
  });

  it("TikTok Commercial Content: PENDING-AUTHORIZATION, the approved-research-access path, the EU/US regions the audit records", () => {
    const tiktok = bySource.get(TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID)!;
    // AUDIT-SOURCES §6 row: "Approved research access (application) ...
    // EU/US regions; fields/query limits/retention constraints per
    // agreement".
    expect(tiktok.accessState).toBe("pending-authorization");
    expect(tiktok.authorizationPathNote).toContain("research access");
    expect(tiktok.authorizationPathNote).toContain("EU/US");
    expect(tiktok.declaredRegions).toEqual(["EU", "US"]);
    // No categories are declared — the terms declare none.
    expect(tiktok.declaredCategories).toBeUndefined();
    expect(tiktok.coverageNote).toContain("fields, query limits and retention");
    // AUDIT-SOURCES §11: the commercial-content-api getting-started link.
    expect(tiktok.termsUrl).toBe(
      "https://developers.tiktok.com/doc/commercial-content-api-getting-started",
    );
  });

  it("NO manifest claims the `available` state or a global coverage (the no-global-ad-coverage rule)", () => {
    for (const manifest of manifests) {
      expect(manifest.accessState).not.toBe("available");
      expect(manifest.coverageNote.length).toBeGreaterThan(0);
      // Every non-available manifest names its authorization path (the
      // schema enforces it; the honesty test pins the substance).
      expect(manifest.authorizationPathNote).toBeDefined();
    }
  });

  it("every manifest is contract-valid (the registry validated them at construction — re-pinned here)", () => {
    // The registry's construction guard already schema-validates every
    // manifest; the honesty test re-asserts the declarations are the
    // SHIPPED constants (the manifest module is the single declaration site).
    expect(bySource.get(META_AD_LIBRARY_SOURCE_ID)).toEqual(META_AD_LIBRARY_MANIFEST);
  });
});

describe("ads.sourceManifests over a custom registry (the read is registry-driven)", () => {
  it("a registry with an available-source double lists it and tallies it (the future state, honestly counted)", async () => {
    const manifest: TransparencySourceManifest = {
      ...META_AD_LIBRARY_MANIFEST,
      source: "authorized-fixture",
      displayName: "Authorized Fixture",
      accessState: "available",
      authorizationPathNote: undefined,
    };
    const adapter = new FixtureReplayTransparencySource({
      manifest,
      result: { status: "ok", observations: [] },
    });
    const registry = createStaticTransparencySourceRegistry([{ manifest, adapter }]);
    const { report } = await new ReadTransparencySourceManifests(makeDeps({ registry })).execute();
    expect(report!.counts).toEqual({
      sources: 1,
      available: 1,
      pendingAuthorization: 0,
      blocked: 0,
    });
  });
});
