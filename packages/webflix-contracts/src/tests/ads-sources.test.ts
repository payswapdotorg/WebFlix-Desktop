/**
 * Round-trip + rejection tests for the transparency-source seam shapes
 * (P5-SOURCES) — same house pattern as ads.test.ts: known-good instances
 * parse and round-trip unchanged (including through JSON), known-bad
 * instances are rejected by safeParse, and the honest-absent optionals
 * round-trip ABSENT (a source whose terms do not enumerate regions yields
 * a manifest without them — never a fabricated default). The ACCESS
 * STATES ARE DATA: the result union's pending/blocked/unavailable states
 * parse as ordinary data — the product-feature rule, made literal. The
 * manifest honesty itself (the audit-constraint match) lives in the
 * APPLICATION tests next to the real adapters' manifests; these tests
 * pin the SHAPES.
 */
import { describe, expect, it } from "vitest";
import type { TransparencySourceManifest } from "../index";
import {
  TransparencySourceAccessStateSchema,
  TransparencySourceManifestSchema,
  TransparencyQuerySchema,
  TransparencyAdvertiserReportSchema,
  TransparencyObservationSchema,
  TransparencyQueryResultSchema,
} from "../index";

const ISO = "2026-10-12T00:00:00Z";
const ISO_LATER = "2026-10-20T12:30:00Z";

function expectRoundTrip(schema: { parse(value: unknown): unknown }, valid: unknown): void {
  const parsed = schema.parse(valid);
  expect(parsed).toEqual(valid);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(valid);
}

function expectRejected(
  schema: { safeParse(value: unknown): { success: boolean } },
  invalid: unknown,
): void {
  expect(schema.safeParse(invalid).success).toBe(false);
}

const manifest = {
  source: "meta-ad-library",
  displayName: "Meta Ad Library",
  accessState: "pending-authorization",
  declaredCategories: ["social issues", "elections", "politics"],
  coverageNote:
    "Coverage is limited to ads about social issues, elections and politics, varying by region.",
  authorizationPathNote:
    "Requires app review plus business verification plus ID verification (Meta developer application).",
  termsUrl: "https://developers.facebook.com/docs/ads_archive",
};

const observation = {
  sourceAdId: "999123",
  advertiser: {
    sourceAdvertiserId: "page-77",
    names: ["Acme Streaming"],
    regions: ["US"],
    verificationState: "source-reported-verified",
  },
  creativeText: "Watch Acme — 50% off your first 3 months!",
  creativeUrls: ["https://acme.example/offer"],
  regions: ["US", "DE"],
  periods: [{ start: ISO, end: ISO_LATER }],
  observedAt: ISO,
};

describe("transparency-source seam contract schemas", () => {
  describe("TransparencySourceAccessState", () => {
    it("accepts the three access states", () => {
      for (const state of ["available", "pending-authorization", "blocked"]) {
        expect(TransparencySourceAccessStateSchema.parse(state)).toBe(state);
      }
    });
    it("rejects anything else — the enum is closed", () => {
      expectRejected(TransparencySourceAccessStateSchema, "not-authorized");
      expectRejected(TransparencySourceAccessStateSchema, "unavailable");
      expectRejected(TransparencySourceAccessStateSchema, "");
    });
  });

  describe("TransparencySourceManifest", () => {
    it("round-trips a full pending-authorization manifest unchanged", () => {
      expectRoundTrip(TransparencySourceManifestSchema, manifest);
    });
    it("round-trips honest-absent optionals ABSENT (terms that enumerate nothing)", () => {
      const blocked: TransparencySourceManifest = {
        source: "google-ads-transparency-center",
        displayName: "Google Ads Transparency Center",
        accessState: "blocked",
        coverageNote: "Public web UI only; terms note geographic/age restrictions.",
        authorizationPathNote:
          "No sanctioned automated-access path exists (no official API; scrapers are not an approved path).",
      };
      expectRoundTrip(TransparencySourceManifestSchema, blocked);
      expect(blocked.declaredRegions).toBeUndefined();
      expect(blocked.declaredCategories).toBeUndefined();
    });
    it("accepts an available manifest WITHOUT an authorization path note", () => {
      expectRoundTrip(TransparencySourceManifestSchema, {
        source: "some-future-source",
        displayName: "Some Future Source",
        accessState: "available",
        coverageNote: "Covers what its own terms declare.",
      });
    });
    it("REJECTS a pending manifest without the authorization path note (a pending state without its path is a dead end)", () => {
      expectRejected(TransparencySourceAccessStateSchema, "x"); // control: enum itself fine
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        authorizationPathNote: undefined,
      });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        accessState: "blocked",
        authorizationPathNote: undefined,
      });
    });
    it("rejects blank identifiers, unknown access states, bad region codes and bad terms urls", () => {
      expectRejected(TransparencySourceManifestSchema, { ...manifest, source: "" });
      expectRejected(TransparencySourceManifestSchema, { ...manifest, displayName: "" });
      expectRejected(TransparencySourceManifestSchema, { ...manifest, accessState: "open" });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        declaredRegions: ["usa"],
      });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        declaredRegions: [],
      });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        declaredCategories: [],
      });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        coverageNote: "",
      });
      expectRejected(TransparencySourceManifestSchema, {
        ...manifest,
        termsUrl: "not-a-url",
      });
    });
  });

  describe("TransparencyQuery", () => {
    it("round-trips search terms + optional region", () => {
      expectRoundTrip(TransparencyQuerySchema, { searchTerms: "Acme streaming" });
      expectRoundTrip(TransparencyQuerySchema, { searchTerms: "Acme streaming", region: "US" });
    });
    it("rejects blank search terms and non-alpha-2 regions", () => {
      expectRejected(TransparencyQuerySchema, { searchTerms: "   " });
      expectRejected(TransparencyQuerySchema, { searchTerms: "" });
      expectRejected(TransparencyQuerySchema, { searchTerms: "Acme", region: "usa" });
      expectRejected(TransparencyQuerySchema, { region: "US" });
    });
  });

  describe("TransparencyAdvertiserReport", () => {
    it("round-trips a full report and the honest-absent variants", () => {
      expectRoundTrip(TransparencyAdvertiserReportSchema, observation.advertiser);
      expectRoundTrip(TransparencyAdvertiserReportSchema, { sourceAdvertiserId: "page-77" });
      expectRoundTrip(TransparencyAdvertiserReportSchema, { names: ["Acme Streaming"] });
    });
    it("rejects a report identifying the advertiser in NO way (importable honesty)", () => {
      expectRejected(TransparencyAdvertiserReportSchema, {});
      expectRejected(TransparencyAdvertiserReportSchema, {
        regions: ["US"],
        verificationState: "source-reported-verified",
      });
    });
    it("rejects bad region codes and empty name arrays", () => {
      expectRejected(TransparencyAdvertiserReportSchema, {
        names: ["Acme"],
        regions: ["zzz"],
      });
      expectRejected(TransparencyAdvertiserReportSchema, { names: [] });
    });
  });

  describe("TransparencyObservation", () => {
    it("round-trips a full observation unchanged", () => {
      expectRoundTrip(TransparencyObservationSchema, observation);
    });
    it("round-trips the honest-minimum observation (advertiser + nothing else reported)", () => {
      expectRoundTrip(TransparencyObservationSchema, {
        advertiser: { names: ["Acme Streaming"] },
      });
    });
    it("rejects an observation without an advertiser report", () => {
      expectRejected(TransparencyObservationSchema, {
        sourceAdId: "999123",
        creativeText: "text",
      });
    });
    it("rejects blank sourceAdId, empty creative arrays and malformed periods", () => {
      expectRejected(TransparencyObservationSchema, {
        ...observation,
        sourceAdId: "",
      });
      expectRejected(TransparencyObservationSchema, {
        ...observation,
        creativeUrls: [],
      });
      expectRejected(TransparencyObservationSchema, {
        ...observation,
        periods: [{ start: ISO_LATER, end: ISO }],
      });
    });
  });

  describe("TransparencyQueryResult — the access states are DATA", () => {
    it("round-trips an ok result with observations (empty = the honest no-results)", () => {
      expectRoundTrip(TransparencyQueryResultSchema, {
        status: "ok",
        observations: [observation],
      });
      expectRoundTrip(TransparencyQueryResultSchema, { status: "ok", observations: [] });
    });
    it("round-trips the three honest states as ordinary DATA with their reasons", () => {
      expectRoundTrip(TransparencyQueryResultSchema, {
        status: "unavailable",
        reason: "the source could not serve the query right now",
      });
      expectRoundTrip(TransparencyQueryResultSchema, {
        status: "pending-authorization",
        reason: "requires app review + business verification (apply through the developer path)",
      });
      expectRoundTrip(TransparencyQueryResultSchema, {
        status: "blocked",
        reason: "no official API exists; scrapers are not an approved path",
      });
    });
    it("rejects unknown statuses, blank reasons and malformed observation payloads", () => {
      expectRejected(TransparencyQueryResultSchema, {
        status: "not-authorized",
        reason: "x",
      });
      expectRejected(TransparencyQueryResultSchema, { status: "ok" });
      expectRejected(TransparencyQueryResultSchema, { status: "blocked", reason: "" });
      expectRejected(TransparencyQueryResultSchema, {
        status: "ok",
        observations: [{ advertiser: {} }],
      });
    });
  });
});
