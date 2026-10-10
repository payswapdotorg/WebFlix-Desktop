import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initializeAutoUpdater,
  isAutoUpdaterInitialized,
  resetAutoUpdaterForTests,
  safeCheckForUpdates,
  validateAppVersion,
  type UpdateCheckOutcome,
} from "./updater-guard";

beforeEach(() => {
  resetAutoUpdaterForTests();
});

describe("validateAppVersion", () => {
  it("rejects a missing version", () => {
    expect(validateAppVersion(undefined)).toEqual({
      valid: false,
      reason: "missing",
      version: null,
    });
    expect(validateAppVersion(null)).toEqual({ valid: false, reason: "missing", version: null });
    expect(validateAppVersion("")).toEqual({ valid: false, reason: "missing", version: "" });
    expect(validateAppVersion("   ")).toEqual({ valid: false, reason: "missing", version: "   " });
  });

  it("rejects the AUDIT-DESKTOP finding 7 dev placeholder 0.0", () => {
    expect(validateAppVersion("0.0")).toEqual({
      valid: false,
      reason: "not-semver",
      version: "0.0",
    });
  });

  it("rejects malformed versions", () => {
    for (const v of [
      "0",
      "1.2",
      "v1.2.3",
      "1.2.3.4",
      "01.2.3",
      "1.2.3-",
      "1.2.3-01",
      "1.2.x",
      "not-a-version",
    ]) {
      expect(validateAppVersion(v)).toEqual({ valid: false, reason: "not-semver", version: v });
    }
  });

  it("accepts valid semver versions", () => {
    for (const v of [
      "0.0.1",
      "1.2.3",
      "10.20.30",
      "1.2.3-beta.1",
      "1.2.3+build.7",
      "2.0.0-rc.1+meta",
    ]) {
      expect(validateAppVersion(v)).toEqual({ valid: true, version: v });
    }
  });

  it("treats 0.0.0 as valid semver (only the dev placeholder 0.0 is rejected)", () => {
    expect(validateAppVersion("0.0.0")).toEqual({ valid: true, version: "0.0.0" });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(validateAppVersion("  1.2.3  ")).toEqual({ valid: true, version: "1.2.3" });
  });
});

describe("initializeAutoUpdater — boot with an invalid version (AUDIT-DESKTOP finding 7)", () => {
  it("boot with 0.0 does NOT construct the platform updater", () => {
    const construct = vi.fn(() => ({ checkForUpdates: vi.fn() }));
    const result = initializeAutoUpdater(() => "0.0", construct);

    expect(construct).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.updater).toBeUndefined();
    expect(result.skipReason).toBe("not-semver");
    expect(result.appVersion).toBe("0.0");
  });

  it("boot with a missing version does NOT construct", () => {
    const construct = vi.fn(() => ({}));
    const result = initializeAutoUpdater(() => undefined, construct);

    expect(construct).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("missing");
    expect(result.appVersion).toBeNull();
  });

  it("the skip is sticky: repeated init on the same boot never constructs", () => {
    const construct = vi.fn(() => ({}));
    const first = initializeAutoUpdater(() => "0.0", construct);
    const second = initializeAutoUpdater(() => "1.2.3", construct);

    expect(construct).not.toHaveBeenCalled();
    expect(second).toBe(first);
    expect(second.status).toBe("skipped");
  });

  it("does not re-consult getVersion once initialized", () => {
    const getVersion = vi.fn(() => "0.0");
    initializeAutoUpdater(getVersion, () => ({}));
    expect(getVersion).toHaveBeenCalledTimes(1);
    initializeAutoUpdater(getVersion, () => ({}));
    expect(getVersion).toHaveBeenCalledTimes(1);
  });
});

describe("initializeAutoUpdater — boot with a valid version", () => {
  it("constructs the updater exactly once and memoizes the result", () => {
    const updater = { checkForUpdates: vi.fn() };
    const construct = vi.fn(() => updater);
    const getVersion = vi.fn(() => "1.2.3");

    const first = initializeAutoUpdater(getVersion, construct);
    const second = initializeAutoUpdater(getVersion, construct);

    expect(construct).toHaveBeenCalledTimes(1);
    expect(getVersion).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("constructed");
    expect(first.skipReason).toBeUndefined();
    expect(first.appVersion).toBe("1.2.3");
    expect(first.updater).toBe(updater);
    expect(second).toBe(first);
  });

  it("keeps prerelease versions constructible", () => {
    const construct = vi.fn(() => ({}));
    const result = initializeAutoUpdater(() => "2.0.0-rc.1", construct);
    expect(result.status).toBe("constructed");
    expect(construct).toHaveBeenCalledTimes(1);
  });

  it("resetAutoUpdaterForTests clears the memo", () => {
    const construct = vi.fn(() => ({}));
    initializeAutoUpdater(() => "1.2.3", construct);
    expect(isAutoUpdaterInitialized()).toBe(true);
    resetAutoUpdaterForTests();
    expect(isAutoUpdaterInitialized()).toBe(false);
    initializeAutoUpdater(() => "1.2.3", construct);
    expect(construct).toHaveBeenCalledTimes(2);
  });
});

describe("safeCheckForUpdates", () => {
  it("reports no-updater when nothing was constructed", async () => {
    await expect(safeCheckForUpdates(undefined)).resolves.toEqual({ kind: "no-updater" });
    await expect(safeCheckForUpdates({})).resolves.toEqual({ kind: "no-updater" });
    await expect(safeCheckForUpdates({ checkForUpdates: "nope" })).resolves.toEqual({
      kind: "no-updater",
    });
  });

  it("awaits an async check and returns its value", async () => {
    const outcome = await safeCheckForUpdates({
      checkForUpdates: async () => ({ updateAvailable: true }),
    });
    expect(outcome).toEqual({ kind: "checked", value: { updateAvailable: true } });
  });

  it("returns sync check values", async () => {
    const outcome = await safeCheckForUpdates({ checkForUpdates: () => 42 });
    expect(outcome).toEqual({ kind: "checked", value: 42 });
  });

  it("captures async rejections instead of crashing boot", async () => {
    const error = new Error("network down");
    const outcome = await safeCheckForUpdates({
      checkForUpdates: async () => {
        throw error;
      },
    });
    expect(outcome).toEqual({ kind: "error", error });
  });

  it("captures synchronous throws", async () => {
    const error = new Error("boom");
    const outcome: UpdateCheckOutcome = await safeCheckForUpdates({
      checkForUpdates: () => {
        throw error;
      },
    });
    expect(outcome).toEqual({ kind: "error", error });
  });
});

describe("boot composition (root-cause fix for autoUpdater.ts:23 eager construction)", () => {
  it("an invalid-version boot ends with no updater and no update check", async () => {
    const checkForUpdates = vi.fn();
    const result = initializeAutoUpdater(
      () => "0.0",
      () => ({ checkForUpdates }),
    );
    const outcome = await safeCheckForUpdates(result.updater);

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: "no-updater" });
  });

  it("a valid-version boot constructs once and checks exactly through the guard", async () => {
    const checkForUpdates = vi.fn(async () => ({ updateAvailable: false }));
    const result = initializeAutoUpdater(
      () => "3.1.4",
      () => ({ checkForUpdates }),
    );
    const outcome = await safeCheckForUpdates(result.updater);

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "checked", value: { updateAvailable: false } });
  });
});
