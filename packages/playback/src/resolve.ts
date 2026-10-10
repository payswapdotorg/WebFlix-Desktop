/**
 * packages/playback/src/resolve.ts
 *
 * Typed PlaybackPlan resolution for WebFlix-Desktop (D2-LOCAL lane).
 *
 * Resolution is pure and deterministic. Preference order:
 *
 *   1. official-embed — an installed connector exposes an official embed spec
 *      for one of the title's provider listings.
 *   2. local-file     — the local library has a matching file; the path is
 *      delegated to the local-file playback lane untouched. Works offline.
 *   3. unavailable    — everything not officially supported, carrying a
 *      structured UnavailableReason plus an actionable RecoveryHint.
 *
 * OWNERSHIP: this module NEVER writes to provider history. WebFlix-owned
 * PlaybackProgress is produced only by the explicit progress helpers below;
 * pushing progress to a provider is a deliberate ProviderHistoryWriteOp built
 * via toProviderHistoryWrite() by the app layer.
 */

import { PROGRESS_OWNER } from './contract-types.js';
import type {
  PlaybackPlan,
  PlaybackProgress,
  ProviderHistoryWriteOp,
  RecoveryHint,
  UnavailableReason,
} from './contract-types.js';

// ---------------------------------------------------------------------------
// Resolution inputs
// ---------------------------------------------------------------------------

/** Official embed capability exposed by a connector. */
export interface EmbedSpec {
  /** Provider the embed plays from (must match the listing's provider). */
  providerId: string;
  /** URL template; the '{mediaId}' placeholder is replaced with the external id. */
  urlTemplate: string;
  /** The provider/connector explicitly permits embedding. */
  allowsEmbedding: boolean;
}

/** An installed connector fronting one provider. */
export interface Connector {
  id: string;
  providerId: string;
  version: string;
  /** Official embed capability; absent → this connector cannot embed. */
  embed?: EmbedSpec;
  /** True while the connector still needs an authenticated session. */
  requiresSignIn?: boolean;
  /** Regions the connector serves; undefined/empty → all regions. */
  regions?: string[];
}

/** A provider listing that officially carries the title. */
export interface ProviderListing {
  providerId: string;
  /** Provider-side media id. */
  externalId: string;
  /** Regions where the title is carried; undefined/empty → all regions. */
  regions?: string[];
  drmProtected?: boolean;
}

/** A file from the local library scan. */
export interface LocalLibraryFile {
  path: string;
  title?: string;
  /** Exact WebFlix content id match wins over title matching. */
  contentId?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface ResolveRequest {
  contentId: string;
  title: string;
  /** Officially supported listings, in preference order. */
  listings: ProviderListing[];
  /** Installed connectors. */
  connectors: Connector[];
  /** Local library scan results. */
  localLibrary: LocalLibraryFile[];
  /** Viewer's region subtag (e.g. 'US'). Case-insensitive. */
  region?: string;
  /** Network reachability; defaults to true. Local files stay playable offline. */
  online?: boolean;
}

// ---------------------------------------------------------------------------
// Plan resolution
// ---------------------------------------------------------------------------

interface EmbedFailure {
  reason: UnavailableReason;
  recovery: RecoveryHint;
}

/** Substitutes the provider's external id into an embed spec's URL template. */
export function resolveEmbedUrl(spec: EmbedSpec, externalId: string): string {
  return spec.urlTemplate.replace('{mediaId}', encodeURIComponent(externalId));
}

function regionAllowed(regions: string[] | undefined, region: string | undefined): boolean {
  if (!regions || regions.length === 0) return true;
  if (region === undefined || region === '') return false;
  const wanted = region.toUpperCase();
  return regions.some((r) => r.toUpperCase() === wanted);
}

function connectorFor(connectors: Connector[], providerId: string): Connector | undefined {
  return connectors.find((c) => c.providerId === providerId);
}

/**
 * Resolves a title into exactly one PlaybackPlan:
 * official-embed → local-file → unavailable{reason, recovery}.
 * Pure and deterministic: identical requests always yield identical plans.
 */
export function resolvePlaybackPlan(request: ResolveRequest): PlaybackPlan {
  const online = request.online !== false;
  let firstFailure: EmbedFailure | undefined;

  // Lane 1: official embed via a connector embed spec. The first playable
  // listing wins; otherwise the first structured failure is remembered as the
  // unavailable fallback (checked per listing in this order: connector
  // missing → offline → sign-in → region → DRM → embed capability).
  for (const listing of request.listings) {
    const connector = connectorFor(request.connectors, listing.providerId);

    if (!connector) {
      firstFailure ??= {
        reason: 'connector-missing',
        recovery: {
          action: 'install-connector',
          message: `No connector is installed for "${listing.providerId}". Install it to stream this title.`,
          providerId: listing.providerId,
        },
      };
      continue;
    }

    if (!online) {
      firstFailure ??= {
        reason: 'offline',
        recovery: {
          action: 'check-connection',
          message:
            'Streaming requires a network connection. Local files remain playable while offline.',
          providerId: listing.providerId,
          connectorId: connector.id,
        },
      };
      continue;
    }

    if (connector.requiresSignIn === true) {
      firstFailure ??= {
        reason: 'connector-unauthorized',
        recovery: {
          action: 'sign-in',
          message: `Sign in to "${listing.providerId}" through its connector to stream this title.`,
          providerId: listing.providerId,
          connectorId: connector.id,
        },
      };
      continue;
    }

    if (
      !regionAllowed(listing.regions, request.region) ||
      !regionAllowed(connector.regions, request.region)
    ) {
      firstFailure ??= {
        reason: 'region-unavailable',
        recovery: {
          action: 'open-in-provider',
          message: `"${request.title}" is not available in your region on "${listing.providerId}".`,
          providerId: listing.providerId,
        },
      };
      continue;
    }

    if (listing.drmProtected === true) {
      firstFailure ??= {
        reason: 'drm-unsupported',
        recovery: {
          action: 'open-in-provider',
          message: `"${request.title}" is DRM-protected and cannot be embedded. Watch it on "${listing.providerId}".`,
          providerId: listing.providerId,
        },
      };
      continue;
    }

    const spec = connector.embed;
    if (!spec || !spec.allowsEmbedding || spec.providerId !== listing.providerId) {
      firstFailure ??= {
        reason: 'embed-unsupported',
        recovery: {
          action: 'open-in-provider',
          message: `"${listing.providerId}" does not allow official embedding for this title. Watch it on the provider.`,
          providerId: listing.providerId,
          connectorId: connector.id,
        },
      };
      continue;
    }

    return {
      kind: 'official-embed',
      contentId: request.contentId,
      title: request.title,
      providerId: listing.providerId,
      connectorId: connector.id,
      externalId: listing.externalId,
      embedUrl: resolveEmbedUrl(spec, listing.externalId),
    };
  }

  // Lane 2: local file — delegated path, playable even while offline.
  const local = matchLocalFile(request);
  if (local) {
    return {
      kind: 'local-file',
      contentId: request.contentId,
      title: request.title,
      filePath: local.path,
      mimeType: local.mimeType,
      sizeBytes: local.sizeBytes,
    };
  }

  // Lane 3: unavailable — remembered failure, or no official support at all.
  if (firstFailure) {
    return {
      kind: 'unavailable',
      contentId: request.contentId,
      title: request.title,
      reason: firstFailure.reason,
      recovery: firstFailure.recovery,
    };
  }

  return {
    kind: 'unavailable',
    contentId: request.contentId,
    title: request.title,
    reason: 'no-official-provider',
    recovery: {
      action: 'search-local-library',
      message: `"${request.title}" is not carried by any officially supported provider. Search your local library or add the file manually.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Local-library matching
// ---------------------------------------------------------------------------

/**
 * Normalizes a title for local-library matching: case-insensitive, with all
 * non-alphanumeric characters collapsed away.
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function baseName(filePath: string): string {
  const sep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const name = sep >= 0 ? filePath.slice(sep + 1) : filePath;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Finds the local file backing a request. Two passes on purpose: an exact
 * contentId match always wins, regardless of its position in the library,
 * then a normalized-title match against the file's title or its basename.
 */
export function matchLocalFile(request: ResolveRequest): LocalLibraryFile | undefined {
  const wanted = normalizeTitle(request.title);

  const byId = request.localLibrary.find(
    (file) => file.contentId !== undefined && file.contentId === request.contentId,
  );
  if (byId) return byId;

  if (wanted.length === 0) return undefined;
  return request.localLibrary.find((file) => {
    const label = file.title ?? baseName(file.path);
    return normalizeTitle(label) === wanted;
  });
}

/** True when a plan can actually start playback (embed or local file). */
export function isPlayablePlan(plan: PlaybackPlan): boolean {
  return plan.kind === 'official-embed' || plan.kind === 'local-file';
}

// ---------------------------------------------------------------------------
// WebFlix-owned playback progress
// ---------------------------------------------------------------------------

/** At/above this fraction of a known duration, progress counts as completed. */
export const COMPLETION_THRESHOLD = 0.95;

export interface CreateProgressInput {
  contentId: string;
  planKind: PlaybackPlan['kind'];
  positionMs?: number;
  durationMs?: number | null;
}

export interface ProgressUpdate {
  /** Relative delta applied to the current position. */
  deltaMs?: number;
  /** Absolute position; wins over deltaMs when both are provided. */
  positionMs?: number;
  durationMs?: number | null;
  /** ISO-8601 timestamp override (deterministic tests / event replay). */
  at?: string;
}

function clampMs(ms: number, maxMs?: number): number {
  const value = Number.isFinite(ms) ? ms : 0;
  const floored = Math.max(0, value);
  if (maxMs !== undefined && Number.isFinite(maxMs) && maxMs >= 0) {
    return Math.min(floored, maxMs);
  }
  return floored;
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Creates a WebFlix-owned progress record. The constant `owner: 'webflix-local'`
 * marker distinguishes it from any provider history entry at the type and
 * value level.
 */
export function createProgress(
  input: CreateProgressInput,
  at: string = isoNow(),
): PlaybackProgress {
  return {
    owner: PROGRESS_OWNER,
    contentId: input.contentId,
    planKind: input.planKind,
    positionMs: clampMs(input.positionMs ?? 0),
    durationMs: input.durationMs ?? null,
    updatedAt: at,
  };
}

/**
 * Applies an update and returns a NEW record; the input record is never
 * mutated. Positions clamp to [0, durationMs] when a duration is known.
 */
export function updateProgress(
  progress: PlaybackProgress,
  update: ProgressUpdate,
): PlaybackProgress {
  const next = update.positionMs ?? progress.positionMs + (update.deltaMs ?? 0);
  const durationMs = update.durationMs !== undefined ? update.durationMs : progress.durationMs;
  return {
    ...progress,
    positionMs: clampMs(next, durationMs ?? undefined),
    durationMs,
    updatedAt: update.at ?? isoNow(),
  };
}

/** 0–100 with one decimal, or null when the duration is unknown. */
export function progressPercent(progress: PlaybackProgress): number | null {
  if (progress.durationMs === null || progress.durationMs <= 0) return null;
  const pct = (progress.positionMs / progress.durationMs) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

/** True once the position reaches COMPLETION_THRESHOLD of a known duration. */
export function isCompleted(progress: PlaybackProgress): boolean {
  if (progress.durationMs === null || progress.durationMs <= 0) return false;
  return progress.positionMs / progress.durationMs >= COMPLETION_THRESHOLD;
}

/**
 * Builds the EXPLICIT op for pushing WebFlix-owned progress into a provider's
 * history. NOTHING in this package (resolution, progress tracking) calls this;
 * the app layer must invoke it deliberately.
 */
export function toProviderHistoryWrite(
  progress: PlaybackProgress,
  provider: { providerId: string; externalId: string },
): ProviderHistoryWriteOp {
  return {
    op: 'provider-history-write',
    providerId: provider.providerId,
    externalId: provider.externalId,
    progress,
  };
}
