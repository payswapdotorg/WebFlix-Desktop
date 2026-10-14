import type { EmbeddedBrowserDataClearResult } from "@zcode/shared";
import type { OAuthAccountStore } from "connectors";
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

// ---------------------------------------------------------------------------
// P8-VAULT-1 additive composition (ruling 6; phase8-successor-payload.md's
// "the disconnect composition (vault remove + the P8-ISOLATION scoped
// partition clear)"; isolation audit §1.5/§2.3). Additive ONLY — the
// #3 adapter above is untouched.
// ---------------------------------------------------------------------------

/**
 * The vault surface a disconnect needs. `Pick` of the frozen
 * OAuthAccountStore (connectors/src/youtube/oauth.ts) — TYPE-ONLY import,
 * erased at compile time (no runtime dependency on the connectors package);
 * the OS vault behind the seam is `createOsVaultAccountStore`
 * (./webflix/osVaultAccountStore.ts), injected by the future mount order.
 */
export type DisconnectAccountRemovalStore = Pick<
  OAuthAccountStore,
  "removeAccount" | "removeTokens"
>;

/** Typed failure code: a vault remove (record or tokens) failed mid-disconnect. */
export const DISCONNECT_VAULT_REMOVE_ERROR = "disconnect_vault_remove_error";

export interface DisconnectProviderAccountOptions {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  /** The disconnected account's provider id (e.g. "youtube"). */
  providerId: string;
  /** The disconnected account's key (the internalAccountId). */
  accountKey: string;
  /** The provider's OAuthAccountStore (the OS vault) — record + tokens are removed. */
  accountStore: DisconnectAccountRemovalStore;
}

export interface DisconnectProviderAccountResult {
  /** True only when BOTH legs succeeded (vault removal AND partition clear). */
  success: boolean;
  /** The account's record AND tokens were removed from the OS vault. */
  vaultRemoved: boolean;
  /** The account's scoped embedded-browser partition was cleared. */
  partitionCleared: boolean;
  /** Typed error codes, vault-leg errors first then the partition error; empty on success. */
  errors: string[];
}

/**
 * The full provider-account disconnect composition (P8-VAULT-1 ruling 6):
 * remove the disconnected account's record + tokens from the OS vault AND
 * clear its scoped embedded-browser partition — one idempotent,
 * order-independent call for the future account host. NO IPC/preload/
 * renderer surface is invented here (mounting is the mount order's call).
 *
 * Order-independence by construction: BOTH legs are always attempted — a
 * vault-remove failure never skips the partition clear, and a partition-clear
 * failure never skips the vault removal — so the observable end state never
 * depends on leg order, and a retry of the same call converges (every leg
 * operation is itself idempotent). An unscoped call refuses without touching
 * the vault or ANY partition.
 */
export async function disconnectProviderAccount(
  options: DisconnectProviderAccountOptions,
): Promise<DisconnectProviderAccountResult> {
  const providerId = options.providerId?.trim();
  const accountKey = options.accountKey?.trim();
  if (!providerId || !accountKey || typeof options.accountStore?.removeAccount !== "function") {
    options.logger.warn(
      "[provider-disconnect] refusing unscoped disconnect: providerId + accountKey + accountStore " +
        "are all required (a disconnect may only remove ONE account's vault entries and ONE " +
        "account's partition; nothing is touched otherwise)",
      {
        hasProviderId: Boolean(providerId),
        hasAccountKey: Boolean(accountKey),
        hasAccountStore: typeof options.accountStore?.removeAccount === "function",
      },
    );
    return {
      success: false,
      vaultRemoved: false,
      partitionCleared: false,
      errors: [INVALID_DISCONNECT_SCOPE_ERROR],
    };
  }

  // Leg 1 — the OS vault removes. Each remove is attempted even when the
  // other threw (disjoint files, idempotent): a partial failure can never
  // strand one half of the account's vault entries, and a retry heals.
  const errors: string[] = [];
  let vaultRemoved = true;
  const vaultRemovals: Array<[label: string, remove: () => Promise<void>]> = [
    ["tokens", () => options.accountStore.removeTokens(accountKey)],
    ["record", () => options.accountStore.removeAccount(accountKey)],
  ];
  for (const [label, remove] of vaultRemovals) {
    try {
      await remove();
    } catch (error) {
      vaultRemoved = false;
      errors.push(DISCONNECT_VAULT_REMOVE_ERROR);
      options.logger.warn(
        "[provider-disconnect] vault remove failed during disconnect (idempotent retry converges)",
        { providerId, accountKey, entry: label, error: String(error) },
      );
    }
  }

  // Leg 2 — the scoped partition clear (P8-ISOLATION-WIRING-1 #3; refuses
  // unscoped and never touches the shared partition — unchanged).
  const partition = await clearDisconnectedProviderAccountPartition({
    logger: options.logger,
    providerId,
    accountKey,
  });
  if (!partition.success) {
    errors.push(partition.error ?? "embedded_browser_clear_failed");
  }

  if (errors.length === 0) {
    options.logger.info(
      "[provider-disconnect] provider account disconnected (vault entries removed + scoped partition cleared)",
      { providerId, accountKey },
    );
  }
  return {
    success: vaultRemoved && partition.success,
    vaultRemoved,
    partitionCleared: partition.success,
    errors,
  };
}
