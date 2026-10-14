// @vitest-environment jsdom
//
// SearchScreen federated-coverage tests (P7-COMPOSE-1 — the WF-009 surface
// half, mounting the MERGED P7-SEARCH-1 contract shapes AS-IS). The jsdom
// docblock above is mandatory: the package-local vitest.config.ts defaults
// to the node environment, and these tests need a DOM.
// Run from the package: pnpm --filter webflix-shell test:components
//
// Pins, honestly:
// - the federated phase carries the FederatedSearchResult VERBATIM (the
//   mapper adds nothing, recomputes nothing, re-ranks nothing);
// - federatedSourceRows flattens EVERY coverage row (one row per fanned-out
//   source, stable order) with the outcome's own reason for every non-ok
//   class — ok is the only reason-less class, by contract;
// - the summary line is a plain tally (counts, never a completeness claim);
// - the screen renders the merged items with their contributing sources AND
//   every per-source row — a FAILED source is NEVER hidden: partial-failure
//   keeps BOTH its salvaged count and its reason, timeout/auth-required/
//   unsupported keep their reasons, and a no-merged-items federation still
//   lists every source's answer;
// - FIXTURE-ONLY: the result fixtures are shell-local literals shaped like
//   the contract's FederatedSearchResult (the application lane's own
//   battery pins the use case that PRODUCES such results); no network, no
//   provider, no store — the screen renders exactly what it is handed.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  SearchScreen,
  federatedCoverageSummaryLine,
  federatedSearchState,
  federatedSourceRows,
} from "../src/index";
import type { CatalogItem, FederatedSearchResult } from "webflix-contracts";
import type { SearchBudgetView } from "../src/index";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

// ---------- fixtures (FederatedSearchResult-shaped, contract-valid) ----------

const DONUT: CatalogItem = {
  id: "yt-donut",
  title: "Blender donut tutorial",
  providerId: "youtube",
  mediaKind: "video",
  assets: [],
  metadata: {},
};

const SALVAGED: CatalogItem = {
  id: "rd-thread",
  title: "Cosmic rivers discussion",
  providerId: "reddit",
  mediaKind: "video",
  assets: [],
  metadata: {},
};

/** Five sources, one per outcome class — the never-hide worst case. */
const FEDERATED_RESULT: FederatedSearchResult = {
  outcomes: {
    "fixture-youtube-like": { status: "ok", items: [DONUT], nextCursor: "p2" },
    "fixture-reddit-like": {
      status: "partial-failure",
      reason: "the source gave up mid-page",
      items: [SALVAGED],
    },
    "fixture-auth-gated": { status: "auth-required", reason: "connect the account first" },
    "fixture-slow-like": { status: "timeout", reason: "exceeded the per-source budget of 4000ms" },
    "fixture-unsupported-like": {
      status: "unsupported",
      reason: "this source has no search surface",
    },
  },
  coverage: [
    { source: "fixture-youtube-like", outcome: "ok", counts: { returned: 1 }, elapsedMs: 12 },
    {
      source: "fixture-reddit-like",
      outcome: "partial-failure",
      counts: { returned: 1 },
      elapsedMs: 40,
    },
    {
      source: "fixture-auth-gated",
      outcome: "auth-required",
      counts: { returned: 0 },
      elapsedMs: 3,
    },
    { source: "fixture-slow-like", outcome: "timeout", counts: { returned: 0 }, elapsedMs: 4000 },
    {
      source: "fixture-unsupported-like",
      outcome: "unsupported",
      counts: { returned: 0 },
      elapsedMs: 0,
    },
  ],
  items: [
    { item: DONUT, sources: ["fixture-youtube-like"] },
    { item: SALVAGED, sources: ["fixture-reddit-like"] },
  ],
};

const BUDGET: SearchBudgetView = {
  state: "ok",
  unitsRemainingToday: 90,
  unitsLimitToday: 100,
  searchCallsRemainingToday: 95,
  providerReportedExhaustion: false,
};

// ---------- the states.ts helpers ----------

describe("federatedSearchState (the additive SearchState member)", () => {
  it("carries the result verbatim — nothing added, recomputed or re-ranked", () => {
    const state = federatedSearchState("donut", FEDERATED_RESULT, BUDGET);
    expect(state).toEqual({
      phase: "federated",
      query: "donut",
      result: FEDERATED_RESULT,
      budget: BUDGET,
    });
  });

  it("budget stays optional (absent means absent, never invented)", () => {
    const state = federatedSearchState("donut", FEDERATED_RESULT);
    expect("budget" in state && state.budget).toBeUndefined();
  });
});

describe("federatedSourceRows (the never-hide flattening)", () => {
  it("renders one row per coverage entry, in the stable fan-out order", () => {
    const rows = federatedSourceRows(FEDERATED_RESULT);
    expect(rows.map((row) => row.source)).toEqual([
      "fixture-youtube-like",
      "fixture-reddit-like",
      "fixture-auth-gated",
      "fixture-slow-like",
      "fixture-unsupported-like",
    ]);
    expect(rows).toHaveLength(FEDERATED_RESULT.coverage.length);
  });

  it("carries each row's tallies and elapsed time verbatim", () => {
    const rows = federatedSourceRows(FEDERATED_RESULT);
    expect(rows[0]).toEqual({
      source: "fixture-youtube-like",
      outcome: "ok",
      returned: 1,
      elapsedMs: 12,
      reason: null,
    });
    expect(rows[3]?.elapsedMs).toBe(4000);
  });

  it("surfaces the outcome's OWN reason for every non-ok class; ok alone carries none", () => {
    const rows = federatedSourceRows(FEDERATED_RESULT);
    expect(rows[0]?.reason).toBeNull();
    expect(rows[1]?.reason).toBe("the source gave up mid-page");
    expect(rows[2]?.reason).toBe("connect the account first");
    expect(rows[3]?.reason).toBe("exceeded the per-source budget of 4000ms");
    expect(rows[4]?.reason).toBe("this source has no search surface");
  });

  it("never drops a source even from a smuggled-in result missing its outcomes entry", () => {
    const smuggled = {
      ...FEDERATED_RESULT,
      outcomes: { "fixture-youtube-like": FEDERATED_RESULT.outcomes["fixture-youtube-like"] },
    } as unknown as FederatedSearchResult;
    const rows = federatedSourceRows(smuggled);
    expect(rows).toHaveLength(5);
    expect(rows[4]?.outcome).toBe("unsupported");
    expect(rows[4]?.reason).toBeNull(); // no fabricated reason either
  });
});

describe("federatedCoverageSummaryLine (the plain tally)", () => {
  it("tallies per outcome class with the merged-item count", () => {
    expect(federatedCoverageSummaryLine(FEDERATED_RESULT)).toBe(
      "Source coverage: 5 sources answered — 1 ok, 1 partial-failure, 1 timeout, 1 auth-required, 1 unsupported · 2 merged items.",
    );
  });

  it("omits classes with zero sources and pluralizes a single source honestly", () => {
    const single: FederatedSearchResult = {
      outcomes: { solo: { status: "ok", items: [] } },
      coverage: [{ source: "solo", outcome: "ok", counts: { returned: 0 }, elapsedMs: 5 }],
      items: [],
    };
    expect(federatedCoverageSummaryLine(single)).toBe(
      "Source coverage: 1 source answered — 1 ok · 0 merged items.",
    );
  });
});

// ---------- the SearchScreen federated phase ----------

describe("SearchScreen: the federated coverage view (WF-009 surface)", () => {
  it("renders the summary line and every per-source outcome row — failures included", () => {
    render(<SearchScreen state={federatedSearchState("donut", FEDERATED_RESULT)} />);
    expect(screen.getByTestId("search-federated")).toBeTruthy();
    expect(screen.getByTestId("search-federated-summary").textContent).toBe(
      federatedCoverageSummaryLine(FEDERATED_RESULT),
    );
    for (const source of [
      "fixture-youtube-like",
      "fixture-reddit-like",
      "fixture-auth-gated",
      "fixture-slow-like",
      "fixture-unsupported-like",
    ]) {
      expect(screen.getByTestId(`search-federated-source-${source}`)).toBeTruthy();
    }
  });

  it("a FAILED source is NEVER hidden: each non-ok row carries its honest reason", () => {
    render(<SearchScreen state={federatedSearchState("donut", FEDERATED_RESULT)} />);
    expect(
      screen.getByTestId("search-federated-source-reason-fixture-reddit-like").textContent,
    ).toContain("the source gave up mid-page");
    expect(
      screen.getByTestId("search-federated-source-reason-fixture-auth-gated").textContent,
    ).toContain("connect the account first");
    expect(
      screen.getByTestId("search-federated-source-reason-fixture-slow-like").textContent,
    ).toContain("exceeded the per-source budget of 4000ms");
    expect(
      screen.getByTestId("search-federated-source-reason-fixture-unsupported-like").textContent,
    ).toContain("this source has no search surface");
    // ok carries no reason row — the only reason-less class, by contract.
    expect(screen.queryByTestId("search-federated-source-reason-fixture-youtube-like")).toBeNull();
  });

  it("partial-failure keeps BOTH its salvaged count and its reason", () => {
    render(<SearchScreen state={federatedSearchState("donut", FEDERATED_RESULT)} />);
    const row = screen.getByTestId("search-federated-source-fixture-reddit-like");
    expect(row.textContent).toContain("partial-failure");
    expect(row.textContent).toContain("1 row returned");
    expect(row.textContent).toContain("the source gave up mid-page");
  });

  it("renders the merged items with their contributing sources; Play fires onSelectItem", () => {
    const onSelectItem = vi.fn();
    render(
      <SearchScreen
        state={federatedSearchState("donut", FEDERATED_RESULT)}
        onSelectItem={onSelectItem}
      />,
    );
    const items = screen.getByTestId("search-federated-items");
    expect(items.textContent).toContain("Blender donut tutorial");
    expect(items.textContent).toContain("from fixture-youtube-like");
    expect(items.textContent).toContain("from fixture-reddit-like");
    fireEvent.click(screen.getByRole("button", { name: "Play Blender donut tutorial" }));
    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith(DONUT);
  });

  it("an empty merged view still lists EVERY source's answer — never a silent blank", () => {
    const empty: FederatedSearchResult = {
      outcomes: {
        ok1: { status: "ok", items: [] },
        timed: { status: "timeout", reason: "over budget" },
      },
      coverage: [
        { source: "ok1", outcome: "ok", counts: { returned: 0 }, elapsedMs: 4 },
        { source: "timed", outcome: "timeout", counts: { returned: 0 }, elapsedMs: 4000 },
      ],
      items: [],
    };
    render(<SearchScreen state={federatedSearchState("void", empty)} />);
    expect(screen.getByTestId("search-federated-no-items").textContent).toContain(
      "no merged items",
    );
    expect(screen.getByTestId("search-federated-source-ok1")).toBeTruthy();
    expect(screen.getByTestId("search-federated-source-timed")).toBeTruthy();
    expect(screen.getByTestId("search-federated-source-reason-timed").textContent).toContain(
      "over budget",
    );
  });

  it("the budget line rides the federated phase when a budget view is attached", () => {
    render(<SearchScreen state={federatedSearchState("donut", FEDERATED_RESULT, BUDGET)} />);
    expect(screen.getByTestId("search-budget").textContent).toContain("95 searches left today");
  });
});
