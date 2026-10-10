/**
 * RefreshProviderMetadata — the 30-day TTL refresh for provider-sourced field
 * sets (contract-freeze §7.8).
 *
 * Per candidate track:
 *   - fresh stored set (younger than the TTL) -> kept untouched (`kept-fresh`);
 *   - stale or missing stored set + fetch OK  -> replaced, stamped with a
 *     fresh `fetchedAt` (`refreshed`);
 *   - provider reports `not-found`            -> stored set DELETED
 *     (refresh-or-delete: WebFlix never keeps a copy the provider disowns);
 *   - transient provider `error`              -> stored set kept as-is
 *     (`kept-transient-error`).
 *
 * This use-case is the ONLY writer of `fetchedAt` on provider-sourced field
 * sets, which keeps §7.8's invariant ("fetchedAt on provider-sourced field
 * sets") true by construction.
 */
import type { ClockPort, CredentialPort, LocalStore, ProviderMetadataPort } from './ports';
import type { ProviderFieldSetRecord, ProviderId, TrackId } from './types';

/** Frozen TTL from contract-freeze §7.8. */
export const PROVIDER_METADATA_TTL_DAYS = 30;
export const PROVIDER_METADATA_TTL_MS = PROVIDER_METADATA_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * A stored field set is stale when its `fetchedAt` is at least the TTL old.
 * Unparseable timestamps count as stale (conservative: refresh).
 */
export function isProviderFieldSetStale(record: ProviderFieldSetRecord, now: Date): boolean {
  const fetchedAtMs = Date.parse(record.fetchedAt);
  if (Number.isNaN(fetchedAtMs)) return true;
  return now.getTime() - fetchedAtMs >= PROVIDER_METADATA_TTL_MS;
}

export type RefreshAction =
  | 'refreshed'
  | 'deleted'
  | 'kept-fresh'
  | 'kept-transient-error'
  | 'skipped-unauthenticated';

export interface RefreshOutcome {
  readonly trackId: TrackId;
  readonly action: RefreshAction;
  readonly detail?: string;
}

export interface RefreshProviderMetadataInput {
  readonly provider: ProviderId;
  /**
   * Tracks to refresh. Defaults to every track that already holds a stored
   * field set for the provider; explicitly listed tracks without a stored
   * set are fetched (initial fill).
   */
  readonly trackIds?: readonly TrackId[];
}

export interface RefreshProviderMetadataOutput {
  readonly provider: ProviderId;
  readonly checked: number;
  readonly outcomes: readonly RefreshOutcome[];
}

export interface RefreshProviderMetadataDeps {
  readonly store: LocalStore;
  readonly clock: ClockPort;
  readonly providers: ProviderMetadataPort;
  /** Contract-frozen credential port; without a token the run is skipped. */
  readonly credentials: CredentialPort;
}

export class RefreshProviderMetadata {
  constructor(private readonly deps: RefreshProviderMetadataDeps) {}

  async execute(input: RefreshProviderMetadataInput): Promise<RefreshProviderMetadataOutput> {
    const candidates = await this.resolveCandidates(input.trackIds, input.provider);
    const token = await this.deps.credentials.get(input.provider);

    if (!token) {
      return {
        provider: input.provider,
        checked: candidates.length,
        outcomes: candidates.map((trackId) => ({
          trackId,
          action: 'skipped-unauthenticated' as const,
        })),
      };
    }

    const now = this.deps.clock.now();
    const outcomes: RefreshOutcome[] = [];

    for (const trackId of candidates) {
      const existing = await this.deps.store.getProviderFieldSet(trackId, input.provider);
      if (existing && !isProviderFieldSetStale(existing, now)) {
        outcomes.push({ trackId, action: 'kept-fresh' });
        continue;
      }

      const outcome = await this.deps.providers.fetch(trackId, input.provider);
      if (outcome.kind === 'fetched') {
        const record: ProviderFieldSetRecord = {
          trackId,
          provider: input.provider,
          fields: outcome.fields,
          fetchedAt: now.toISOString(),
        };
        await this.deps.store.putProviderFieldSet(record);
        outcomes.push({ trackId, action: 'refreshed' });
      } else if (outcome.kind === 'not-found') {
        await this.deps.store.deleteProviderFieldSet(trackId, input.provider);
        outcomes.push({ trackId, action: 'deleted' });
      } else {
        outcomes.push({ trackId, action: 'kept-transient-error', detail: outcome.reason });
      }
    }

    return { provider: input.provider, checked: candidates.length, outcomes };
  }

  private async resolveCandidates(
    trackIds: readonly TrackId[] | undefined,
    provider: ProviderId,
  ): Promise<readonly TrackId[]> {
    if (trackIds !== undefined) {
      const seen = new Set<string>();
      const unique: TrackId[] = [];
      for (const id of trackIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
      }
      return unique;
    }
    const stored = await this.deps.store.listProviderFieldSets(provider);
    return stored.map((record) => record.trackId);
  }
}
