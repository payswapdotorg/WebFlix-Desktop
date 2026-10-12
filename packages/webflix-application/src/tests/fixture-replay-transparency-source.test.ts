/**
 * The LABELED fixture-replay transparency-source double's tests
 * (P5-SOURCES scope row 4) — the double carries the house label
 * ("THIS IS A TEST DOUBLE — IT DOES NO REAL SOURCE ACCESS") in its
 * module docblock, and NOTHING here touches a network: the double
 * replays a canned result for every query, records the calls for
 * assertion, honours the port's boundary cancellation contract, and —
 * via `delayMs` — the mid-run cooperative cancellation a future
 * transport adapter would surface; `failWith` injects failures for the
 * infrastructure-failure tests. These tests pin that behaviour.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TransparencyObservation } from "webflix-contracts";
import { FixtureReplayTransparencySource, META_AD_LIBRARY_MANIFEST } from "../index";

const NOW = new Date("2026-10-12T06:00:00Z");

const OBSERVATION: TransparencyObservation = {
  sourceAdId: "999123",
  advertiser: { sourceAdvertiserId: "page-77", names: ["Acme Streaming"] },
  creativeText: "Watch Acme — 50% off your first 3 months!",
  observedAt: NOW.toISOString(),
};

function makeDouble(
  extra: Partial<ConstructorParameters<typeof FixtureReplayTransparencySource>[0]> = {},
): FixtureReplayTransparencySource {
  return new FixtureReplayTransparencySource({
    manifest: { ...META_AD_LIBRARY_MANIFEST, source: "fixture-source" },
    result: { status: "ok", observations: [OBSERVATION] },
    ...extra,
  });
}

describe("the LABELED fixture-replay transparency source (test double)", () => {
  it("replays the canned result for every query — nothing is fetched, ever", async () => {
    const source = makeDouble();
    const first = await source.query({ searchTerms: "acme" });
    const second = await source.query({ searchTerms: "other terms", region: "US" });
    expect(first).toEqual({ status: "ok", observations: [OBSERVATION] });
    expect(second).toEqual(first); // the canned result, regardless of the query
  });

  it("records every call for assertion (query + boundary-abort fact)", async () => {
    const source = makeDouble();
    await source.query({ searchTerms: "one" });
    const controller = new AbortController();
    controller.abort();
    await source.query({ searchTerms: "two" }, { signal: controller.signal }).catch(() => {});
    expect(source.recordedCalls()).toEqual([
      { query: { searchTerms: "one" }, abortedAtBoundary: false },
      { query: { searchTerms: "two" }, abortedAtBoundary: true },
    ]);
  });

  it("honours the boundary cancellation contract (typed common/cancelled, no result)", async () => {
    const source = makeDouble();
    const controller = new AbortController();
    controller.abort();
    await expect(
      source.query({ searchTerms: "x" }, { signal: controller.signal }),
    ).rejects.toSatisfy((err: unknown) => WebFlixError.is(err) && err.code === ErrorCode.Cancelled);
  });

  it("delayMs + an abort DURING the wait = the mid-run typed cancelled rejection", async () => {
    const source = makeDouble({ delayMs: 60 });
    const controller = new AbortController();
    const run = source.query({ searchTerms: "x" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(run).rejects.toSatisfy(
      (err: unknown) =>
        WebFlixError.is(err) && err.code === ErrorCode.Cancelled && err.reason.includes("mid-run"),
    );
  });

  it("delayMs WITHOUT an abort completes and replays (the wait is not a cancellation)", async () => {
    const source = makeDouble({ delayMs: 5 });
    const result = await source.query({ searchTerms: "x" });
    expect(result.status).toBe("ok");
  });

  it("failWith throws the injected failure verbatim (failure injection for infra tests)", async () => {
    const boom = new Error("injected");
    const source = makeDouble({ failWith: boom });
    await expect(source.query({ searchTerms: "x" })).rejects.toBe(boom);
  });

  it("the descriptor follows the manifest (source id) with the fixture version default", () => {
    const source = makeDouble();
    expect(source.descriptor.source).toBe(source.manifest.source);
    expect(source.descriptor.version).toBe("fixture-replay");
    const versioned = makeDouble({ version: "9.9.9-test" });
    expect(versioned.descriptor.version).toBe("9.9.9-test");
  });

  it("replays non-ok states exactly (pending/blocked/unavailable canned results)", async () => {
    const pending = new FixtureReplayTransparencySource({
      manifest: { ...META_AD_LIBRARY_MANIFEST, source: "fixture-source" },
      result: { status: "pending-authorization", reason: "apply through the path" },
    });
    expect(await pending.query({ searchTerms: "x" })).toEqual({
      status: "pending-authorization",
      reason: "apply through the path",
    });
    const blocked = new FixtureReplayTransparencySource({
      manifest: { ...META_AD_LIBRARY_MANIFEST, source: "fixture-source" },
      result: { status: "blocked", reason: "no official API" },
    });
    expect(await blocked.query({ searchTerms: "x" })).toEqual({
      status: "blocked",
      reason: "no official API",
    });
  });
});
