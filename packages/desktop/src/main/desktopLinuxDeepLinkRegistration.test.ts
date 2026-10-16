import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerLinuxDeepLinkProtocol,
  resolveLinuxDeepLinkDesktopEntryProfile,
} from "./desktopLinuxDeepLinkRegistration.js";
import type {
  LinuxDesktopCommandRunner,
  LinuxDeepLinkRegistrationLogger,
} from "./desktopLinuxXdg.js";

/*
 * P9-FIX-1 F1 — per-flavor pins for the runtime user-level deep-link desktop
 * entry (QA finding desktop-entry:<flavor>:user-level on the 33681f7
 * artifacts): the WebFlix flavor must register `webflix.desktop` with the
 * WebFlix identity fields (consistent with the packaged system-level entry:
 * Name=WebFlix, Icon=webflix, MimeType=x-scheme-handler/webflix;,
 * Comment=WebFlix Desktop App); ZCode production/preview flavors must keep
 * the historical `zcode.desktop` behavior BYTE-COMPATIBLE.
 *
 * The battery define bakes __ZCODE_PRODUCT_FLAVOR__ = "webflix" (vitest
 * .config.ts — exactly like a WebFlix bundle); the profile resolver's default
 * isPackaged=true models the only real caller (desktopOAuthDeepLink gates on
 * app.isPackaged). ZCode cases inject productIdentity explicitly.
 */

const WEBFLIX_USER_ENTRY = [
  "[Desktop Entry]",
  "Name=WebFlix",
  "Comment=WebFlix Desktop App",
  'Exec="/opt/WebFlix/webflix" %U',
  "Terminal=false",
  "Type=Application",
  "Icon=webflix",
  "Categories=Development;",
  "MimeType=x-scheme-handler/webflix;",
  "StartupWMClass=WebFlix",
  "",
].join("\n");

// Byte-compat pin: the ZCode entry template exactly as the pre-fix code wrote it.
const ZCODE_USER_ENTRY = [
  "[Desktop Entry]",
  "Name=ZCode",
  "Comment=ZCode Desktop App",
  'Exec="/usr/bin/zcode" %U',
  "Terminal=false",
  "Type=Application",
  "Icon=zcode",
  "Categories=Development;",
  "MimeType=x-scheme-handler/zcode;",
  "StartupWMClass=ZCode",
  "",
].join("\n");

interface Harness {
  homeDir: string;
  logger: LinuxDeepLinkRegistrationLogger;
  runCommand: LinuxDesktopCommandRunner & { calls: Array<{ command: string; args: string[] }> };
  register(options?: {
    productIdentity?: { flavor?: "production" | "preview" | "webflix"; isPackaged?: boolean };
    env?: Record<string, string | undefined>;
    executablePath?: string;
    productName?: string;
    systemApplicationDirs?: string[];
  }): void;
}

function createHarness(): Harness {
  const homeDir = mkdtempSync(join(tmpdir(), "wf-deeplink-reg-"));
  const logger: LinuxDeepLinkRegistrationLogger = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand = ((command: string, args: string[]) => {
    calls.push({ command, args });
    return { status: 0, signal: null, stderr: "" };
  }) as LinuxDesktopCommandRunner & { calls: Array<{ command: string; args: string[] }> };
  runCommand.calls = calls;
  return {
    homeDir,
    logger,
    runCommand,
    register(options = {}) {
      registerLinuxDeepLinkProtocol({
        executablePath: options.executablePath ?? "/opt/WebFlix/webflix",
        homeDir,
        productName: options.productName,
        env: options.env ?? {},
        logger,
        runCommand,
        systemApplicationDirs: options.systemApplicationDirs ?? [],
        productIdentity: options.productIdentity,
      });
    },
  };
}

function userApplicationsDir(homeDir: string): string {
  return join(homeDir, ".local", "share", "applications");
}

function writeUserDesktopEntry(homeDir: string, fileName: string, content: string): string {
  const target = join(userApplicationsDir(homeDir), fileName);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  return target;
}

const harnesses: Harness[] = [];

beforeEach(() => {
  harnesses.push(createHarness());
});

afterEach(() => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    rmSync(harness.homeDir, { recursive: true, force: true });
  }
});

describe("P9-FIX-1 F1 — desktop entry profile resolution per flavor", () => {
  it("WebFlix flavor (baked webflix + packaged) → webflix.desktop / webflix fields", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      flavor: "webflix",
      isPackaged: true,
    });
    expect(profile).toEqual({
      desktopFileName: "webflix.desktop",
      iconName: "webflix",
      schemeHandlerMimeType: "x-scheme-handler/webflix",
      ownershipMarkerLine: "Comment=WebFlix Desktop App",
      fallbackProductName: "WebFlix",
    });
  });

  it("defaults follow the battery-baked flavor + packaged caller contract (webflix)", () => {
    expect(resolveLinuxDeepLinkDesktopEntryProfile().desktopFileName).toBe("webflix.desktop");
    expect(resolveLinuxDeepLinkDesktopEntryProfile({ env: {} }).desktopFileName).toBe(
      "webflix.desktop",
    );
  });

  it("ZCode production flavor keeps the historical zcode.desktop profile", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      flavor: "production",
      isPackaged: true,
    });
    expect(profile).toEqual({
      desktopFileName: "zcode.desktop",
      iconName: "zcode",
      schemeHandlerMimeType: "x-scheme-handler/zcode",
      ownershipMarkerLine: "Comment=ZCode Desktop App",
      fallbackProductName: "ZCode",
    });
  });

  it("ZCode preview flavor also keeps zcode.desktop (runtime never followed zcode-preview)", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      flavor: "preview",
      isPackaged: true,
    });
    expect(profile.desktopFileName).toBe("zcode.desktop");
    expect(profile.schemeHandlerMimeType).toBe("x-scheme-handler/zcode");
    expect(profile.ownershipMarkerLine).toBe("Comment=ZCode Desktop App");
  });

  it("runtime identity env contract: WEBFLIX_IDENTITY=1 selects the WebFlix profile", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      env: { WEBFLIX_IDENTITY: "1" },
      flavor: "production",
      isPackaged: true,
    });
    expect(profile.desktopFileName).toBe("webflix.desktop");
  });

  it("WEBFLIX_IDENTITY=0 forces the ZCode profile even for a baked webflix flavor", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      env: { WEBFLIX_IDENTITY: "0" },
      flavor: "webflix",
      isPackaged: true,
    });
    expect(profile.desktopFileName).toBe("zcode.desktop");
    expect(profile.ownershipMarkerLine).toBe("Comment=ZCode Desktop App");
  });

  it("unpackaged dev runtimes stay default-off (ZCode profile) even with baked webflix", () => {
    const profile = resolveLinuxDeepLinkDesktopEntryProfile({
      env: {},
      flavor: "webflix",
      isPackaged: false,
    });
    expect(profile.desktopFileName).toBe("zcode.desktop");
  });
});

describe("P9-FIX-1 F1 — user-level registration per flavor", () => {
  it("WebFlix flavor writes webflix.desktop with WebFlix identity fields", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({
      productIdentity: { flavor: "webflix", isPackaged: true },
      executablePath: "/opt/WebFlix/webflix",
    });

    const entryPath = join(userApplicationsDir(harness.homeDir), "webflix.desktop");
    expect(existsSync(entryPath)).toBe(true);
    expect(readFileSync(entryPath, "utf8")).toBe(WEBFLIX_USER_ENTRY);
    expect(existsSync(join(userApplicationsDir(harness.homeDir), "zcode.desktop"))).toBe(false);

    const xdgMime = harness.runCommand.calls.find((call) => call.command === "xdg-mime");
    expect(xdgMime?.args).toEqual(["default", "webflix.desktop", "x-scheme-handler/webflix"]);
    const updateDb = harness.runCommand.calls.find(
      (call) => call.command === "update-desktop-database",
    );
    expect(updateDb?.args).toEqual([userApplicationsDir(harness.homeDir)]);
  });

  it("WebFlix flavor derives Name from the caller productName (app.name)", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({
      productIdentity: { flavor: "webflix", isPackaged: true },
      executablePath: "/opt/WebFlix/webflix",
      productName: "WebFlix",
    });
    const content = readFileSync(
      join(userApplicationsDir(harness.homeDir), "webflix.desktop"),
      "utf8",
    );
    expect(content).toContain("Name=WebFlix\n");
    expect(content).toContain("StartupWMClass=WebFlix\n");
  });

  it("ZCode production flavor writes the legacy zcode.desktop byte-for-byte", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({
      productIdentity: { flavor: "production", isPackaged: true },
      executablePath: "/usr/bin/zcode",
      productName: "ZCode",
    });

    const entryPath = join(userApplicationsDir(harness.homeDir), "zcode.desktop");
    expect(existsSync(entryPath)).toBe(true);
    expect(readFileSync(entryPath, "utf8")).toBe(ZCODE_USER_ENTRY);
    expect(existsSync(join(userApplicationsDir(harness.homeDir), "webflix.desktop"))).toBe(false);

    const xdgMime = harness.runCommand.calls.find((call) => call.command === "xdg-mime");
    expect(xdgMime?.args).toEqual(["default", "zcode.desktop", "x-scheme-handler/zcode"]);
  });

  it("ZCode preview flavor writes the same legacy zcode.desktop (byte-compatible)", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({
      productIdentity: { flavor: "preview", isPackaged: true },
      executablePath: "/usr/bin/zcode",
      productName: "ZCode",
    });
    expect(readFileSync(join(userApplicationsDir(harness.homeDir), "zcode.desktop"), "utf8")).toBe(
      ZCODE_USER_ENTRY,
    );
  });

  it("runtime env contract WEBFLIX_IDENTITY=1 switches the entry even without productIdentity", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({ env: { WEBFLIX_IDENTITY: "1" }, executablePath: "/opt/WebFlix/webflix" });
    expect(
      readFileSync(join(userApplicationsDir(harness.homeDir), "webflix.desktop"), "utf8"),
    ).toBe(WEBFLIX_USER_ENTRY);
  });
});

describe("P9-FIX-1 F1 — system-entry suppression + ownership-marker cleanup per flavor", () => {
  it("WebFlix: system-level webflix.desktop suppresses the user-level write and removes an OWNED legacy user entry", () => {
    const harness = harnesses[harnesses.length - 1]!;
    const systemDir = mkdtempSync(join(tmpdir(), "wf-sys-apps-"));
    try {
      const systemEntry = join(systemDir, "webflix.desktop");
      writeFileSync(systemEntry, WEBFLIX_USER_ENTRY, "utf8");
      const legacyUserEntry = writeUserDesktopEntry(
        harness.homeDir,
        "webflix.desktop",
        WEBFLIX_USER_ENTRY,
      );

      harness.register({
        productIdentity: { flavor: "webflix", isPackaged: true },
        systemApplicationDirs: [systemDir],
      });

      expect(existsSync(legacyUserEntry)).toBe(false);
      const xdgMime = harness.runCommand.calls.find((call) => call.command === "xdg-mime");
      expect(xdgMime?.args).toEqual(["default", "webflix.desktop", "x-scheme-handler/webflix"]);
    } finally {
      rmSync(systemDir, { recursive: true, force: true });
    }
  });

  it("WebFlix: a foreign user-level webflix.desktop (no ownership marker) is preserved", () => {
    const harness = harnesses[harnesses.length - 1]!;
    const systemDir = mkdtempSync(join(tmpdir(), "wf-sys-apps-"));
    try {
      writeFileSync(join(systemDir, "webflix.desktop"), WEBFLIX_USER_ENTRY, "utf8");
      const foreignEntry = writeUserDesktopEntry(
        harness.homeDir,
        "webflix.desktop",
        [
          "[Desktop Entry]",
          "Name=My custom thing",
          "Comment=hand-written by the user",
          'Exec="/usr/bin/something-else" %U',
          "Type=Application",
          "",
        ].join("\n"),
      );

      harness.register({
        productIdentity: { flavor: "webflix", isPackaged: true },
        systemApplicationDirs: [systemDir],
      });

      expect(existsSync(foreignEntry)).toBe(true);
      expect(harness.logger.warn).toHaveBeenCalledWith(
        "[deep-link] Linux 用户级 desktop entry 非本应用写入，保留不清理",
        expect.objectContaining({ desktopFilePath: foreignEntry }),
      );
    } finally {
      rmSync(systemDir, { recursive: true, force: true });
    }
  });

  it("WebFlix: never deletes a foreign zcode.desktop left by the old buggy builds (per-flavor cleanup scope)", () => {
    const harness = harnesses[harnesses.length - 1]!;
    const systemDir = mkdtempSync(join(tmpdir(), "wf-sys-apps-"));
    try {
      writeFileSync(join(systemDir, "webflix.desktop"), WEBFLIX_USER_ENTRY, "utf8");
      // The pre-fix buggy WebFlix build wrote this file: Name=WebFlix with the
      // ZCode ownership marker (Comment=ZCode Desktop App) — indistinguishable
      // from a genuine ZCode-written entry, so a WebFlix run must keep it.
      const buggyLeftover = writeUserDesktopEntry(
        harness.homeDir,
        "zcode.desktop",
        [
          "[Desktop Entry]",
          "Name=WebFlix",
          "Comment=ZCode Desktop App",
          'Exec="/opt/WebFlix/webflix" %U',
          "Terminal=false",
          "Type=Application",
          "Icon=zcode",
          "Categories=Development;",
          "MimeType=x-scheme-handler/zcode;",
          "StartupWMClass=WebFlix",
          "",
        ].join("\n"),
      );

      harness.register({
        productIdentity: { flavor: "webflix", isPackaged: true },
        systemApplicationDirs: [systemDir],
      });

      expect(existsSync(buggyLeftover)).toBe(true);
    } finally {
      rmSync(systemDir, { recursive: true, force: true });
    }
  });

  it("ZCode: system-level zcode.desktop removes an OWNED legacy user zcode.desktop (byte-compat semantics)", () => {
    const harness = harnesses[harnesses.length - 1]!;
    const systemDir = mkdtempSync(join(tmpdir(), "wf-sys-apps-"));
    try {
      writeFileSync(join(systemDir, "zcode.desktop"), ZCODE_USER_ENTRY, "utf8");
      const legacyUserEntry = writeUserDesktopEntry(
        harness.homeDir,
        "zcode.desktop",
        ZCODE_USER_ENTRY,
      );

      harness.register({
        productIdentity: { flavor: "production", isPackaged: true },
        systemApplicationDirs: [systemDir],
      });

      expect(existsSync(legacyUserEntry)).toBe(false);
    } finally {
      rmSync(systemDir, { recursive: true, force: true });
    }
  });

  it("no system entry + no APPIMAGE env: nothing is written under a foreign flavor's file name", () => {
    const harness = harnesses[harnesses.length - 1]!;
    harness.register({ productIdentity: { flavor: "webflix", isPackaged: true } });
    const applicationsDir = userApplicationsDir(harness.homeDir);
    expect(existsSync(join(applicationsDir, "webflix.desktop"))).toBe(true);
    expect(existsSync(join(applicationsDir, "zcode.desktop"))).toBe(false);
  });
});
