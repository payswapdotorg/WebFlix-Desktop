#!/usr/bin/env node
/* eslint-disable max-lines -- 单个可审计的 packaged-composer 证据面：一次运行把启动/面板/组合器挂载/重开/关机全部断言留在同一文件里，与 results.json 一一对应（packaged-smoke 的同一条法）。 */
/**
 * WebFlix desktop acceptance — the PACKAGED-tier agent composer mount.
 *
 * The journey's `wfx-agent:composer-mounted` gate is BLOCKED in the dev lane
 * by design: the lazy @zcode/ui chat-surface chunk under vite's on-demand
 * compilation does not mount inside the journey window on this station class
 * (and the sandbox cannot sustain a renderer reload). The packaged tier's
 * PREBUILT renderer bundle — where that chunk is a static asset and the host
 * utility process (the full ZCode agent runtime) is spawned from the packaged
 * runtime assets — is this gate's proper venue (journey record, wfx-05).
 *
 * This harness closes that gate honestly: it launches the REAL packaged
 * artifact (never the dev server), opens the agent panel with a REAL click
 * on the REAL toggle, and asserts:
 *
 *   1. launch        — packaged binary creates the primary window, renderer
 *                      dom-ready fires (the app's own structured log markers).
 *   2. panel-open    — the agent panel mounts with its honest surface (title
 *                      or one of the typed state boxes; never empty).
 *   3. chat-surface  — the lazy @zcode/ui chat surface root mounts inside
 *                      the panel (the runtime admission completed: main
 *                      spawned the host utility process, the ServicePort
 *                      paired, the lazy chunk loaded from the prebuilt
 *                      bundle).
 *   4. composer      — the REAL chat composer input (textarea / contenteditable
 *                      / text input — the same selector contract as the
 *                      journey's gate) is mounted and interactable.
 *   5. reopen        — close + reopen the panel remounts the composer within
 *                      a short window (the single-admission cache law:
 *                      closing the panel never disposes the runtime).
 *   6. host-spawn    — the packaged main log carries the host utility
 *                      process fork marker (auxiliary admission evidence).
 *   7. shutdown      — SIGTERM exits cleanly (0/143).
 *
 * NOT claimed here (recorded as the standing honest BLOCKED, never a pass):
 * live model/provider chat round-trips need a configured provider credential
 * in the profile — this harness proves the composer MOUNTS, not that it can
 * talk to a provider.
 *
 * Usage (from packages/desktop):
 *   node scripts/e2e/webflix-packaged-composer.mjs \
 *     --deb /path/to/WebFlix-<ver>-linux-amd64.deb \
 *     --appimage /path/to/WebFlix-<ver>-linux-x86_64.AppImage \
 *     --out /path/to/evidence-dir
 *   (--deb and --appimage are independently optional; run one per lane.)
 *
 * Env: display ONLY through this script's own Xvfb (spawned/killed per run);
 * no FUSE required (AppImage uses --appimage-extract); rootless dpkg-deb -x;
 * fresh throwaway HOME per lane — no real user state is touched.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import net from "node:net";

const require = createRequire(import.meta.url);
const pkgRoot = resolve(import.meta.dirname, "../.."); // packages/desktop
const BOOT_TIMEOUT_MS = 90_000;
const CDP_TIMEOUT_MS = 60_000;
const SHELL_TIMEOUT_MS = 45_000;
/** The composer window: admission guard is 30s + lazy chunk + first-boot CLI
 * database init on a fresh HOME — 150s is generous but never infinite. */
const COMPOSER_TIMEOUT_MS = 150_000;
/** The reopen window: the single-admission cache law promises this is fast. */
const REOPEN_TIMEOUT_MS = 20_000;
const SHUTDOWN_TIMEOUT_MS = 20_000;

/** The journey's composer selector contract, verbatim (the gate being closed). */
const COMPOSER_SELECTOR =
  '[data-testid="agent-panel"] textarea, [data-testid="agent-panel"] [contenteditable="true"], [data-testid="agent-panel"] input[type="text"]';

/** CLI args (same explicitness law as the packaged smoke). */
function parseArgs(argv) {
  const args = { deb: undefined, appimage: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--deb" || key === "--appimage" || key === "--out") {
      args[key.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${key}`);
    }
  }
  if (args.deb === undefined && args.appimage === undefined) {
    throw new Error("nothing to test: pass --deb and/or --appimage");
  }
  for (const flag of ["deb", "appimage"]) {
    if (args[flag] !== undefined && !existsSync(args[flag])) {
      throw new Error(`--${flag} path does not exist: ${args[flag]}`);
    }
  }
  return args;
}

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

function findFreeDisplay() {
  for (let display = 99; display < 140; display += 1) {
    const socket = `/tmp/.X11-unix/X${display}`;
    const lock = `/tmp/.X${display}-lock`;
    if (!existsSync(socket) && !existsSync(lock)) return display;
  }
  throw new Error("no free X display number in 99..139");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same record contract as the packaged smoke (blocked never counts as passed). */
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

/** Rootless .deb tree extraction (same as the packaged smoke). */
function extractDeb(debPath, outDir) {
  const tree = join(outDir, "deb-tree");
  mkdirSync(tree, { recursive: true });
  const res = spawnSync("dpkg-deb", ["-x", debPath, tree], { stdio: "pipe" });
  if (res.status !== 0) throw new Error(`dpkg-deb -x failed: ${res.stderr}`);
  const executable = join(tree, "opt", "WebFlix", "webflix");
  if (!existsSync(executable)) throw new Error(`deb tree missing ${executable}`);
  return { tree, executable };
}

/** AppImage extract-first (the documented no-FUSE path, same as the smoke). */
function extractAppImage(appImagePath, outDir) {
  const dir = join(outDir, "appimage-run");
  mkdirSync(dir, { recursive: true });
  const res = spawnSync(appImagePath, ["--appimage-extract"], { stdio: "pipe", cwd: dir });
  const tree = join(dir, "squashfs-root");
  if (res.status !== 0 || !existsSync(join(tree, "AppRun"))) {
    throw new Error(`--appimage-extract failed: ${res.stderr}`);
  }
  return { tree, executable: join(tree, "AppRun") };
}

/**
 * One packaged lane: launch → panel → composer → reopen → shutdown. Every
 * finding lands through record(); evidence (main log, PNGs, results.json)
 * lands in `outDir`.
 */
async function runPackagedComposer({ flavor, executable, tree, outDir }) {
  const homeDir = join(outDir, `home-${flavor}`);
  mkdirSync(homeDir, { recursive: true });
  // DevToolsActivePort lands in userData before the app creates the dir (the
  // race the dev smoke documents) — pre-create the frozen packaged layout.
  mkdirSync(join(homeDir, ".webflix", "session"), { recursive: true });
  const mainLogPath = join(outDir, `composer-main-${flavor}.log`);

  const display = findFreeDisplay();
  const xvfb = spawn("Xvfb", [`:${display}`, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
    stdio: "ignore",
    detached: false,
  });
  const displaySocket = `/tmp/.X11-unix/X${display}`;
  const xvfbDeadline = Date.now() + 15_000;
  while (!existsSync(displaySocket) && Date.now() < xvfbDeadline) await sleep(200);
  if (!existsSync(displaySocket)) throw new Error(`Xvfb :${display} did not come up`);

  const cdpPort = await findFreePort();
  const appArgs = [
    "--remote-debugging-port=" + cdpPort,
    "--disable-gpu",
    ...(flavor === "appimage" ? ["--no-sandbox"] : []),
  ];
  const appEnv = {
    ...process.env,
    HOME: homeDir,
    DISPLAY: `:${display}`,
    ...(flavor === "appimage" ? { APPDIR: tree } : {}),
  };

  let playwrightBrowser = null;
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
  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
  });

  try {
    // ---- 1. launch (the app's own structured markers) ----
    const bootOk = await waitForBootEvidence(lines, BOOT_TIMEOUT_MS);
    record(
      `composer:${flavor}:launch`,
      bootOk.window && bootOk.domReady,
      bootOk.window && bootOk.domReady
        ? "primary window + renderer dom-ready (packaged log markers)"
        : `window=${bootOk.window} domReady=${bootOk.domReady}`,
    );

    // ---- CDP attach ----
    let page = null;
    try {
      await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`, CDP_TIMEOUT_MS, "CDP endpoint");
      const { chromium } = require(require.resolve("playwright-core", { paths: [pkgRoot] }));
      playwrightBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
      const pageDeadline = Date.now() + 30_000;
      while (page === null && Date.now() < pageDeadline) {
        for (const context of playwrightBrowser.contexts()) {
          for (const candidate of context.pages()) {
            if (candidate.url().startsWith("file:")) page = candidate;
          }
        }
        if (page === null) await sleep(500);
      }
      if (page === null) throw new Error("no file:// page target on the CDP endpoint");
      await page.waitForFunction(() => document.title === "WebFlix", null, { timeout: 30_000 });
      record(
        `composer:${flavor}:cdp-attached`,
        true,
        `packaged renderer page ${page.url().slice(0, 64)}…`,
      );
    } catch (error) {
      record(`composer:${flavor}:cdp-attached`, false, String(error?.message ?? error));
    }

    if (page !== null) {
      // ---- 2. panel-open (a REAL click on the REAL toggle) ----
      await page.waitForSelector('[data-testid="agent-panel-toggle"]', {
        timeout: SHELL_TIMEOUT_MS,
      });
      await page.click('[data-testid="agent-panel-toggle"]');
      await page.waitForSelector('[data-testid="agent-panel"]', { timeout: 30_000 });
      const panelText = await page
        .locator('[data-testid="agent-panel"]')
        .innerText({ timeout: 10_000 })
        .catch(() => "");
      const panelHonest =
        panelText.length > 0 &&
        (/agent|chat|model|runtime|workspace|connect|composer/i.test(panelText) ||
          panelText.includes("could not be prepared"));
      record(
        `composer:${flavor}:panel-open`,
        panelHonest,
        panelHonest
          ? `the agent panel opened: "${panelText.slice(0, 100).replace(/\n/g, " | ")}…"`
          : "the panel mounted but rendered no honest content",
      );
      await page.screenshot({ path: join(outDir, `composer-01-${flavor}-panel-open.png`) });

      // Honest-state telemetry across the wait (diagnostics only — every box
      // below is a legitimate phase, recorded in the detail on failure).
      const stateBoxes = {
        connecting: '[data-testid="agent-panel-connecting"]',
        unavailable: '[data-testid="agent-panel-unavailable"]',
        loadingSurface: '[data-testid="agent-panel-loading-surface"]',
        surfaceError: '[data-testid="agent-panel-surface-error"]',
      };

      // ---- 3. chat-surface (the lazy @zcode/ui root over the admission) ----
      const surfaceDeadline = Date.now() + COMPOSER_TIMEOUT_MS;
      let surfaceCount = 0;
      while (Date.now() < surfaceDeadline && surfaceCount === 0) {
        surfaceCount = await page
          .locator('[data-testid="agent-zcode-surface-root"]')
          .count()
          .catch(() => 0);
        if (surfaceCount === 0) await sleep(1000);
      }
      record(
        `composer:${flavor}:chat-surface`,
        surfaceCount > 0,
        surfaceCount > 0
          ? "the lazy @zcode/ui chat surface root mounted (runtime admission paired + prebuilt chunk loaded)"
          : "the chat surface root never mounted inside the window",
      );

      // ---- 4. composer (the journey's gate, its own selector contract) ----
      const composerDeadline = Date.now() + COMPOSER_TIMEOUT_MS;
      let composerCount = 0;
      while (Date.now() < composerDeadline && composerCount === 0) {
        composerCount = await page
          .locator(COMPOSER_SELECTOR)
          .count()
          .catch(() => 0);
        if (composerCount === 0) await sleep(1000);
      }
      let composerDetail = "";
      if (composerCount > 0) {
        const first = page.locator(COMPOSER_SELECTOR).first();
        const visible = await first.isVisible().catch(() => false);
        const enabled = await first.isEnabled().catch(() => false);
        composerDetail = `the real chat composer mounted (${composerCount} input${composerCount === 1 ? "" : "s"}) — visible=${visible} enabled=${enabled} (live round-trips stay BLOCKED: provider credentials)`;
        record(`composer:${flavor}:composer-mounted`, visible, composerDetail);
      } else {
        const states = [];
        for (const [key, selector] of Object.entries(stateBoxes)) {
          const n = await page
            .locator(selector)
            .count()
            .catch(() => 0);
          if (n > 0) states.push(key);
        }
        const panelState = await page
          .locator('[data-testid="agent-panel"]')
          .innerText({ timeout: 5000 })
          .catch(() => "");
        record(
          `composer:${flavor}:composer-mounted`,
          false,
          `the composer did not mount within ${COMPOSER_TIMEOUT_MS / 1000}s — honest states seen: [${states.join(", ") || "none"}]; panel text: "${panelState.slice(0, 160).replace(/\n/g, " | ")}…"`,
        );
      }
      await page.screenshot({ path: join(outDir, `composer-02-${flavor}-composer.png`) });

      // ---- 5. reopen (the single-admission cache law) ----
      let reopenOk = false;
      let reopenDetail = "not attempted";
      if (composerCount > 0) {
        await page.click('[data-testid="agent-panel-close"]');
        await sleep(1200);
        await page.click('[data-testid="agent-panel-toggle"]');
        await page.waitForSelector('[data-testid="agent-panel"]', { timeout: 30_000 });
        const reopenDeadline = Date.now() + REOPEN_TIMEOUT_MS;
        let reopened = 0;
        while (Date.now() < reopenDeadline && reopened === 0) {
          reopened = await page
            .locator(COMPOSER_SELECTOR)
            .count()
            .catch(() => 0);
          if (reopened === 0) await sleep(500);
        }
        reopenOk = reopened > 0;
        reopenDetail = reopenOk
          ? `the composer remounted within ${REOPEN_TIMEOUT_MS / 1000}s of the reopen (the admission cache law: closing never disposes the runtime)`
          : "the composer did not remount after the reopen";
        await page.screenshot({ path: join(outDir, `composer-03-${flavor}-reopen.png`) });
      }
      record(`composer:${flavor}:reopen-cache`, reopenOk, reopenDetail);

      // ---- 6. host-spawn (auxiliary admission evidence from the log) ----
      const hostForked = /\[spawnHostProcess\] forked host process/.test(lines.join("\n"));
      record(
        `composer:${flavor}:host-spawn-marker`,
        hostForked,
        hostForked
          ? "the packaged main log records the host utility process fork"
          : "no host utility fork marker in the packaged log",
      );
    }
  } finally {
    try {
      await playwrightBrowser?.close();
    } catch {
      /* already gone */
    }
    if (exitCode === null) child.kill("SIGTERM");
    const shutdownDeadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    while (exitCode === null && Date.now() < shutdownDeadline) await sleep(300);
    if (exitCode === null) child.kill("SIGKILL");
    record(`composer:${flavor}:shutdown`, exitCode === 0 || exitCode === 143, `exit=${exitCode}`);
    try {
      writeFileSync(mainLogPath, lines.join("\n"));
    } catch {
      /* ignore */
    }
    try {
      xvfb.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    await sleep(500);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out ?? join(tmpdir(), `webflix-packaged-composer-${Date.now()}`));
  mkdirSync(outDir, { recursive: true });
  console.log(`[composer:packaged] evidence dir: ${outDir}`);

  if (args.deb !== undefined) {
    console.log(`[composer:packaged] deb lane: ${args.deb}`);
    const extracted = extractDeb(resolve(args.deb), outDir);
    await runPackagedComposer({
      flavor: "deb",
      executable: extracted.executable,
      tree: extracted.tree,
      outDir,
    });
  }

  if (args.appimage !== undefined) {
    console.log(`[composer:packaged] appimage lane: ${args.appimage}`);
    const extracted = extractAppImage(resolve(args.appimage), outDir);
    await runPackagedComposer({
      flavor: "appimage",
      executable: extracted.executable,
      tree: extracted.tree,
      outDir,
    });
  }

  const failed = results.filter((r) => !r.ok && !r.blocked);
  const blocked = results.filter((r) => r.blocked);
  writeFileSync(join(outDir, "results.json"), `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(
    `\n[composer:packaged] ${results.length - failed.length - blocked.length}/${results.length} assertions passed, ${failed.length} failed, ${blocked.length} blocked`,
  );
  console.log(
    `[composer:packaged] evidence: ${outDir} (composer-main-*.log, results.json, PNG screenshots)`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[composer:packaged] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
