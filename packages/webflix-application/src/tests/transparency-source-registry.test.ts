/**
 * The transparency-source registry's tests (P5-SOURCES scope row 3) —
 * the ranker-adapter-registry pattern's shape rules, carried into the
 * ads lane: the static default registry lists EXACTLY the three
 * honest-state adapters in the audit's row order; `get` resolves the
 * known ids and honestly nulls the unknown; the constructor guard
 * rejects an empty seed, a duplicate source id, a schema-invalid
 * manifest, a manifest/adapter id disagreement, and a seed without a
 * real port implementation — all typed ads/source-invalid (the ads
 * lane's code exists, so the guard throws it).
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import {
  GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
  META_AD_LIBRARY_SOURCE_ID,
  TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
  createStaticTransparencySourceRegistry,
  DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
  type TransparencySourceEntry,
} from "../index";
import { META_AD_LIBRARY_MANIFEST } from "../index";

/** A minimal contract-valid manifest for seed tests. */
function seedManifest(source: string): TransparencySourceEntry["manifest"] {
  return {
    ...META_AD_LIBRARY_MANIFEST,
    source,
    displayName: `Source ${source}`,
  };
}

/** A port-shaped stand-in whose descriptor follows its manifest. */
function seedAdapter(source: string, version = "0.0.0-test") {
  return {
    descriptor: { source, version },
    manifest: seedManifest(source),
    async query() {
      return { status: "ok" as const, observations: [] };
    },
  };
}

describe("the static transparency-source registry (the ranker-registry pattern)", () => {
  it("the DEFAULT registry lists EXACTLY the three honest-state adapters, audit row order", () => {
    const entries = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.list();
    expect(entries.map((entry) => entry.manifest.source)).toEqual([
      GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
      META_AD_LIBRARY_SOURCE_ID,
      TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
    ]);
    expect(entries.map((entry) => entry.manifest.accessState)).toEqual([
      "blocked",
      "pending-authorization",
      "pending-authorization",
    ]);
    // list() is stable across calls (a registry is static data).
    expect(DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.list()).toEqual(entries);
  });

  it("get resolves every known source id and honestly nulls the unknown", () => {
    for (const id of [
      GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
      META_AD_LIBRARY_SOURCE_ID,
      TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
    ]) {
      const entry = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.get(id);
      expect(entry).not.toBeNull();
      expect(entry!.manifest.source).toBe(id);
      expect(entry!.adapter.descriptor.source).toBe(id);
    }
    expect(DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.get("no-such-source")).toBeNull();
    expect(DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.get("")).toBeNull();
  });

  it("the default entries' adapters answer with their typed states (the seam is live)", async () => {
    const gatc = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.get(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID)!;
    const meta = DEFAULT_TRANSPARENCY_SOURCE_REGISTRY.get(META_AD_LIBRARY_SOURCE_ID)!;
    expect((await gatc.adapter.query({ searchTerms: "x" })).status).toBe("blocked");
    expect((await meta.adapter.query({ searchTerms: "x" })).status).toBe("pending-authorization");
  });
});

describe("createStaticTransparencySourceRegistry — the shape rules (typed ads/source-invalid)", () => {
  it("rejects an empty seed (a registry is never empty)", () => {
    expect(() => createStaticTransparencySourceRegistry([])).toThrowError(
      expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }),
    );
  });

  it("rejects a duplicate source id (get would become ambiguous)", () => {
    const entry: TransparencySourceEntry = {
      manifest: seedManifest("dup-source"),
      adapter: seedAdapter("dup-source"),
    };
    expect(() =>
      createStaticTransparencySourceRegistry([
        entry,
        { manifest: seedManifest("dup-source"), adapter: seedAdapter("dup-source") },
      ]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
  });

  it("rejects a manifest that fails the contract shape", () => {
    expect(() =>
      createStaticTransparencySourceRegistry([
        {
          // A pending manifest WITHOUT the authorization path note — the
          // schema rejects it (a pending state without its path is a dead end).
          manifest: { ...seedManifest("bad-manifest"), authorizationPathNote: undefined },
          adapter: seedAdapter("bad-manifest"),
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
    expect(() =>
      createStaticTransparencySourceRegistry([
        // A blank source id — the guard rejects it before the schema does.
        { manifest: { ...seedManifest(""), source: "" }, adapter: seedAdapter("") },
      ]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
  });

  it("rejects a manifest/adapter id disagreement (an adapter answering for another source's manifest is a wiring lie)", () => {
    expect(() =>
      createStaticTransparencySourceRegistry([
        {
          manifest: seedManifest("manifest-source"),
          adapter: seedAdapter("adapter-source"),
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
  });

  it("rejects a seed without a real port implementation", () => {
    expect(() =>
      createStaticTransparencySourceRegistry([
        {
          manifest: seedManifest("no-port"),
          adapter: { descriptor: { source: "no-port", version: "x" } } as never,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
    expect(() =>
      createStaticTransparencySourceRegistry([{ manifest: seedManifest("no-port") } as never]),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.AdsSourceInvalid }));
  });

  it("accepts a well-formed seed and serves lookups off it", () => {
    const registry = createStaticTransparencySourceRegistry([
      { manifest: seedManifest("good-1"), adapter: seedAdapter("good-1") },
      { manifest: seedManifest("good-2"), adapter: seedAdapter("good-2") },
    ]);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get("good-1")!.manifest.displayName).toBe("Source good-1");
    expect(registry.get("missing")).toBeNull();
  });

  it("the guard errors are honest WebFlixErrors (typed, with subjects)", () => {
    try {
      createStaticTransparencySourceRegistry([]);
      expect.unreachable("the empty seed must throw");
    } catch (err) {
      expect(WebFlixError.is(err)).toBe(true);
      const typed = err as WebFlixError;
      expect(typed.code).toBe(ErrorCode.AdsSourceInvalid);
      expect(typed.reason).toContain("at least one entry");
    }
  });
});
