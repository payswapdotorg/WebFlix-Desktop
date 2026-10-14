import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * P8-RELEASE-DRIFT-1 — T-8 (audit §4.2 / hazard H1 §2.2): the updater chain
 * REFUSES enablement for a WebFlix product runtime (baked flavor "webflix"
 * [vitest define] or an active WebFlix data root) even when a caller passes
 * enabled:true — the fail-closed product guard inside initAutoUpdater.
 * T-10 (unit half): the post-update release-notes notice logic
 * (autoUpdater.ts toPostUpdateReleaseNotesPayload / normalizeReleaseDate /
 * shouldDiscardStalePendingReleaseNotes) — the e2e halves (real feed,
 * real installs) stay out of scope per the audit's own blockers.
 */

const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getName: () => "WebFlix Dev",
    getVersion: () => "0.0",
    getPath: (name: string) => `/tmp/wf-autoupdater-test/${name}`,
  },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return [];
    }
    static fromWebContents(): null {
      return null;
    }
    static getFocusedWindow(): null {
      return null;
    }
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}));

vi.mock("./logger.js", () => ({
  logger: {
    info: loggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const SAVED_ENV: Record<string, string | undefined> = {};

function snapshotEnv() {
  for (const key of ["WEBFLIX_IDENTITY", "WEBFLIX_DATA_ROOT", "ZCODE_AUTO_UPDATE_DEV"]) {
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

async function importAutoUpdater() {
  vi.resetModules();
  loggerInfo.mockClear();
  return await import("./autoUpdater.js");
}

beforeEach(() => {
  snapshotEnv();
  delete process.env.WEBFLIX_IDENTITY;
  delete process.env.WEBFLIX_DATA_ROOT;
  delete process.env.ZCODE_AUTO_UPDATE_DEV;
});

afterEach(() => {
  restoreEnv();
});

describe("T-8 / H1 — fail-closed product guard inside the updater chain", () => {
  it(
    "refuses enablement for the baked webflix flavor even when enabled:true is passed",
    { timeout: 30_000 },
    async () => {
      // No env vars: the battery define bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix"
      // (exactly what a packaged WebFlix bundle carries). A future refactor that
      // passes enabled:true must still not reach the ZCode feed.
      // Station hardening (TL2, 2026-10-14, post-merge battery finding): the FIRST
      // cold vi.resetModules()+import of this module chain (electron-updater graph)
      // measured 5794ms on a loaded 4GB sandbox (the recorded environment class,
      // audit SS3.6) - the default 5s testTimeout made this pin machine-load-flaky
      // (passed worker-side and at the 15:15Z branch battery; failed 15:26Z+ under
      // load at 5006-5009ms, deterministically). 30s keeps the pin hermetic; the
      // measured warm re-imports stay ~500ms.
      const mod = await importAutoUpdater();
      await mod.initAutoUpdater({ enabled: true });
      const refusal = loggerInfo.mock.calls.find(([message]) =>
        String(message).includes("[auto-update] refused"),
      );
      expect(refusal).toBeDefined();
      expect(String(refusal![0])).toContain("webflix");
      // The legacy e2e-recognized phrase rides along (webflix-smoke.mjs updater:guard).
      expect(String(refusal![0])).toContain("disabled for this desktop product flavor");
    },
  );

  it("refuses enablement when the WebFlix runtime identity is active, regardless of flavor", async () => {
    process.env.WEBFLIX_IDENTITY = "1";
    process.env.WEBFLIX_DATA_ROOT = ".wf-autoupdater-isolated";
    const mod = await importAutoUpdater();
    // Explicit production flavor cannot override an active WebFlix identity.
    await mod.initAutoUpdater({ enabled: true, productFlavor: "production" });
    const refusal = loggerInfo.mock.calls.find(([message]) =>
      String(message).includes("[auto-update] refused"),
    );
    expect(refusal).toBeDefined();
    expect(String(refusal![0])).toContain("WebFlix runtime product identity");
  });

  it("the refusal also fail-closes the manual check entry (disabled flag)", async () => {
    const mod = await importAutoUpdater();
    await mod.initAutoUpdater({ enabled: true });
    // checkForUpdateMenuClick without a live window logs the skip and returns.
    expect(() => mod.checkForUpdateMenuClick(null)).not.toThrow();
  });

  it("a ZCode production runtime is NOT refused by the product guard (guard specificity)", async () => {
    const mod = await importAutoUpdater();
    // No webflix identity active + explicit production flavor → guard passes
    // through (the dev runtime then skips at canUseAutoUpdaterInCurrentRuntime).
    await mod.initAutoUpdater({ enabled: true, productFlavor: "production" });
    const refusal = loggerInfo.mock.calls.find(([message]) =>
      String(message).includes("[auto-update] refused"),
    );
    expect(refusal).toBeUndefined();
  });
});

describe("T-10 (unit half) — post-update release-notes notice logic", () => {
  it("normalizeReleaseDate accepts Dates, trimmed strings, and rejects empties", async () => {
    const mod = await importAutoUpdater();
    expect(mod.normalizeReleaseDate(new Date("2026-10-14T00:00:00.000Z"))).toBe(
      "2026-10-14T00:00:00.000Z",
    );
    expect(mod.normalizeReleaseDate("  2026-10-14  ")).toBe("2026-10-14");
    expect(mod.normalizeReleaseDate("")).toBeUndefined();
    expect(mod.normalizeReleaseDate(null)).toBeUndefined();
  });

  it("toPostUpdateReleaseNotesPayload builds the payload from a markdown string", async () => {
    const mod = await importAutoUpdater();
    const payload = mod.toPostUpdateReleaseNotesPayload({
      version: "3.15.0",
      releaseName: "  ",
      releaseNotes: "# What's new\n- Fix A",
      releaseDate: "2026-10-14",
    });
    expect(payload).not.toBeNull();
    expect(payload!.version).toBe("3.15.0");
    expect(payload!.markdown).toBe("# What's new\n- Fix A");
    // releaseName blank → title derived from the first markdown heading.
    expect(payload!.title).toBe("What's new");
    expect(payload!.releaseDate).toBe("2026-10-14");
  });

  it("toPostUpdateReleaseNotesPayload prefers an explicit releaseName", async () => {
    const mod = await importAutoUpdater();
    const payload = mod.toPostUpdateReleaseNotesPayload({
      version: "3.15.0",
      releaseName: "October Update",
      releaseNotes: "plain markdown without heading",
    });
    expect(payload!.title).toBe("October Update");
  });

  it("toPostUpdateReleaseNotesPayload returns null without any markdown", async () => {
    const mod = await importAutoUpdater();
    expect(mod.toPostUpdateReleaseNotesPayload({ version: "3.15.0" })).toBeNull();
    expect(
      mod.toPostUpdateReleaseNotesPayload({ version: "3.15.0", releaseNotes: "   " }),
    ).toBeNull();
  });

  it("toPostUpdateReleaseNotesPayload joins array-form notes and localizes zh-CN/en-US", async () => {
    const mod = await importAutoUpdater();
    const payload = mod.toPostUpdateReleaseNotesPayload({
      version: "3.15.0",
      releaseNotes: [{ note: "first" }, { note: "" }, { note: "second" }],
      releaseNotesByLocale: {
        "zh-CN": "# 中文标题\n内容",
        "en-US": { markdown: "# English title\ncontent" },
      },
    });
    expect(payload!.markdown).toBe("first\n\nsecond");
    expect(payload!.releaseNotesByLocale!["zh-CN"]!.title).toBe("中文标题");
    expect(payload!.releaseNotesByLocale!["en-US"]!.title).toBe("English title");
  });

  it("shouldDiscardStalePendingReleaseNotes discards only strictly-older versions", async () => {
    const mod = await importAutoUpdater();
    expect(mod.shouldDiscardStalePendingReleaseNotes("3.15.0", "3.15.0")).toBe(false);
    // A downloaded-but-not-installed newer version is a normal intermediate
    // state — never discarded (else the notice would silently vanish).
    expect(mod.shouldDiscardStalePendingReleaseNotes("3.16.0", "3.15.0")).toBe(false);
    // User manually installed a higher version: the stale pending is dropped.
    expect(mod.shouldDiscardStalePendingReleaseNotes("3.14.0", "3.15.0")).toBe(true);
    // Non-semver values are compared conservatively (not discarded).
    expect(mod.shouldDiscardStalePendingReleaseNotes("unknown", "3.15.0")).toBe(false);
  });
});
