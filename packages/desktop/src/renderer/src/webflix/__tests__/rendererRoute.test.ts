import { describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 1 + requirement 6) — the renderer route
 * selector pins: the baked product flavor decides which renderer root the
 * desktop app boots, and every ZCode flavor keeps the inherited ZCode boot.
 */

import { selectRendererRoute } from "../../rendererRoute.js";

describe("route selection by baked flavor (requirement 1)", () => {
  it("the webflix flavor mounts the WebFlix shell host in the main window", () => {
    expect(selectRendererRoute({ flavor: "webflix", windowKind: undefined })).toBe("webflix");
    expect(selectRendererRoute({ flavor: "webflix", windowKind: "" })).toBe("webflix");
  });

  it("every ZCode flavor keeps the inherited ZCode renderer boot", () => {
    expect(selectRendererRoute({ flavor: "production", windowKind: undefined })).toBe("zcode");
    expect(selectRendererRoute({ flavor: "preview", windowKind: undefined })).toBe("zcode");
  });

  it("the update-status window keeps the inherited ZCode update root in EVERY flavor", () => {
    // The WebFlix updater surface is disabled at the source
    // (updater-product-guard), so this window only ever exists for ZCode
    // builds — preserving its behavior exactly is the safe rule.
    expect(selectRendererRoute({ flavor: "webflix", windowKind: "update-status" })).toBe("zcode");
    expect(selectRendererRoute({ flavor: "production", windowKind: "update-status" })).toBe(
      "zcode",
    );
    expect(selectRendererRoute({ flavor: "preview", windowKind: "update-status" })).toBe("zcode");
  });

  it("fail-closed: an unknown baked flavor takes the inherited ZCode path, never a silent product swap", () => {
    expect(selectRendererRoute({ flavor: "something-else", windowKind: undefined })).toBe("zcode");
    expect(selectRendererRoute({ flavor: "", windowKind: undefined })).toBe("zcode");
  });
});
