// Hermetic unit tests for the catalog merge domain (no network, no fs, no clock).

import { describe, expect, it } from "vitest";

import type { CatalogItem, ProviderAsset } from "webflix-contracts";
import { CONFIDENCE, DEFAULT_THRESHOLDS, mergeCatalogInto, scoreMatch } from "../merge";

function asset(partial: Partial<ProviderAsset> & Pick<ProviderAsset, "assetId">): ProviderAsset {
  return {
    providerId: "youtube",
    title: "Untitled",
    kind: "movie",
    ...partial,
  };
}

function item(partial: Partial<CatalogItem> & Pick<CatalogItem, "id" | "title">): CatalogItem {
  return {
    kind: "movie",
    assets: [],
    availability: [],
    ...partial,
  };
}

const matrixItem = (): CatalogItem =>
  item({
    id: "cat:movie:tmdb:603",
    title: "The Matrix",
    year: 1999,
    assets: [
      {
        assetId: "603",
        providerId: "tmdb",
        title: "The Matrix",
        kind: "movie",
        year: 1999,
        externalIds: { tmdb: "603" },
      },
    ],
    availability: [{ providerId: "tmdb", available: true }],
  });

describe("scoreMatch", () => {
  it("never matches across media kinds", () => {
    const a = asset({ assetId: "yt-1", title: "The Matrix", kind: "series" });
    expect(scoreMatch(a, matrixItem())).toBeNull();
  });

  it("scores provider-native identity at 1.0", () => {
    const a = asset({ assetId: "603", providerId: "tmdb", title: "whatever" });
    const evidence = scoreMatch(a, matrixItem());
    expect(evidence?.type).toBe("provider-native");
    expect(evidence?.confidence).toBe(CONFIDENCE.providerNative);
  });

  it("scores a shared canonical external id at 1.0 across providers", () => {
    const a = asset({
      assetId: "yt-7",
      title: "Some Upload Title",
      externalIds: { tmdb: "603" },
    });
    const evidence = scoreMatch(a, matrixItem());
    expect(evidence?.type).toBe("external-id");
    expect(evidence?.confidence).toBe(CONFIDENCE.externalId);
    expect(evidence?.source).toBe("external-id:tmdb");
  });

  it("scores exact title plus matching year as title-year", () => {
    const a = asset({ assetId: "yt-8", title: "The Matrix", year: 1999 });
    const evidence = scoreMatch(a, matrixItem());
    expect(evidence?.type).toBe("title-year");
    expect(evidence?.confidence).toBe(CONFIDENCE.titleYear);
  });

  it("scores exact title with unknown year at the autoMerge boundary", () => {
    const a = asset({ assetId: "yt-9", title: "  the   MATRIX " });
    const evidence = scoreMatch(a, matrixItem());
    expect(evidence?.type).toBe("title-year");
    expect(evidence?.confidence).toBe(CONFIDENCE.titleExactNoYear);
    expect(evidence?.confidence).toBe(DEFAULT_THRESHOLDS.autoMerge);
  });

  it("demotes exact titles with conflicting years", () => {
    const a = asset({ assetId: "yt-10", title: "The Matrix", year: 2009 });
    const evidence = scoreMatch(a, matrixItem());
    expect(evidence?.type).toBe("title-fuzzy");
    expect(evidence?.confidence).toBe(CONFIDENCE.titleExactYearConflict);
  });

  it("emits no evidence for unrelated titles", () => {
    const a = asset({
      assetId: "yt-11",
      title: "Surface Washers of the Caribbean",
    });
    expect(scoreMatch(a, matrixItem())).toBeNull();
  });
});

describe("mergeCatalogInto", () => {
  it("merges an incoming asset when evidence clears autoMerge", () => {
    const base = [matrixItem()];
    const incoming = asset({
      assetId: "yt-999",
      title: "The Matrix",
      year: 1999,
      url: "https://youtube.com/watch?v=999",
    });

    const result = mergeCatalogInto(base, [incoming]);

    expect(result.items).toHaveLength(1);
    const merged = result.items[0];
    expect(merged?.id).toBe("cat:movie:tmdb:603");
    expect(merged?.assets).toHaveLength(2);
    expect(merged?.assets[1]?.providerId).toBe("youtube");
    expect(merged?.availability).toHaveLength(2);
    expect(merged?.matchEvidence?.type).toBe("title-year");
    expect(merged?.matchEvidence?.confidence).toBe(CONFIDENCE.titleYear);

    expect(result.report.merged).toBe(1);
    expect(result.report.records[0]?.outcome).toBe("merged");
    expect(result.report.records[0]?.targetItemId).toBe("cat:movie:tmdb:603");

    // inputs untouched
    expect(base[0]?.assets).toHaveLength(1);
    expect(base[0]?.matchEvidence).toBeUndefined();
    expect(result.items[0]).not.toBe(base[0]);
  });

  it("keeps ambiguous matches as separate items", () => {
    const base = [
      item({ id: "cat:movie:dvd:ring-2002", title: "The Ring", year: 2002 }),
      item({ id: "cat:movie:dvd:ring-2005", title: "The Ring", year: 2005 }),
    ];
    const incoming = asset({ assetId: "yt-ring", title: "the ring" });

    const result = mergeCatalogInto(base, [incoming]);

    // both candidates are exact-title-no-year (0.9) -> tied -> ambiguous
    expect(result.items).toHaveLength(3);
    expect(result.items[2]?.id).toBe("cat:movie:youtube:yt-ring");
    expect(result.items[2]?.assets).toEqual([incoming]);
    expect(result.items[2]?.matchEvidence).toBeUndefined();

    expect(result.report.ambiguous).toBe(1);
    expect(result.report.created).toBe(0);
    expect(result.report.merged).toBe(0);

    const record = result.report.records[0];
    expect(record?.outcome).toBe("ambiguous-separate");
    expect(record?.evidence?.confidence).toBe(CONFIDENCE.titleExactNoYear);
    expect(record?.runnerUpEvidence?.confidence).toBe(CONFIDENCE.titleExactNoYear);
    expect(record?.reason).toContain("ambiguityDelta");

    // neither existing item absorbed the asset
    expect(result.items[0]?.assets).toHaveLength(0);
    expect(result.items[1]?.assets).toHaveLength(0);
  });

  it("reports ambiguous-separate when two candidates tie at autoMerge strength via external ids", () => {
    const shared = { imdb: "tt0133093" };
    const base = [
      item({
        id: "a",
        title: "Variant A",
        assets: [
          asset({
            assetId: "p1",
            providerId: "plex",
            title: "Variant A",
            externalIds: shared,
          }),
        ],
      }),
      item({
        id: "b",
        title: "Variant B",
        assets: [
          asset({
            assetId: "p2",
            providerId: "plex",
            title: "Variant B",
            externalIds: shared,
          }),
        ],
      }),
    ];
    const incoming = asset({
      assetId: "yt-1",
      title: "Unknown Upload",
      externalIds: { imdb: "tt0133093" },
    });

    const result = mergeCatalogInto(base, [incoming]);

    expect(result.items).toHaveLength(3);
    expect(result.report.ambiguous).toBe(1);
    expect(result.report.records[0]?.outcome).toBe("ambiguous-separate");
    expect(result.report.records[0]?.evidence?.confidence).toBe(1);
    expect(result.report.records[0]?.runnerUpEvidence?.confidence).toBe(1);
  });

  it("keeps low-confidence candidates separate", () => {
    const base = [item({ id: "cat:movie:plex:alien", title: "Alien", year: 1979 })];
    const incoming = asset({ assetId: "yt-alien", title: "Aliens" });

    const result = mergeCatalogInto(base, [incoming]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.assets).toHaveLength(0);
    expect(result.items[1]?.id).toBe("cat:movie:youtube:yt-alien");
    expect(result.report.lowConfidence).toBe(1);

    const record = result.report.records[0];
    expect(record?.outcome).toBe("low-confidence-separate");
    expect(record?.evidence?.type).toBe("title-fuzzy");
    expect(record?.evidence?.confidence).toBeCloseTo(0.708, 2);
  });

  it("merges when the best candidate clears autoMerge even with a weaker runner-up", () => {
    const base = [
      item({ id: "cat:movie:plex:alien", title: "Alien", year: 1979 }),
      item({ id: "cat:movie:plex:aliens", title: "Aliens", year: 1986 }),
    ];
    const incoming = asset({ assetId: "yt-aliens", title: "Aliens" });

    const result = mergeCatalogInto(base, [incoming]);

    // exact 'Aliens' (0.9) beats fuzzy 'Alien' (~0.708); gap >> ambiguityDelta
    expect(result.items).toHaveLength(2);
    expect(result.items[1]?.id).toBe("cat:movie:plex:aliens");
    expect(result.items[1]?.assets).toHaveLength(1);
    expect(result.report.merged).toBe(1);
    expect(result.report.ambiguous).toBe(0);
    expect(result.report.records[0]?.targetItemId).toBe("cat:movie:plex:aliens");
  });

  it("creates a new item when nothing matches", () => {
    const base = [matrixItem()];
    const incoming = asset({
      assetId: "yt-new",
      title: "Surface Washers of the Caribbean",
      year: 2024,
    });

    const result = mergeCatalogInto(base, [incoming]);

    expect(result.items).toHaveLength(2);
    const created = result.items[1];
    expect(created?.id).toBe("cat:movie:youtube:yt-new");
    expect(created?.title).toBe("Surface Washers of the Caribbean");
    expect(created?.year).toBe(2024);
    expect(created?.kind).toBe("movie");
    expect(created?.assets).toEqual([incoming]);
    expect(created?.availability).toEqual([{ providerId: "youtube", available: true }]);
    expect(created?.matchEvidence).toBeUndefined();
    expect(result.report.created).toBe(1);
    expect(result.report.records[0]?.outcome).toBe("created");
  });

  it("dedupes an asset that is already present on the matched item", () => {
    const base = [matrixItem()];
    const incoming: ProviderAsset = {
      assetId: "603",
      providerId: "tmdb",
      title: "The Matrix",
      kind: "movie",
      year: 1999,
      externalIds: { tmdb: "603" },
    };

    const result = mergeCatalogInto(base, [incoming]);

    expect(result.items[0]?.assets).toHaveLength(1);
    expect(result.report.deduped).toBe(1);
    expect(result.report.merged).toBe(0);
    expect(result.report.records[0]?.outcome).toBe("deduped");
  });

  it("deduplicates availability facts per provider+url but keeps distinct urls", () => {
    const base = item({
      id: "cat:movie:yt:heat",
      title: "Heat",
      year: 1995,
      availability: [{ providerId: "youtube", available: true, url: "https://example.com/old" }],
    });
    const incoming = asset({
      assetId: "heat-1",
      title: "Heat",
      year: 1995,
      url: "https://example.com/new",
    });

    const first = mergeCatalogInto([base], [incoming]);
    expect(first.items[0]?.availability).toHaveLength(2);
    expect(first.report.merged).toBe(1);

    const second = mergeCatalogInto(first.items, [incoming]);
    expect(second.report.deduped).toBe(1);
    expect(second.items[0]?.availability).toHaveLength(2);
  });

  it("honours overridden thresholds", () => {
    const base = [matrixItem()];
    const incoming = asset({ assetId: "yt-999", title: "The Matrix", year: 1999 });

    const strict = mergeCatalogInto(base, [incoming], {
      ...DEFAULT_THRESHOLDS,
      autoMerge: 0.99,
    });
    expect(strict.items).toHaveLength(2);
    expect(strict.report.lowConfidence).toBe(1);
    expect(strict.report.merged).toBe(0);

    const lenient = mergeCatalogInto(base, [incoming], {
      ...DEFAULT_THRESHOLDS,
      autoMerge: 0.5,
    });
    expect(lenient.items).toHaveLength(1);
    expect(lenient.report.merged).toBe(1);
  });

  it("does not mutate the base catalog", () => {
    const base = [matrixItem()];
    const snapshot = JSON.parse(JSON.stringify(base)) as CatalogItem[];

    mergeCatalogInto(base, [
      asset({ assetId: "yt-999", title: "The Matrix", year: 1999 }),
      asset({ assetId: "yt-other", title: "Totally Different Thing" }),
    ]);

    expect(base).toEqual(snapshot);
  });

  it("report counters always sum to the number of processed assets", () => {
    const base = [matrixItem()];
    const incoming = [
      asset({ assetId: "yt-999", title: "The Matrix", year: 1999 }), // merged
      asset({ assetId: "603", providerId: "tmdb", title: "The Matrix" }), // deduped
      asset({ assetId: "yt-new", title: "Something Else Entirely" }), // created
    ];

    const { report } = mergeCatalogInto(base, incoming);

    expect(report.merged).toBe(1);
    expect(report.deduped).toBe(1);
    expect(report.created).toBe(1);
    expect(report.records).toHaveLength(incoming.length);
    expect(
      report.merged + report.deduped + report.created + report.ambiguous + report.lowConfidence,
    ).toBe(incoming.length);
  });
});
