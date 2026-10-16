import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildIdentityScopedCliSessionDbSpawnEnv,
  hasGlobalCliZCodeCuaServer,
  isWebFlixDataRootActive,
  resolveZCodeCliHomeDir,
  setDataBaseDir,
} from "@zcode/services/node";

/*
 * P9-FIX-1 F2 — per-flavor pins for the identity-scoped CLI data root (QA
 * finding data-root:<flavor>:no-zcode-root on the 33681f7 artifacts): the
 * packaged WebFlix runtime's CLI session/config store must resolve under the
 * frozen WebFlix data root (~/.webflix via the paths layer), never ~/.zcode;
 * the ZCODE_HOME env override keeps winning; ZCode flavors keep ~/.zcode
 * unchanged; flavor-resolution failure fails loud (typed log line).
 *
 * The resolution under test lives in @zcode/services (paths.ts +
 * node.ts CLI-home sites); these pins ride the desktop-main battery glob
 * because the root vitest battery collects no services-side test location
 * (vitest.config.ts include list) — the desktop main package already imports
 * @zcode/services/node in this battery (desktopRuntimeEnv.test.ts chain).
 */

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of ["WEBFLIX_IDENTITY", "WEBFLIX_DATA_ROOT", "ZCODE_HOME"]) {
    SAVED_ENV[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const tempDirs: string[] = [];

function createTempBaseDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wf-cli-home-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
  delete process.env.ZCODE_HOME;
});

afterEach(() => {
  setDataBaseDir(null);
  restoreEnv();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function activateWebFlixIdentity(baseDir: string, rootName = ".webflix"): void {
  process.env.WEBFLIX_IDENTITY = "1";
  process.env.WEBFLIX_DATA_ROOT = rootName;
  setDataBaseDir(baseDir);
}

function createSpyLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("P9-FIX-1 F2 — resolveZCodeCliHomeDir per flavor", () => {
  it("ZCode flavor keeps {dataBaseDir}/.zcode unchanged", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    expect(resolveZCodeCliHomeDir()).toBe(join(baseDir, ".zcode"));
  });

  it("WebFlix identity resolves under the frozen data root, never ~/.zcode", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    const cliHome = resolveZCodeCliHomeDir();
    expect(cliHome).toBe(join(baseDir, ".webflix"));
    expect(cliHome).not.toContain(".zcode");
    expect(isWebFlixDataRootActive()).toBe(true);
  });

  it("ZCODE_HOME explicit override wins in BOTH flavors (operator override)", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    expect(resolveZCodeCliHomeDir({ ZCODE_HOME: "/opt/zcode-home" })).toBe("/opt/zcode-home");

    activateWebFlixIdentity(baseDir);
    expect(resolveZCodeCliHomeDir({ ZCODE_HOME: "/opt/webflix-home" })).toBe("/opt/webflix-home");
  });

  it("isWebFlixDataRootActive stays false for the default ZCode identity", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    expect(isWebFlixDataRootActive()).toBe(false);
  });

  it("invalid identity state still throws fail-closed (no silent ZCode fallback)", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    process.env.WEBFLIX_IDENTITY = "true";
    expect(() => resolveZCodeCliHomeDir()).toThrow(/invalid WEBFLIX_IDENTITY/);

    process.env.WEBFLIX_IDENTITY = "1";
    delete process.env.WEBFLIX_DATA_ROOT;
    expect(() => resolveZCodeCliHomeDir()).toThrow(/WEBFLIX_DATA_ROOT/);
  });
});

describe("P9-FIX-1 F2 — agent spawn env: identity-scoped CLI session DB", () => {
  it("ZCode flavor injects NOTHING (agent behavior byte-identical)", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    expect(buildIdentityScopedCliSessionDbSpawnEnv({}, createSpyLogger())).toEqual({});
  });

  it("WebFlix identity pins the session DB under ~/.webflix/cli/db/db.sqlite", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    expect(buildIdentityScopedCliSessionDbSpawnEnv({}, createSpyLogger())).toEqual({
      ZCODE_SESSION_DB_PATH: join(baseDir, ".webflix", "cli", "db", "db.sqlite"),
    });
  });

  it("ZCODE_HOME override wins for the WebFlix session DB too", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    expect(
      buildIdentityScopedCliSessionDbSpawnEnv({ ZCODE_HOME: "/opt/home" }, createSpyLogger()),
    ).toEqual({ ZCODE_SESSION_DB_PATH: join("/opt/home", "cli", "db", "db.sqlite") });
  });

  it("explicit ZCODE_SESSION_DB_PATH / ZCODE_SESSION_DB operator overrides win", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    expect(
      buildIdentityScopedCliSessionDbSpawnEnv(
        { ZCODE_SESSION_DB_PATH: "/custom/db.sqlite" },
        createSpyLogger(),
      ),
    ).toEqual({});
    expect(
      buildIdentityScopedCliSessionDbSpawnEnv(
        { ZCODE_SESSION_DB: "/custom/db.sqlite" },
        createSpyLogger(),
      ),
    ).toEqual({});
  });

  it("flavor-resolution failure fails loud: typed error log line, never a silent swallow", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    process.env.WEBFLIX_IDENTITY = "true"; // invalid spelling → fail-closed throw
    const logger = createSpyLogger();
    expect(buildIdentityScopedCliSessionDbSpawnEnv({}, logger)).toEqual({});
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      undefined,
      "[zcode-agent-spawn-env] cli session db identity resolution failed (agent keeps its inherited default store)",
      expect.objectContaining({ error: expect.stringContaining("invalid WEBFLIX_IDENTITY") }),
    );
  });
});

describe("P9-FIX-1 F2 — global CLI config read follows the identity-scoped CLI home", () => {
  function writeCliConfig(cliHome: string): void {
    const configPath = join(cliHome, "cli", "config.json");
    mkdirSync(join(cliHome, "cli"), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: { servers: { "computer-use": { type: "stdio", command: "zcode-cua" } } },
      }),
      "utf8",
    );
  }

  it("WebFlix identity reads ~/.webflix/cli/config.json and ignores a stale ~/.zcode config", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    // A zcode-flavored config exists but must NOT be consulted under WebFlix identity.
    writeCliConfig(join(baseDir, ".zcode"));
    expect(hasGlobalCliZCodeCuaServer()).toBe(false);

    writeCliConfig(join(baseDir, ".webflix"));
    expect(hasGlobalCliZCodeCuaServer()).toBe(true);
  });

  it("ZCode flavor keeps reading ~/.zcode/cli/config.json (unchanged behavior)", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    writeCliConfig(join(baseDir, ".zcode"));
    expect(hasGlobalCliZCodeCuaServer()).toBe(true);
  });

  it("ZCODE_HOME override redirects the CLI config read", () => {
    const baseDir = createTempBaseDir();
    setDataBaseDir(baseDir);
    const overrideHome = createTempBaseDir();
    writeCliConfig(overrideHome);
    expect(hasGlobalCliZCodeCuaServer({ ZCODE_HOME: overrideHome })).toBe(true);
  });

  it("absent config resolves false without creating any directory (probe is read-only)", () => {
    const baseDir = createTempBaseDir();
    activateWebFlixIdentity(baseDir);
    expect(hasGlobalCliZCodeCuaServer()).toBe(false);
  });
});
