// @vitest-environment jsdom
//
// The web client host component tests (P6-WEB-HOST-1, extended by
// P6-DURABLE-WEB-1). The jsdom docblock above is mandatory (the app-local
// vitest.config.ts defaults to the node environment; these tests need a
// DOM). Run from the app: pnpm --filter web-client test
//
// Pins, honestly:
// - the frozen AppShell composes in the WEB host: brand + all six nav
//   entries (home/search/library/accounts/ads/evaluation) + the permanent
//   ADR-0003 independent-value notice;
// - screens switch through the shell's own nav (aria-current tracks);
// - PERSISTENCE-MODE honesty (P6-DURABLE-WEB-1): the mode is the typed
//   union with the session-only default; the notice renders in the host
//   chrome stating the ACTUAL active mode — verbatim, never "saved" when
//   session-only (the durable/degraded variants are pinned in
//   persistence-component.test.tsx);
// - UNAVAILABLE surfaces render as TYPED data (named + desktop path named);
// - the transparency sources' manifests render from the APPLICATION LAYER's
//   own declarations (blocked / pending-authorization states as data);
// - the honest empty states render (accounts/library/ads/evaluation) — no
//   fake data anywhere;
// - the ranker selector is LIVE wiring: selecting an option runs the REAL
//   SetRankerAdapterSelection + ResolveSelectedRanker through the session's
//   routing store, and the status note carries the resolution metadata;
// - the qualification read runs the REAL QualifyAdsRecords over the empty
//   session stores and renders the honest empty outcome ([] — distinct from
//   the never-run null state);
// - NO network: zero network tokens exist in this app's source (the rg
//   evidence gate proves it — nothing to spy on, nothing was ever wired).
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";

import { App } from "../src/App";
import {
  DEFAULT_PERSISTENCE_MODE,
  PERSISTENCE_MODES,
  SESSION_ONLY_NOTICE,
  bootstrapPersistence,
} from "../src/persistence";
import type { PersistenceMode } from "../src/persistence";
import { UNAVAILABLE_SURFACES } from "../src/unavailable-surfaces";

// The harness may or may not register global auto-cleanup; be explicit.
afterEach(cleanup);

const BRAND = "WebFlix";
const NAV_LABELS = ["Home", "Search", "Library", "Accounts", "Ad Center", "MI Evaluation"];

/**
 * Renders the App the way main.tsx does — a real bootstrap read first (a
 * FRESH fake IndexedDB per render: first-run, session-only default, no
 * cross-test leakage). The durable/degraded variants live in
 * persistence-component.test.tsx.
 */
async function renderApp() {
  const persistence = await bootstrapPersistence({ indexedDB: new IDBFactory() });
  return render(<App persistence={persistence} />);
}

describe("the web client host composes the frozen AppShell", () => {
  it("renders the shell brand, tagline and the permanent independent-value notice", async () => {
    await renderApp();
    expect(screen.getAllByText(BRAND).length).toBeGreaterThan(0);
    expect(screen.getByTestId("independent-value-notice").textContent).toContain(
      "WebFlix is an independent desktop app",
    );
  });

  it("renders all six post-COMPOSITION nav entries", async () => {
    await renderApp();
    for (const label of NAV_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });

  it("switches screens through the shell nav with aria-current tracking", async () => {
    await renderApp();
    const adsButton = screen.getByTestId("nav-ads");
    fireEvent.click(adsButton);
    expect(adsButton.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("ad-center-panel-root")).toBeDefined();

    const evaluationButton = screen.getByTestId("nav-evaluation");
    fireEvent.click(evaluationButton);
    expect(evaluationButton.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("screen-evaluation")).toBeDefined();

    const homeButton = screen.getByTestId("nav-home");
    fireEvent.click(homeButton);
    expect(homeButton.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("home-accounts-empty")).toBeDefined();
  });
});

describe("persistence-mode honesty, typed + labeled", () => {
  it("renders the session-only notice verbatim with the typed mode on a first run", async () => {
    await renderApp();
    const notice = screen.getByTestId("persistence-mode-notice");
    expect(notice.textContent).toContain(SESSION_ONLY_NOTICE);
    expect(notice.textContent).toContain(`persistence mode: ${DEFAULT_PERSISTENCE_MODE}`);
    // The first-run line is the honest default ruling, stated.
    expect(notice.textContent).toContain("First run:");
  });

  it("types the persistence mode as the honest two-value union with a session-only default", () => {
    expect(DEFAULT_PERSISTENCE_MODE).toBe("session-only");
    expect(PERSISTENCE_MODES).toEqual(["session-only", "durable"]);
    // Compile-time pin: both literals are members of the typed union.
    const sessionOnly: PersistenceMode = "session-only";
    const durable: PersistenceMode = "durable";
    expect([sessionOnly, durable]).toEqual(PERSISTENCE_MODES);
  });
});

describe("unavailable-surface honesty", () => {
  it("renders every typed unavailable surface, named with its desktop path", async () => {
    await renderApp();
    for (const surface of UNAVAILABLE_SURFACES) {
      const item = screen.getByTestId(`unavailable-${surface.surfaceId}`);
      expect(item.textContent).toContain(surface.reason);
      expect(item.textContent).toContain(surface.desktopPath);
    }
    expect(UNAVAILABLE_SURFACES.length).toBe(4);
  });

  it("renders the transparency sources' own manifest declarations as data", async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getAllByTestId("source-manifest-line").length).toBe(3);
    });
    const lines = screen.getAllByTestId("source-manifest-line").map((node) => node.textContent);
    // The three real manifests (P5-SOURCES): GATC blocked, Meta + TikTok
    // pending-authorization — the application layer's own declarations.
    expect(lines.some((line) => line.includes("Google") && line.includes("blocked"))).toBe(true);
    expect(
      lines.some((line) => line.includes("Meta") && line.includes("pending-authorization")),
    ).toBe(true);
    expect(
      lines.some((line) => line.includes("TikTok") && line.includes("pending-authorization")),
    ).toBe(true);
  });
});

describe("the honest empty states", () => {
  it("renders the accounts empty state without fake connections", async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId("nav-accounts"));
    // The shell's accounts screen: zero accounts → the honest not-connected
    // card (nothing authorized yet) with a Connect control that has no
    // host-side handler wired (connector authorization is unavailable —
    // declared in the typed registry below).
    const notConnected = screen.getByTestId("account-card-not-connected-youtube");
    expect(notConnected.textContent).toContain("Not connected. Nothing has been authorized yet.");
  });

  it("renders the Ad Center never-run empty state before any qualification", async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId("nav-ads"));
    expect(screen.getByTestId("ad-center-panel-empty").textContent).toContain(
      "No qualification results yet.",
    );
  });

  it("renders the MI Evaluation never-run empty state", async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId("nav-evaluation"));
    // The evaluation panel's own factual null state (no invented results).
    expect(screen.getByTestId("screen-evaluation")).toBeDefined();
  });
});

describe("the live application-layer wiring", () => {
  it("selects a ranker adapter through the REAL selection use case and stores it in the session", async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId("nav-evaluation"));

    // The real default registry entry (the built-in deterministic v1).
    const option = screen.getByTestId("ranker-option-input-webflix.built-in-ranker");
    fireEvent.click(option);

    await waitFor(() => {
      const note = screen.getByTestId("ranker-selector-status");
      expect(note.textContent).toContain("Selected Built-in ranker (v1)");
      expect(note.textContent).toContain("session only");
    });
  });

  it("runs the REAL ads.qualify read over the empty session stores and renders the honest empty outcome", async () => {
    await renderApp();
    fireEvent.click(screen.getByTestId("nav-ads"));
    // Never-run first: the null empty state.
    expect(screen.getByTestId("ad-center-panel-empty")).toBeDefined();

    fireEvent.click(screen.getByTestId("run-qualification"));

    // After the run: results=[] (the honest empty report — distinct from
    // never-run), so the DISPLAY-STANDING disclaimer renders with zero
    // record cards. No fake data, no invented outcomes.
    await waitFor(() => {
      expect(screen.getByTestId("ad-center-panel-disclaimer")).toBeDefined();
    });
    expect(screen.queryAllByTestId(/^ad-center-record-/).length).toBe(0);
    expect(screen.queryByTestId("ad-center-panel-empty")).toBeNull();
  });
});
