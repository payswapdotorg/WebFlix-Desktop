import type { EmbeddedBrowserDataClearResult } from "@zcode/shared";
import { clearEmbeddedBrowserData } from "./browserDataManager.js";

/**
 * Provider disconnect → scoped embedded-partition clear (P8-ISOLATION-WIRING-1
 * #3, isolation audit §2.3).
 *
 * The application→desktop adapter seam for disconnect propagation: when an
 * account is disconnected at the application-layer account path, the host
 * calls `clearDisconnectedProviderAccountPartition` with the disconnected
 * account's (providerId, accountKey) and ONLY that account's per-provider
 * embedded-browser partition (`persist:webflix-embedded-<provider>-<hash>`,
 * browserDataManager.ts resolveEmbeddedBrowserPartition) is cleared —
 * other providers' partitions and other accounts' partitions survive, and
 * the legacy shared partition is never touched.
 *
 * HONEST BLOCKER (named per the work order — surfaces are NOT invented): no
 * application-layer account path exists in the tree yet (the audit's §1.5/§2.3:
 * no production OAuthAccountStore, no provider webview surface wired, the
 * desktop does not mount the WebFlix shell). This module IS the ordered
 * minimal seam — the desktop adapter function the future account host calls;
 * wiring it to a real connect/disconnect flow awaits the account-surface
 * order. Until then the only other caller of clearEmbeddedBrowserData is the
 * debug IPC (desktopBrowserDataIpc.ts, mode form, provider-less).
 *
 * Idempotency: clearing is idempotent per (provider, account) — a repeated
 * call re-clears the same partition and succeeds (pinned by test).
 */

/** Refusal error code for a disconnect clear without full account scope. */
export const INVALID_DISCONNECT_SCOPE_ERROR = "invalid_disconnect_scope";

export interface ClearDisconnectedProviderAccountPartitionOptions {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  /** The disconnected account's provider id (e.g. "youtube"). */
  providerId: string;
  /** The disconnected account's key (the internalAccountId). */
  accountKey: string;
}

/**
 * Clears the disconnected account's per-provider embedded-browser partition
 * (mode "all": cache + storage). Refuses without touching ANY partition when
 * the provider/account scope is incomplete — browserDataManager's
 * provider-less form falls back to the SHARED partition, which a disconnect
 * must never clear.
 */
export async function clearDisconnectedProviderAccountPartition(
  options: ClearDisconnectedProviderAccountPartitionOptions,
): Promise<EmbeddedBrowserDataClearResult> {
  const providerId = options.providerId?.trim();
  const accountKey = options.accountKey?.trim();
  if (!providerId || !accountKey) {
    options.logger.warn(
      "[provider-disconnect-clear] refusing unscoped disconnect clear: providerId + accountKey " +
        "are both required (the per-account partition is the only scope a disconnect may clear; " +
        "the shared partition is never cleared here)",
      { hasProviderId: Boolean(providerId), hasAccountKey: Boolean(accountKey) },
    );
    return { success: false, error: INVALID_DISCONNECT_SCOPE_ERROR };
  }
  return clearEmbeddedBrowserData({
    logger: options.logger,
    mode: "all",
    providerId,
    accountKey,
  });
}
