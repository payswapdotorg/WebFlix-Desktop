/**
 * Contract types — swap-at-integration mirror of the WebFlix-Desktop interface
 * freeze, §2.3 (capability manifests) and §2.5 (credentials & provider accounts).
 *
 * This file deliberately MIRRORS the frozen contracts instead of importing them so
 * packages/connectors can be swapped at integration time without a compile-time
 * dependency on the contracts package; the round-trip tests pin the shapes so
 * drift fails loudly.
 *
 * Governing policy: ADR-0003 — official surfaces ONLY. Every OperationCapability
 * row must cite its official source in `provenance`; anything without an official
 * surface is declared `unsupported` (honest-unsupported) and is never faked,
 * scraped, or reverse-engineered.
 */

/** Honest capability verdict for one provider operation. */
export type CapabilityStatus =
  /** An official provider surface exists and is used by this connector. */
  | 'supported-official'
  /** No official surface exists; the connector refuses to fake or scrape it. */
  | 'unsupported';

/** Product-facing capability family an operation belongs to. */
export type OperationCategory =
  | 'browse'
  | 'search'
  | 'metadata'
  | 'history'
  | 'notifications'
  | 'related'
  | 'community'
  | 'memberships'
  | 'superchat'
  | 'premiere'
  | 'search-suggestions'
  | 'home-feed';

/** Citation for the official source (provider docs, or the audit decision) behind a row. */
export interface ProvenanceCitation {
  label: string;
  url: string;
}

/**
 * One row of a ConnectorManifest: what the provider can honestly do, via which
 * official mechanism, at what quota cost, backed by which provenance.
 */
export interface OperationCapability {
  /**
   * Stable operation id — an official endpoint name (e.g. "search.list") or a
   * capability slug for honest-unsupported rows (e.g. "home-feed").
   */
  operationId: string;
  category: OperationCategory;
  summary: string;
  status: CapabilityStatus;
  /** Official mechanism (endpoint/method) when supported-official; null when unsupported. */
  mechanism: string | null;
  /** Official quota units charged per call (provider currency); 0 for unsupported rows. */
  quotaCost: number;
  /** Why the row is unsupported (honest-unsupported reason); null when supported. */
  reasonUnsupported: string | null;
  /** Official-source citations backing this row. Never empty. */
  provenance: ProvenanceCitation[];
}

/** Provider quota model, expressed in the provider's own units. */
export interface ConnectorQuotaPolicy {
  currency: string;
  defaultDailyLimit: number;
  referenceCosts: {
    read: number;
    write: number;
    searchList?: number;
  };
  notes: string[];
}

/** Governance block pinned onto every manifest. */
export interface ConnectorManifestPolicy {
  /** ADR-0003: official surfaces only — always true, enforced by the registry. */
  officialSurfacesOnly: true;
  adr: 'ADR-0003';
}

/**
 * ConnectorManifest (freeze §2.3): the single declarative description of what a
 * provider connector supports, via which official surfaces, at what quota cost,
 * with which provenance.
 */
export interface ConnectorManifest {
  providerId: string;
  displayName: string;
  manifestVersion: string;
  policy: ConnectorManifestPolicy;
  /** Official base URLs this connector is allowed to speak to. */
  officialSurfaces: string[];
  requiresOAuth: boolean;
  /** Official OAuth scopes requested (minimum necessary). */
  scopes: string[];
  quota: ConnectorQuotaPolicy;
  operations: OperationCapability[];
  /** The audit document that seeded this manifest. */
  sources: { auditDoc: string; sections: string[] };
  notes: string[];
}

/** Lifecycle status of a per-user provider account (freeze §2.5). */
export type ProviderAccountStatus = 'requires-auth' | 'authorized' | 'expired' | 'revoked';

/** Credential material held for one (providerId, userId) pair. */
export interface ProviderCredentials {
  accessToken: string | null;
  refreshToken: string | null;
  /** Access-token expiry in epoch ms (null when unknown). */
  expiresAt: number | null;
  scope: string | null;
  tokenType: string | null;
}

/** Per-user provider account record (freeze §2.5) — account identity + credentials. */
export interface ProviderAccountRecord {
  providerId: string;
  /** WebFlix local user id — OAuth is strictly per-user. */
  userId: string;
  providerAccountId: string | null;
  displayName: string | null;
  status: ProviderAccountStatus;
  linkedAt: number | null;
  updatedAt: number;
  credentials: ProviderCredentials | null;
}

/**
 * CredentialPort (freeze §2.3/§2.5): persistence boundary for per-user provider
 * account records (including credential material). Implementations live in the
 * app layer (safe storage); connectors only ever see this port.
 */
export interface CredentialPort {
  get(providerId: string, userId: string): Promise<ProviderAccountRecord | null>;
  put(record: ProviderAccountRecord): Promise<void>;
  remove(providerId: string, userId: string): Promise<void>;
}

/** IFrame attributes for an official embed. */
export interface PlaybackPlanIframeSpec {
  width: number;
  height: number;
  title: string;
  allow: string;
  allowFullScreen: boolean;
  referrerPolicy: string;
  style: string;
}

/**
 * PlaybackPlan (freeze §2.5): the only playback artifact this package emits.
 * `kind` is always 'official-embed' — ADR-0003 forbids stream extraction.
 */
export interface PlaybackPlan {
  kind: 'official-embed';
  providerId: string;
  videoId: string;
  embedUrl: string;
  iframe: PlaybackPlanIframeSpec;
  playerVars: Record<string, string | number>;
  provenance: ProvenanceCitation[];
  notes: string[];
}
