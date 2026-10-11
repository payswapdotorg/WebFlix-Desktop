/**
 * Ranker-adapter registry + selection use-case tests (P4-ADAPTERS row 1).
 *
 * Pins, honestly:
 * - the static default registry carries EXACTLY ONE entry (built-in-v1)
 *   with the truthful descriptor content — no fake options, no placeholders;
 * - resolveSelectedRanker's three resolutions: default (no selection, the
 *   documented default stated), selected (registry-known choice, INCLUDING
 *   an explicit choice of the built-in — distinct from no-selection), and
 *   fallback (registry drift: typed IntelligenceAdapterSelectionInvalid
 *   error SURFACED in the metadata while the built-in default is returned —
 *   never a silent switch);
 * - set-time validation: only registry-known ids are selectable — unknown
 *   ids throw the typed error (caller defect, hard fail at the boundary);
 * - clear resets to default honestly (resolve reports `default` after);
 * - registry construction guards (empty seed, duplicate ids, blank fields).
 *
 * HERMETIC: in-memory store, injected pinned clock, no network, no
 * randomness, no telemetry.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import {
  BUILT_IN_RANKER,
  BUILT_IN_RANKER_ID,
  BUILT_IN_RANKER_V1_ENTRY,
  DEFAULT_RANKER_ADAPTER_REGISTRY,
  InMemoryRankerSelectionStore,
  ClearRankerAdapterSelection,
  ResolveSelectedRanker,
  SetRankerAdapterSelection,
  createStaticRankerAdapterRegistry,
} from "../index";
import type { RankerAdapterEntry } from "../index";

const PINNED_CLOCK = { now: () => new Date("2026-10-11T09:30:00Z") };

async function expectWebFlixError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

describe("ranker-adapter registry (static default)", () => {
  it("carries EXACTLY ONE entry today — the built-in v1 — with truthful descriptor content", () => {
    const entries = DEFAULT_RANKER_ADAPTER_REGISTRY.list();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.id).toBe(BUILT_IN_RANKER_ID);
    expect(entry?.id).toBe("webflix.built-in-ranker");
    expect(entry?.label).toBe("Built-in ranker (v1)");
    expect(entry?.description).toContain("deterministic");
    expect(entry?.capabilities).toEqual(["deterministic", "local", "reasons-mandatory"]);
    // The seeded entry IS the built-in ranker instance (provenance continuity).
    expect(entry?.ranker).toBe(BUILT_IN_RANKER);
    expect(entry).toBe(BUILT_IN_RANKER_V1_ENTRY);
  });

  it("get() resolves the known id and returns null for unknown ids (the registry-known check)", () => {
    expect(DEFAULT_RANKER_ADAPTER_REGISTRY.get(BUILT_IN_RANKER_ID)?.id).toBe(BUILT_IN_RANKER_ID);
    expect(DEFAULT_RANKER_ADAPTER_REGISTRY.get("gpt-something-fake")).toBeNull();
    expect(DEFAULT_RANKER_ADAPTER_REGISTRY.get("")).toBeNull();
  });

  it("list() is stable across calls (registry order never shuffles)", () => {
    expect(DEFAULT_RANKER_ADAPTER_REGISTRY.list()).toEqual(DEFAULT_RANKER_ADAPTER_REGISTRY.list());
  });

  it("construction guards: empty seed, duplicate ids and blank fields are rejected", () => {
    const valid = BUILT_IN_RANKER_V1_ENTRY;
    expect(() => createStaticRankerAdapterRegistry([])).toThrow(/at least one entry/);
    expect(() => createStaticRankerAdapterRegistry([valid, valid])).toThrow(/duplicate/);
    expect(() =>
      createStaticRankerAdapterRegistry([{ ...valid, id: "" } as RankerAdapterEntry]),
    ).toThrow(/non-empty id/);
    expect(() =>
      createStaticRankerAdapterRegistry([{ ...valid, label: "  " } as RankerAdapterEntry]),
    ).toThrow(/non-empty label/);
    expect(() =>
      createStaticRankerAdapterRegistry([{ ...valid, description: "" } as RankerAdapterEntry]),
    ).toThrow(/non-empty description/);
    expect(() =>
      createStaticRankerAdapterRegistry([{ ...valid, capabilities: [] } as RankerAdapterEntry]),
    ).toThrow(/capabilities/);
    expect(() =>
      createStaticRankerAdapterRegistry([{ ...valid, ranker: {} as never } as RankerAdapterEntry]),
    ).toThrow(/RankerPort/);
  });
});

describe("resolveSelectedRanker", () => {
  it("no selection stored => the DOCUMENTED default (built-in-v1), stated in the resolution metadata", async () => {
    const resolve = new ResolveSelectedRanker({
      registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
      store: new InMemoryRankerSelectionStore(),
    });
    const resolved = await resolve.resolve();
    expect(resolved.adapter.id).toBe(BUILT_IN_RANKER_ID);
    expect(resolved.adapter.ranker).toBe(BUILT_IN_RANKER);
    expect(resolved.resolution.kind).toBe("default");
    if (resolved.resolution.kind === "default") {
      expect(resolved.resolution.note).toContain("documented default");
      expect(resolved.resolution.note).toContain("built-in");
    }
  });

  it("defaults to the static default registry when none is injected", async () => {
    const resolve = new ResolveSelectedRanker({ store: new InMemoryRankerSelectionStore() });
    const resolved = await resolve.resolve();
    expect(resolved.adapter).toBe(BUILT_IN_RANKER_V1_ENTRY);
  });

  it("a registry-known selection => that adapter, carried as `selected`", async () => {
    const store = new InMemoryRankerSelectionStore();
    const set = new SetRankerAdapterSelection({
      registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
      store,
      clock: PINNED_CLOCK,
    });
    await set.set(BUILT_IN_RANKER_ID);
    const resolve = new ResolveSelectedRanker({
      registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
      store,
    });
    const resolved = await resolve.resolve();
    expect(resolved.adapter.id).toBe(BUILT_IN_RANKER_ID);
    // An EXPLICIT selection of the built-in is `selected` — DISTINCT from
    // `default` (never-set). The distinction is the honesty contract.
    expect(resolved.resolution.kind).toBe("selected");
    if (resolved.resolution.kind === "selected") {
      expect(resolved.resolution.selection.adapterId).toBe(BUILT_IN_RANKER_ID);
      expect(resolved.resolution.selection.selectedAt).toBe("2026-10-11T09:30:00.000Z");
    }
  });

  it("registry drift (stored unknown id) => HONEST fail-soft: typed error surfaced in metadata, built-in returned — never a silent switch", async () => {
    // Seed a selection through a registry that KNOWS a second adapter...
    const futureEntry: RankerAdapterEntry = {
      id: "webflix.some-future-adapter",
      label: "A future adapter",
      description: "Exists only in this test's injected registry.",
      capabilities: ["test-only"],
      ranker: BUILT_IN_RANKER,
    };
    const richRegistry = createStaticRankerAdapterRegistry([BUILT_IN_RANKER_V1_ENTRY, futureEntry]);
    const store = new InMemoryRankerSelectionStore();
    const set = new SetRankerAdapterSelection({
      registry: richRegistry,
      store,
      clock: PINNED_CLOCK,
    });
    await set.set("webflix.some-future-adapter");

    // ...then resolve against the REAL default registry (the adapter is gone).
    const resolve = new ResolveSelectedRanker({
      registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
      store,
    });
    const resolved = await resolve.resolve();
    expect(resolved.adapter.id).toBe(BUILT_IN_RANKER_ID);
    expect(resolved.resolution.kind).toBe("fallback");
    if (resolved.resolution.kind === "fallback") {
      expect(resolved.resolution.requestedAdapterId).toBe("webflix.some-future-adapter");
      // The typed error is surfaced AS DATA (fail-soft is the documented
      // choice) — code, reason and registry ids all inspectable.
      expect(WebFlixError.is(resolved.resolution.error)).toBe(true);
      expect(resolved.resolution.error.code).toBe(ErrorCode.IntelligenceAdapterSelectionInvalid);
      expect(resolved.resolution.error.reason).toContain("no longer available");
      expect(resolved.resolution.error.context["registryIds"]).toEqual([BUILT_IN_RANKER_ID]);
    }
  });

  it("resolving twice is stable (no drift without a store change)", async () => {
    const store = new InMemoryRankerSelectionStore();
    const resolve = new ResolveSelectedRanker({
      registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
      store,
    });
    expect((await resolve.resolve()).resolution.kind).toBe("default");
    expect((await resolve.resolve()).resolution.kind).toBe("default");
  });
});

describe("SetRankerAdapterSelection / ClearRankerAdapterSelection", () => {
  const deps = () => {
    const store = new InMemoryRankerSelectionStore();
    return {
      store,
      set: new SetRankerAdapterSelection({
        registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
        store,
        clock: PINNED_CLOCK,
      }),
      clear: new ClearRankerAdapterSelection({ store }),
      resolve: new ResolveSelectedRanker({
        registry: DEFAULT_RANKER_ADAPTER_REGISTRY,
        store,
      }),
    };
  };

  it("set stores the explicit selection with clock-stamped provenance", async () => {
    const { set, store } = deps();
    const selection = await set.set(BUILT_IN_RANKER_ID);
    expect(selection).toEqual({
      adapterId: BUILT_IN_RANKER_ID,
      selectedAt: "2026-10-11T09:30:00.000Z",
    });
    expect(await store.get()).toEqual(selection);
  });

  it("set REJECTS unknown ids with the typed error (only registry-known ids selectable)", async () => {
    const { set, store } = deps();
    const wfe = await expectWebFlixError(
      () => set.set("webflix.not-in-registry"),
      ErrorCode.IntelligenceAdapterSelectionInvalid,
    );
    expect(wfe.reason).toContain("unknown ranker adapter id");
    expect(wfe.context["registryIds"]).toEqual([BUILT_IN_RANKER_ID]);
    // Nothing was written — the store is untouched.
    expect(await store.get()).toBeNull();
  });

  it("clear deletes the selection and resolve honestly reports `default` afterwards (never an error state)", async () => {
    const d = deps();
    await d.set.set(BUILT_IN_RANKER_ID);
    expect(await d.clear.clear()).toBe(true);
    expect((await d.resolve.resolve()).resolution.kind).toBe("default");
    // Clearing again is a no-op that reports false — no error state.
    expect(await d.clear.clear()).toBe(false);
  });

  it("put replaces the selection wholesale (the CURRENT choice)", async () => {
    const d = deps();
    await d.set.set(BUILT_IN_RANKER_ID);
    await d.set.set(BUILT_IN_RANKER_ID); // replace with the same id: latest wins
    const stored = await d.store.get();
    expect(stored?.adapterId).toBe(BUILT_IN_RANKER_ID);
    expect((await d.resolve.resolve()).resolution.kind).toBe("selected");
  });
});
