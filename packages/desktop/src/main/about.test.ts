import { describe, expect, it } from "vitest";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";

import { ABOUT_APPLICATION_NAME, ABOUT_MESSAGES } from "./about.js";

/*
 * WFX-DIST-1 — the About-surface flavor pin (run 41228318598's finding: the
 * webflix package opened a fully ZCode-branded About window through
 * Help→About on every non-darwin platform — the same leak class as the NSIS
 * installer FileDescription, which the Windows release lane's fail-closed
 * gate caught the same run).
 *
 * The battery bakes __ZCODE_PRODUCT_FLAVOR__="webflix" (root vitest.config),
 * so this suite pins the WEBFLIX branch of the About branding.
 */

describe("WFX-DIST-1 — the About surface follows the baked product flavor", () => {
  it("this battery bakes the webflix flavor (guard against a config drift)", () => {
    expect(ZCODE_PRODUCT_FLAVOR).toBe("webflix");
  });

  it("the application name is the WebFlix identity value", () => {
    expect(ABOUT_APPLICATION_NAME).toBe("WebFlix Desktop App");
  });

  it("no About string renders a ZCode brand on the webflix flavor", () => {
    for (const [locale, messages] of Object.entries(ABOUT_MESSAGES)) {
      expect(messages.aboutTitle, `aboutTitle (${locale})`).not.toMatch(/[Zz][Cc]ode/);
      expect(messages.aboutTitle, `aboutTitle (${locale})`).toMatch(/WebFlix/);
      expect(messages.copyright(2026), `copyright (${locale})`).not.toMatch(/[Zz][Cc]ode/);
      expect(messages.copyright(2026), `copyright (${locale})`).toMatch(/WebFlix/);
    }
  });
});
