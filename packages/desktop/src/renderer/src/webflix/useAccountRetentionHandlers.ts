/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the account +
 * retention handler family, extracted from boot.tsx for the max-lines law.
 * Behavior is byte-equivalent: the typed connect outcome path, the
 * fail-closed disconnect (the next status read carries the truth), and the
 * retention use-case wrappers.
 */
import { useCallback, useEffect, useState } from "react";
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
import { bridgeUnavailableStatus } from "./accountsBridge.js";
import { YOUTUBE_PROVIDER_ID } from "./searchFlow.js";

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

  // The honest initial reads: account status + retention state.
  useEffect(() => {
    let active = true;
    if (accountsBridge === null) {
      setAccountsStatus(bridgeUnavailableStatus());
    } else {
      accountsBridge
        .getStatus([])
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
    [accountsBridge],
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
        .then(() => accountsBridge.getStatus([]))
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
