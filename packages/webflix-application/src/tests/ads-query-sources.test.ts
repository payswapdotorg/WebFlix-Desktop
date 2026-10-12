/**
 * ads.querySources — the §2.6 transparency-source query use case tests
 * (P5-SOURCES scope row 3): the job semantics (kind/provenance/payload,
 * boundary + adapter-boundary cooperative cancellation), THE STATE IS
 * THE ANSWER (querying the blocked GATC adapter SUCCEEDS with the
 * blocked state + reason; querying a pending adapter SUCCEEDS with the
 * pending state naming the path — the states are DATA, never job
 * failures), the report carries the manifest + adapter version +
 * row-tally counts alongside, caller defects are typed
 * ads/source-invalid BEFORE the job exists (blank id, unknown id — the
 * error names the registry's KNOWN ids — and a malformed query), the
 * ok/unavailable authorized-path machinery is exercised through the
 * LABELED fixture-replay double (no real source access), mid-run
 * cancellation maps the adapter's typed cancelled rejection onto the
 * job's cancelled transition, infrastructure failures stamp FAILED and
 * rethrow through AdsQuerySourcesJobError (cause code intact), the
 * caller's input is NEVER MUTATED (deep-equal), and the determinism
 * corpus pins the three real sources' reports byte-identically
 * (sha256, one pin per source).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TransparencyObservation } from "webflix-contracts";
import {
  ADS_QUERY_SOURCES_JOB_KIND,
  ADS_QUERY_SOURCES_SEAM_ID,
  AdsQuerySourcesJobError,
  DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
  FixtureReplayTransparencySource,
  GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
  META_AD_LIBRARY_SOURCE_ID,
  META_AD_LIBRARY_MANIFEST,
  QueryTransparencySources,
  TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
  createStaticTransparencySourceRegistry,
  type QueryTransparencySourcesDeps,
} from "../index";

const NOW = new Date("2026-10-12T06:00:00Z");

function makeDeps(
  overrides: Partial<QueryTransparencySourcesDeps> = {},
): QueryTransparencySourcesDeps {
  let seq = 0;
  return {
    registry: DEFAULT_TRANSPARENCY_SOURCE_REGISTRY,
    clock: { now: () => NOW },
    generateId: () => `job-${(seq += 1)}`,
    ...overrides,
  };
}

/** The LABELED double's manifest fixture (a registry-known "fixture-source"). */
const FIXTURE_MANIFEST = { ...META_AD_LIBRARY_MANIFEST, source: "fixture-source" };

/** A registry over the LABELED double (the authorized-path machinery, hermetic). */
function doubleRegistry(
  result: ConstructorParameters<typeof FixtureReplayTransparencySource>[0]["result"],
  extra: Partial<ConstructorParameters<typeof FixtureReplayTransparencySource>[0]> = {},
): {
  registry: ReturnType<typeof createStaticTransparencySourceRegistry>;
  source: FixtureReplayTransparencySource;
} {
  const source = new FixtureReplayTransparencySource({
    manifest: FIXTURE_MANIFEST,
    result,
    ...extra,
  });
  const registry = createStaticTransparencySourceRegistry([
    { manifest: FIXTURE_MANIFEST, adapter: source },
  ]);
  return { registry, source };
}

const OBSERVATION: TransparencyObservation = {
  sourceAdId: "999123",
  advertiser: { sourceAdvertiserId: "page-77", names: ["Acme Streaming"] },
  creativeText: "Watch Acme — 50% off your first 3 months!",
  regions: ["US"],
  observedAt: NOW.toISOString(),
};

describe("ads.querySources — the state IS the answer (typed honest states as DATA)", () => {
  it("querying the BLOCKED GATC source SUCCEEDS with the blocked state + reason + manifest context", async () => {
    const deps = makeDeps();
    const { job, report } = await new QueryTransparencySources(deps).execute({
      sourceId: GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
      query: { searchTerms: "streaming offer" },
    });
    expect(job.state).toBe("succeeded"); // NOT a failure — the state is the answer
    expect(job.kind).toBe(ADS_QUERY_SOURCES_JOB_KIND);
    expect(job.cancellable).toBe(true);
    expect(job.provenance.connectorId).toBe(ADS_QUERY_SOURCES_SEAM_ID);
    expect(job.payload["sourceId"]).toBe(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID);
    expect(job.payload["searchTerms"]).toBe("streaming offer");
    expect(report).not.toBeNull();
    expect(report!.source).toBe(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID);
    expect(report!.result).toEqual({
      status: "blocked",
      reason: expect.stringContaining("no official API"),
    });
    expect(report!.manifest.accessState).toBe("blocked");
    expect(report!.manifest.source).toBe(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID);
    expect(report!.adapterVersion).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(report!.counts).toEqual({ observations: 0 });
  });

  it("querying Meta SUCCEEDS with the pending state naming the application path", async () => {
    const { job, report } = await new QueryTransparencySources(makeDeps()).execute({
      sourceId: META_AD_LIBRARY_SOURCE_ID,
      query: { searchTerms: "social issues ads" },
    });
    expect(job.state).toBe("succeeded");
    expect(report!.result.status).toBe("pending-authorization");
    if (report!.result.status === "pending-authorization") {
      expect(report!.result.reason).toContain("app review");
      expect(report!.result.reason).toContain("business verification");
    }
    expect(report!.manifest.declaredCategories).toEqual(["social issues", "elections", "politics"]);
    expect(report!.counts).toEqual({ observations: 0 });
  });

  it("querying TikTok SUCCEEDS with the pending state; a region-scoped query rides the payload", async () => {
    const { job, report } = await new QueryTransparencySources(makeDeps()).execute({
      sourceId: TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
      query: { searchTerms: "commercial content", region: "US" },
    });
    expect(job.state).toBe("succeeded");
    expect(report!.result.status).toBe("pending-authorization");
    expect(job.payload["region"]).toBe("US");
  });

  it("an OK result (the LABELED double, authorized path) carries observations + the row tally", async () => {
    const { registry } = doubleRegistry({ status: "ok", observations: [OBSERVATION] });
    const { job, report } = await new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "acme" },
    });
    expect(job.state).toBe("succeeded");
    expect(report!.result.status).toBe("ok");
    if (report!.result.status === "ok") {
      expect(report!.result.observations).toEqual([OBSERVATION]);
    }
    expect(report!.counts).toEqual({ observations: 1 });
  });

  it("an OK result with ZERO observations is the honest no-results (never padded)", async () => {
    const { registry } = doubleRegistry({ status: "ok", observations: [] });
    const { report } = await new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "acme" },
    });
    expect(report!.result.status).toBe("ok");
    expect(report!.counts).toEqual({ observations: 0 });
  });

  it("an UNAVAILABLE result is DATA too (the future transport's transient state, surfaced)", async () => {
    const { registry } = doubleRegistry({
      status: "unavailable",
      reason: "the source could not serve the query right now",
    });
    const { job, report } = await new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "acme" },
    });
    expect(job.state).toBe("succeeded");
    expect(report!.result).toEqual({
      status: "unavailable",
      reason: "the source could not serve the query right now",
    });
    expect(report!.counts).toEqual({ observations: 0 });
  });
});

describe("ads.querySources — caller defects (typed ads/source-invalid, BEFORE the job exists)", () => {
  const cases: readonly [string, unknown][] = [
    ["a blank source id", { sourceId: "   ", query: { searchTerms: "x" } }],
    ["a non-string source id", { sourceId: 42, query: { searchTerms: "x" } }],
    ["an unknown source id", { sourceId: "no-such-source", query: { searchTerms: "x" } }],
    [
      "a blank searchTerms query",
      { sourceId: META_AD_LIBRARY_SOURCE_ID, query: { searchTerms: "" } },
    ],
    [
      "a malformed query shape",
      { sourceId: META_AD_LIBRARY_SOURCE_ID, query: { searchTerms: "x", region: "usa" } },
    ],
  ];
  for (const [name, input] of cases) {
    it(`rejects ${name} with the typed error, before the job exists`, async () => {
      await expect(
        new QueryTransparencySources(makeDeps()).execute(input as never),
      ).rejects.toSatisfy(
        (err: unknown) =>
          WebFlixError.is(err) &&
          err.code === ErrorCode.AdsSourceInvalid &&
          !(err instanceof AdsQuerySourcesJobError),
      );
    });
  }

  it("the unknown-source error NAMES the registry's known ids (the honest recovery hint)", async () => {
    try {
      await new QueryTransparencySources(makeDeps()).execute({
        sourceId: "no-such-source",
        query: { searchTerms: "x" },
      });
      expect.unreachable("the unknown source id must throw");
    } catch (err) {
      const typed = err as WebFlixError;
      expect(typed.code).toBe(ErrorCode.AdsSourceInvalid);
      expect(typed.reason).toContain(GOOGLE_ADS_TRANSPARENCY_SOURCE_ID);
      expect(typed.reason).toContain(META_AD_LIBRARY_SOURCE_ID);
      expect(typed.reason).toContain(TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID);
    }
  });
});

describe("ads.querySources — cancellation, both phases", () => {
  it("BOUNDARY: an already-aborted signal transitions queued -> cancelled, adapter never touched", async () => {
    const { registry, source } = doubleRegistry({ status: "ok", observations: [OBSERVATION] });
    const controller = new AbortController();
    controller.abort();
    const { job, report } = await new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "x" },
      signal: controller.signal,
    });
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(source.recordedCalls()).toHaveLength(0); // never touched
  });

  it("MID-RUN: an adapter's typed cancelled rejection maps onto the job's cancelled transition", async () => {
    const source = new FixtureReplayTransparencySource({
      manifest: FIXTURE_MANIFEST,
      result: { status: "ok", observations: [OBSERVATION] },
      delayMs: 50,
    });
    const registry = createStaticTransparencySourceRegistry([
      { manifest: FIXTURE_MANIFEST, adapter: source },
    ]);
    const controller = new AbortController();
    const run = new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "x" },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    const { job, report } = await run;
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(job.lastError).toContain("cancelled");
  });

  it("MID-RUN: the checkpoint before the adapter call catches an aborted signal too", async () => {
    const { registry, source } = doubleRegistry({ status: "ok", observations: [] });
    const controller = new AbortController();
    const run = new QueryTransparencySources(makeDeps({ registry })).execute({
      sourceId: "fixture-source",
      query: { searchTerms: "x" },
      signal: controller.signal,
    });
    controller.abort(); // aborts between execute() and the checkpoint's microtask
    const { job, report } = await run;
    expect(job.state).toBe("cancelled");
    expect(report).toBeNull();
    expect(source.recordedCalls()).toHaveLength(0);
  });
});

describe("ads.querySources — infrastructure failures", () => {
  it("a non-cancelled adapter failure stamps the job FAILED and rethrows typed (cause code intact)", async () => {
    const source = new FixtureReplayTransparencySource({
      manifest: FIXTURE_MANIFEST,
      result: { status: "ok", observations: [] },
      failWith: new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason: "the wired transport exploded",
        retryable: false,
        context: {},
      }),
    });
    const registry = createStaticTransparencySourceRegistry([
      { manifest: FIXTURE_MANIFEST, adapter: source },
    ]);
    await expect(
      new QueryTransparencySources(makeDeps({ registry })).execute({
        sourceId: "fixture-source",
        query: { searchTerms: "x" },
      }),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof AdsQuerySourcesJobError)) return false;
      expect(err.job.state).toBe("failed");
      expect(err.job.lastError).toContain("the wired transport exploded");
      expect(err.code).toBe(ErrorCode.AdsSourceInvalid); // the cause's own code
      expect(err.cause).toBeInstanceOf(WebFlixError);
      return true;
    });
  });

  it("a NON-WebFlixError adapter failure wraps into the typed cause (no bare throws escape)", async () => {
    const source = new FixtureReplayTransparencySource({
      manifest: FIXTURE_MANIFEST,
      result: { status: "ok", observations: [] },
      failWith: new Error("plain boom"),
    });
    const registry = createStaticTransparencySourceRegistry([
      { manifest: FIXTURE_MANIFEST, adapter: source },
    ]);
    await expect(
      new QueryTransparencySources(makeDeps({ registry })).execute({
        sourceId: "fixture-source",
        query: { searchTerms: "x" },
      }),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof AdsQuerySourcesJobError)) return false;
      expect(err.job.state).toBe("failed");
      expect(err.code).toBe(ErrorCode.AdsSourceInvalid);
      expect(err.reason).toContain("plain boom");
      return true;
    });
  });
});

describe("ads.querySources — purity + determinism", () => {
  it("the caller's input object is NEVER mutated (deep-equal after the run)", async () => {
    const input = {
      sourceId: META_AD_LIBRARY_SOURCE_ID,
      query: { searchTerms: "streaming", region: "US" },
    };
    const before = JSON.parse(JSON.stringify(input));
    await new QueryTransparencySources(makeDeps()).execute(input);
    expect(input).toEqual(before);
  });

  it("determinism corpus: same source + query => byte-identical report (sha256-pinned)", async () => {
    const runOnce = async () => {
      const { report } = await new QueryTransparencySources(makeDeps()).execute({
        sourceId: GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
        query: { searchTerms: "corpus terms" },
      });
      return report!;
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const digest = createHash("sha256").update(JSON.stringify(first), "utf8").digest("hex");
    expect(digest).toBe(PINNED_GATC_REPORT_SHA256);
    // Input sensitivity at the job layer: a different query rides the
    // payload; the report (fixed clock + fixed ids) stays byte-identical.
    const other = await new QueryTransparencySources(makeDeps()).execute({
      sourceId: GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
      query: { searchTerms: "different terms" },
    });
    expect(other.job.payload["searchTerms"]).toBe("different terms");
    expect(JSON.stringify(other.report)).toBe(JSON.stringify(first));
  });

  it("the corpus covers the honest state spectrum across the three real sources (each pinned)", async () => {
    const pin = (value: unknown): string =>
      createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
    for (const [sourceId, pinned] of [
      [GOOGLE_ADS_TRANSPARENCY_SOURCE_ID, PINNED_GATC_REPORT_SHA256],
      [META_AD_LIBRARY_SOURCE_ID, PINNED_META_REPORT_SHA256],
      [TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID, PINNED_TIKTOK_REPORT_SHA256],
    ] as const) {
      const { report } = await new QueryTransparencySources(makeDeps()).execute({
        sourceId,
        query: { searchTerms: "corpus terms" },
      });
      expect(pin(report)).toBe(pinned);
    }
  });
});

// The pinned digests (sha256 over the JSON-serialized report, fixed clock +
// fixed job ids): they change ONLY when the seam's honest output does — the
// three real sources' reports as shipped.
const PINNED_GATC_REPORT_SHA256 =
  "3d6a2aec8b43319637fb158ce6a08ce63012ced4e5acba5613f90e65c955652e";
const PINNED_META_REPORT_SHA256 =
  "6d02d27456bd653511971a36166a96aa02068df51c61474c015c4ada3cf4c9fe";
const PINNED_TIKTOK_REPORT_SHA256 =
  "198e6bbd23c0413755bc38ae27fc519b50e2f5a0177512161b410b0791b09b3a";
