import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionStoragePreparationWorkerEnv } from "../host/storagePreparationProcesses.js";

/*
 * P9-FIX-1 F2b — per-flavor pins for the storage-preparation Worker's env.
 *
 * The packaged tier now resolves the bundled CLI for storage preparation
 * (unsupported_runtime at the 0125462 RC → supportsStorageStartup since the
 * WFX agent runtime), so the CLI-bundle Worker really runs on packaged boots
 * and its session store MUST land under the frozen WebFlix data root —
 * the 9e2c8a2 packaged smoke observed the leak live: only the spawned CLI
 * worker wrote ~/.zcode/cli/db/db.sqlite while the host itself (tasks index
 * under ~/.webflix/v2/) demonstrably held the identity env.
 *
 * These pins hold the seam exactly where the leak was: the Worker env
 * composition in packages/desktop/src/host/storagePreparationProcesses.ts.
 * The resolution law mirrors the agent-spawn pin (webflixCliDataRootIsolation.
 * test.ts): explicit ZCODE_SESSION_DB_* overrides win; ZCode flavor is a
 * byte-identical no-op; WebFlix identity pins the store under the frozen
 * data root; ZCODE_HOME keeps winning.
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

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
  delete process.env.ZCODE_HOME;
});

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe("buildSessionStoragePreparationWorkerEnv (P9-FIX-1 F2b)", () => {
  it("keeps the ZCode flavor byte-identical: no pin, merged env passes through", () => {
    const processEnv = { PATH: "/usr/bin", HOME: "/home/z", WEBFLIX_IDENTITY: "0" };
    const optionsEnv = { SOME_OPTION: "1" };
    const commandEnv = { ELECTRON_RUN_AS_NODE: "1" };
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv,
      optionsEnv,
      commandEnv,
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/z",
      WEBFLIX_IDENTITY: "0",
      SOME_OPTION: "1",
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(env.ZCODE_SESSION_DB_PATH).toBeUndefined();
  });

  it("pins the CLI session store under the WebFlix data root when identity is active", () => {
    // The identity vars live in the HOST's process env (set by desktop main at
    // startup — the empirical 9e2c8a2 evidence: the host resolved
    // ~/.webflix/v2/tasks-index.sqlite); the builder reads them from there.
    process.env.WEBFLIX_IDENTITY = "1";
    const webflixRoot = mkdtempSync(join(tmpdir(), "wf-prep-env-"));
    process.env.WEBFLIX_DATA_ROOT = join(webflixRoot, ".webflix");
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv: {
        PATH: "/usr/bin",
        WEBFLIX_IDENTITY: "1",
        WEBFLIX_DATA_ROOT: process.env.WEBFLIX_DATA_ROOT,
      },
      optionsEnv: undefined,
      commandEnv: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(env.ZCODE_SESSION_DB_PATH).toBe(join(webflixRoot, ".webflix", "cli", "db", "db.sqlite"));
    // The identity env itself keeps propagating to the worker (host → worker
    // inheritance is part of the same contract).
    expect(env.WEBFLIX_IDENTITY).toBe("1");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("lets an explicit ZCODE_SESSION_DB_PATH override win (command env, deployment-specific)", () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = "/tmp/wf/.webflix";
    const explicit = "/opt/custom/session/db.sqlite";
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv: {
        WEBFLIX_IDENTITY: "1",
        WEBFLIX_DATA_ROOT: "/tmp/wf/.webflix",
      },
      commandEnv: { ZCODE_SESSION_DB_PATH: explicit },
    });
    expect(env.ZCODE_SESSION_DB_PATH).toBe(explicit);
  });

  it("lets an explicit ZCODE_SESSION_DB override win (options env, host-provided)", () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = "/tmp/wf/.webflix";
    const explicit = "/opt/alt/db.sqlite";
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv: {
        WEBFLIX_IDENTITY: "1",
        WEBFLIX_DATA_ROOT: "/tmp/wf/.webflix",
      },
      optionsEnv: { ZCODE_SESSION_DB: explicit },
    });
    expect(env.ZCODE_SESSION_DB).toBe(explicit);
    expect(env.ZCODE_SESSION_DB_PATH).toBeUndefined();
  });

  it("follows an explicit ZCODE_HOME override for the pinned store location", () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = "/tmp/wf/.webflix";
    const zcodeHome = mkdtempSync(join(tmpdir(), "wf-prep-home-"));
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv: {
        WEBFLIX_IDENTITY: "1",
        WEBFLIX_DATA_ROOT: "/tmp/wf/.webflix",
        ZCODE_HOME: zcodeHome,
      },
    });
    expect(env.ZCODE_SESSION_DB_PATH).toBe(join(zcodeHome, "cli", "db", "db.sqlite"));
  });

  it("never silently falls back to ~/.zcode when the identity state is illegal", () => {
    process.env.WEBFLIX_IDENTITY = "yes";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = buildSessionStoragePreparationWorkerEnv({
      processEnv: { WEBFLIX_IDENTITY: "yes" },
    });
    expect(env.ZCODE_SESSION_DB_PATH).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
