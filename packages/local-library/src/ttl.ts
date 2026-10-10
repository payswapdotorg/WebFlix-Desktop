import { PROVIDER_METADATA_TTL_MS } from "./constants";
import type { LocalStorePort } from "./ports";
import type { ProviderMetadataRecord } from "./types";

export type MetadataRefreshResult = { payload: unknown } | null;

export type MetadataRefreshFn = (
  record: ProviderMetadataRecord,
) => Promise<MetadataRefreshResult> | MetadataRefreshResult;

export interface TtlSweepOptions {
  now?: number;
  /**
   * Optional refresher for expired cache rows. Return `{ payload }` to keep the
   * row (its fetchedAt/expiresAt are bumped to `now` / now + 30 days), or null
   * to delete it. A thrown error is treated as "delete". Without a refresher,
   * every expired row is deleted.
   */
  refresh?: MetadataRefreshFn;
}

export interface TtlSweepResult {
  expired: number;
  refreshed: number;
  deleted: number;
}

/** 30-day provider-metadata refresh-or-delete sweep. */
export async function sweepProviderMetadata(
  store: LocalStorePort,
  options: TtlSweepOptions = {},
): Promise<TtlSweepResult> {
  const now = options.now ?? Date.now();
  const cutoff = now - PROVIDER_METADATA_TTL_MS;
  const expired = store.listExpiredProviderMetadata(cutoff);
  let refreshed = 0;
  let deleted = 0;
  for (const record of expired) {
    if (!options.refresh) {
      store.deleteProviderMetadata(record.id);
      deleted += 1;
      continue;
    }
    let replacement: MetadataRefreshResult = null;
    try {
      replacement = await options.refresh(record);
    } catch {
      replacement = null; // refresh failure ⇒ delete
    }
    if (replacement && typeof replacement === "object" && "payload" in replacement) {
      store.refreshProviderMetadata(record.id, replacement.payload, now);
      refreshed += 1;
    } else {
      store.deleteProviderMetadata(record.id);
      deleted += 1;
    }
  }
  return { expired: expired.length, refreshed, deleted };
}
