// swap-at-integration: re-point to packages/webflix-contracts
//
// Local mirror of the contract-freeze (5549208) §2 wire types, vendored so the
// D1 shell builds before packages/webflix-contracts lands. These are copies of
// the frozen shapes, not reinterpretations: at integration time this file is
// deleted and every import is re-pointed at packages/webflix-contracts.
// Do NOT add, remove, or rename the frozen fields here.

/**
 * §2.1 — provider ids are stable, opaque cross-lane identifiers.
 * 'youtube' is the D3 provider; the D2 local lane uses 'local'.
 */
export type ProviderId = string;
export const PROVIDER_YOUTUBE: ProviderId = 'youtube';
export const PROVIDER_LOCAL: ProviderId = 'local';

/** §2.1 — one row of the unified catalog. */
export interface CatalogItem {
  readonly id: string;
  readonly title: string;
  readonly providerId: ProviderId;
  /** 'stream' = remote playable via the provider's official player; 'local-file' = file on disk (D2 lane). */
  readonly kind: 'stream' | 'local-file';
  readonly description?: string;
  readonly artworkUrl?: string;
  readonly durationSeconds?: number;
}

/**
 * §2.2 — how (or whether) an item may be played.
 * 'unavailable' must always carry a human-readable `reason` AND an actionable
 * `recovery`; the Watch screen renders both verbatim.
 */
export type PlaybackPlan =
  | {
      readonly strategy: 'official-embed';
      readonly itemId: string;
      readonly title: string;
      /** URL for the provider's official embed player — never scraped streams (freeze §4). */
      readonly embedUrl: string;
    }
  | {
      readonly strategy: 'local-file';
      readonly itemId: string;
      readonly title: string;
      readonly filePath: string;
      readonly mimeType?: string;
    }
  | {
      readonly strategy: 'unavailable';
      readonly itemId: string;
      readonly title: string;
      readonly reason: string;
      readonly recovery: string;
    };

/**
 * §2.3 — capability probe result. The honest-state vocabulary in states.ts
 * maps every `kind` onto a visible UI state; 'unknown' must surface as
 * "Status unknown" and is never collapsed into success or a dead control.
 */
export type CapabilityStatus =
  | { readonly kind: 'available' }
  | { readonly kind: 'requires-auth'; readonly providerId: ProviderId; readonly connectUrl?: string }
  | { readonly kind: 'rate-limited'; readonly providerId: ProviderId; readonly retryAfterSeconds?: number }
  | { readonly kind: 'unsupported'; readonly providerId: ProviderId; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly detail?: string };

/** §2.4 — lifecycle state of a connected provider account. */
export type AccountState = 'connected' | 'expired' | 'revoked';

/** §2.4 — one connected (or formerly connected) provider account. */
export interface ProviderAccountRecord {
  readonly accountId: string;
  readonly providerId: ProviderId;
  readonly displayName: string;
  readonly state: AccountState;
  readonly connectedAt?: string;
  readonly tokenExpiresAt?: string;
  readonly scopes?: readonly string[];
}

// --- Shell-local view models (NOT part of the freeze; safe to evolve here) ---

/** A user-curated collection rendered on the Library screen. */
export interface LibraryCollection {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly itemIds: readonly string[];
}
