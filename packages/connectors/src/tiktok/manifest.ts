/**
 * TikTok ConnectorManifest — the second platform on the exact frozen §2.3
 * contract YouTube uses (TIKTOK-CONNECT, Phase 3 opener; binding
 * platform-selection: TikTok #1).
 *
 * Seeded from docs/plans/audits/AUDIT-SOURCES.md §5 (TikTok #1 platform row:
 * Display API, oEmbed, Login Kit OAuth 2.0 + PKCE) and
 * docs/architecture/provider-policy-matrix.md TikTok rows. ADR-0003 applies
 * in full: OFFICIAL SURFACES ONLY — no scraping, no private endpoints, no
 * cookie replay, no undocumented API guessing.
 *
 * Official surfaces this connector is allowed to touch (nothing else):
 *   - Display API  https://open.tiktokapis.com/v2  (user.info, video.list)
 *   - oEmbed       https://www.tiktok.com/oembed    (public, no auth)
 *   - Embed player https://www.tiktok.com/embed/v2/<id> (+ documented
 *                  blockquote + embed.js mechanism on the same origin)
 *   - Login Kit    https://www.tiktok.com/v2/auth/authorize/ +
 *                  https://open.tiktokapis.com/v2/oauth/token/ (PKCE —
 *                  code_verifier is required for desktop apps per the
 *                  official token endpoint doc)
 *
 * RATE-LIMIT HONESTY (work order): the ~600 req/min Display API figure is a
 * THIRD-PARTY REPORT, not an official number — no official doc or response
 * envelope states a Display API rate limit. The frozen quotas envelope
 * therefore carries the integrated-against approximation
 * (TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE = 600 per 60s window) and the
 * runtime ledger NEVER pre-flight blocks on it: the provider's own 429 /
 * rate_limit_exceeded envelopes are the only authoritative rate signals this
 * connector acts on (degrade honestly until the provider states numbers).
 *
 * REGIONAL HONESTY (live-verified in this work order): TikTok's web surfaces
 * (www.tiktok.com oEmbed + embed host) answer with a 302 redirect to a
 * regional about page (observed: https://www.tiktok.com/hk/about from a Hong
 * Kong egress IP, 2026-10-11) instead of the API payload. The frozen manifest
 * `regions` field can only carry a POSITIVE served-region claim, so it stays
 * honestly empty; the live-observed exclusion is connector-local data
 * (TIKTOK_OBSERVED_UNAVAILABLE_REGIONS) + a runtime typed error, and the
 * structural gap is filed as TT-FD1 for TL2.
 *
 * Operation ids are dot-namespaced per the frozen OperationIdSchema
 * (^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$), following the official API method
 * names (user.info, video.list) and clear operation nouns for the
 * honest-unsupported rows.
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

export const TIKTOK_PROVIDER_ID = "tiktok";
export const TIKTOK_DISPLAY_NAME = "TikTok";
export const TIKTOK_MANIFEST_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Official surface constants (the ONLY TikTok hosts this connector touches)
// ---------------------------------------------------------------------------

/** Display API base (open.tiktokapis.com — NOT geo-redirected; live-checked). */
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

/** Public oEmbed endpoint (www.tiktok.com — no auth; live-geo-sensitive). */
export const TIKTOK_OEMBED_ENDPOINT = "https://www.tiktok.com/oembed";

/** Official embed player URL prefix (iframe src the oEmbed html resolves to). */
export const TIKTOK_EMBED_URL_PREFIX = "https://www.tiktok.com/embed/v2/";

/** Official embed script (the documented blockquote mechanism's loader). */
export const TIKTOK_EMBED_SCRIPT_URL = "https://www.tiktok.com/embed.js";

/** Login Kit authorization endpoint (system-browser consent screen). */
export const TIKTOK_AUTHORIZATION_ENDPOINT = "https://www.tiktok.com/v2/auth/authorize/";

/** Login Kit token endpoint (exchange + refresh; form-encoded POST). */
export const TIKTOK_TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";

export const TIKTOK_OFFICIAL_SURFACES: readonly string[] = [
  TIKTOK_API_BASE,
  TIKTOK_OEMBED_ENDPOINT,
  TIKTOK_EMBED_URL_PREFIX,
  TIKTOK_EMBED_SCRIPT_URL,
  TIKTOK_AUTHORIZATION_ENDPOINT,
  TIKTOK_TOKEN_ENDPOINT,
];

/**
 * Login Kit scopes this connector requests — READ-ONLY style only.
 * user.info.basic (open_id, union_id, avatar_url, display_name),
 * user.info.profile (profile-deep-link/verified/bio fields),
 * video.list (the user's own public video list). The Content Posting API
 * publish scope is a work-order non-goal and is never requested.
 */
export const TIKTOK_OAUTH_SCOPES: readonly string[] = [
  "user.info.basic",
  "user.info.profile",
  "video.list",
];

// ---------------------------------------------------------------------------
// Rate-limit model (UNVERIFIED third-party figure — honest modeling)
// ---------------------------------------------------------------------------

/**
 * THIRD-PARTY-REPORTED Display API rate limit (~600 req/min). UNVERIFIED: no
 * official TikTok doc or observed response envelope states a Display API
 * rate number. Used ONLY as the manifest's request-envelope approximation and
 * an observability reference in the ledger snapshot — NEVER as a pre-flight
 * block reason (inventing a hard ceiling from an unverified figure would be
 * dishonest). Authoritative runtime signals: HTTP 429 and the provider's
 * rate_limit_exceeded error envelope.
 */
export const TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE = 600;
/** The window the reported figure is expressed against (one minute). */
export const TIKTOK_RATE_WINDOW_MS = 60_000;
export const TIKTOK_RATE_LIMIT_BASIS =
  "third-party reports (~600 req/min) — UNVERIFIED; no official number is published; provider envelopes (429 / rate_limit_exceeded) are authoritative";

/**
 * Regions where TikTok's web surfaces were observed UNAVAILABLE, with the
 * observation that produced the entry. Live-observed in TIKTOK-CONNECT:
 * HK — www.tiktok.com/oembed and /embed/v2/<id> both answer 302 →
 * https://www.tiktok.com/hk/about from Hong Kong egress (2026-10-11). This
 * list is OBSERVATIONAL, not exhaustive: unknown regions are probed at
 * runtime and reported honestly via typed regional errors, never guessed.
 * Connector-local data — the frozen manifest cannot express exclusions (TT-FD1).
 */
export interface RegionalUnavailabilityNote {
  region: string;
  observedAt: string;
  observation: string;
}

export const TIKTOK_OBSERVED_UNAVAILABLE_REGIONS: readonly RegionalUnavailabilityNote[] = [
  {
    region: "HK",
    observedAt: "2026-10-11T04:30:00Z",
    observation:
      "www.tiktok.com/oembed and www.tiktok.com/embed/v2/<id> both respond 302 → https://www.tiktok.com/hk/about (regional about page, not the API payload) from a Hong Kong egress IP; same result with a browser User-Agent. open.tiktokapis.com (Display API) is NOT geo-redirected from the same egress.",
  },
];

// ---------------------------------------------------------------------------
// Provenance citations (official sources; every verified URL was probed 200
// from the work-order sandbox, 2026-10-11 — see the parity matrix live-smoke)
// ---------------------------------------------------------------------------

export interface TikTokProvenanceNote {
  label: string;
  url: string;
}

const AUDIT_SOURCES_CITATION: TikTokProvenanceNote = {
  label:
    "docs/plans/audits/AUDIT-SOURCES.md §5 — platform selection evidence (TikTok #1) and official-surface inventory",
  url: "docs/plans/audits/AUDIT-SOURCES.md",
};
const DOC_DISPLAY_OVERVIEW: TikTokProvenanceNote = {
  label: "TikTok Display API overview (official)",
  url: "https://developers.tiktok.com/doc/display-api-overview/",
};
const DOC_USER_INFO: TikTokProvenanceNote = {
  label: "Display API user.info — official reference",
  url: "https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info",
};
const DOC_VIDEO_LIST: TikTokProvenanceNote = {
  label: "Display API video.list — official reference",
  url: "https://developers.tiktok.com/doc/tiktok-api-v2-video-list",
};
const DOC_EMBED_VIDEOS: TikTokProvenanceNote = {
  label: "TikTok Embed Videos (official — blockquote + embed.js and oEmbed usage)",
  url: "https://developers.tiktok.com/doc/embed-videos",
};
const DOC_TOKEN_MANAGEMENT: TikTokProvenanceNote = {
  label: "Login Kit user access token management (official)",
  url: "https://developers.tiktok.com/doc/oauth-user-access-token-management",
};
const DOC_LOGIN_KIT_WEB: TikTokProvenanceNote = {
  label: "Login Kit web flow (official)",
  url: "https://developers.tiktok.com/doc/login-kit-web",
};
const DOC_LOGIN_KIT_OVERVIEW: TikTokProvenanceNote = {
  label: "Login Kit overview (official)",
  url: "https://developers.tiktok.com/doc/login-kit-overview",
};
const DOC_TIKTOK_DOCS_INDEX: TikTokProvenanceNote = {
  label:
    "TikTok for Developers documentation index (official; absence of a public surface is verifiable here)",
  url: "https://developers.tiktok.com/",
};
const DOC_COMMERCIAL_CONTENT: TikTokProvenanceNote = {
  label: "TikTok Commercial Content API — approved access required (official)",
  url: "https://developers.tiktok.com/doc/commercial-content-api-getting-started",
};

/** Per-operation provenance citations (audit trail; connector-local — MR-FD3 precedent). */
export const TIKTOK_OPERATION_PROVENANCE: Readonly<
  Record<string, readonly TikTokProvenanceNote[]>
> = {
  "oembed.resolve": [DOC_EMBED_VIDEOS, AUDIT_SOURCES_CITATION],
  "user.info": [DOC_USER_INFO, DOC_DISPLAY_OVERVIEW, AUDIT_SOURCES_CITATION],
  "video.list": [DOC_VIDEO_LIST, DOC_DISPLAY_OVERVIEW, AUDIT_SOURCES_CITATION],
  "search.query": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "feed.for-you": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "feed.following": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "comments.list": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "messages.list": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "live.browse": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "notifications.list": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "search.suggestions": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "trends.browse": [DOC_COMMERCIAL_CONTENT, DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "history.provider": [DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "profile.browse-public": [DOC_USER_INFO, DOC_TIKTOK_DOCS_INDEX, AUDIT_SOURCES_CITATION],
  "video.download": [DOC_EMBED_VIDEOS, AUDIT_SOURCES_CITATION],
};

// ---------------------------------------------------------------------------
// Per-operation capability rows (frozen §2.3: Record<OperationId,
// {status, detail?, checkedAt?}>)
// ---------------------------------------------------------------------------

function supported(mechanism: string): OperationCapability {
  return { status: "supported", detail: mechanism };
}

function requiresAuth(mechanism: string): OperationCapability {
  return { status: "requires-auth", detail: mechanism };
}

function unsupported(reason: string): OperationCapability {
  return { status: "unsupported", detail: reason };
}

export const TIKTOK_OPERATIONS: Readonly<Record<string, OperationCapability>> = {
  // ---- supported (public, no auth) -----------------------------------------

  "oembed.resolve": supported(
    `Resolve a canonical TikTok video URL (https://www.tiktok.com/@<user>/video/<id>) into title, author, thumbnail and the official embed markup via the public oEmbed endpoint (GET ${TIKTOK_OEMBED_ENDPOINT}?url=…). No credentials, no API key. This is WebFlix's TikTok discovery surface — TikTok has no public search API, so items arrive by pasting a link.`,
  ),

  // ---- requires-auth (Display API — per-user Login Kit token) --------------

  "user.info": requiresAuth(
    `The authorized account's own profile fields (open_id, union_id, display_name, avatar_url, …) via the Display API (GET ${TIKTOK_API_BASE}/user/info/?fields=…). Requires a per-user Login Kit token with the user.info.basic / user.info.profile scopes. There is NO public variant: unauthenticated calls return 401 access_token_invalid (live-captured 2026-10-11).`,
  ),
  "video.list": requiresAuth(
    `The authorized account's OWN video list (id, title, description, duration, cover image, embed link, create time; cursor-paged, max_count 20) via the Display API (POST ${TIKTOK_API_BASE}/video/list/?fields=…). Requires a per-user token with the video.list scope. This lists the account's own videos only — it is not a Following feed and not a For You feed.`,
  ),

  // ---- honest-unsupported (no official API for this scope) ------------------

  "search.query": unsupported(
    "TikTok has NO public search API: the developer platform exposes no search endpoint for media discovery, and the work order forbids undocumented endpoints. Honest state, never proxied or scraped. In WebFlix, add TikTok videos by pasting their canonical links (oembed.resolve); keyword search lives in the official app/site.",
  ),
  "feed.for-you": unsupported(
    "The For You feed is a first-party recommendation surface with no public API; it exists only in the official app/site. WebFlix never fabricates a recommendation feed from unofficial surfaces.",
  ),
  "feed.following": unsupported(
    "No official API returns the videos of accounts a user follows; video.list covers the authorized account's OWN videos only. WebFlix surfaces its own local library instead, never dressed up as a Following feed.",
  ),
  "comments.list": unsupported(
    "No public API reads TikTok video comments (comment counts appear in Display API statistics fields, not comment text). Comments live in the official app/site only.",
  ),
  "messages.list": unsupported(
    "Direct messages are a private first-party surface with no public API; WebFlix never touches DMs.",
  ),
  "live.browse": unsupported(
    "No public API lists TikTok LIVE streams or live channels for viewers. Live content lives in the official app/site only.",
  ),
  "notifications.list": unsupported(
    "No official endpoint exposes the TikTok notification inbox. WebFlix shows no notification surface rather than fabricate one.",
  ),
  "search.suggestions": unsupported(
    "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no TikTok suggestions.",
  ),
  "trends.browse": unsupported(
    "Trend/hashtag discovery has no public API; the Research API (US/EU approved researchers) and Commercial Content API (approved access) are gated Phase-5 surfaces recorded as pending rows in the parity matrix, not this connector.",
  ),
  "history.provider": unsupported(
    "No official API returns a user's TikTok watch history. WebFlix keeps its OWN watch history (WebFlix-owned PlaybackProgress) and never claims to read TikTok's.",
  ),
  "profile.browse-public": unsupported(
    "No public API browses arbitrary TikTok profiles; user.info returns the AUTHORIZED account's own profile only. Public profiles live in the official app/site.",
  ),
  "video.download": unsupported(
    "Downloading TikTok videos outside official surfaces is out of scope by policy (work order non-goal; ADR-0003). The official in-app download and its creator-controlled availability are the only sanctioned paths; WebFlix's local library is for user-owned/local content only.",
  ),
};

// ---------------------------------------------------------------------------
// Manifest (frozen §2.3 shape)
// ---------------------------------------------------------------------------

export const tiktokManifest: ConnectorManifest = {
  providerId: TIKTOK_PROVIDER_ID,
  operations: TIKTOK_OPERATIONS,
  // Honest empty list: no positive served-region claim is made. TikTok is
  // known to be regionally unavailable in some regions (live-observed: HK —
  // see TIKTOK_OBSERVED_UNAVAILABLE_REGIONS); exclusions have no frozen
  // manifest home (TT-FD1) and surface as runtime typed regional errors.
  regions: [],
  // Request-envelope approximation of an UNVERIFIED third-party rate report
  // (~600 req/min). NOT enforced pre-flight — the ledger records usage for
  // observability and the provider's 429/rate_limit_exceeded envelopes are
  // the only authoritative limits acted on (see TIKTOK_RATE_LIMIT_BASIS).
  quotas: {
    requestsPerWindow: TIKTOK_REPORTED_RATE_LIMIT_PER_MINUTE,
    windowMs: TIKTOK_RATE_WINDOW_MS,
  },
  provenance: {
    connectorId: TIKTOK_PROVIDER_ID,
    connectorVersion: TIKTOK_MANIFEST_VERSION,
    // Constant seed artifact: generated at connector introduction
    // (fixture-only build; live probing beyond the recorded work-order
    // checks is pending-operator-credential).
    generatedAt: "2026-10-11T00:00:00Z",
  },
  // Typed failure modes the clients know they can hit — "region" is first
  // class here (live-verified regional unavailability of www.tiktok.com
  // surfaces, 2026-10-11).
  failureModes: ["network", "timeout", "auth", "rate-limit", "region", "parse", "upstream"],
};

/** Citation set for the account path (parity matrix + review evidence). */
export const TIKTOK_ACCOUNT_PROVENANCE: readonly TikTokProvenanceNote[] = [
  DOC_TOKEN_MANAGEMENT,
  DOC_LOGIN_KIT_WEB,
  DOC_LOGIN_KIT_OVERVIEW,
  AUDIT_SOURCES_CITATION,
];
