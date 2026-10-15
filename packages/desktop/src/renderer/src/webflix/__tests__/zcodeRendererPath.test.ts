import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 6) — the explicit "ZCode renderer path is
 * UNCHANGED" pins. The pre-order main.tsx body moved VERBATIM into
 * zcodeBoot.tsx (verified against the BASE tree with
 * `git diff --no-index -w` — zero content change; these pins keep the
 * load-bearing invariants from regressing after this order lands):
 *   - main.tsx is a thin router that routes EVERY ZCode flavor (and the
 *     update-status window in every flavor) to zcodeBoot and never mounts
 *     a product root itself;
 *   - zcodeBoot.tsx contains the inherited ZCode boot statements exactly
 *     (the @zcode/ui Root mount, theme seeding, service-port admission,
 *     database startup admission, the update-status root);
 *   - zcodeBoot.tsx imports NOTHING WebFlix (no reverse leakage);
 *   - index.html — the ZCode flavors' startup shell — is untouched (pinned
 *     in splashSwap.test.ts against the real file).
 */

const RENDERER_SRC = join(import.meta.dirname, "../..");
const MAIN_TSX = join(RENDERER_SRC, "main.tsx");
const ZCODE_BOOT = join(RENDERER_SRC, "zcodeBoot.tsx");
const ROUTER = join(RENDERER_SRC, "rendererRoute.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("main.tsx is a thin flavor router (requirement 1)", () => {
  it("routes through selectRendererRoute with the BAKED flavor constant", () => {
    const source = read(MAIN_TSX);
    expect(source).toContain("selectRendererRoute");
    expect(source).toContain("ZCODE_PRODUCT_FLAVOR");
    expect(source).toContain('new URLSearchParams(window.location.search).get("windowKind")');
  });

  it("the zcode branch dynamically imports the inherited boot, the webflix branch the WebFlix host", () => {
    const source = read(MAIN_TSX);
    expect(source).toContain('import("./zcodeBoot.js")');
    expect(source).toContain('import("./webflix/boot.js")');
  });

  it("the router itself mounts NOTHING — no @zcode/ui, no React, no createRoot", () => {
    const source = read(MAIN_TSX);
    expect(source).not.toMatch(/from "@zcode\/ui"/);
    expect(source).not.toMatch(/from "react(-dom)?/);
    expect(source).not.toContain("createRoot");
  });

  it("the webflix branch swaps the startup surface BEFORE loading the boot chunk", () => {
    const source = read(MAIN_TSX);
    const swapIndex = source.indexOf("applyWebFlixStartupSurface(document)");
    const importIndex = source.indexOf('import("./webflix/boot.js")');
    expect(swapIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(swapIndex);
  });
});

describe("zcodeBoot.tsx is the inherited ZCode renderer boot, verbatim (ZCode flavors unchanged)", () => {
  it("keeps the inherited @zcode/ui Root mount with its original props", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain("registerBaseWorkspaceServices(services)");
    expect(source).toContain("<Root");
    expect(source).toContain("assistantCodeCommentCardsEnabled");
    expect(source).toContain("restoreSession={restoreSession}");
    expect(source).toContain('import "@zcode/ui/styles.css"');
  });

  it("keeps the inherited theme seeding and startup-admission statements", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain('localStorage.getItem("zcode-theme")');
    expect(source).toContain("zai-dark");
    expect(source).toContain("new DatabaseStartupAdmission()");
    expect(source).toContain("GlobalDatabaseStartupLoading");
    expect(source).toContain("DatabaseStartupState");
    expect(source).toContain('sendStartupControl({ action: "snapshot" })');
  });

  it("keeps the inherited update-status window root exactly", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain("<UpdateStatusWindowRoot");
    expect(source).toContain('windowKind === "update-status"');
  });

  it("keeps the inherited platform markers and remote-session plumbing", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain("platform-mac-desktop");
    expect(source).toContain("platform-windows-desktop");
    expect(source).toContain("platform-linux-desktop");
    expect(source).toContain("registerRemoteWorkspaceSession");
    expect(source).toContain("parseRemoteWorkspaceServicePortMessage");
  });

  it("keeps the inherited launch-marks contract and startup-ready event", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain("__ZCODE_RENDERER_START__");
    expect(source).toContain("parseLaunchMarks");
    expect(source).toContain("zcode-react-startup-ready");
  });

  it("imports NOTHING WebFlix — the ZCode path gains zero WebFlix surface", () => {
    const source = read(ZCODE_BOOT);
    expect(source).not.toMatch(/webflix/i);
    expect(source).not.toContain("./webflix/");
  });

  it("states the verbatim-move contract in its header (the audit trail)", () => {
    const source = read(ZCODE_BOOT);
    expect(source).toContain("VERBATIM");
    expect(source).toContain("moved without ANY");
    expect(source).toContain("byte-identical");
  });
});

describe("rendererRoute.ts stays the pure, fail-closed selector", () => {
  it("is dependency-free (no React/DOM imports — pure route math)", () => {
    const source = read(ROUTER);
    expect(source).not.toMatch(/^import /m);
    expect(source).toContain('"webflix"');
    expect(source).toContain('"update-status"');
  });
});
