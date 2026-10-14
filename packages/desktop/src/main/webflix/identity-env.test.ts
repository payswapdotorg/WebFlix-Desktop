import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveWebFlixRuntimeIdentity, writeWebFlixRuntimeIdentityEnv } from "./identity-env.js";
import { getAppConfigDir, getDataBaseDir, getZCodeDataRootDir } from "@zcode/services/node";
import { join } from "node:path";

/*
 * P8-RELEASE-DRIFT-1 — T-9 (audit §4.2): applyWebFlixDataRootEnv idempotency
 * + the env contract's precedence over services path resolution, and the
 * T-1 packaged-default seam (R2) through the runtime identity helpers.
 */

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of ["WEBFLIX_IDENTITY", "WEBFLIX_DATA_ROOT"]) {
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

function fakeEnv(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
});

afterEach(() => {
  restoreEnv();
});

describe("T-1 seam / R2 — runtime identity resolution (packaged default-on)", () => {
  it("packaged + baked webflix + unset env resolves .webflix (the frozen packaged root)", () => {
    expect(
      resolveWebFlixRuntimeIdentity(fakeEnv({}), { isPackaged: true, flavor: "webflix" }),
    ).toBe(".webflix");
  });

  it("dev + baked webflix stays default-off; explicit env opts in at .webflix-dev", () => {
    expect(
      resolveWebFlixRuntimeIdentity(fakeEnv({}), { isPackaged: false, flavor: "webflix" }),
    ).toBeUndefined();
    expect(
      resolveWebFlixRuntimeIdentity(fakeEnv({ WEBFLIX_IDENTITY: "1" }), {
        isPackaged: false,
        flavor: "webflix",
      }),
    ).toBe(".webflix-dev");
  });

  it("invalid env spellings throw from the earliest bootstrap helper (fail-closed)", () => {
    expect(() =>
      resolveWebFlixRuntimeIdentity(fakeEnv({ WEBFLIX_IDENTITY: "true" }), {
        isPackaged: true,
        flavor: "webflix",
      }),
    ).toThrow(/invalid WEBFLIX_IDENTITY/);
  });
});

describe("runtime identity env contract (R2)", () => {
  it("exports WEBFLIX_IDENTITY=1 + WEBFLIX_DATA_ROOT when the packaged default resolves ON", () => {
    const env = fakeEnv({});
    const rootName = writeWebFlixRuntimeIdentityEnv(env, { isPackaged: true, flavor: "webflix" });
    expect(rootName).toBe(".webflix");
    expect(env.WEBFLIX_IDENTITY).toBe("1");
    expect(env.WEBFLIX_DATA_ROOT).toBe(".webflix");
  });

  it("never overwrites explicit env values (test isolation wins)", () => {
    const env = fakeEnv({ WEBFLIX_IDENTITY: "1", WEBFLIX_DATA_ROOT: ".wf-isolated" });
    const rootName = writeWebFlixRuntimeIdentityEnv(env, { isPackaged: true, flavor: "webflix" });
    expect(rootName).toBe(".wf-isolated");
    expect(env.WEBFLIX_DATA_ROOT).toBe(".wf-isolated");
  });

  it("writes nothing when the identity is off (ZCode behavior untouched)", () => {
    const env = fakeEnv({});
    expect(
      writeWebFlixRuntimeIdentityEnv(env, { isPackaged: true, flavor: "production" }),
    ).toBeUndefined();
    expect(env.WEBFLIX_IDENTITY).toBeUndefined();
    expect(env.WEBFLIX_DATA_ROOT).toBeUndefined();
  });

  it("a WEBFLIX_IDENTITY=0 forced-off packaged webflix build writes nothing", () => {
    const env = fakeEnv({ WEBFLIX_IDENTITY: "0" });
    expect(
      writeWebFlixRuntimeIdentityEnv(env, { isPackaged: true, flavor: "webflix" }),
    ).toBeUndefined();
    expect(env.WEBFLIX_IDENTITY).toBe("0");
    expect(env.WEBFLIX_DATA_ROOT).toBeUndefined();
  });
});

describe("T-9 — precedence over services path resolution", () => {
  it("after the packaged default-on contract write, services resolve under ~/.webflix", () => {
    // The real process.env (services/paths.ts reads it directly — that module
    // is outside this order's allowed paths, so the contract write is the seam).
    const rootName = writeWebFlixRuntimeIdentityEnv(process.env, {
      isPackaged: true,
      flavor: "webflix",
    });
    expect(rootName).toBe(".webflix");
    expect(process.env.WEBFLIX_IDENTITY).toBe("1");
    expect(process.env.WEBFLIX_DATA_ROOT).toBe(".webflix");
    expect(getZCodeDataRootDir()).toBe(join(getDataBaseDir(), ".webflix"));
    expect(getAppConfigDir()).toBe(join(getDataBaseDir(), ".webflix", "v2"));
  });

  it("without the contract (identity off), services keep the .zcode segment", () => {
    delete process.env.WEBFLIX_IDENTITY;
    delete process.env.WEBFLIX_DATA_ROOT;
    expect(getZCodeDataRootDir()).toBe(join(getDataBaseDir(), ".zcode"));
  });

  it("an absolute WEBFLIX_DATA_ROOT override is honored by services (test isolation)", () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = "/tmp/wf-identity-env-isolation";
    expect(getZCodeDataRootDir()).toBe("/tmp/wf-identity-env-isolation");
  });
});

describe("T-9 — applyWebFlixDataRootEnv idempotency (fresh module evaluation)", () => {
  it("applies at most once per process; repeat calls return undefined", async () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = ".wf-idempotent-probe";
    vi.resetModules();
    const moduleUrl = new URL("./identity-env.js", import.meta.url).href;
    const first = await import(moduleUrl);
    expect(first.applyWebFlixDataRootEnv()).toBeUndefined(); // latched by the import side effect
    expect(first.applyWebFlixDataRootEnv()).toBeUndefined();
    expect(process.env.WEBFLIX_DATA_ROOT).toBe(".wf-idempotent-probe"); // explicit value untouched
  });
});
