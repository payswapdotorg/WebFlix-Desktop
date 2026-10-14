/**
 * search.federated — the P7-SEARCH-1 (WF-009) hermetic test battery.
 * FIXTURE-ONLY, ZERO NETWORK: every adapter is a labeled fixture or an
 * inline test double; no provider is contacted, no credential exists,
 * no assertion depends on wall-clock precision (the per-source budget
 * race uses a 10x delay margin; elapsed assertions ride the injected
 * clock only). The work order's test list, one block per row:
 * mixed-source paging, per-source timeout, auth-gated source,
 * no-results, partial results, unknown-source error, merge correctness
 * with duplicate provider assets across two sources — plus the honesty
 * pins around them (states are DATA, coverage never hides a source,
 * caller defects reject typed search/source-invalid before any adapter
 * is touched, cancellation both phases, the caller's input never
 * mutated, deterministic merged view).
 */
import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  FederatedSearchResultSchema,
  SearchError,
  SearchErrorCode,
  SearchOutcomeSchema,
  SearchRequestSchema,
  WebFlixError,
} from "webflix-contracts";
import type { CatalogItem, SearchOutcome, SearchRequest } from "webflix-contracts";
import {
  DEFAULT_SEARCH_SOURCE_TIMEOUT_MS,
  FederatedSearch,
  FixtureSearchSource,
  FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID,
  FIXTURE_REDDIT_LIKE_SOURCE_ID,
  FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID,
  FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR,
  FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
  createDefaultFixtureSearchRegistry,
  createRedditLikeSearchFixture,
  createStaticSearchSourceRegistry,
  createUnsupportedSearchFixture,
  createYouTubeLikeSearchFixture,
  validateFederatedSearchInput,
} from "../index";
import type { FederatedSearchDeps, SearchSourceRegistry } from "../index";
import type { ClockPort, SearchSourcePort } from "../index";

const NOW = new Date("2026-10-14T06:00:00Z");

/** The fixed test clock — no time ever passes (elapsedMs is honestly 0). */
function fixedClock(): ClockPort {
  return { now: () => NOW };
}

/** The stepping test clock — every now() call advances the given step (deterministic non-zero elapsed). */
function steppingClock(stepMs: number): ClockPort {
  let at = NOW.getTime();
  return { now: () => new Date((at += stepMs)) };
}

function makeDeps(overrides: Partial<FederatedSearchDeps> = {}): FederatedSearchDeps {
  return {
    registry: createDefaultFixtureSearchRegistry(),
    clock: fixedClock(),
    ...overrides,
  };
}

/** A minimal contract-valid catalog item for the inline doubles. */
function okItem(id: string, providerId: string, assetId: string): CatalogItem {
  return {
    id,
    providerId,
    title: `item ${id}`,
    mediaKind: "video",
    assets: [{ assetId, kind: "embed", reference: `https://example.com/${assetId}` }],
    metadata: {},
  };
}

/** Captures a rejection as a value (assertions on the typed error follow). */
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return new Error("expected the call to reject, but it resolved");
  } catch (err) {
    return err;
  }
}

/** Asserts the value is a SearchError carrying the lane's one code (never a bare Error). */
function assertSourceInvalid(value: unknown): SearchError {
  expect(SearchError.is(value)).toBe(true);
  if (!SearchError.is(value)) throw new Error("expected a SearchError");
  expect(value.code).toBe("search/source-invalid");
  expect(value.retryable).toBe(false);
  return value;
}

describe("search contracts — the access states are DATA (schema pins)", () => {
  it("SearchOutcome accepts all five honest states, items optional only where the state says so", () => {
    const item = okItem("i1", "p1", "a1");
    expect(
      SearchOutcomeSchema.safeParse({ status: "ok", items: [item], nextCursor: "next" }).success,
    ).toBe(true);
    expect(SearchOutcomeSchema.safeParse({ status: "ok", items: [] }).success).toBe(true);
    expect(
      SearchOutcomeSchema.safeParse({
        status: "partial-failure",
        reason: "the source gave up mid-page",
        items: [item],
      }).success,
    ).toBe(true);
    expect(
      SearchOutcomeSchema.safeParse({ status: "timeout", reason: "over budget" }).success,
    ).toBe(true);
    expect(
      SearchOutcomeSchema.safeParse({ status: "auth-required", reason: "sign in first" }).success,
    ).toBe(true);
    expect(
      SearchOutcomeSchema.safeParse({ status: "unsupported", reason: "no search surface" }).success,
    ).toBe(true);
    // A no-reason failure state or an ok with junk items is NOT a valid outcome.
    expect(SearchOutcomeSchema.safeParse({ status: "timeout" }).success).toBe(false);
    expect(SearchOutcomeSchema.safeParse({ status: "ok", items: "nope" }).success).toBe(false);
  });

  it("SearchRequest rejects blank queries, blank cursor keys and out-of-bounds limits", () => {
    expect(SearchRequestSchema.safeParse({ query: "  " }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ query: "cosmic rivers" }).success).toBe(true);
    expect(
      SearchRequestSchema.safeParse({ query: "x", cursors: { "fixture-youtube-like": "p2" } })
        .success,
    ).toBe(true);
    expect(SearchRequestSchema.safeParse({ query: "x", cursors: { "": "p2" } }).success).toBe(
      false,
    );
    expect(SearchRequestSchema.safeParse({ query: "x", limits: { s: 0 } }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ query: "x", limits: { s: 501 } }).success).toBe(false);
    expect(SearchRequestSchema.safeParse({ query: "x", limits: { s: 25 } }).success).toBe(true);
  });

  it("FederatedSearchResult REJECTS a result that hides a source or contradicts its outcome class", () => {
    const okOutcome: SearchOutcome = { status: "ok", items: [] };
    const timeoutOutcome: SearchOutcome = { status: "timeout", reason: "over budget" };
    const base = {
      outcomes: { "src-a": okOutcome, "src-b": timeoutOutcome },
      coverage: [
        { source: "src-a", outcome: "ok", counts: { returned: 0 }, elapsedMs: 1 },
        { source: "src-b", outcome: "timeout", counts: { returned: 0 }, elapsedMs: 5 },
      ],
      items: [],
    } as const;
    expect(FederatedSearchResultSchema.safeParse(base).success).toBe(true);
    // Hides the timed-out source from coverage.
    const hidden = { ...base, coverage: [base.coverage[0]] } as const;
    expect(FederatedSearchResultSchema.safeParse(hidden).success).toBe(false);
    // Coverage row exists but claims a class the outcome contradicts.
    const lied = {
      ...base,
      coverage: [
        base.coverage[0],
        { source: "src-b", outcome: "ok", counts: { returned: 0 }, elapsedMs: 5 },
      ],
    } as const;
    expect(FederatedSearchResultSchema.safeParse(lied).success).toBe(false);
    // An outcomes entry with no coverage row at all.
    const orphan = { ...base, outcomes: { ...base.outcomes, "src-c": okOutcome } } as const;
    expect(FederatedSearchResultSchema.safeParse(orphan).success).toBe(false);
  });

  it("the ONE rejecting error code is search/source-invalid, on the lane's own typed vocabulary", () => {
    expect(SearchErrorCode.SourceInvalid).toBe("search/source-invalid");
    const error = new SearchError({
      code: SearchErrorCode.SourceInvalid,
      reason: "unknown search source id",
      retryable: false,
      context: { known: ["a"] },
    });
    expect(SearchError.is(error)).toBe(true);
    expect(error.code).toBe("search/source-invalid");
    expect(error.retryable).toBe(false);
    expect(error.toJSON()).toEqual({
      code: "search/source-invalid",
      reason: "unknown search source id",
      retryable: false,
      context: { known: ["a"] },
    });
    expect(SearchError.is(new Error("no"))).toBe(false);
  });
});

describe("search.federated — fan-out, budgets, honest coverage", () => {
  it("fans out CONCURRENTLY: two sources that each wait for the other to start both answer", async () => {
    // The rendezvous proof: a sequential fan-out would deadlock (each
    // source's search awaits the other's first tick); only a concurrent
    // fan-out lets both proceed. Zero wall-clock assertions.
    let releaseA!: () => void;
    let releaseB!: () => void;
    const aBegan = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const bBegan = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const sourceA: SearchSourcePort = {
      descriptor: { source: "rendezvous-a", version: "test" },
      async search() {
        releaseA();
        await bBegan;
        return { status: "ok", items: [] };
      },
    };
    const sourceB: SearchSourcePort = {
      descriptor: { source: "rendezvous-b", version: "test" },
      async search() {
        releaseB();
        await aBegan;
        return { status: "ok", items: [] };
      },
    };
    const result = await new FederatedSearch(
      makeDeps({ registry: createStaticSearchSourceRegistry([sourceA, sourceB]) }),
    ).execute({ request: { query: "rendezvous" } });
    expect(Object.keys(result.outcomes).sort()).toEqual(["rendezvous-a", "rendezvous-b"]);
  });

  it("every registered source answers in one result: ok pages, unsupported and auth-gated as DATA", async () => {
    const result = await new FederatedSearch(makeDeps()).execute({
      request: { query: "cosmic rivers" },
    });
    expect(Object.keys(result.outcomes).sort()).toEqual(
      [
        FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
        FIXTURE_REDDIT_LIKE_SOURCE_ID,
        FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID,
        FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID,
      ].sort(),
    );
    const youtube = result.outcomes[FIXTURE_YOUTUBE_LIKE_SOURCE_ID]!;
    expect(youtube.status).toBe("ok");
    if (youtube.status === "ok") {
      expect(youtube.items.map((item) => item.id)).toEqual([
        "yt:video-1",
        "yt:video-2",
        "yt:video-3",
      ]);
      expect(youtube.nextCursor).toBe(FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR);
    }
    const reddit = result.outcomes[FIXTURE_REDDIT_LIKE_SOURCE_ID]!;
    expect(reddit.status).toBe("ok");
    const unsupported = result.outcomes[FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID]!;
    expect(unsupported.status).toBe("unsupported");
    if (unsupported.status === "unsupported") {
      expect(unsupported.reason).toContain("does not support search");
    }
    const authGated = result.outcomes[FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID]!;
    expect(authGated.status).toBe("auth-required");
    if (authGated.status === "auth-required") {
      expect(authGated.reason).toContain("sign in");
    }
    // Coverage: one row per fanned-out source, in registry order, classes
    // agreeing with the outcomes, honest tallies, fixed-clock elapsed 0.
    expect(result.coverage.map((row) => [row.source, row.outcome])).toEqual([
      [FIXTURE_YOUTUBE_LIKE_SOURCE_ID, "ok"],
      [FIXTURE_REDDIT_LIKE_SOURCE_ID, "ok"],
      [FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID, "unsupported"],
      [FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID, "auth-required"],
    ]);
    expect(result.coverage.map((row) => row.counts)).toEqual([
      { returned: 3 },
      { returned: 3 },
      { returned: 0 },
      { returned: 0 },
    ]);
    expect(result.coverage.every((row) => row.elapsedMs === 0)).toBe(true);
    // The whole result satisfies the never-hide contract shape.
    expect(FederatedSearchResultSchema.safeParse(result).success).toBe(true);
  });

  it("mixed-source paging: the cursor rides to ITS source only; the others answer their first page", async () => {
    const youtube = createYouTubeLikeSearchFixture();
    const registry = createStaticSearchSourceRegistry([youtube, createRedditLikeSearchFixture()]);
    const result = await new FederatedSearch(makeDeps({ registry })).execute({
      request: {
        query: "cosmic rivers",
        cursors: { [FIXTURE_YOUTUBE_LIKE_SOURCE_ID]: FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR },
      },
    });
    const ytOutcome = result.outcomes[FIXTURE_YOUTUBE_LIKE_SOURCE_ID]!;
    expect(ytOutcome.status).toBe("ok");
    if (ytOutcome.status === "ok") {
      expect(ytOutcome.items.map((item) => item.id)).toEqual(["yt:video-4", "yt:video-5"]);
      expect(ytOutcome.nextCursor).toBeUndefined(); // the honest end of results
    }
    const redditOutcome = result.outcomes[FIXTURE_REDDIT_LIKE_SOURCE_ID]!;
    expect(redditOutcome.status).toBe("ok");
    if (redditOutcome.status === "ok") {
      expect(redditOutcome.items).toHaveLength(3); // no cursor for it = its first page
    }
    // The cursor reached the youtube-like adapter inside the request, verbatim.
    const calls = youtube.recordedCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.request.cursors).toEqual({
      [FIXTURE_YOUTUBE_LIKE_SOURCE_ID]: FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR,
    });
  });

  it("per-source limits truncate ONLY the source they name", async () => {
    const result = await new FederatedSearch(
      makeDeps({ registry: createDefaultFixtureSearchRegistry() }),
    ).execute({
      request: { query: "cosmic rivers", limits: { [FIXTURE_YOUTUBE_LIKE_SOURCE_ID]: 1 } },
    });
    const limitedYt = result.outcomes[FIXTURE_YOUTUBE_LIKE_SOURCE_ID]!;
    expect(limitedYt.status).toBe("ok");
    if (limitedYt.status === "ok") expect(limitedYt.items).toHaveLength(1);
    const limitedReddit = result.outcomes[FIXTURE_REDDIT_LIKE_SOURCE_ID]!;
    expect(limitedReddit.status).toBe("ok");
    if (limitedReddit.status === "ok") expect(limitedReddit.items).toHaveLength(3);
    expect(result.coverage[0]!.counts).toEqual({ returned: 1 });
    expect(result.coverage[1]!.counts).toEqual({ returned: 3 });
  });

  it("per-source timeout: an over-budget source answers timeout, its late rows discarded, never hidden", async () => {
    const slow = new FixtureSearchSource({
      source: "slow-fixture",
      delayMs: 80,
      responses: [
        { outcome: { status: "ok", items: [okItem("late-1", "slow-provider", "slow-embed-1")] } },
      ],
    });
    const fast = new FixtureSearchSource({
      source: "fast-fixture",
      responses: [{ outcome: { status: "ok", items: [okItem("fast-1", "fast", "fast-1")] } }],
    });
    const result = await new FederatedSearch(
      makeDeps({
        registry: createStaticSearchSourceRegistry([slow, fast]),
        clock: steppingClock(10),
      }),
    ).execute({ request: { query: "slow vs fast" }, timeoutMs: 5 });
    const slowOutcome = result.outcomes["slow-fixture"]!;
    expect(slowOutcome.status).toBe("timeout");
    if (slowOutcome.status === "timeout") {
      expect(slowOutcome.reason).toContain("budget");
      expect(slowOutcome.reason).toContain("5ms");
      expect(slowOutcome.reason).toContain("discarded");
    }
    // The fast source's rows land; the slow source's late rows do NOT.
    expect(result.items.map((row) => row.item.id)).toEqual(["fast-1"]);
    // Coverage keeps the timed-out source visible with its honest class.
    expect(result.coverage.map((row) => [row.source, row.outcome])).toEqual([
      ["slow-fixture", "timeout"],
      ["fast-fixture", "ok"],
    ]);
    expect(result.coverage[0]!.counts).toEqual({ returned: 0 });
    expect(result.coverage.every((row) => row.elapsedMs > 0)).toBe(true);
  });

  it("the default timeout budget applies when the call names none (the constant is sane)", () => {
    expect(DEFAULT_SEARCH_SOURCE_TIMEOUT_MS).toBe(5000);
  });

  it("no-results: an ok source with ZERO items is the honest empty, never padded", async () => {
    const empty = new FixtureSearchSource({
      source: "empty-fixture",
      responses: [{ outcome: { status: "ok", items: [] } }],
    });
    const result = await new FederatedSearch(
      makeDeps({
        registry: createStaticSearchSourceRegistry([empty, createRedditLikeSearchFixture()]),
      }),
    ).execute({ request: { query: "nothing anywhere" } });
    const emptyOutcome = result.outcomes["empty-fixture"]!;
    expect(emptyOutcome.status).toBe("ok");
    if (emptyOutcome.status === "ok") {
      expect(emptyOutcome.items).toEqual([]);
      expect(emptyOutcome.nextCursor).toBeUndefined();
    }
    expect(result.coverage[0]!.counts).toEqual({ returned: 0 });
    // The other source's rows still land — the federation is honest per source.
    expect(result.items).toHaveLength(3);
  });

  it("partial results: a partial-failure source keeps its salvaged rows AND its coverage row", async () => {
    const partial = new FixtureSearchSource({
      source: "partial-fixture",
      responses: [
        {
          outcome: {
            status: "partial-failure",
            reason: "the source stopped serving mid-page",
            items: [okItem("salvaged-1", "partial-provider", "partial-embed-1")],
          },
        },
      ],
    });
    const result = await new FederatedSearch(
      makeDeps({
        registry: createStaticSearchSourceRegistry([partial, createUnsupportedSearchFixture()]),
      }),
    ).execute({ request: { query: "partial" } });
    const partialOutcome = result.outcomes["partial-fixture"]!;
    expect(partialOutcome.status).toBe("partial-failure");
    if (partialOutcome.status === "partial-failure") {
      expect(partialOutcome.reason).toContain("mid-page");
    }
    expect(result.coverage[0]!.counts).toEqual({ returned: 1 });
    expect(result.items.map((row) => row.item.id)).toEqual(["salvaged-1"]);
  });

  it("adapter defects are DATA too: a crashing or malformed adapter surfaces as that source's partial-failure", async () => {
    const crashing = new FixtureSearchSource({
      source: "crashing-fixture",
      failWith: new Error("transport exploded"),
    });
    const lying: SearchSourcePort = {
      descriptor: { source: "lying-fixture", version: "test" },
      async search() {
        return { status: "ok", items: "not-items" } as unknown as SearchOutcome;
      },
    };
    const typedCrashing = new FixtureSearchSource({
      source: "typed-crashing-fixture",
      failWith: new WebFlixError({
        code: ErrorCode.Unknown,
        reason: "the seam reported an unknown failure",
        retryable: false,
        context: {},
      }),
    });
    const result = await new FederatedSearch(
      makeDeps({
        registry: createStaticSearchSourceRegistry([crashing, lying, typedCrashing]),
      }),
    ).execute({ request: { query: "defects" } });
    const crash = result.outcomes["crashing-fixture"]!;
    expect(crash.status).toBe("partial-failure");
    if (crash.status === "partial-failure") expect(crash.reason).toContain("transport exploded");
    const lie = result.outcomes["lying-fixture"]!;
    expect(lie.status).toBe("partial-failure");
    if (lie.status === "partial-failure") {
      expect(lie.reason).toContain("SearchOutcome contract shape");
    }
    const typed = result.outcomes["typed-crashing-fixture"]!;
    expect(typed.status).toBe("partial-failure");
    if (typed.status === "partial-failure") {
      expect(typed.reason).toContain("common/unknown");
    }
    // No source was hidden and no row was fabricated.
    expect(result.coverage.map((row) => row.outcome)).toEqual([
      "partial-failure",
      "partial-failure",
      "partial-failure",
    ]);
    expect(result.items).toEqual([]);
  });

  it("unknown-source error: a cursor/limit key the registry does not know rejects search/source-invalid naming the KNOWN ids", async () => {
    const useCase = new FederatedSearch(makeDeps());
    const cursorError = assertSourceInvalid(
      await captureError(
        useCase.execute({ request: { query: "x", cursors: { "fixture-not-registered": "page" } } }),
      ),
    );
    expect(cursorError.reason).toContain("unknown search source id");
    expect(cursorError.reason).toContain(
      "the registry knows: fixture-youtube-like, fixture-reddit-like, " +
        "fixture-unsupported-search, fixture-auth-gated-search",
    );
    assertSourceInvalid(
      await captureError(
        useCase.execute({ request: { query: "x", limits: { "fixture-not-registered": 10 } } }),
      ),
    );
  });

  it("caller defects reject typed search/source-invalid BEFORE any adapter is touched", async () => {
    const youtube = createYouTubeLikeSearchFixture();
    const registry = createStaticSearchSourceRegistry([youtube]);
    const useCase = new FederatedSearch(makeDeps({ registry }));
    // Blank query (fails the contract shape).
    assertSourceInvalid(await captureError(useCase.execute({ request: { query: "   " } })));
    // Non-positive / non-integer timeout budget.
    assertSourceInvalid(
      await captureError(useCase.execute({ request: { query: "x" }, timeoutMs: 0 })),
    );
    assertSourceInvalid(
      await captureError(useCase.execute({ request: { query: "x" }, timeoutMs: 2.5 })),
    );
    // Nothing was fanned out: the adapter recorded ZERO calls.
    expect(youtube.recordedCalls()).toHaveLength(0);
    // The validator is exported and says the same things on its own.
    expect(() => validateFederatedSearchInput({ request: { query: "" } }, registry)).toThrow(
      SearchError,
    );
  });

  it("cancellation: the boundary never touches adapters; mid-run maps the typed cancelled rejection", async () => {
    const youtube = createYouTubeLikeSearchFixture();
    const registry = createStaticSearchSourceRegistry([youtube]);
    const useCase = new FederatedSearch(makeDeps({ registry }));
    const aborted = new AbortController();
    aborted.abort();
    const boundaryError = await captureError(
      useCase.execute({ request: { query: "x" }, signal: aborted.signal }),
    );
    expect(WebFlixError.is(boundaryError)).toBe(true);
    expect((boundaryError as WebFlixError).code).toBe(ErrorCode.Cancelled);
    expect(youtube.recordedCalls()).toHaveLength(0);

    const slow = new FixtureSearchSource({
      source: "slow-cancellable",
      delayMs: 60,
      responses: [{ outcome: { status: "ok", items: [] } }],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);
    const midRunError = await captureError(
      new FederatedSearch(makeDeps({ registry: createStaticSearchSourceRegistry([slow]) })).execute(
        { request: { query: "x" }, signal: controller.signal, timeoutMs: 5000 },
      ),
    );
    expect(WebFlixError.is(midRunError)).toBe(true);
    expect((midRunError as WebFlixError).code).toBe(ErrorCode.Cancelled);
  });

  it("the caller's request is NEVER mutated (deep-equal after the call)", async () => {
    const request: SearchRequest = {
      query: "cosmic rivers",
      cursors: { [FIXTURE_YOUTUBE_LIKE_SOURCE_ID]: FIXTURE_YOUTUBE_LIKE_PAGE_2_CURSOR },
      limits: { [FIXTURE_REDDIT_LIKE_SOURCE_ID]: 2 },
    };
    const snapshot = structuredClone(request);
    await new FederatedSearch(makeDeps()).execute({ request });
    expect(request).toEqual(snapshot);
  });

  it("the merged view is deterministic: two runs over fresh fixtures are identical", async () => {
    const run = async (): Promise<string> =>
      JSON.stringify(
        await new FederatedSearch(
          makeDeps({ registry: createDefaultFixtureSearchRegistry() }),
        ).execute({ request: { query: "cosmic rivers" } }),
      );
    expect(await run()).toBe(await run());
  });
});

describe("search.federated — merge correctness (duplicate provider assets across two sources)", () => {
  it("the same provider asset through two sources collapses into ONE row with union + evidence + both sources", async () => {
    const result = await new FederatedSearch(
      makeDeps({
        registry: createStaticSearchSourceRegistry([
          createYouTubeLikeSearchFixture(),
          createRedditLikeSearchFixture(),
        ]),
      }),
    ).execute({ request: { query: "cosmic rivers" } });

    // 3 YouTube rows + 3 Reddit rows, one cross-source duplicate = 5 merged rows.
    expect(result.items).toHaveLength(5);
    const mergedRow = result.items.find((row) => row.item.id === "yt:video-1");
    expect(mergedRow).toBeDefined();
    if (mergedRow === undefined) return;
    // Both sources contributed, in stable fan-out order.
    expect(mergedRow.sources).toEqual([
      FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
      FIXTURE_REDDIT_LIKE_SOURCE_ID,
    ]);
    // Assets union with the duplicate assetId deduped (embed + thumbnail).
    expect(mergedRow.item.assets.map((asset) => asset.assetId).sort()).toEqual([
      "yt-embed-1",
      "yt-thumb-1",
    ]);
    // MatchEvidence-driven: the merge is recorded at the provider-native
    // confidence 1 in the catalog seam's own vocabulary.
    expect(mergedRow.item.matchEvidence).toBeDefined();
    expect(mergedRow.item.matchEvidence?.confidence).toBe(1);
    expect(mergedRow.item.matchEvidence?.evidence[0]).toBe(
      "provider-native: same provider asset youtube/yt-embed-1",
    );
    expect(mergedRow.item.matchEvidence?.evidence[1]).toContain("fixture-youtube-like");
    expect(mergedRow.item.matchEvidence?.evidence[1]).toContain("fixture-reddit-like");
    // Metadata fills missing keys, never overwrites: year + imdb from the
    // YouTube row, tmdb filled from the Reddit row.
    expect(mergedRow.item.metadata.year).toBe(2024);
    expect(mergedRow.item.metadata.externalIds).toEqual({ imdb: "tt10000001", tmdb: "99001" });
    // Availability keeps the LATER observation.
    expect(mergedRow.item.availability?.observedAt).toBe("2026-10-10T00:00:00Z");
    // The Reddit discussion row itself is gone (collapsed); the podcasts remain.
    expect(result.items.map((row) => row.item.id).sort()).toEqual(
      ["yt:video-1", "yt:video-2", "yt:video-3", "rd:post-2", "rd:post-3"].sort(),
    );
  });

  it("a single-source row KEEPS the matchEvidence its source reported (absent means absent)", async () => {
    const result = await new FederatedSearch(
      makeDeps({ registry: createStaticSearchSourceRegistry([createRedditLikeSearchFixture()]) }),
    ).execute({ request: { query: "podcast" } });
    const podcast12 = result.items.find((row) => row.item.id === "rd:post-2");
    expect(podcast12?.item.matchEvidence).toEqual({
      confidence: 0.7,
      evidence: ["fixture: provider-reported match for wfw 12"],
    });
    expect(
      result.items.find((row) => row.item.id === "rd:post-3")?.item.matchEvidence,
    ).toBeUndefined();
    // Three distinct single-source rows, each attributed to its one source.
    expect(result.items.map((row) => row.sources)).toEqual([
      [FIXTURE_REDDIT_LIKE_SOURCE_ID],
      [FIXTURE_REDDIT_LIKE_SOURCE_ID],
      [FIXTURE_REDDIT_LIKE_SOURCE_ID],
    ]);
  });

  it("duplicate provider assets WITHIN one source collapse too (sources stays single)", async () => {
    const double = new FixtureSearchSource({
      source: "self-duplicating",
      responses: [
        {
          outcome: {
            status: "ok",
            items: [
              okItem("dup-a", "same-provider", "shared-embed"),
              okItem("dup-b", "same-provider", "shared-embed"),
            ],
          },
        },
      ],
    });
    const result = await new FederatedSearch(
      makeDeps({ registry: createStaticSearchSourceRegistry([double]) }),
    ).execute({ request: { query: "duplicates" } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.item.id).toBe("dup-a"); // first-seen row is the target
    expect(result.items[0]!.sources).toEqual(["self-duplicating"]);
    expect(result.items[0]!.item.matchEvidence?.confidence).toBe(1);
    expect(result.items[0]!.item.matchEvidence?.evidence[1]).toContain(
      "rows from sources self-duplicating merged",
    );
  });
});

describe("search.federated — the registry (static data + pure lookups)", () => {
  it("builds a registry with stable order and get-or-null lookups", () => {
    const registry: SearchSourceRegistry = createDefaultFixtureSearchRegistry();
    expect(registry.list().map((adapter) => adapter.descriptor.source)).toEqual([
      FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
      FIXTURE_REDDIT_LIKE_SOURCE_ID,
      FIXTURE_UNSUPPORTED_SEARCH_SOURCE_ID,
      FIXTURE_AUTH_GATED_SEARCH_SOURCE_ID,
    ]);
    expect(registry.get(FIXTURE_YOUTUBE_LIKE_SOURCE_ID)?.descriptor.source).toBe(
      FIXTURE_YOUTUBE_LIKE_SOURCE_ID,
    );
    expect(registry.get("not-registered")).toBeNull();
  });

  it("rejects malformed seeds with typed search/source-invalid (empty, duplicate, no search)", () => {
    expect(() => createStaticSearchSourceRegistry([])).toThrow(SearchError);
    expect(() =>
      createStaticSearchSourceRegistry([
        createYouTubeLikeSearchFixture(),
        createYouTubeLikeSearchFixture(),
      ]),
    ).toThrow(/duplicate search-source id/);
    const notAnAdapter = {
      descriptor: { source: "broken", version: "test" },
    } as unknown as SearchSourcePort;
    expect(() => createStaticSearchSourceRegistry([notAnAdapter])).toThrow(/must implement search/);
  });
});
