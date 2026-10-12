// @vitest-environment node
/**
 * P6-PWA-1 — the PWA slice tests, honestly: manifest validity, the
 * precache-only service worker's BUILT-output contract, and the
 * offline-shell smoke under emulation (real headless Chromium against the
 * BUILT host — run `pnpm --filter web-client build` first; the harness
 * fails loudly if the build output is absent).
 *
 * What these tests ARE: the work order's four test families made
 * executable:
 * 1. manifest validity — parses, standalone display, icons present;
 * 2. SW registration — the built output CONTAINS the worker with the
 *    injected precache inventory, and the built entry registers it;
 * 3. offline-shell smoke — with the network cut (context.setOffline),
 *    the precached shell still serves (the navigation and every shell
 *    asset come from the cache, ZERO network);
 * 4. install-claim pins — the exact honest string renders in the REAL
 *    served page (and the source constant is byte-pinned).
 *
 * Scope honesty: the service worker is PRECACHE-ONLY by source
 * (public/sw.js — the only fetch() is the non-precached pass-through);
 * no sync, no push, no telemetry — nothing else exists to test.
 */

import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { chromium } from "playwright-core";

/** The work order's pinned claim — byte-exact. */
const ORDER_CLAIM =
  "install the app shell — media and catalog need a session; nothing but the shell works offline";

const APP_ROOT = path.resolve(__dirname, "..");
const DIST = path.join(APP_ROOT, "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let browser: Browser | null = null;
let server: http.Server | null = null;
let origin = "";

beforeAll(async () => {
  try {
    await fs.access(path.join(DIST, "index.html"));
  } catch {
    throw new Error(
      "apps/web-client/dist/index.html is missing — run `pnpm --filter web-client build` " +
        "before the PWA tests (the harness audits the BUILT host).",
    );
  }
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let file = path.join(DIST, url.pathname);
      if (url.pathname === "/" || url.pathname.endsWith("/")) {
        file = path.join(DIST, "index.html");
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
    throw new Error("the PWA test HTTP server did not bind a loopback port");
  }
  origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

describe("P6-PWA-1 — manifest validity", () => {
  it("the SOURCE manifest parses, declares standalone display, and carries both icons", async () => {
    const manifest = await readJson(path.join(APP_ROOT, "public", "manifest.webmanifest"));
    expect(manifest["display"]).toBe("standalone");
    expect(manifest["name"]).toBe("WebFlix");
    expect(manifest["start_url"]).toBe("/");
    const icons = manifest["icons"] as Array<Record<string, string>>;
    expect(icons.length).toBeGreaterThanOrEqual(2);
    const sizes = icons.map((icon) => icon["sizes"]);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of icons) {
      expect(icon["type"]).toBe("image/png");
      await fs.access(path.join(APP_ROOT, "public", path.basename(icon["src"])));
    }
  });

  it("the BUILT manifest is copied verbatim into dist/ and the icons with it", async () => {
    const manifest = await readJson(path.join(DIST, "manifest.webmanifest"));
    expect(manifest["display"]).toBe("standalone");
    await fs.access(path.join(DIST, "icon-192.png"));
    await fs.access(path.join(DIST, "icon-512.png"));
    const html = await fs.readFile(path.join(DIST, "index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
  });
});

describe("P6-PWA-1 — the precache-only service worker's BUILT-output contract", () => {
  it("dist/sw.js exists and carries the INJECTED precache inventory (non-empty, app shell included)", async () => {
    const sw = await fs.readFile(path.join(DIST, "sw.js"), "utf8");
    const match = sw.match(/self\.__WF_PRECACHE_MANIFEST = (\[[\s\S]*?\]);/);
    expect(match).not.toBeNull();
    const inventory = JSON.parse(match![1]) as string[];
    expect(inventory.length).toBeGreaterThan(0);
    expect(inventory).toContain("/");
    expect(inventory).toContain("/index.html");
    expect(inventory).toContain("/manifest.webmanifest");
    expect(inventory.some((entry) => entry.startsWith("/assets/"))).toBe(true);
    expect(inventory.some((entry) => entry.startsWith("/icon-"))).toBe(true);
    expect(inventory).not.toContain("/sw.js");
  });

  it("the built entry registers the worker (the registration call is in the dist bundle)", async () => {
    const assets = await fs.readdir(path.join(DIST, "assets"));
    const entry = assets.find((name) => /^index-.*\.js$/.test(name));
    expect(entry).toBeDefined();
    const bundle = await fs.readFile(path.join(DIST, "assets", entry!), "utf8");
    expect(bundle).toContain("serviceWorker");
    expect(bundle).toContain("/sw.js");
    expect(bundle).toContain("register");
  });

  it("the SOURCE worker is precache-only: no runtime fetch targets beyond the precache pass-through", async () => {
    const sw = await fs.readFile(path.join(APP_ROOT, "public", "sw.js"), "utf8");
    // The ONLY fetch call in the source is the non-precached pass-through
    // (the comment block deliberately avoids the literal so the count is
    // code-only).
    const fetchCalls = sw.match(/fetch\(/g) ?? [];
    expect(fetchCalls.length).toBe(1);
    expect(sw).toContain("return fetch(request);");
    // The worker never touches network APIs beyond the cache + the
    // pass-through: no Background Sync API, no Push API, no XHR, no
    // WebSocket, no beacon (the rg proof, as API tokens).
    for (const forbidden of [
      "pushManager",
      "sync.register",
      "XMLHttpRequest",
      "WebSocket",
      "sendBeacon",
    ]) {
      expect(sw).not.toContain(forbidden);
    }
  });
});

describe("P6-PWA-1 — the offline-shell smoke (real Chromium, network cut)", () => {
  async function openShell(): Promise<Page> {
    if (browser === null) {
      throw new Error("the PWA test browser was not launched");
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="persistence-mode-notice"]', { timeout: 30_000 });
    // Wait for the worker to be INSTALLED + ACTIVATED (it caches the whole
    // dist inventory at install; clients.claim() takes control).
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    return page;
  }

  it("the shell serves OFFLINE from the precache (navigation + assets, zero network)", async () => {
    const page = await openShell();
    const context = page.context();
    await context.setOffline(true);
    await page.reload({ waitUntil: "load" });
    // The app is up OFFLINE: the shell chrome renders from the cache.
    await page.waitForSelector('[data-testid="persistence-mode-notice"]', { timeout: 30_000 });
    const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
    expect(controlled).toBe(true);
    await context.close();
  }, 120_000);

  it("the install affordance renders IN THE REAL SERVED PAGE with the exact pinned claim", async () => {
    const page = await openShell();
    const claim = await page.textContent('[data-testid="install-claim"]');
    expect(claim).toBe(ORDER_CLAIM);
    const button = await page.$('[data-testid="install-affordance-button"]');
    expect(button).not.toBeNull();
    await page.context().close();
  }, 120_000);

  it("the source constant is byte-pinned to the order's exact claim string", async () => {
    const source = await fs.readFile(path.join(APP_ROOT, "src", "install-affordance.tsx"), "utf8");
    expect(source).toContain(`"${ORDER_CLAIM}"`);
  });
});
