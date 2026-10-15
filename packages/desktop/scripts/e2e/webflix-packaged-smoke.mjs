#!/usr/bin/env node
/* eslint-disable max-lines -- 单个可审计的 packaged-smoke 证据面：一次运行必须把启动/身份/导航/隔离/媒体/关机全部断言留在同一文件里，拆分会切断 results.json 与断言源码的一一对应。 */
/**
 * WebFlix desktop acceptance — PACKAGED-build smoke (tier 6, headless Linux).
 *
 * P9-QA-1 (order docs/plans/work-orders/P9-UBUNTU-WEBFLIX-1.md, Worker 3,
 * requirement 1/3): launch the REAL packaged Ubuntu artifact — the .deb
 * installed tree (rootless `dpkg-deb -x`) and/or the AppImage
 * (`--appimage-extract`, the documented no-FUSE path) — never the dev
 * server, and assert the acceptance minimum against the packaged process.
 *
 * Per-run evidence (out dir): the full main-process log (main.log), one
 * screenshot per covered state (PNG), and results.json with every
 * assertion's pass/fail/blocked + detail. Nothing is inferred from a green
 * exit alone; every check below reads the live process, the live DOM (via
 * CDP + playwright-core, the repo's automation harness) or the real
 * filesystem the packaged app wrote.
 *
 * Covered (requirement 2/3 mapping, see docs/operations/ubuntu-release-evidence.md):
 *   1. launch          — packaged binary creates the primary window, renderer
 *                        dom-ready fires (app's own structured log markers).
 *   2. identity        — document.title "WebFlix", product mark mounted, data
 *                        root ~/.webflix (packaged default-on baked flavor),
 *                        ~/.zcode MUST NOT be created by the WebFlix runtime
 *                        (recorded honestly as a FAIL finding when it is —
 *                        observed on the 33681f7 artifacts, see evidence doc).
 *   3. updater         — packaged boot refuses the ZCode updater (H1
 *                        fail-closed marker in the packaged log).
 *   4. vault           — secret-service-less environment: the account vault
 *                        fails closed with the typed banner, no plaintext.
 *   5. navigation      — Home / Search / Library / Accounts / Settings all
 *                        render their real honest states through real clicks.
 *   6. zcode-leak      — visible text/title/alt scan for ZCode/Z.ai.
 *   7. local media     — REAL Web file-picker import (playwright sets the
 *                        hidden <input type=file>) + REAL playback of the
 *                        imported object URL in the <video> player.
 *   8. offline         — network emulation offline; library/playback intact.
 *   9. desktop entry   — installed entry identity fields vs the manifest;
 *                        the user-level deep-link entry the app writes.
 *  10. crash/natives   — no MODULE_NOT_FOUND/native-module/dlopen errors, no
 *                        crash dumps beyond the crashpad client id.
 *  11. shutdown        — SIGTERM exits cleanly; restart with the same HOME
 *                        boots to the same identity (session-only library
 *                        honestly empty again).
 *
 * Usage (from packages/desktop):
 *   node scripts/e2e/webflix-packaged-smoke.mjs \
 *     --deb /path/to/WebFlix-<ver>-linux-amd64.deb \
 *     --appimage /path/to/WebFlix-<ver>-linux-x86_64.AppImage \
 *     --media /path/to/tiny.mp4 \
 *     --out /path/to/evidence-dir
 *   (--deb and --appimage are independently optional; --media absent ⇒ the
 *   local-import/playback assertions record BLOCKED, never pass.)
 *
 * Env: needs a display ONLY through the script's own Xvfb (spawned/killed
 * per run); no FUSE required (AppImage uses --appimage-extract); runs
 * entirely as the current user (rootless dpkg-deb -x extraction).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const pkgRoot = resolve(import.meta.dirname, "../.."); // packages/desktop
const BOOT_TIMEOUT_MS = 90_000;
const CDP_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;

/** CLI args (kept minimal and explicit; no defaults that hide what ran). */
function parseArgs(argv) {
  const args = { deb: undefined, appimage: undefined, media: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--deb" || key === "--appimage" || key === "--media" || key === "--out") {
      args[key.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (args.deb === undefined && args.appimage === undefined) {
    throw new Error("nothing to test: pass --deb and/or --appimage");
  }
  // Inputs must exist; --out is a destination this script creates itself.
  for (const flag of ["deb", "appimage", "media"]) {
    if (args[flag] !== undefined && !existsSync(args[flag])) {
      throw new Error(`--${flag} path does not exist: ${args[flag]}`);
    }
  }
  return args;
}

/** Free TCP port probe (races are acceptable: bind-fail ⇒ app picks another). */
function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * First free X display number (Linux X socket convention: the abstract/
 * /tmp/.X11-unix/X<n> socket plus the /tmp/.X<n>-lock file; probe both so a
 * stale lock never picks a display Xvfb will refuse to bind).
 */
function findFreeDisplay() {
  for (let display = 99; display < 140; display += 1) {
    const socket = `/tmp/.X11-unix/X${display}`;
    const lock = `/tmp/.X${display}-lock`;
    if (!existsSync(socket) && !existsSync(lock)) return display;
  }
  throw new Error("no free X display number in 99..139");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Records one assertion. `blocked` is a first-class outcome (honest-limit
 * reporting): a blocked check NEVER counts as passed.
 */
const results = [];
function record(name, ok, detail, blocked = false) {
  results.push({ name, ok, blocked, detail: detail ?? "" });
  const tag = blocked ? "BLOCK" : ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label} at ${url}`);
}

/** Same boot-marker contract as the dev smoke — the app's own log lines. */
async function waitForBootEvidence(mainLog, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const state = () => {
    const log = mainLog.join("\n");
    return {
      window: /\[primary-window\] creating main window/.test(log),
      domReady: /dom-ready fired/.test(log),
    };
  };
  while (Date.now() < deadline) {
    const observed = state();
    if (observed.window && observed.domReady) return observed;
    await sleep(700);
  }
  return state();
}

/** Rootless .deb tree extraction (real dpkg-deb, no install privileges needed). */
function extractDeb(debPath, outDir) {
  const tree = join(outDir, "deb-tree");
  mkdirSync(tree, { recursive: true });
  const res = spawnSync("dpkg-deb", ["-x", debPath, tree], { stdio: "pipe" });
  if (res.status !== 0) throw new Error(`dpkg-deb -x failed: ${res.stderr}`);
  const executable = join(tree, "opt", "WebFlix", "webflix");
  if (!existsSync(executable)) throw new Error(`deb tree missing ${executable}`);
  return {
    tree,
    executable,
    desktopEntry: join(tree, "usr", "share", "applications", "webflix.desktop"),
  };
}

/**
 * AppImage extract-first (the documented no-FUSE path). The runtime's
 * `--appimage-extract` always materializes `./squashfs-root` under the CWD
 * (its optional argument is a path FILTER, not a destination) — extract in a
 * dedicated dir and run the extracted `AppRun` from there.
 */
function extractAppImage(appImagePath, outDir) {
  const dir = join(outDir, "appimage-run");
  mkdirSync(dir, { recursive: true });
  const res = spawnSync(appImagePath, ["--appimage-extract"], { stdio: "pipe", cwd: dir });
  const tree = join(dir, "squashfs-root");
  if (res.status !== 0 || !existsSync(join(tree, "AppRun"))) {
    throw new Error(`--appimage-extract failed: ${res.stderr}`);
  }
  return {
    tree,
    executable: join(tree, "AppRun"),
    desktopEntry: join(tree, "webflix.desktop"),
    appRunWrapper: true,
  };
}

/** Minimal .desktop field parser (evidence-grade: exact `Key=Value` lines). */
function readDesktopEntryFields(path) {
  if (!existsSync(path)) return null;
  const fields = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Za-z-]+)=(.*)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

/**
 * The packaged identity contract the deb/AppImage must agree on (freeze §6.1).
 * Exec is flavor-shaped: the deb entry points at the absolute installed
 * binary path; the AppImage entry is relocation-safe and ships `AppRun` (its
 * documented form — the AppImage runtime resolves it from the mount point).
 */
const EXPECTED_IDENTITY = {
  Name: "WebFlix",
  Icon: "webflix",
  StartupWMClass: "WebFlix",
  Comment: "WebFlix Desktop App",
  MimeType: "x-scheme-handler/webflix;",
};
const EXPECTED_EXEC = {
  deb: "/webflix",
  appimage: "AppRun",
};

function assertDesktopEntryIdentity(entryPath, label, flavor) {
  const fields = readDesktopEntryFields(entryPath);
  if (fields === null) {
    record(`packaged-entry:${label}`, false, `${entryPath} missing`);
    return;
  }
  const mismatches = [];
  for (const [key, expected] of Object.entries(EXPECTED_IDENTITY)) {
    if (fields[key] !== expected) {
      mismatches.push(`${key}=${fields[key]} (expected ${expected})`);
    }
  }
  const execNeedle = EXPECTED_EXEC[flavor] ?? "/webflix";
  if (!fields.Exec?.includes(execNeedle)) {
    mismatches.push(`Exec=${fields.Exec} (expected to contain ${execNeedle})`);
  }
  record(
    `packaged-entry:${label}`,
    mismatches.length === 0,
    mismatches.length === 0 ? `${entryPath} identity fields exact` : mismatches.join("; "),
  );
}

/** Crash / missing-native-module scan over the captured packaged log. */
function scanForCrashPatterns(log) {
  const patterns = [
    /Cannot find module/i,
    /MODULE_NOT_FOUND/,
    /was compiled against a different Node\.js version/i,
    /ERR_DLOPEN_FAILED/,
    /dlopen.*failed/i,
  ];
  const hits = [];
  for (const pattern of patterns) {
    const match = pattern.exec(log);
    if (match) hits.push(match[0]);
  }
  return hits;
}

/** Enumerate crashpad dumps (the live dir legitimately holds only client_id). */
function crashDumps(crashLiveDir) {
  if (!existsSync(crashLiveDir)) return [];
  return readdirSync(crashLiveDir).filter((name) => name !== "client_id");
}

/**
 * One packaged-artifact run: launch → assert → SIGTERM → relaunch (same
 * HOME) → assert persistence/honest-empty → SIGTERM. All evidence lands in
 * `outDir`; every finding is recorded through `record()`.
 */
async function runPackagedSmoke({
  flavor,
  executable,
  tree,
  desktopEntry,
  appRunWrapper,
  outDir,
  mediaFile,
  debFile,
}) {
  const homeDir = join(outDir, `home-${flavor}`);
  mkdirSync(homeDir, { recursive: true });
  // DevToolsActivePort lands in userData before the app creates the dir (the
  // same race the dev smoke documents) — pre-create the frozen packaged
  // layout so the CDP endpoint can bind. Test-env preparation only.
  mkdirSync(join(homeDir, ".webflix", "session"), { recursive: true });
  const mainLogPath = join(outDir, `main-${flavor}.log`);

  // ---- own Xvfb for this run (headless law: no display assumptions) ----
  const display = findFreeDisplay();
  const xvfb = spawn("Xvfb", [`:${display}`, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
    stdio: "ignore",
    detached: false,
  });
  const displaySocket = `/tmp/.X11-unix/X${display}`;
  const xvfbDeadline = Date.now() + 15_000;
  while (!existsSync(displaySocket) && Date.now() < xvfbDeadline) await sleep(200);
  if (!existsSync(displaySocket)) throw new Error(`Xvfb :${display} did not come up`);
  const displayEnv = `:${display}`;

  // Chromium switches precede the app path (packaged binary: all switches go
  // to the browser process anyway, but keep the dev smoke's ordering rule).
  // --no-sandbox ONLY for the AppImage lane — that is literally the AppImage's
  // own shipped desktop entry Exec (`AppRun --no-sandbox %U`); the deb lane
  // runs faithful to its entry (no sandbox switch) and must boot without it.
  const cdpPort = await findFreePort();
  const appArgs = [
    "--remote-debugging-port=" + cdpPort,
    "--disable-gpu",
    ...(flavor === "appimage" ? ["--no-sandbox"] : []),
  ];
  const appEnv = {
    ...process.env,
    HOME: homeDir,
    DISPLAY: displayEnv,
    ...(appRunWrapper ? { APPDIR: tree } : {}),
  };

  const launchApp = () => {
    const child = spawn(executable, appArgs, {
      cwd: tree,
      env: appEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = [];
    const collect = (stream, tag) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        for (const line of chunk.split("\n")) lines.push(`<${tag}> ${line}`);
      });
    };
    collect(child.stdout, "out");
    collect(child.stderr, "err");
    return { child, lines };
  };

  let playwrightBrowser = null;
  let run = launchApp();
  let exitCode = null;
  run.child.on("exit", (code) => {
    exitCode = code;
  });

  try {
    const bootOk = await waitForBootEvidence(run.lines, BOOT_TIMEOUT_MS);
    record(
      `launch:${flavor}:window`,
      bootOk.window,
      bootOk.window ? "primary window created (packaged log marker)" : "no window-creation marker",
    );
    record(
      `launch:${flavor}:renderer`,
      bootOk.domReady,
      bootOk.domReady ? "renderer dom-ready fired (packaged log marker)" : "no dom-ready marker",
    );

    // ---- CDP attach (playwright-core, the repo's automation harness) ----
    let page = null;
    try {
      await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, CDP_TIMEOUT_MS, "CDP endpoint");
      const { chromium } = require(require.resolve("playwright-core", { paths: [pkgRoot] }));
      playwrightBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const filePageDeadline = Date.now() + 30_000;
      while (page === null && Date.now() < filePageDeadline) {
        for (const context of playwrightBrowser.contexts()) {
          for (const candidate of context.pages()) {
            if (candidate.url().startsWith("file:")) page = candidate;
          }
        }
        if (page === null) await sleep(500);
      }
      if (page === null) throw new Error("no file:// page target on the CDP endpoint");
      await page.waitForFunction(() => document.title === "WebFlix", null, { timeout: 30_000 });
      record(`cdp:${flavor}:attached`, true, `packaged renderer page ${page.url().slice(0, 72)}…`);
    } catch (error) {
      record(`cdp:${flavor}:attached`, false, String(error?.message ?? error));
    }

    if (page !== null) {
      // ---- identity: title + product mark + splash swap ----
      const title = await page.title();
      record(`identity:${flavor}:title`, title === "WebFlix", `document.title="${title}"`);
      const markCount = await page.locator('[data-testid="webflix-product-mark"]').count();
      record(
        `identity:${flavor}:product-mark`,
        markCount === 1,
        `webflix-product-mark mounted (${markCount})`,
      );
      const splashAria = await page
        .locator("#loading")
        .getAttribute("aria-label")
        .catch(() => null);
      record(
        `identity:${flavor}:splash-swap`,
        splashAria === "Loading WebFlix…" || splashAria === null,
        splashAria === "Loading WebFlix…"
          ? "startup overlay carries the WebFlix aria-label"
          : `startup overlay absent after boot (aria=${splashAria}) — post-boot state`,
      );

      // ---- navigation: real clicks through every primary screen ----
      // HomeScreen's h1 is "Welcome to WebFlix" (the screen's own heading —
      // the literal word "Home" is only the nav button's label); every other
      // screen heads with its own name.
      const navExpectedText = { Home: "Welcome to WebFlix" };
      const navLabels = ["Home", "Search", "Library", "Accounts", "Settings"];
      for (const label of navLabels) {
        const expected = navExpectedText[label] ?? label;
        try {
          await page.getByRole("button", { name: label, exact: true }).click({ timeout: 5_000 });
          await page.waitForFunction(
            (needle) => {
              const main = document.querySelector("main");
              return main !== null && main.textContent.includes(needle);
            },
            expected,
            { timeout: 5_000 },
          );
          record(
            `nav:${flavor}:${label.toLowerCase()}`,
            true,
            "nav button click → screen rendered",
          );
        } catch (error) {
          record(`nav:${flavor}:${label.toLowerCase()}`, false, String(error?.message ?? error));
        }
      }
      await page.screenshot({ path: join(outDir, `01-${flavor}-home.png`) });

      // ---- ZCode UI-leak scan (visible text, title, alt/aria) ----
      const leakScan = await page.evaluate(() => {
        const visibleText = document.body?.innerText ?? "";
        const ariaAltText = Array.from(document.querySelectorAll("[aria-label], [alt], [title]"))
          .map(
            (el) =>
              `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("alt") ?? ""} ${el.getAttribute("title") ?? ""}`,
          )
          .join(" ");
        const surface = `${document.title}\n${visibleText}\n${ariaAltText}`;
        const hits = surface.match(/zcode|z\.ai/gi) ?? [];
        return { hitCount: hits.length, surface: surface.slice(0, 400) };
      });
      record(
        `zcode-leak:${flavor}:visible-surface`,
        leakScan.hitCount === 0,
        leakScan.hitCount === 0
          ? "no ZCode/Z.ai text on the visible product surface"
          : `${leakScan.hitCount} ZCode/Z.ai hits on the visible surface`,
      );

      // ---- vault: fail-closed typed banner in a secret-service-less env ----
      const vaultBanner = page.locator('[data-testid="webflix-vault-unavailable"]');
      const vaultBannerVisible = (await vaultBanner.count()) > 0;
      const vaultText = vaultBannerVisible ? await vaultBanner.innerText() : "";
      record(
        `vault:${flavor}:fail-closed`,
        vaultBannerVisible,
        vaultBannerVisible
          ? `typed vault refusal rendered: ${vaultText.slice(0, 120)}…`
          : "vault banner absent (vault may be available — record env)",
      );
      const tokenishLeak = await page.evaluate(() => {
        const text = `${document.body?.innerText ?? ""}\n${JSON.stringify(window.localStorage ?? {})}`;
        return /(ya29\.|Bearer\s+[A-Za-z0-9._-]{20,}|access[_-]?token\s*[:=]\s*["'][A-Za-z0-9._-]{20,})/i.test(
          text,
        );
      });
      record(
        `vault:${flavor}:no-token-material`,
        !tokenishLeak,
        "no token-shaped strings in renderer text/storage",
      );

      // ---- accounts: honest not-connected + typed connect refusal ----
      await page.getByRole("button", { name: "Accounts", exact: true }).click({ timeout: 5_000 });
      const notConnected = await page
        .locator('[data-testid="account-card-not-connected-youtube"]')
        .count();
      record(
        `accounts:${flavor}:not-connected`,
        notConnected === 1,
        `youtube not-connected card (${notConnected})`,
      );
      try {
        await page.locator('[data-testid="connect-youtube"]').click({ timeout: 5_000 });
        const outcome = await page
          .locator('[data-testid="connect-outcome-youtube"]')
          .innerText()
          .catch(() => null);
        // The typed-refusal contract (webflixAccountIpc.ts / boot.tsx): a
        // truthful, operator-facing refusal — "not available in this build" /
        // "unavailable" — that explicitly states nothing was authorized.
        record(
          `accounts:${flavor}:connect-typed-refusal`,
          outcome !== null &&
            /(not available|unavailable)/i.test(outcome) &&
            /nothing was authorized/i.test(outcome),
          outcome === null
            ? "no connect outcome rendered"
            : `typed outcome: ${outcome.slice(0, 140)}`,
        );
      } catch (error) {
        record(`accounts:${flavor}:connect-typed-refusal`, false, String(error?.message ?? error));
      }
      await page.screenshot({ path: join(outDir, `02-${flavor}-accounts.png`) });

      // ---- search: honest requires-auth state (no invented results) ----
      await page.getByRole("button", { name: "Search", exact: true }).click({ timeout: 5_000 });
      try {
        await page.locator('[data-testid="search-input"]').fill("webflix smoke query");
        await page.locator('[data-testid="search-input"]').press("Enter");
        const requiresAuth = await page
          .locator('[data-testid="search-requires-auth"]')
          .innerText()
          .catch(() => null);
        record(
          `search:${flavor}:requires-auth`,
          requiresAuth !== null,
          requiresAuth === null
            ? "no honest requires-auth state rendered"
            : `honest state: ${requiresAuth.slice(0, 90).replace(/\n/g, " ")}…`,
        );
      } catch (error) {
        record(`search:${flavor}:requires-auth`, false, String(error?.message ?? error));
      }
      await page.screenshot({ path: join(outDir, `03-${flavor}-search.png`) });

      // ---- offline: emulate network offline; local surfaces stay usable ----
      try {
        await page.context().setOffline(true);
        await page.getByRole("button", { name: "Library", exact: true }).click({ timeout: 5_000 });
        const libraryVisibleOffline = await page
          .locator('[aria-label="Library"]')
          .isVisible()
          .catch(() => false);
        record(
          `offline:${flavor}:local-library`,
          libraryVisibleOffline,
          "library renders with network emulated offline",
        );
      } catch (error) {
        record(
          `offline:${flavor}:local-library`,
          false,
          `setOffline unsupported: ${String(error?.message ?? error)}`,
        );
      }

      // ---- local media: REAL file-picker import + REAL playback ----
      if (mediaFile !== undefined) {
        try {
          await page
            .getByRole("button", { name: "Library", exact: true })
            .click({ timeout: 5_000 });
          await page
            .locator('[data-testid="library-import-local-files"]')
            .click({ timeout: 5_000 });
          await page.setInputFiles('[data-testid="webflix-local-file-input"]', mediaFile, {
            timeout: 10_000,
          });
          const entryRow = page.locator("li", { hasText: "local file" }).first();
          await entryRow.waitFor({ state: "visible", timeout: 10_000 });
          const entryText = await entryRow.innerText();
          record(
            `local-media:${flavor}:import`,
            true,
            `picker import → library entry "${entryText.replace(/\n/g, " ").slice(0, 80)}"`,
          );
          await page.screenshot({ path: join(outDir, `04-${flavor}-library-imported.png`) });
          await entryRow.getByRole("button", { name: /^Play / }).click({ timeout: 5_000 });
          const player = page.locator('[data-testid="watch-local-player"]');
          await player.waitFor({ state: "attached", timeout: 10_000 });
          await page.evaluate(() => {
            const video = document.querySelector('[data-testid="watch-local-player"]');
            if (video !== null) void video.play();
          });
          await page.waitForFunction(
            () => {
              const video = document.querySelector('[data-testid="watch-local-player"]');
              return (
                video !== null &&
                video.readyState >= 2 &&
                video.currentTime > 0 &&
                video.duration > 0 &&
                !video.paused
              );
            },
            null,
            { timeout: 15_000 },
          );
          const playerState = await page.evaluate(() => {
            const video = document.querySelector('[data-testid="watch-local-player"]');
            return video === null
              ? null
              : {
                  currentTime: video.currentTime,
                  duration: video.duration,
                  paused: video.paused,
                  src: video.src.slice(0, 40),
                };
          });
          record(
            `local-media:${flavor}:playback`,
            playerState !== null && playerState.currentTime > 0 && !playerState.paused,
            playerState === null
              ? "player detached"
              : `playing: t=${playerState.currentTime.toFixed(2)}s/${playerState.duration.toFixed(2)}s src=${playerState.src}`,
          );
          await page.screenshot({ path: join(outDir, `05-${flavor}-watch-player.png`) });
        } catch (error) {
          record(`local-media:${flavor}:import`, false, String(error?.message ?? error));
        }
      } else {
        record(
          `local-media:${flavor}:import`,
          false,
          "BLOCKED: no --media file provided (generate the 3s clip with the documented ffmpeg command)",
          true,
        );
        record(`local-media:${flavor}:playback`, false, "BLOCKED: no --media file provided", true);
      }

      // leave the network in the state we found it
      await page
        .context()
        .setOffline(false)
        .catch(() => {});
    }

    // ---- updater + isolation markers from the PACKAGED log ----
    const packagedLogText = run.lines.join("\n");
    const updaterGuard =
      /refused \(disabled for this desktop product flavor\)|disabled for this desktop product flavor/.test(
        packagedLogText,
      );
    record(
      `updater:${flavor}:fail-closed`,
      updaterGuard,
      updaterGuard
        ? "packaged boot refused the ZCode updater (flavor guard fired)"
        : "no updater refusal marker in the packaged log",
    );
    const crashHits = scanForCrashPatterns(packagedLogText);
    record(
      `crash:${flavor}:no-native-module-errors`,
      crashHits.length === 0,
      crashHits.length === 0
        ? "no module/dlopen errors in the packaged log"
        : crashHits.join(" | "),
    );
    const stillAlive = exitCode === null;
    record(
      `crash:${flavor}:process-alive`,
      stillAlive,
      stillAlive
        ? "packaged process alive through the interaction phase"
        : `process exited early: code=${exitCode}`,
    );

    // ---- clean shutdown ----
    run.child.kill("SIGTERM");
    let shutdownDeadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (exitCode === null && Date.now() < shutdownDeadline) await sleep(300);
    if (exitCode === null) {
      run.child.kill("SIGKILL");
      record(`shutdown:${flavor}:clean`, false, "SIGTERM did not exit in 20s; SIGKILLed");
    } else {
      record(
        `shutdown:${flavor}:clean`,
        exitCode === 0 || exitCode === 143,
        `exit=${exitCode} after SIGTERM`,
      );
    }

    // ---- data roots (the packaged identity contract) ----
    const webflixRoot = join(homeDir, ".webflix");
    record(`data-root:${flavor}:webflix`, existsSync(webflixRoot), webflixRoot);
    const zcodeRoot = join(homeDir, ".zcode");
    if (existsSync(zcodeRoot)) {
      const zcodeFiles = [];
      const walk = (dir, depth) => {
        if (depth > 3) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          zcodeFiles.push(full.replace(zcodeRoot, "~/.zcode"));
          if (entry.isDirectory()) walk(full, depth + 1);
        }
      };
      walk(zcodeRoot, 0);
      record(
        `data-root:${flavor}:no-zcode-root`,
        false,
        `FINDING: WebFlix packaged runtime created ~/.zcode: ${zcodeFiles.slice(0, 6).join(", ")} (inherited zcode-agent session store; evidence doc records the leak)`,
      );
    } else {
      record(`data-root:${flavor}:no-zcode-root`, true, "~/.zcode absent");
    }

    // ---- crashpad dump check (after exit, dumps would have landed) ----
    const dumps = crashDumps(join(homeDir, ".webflix", "v2", "crash", "live"));
    record(
      `crash:${flavor}:no-crash-dumps`,
      dumps.length === 0,
      dumps.length === 0 ? "no crashpad dumps (live dir holds only client_id)" : dumps.join(", "),
    );

    // ---- user-level desktop entry the deep-link lane wrote ----
    const userAppsDir = join(homeDir, ".local", "share", "applications");
    const userEntries = existsSync(userAppsDir) ? readdirSync(userAppsDir) : [];
    if (userEntries.length === 0) {
      record(`desktop-entry:${flavor}:user-level`, true, "no user-level desktop entries written");
    } else {
      const detail = [];
      let identityOk = true;
      for (const name of userEntries) {
        const fields = readDesktopEntryFields(join(userAppsDir, name));
        detail.push(
          `${name}: Name=${fields?.Name} Icon=${fields?.Icon} MimeType=${fields?.MimeType}`,
        );
        if (
          /zcode/i.test(name) ||
          fields?.Icon === "zcode" ||
          fields?.Comment === "ZCode Desktop App"
        ) {
          identityOk = false;
        }
      }
      record(
        `desktop-entry:${flavor}:user-level`,
        identityOk,
        identityOk
          ? detail.join("; ")
          : `FINDING: user-level entry carries ZCode-branded fields: ${detail.join("; ")}`,
      );
    }

    // ---- restart: same HOME, clean second boot ----
    const secondRun = launchApp();
    let secondExit = null;
    secondRun.child.on("exit", (code) => {
      secondExit = code;
    });
    const secondBoot = await waitForBootEvidence(secondRun.lines, BOOT_TIMEOUT_MS);
    record(
      `restart:${flavor}:boot`,
      secondBoot.window && secondBoot.domReady,
      `second launch on the same HOME: window=${secondBoot.window} dom-ready=${secondBoot.domReady}`,
    );
    let restartTitleOk = false;
    let restartLibraryHonest = false;
    try {
      await waitForHttp(
        `http://127.0.0.1:${cdpPort}/json/version`,
        CDP_TIMEOUT_MS,
        "CDP endpoint (restart)",
      );
      const { chromium } = require(require.resolve("playwright-core", { paths: [pkgRoot] }));
      const secondBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      let secondPage = null;
      const secondPageDeadline = Date.now() + 30_000;
      while (secondPage === null && Date.now() < secondPageDeadline) {
        for (const context of secondBrowser.contexts()) {
          for (const candidate of context.pages()) {
            if (candidate.url().startsWith("file:")) secondPage = candidate;
          }
        }
        if (secondPage === null) await sleep(500);
      }
      if (secondPage !== null) {
        await secondPage.waitForFunction(() => document.title === "WebFlix", null, {
          timeout: 30_000,
        });
        restartTitleOk = true;
        await secondPage
          .getByRole("button", { name: "Library", exact: true })
          .click({ timeout: 5_000 });
        const emptyState = await secondPage
          .locator('[data-testid="library-local-empty"]')
          .innerText()
          .catch(() => null);
        restartLibraryHonest = emptyState !== null && /session-only/i.test(emptyState);
        await secondPage.screenshot({ path: join(outDir, `06-${flavor}-restart-library.png`) });
      }
      await secondBrowser.close();
    } catch (error) {
      record(`restart:${flavor}:cdp`, false, String(error?.message ?? error));
    }
    record(
      `restart:${flavor}:identity`,
      restartTitleOk,
      restartTitleOk
        ? "second boot restores the WebFlix identity"
        : "second boot did not reach the WebFlix title",
    );
    record(
      `restart:${flavor}:session-library-honest-empty`,
      restartLibraryHonest,
      restartLibraryHonest
        ? "library honestly empty again (session-only entries — documented truthfulness)"
        : "session-only empty state not observed after restart",
    );
    secondRun.child.kill("SIGTERM");
    shutdownDeadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (secondExit === null && Date.now() < shutdownDeadline) await sleep(300);
    if (secondExit === null) secondRun.child.kill("SIGKILL");
    record(
      `restart:${flavor}:shutdown`,
      secondExit === 0 || secondExit === 143,
      `second run exit=${secondExit}`,
    );
    writeFileSync(mainLogPath, [...run.lines, "--- restart ---", ...secondRun.lines].join("\n"));

    // ---- packaged tree static identity surfaces ----
    assertDesktopEntryIdentity(desktopEntry, `${flavor}-installed-entry`, flavor);
    if (flavor === "deb" && debFile !== undefined) {
      const control = spawnSync("dpkg-deb", ["-f", debFile], { stdio: "pipe" });
      const controlText = control.stdout?.toString() ?? "";
      const packageName = /^Package: (.+)$/m.exec(controlText)?.[1];
      // dpkg control allows `Description:` on its own line with the synopsis
      // on the following indented line(s) — this deb uses exactly that form.
      let description = /^Description:[ \t]*(.*)$/m.exec(controlText)?.[1]?.trim() ?? "";
      if (description === "") {
        const after = controlText.slice(controlText.indexOf("Description:"));
        description = /^[ \t]+(.+)$/m.exec(after)?.[1]?.trim() ?? "";
      }
      record(
        `packaged-deb:${flavor}:control`,
        packageName === "webflix-desktop" && description === "WebFlix Desktop App",
        `Package=${packageName} Description=${description}`,
      );
    }
    const iconDir = flavor === "deb" ? join(tree, "usr", "share", "icons", "hicolor") : null;
    if (iconDir !== null) {
      let iconCount = 0;
      for (const size of readdirSync(iconDir)) {
        const candidate = join(iconDir, size, "apps", "webflix.png");
        if (existsSync(candidate) && statSync(candidate).size > 0) iconCount += 1;
      }
      record(
        `packaged-deb:${flavor}:icons`,
        iconCount >= 8,
        `${iconCount} hicolor sizes of webflix.png`,
      );
    }
  } finally {
    if (playwrightBrowser !== null) await playwrightBrowser.close().catch(() => {});
    if (run.child.exitCode === null) run.child.kill("SIGKILL");
    try {
      xvfb.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    await sleep(500);
  }
  return homeDir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out ?? join(tmpdir(), `webflix-packaged-smoke-${Date.now()}`));
  mkdirSync(outDir, { recursive: true });
  console.log(`[smoke:packaged] evidence dir: ${outDir}`);

  if (args.deb !== undefined) {
    console.log(`[smoke:packaged] deb lane: ${args.deb}`);
    const extracted = extractDeb(resolve(args.deb), outDir);
    await runPackagedSmoke({
      flavor: "deb",
      executable: extracted.executable,
      tree: extracted.tree,
      desktopEntry: extracted.desktopEntry,
      appRunWrapper: false,
      outDir,
      debFile: resolve(args.deb),
      mediaFile: args.media !== undefined ? resolve(args.media) : undefined,
    });
  }

  if (args.appimage !== undefined) {
    console.log(`[smoke:packaged] appimage lane: ${args.appimage}`);
    const extracted = extractAppImage(resolve(args.appimage), outDir);
    await runPackagedSmoke({
      flavor: "appimage",
      executable: extracted.executable,
      tree: extracted.tree,
      desktopEntry: extracted.desktopEntry,
      appRunWrapper: true,
      outDir,
      mediaFile: args.media !== undefined ? resolve(args.media) : undefined,
    });
  }

  const failed = results.filter((r) => !r.ok && !r.blocked);
  const blocked = results.filter((r) => r.blocked);
  writeFileSync(join(outDir, "results.json"), `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(
    `\n[smoke:packaged] ${results.length - failed.length - blocked.length}/${results.length} assertions passed, ${failed.length} failed, ${blocked.length} blocked`,
  );
  console.log(`[smoke:packaged] evidence: ${outDir} (main-*.log, results.json, PNG screenshots)`);
  if (failed.length > 0 || blocked.length > 0) {
    for (const r of [...failed, ...blocked]) {
      console.log(`  ${r.blocked ? "BLOCKED" : "FAILED"}: ${r.name} — ${r.detail}`);
    }
  }
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[smoke:packaged] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
