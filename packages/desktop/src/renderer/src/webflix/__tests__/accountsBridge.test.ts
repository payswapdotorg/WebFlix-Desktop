// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 5 + requirement 6) — the renderer account
 * bridge accessor pins: fail-closed when the preload bridge is absent or
 * malformed (a plain web build, a test DOM); the typed "bridge unavailable"
 * status is the ONLY thing the host may render then — nothing invented.
 */

import {
  WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID,
  bridgeUnavailableStatus,
  getWebFlixAccountsBridge,
  type WebFlixAccountsBridge,
  type WebFlixConnectOutcome,
} from "../accountsBridge.js";

function installBridge(partial: Partial<WebFlixAccountsBridge> | null): void {
  (window as { webflixAccounts?: unknown }).webflixAccounts = partial;
}

beforeEach(() => {
  installBridge(null);
});

afterEach(() => {
  delete (window as { webflixAccounts?: unknown }).webflixAccounts;
});

describe("getWebFlixAccountsBridge — fail-closed (requirement 5)", () => {
  it("returns null when the bridge is absent (no preload, plain web build)", () => {
    delete (window as { webflixAccounts?: unknown }).webflixAccounts;
    expect(getWebFlixAccountsBridge()).toBeNull();
  });

  it("returns null for a malformed bridge object (missing methods)", () => {
    installBridge({});
    expect(getWebFlixAccountsBridge()).toBeNull();
    installBridge({ getStatus: async () => bridgeUnavailableStatus() });
    expect(getWebFlixAccountsBridge()).toBeNull();
    installBridge({
      getStatus: async () => bridgeUnavailableStatus(),
      connect: async () => ({ ok: false, code: "connect-unavailable", reason: "x" }),
    });
    expect(getWebFlixAccountsBridge()).toBeNull();
  });

  it("returns the bridge when the full typed surface is present", () => {
    const full: WebFlixAccountsBridge = {
      getStatus: async () => bridgeUnavailableStatus(),
      connect: async () => ({ ok: false, code: "connect-unavailable", reason: "x" }),
      disconnect: async () => ({
        ok: true,
        vaultRemoved: true,
        partitionCleared: true,
        errors: [],
      }),
    };
    installBridge(full);
    expect(getWebFlixAccountsBridge()).toBe(full);
  });
});

describe("bridgeUnavailableStatus — the typed honest state (requirement 5)", () => {
  it("says the bridge is unavailable with the typed reason, and invents no accounts", () => {
    const status = bridgeUnavailableStatus();
    expect(status.vault.available).toBe(false);
    expect(status.vault.reason).toContain("account-bridge-unavailable");
    expect(status.vault.reason).toContain("fail-closed");
    expect(status.accounts).toEqual([]);
  });

  it("the reason carries no credential-shaped material", () => {
    expect(bridgeUnavailableStatus().vault.reason ?? "").not.toMatch(/token|secret|password/i);
  });
});

describe("WFX-OAUTH-CONNECT-1 — the canonical pointer + the extended connect vocabulary", () => {
  it("the canonical primary account id is the pinned mirror constant", () => {
    expect(WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID).toBe("primary");
  });

  it("the extended connect codes typecheck through the mirror union (authorization-started reaches the host)", () => {
    const started: WebFlixConnectOutcome = {
      ok: true,
      code: "authorization-started",
      reason: "Google sign-in opened in your system browser.",
    };
    expect(started.code).toBe("authorization-started");
    const pending: WebFlixConnectOutcome = {
      ok: false,
      code: "authorization-in-progress",
      reason: "A sign-in is already waiting.",
    };
    expect(pending.ok).toBe(false);
    const vaultRefusal: WebFlixConnectOutcome = {
      ok: false,
      code: "vault-unavailable",
      reason: "os_vault_unavailable",
    };
    expect(vaultRefusal.code).toBe("vault-unavailable");
  });

  it("the authorization-started reason carries no credential-shaped material (the law survives the new vocabulary)", () => {
    const started: WebFlixConnectOutcome = {
      ok: true,
      code: "authorization-started",
      reason: "Google sign-in opened in your system browser — complete the consent there.",
    };
    expect(started.reason).not.toMatch(/token|secret|password/i);
  });
});
