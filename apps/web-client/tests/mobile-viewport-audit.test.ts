// @vitest-environment node
/**
 * P6-MOBILE-AUDIT-1 — the mobile-viewport audit harness: device-emulated
 * tests against the BUILT host (apps/web-client/dist — run
 * `pnpm --filter web-client build` first; the harness fails loudly if the
 * build output is absent).
 *
 * What this harness IS: the "a mobile slice runs" bar made executable —
 * the real Chromium engine (headless), real viewport widths, the real
 * built bundle served over loopback HTTP, per surface per width.
 *
 * Emulation law (verified in this environment BEFORE the harness was
 * written): this Chromium build reports a corrupted window.innerWidth
 * when a context is created with isMobile: true — so the harness
 * composes the device profile from the three flags that work honestly
 * here: viewport + hasTouch + deviceScaleFactor. Phone widths are the
 * audit's device profiles, not a claim about any specific handset.
 *
 * Scope honesty: every fix these tests verify is HOST-LEVEL
 * (apps/web-client only — index.html composition CSS + App.tsx host
 * styles). Where the shell's own inline styles leave a property unset
 * (flexWrap on the nav, minHeight on buttons/inputs/labels), the host
 * composes the responsive value on top — zero changes under packages/.
 * The shell-defect accounting lives in
 * apps/web-client/MOBILE-VIEWPORT-AUDIT.md.
 */

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";

/** The charter's four device-emulation profiles (audit widths). */
const AUDIT_PROFILES = [
  { label: "phone-375", width: 375, height: 667 },
  { label: "phone-390", width: 390, height: 844 },
  { label: "phone-430", width: 430, height: 932 },
  { label: "tablet-768", width: 768, height: 1024 },
] as const;

/** All six shell screens — the audit's per-surface sweep. */
const SCREENS = ["home", "search", "library", "accounts", "ads", "evaluation"] as const;

/** An always-rendered marker per screen (nav-verified screen identity). */
const SCREEN_MARKERS: Record<(typeof SCREENS)[number], string> = {
  home: "h1",
  search: '[data-testid="search-input"]',
  library: '[data-testid="library-collections-empty"]',
  accounts: "h1",
  ads: '[data-testid="ad-center-panel-root"]',
  evaluation: '[data-testid="screen-evaluation"]',
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let browser: Browser | null = null;
let server: http.Server | null = null;
let origin = "";

beforeAll(async () => {
  const dist = path.resolve(__dirname, "../dist");
  try {
    await fs.access(path.join(dist, "index.html"));
  } catch {
    throw new Error(
      "apps/web-client/dist/index.html is missing — run `pnpm --filter web-client build` " +
        "before the mobile-viewport audit (the harness audits the BUILT host).",
    );
  }
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let file = path.join(dist, url.pathname);
      if (url.pathname === "/" || url.pathname.endsWith("/")) {
        file = path.join(dist, "index.html");
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server?.address();
  if (address === null || typeof address === "string") {
    throw new Error("the audit HTTP server did not bind a loopback port");
  }
  origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

/** One device-emulated page. Contexts isolate storage (IndexedDB per context). */
async function openAuditPage(
  profile: (typeof AUDIT_PROFILES)[number],
  options: { readonly stubIndexedDB?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  if (browser === null) {
    throw new Error("the audit browser was not launched");
  }
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  if (options.stubIndexedDB) {
    // The degraded path: no IndexedDB global — the bootstrap must resolve
    // typed-degraded BEFORE mount (the honest fallback, never a crash).
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
    });
  }
  await page.goto(origin, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="persistence-mode-notice"]', { timeout: 30_000 });
  return { context, page };
}

/** The overflow fact: document scroll width vs the viewport's inner width. */
async function overflowFacts(page: Page): Promise<{ innerWidth: number; docScrollWidth: number }> {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    docScrollWidth: document.documentElement.scrollWidth,
  }));
}

/** Tap to a screen and wait for it to become the active page. */
async function openScreen(page: Page, screen: (typeof SCREENS)[number]): Promise<void> {
  await page.click(`[data-testid="nav-${screen}"]`);
  await page.waitForSelector(`[data-testid="nav-${screen}"][aria-current="page"]`);
}

/** Rendered heights (px, rounded) of every element matching the selector. */
async function renderedHeights(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((sel) => {
    const elements = Array.from(document.querySelectorAll(sel));
    return elements.map((element) => Math.round(element.getBoundingClientRect().height));
  }, selector);
}

describe("mobile-viewport audit harness", () => {
  it("registers the charter's four device profiles exactly (375/390/430 phones + 768 tablet)", () => {
    expect(AUDIT_PROFILES.map((profile) => profile.width)).toEqual([375, 390, 430, 768]);
  });
});

for (const profile of AUDIT_PROFILES) {
  describe(`mobile-viewport audit @ ${profile.label} (${profile.width}x${profile.height})`, () => {
    // One shared page for the read-only sweep (screen switching + geometry);
    // stateful tests below open their own isolated contexts.
    let shared: { context: BrowserContext; page: Page };

    beforeAll(async () => {
      shared = await openAuditPage(profile);
    }, 60_000);

    afterAll(async () => {
      await shared.context.close();
    });

    for (const screen of SCREENS) {
      it(
        `overflow: ${screen} screen — no horizontal document overflow, screen marker visible`,
        { timeout: 60_000 },
        async () => {
          await openScreen(shared.page, screen);
          await shared.page.waitForSelector(SCREEN_MARKERS[screen], { timeout: 10_000 });
          const facts = await overflowFacts(shared.page);
          expect(
            facts.docScrollWidth - facts.innerWidth,
            `${screen} overflows horizontally by ${facts.docScrollWidth - facts.innerWidth}px`,
          ).toBeLessThanOrEqual(0);
        },
      );
    }

    it(
      "nav: reachable and usable — six labeled buttons; tap navigation switches the active screen",
      { timeout: 60_000 },
      async () => {
        const page = shared.page;
        const labels = await page.evaluate(() =>
          Array.from(document.querySelectorAll('nav[aria-label="Primary"] button')).map(
            (button) => button.textContent ?? "",
          ),
        );
        expect(labels).toHaveLength(SCREENS.length);
        expect(labels.join("|")).toBe("Home|Search|Library|Accounts|Ad Center|MI Evaluation");
        for (const screen of SCREENS) {
          await openScreen(page, screen);
          const current = await page.getAttribute(`[data-testid="nav-${screen}"]`, "aria-current");
          expect(current, `nav-${screen} should hold aria-current="page" after its tap`).toBe(
            "page",
          );
          expect(await page.isVisible(SCREEN_MARKERS[screen])).toBe(true);
        }
      },
    );

    it("nav: every nav button meets the 44px touch-target bar (host-composed min-height)", async () => {
      const heights = await renderedHeights(shared.page, 'nav[aria-label="Primary"] button');
      expect(heights).toHaveLength(SCREENS.length);
      for (const height of heights) {
        expect(height, `a nav button renders ${height}px tall (< 44px)`).toBeGreaterThanOrEqual(44);
      }
    });

    it(
      "search: the search form's input and submit meet the 44px bar (shell surface, host-composed min-height)",
      { timeout: 60_000 },
      async () => {
        await openScreen(shared.page, "search");
        const inputHeights = await renderedHeights(
          shared.page,
          'section[aria-label="Search"] input[type="search"]',
        );
        const submitHeights = await renderedHeights(
          shared.page,
          'section[aria-label="Search"] form button[type="submit"]',
        );
        expect(inputHeights.length + submitHeights.length).toBeGreaterThanOrEqual(2);
        for (const height of [...inputHeights, ...submitHeights]) {
          expect(
            height,
            `a search form control renders ${height}px tall (< 44px)`,
          ).toBeGreaterThanOrEqual(44);
        }
      },
    );

    it(
      "evaluation: ranker option labels meet the 44px bar (shell surface, host-composed min-height)",
      { timeout: 60_000 },
      async () => {
        await openScreen(shared.page, "evaluation");
        await shared.page.waitForSelector('[data-testid^="ranker-option-input-"]');
        const labelHeights = await renderedHeights(
          shared.page,
          'label[for^="ranker-adapter-option-"]',
        );
        expect(labelHeights.length).toBeGreaterThanOrEqual(1);
        for (const height of labelHeights) {
          expect(
            height,
            `a ranker option label renders ${height}px tall (< 44px)`,
          ).toBeGreaterThanOrEqual(44);
        }
      },
    );

    it("persistence: control usable — enabled, 44px target, honest options; host honesty buttons meet the 44px bar", async () => {
      const page = shared.page;
      const select = page.locator('[data-testid="persistence-mode-control"]');
      await expect.poll(async () => select.isEnabled(), { timeout: 10_000 }).toBe(true);
      const selectHeights = await renderedHeights(page, '[data-testid="persistence-mode-control"]');
      for (const height of selectHeights) {
        expect(
          height,
          `the persistence select renders ${height}px tall (< 44px)`,
        ).toBeGreaterThanOrEqual(44);
      }
      const optionTexts = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('[data-testid="persistence-mode-control"] option'),
        ).map((option) => option.textContent ?? ""),
      );
      expect(optionTexts).toHaveLength(2);
      expect(optionTexts[0]).toContain("Session-only (default — nothing saved)");
      expect(optionTexts[1]).toContain(
        "Durable (save the setting + ranker selection in this browser)",
      );
      const hostButtonHeights = await renderedHeights(page, '[data-testid="run-qualification"]');
      for (const height of hostButtonHeights) {
        expect(
          height,
          `the run-qualification button renders ${height}px tall (< 44px)`,
        ).toBeGreaterThanOrEqual(44);
      }
    });

    it("unavailable registry: all four surfaces declare themselves honestly (typed data, desktop paths named)", async () => {
      const page = shared.page;
      for (const surfaceId of [
        "provider-connectors",
        "durable-local-library",
        "real-mi-engines",
        "ad-transparency-transport",
      ]) {
        expect(await page.isVisible(`[data-testid="unavailable-${surfaceId}"]`)).toBe(true);
      }
      const registryText = await page.evaluate(() => {
        const chrome = document.querySelector('[data-testid="host-honesty-chrome"]');
        return chrome?.textContent ?? "";
      });
      expect(registryText).toContain("Not available in this web client");
      expect(registryText).toContain("packages/connectors");
      expect(registryText).toContain("packages/local-library");
    });

    // Stateful: writes durable records — its own isolated context (fresh IndexedDB).
    it(
      "persistence: opt-in is usable — choosing durable flips the notice to the durable statement",
      { timeout: 90_000 },
      async () => {
        const { context, page } = await openAuditPage(profile);
        try {
          const notice = page.locator('[data-testid="persistence-mode-notice"]');
          expect(await notice.textContent()).toContain("Session-only:");
          await page.selectOption('[data-testid="persistence-mode-control"]', "durable");
          await expect
            .poll(async () => notice.textContent(), { timeout: 15_000 })
            .toContain("Durable: your persistence setting and your ranker-adapter selection");
          expect(await page.locator('[data-testid="clear-durable-data"]').isEnabled()).toBe(true);
        } finally {
          await context.close();
        }
      },
    );

    // The degraded path: no IndexedDB — its own context with the global stubbed out.
    it(
      "degraded: IndexedDB unavailable — typed notice, disabled control, session-only fallback; no overflow on any screen",
      { timeout: 90_000 },
      async () => {
        const { context, page } = await openAuditPage(profile, { stubIndexedDB: true });
        try {
          const notice = await page.evaluate(
            () =>
              document.querySelector('[data-testid="persistence-mode-notice"]')?.textContent ?? "",
          );
          expect(notice).toContain("Durable storage is unavailable in this browser");
          expect(notice).toContain("IndexedDB is not available in this environment");
          expect(await page.locator('[data-testid="persistence-mode-control"]').isDisabled()).toBe(
            true,
          );
          const value = await page.evaluate(() => {
            const select = document.querySelector('[data-testid="persistence-mode-control"]');
            return select instanceof HTMLSelectElement ? select.value : null;
          });
          expect(value).toBe("session-only");
          // The unavailable-surface registry still renders in degraded mode.
          expect(await page.isVisible('[data-testid="unavailable-provider-connectors"]')).toBe(
            true,
          );
          // And the degraded layout still does not overflow on any screen.
          for (const screen of SCREENS) {
            await openScreen(page, screen);
            const facts = await overflowFacts(page);
            expect(
              facts.docScrollWidth - facts.innerWidth,
              `degraded ${screen} overflows horizontally by ${facts.docScrollWidth - facts.innerWidth}px`,
            ).toBeLessThanOrEqual(0);
          }
        } finally {
          await context.close();
        }
      },
    );
  });
}
