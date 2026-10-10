/**
 * packages/playback/src/contract-types.ts
 *
 * Swap-at-integration mirror of the WebFlix-Desktop contract spec §2.2.
 * Every type here is structurally identical to its §2.2 counterpart so this
 * package can be replaced by the generated contract module at integration
 * time without touching call sites.
 *
 * OWNERSHIP RULE (§2.2):
 *   - PlaybackProgress is WebFlix-OWNED. It lives in WebFlix's local progress
 *     store and is never a provider history record. The `owner` marker is
 *     part of the type on purpose.
 *   - Writing progress into a provider's history/watchlist is an EXPLICIT,
 *     user-initiated operation expressed as a ProviderHistoryWriteOp.
 *     Nothing in this package emits such an op implicitly.
 */

/** Value baked into every WebFlix-owned progress record. */
export const PROGRESS_OWNER = 'webflix-local' as const;
export type ProgressOwner = typeof PROGRESS_OWNER;

/**
 * Why a title could not be resolved into a playable plan.
 * These are contract-stable strings — UI copy lives in RecoveryHint.message.
 */
export type UnavailableReason =
  /** No network; the streaming lanes are unreachable. */
  | 'offline'
  /** A listing exists but no connector is installed for its provider. */
  | 'connector-missing'
  /** The connector is installed but needs an authenticated session. */
  | 'connector-unauthorized'
  /** The listing or connector does not serve the viewer's region. */
  | 'region-unavailable'
  /** The listing is DRM-protected and cannot be played via embed. */
  | 'drm-unsupported'
  /** The connector exists but exposes no official embed capability. */
  | 'embed-unsupported'
  /** No officially supported provider carries the title at all. */
  | 'no-official-provider';

/** Structured, actionable hint the UI can render for an unavailable plan. */
export type RecoveryAction =
  | 'check-connection'
  | 'install-connector'
  | 'sign-in'
  | 'open-in-provider'
  | 'search-local-library'
  | 'none';

export interface RecoveryHint {
  action: RecoveryAction;
  /** Human-readable explanation; UI copy lives here, not in reason codes. */
  message: string;
  /** Provider involved, when the hint is provider-scoped. */
  providerId?: string;
  /** Connector involved, when the hint is connector-scoped. */
  connectorId?: string;
  /** Deep link (e.g. the provider's watch page) for 'open-in-provider'. */
  url?: string;
}

/** Play via the provider's official embed surface, driven by a connector embed spec. */
export interface OfficialEmbedPlan {
  kind: 'official-embed';
  contentId: string;
  title: string;
  providerId: string;
  connectorId: string;
  /** Provider-side media id that was interpolated into the embed spec. */
  externalId: string;
  /** Fully resolved embed URL (all template placeholders substituted). */
  embedUrl: string;
}

/** Play a file from the local library; the path is delegated to the local-file lane. */
export interface LocalFilePlan {
  kind: 'local-file';
  contentId: string;
  title: string;
  /** Delegated path — handed to the local-file lane verbatim. */
  filePath: string;
  mimeType?: string;
  sizeBytes?: number;
}

/** Nothing officially supported can play this title right now. */
export interface UnavailablePlan {
  kind: 'unavailable';
  contentId: string;
  title: string;
  reason: UnavailableReason;
  recovery: RecoveryHint;
}

/**
 * §2.2 PlaybackPlan union: every title resolves to exactly one of
 * official-embed | local-file | unavailable.
 */
export type PlaybackPlan = OfficialEmbedPlan | LocalFilePlan | UnavailablePlan;

/**
 * WebFlix-owned playback progress. Deliberately distinct from any provider
 * history shape: `owner` is always 'webflix-local', and contentId is WebFlix's
 * content identity (not a provider id).
 */
export interface PlaybackProgress {
  owner: ProgressOwner;
  contentId: string;
  /** The plan kind that produced this progress. */
  planKind: PlaybackPlan['kind'];
  positionMs: number;
  durationMs: number | null;
  /** ISO-8601 timestamp of the last local update. */
  updatedAt: string;
}

/**
 * EXPLICIT provider write op. WebFlix never pushes progress to a provider
 * implicitly — the app layer must construct and dispatch this deliberately.
 * Resolution and local progress tracking in this package never emit it.
 */
export interface ProviderHistoryWriteOp {
  op: 'provider-history-write';
  providerId: string;
  externalId: string;
  progress: PlaybackProgress;
}
