// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * P9-UI-1 (order requirement 5 + requirement 6) — the renderer account
 * bridge accessor pins: fail-closed when the preload bridge is absent or
 * malformed (a plain web build, a test DOM); the typed "bridge unavailable"
 * status is the ONLY thing the host may render then — nothing invented.
 */

import {
  bridgeUnavailableStatus,
  getWebFlixAccountsBridge,
  type WebFlixAccountsBridge,
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
