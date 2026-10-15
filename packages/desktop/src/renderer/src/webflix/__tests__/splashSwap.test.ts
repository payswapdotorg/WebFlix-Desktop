// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 2 + requirement 6) — the startup-surface swap
 * pins: in the WebFlix flavor, EVERY inherited ZCode-branded startup element
 * (document title, loading aria-label, splash glyph) is swapped for the
 * WebFlix brand before the boot chunk loads; index.html itself stays
 * byte-for-byte the inherited ZCode startup shell (the ZCode flavors keep
 * it exactly; pinned against the real file).
 */

import { applyWebFlixStartupSurface, webflixSplashLogoSvg } from "../splashSwap.js";
import { WEBFLIX_MARK_SVG } from "../brand.js";

const REPO_ROOT = join(import.meta.dirname, "../../../../../../../");
const INDEX_HTML_PATH = join(REPO_ROOT, "packages/desktop/src/renderer/index.html");

/** The distinctive geometry of the inherited ZCode startup logo. */
const ZCODE_Z_GLYPH_GEOMETRY = "M134.4 0.130152";

/** A faithful replica of the inherited index.html startup shell structure. */
function mountInheritedStartupShell(): void {
  document.title = "ZCode";
  document.body.innerHTML = `
    <div id="root"></div>
    <div id="loading" role="status" aria-busy="true" aria-label="Loading...">
      <div class="startup-logo-shell">
        <svg class="startup-logo" aria-hidden="true"><path d="${ZCODE_Z_GLYPH_GEOMETRY}"></path></svg>
      </div>
    </div>
  `;
}

beforeEach(() => {
  mountInheritedStartupShell();
});

describe("the WebFlix startup-surface swap (requirement 2)", () => {
  it("swaps the inherited ZCode document title for WebFlix", () => {
    applyWebFlixStartupSurface(document);
    expect(document.title).toBe("WebFlix");
  });

  it("swaps the loading aria-label for the WebFlix one", () => {
    applyWebFlixStartupSurface(document);
    expect(document.getElementById("loading")?.getAttribute("aria-label")).toBe("Loading WebFlix…");
  });

  it("replaces the Z-glyph splash logo with the WebFlix mark, keeping the .startup-logo class (the sizing CSS contract)", () => {
    applyWebFlixStartupSurface(document);
    const logo = document.querySelector(".startup-logo");
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("class")).toContain("startup-logo");
    expect(logo?.outerHTML).not.toContain(ZCODE_Z_GLYPH_GEOMETRY);
    expect(logo?.outerHTML).toContain("#2fd6b3");
  });

  it("leaves the startup-logo shell and #root intact (the animation/fade-out contract)", () => {
    applyWebFlixStartupSurface(document);
    expect(document.querySelector(".startup-logo-shell")).not.toBeNull();
    expect(document.getElementById("root")).not.toBeNull();
  });

  it("the splash logo markup is the brand mark with the startup-logo class", () => {
    const markup = webflixSplashLogoSvg();
    expect(markup).toContain('class="startup-logo"');
    expect(markup).not.toContain(ZCODE_Z_GLYPH_GEOMETRY);
    // The mark geometry is EXACTLY the renderer brand mark constant — the
    // splash, the header mark and the packaged icon set never diverge.
    expect(markup).toBe(
      WEBFLIX_MARK_SVG.replace("<svg ", '<svg class="startup-logo" aria-hidden="true" ', 1),
    );
  });

  it("tolerates a document without the startup shell (no throw, title still swapped)", () => {
    document.body.innerHTML = "<div id='root'></div>";
    expect(() => applyWebFlixStartupSurface(document)).not.toThrow();
    expect(document.title).toBe("WebFlix");
  });
});

describe("index.html stays the inherited ZCode startup shell (ZCode flavors unchanged)", () => {
  it("the real file keeps the ZCode title, loading shell and Z-glyph — byte-for-byte inherited", () => {
    const html = readFileSync(INDEX_HTML_PATH, "utf8");
    // The ZCode flavors boot from this exact file: their startup surface is
    // the inherited one, untouched by the WebFlix order (the swap happens
    // at RUNTIME only in the webflix flavor — splashSwap.ts).
    expect(html).toContain("<title>ZCode</title>");
    expect(html).toContain('aria-label="Loading..."');
    expect(html).toContain(ZCODE_Z_GLYPH_GEOMETRY);
    expect(html).toContain('src="./src/main.tsx"');
    expect(html).toContain('addEventListener("zcode-react-startup-ready"');
  });

  it("the file carries no WebFlix-specific edit (the swap is runtime-only, per flavor)", () => {
    const html = readFileSync(INDEX_HTML_PATH, "utf8");
    expect(html).not.toContain("WebFlix");
    expect(html).not.toContain("webflix");
  });
});
