import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 2 + requirement 6) — the product-branding pins:
 * the frozen WebFlix identity on every renderer branding surface, the icon
 * set lockstep with the renderer mark, and NO ZCode/Z.ai identity leakage in
 * any VALUE this surface renders.
 */

import {
  WEBFLIX_DOCUMENT_TITLE,
  WEBFLIX_MARK_ALT,
  WEBFLIX_MARK_SVG,
  WEBFLIX_PRODUCT_NAME,
  WEBFLIX_SPLASH_ARIA_LABEL,
  webflixAboutLine,
} from "../brand.js";

const RENDERER_SRC = join(import.meta.dirname, "..");
const REPO_ROOT = join(import.meta.dirname, "../../../../../../../");
const ICON_SET_DIR = join(REPO_ROOT, "packages/desktop/build/webflix-icons");

/** The distinctive geometry of the inherited ZCode startup logo (index.html). */
const ZCODE_Z_GLYPH_GEOMETRY = "M134.4 0.130152";

/** Every branding string VALUE this module exports (the rendered surface). */
function brandingValues(): string[] {
  return [
    WEBFLIX_PRODUCT_NAME,
    WEBFLIX_DOCUMENT_TITLE,
    WEBFLIX_MARK_ALT,
    WEBFLIX_SPLASH_ARIA_LABEL,
    WEBFLIX_MARK_SVG,
    webflixAboutLine("9.0.0-test"),
  ];
}

describe("the frozen WebFlix product identity (freeze §6.1)", () => {
  it("pins the product name and document title to exactly WebFlix", () => {
    expect(WEBFLIX_PRODUCT_NAME).toBe("WebFlix");
    expect(WEBFLIX_DOCUMENT_TITLE).toBe("WebFlix");
  });

  it("pins the startup aria label", () => {
    expect(WEBFLIX_SPLASH_ARIA_LABEL).toBe("Loading WebFlix…");
  });

  it("the about/help copy states the honest product line with the version", () => {
    const line = webflixAboutLine("1.2.3");
    expect(line).toContain("WebFlix 1.2.3");
    expect(line).toContain("independent desktop app");
    expect(line).toContain("Local playback works offline");
    expect(line).toContain("each signed-in user's own authorization");
  });
});

describe("the WebFlix mark (requirement 2: a clearly distinct new mark)", () => {
  it("is an original glyph in the shell theme colors — NOT the ZCode Z-glyph", () => {
    expect(WEBFLIX_MARK_SVG).not.toContain(ZCODE_Z_GLYPH_GEOMETRY);
    expect(WEBFLIX_MARK_SVG).not.toContain("currentColor");
    // The brand accent + shell background (webflix-shell theme.ts values).
    expect(WEBFLIX_MARK_SVG).toContain("#2fd6b3");
    expect(WEBFLIX_MARK_SVG).toContain("#0f1420");
    expect(WEBFLIX_MARK_SVG).toContain('aria-label="WebFlix mark"');
  });

  it("does not paste the YouTube play-button red (ADR-0003 independent value)", () => {
    expect(WEBFLIX_MARK_SVG.toLowerCase()).not.toContain("#ff0000");
    expect(WEBFLIX_MARK_SVG.toLowerCase()).not.toContain("#ff0033");
    expect(WEBFLIX_MARK_SVG.toLowerCase()).not.toContain("red");
  });
});

describe("no WebFlix-to-ZCode identity leakage (requirement 6)", () => {
  it("no exported branding value contains a ZCode/Z.ai identity string", () => {
    for (const value of brandingValues()) {
      expect(value).not.toMatch(/zcode|z\.ai|z\. code/i);
      expect(value).not.toContain("智谱");
    }
  });
});

describe("the icon set stays in lockstep with the renderer mark", () => {
  /** The icon folder's ASSET content — XML comments (design notes) stripped. */
  function assetOnly(svg: string): string {
    return svg.replace(/<!--[\s\S]*?-->/g, "");
  }

  it("icon.svg carries EXACTLY the renderer mark's geometry", () => {
    const iconSvg = readFileSync(join(ICON_SET_DIR, "icon.svg"), "utf8");
    const markPaths = [...WEBFLIX_MARK_SVG.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).sort();
    const iconPaths = [...iconSvg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(iconPaths).toEqual(markPaths);
    // And the committed asset is not the ZCode glyph either (the comment
    // block is design documentation; the ASSET must carry no ZCode identity).
    expect(assetOnly(iconSvg)).not.toContain(ZCODE_Z_GLYPH_GEOMETRY);
    expect(assetOnly(iconSvg)).not.toMatch(/ZCode|zcode|Z\.ai/);
  });

  it("the rasterized Linux size set exists (16…1024, the ZCode build/icons convention)", () => {
    const sizes = [
      "16x16",
      "24x24",
      "32x32",
      "48x48",
      "64x64",
      "128x128",
      "256x256",
      "512x512",
      "1024x1024",
    ];
    for (const size of sizes) {
      const png = join(ICON_SET_DIR, "icons", `${size}.png`);
      expect(existsSync(png), `missing ${size}.png`).toBe(true);
      // Non-empty, and actually a PNG (magic bytes).
      const bytes = readFileSync(png);
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  it("no ASSET in the icon set folder carries a ZCode/Z.ai identity string", () => {
    for (const entry of readdirSync(ICON_SET_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      if (entry.name.endsWith(".png")) {
        const raw = readFileSync(join(ICON_SET_DIR, entry.name)).toString("latin1");
        expect(raw).not.toMatch(/ZCode|zcode|Z\.ai/);
        continue;
      }
      // The README documents the boundary in prose (it MUST say ZCode's set
      // is untouched); the ASSETS themselves must carry no ZCode identity —
      // only the SVG and the PNGs are assets (comments in the SVG are
      // design notes, stripped by the assetOnly helper above).
    }
  });
});

describe("the startup-surface swap stays honest (requirement 2)", () => {
  it("splashSwap only ever needs the brand module — no other renderer import", () => {
    const source = readFileSync(join(RENDERER_SRC, "splashSwap.ts"), "utf8");
    expect(source).toContain('from "./brand.js"');
    expect(source).not.toMatch(/from "@zcode\//);
  });
});
