/**
 * Streaming handoff-plan derivation — P7-STREAM-HANDOFF-1 (WF-012).
 *
 * THE ADDITIVE-COMPOSITION RULING (order objective 2, stated honestly):
 * the frozen §2.2 PlaybackPlan union ALREADY carries the
 * external-deep-link kind ({ kind: "external-deep-link", url }) — the
 * derivation below emits EXACTLY that frozen shape (schema-parse-proven by
 * test against ExternalDeepLinkPlanSchema and the full PlaybackPlanSchema
 * discriminated union), so the composition IS additive at the plan-kind
 * level: no new kind, no contract edit, no widened union.
 *
 * WHERE THE DERIVATION LIVES: in this connectors streaming-family module,
 * NOT in packages/playback/src/ — the order's alternative branch ("otherwise
 * the handoff mapping stays in the connectors manifest layer and the report
 * says so honestly"). The honest reasons, both stated:
 *   1. Path grant: this order's ledger Allowed-paths column is
 *      `packages/connectors/src/streaming/ (NEW, manifest-only) + tests` —
 *      packages/playback/src/resolve.ts is OUTSIDE the grant, and threading
 *      a deep-link lane through resolvePlaybackPlan plus a new
 *      `Connector.deepLink` field would be an edit to files this order does
 *      not own (the P7-PLAYER-1 precedent shows index/registry edits are
 *      sanctioned only when the ledger names them).
 *   2. Shape honesty: the resolver's Connector interface carries an
 *      `embed?: EmbedSpec` surface for providers that CAN embed; the
 *      streaming trio's whole point is that they cannot — the honest fit is
 *      a family-local derivation that outputs the frozen plan, consumed by
 *      the app/compositing layer when it chooses to hand off, not a
 *      resolver lane that would pretend these providers participate in
 *      embed resolution at all.
 *
 * ZERO NETWORK (hard): the derivation is a pure string fold — caller
 * supplies the provider-side media id, the family's declared official
 * template supplies the URL shape, nothing is fetched, nothing is guessed:
 * an id that does not match the provider's declared shape is REFUSED (the
 * Reddit InvalidRedditPostIdError precedent — never a guessed URL).
 *
 * HONEST ISOLATION: every derived handoff carries the frozen
 * STREAMING_HANDOFF_ISOLATION record (never inherits the app session, no
 * credentials, no cookies, opens in the external context) — asserted by
 * test; the frozen §2.2 plan shape itself carries no session fields, which
 * is exactly why the isolation contract rides the family-local descriptor.
 */
import type { ExternalDeepLinkPlan } from "webflix-contracts";
import {
  PARAMOUNT_PLUS_PROVIDER_ID,
  PRIME_VIDEO_PROVIDER_ID,
  NETFLIX_PROVIDER_ID,
  STREAMING_DEEP_LINK_MECHANISMS,
  STREAMING_HANDOFF_ISOLATION,
  type StreamingDeepLinkMechanism,
  type StreamingHandoffIsolation,
} from "./manifest";

/** The placeholder every official template folds the media id into. */
export const STREAMING_MEDIA_ID_PLACEHOLDER = "{mediaId}";

// ---------------------------------------------------------------------------
// Typed refusals (never a guessed URL)
// ---------------------------------------------------------------------------

export class UnknownStreamingProviderError extends Error {
  constructor(providerId: string) {
    super(
      `unknown streaming handoff provider: "${providerId}" (expected one of netflix, prime-video, paramount-plus); refusing to build a handoff plan`,
    );
    this.name = "UnknownStreamingProviderError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidStreamingMediaIdError extends Error {
  constructor(providerId: string, mediaId: string, expected: string) {
    super(
      `not a valid ${providerId} media id: "${mediaId}" (expected shape: ${expected}); refusing to build a handoff plan — the family never invents provider ids`,
    );
    this.name = "InvalidStreamingMediaIdError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// The handoff request / result
// ---------------------------------------------------------------------------

/** Which official Paramount+ surface a slug addresses (single default). */
export type ParamountPlusSurface = "show" | "movie";

export interface StreamingHandoffRequest {
  /** One of netflix | prime-video | paramount-plus. */
  providerId: string;
  /**
   * The caller-supplied provider-side media id (Netflix numeric title id,
   * Prime Video ASIN, Paramount+ slug) — never invented by this family.
   */
  mediaId: string;
  /**
   * Paramount+ only: the official surface the slug addresses (show vs
   * movie page). Ignored by the other providers (single canonical
   * template); defaults to "show".
   */
  surface?: ParamountPlusSurface;
}

/**
 * A derived external handoff: the frozen §2.2 external-deep-link plan PLUS
 * the family-local honesty context (mechanism + isolation) the frozen shape
 * deliberately does not carry.
 */
export interface StreamingHandoff {
  /** The frozen plan — composes additively with the existing kinds. */
  plan: ExternalDeepLinkPlan;
  providerId: string;
  /** The deep-link mechanism the plan was derived from. */
  mechanism: StreamingDeepLinkMechanism;
  /** The frozen honest isolation record (never inherits the app session). */
  isolation: StreamingHandoffIsolation;
}

// ---------------------------------------------------------------------------
// Template folding (pure)
// ---------------------------------------------------------------------------

/**
 * Folds a media id into an official template — the ONLY URL construction
 * this family performs. encodeURIComponent keeps the fold honest for any
 * id characters that are not already URL-safe.
 */
export function foldStreamingMediaId(template: string, mediaId: string): string {
  return template.replace(STREAMING_MEDIA_ID_PLACEHOLDER, encodeURIComponent(mediaId));
}

/** Resolves the surface-specific template for a provider (pure). */
function templateFor(
  mechanism: StreamingDeepLinkMechanism,
  surface: ParamountPlusSurface | undefined,
): string {
  if (mechanism.providerId === PARAMOUNT_PLUS_PROVIDER_ID) {
    if (surface === "movie") {
      const movie = mechanism.alternateTemplates["movie"];
      if (movie) return movie;
    }
    return mechanism.watchUrlTemplate;
  }
  return mechanism.watchUrlTemplate;
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/**
 * Builds the official external handoff for a streaming title — pure,
 * deterministic, ZERO network:
 *   - unknown provider        → UnknownStreamingProviderError
 *   - id that does not match  → InvalidStreamingMediaIdError (never guessed)
 *   - valid provider + id     → the frozen external-deep-link plan for the
 *     provider's official surface, carrying the honest isolation record.
 */
export function buildStreamingHandoff(request: StreamingHandoffRequest): StreamingHandoff {
  const mechanism = STREAMING_DEEP_LINK_MECHANISMS[request.providerId];
  if (!mechanism) {
    throw new UnknownStreamingProviderError(request.providerId);
  }

  const mediaId = request.mediaId;
  if (typeof mediaId !== "string" || !new RegExp(mechanism.mediaIdPattern).test(mediaId)) {
    throw new InvalidStreamingMediaIdError(
      mechanism.providerId,
      String(mediaId),
      mechanism.mediaIdPattern,
    );
  }

  const template = templateFor(mechanism, request.surface);
  const url = foldStreamingMediaId(template, mediaId);

  return {
    plan: {
      kind: "external-deep-link",
      url,
    },
    providerId: mechanism.providerId,
    mechanism,
    isolation: STREAMING_HANDOFF_ISOLATION,
  };
}

// ---------------------------------------------------------------------------
// Convenience folds for the three providers (deterministic, pure)
// ---------------------------------------------------------------------------

/** Netflix official title-page handoff (the canonical shareable deep link). */
export function netflixHandoff(titleId: string): StreamingHandoff {
  return buildStreamingHandoff({ providerId: NETFLIX_PROVIDER_ID, mediaId: titleId });
}

/** Prime Video official detail-page handoff (ASIN-addressed). */
export function primeVideoHandoff(asin: string): StreamingHandoff {
  return buildStreamingHandoff({ providerId: PRIME_VIDEO_PROVIDER_ID, mediaId: asin });
}

/** Paramount+ official show/movie-page handoff (slug-addressed). */
export function paramountPlusHandoff(
  slug: string,
  surface: ParamountPlusSurface = "show",
): StreamingHandoff {
  return buildStreamingHandoff({
    providerId: PARAMOUNT_PLUS_PROVIDER_ID,
    mediaId: slug,
    surface,
  });
}
