/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the account +
 * retention handler family, extracted from boot.tsx for the max-lines law.
 * WFX-OAUTH-CONNECT-1: getStatus now queries the canonical primary pointer
 * (a really connected account renders at boot), and an authorization-started
 * outcome starts the bounded completion poll (the connected record appears
 * when the browser consent completes; late failures leave no record — the
 * main log carries the typed detail). The fail-closed disconnect (the next
 * status read carries the truth) and the retention use-case wrappers are
 * unchanged.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RetentionScope,
  RetentionState,
  ResetLocalDataResult,
} from "../../../../../webflix-application/src/index.js";
import type { RetentionSession } from "./retentionSession.js";
import type {
  WebFlixAccountPointer,
  WebFlixAccountsBridge,
  WebFlixAccountsStatus,
  WebFlixConnectOutcome,
} from "./accountsBridge.js";
import { bridgeUnavailableStatus, WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID } from "./accountsBridge.js";
import { YOUTUBE_PROVIDER_ID } from "./searchFlow.js";

/** The canonical pointer the host asks the vault about (single-account scope). */
const PRIMARY_ACCOUNT_POINTERS: readonly WebFlixAccountPointer[] = [
  { providerId: YOUTUBE_PROVIDER_ID, internalAccountId: WEBFLIX_YOUTUBE_PRIMARY_ACCOUNT_ID },
];

/** Completion-poll cadence/window (WFX-OAUTH-CONNECT-1): 2s ticks, 300s cap. */
const AUTHORIZATION_POLL_INTERVAL_MS = 2_000;
const AUTHORIZATION_POLL_WINDOW_MS = 300_000;

export interface AccountRetentionHandlers {
  readonly accountsStatus: WebFlixAccountsStatus | null;
  readonly connectAttempt: {
    readonly providerId: string;
    readonly outcome: WebFlixConnectOutcome;
  } | null;
  readonly retentionState: RetentionState | null;
  readonly resetResult: ResetLocalDataResult | null;
  readonly handleConnect: (providerId: string) => void;
  readonly handleDisconnect: (internalAccountId: string) => void;
  readonly handlePauseHistory: () => Promise<void>;
  readonly handleResumeHistory: () => Promise<void>;
  readonly handleResetLocalData: (scope: RetentionScope) => Promise<void>;
}

/** Builds the account + retention handler family over the real bridges. */
export function useAccountRetentionHandlers(
  accountsBridge: WebFlixAccountsBridge | null,
  retention: RetentionSession,
): AccountRetentionHandlers {
  const [accountsStatus, setAccountsStatus] = useState<WebFlixAccountsStatus | null>(null);
  const [connectAttempt, setConnectAttempt] = useState<{
    readonly providerId: string;
    readonly outcome: WebFlixConnectOutcome;
  } | null>(null);
  const [retentionState, setRetentionState] = useState<RetentionState | null>(null);
  const [resetResult, setResetResult] = useState<ResetLocalDataResult | null>(null);
  const authorizationPollRef = useRef<{ stop: () => void } | null>(null);

  const stopAuthorizationPoll = useCallback(() => {
    authorizationPollRef.current?.stop();
    authorizationPollRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopAuthorizationPoll();
    };
  }, [stopAuthorizationPoll]);

  /**
   * The bounded completion poll (WFX-OAUTH-CONNECT-1): after
   * authorization-started, re-read the vault status until the connected
   * record appears (consent completed) or the window expires — the honest
   * renderer-side signal; nothing is invented, late failures simply leave
   * no record and the main log carries the typed detail.
   */
  const startAuthorizationPoll = useCallback(
    (bridge: WebFlixAccountsBridge) => {
      stopAuthorizationPoll();
      const startedAtMs = Date.now();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const stop = () => {
        stopped = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        if (authorizationPollRef.current?.stop === stop) {
          authorizationPollRef.current = null;
        }
      };
      authorizationPollRef.current = { stop };
      const tick = () => {
        if (stopped) return;
        if (Date.now() - startedAtMs >= AUTHORIZATION_POLL_WINDOW_MS) {
          stop();
          return;
        }
        bridge
          .getStatus(PRIMARY_ACCOUNT_POINTERS)
          .then((status) => {
            if (stopped) return;
            setAccountsStatus(status);
            if (status.accounts.length > 0) {
              stop();
              return;
            }
            timer = setTimeout(tick, AUTHORIZATION_POLL_INTERVAL_MS);
          })
          .catch(() => {
            if (!stopped) {
              timer = setTimeout(tick, AUTHORIZATION_POLL_INTERVAL_MS);
            }
          });
      };
      timer = setTimeout(tick, AUTHORIZATION_POLL_INTERVAL_MS);
    },
    [stopAuthorizationPoll],
  );

  // The honest initial reads: account status (the canonical primary
  // pointer — a really connected account renders at boot) + retention state.
  useEffect(() => {
    let active = true;
    if (accountsBridge === null) {
      setAccountsStatus(bridgeUnavailableStatus());
    } else {
      accountsBridge
        .getStatus(PRIMARY_ACCOUNT_POINTERS)
        .then((status) => {
          if (active) setAccountsStatus(status);
        })
        .catch(() => {
          if (active) setAccountsStatus(bridgeUnavailableStatus());
        });
    }
    retention
      .getRetentionState()
      .then((state) => {
        if (active) setRetentionState(state);
      })
      .catch(() => {
        /* absence stays honest: null = not loaded */
      });
    return () => {
      active = false;
    };
  }, [accountsBridge, retention]);

  const handleConnect = useCallback(
    (providerId: string) => {
      if (accountsBridge === null) {
        setConnectAttempt({
          providerId,
          outcome: {
            ok: false,
            code: "connect-unavailable",
            reason:
              "Connect is unavailable in this runtime (no desktop account bridge) — nothing was authorized.",
          },
        });
        return;
      }
      accountsBridge
        .connect(providerId)
        .then((outcome) => {
          setConnectAttempt({ providerId, outcome });
          if (outcome.ok && outcome.code === "authorization-started") {
            startAuthorizationPoll(accountsBridge);
          }
        })
        .catch(() => {
          setConnectAttempt({
            providerId,
            outcome: {
              ok: false,
              code: "connect-unavailable",
              reason: "Connect failed unexpectedly — nothing was authorized.",
            },
          });
        });
    },
    [accountsBridge, startAuthorizationPoll],
  );

  const handleDisconnect = useCallback(
    (internalAccountId: string) => {
      if (accountsBridge === null) return;
      const pointer: WebFlixAccountPointer = {
        providerId: YOUTUBE_PROVIDER_ID,
        internalAccountId,
      };
      accountsBridge
        .disconnect(pointer)
        .then(() => accountsBridge.getStatus(PRIMARY_ACCOUNT_POINTERS))
        .then((status) => {
          setAccountsStatus(status);
        })
        .catch(() => {
          /* the next status read carries the truth; nothing invented here */
        });
    },
    [accountsBridge],
  );

  const handlePauseHistory = useCallback(async () => {
    await retention.pauseHistoryTracking();
    setRetentionState(await retention.getRetentionState());
  }, [retention]);

  const handleResumeHistory = useCallback(async () => {
    await retention.resumeHistoryTracking();
    setRetentionState(await retention.getRetentionState());
  }, [retention]);

  const handleResetLocalData = useCallback(
    async (scope: RetentionScope) => {
      const result = await retention.resetLocalData(scope);
      setResetResult(result);
      setRetentionState(await retention.getRetentionState());
    },
    [retention],
  );

  return {
    accountsStatus,
    connectAttempt,
    retentionState,
    resetResult,
    handleConnect,
    handleDisconnect,
    handlePauseHistory,
    handleResumeHistory,
    handleResetLocalData,
  };
}
