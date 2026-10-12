/**
 * The three transparency-source adapters' tests (P5-SOURCES scope row 2):
 * EVERY operation returns the adapter's typed honest state with its
 * honest reason — the blocked/pending states are DATA, never failures
 * (the charter's product-feature rule, made literal); the reasons name
 * the audit's recorded facts (the no-official-API finding for GATC, the
 * app-review + business + ID verification path for Meta, the
 * approved-research-access path for TikTok); the manifests are
 * contract-valid and declare only what the source's own terms state;
 * the port's boundary-cancellation contract holds (an already-aborted
 * call rejects with the typed common/cancelled error); and the
 * descriptors agree with their manifests (the registry's wiring rule,
 * pinned per adapter here too).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, TransparencySourceManifestSchema, WebFlixError } from "webflix-contracts";
import type { TransparencyQuery } from "webflix-contracts";
import {
  GOOGLE_ADS_TRANSPARENCY_BLOCKED_REASON,
  GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
  GoogleAdsTransparencyAdapter,
  META_AD_LIBRARY_PENDING_REASON,
  META_AD_LIBRARY_SOURCE_ID,
  MetaAdLibraryAdapter,
  TIKTOK_COMMERCIAL_CONTENT_PENDING_REASON,
  TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
  TikTokCommercialContentAdapter,
} from "../index";

const QUERY: TransparencyQuery = { searchTerms: "streaming offer" };

describe("GoogleAdsTransparencyAdapter — BLOCKED (the no-official-API truth)", () => {
  it("every query RETURNS the typed blocked state with the honest reason (data, not a failure)", async () => {
    const adapter = new GoogleAdsTransparencyAdapter();
    const result = await adapter.query(QUERY);
    expect(result).toEqual({ status: "blocked", reason: GOOGLE_ADS_TRANSPARENCY_BLOCKED_REASON });
    // The reason carries the audit's finding, verbatim in substance.
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toContain("no official API");
      expect(result.reason).toContain("scrapers");
      expect(result.reason).toContain("blocked");
    }
    // A second query, a region-scoped query — the SAME honest state.
    expect(await adapter.query({ searchTerms: "x", region: "US" })).toEqual(result);
  });

  it("the manifest declares the blocked state + the finding, claiming NO coverage the terms do not enumerate", () => {
    const adapter = new GoogleAdsTransparencyAdapter();
    expect(() => TransparencySourceManifestSchema.parse(adapter.manifest)).not.toThrow();
    expect(adapter.manifest.source).toBe(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID);
    expect(adapter.manifest.accessState).toBe("blocked");
    expect(adapter.manifest.declaredRegions).toBeUndefined(); // terms do not enumerate
    expect(adapter.manifest.declaredCategories).toBeUndefined(); // terms do not enumerate
    expect(adapter.manifest.coverageNote).toContain("geographic/age restrictions");
    expect(adapter.manifest.authorizationPathNote).toContain("No sanctioned automated-access path");
    expect(adapter.manifest.termsUrl).toBe("https://adstransparency.google.com/terms");
  });

  it("the descriptor agrees with the manifest (the wiring rule)", () => {
    const adapter = new GoogleAdsTransparencyAdapter();
    expect(adapter.descriptor.source).toBe(adapter.manifest.source);
    expect(adapter.descriptor.version).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it("honours the boundary cancellation contract (typed common/cancelled)", async () => {
    const adapter = new GoogleAdsTransparencyAdapter();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.query(QUERY, { signal: controller.signal })).rejects.toSatisfy(
      (err: unknown) => WebFlixError.is(err) && err.code === ErrorCode.Cancelled,
    );
  });
});

describe("MetaAdLibraryAdapter — PENDING-AUTHORIZATION (the application path named)", () => {
  it("every query RETURNS the typed pending state naming the app-review + business + ID path", async () => {
    const adapter = new MetaAdLibraryAdapter();
    const result = await adapter.query(QUERY);
    expect(result).toEqual({
      status: "pending-authorization",
      reason: META_AD_LIBRARY_PENDING_REASON,
    });
    if (result.status === "pending-authorization") {
      expect(result.reason).toContain("app review");
      expect(result.reason).toContain("business verification");
      expect(result.reason).toContain("ID verification");
      expect(result.reason).toContain("ads_archive");
    }
  });

  it("the manifest declares the categories the terms enumerate and NO region set (by-region, not enumerated)", () => {
    const adapter = new MetaAdLibraryAdapter();
    expect(() => TransparencySourceManifestSchema.parse(adapter.manifest)).not.toThrow();
    expect(adapter.manifest.source).toBe(META_AD_LIBRARY_SOURCE_ID);
    expect(adapter.manifest.accessState).toBe("pending-authorization");
    expect(adapter.manifest.declaredCategories).toEqual(["social issues", "elections", "politics"]);
    expect(adapter.manifest.declaredRegions).toBeUndefined(); // by region — not enumerated
    expect(adapter.manifest.authorizationPathNote).toContain("app review");
    expect(adapter.manifest.termsUrl).toBe("https://developers.facebook.com/docs/ads_archive");
  });

  it("the descriptor agrees with the manifest", () => {
    const adapter = new MetaAdLibraryAdapter();
    expect(adapter.descriptor.source).toBe(adapter.manifest.source);
  });

  it("honours the boundary cancellation contract", async () => {
    const adapter = new MetaAdLibraryAdapter();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.query(QUERY, { signal: controller.signal })).rejects.toSatisfy(
      (err: unknown) => WebFlixError.is(err) && err.code === ErrorCode.Cancelled,
    );
  });
});

describe("TikTokCommercialContentAdapter — PENDING-AUTHORIZATION (research access)", () => {
  it("every query RETURNS the typed pending state naming the approved-research-access path", async () => {
    const adapter = new TikTokCommercialContentAdapter();
    const result = await adapter.query(QUERY);
    expect(result).toEqual({
      status: "pending-authorization",
      reason: TIKTOK_COMMERCIAL_CONTENT_PENDING_REASON,
    });
    if (result.status === "pending-authorization") {
      expect(result.reason).toContain("research access");
      expect(result.reason).toContain("EU/US");
    }
  });

  it("the manifest declares the EU/US regions the terms enumerate and NO categories", () => {
    const adapter = new TikTokCommercialContentAdapter();
    expect(() => TransparencySourceManifestSchema.parse(adapter.manifest)).not.toThrow();
    expect(adapter.manifest.source).toBe(TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID);
    expect(adapter.manifest.accessState).toBe("pending-authorization");
    expect(adapter.manifest.declaredRegions).toEqual(["EU", "US"]);
    expect(adapter.manifest.declaredCategories).toBeUndefined(); // terms declare none
    expect(adapter.manifest.coverageNote).toContain("fields, query limits and retention");
    expect(adapter.manifest.termsUrl).toBe(
      "https://developers.tiktok.com/doc/commercial-content-api-getting-started",
    );
  });

  it("the descriptor agrees with the manifest", () => {
    const adapter = new TikTokCommercialContentAdapter();
    expect(adapter.descriptor.source).toBe(adapter.manifest.source);
  });

  it("honours the boundary cancellation contract", async () => {
    const adapter = new TikTokCommercialContentAdapter();
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.query(QUERY, { signal: controller.signal })).rejects.toSatisfy(
      (err: unknown) => WebFlixError.is(err) && err.code === ErrorCode.Cancelled,
    );
  });
});
