// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * WFX-OAUTH-CONNECT-1 — the account/retention handler family pins:
 *   - The initial getStatus asks about the CANONICAL primary pointer (a
 *     really connected account renders at boot — the old empty-pointer read
 *     could never show one).
 *   - An authorization-started outcome starts the bounded completion poll:
 *     the pointer is re-queried until the connected record appears, then the
 *     poll stops (no infinite ticking).
 *   - A refusal outcome (connect-unavailable) starts NO poll.
 *   - Unmount stops the poll (no post-unmount setState).
 */

import type { WebFlixAccountsBridge, WebFlixAccountsStatus, WebFlixConnectOutcome } from "../accountsBridge.js";
import { WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID } from "../accountsBridge.js";
import { useAccountRetentionHandlers } from "../useAccountRetentionHandlers.js";
import type { RetentionSession } from "../retentionSession.js";
import type { ProviderAccountRecord } from "../../../../../../../webflix-contracts/src/index.js";

const PRIMARY_POINTER = { providerId: "youtube", internalAccountId: WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID };

function makeRecord(): ProviderAccountRecord {
  return {
    providerId: "youtube",
    internalAccountId: WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID,
    displayName: "Google test account",
    grantedScopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    status: "connected",
    connectedAt: "2026-10-23T00:00:00.000Z",
  };
}

function makeRetentionDouble(): RetentionSession {
  return {
    getRetentionState: async () => ({ historyTracking: { paused: false } }) as never,
    pauseHistoryTracking: async () => {},
    resumeHistoryTracking: async () => {},
    resetLocalData: async () => ({ ok: true }) as never,
  } as unknown as RetentionSession;
}

function emptyStatus(): WebFlixAccountsStatus {
  return { vault: { available: true, reason: null }, accounts: [] };
}

describe("useAccountRetentionHandlers — the canonical pointer (WFX-OAUTH-CONNECT-1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the initial getStatus asks about the canonical primary pointer", async () => {
    const getStatus = vi.fn(async (): Promise<WebFlixAccountsStatus> => emptyStatus());
    const bridge: WebFlixAccountsBridge = {
      getStatus,
      connect: async () => ({ ok: false, code: "connect-unavailable", reason: "x" }),
      disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
    };
    const retention = makeRetentionDouble();

    const { result } = renderHook(() => useAccountRetentionHandlers(bridge, retention));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getStatus).toHaveBeenCalledWith([PRIMARY_POINTER]);
    expect(result.current.accountsStatus).toEqual(emptyStatus());
  });

  it("an authorization-started outcome polls until the connected record appears, then stops", async () => {
    const record = makeRecord();
    let connected = false;
    const getStatus = vi.fn(async (): Promise<WebFlixAccountsStatus> =>
      connected
        ? { vault: { available: true, reason: null }, accounts: [record] }
        : emptyStatus(),
    );
    const connect = vi.fn(async (): Promise<WebFlixConnectOutcome> => ({
      ok: true,
      code: "authorization-started",
      reason: "Google sign-in opened in your system browser.",
    }));
    const bridge: WebFlixAccountsBridge = {
      getStatus,
      connect,
      disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
    };
    const retention = makeRetentionDouble();

    const { result } = renderHook(() => useAccountRetentionHandlers(bridge, retention));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      result.current.handleConnect("youtube");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.connectAttempt?.outcome.code).toBe("authorization-started");

    // Tick 1: still nothing connected — the poll keeps waiting.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getStatus).toHaveBeenCalledTimes(2);

    // The consent completes: the next tick sees the record and stops polling.
    connected = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.accountsStatus?.accounts).toHaveLength(1);
    expect(result.current.accountsStatus?.accounts[0]?.internalAccountId).toBe(
      WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID,
    );

    const settledCalls = getStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getStatus.mock.calls.length).toBe(settledCalls);
  }, 15_000);

  it("a refusal outcome starts NO completion poll", async () => {
    const getStatus = vi.fn(async (): Promise<WebFlixAccountsStatus> => emptyStatus());
    const bridge: WebFlixAccountsBridge = {
      getStatus,
      connect: async () => ({ ok: false, code: "connect-unavailable", reason: "not configured" }),
      disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
    };
    const retention = makeRetentionDouble();

    const { result } = renderHook(() => useAccountRetentionHandlers(bridge, retention));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const initialCalls = getStatus.mock.calls.length;

    await act(async () => {
      result.current.handleConnect("youtube");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.connectAttempt?.outcome.code).toBe("connect-unavailable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getStatus.mock.calls.length).toBe(initialCalls);
  });

  it("unmount stops the poll (no post-unmount state writes)", async () => {
    const getStatus = vi.fn(async (): Promise<WebFlixAccountsStatus> => emptyStatus());
    const bridge: WebFlixAccountsBridge = {
      getStatus,
      connect: async () => ({ ok: true, code: "authorization-started", reason: "x" }),
      disconnect: async () => ({ ok: true, vaultRemoved: true, partitionCleared: true, errors: [] }),
    };

    const retention = makeRetentionDouble();
    const { result, unmount } = renderHook(() =>
      useAccountRetentionHandlers(bridge, retention),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      result.current.handleConnect("youtube");
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();

    const callsAtUnmount = getStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStatus.mock.calls.length).toBe(callsAtUnmount);
  });
});
