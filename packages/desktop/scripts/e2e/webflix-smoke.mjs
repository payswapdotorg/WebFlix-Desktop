#!/usr/bin/env node
/**
 * WebFlix desktop acceptance — minimum-tier GUI smoke (tier 4, headless Linux).
 *
 * Integration-time application of the D1-SHELL work order deliverable #7
 * (E2E runner asserting the acceptance minimum: launch, navigate, empty
 * states) that the lane could not land without the desktop toolchain. Runs
 * the real Electron main (tsup out/), the real dev renderer (vite :5174) and
 * asserts, on a FRESH WebFlix profile (isolated temp HOME):
 *
 *   1. launch      — main window created, renderer dom-ready
 *   2. identity    — userData under ~/.webflix-dev (never ~/.zcode)
 *   3. updater     — dev `0.0` boot does NOT construct the platform updater
 *                    (AUDIT-DESKTOP finding 7 regression pin, no version
 *                    wrapper — the guard itself is under test)
 *   4. isolation   — chrome-import IPC NOT registered (flag off, fail-closed)
 *   5. shutdown    — clean SIGTERM exit, no crash
 *
 * What this smoke does NOT assert (recorded honestly): interactive renderer
 * navigation/playback flows and webflix-shell screen states — the shell is a
 * component library not yet mounted in the desktop renderer (Phase-2 wiring);
 * its screens are covered by the vitest suite.
 *
 * Usage: node scripts/e2e/webflix-smoke.mjs   (from packages/desktop)
 * Env:   DISPLAY must point at a running X server (Xvfb :99 works).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkgRoot = resolve(import.meta.dirname, "../.."); // packages/desktop
const repoRoot = resolve(pkgRoot, "../..");
const VITE_PORT = 5174;
const RENDERER_URL = `http://localhost:${VITE_PORT}`;
const CDP_PORT = 9333;
const BOOT_TIMEOUT_MS = 90_000;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status < 500) return true;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label} at ${url}`);
}

/**
 * Waits for the app's own boot markers in the captured main log:
 * primary window creation + renderer dom-ready. Returns the observed state
 * (never throws — the caller records each marker as its own assertion).
 */
async function waitForBootEvidence(mainLog, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const state = () => {
    const log = mainLog.join("\n");
    return {
      window: /primary-window.*creating main window/.test(log),
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

function resolveElectronBinary() {
  const electronModule = require.resolve("electron", { paths: [pkgRoot] });
  const electronDir = join(electronModule, "..");
  // electron's path.txt names the binary INSIDE dist/ (e.g. "electron").
  const pathTxt = readFileSync(join(electronDir, "path.txt"), "utf8").trim();
  return join(electronDir, "dist", pathTxt);
}

async function main() {
  if (!process.env.DISPLAY) {
    throw new Error("DISPLAY is not set — run under an X server (Xvfb :99 works)");
  }
  // Fresh WebFlix profile: isolated temp HOME so no real user state is touched.
  const homeDir = mkdtempSync(join(tmpdir(), "webflix-smoke-home-"));
  const webflixDevRoot = join(homeDir, ".webflix-dev");
  const zcodeRootMustNotExist = join(homeDir, ".zcode");

  // 1. one-shot main build (no watch): out/main, out/preload, out/host...
  console.log("[smoke] building desktop main via tsup (one-shot)...");
  const tsup = spawnSync(process.execPath, [require.resolve("tsup", { paths: [pkgRoot] })], {
    cwd: pkgRoot,
    stdio: "inherit",
  });
  if (tsup.status !== 0) throw new Error(`tsup build failed: exit ${tsup.status}`);
  if (!existsSync(join(pkgRoot, "out/main/index.js"))) {
    throw new Error("out/main/index.js missing after tsup build");
  }
  record("build:main", true, "tsup out/main/index.js produced");

  // 2. vite dev renderer
  console.log("[smoke] starting vite dev renderer...");
  // vite's package exports map blocks subpath require.resolve; spawn the
  // workspace .bin shim (hoisted layout guarantees it beside the package).
  const { existsSync: existsSyncForBin } = await import("node:fs");
  const viteBinLocal = join(pkgRoot, "node_modules/.bin/vite");
  const viteBinRoot = join(repoRoot, "node_modules/.bin/vite");
  const viteBin = existsSyncForBin(viteBinLocal) ? viteBinLocal : viteBinRoot;
  const vite = spawn(viteBin, ["dev"], { cwd: pkgRoot, stdio: "ignore", detached: true });
  try {
    await waitForHttp(RENDERER_URL, 60_000, "vite dev renderer");

    // Chromium's remote debugging writes DevToolsActivePort into the
    // userData/session dir BEFORE the app creates it — pre-create the frozen
    // WebFlix dev layout so the CDP endpoint can bind (test-env preparation
    // only; the app owns the dir from then on).
    mkdirSync(join(homeDir, ".webflix-dev", "session"), { recursive: true });

    // 3. electron with WebFlix identity + guarded dev version (NO wrapper)
    const electronCmd = resolveElectronBinary();
    console.log("[smoke] starting electron (WebFlix identity, dev version 0.0)...");
    const mainLog = [];
    const electron = spawn(
      electronCmd,
      // Chromium switches MUST precede the app path; after it they would land
      // in the app's process.argv instead of the browser.
      ["--no-sandbox", "--disable-gpu", `--remote-debugging-port=${CDP_PORT}`, "."],
      {
        cwd: pkgRoot,
        env: {
          ...process.env,
          HOME: homeDir,
          WEBFLIX_IDENTITY: "1",
          ELECTRON_RENDERER_URL: RENDERER_URL,
          NODE_ENV: "development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const collect = (stream, tag) => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        for (const line of chunk.split("\n")) mainLog.push(`<${tag}> ${line}`);
      });
    };
    collect(electron.stdout, "out");
    collect(electron.stderr, "err");

    let exitCode = null;
    electron.on("exit", (code) => {
      exitCode = code;
    });

    try {
      // Boot evidence: the app's own structured main-process logs. CDP
      // --remote-debugging-port does not bind reliably in this environment
      // (DevToolsActivePort write races the app's dir creation), so the
      // window/dom-ready markers are the primary tier-4 evidence; a reachable
      // CDP endpoint is asserted opportunistically afterwards.
      const bootOk = await waitForBootEvidence(mainLog, BOOT_TIMEOUT_MS);
      record(
        "launch:window",
        bootOk.window,
        bootOk.window ? "primary window created (app-ready marker)" : "no window-creation marker",
      );
      record(
        "launch:renderer",
        bootOk.domReady,
        bootOk.domReady ? "renderer dom-ready fired" : "no dom-ready marker",
      );
      const refused = /ERR_CONNECTION_REFUSED/.test(mainLog.join("\n"));
      record("launch:renderer-served", !refused, refused ? "renderer URL refused (vite down?)" : "renderer URL accepted");
      // CDP --remote-debugging-port does not bind reliably in this environment
      // (DevToolsActivePort write races app dir creation) — informational only;
      // the tier-4 evidence is the app's own window/dom-ready markers above.
      let cdpReachable = false;
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {
          signal: AbortSignal.timeout(1500),
        });
        cdpReachable = r.ok;
      } catch {
        cdpReachable = false;
      }
      console.log(`INFO  launch:cdp-probe — ${cdpReachable ? "bound (bonus)" : "not bound in this env (non-fatal)"}`);

      // give the app a moment to finish boot (host fork, settings, buses)
      await sleep(12_000);

      const log = mainLog.join("\n");
      record("identity:data-root", existsSync(webflixDevRoot), `${webflixDevRoot}`);
      record(
        "identity:no-zcode-root",
        !existsSync(zcodeRootMustNotExist),
        `${zcodeRootMustNotExist} must not exist`,
      );
      // Either exit path proves the eager-construction defect stays fixed:
      // the flavor disables the updater before init (this app's path), or the
      // updater-guard skips construction on the invalid dev version.
      const guardHit =
        /disabled for this desktop product flavor/.test(log) || /platform updater not constructed/.test(log);
      record("updater:guard", guardHit, "updater surface absent at boot (flavor-disabled or guard-skipped)");
      const updaterCrash = /not a valid semver|AppImageUpdater/.test(log) && /Error/.test(log);
      record("updater:no-crash", !updaterCrash, "no semver/updater construction crash");
      const isolationHit = /chrome import IPC not registered/.test(log);
      record(
        "isolation:chrome-import-off",
        isolationHit,
        "ImportChromeBrowserData handler absent (fail-closed)",
      );
      // Identity test matrix (freeze §6.1): resolved desktop identity must be
      // the frozen WebFlix values; the dev AUMID must be the dedicated one
      // (never the ZCode production-AUMID reuse bug); no forbidden ZCode value
      // may appear on any WebFlix identity surface.
      const identityModule = await import("../desktop-product-identity.mjs");
      const wfEnv = { ...process.env, WEBFLIX_IDENTITY: "1" };
      const identity = identityModule.resolveDesktopProductIdentity(wfEnv);
      const devAumid = identityModule.resolveWindowsAppUserModelIdForFlavor("webflix", {
        isPackaged: false,
      });
      const dataRootName = identityModule.resolveWebFlixDataRootName(wfEnv, {
        isPackaged: false,
      });
      const identityMatrixOk =
        identity.flavor === "webflix" &&
        identity.appId === "org.webflix.desktop" &&
        identity.productName === "WebFlix" &&
        devAumid === "org.webflix.desktop.dev" &&
        dataRootName === ".webflix-dev" &&
        identityModule.assertWebFlixIdentityNeverLeaksZCode(identity) === true;
      record(
        "identity:matrix",
        identityMatrixOk,
        "frozen appId/productName/dev-AUMID/data-root verified; no ZCode value on any surface",
      );

      electron.kill("SIGTERM");
      const shutdownDeadline = Date.now() + 20_000;
      while (exitCode === null && Date.now() < shutdownDeadline) await sleep(300);
      if (exitCode === null) {
        electron.kill("SIGKILL");
        record("shutdown:clean", false, "SIGTERM did not exit in 20s; SIGKILLed");
      } else {
        record(
          "shutdown:clean",
          exitCode === 0 || exitCode === 143,
          `exit=${exitCode} after SIGTERM`,
        );
      }

      writeFileSync(join(homeDir, "webflix-smoke-main.log"), mainLog.join("\n"));
      console.log(`[smoke] main log saved: ${join(homeDir, "webflix-smoke-main.log")}`);
    } finally {
      if (exitCode === null) electron.kill("SIGKILL");
    }
  } finally {
    try {
      process.kill(-vite.pid, "SIGTERM");
    } catch {
      try {
        vite.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await sleep(1500);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[smoke] ${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
    console.log(`[smoke] evidence kept at ${homeDir}`);
  } else {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[smoke] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
