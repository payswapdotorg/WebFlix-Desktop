/**
 * Twitch ConnectorManifest — the third platform on the exact frozen §2.3
 * contract YouTube and TikTok use (TWITCH-CONNECT, Phase 3 platform #2;
 * binding platform-selection: Twitch #2 — "best-documented free media API").
 *
 * Seeded from docs/plans/audits/AUDIT-SOURCES.md §5 (Twitch #2 platform row:
 * Helix API — videos/VODs, clips, streams, users; official embed player; OAuth
 * per-user; token-bucket rate limits, point-based, no cost) and the Twitch
 * intent rows in docs/plans/phase3-platform-selection.md. ADR-0003 applies in
 * full: OFFICIAL SURFACES ONLY — no scraping, no private endpoints, no cookie
 * replay, no undocumented API guessing.
 *
 * Official surfaces this connector is allowed to touch (nothing else):
 *   - Helix API   https://api.twitch.tv/helix  (streams, videos, clips,
 *                 users, games/top, channels/followed)
 *   - OAuth       https://id.twitch.tv/oauth2  (authorize + token + revoke)
 *   - Embed player https://player.twitch.tv    (channel / video / clip with
 *                 the REQUIRED parent parameter — see ./playback)
 *
 * RATE HONESTY (work order): the rate ledger is built from the AUTHORITATIVE
 * provider response headers (Ratelimit-Limit / Ratelimit-Remaining /
 * Ratelimit-Reset — a point-based token bucket per client ID, one bucket for
 * app-access requests and one per client ID per user for user-access
 * requests; the bucket window is 1 minute per the official API guide). NO
 * number is invented: the frozen quotas envelope carries the guide's own
 * documented example (Ratelimit-Limit: 800) with the basis label below, and
 * the runtime ledger NEVER pre-flight blocks — the provider's own HTTP 429
 * (with Ratelimit-Reset) is the only authoritative enforcement acted on.
 *
 * PARENT-PARAMETER HONESTY (live-verified 2026-10-11, this work order):
 * player.twitch.tv REQUIRES the parent query parameter (the hostname of the
 * embedding page's origin) — without it the player answers
 *   302 → /embed-error.html?errorCode=NoParent
 * and with it the response carries a matching
 *   Content-Security-Policy: frame-ancestors <https://parent>
 * (parent=localhost → `frame-ancestors http://localhost:* https://localhost:*`).
 * The playback builder therefore takes parent as an EXPLICIT required input —
 * dev time uses the documented localhost origin; the production-origin
 * decision is recorded as an integration note (parity matrix §parent), never
 * guessed silently.
 *
 * Operation ids are dot-namespaced per the frozen OperationIdSchema
 * (^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$), following the official Helix method
 * semantics (streams/videos/clips/users/games) and clear operation nouns for
 * the honest-unsupported rows.
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

export const TWITCH_PROVIDER_ID = "twitch";
export const TWITCH_DISPLAY_NAME = "Twitch";
export const TWITCH_MANIFEST_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Official surface constants (the ONLY Twitch hosts this connector touches)
// ---------------------------------------------------------------------------

/** Helix API base (api.twitch.tv — CloudFront-served; live-reachable from HK egress). */
export const TWITCH_API_BASE = "https://api.twitch.tv/helix";

/** OAuth service base (authorize, token, revoke — the official auth surface). */
export const TWITCH_OAUTH_BASE = "https://id.twitch.tv/oauth2";

/** Official embed player (channel / video / clip + REQUIRED parent parameter). */
export const TWITCH_PLAYER_URL = "https://player.twitch.tv";

export const TWITCH_OFFICIAL_SURFACES: readonly string[] = [
  TWITCH_API_BASE,
  TWITCH_OAUTH_BASE,
  TWITCH_PLAYER_URL,
];

/**
 * Per-user OAuth scopes this connector requests — READ-ONLY style only:
 * user:read:follows (Get Followed Channels). Write/editor/broadcaster scopes
 * (clips:edit, channel:*, moderation:*) are work-order non-goals and are
 * never requested.
 */
export const TWITCH_OAUTH_SCOPES: readonly string[] = ["user:read:follows"];

// ---------------------------------------------------------------------------
// Rate-limit model (point-based token bucket; AUTHORITATIVE response headers)
// ---------------------------------------------------------------------------

/**
 * The bucket window the official API guide states ("If your bucket runs out
 * of points within 1 minute, the request returns status code 429").
 */
export const TWITCH_RATE_WINDOW_MS = 60_000;

/**
 * The API guide's own documented example bucket size (Ratelimit-Limit: 800).
 * The ACTUAL bucket size is per client ID (and per client ID per user for
 * user-access buckets) — it is learned authoritatively from the
 * Ratelimit-Limit response header, never assumed or enforced client-side.
 */
export const TWITCH_DOCUMENTED_EXAMPLE_BUCKET = 800;

export const TWITCH_RATE_LIMIT_BASIS =
  "point-based token bucket per the official Helix API guide: separate app-access and user-access buckets, default 1 point per endpoint request, 1-minute window; the authoritative numbers arrive in the Ratelimit-Limit / Ratelimit-Remaining / Ratelimit-Reset response headers on every call — the envelope figure is the guide's documented example (Ratelimit-Limit: 800), not a verified per-app value, and is never enforced pre-flight (HTTP 429 + Ratelimit-Reset is the provider's own enforcement)";

// ---------------------------------------------------------------------------
// Provenance citations (official sources; every verified URL was probed 200
// from the work-order sandbox, 2026-10-11 — see the parity matrix live-smoke)
// ---------------------------------------------------------------------------

export interface TwitchProvenanceNote {
  label: string;
  url: string;
}

const AUDIT_SOURCES_CITATION: TwitchProvenanceNote = {
  label:
    "docs/plans/audits/AUDIT-SOURCES.md §5 — platform selection evidence (Twitch #2) and official-surface inventory",
  url: "docs/plans/audits/AUDIT-SOURCES.md",
};
const DOC_API_REFERENCE: TwitchProvenanceNote = {
  label:
    "Helix API reference — every endpoint incl. Get Streams / Get Videos / Get Clips / Get Users / Get Top Games / Get Followed Channels (official)",
  url: "https://dev.twitch.tv/docs/api/reference/",
};
const DOC_API_GUIDE: TwitchProvenanceNote = {
  label: "Helix API guide — rate limits: point-based token bucket + Ratelimit-* headers (official)",
  url: "https://dev.twitch.tv/docs/api/guide/",
};
const DOC_API_GET_STARTED: TwitchProvenanceNote = {
  label: "Getting started with the API — Client-Id + Bearer headers (official)",
  url: "https://dev.twitch.tv/docs/api/get-started/",
};
const DOC_AUTH_OAUTH_FLOWS: TwitchProvenanceNote = {
  label:
    "Getting OAuth access tokens — authorization code grant (incl. PKCE) + client credentials grant for app access tokens (official)",
  url: "https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/",
};
const DOC_AUTH_REGISTER_APP: TwitchProvenanceNote = {
  label: "Registering an app — client_id provisioning (official; operator item)",
  url: "https://dev.twitch.tv/docs/authentication/register-app/",
};
const DOC_AUTH_SCOPES: TwitchProvenanceNote = {
  label: "Twitch OAuth scope reference (official)",
  url: "https://dev.twitch.tv/docs/authentication/scopes/",
};
const DOC_AUTH_REFRESH: TwitchProvenanceNote = {
  label: "Refreshing access tokens (official)",
  url: "https://dev.twitch.tv/docs/authentication/refresh-tokens/",
};
const DOC_AUTH_REVOKE: TwitchProvenanceNote = {
  label:
    "Revoking access tokens — POST id.twitch.tv/oauth2/revoke (official; unlike TikTok Login Kit, Twitch HAS a revocation endpoint)",
  url: "https://dev.twitch.tv/docs/authentication/revoke-tokens/",
};
const DOC_EMBED_VIDEO_AND_CLIPS: TwitchProvenanceNote = {
  label:
    "Embedding Video and Clips — player.twitch.tv iframe with the required parent parameter (official)",
  url: "https://dev.twitch.tv/docs/embed/video-and-clips/",
};
const DOC_EMBED_EVERYTHING: TwitchProvenanceNote = {
  label: "Embedding Everything — embed overview (official)",
  url: "https://dev.twitch.tv/docs/embed/everything/",
};
const DOC_EVENTSUB: TwitchProvenanceNote = {
  label: "EventSub — server-side push webhooks (official; later-phase surface)",
  url: "https://dev.twitch.tv/docs/eventsub/",
};
const DOC_IRC: TwitchProvenanceNote = {
  label: "Twitch Chat IRC guide (official; separate protocol surface, out of scope this order)",
  url: "https://dev.twitch.tv/docs/irc/",
};

/** Per-operation provenance citations (audit trail; connector-local — MR-FD3 precedent). */
export const TWITCH_OPERATION_PROVENANCE: Readonly<
  Record<string, readonly TwitchProvenanceNote[]>
> = {
  "streams.live": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_API_GET_STARTED, AUDIT_SOURCES_CITATION],
  "videos.list": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_API_GET_STARTED, AUDIT_SOURCES_CITATION],
  "clips.list": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_API_GET_STARTED, AUDIT_SOURCES_CITATION],
  "users.read": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_API_GET_STARTED, AUDIT_SOURCES_CITATION],
  "games.top": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_API_GET_STARTED, AUDIT_SOURCES_CITATION],
  "channels.followed": [DOC_API_REFERENCE, DOC_API_GUIDE, DOC_AUTH_SCOPES, AUDIT_SOURCES_CITATION],
  "playback.embed": [DOC_EMBED_VIDEO_AND_CLIPS, DOC_EMBED_EVERYTHING, AUDIT_SOURCES_CITATION],
  "oauth.connect": [DOC_AUTH_OAUTH_FLOWS, DOC_AUTH_REGISTER_APP, AUDIT_SOURCES_CITATION],
  "oauth.disconnect": [DOC_AUTH_REVOKE, DOC_AUTH_OAUTH_FLOWS, AUDIT_SOURCES_CITATION],
  "oauth.app-access": [
    DOC_AUTH_OAUTH_FLOWS,
    DOC_API_GET_STARTED,
    DOC_AUTH_REGISTER_APP,
    AUDIT_SOURCES_CITATION,
  ],
  "chat.read": [DOC_IRC, DOC_EVENTSUB, AUDIT_SOURCES_CITATION],
  "eventsub.subscribe": [DOC_EVENTSUB, AUDIT_SOURCES_CITATION],
  "moderation.manage": [DOC_API_REFERENCE, DOC_AUTH_SCOPES, AUDIT_SOURCES_CITATION],
  "stream-key.read": [DOC_AUTH_SCOPES, DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "content-classification.list": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "bits.value": [DOC_API_REFERENCE, DOC_AUTH_SCOPES, AUDIT_SOURCES_CITATION],
  "subscriptions.value": [DOC_API_REFERENCE, DOC_AUTH_SCOPES, AUDIT_SOURCES_CITATION],
  "history.provider": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "recommendations.browse": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "notifications.list": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "whispers.list": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "search.suggestions": [DOC_API_REFERENCE, AUDIT_SOURCES_CITATION],
  "video.download": [DOC_EMBED_VIDEO_AND_CLIPS, AUDIT_SOURCES_CITATION],
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

export const TWITCH_OPERATIONS: Readonly<Record<string, OperationCapability>> = {
  // ---- supported (public reads — App Access token via client credentials) --

  "streams.live": supported(
    `Browse live streams by game/category, channel or language (viewer_count, title, game, thumbnail template; cursor-paged, first ≤ 100) via Helix GET ${TWITCH_API_BASE}/streams. Public read: App Access token (client credentials) or a user token.`,
  ),
  "videos.list": supported(
    `Browse VODs (past broadcasts, highlights, uploads) by video id, channel user_id or game_id, with period/type/sort filters (duration, created_at, thumbnail; cursor-paged) via Helix GET ${TWITCH_API_BASE}/videos. Public read.`,
  ),
  "clips.list": supported(
    `Browse clips by clip id, broadcaster_id or game_id (title, duration, embed URL, thumbnail; cursor-paged, first ≤ 100) via Helix GET ${TWITCH_API_BASE}/clips. Public read.`,
  ),
  "users.read": supported(
    `Read user/channel records by id or login (display name, broadcaster type, description, profile image, created_at) via Helix GET ${TWITCH_API_BASE}/users. Public read; with a user token and no parameters, the endpoint returns the authorized account itself.`,
  ),
  "games.top": supported(
    `Browse the top games/categories by current viewership (id, name, box-art URL template; cursor-paged) via Helix GET ${TWITCH_API_BASE}/games/top. Public read — the category browse row that feeds streams.live?game_id=…`,
  ),

  // ---- requires-auth (per-user OAuth token) ---------------------------------

  "channels.followed": requiresAuth(
    `The channels the AUTHORIZED account follows (broadcaster login/name, followed_at; cursor-paged) via Helix GET ${TWITCH_API_BASE}/channels/followed. Requires a per-user token with the user:read:follows scope (Authorization Code + PKCE); there is no app-access variant — the endpoint rejects app tokens.`,
  ),

  // ---- supported (playback + account, fixture-tested) ------------------------

  "playback.embed": supported(
    `Official embed player ${TWITCH_PLAYER_URL}?channel=<login>|video=<id>|clip=<slug> with the REQUIRED parent parameter (the embedding page's origin hostname). Live-verified 2026-10-11: no parent → 302 /embed-error.html?errorCode=NoParent; with parent the player serves a CSP frame-ancestors pinning exactly that origin. Dev time uses the documented localhost origin; the production-origin decision is an integration note (parity matrix §parent) — never guessed.`,
  ),
  "oauth.connect": supported(
    `Per-user OAuth 2.0 Authorization Code + PKCE (S256) at ${TWITCH_OAUTH_BASE}/authorize and ${TWITCH_OAUTH_BASE}/token with the read-only scope set (user:read:follows); loopback redirect; fixture-tested (live consent flow pending operator Twitch client_id/secret — operator item).`,
  ),
  "oauth.disconnect": supported(
    `Disconnect with an OFFICIAL revocation call: POST ${TWITCH_OAUTH_BASE}/revoke (client_id + token) per the revoke-tokens doc — Twitch, unlike TikTok Login Kit, defines a revocation endpoint, so disconnect destroys the provider-side grant too (fixture-tested; the vault-side tokens are destroyed and the record marked revoked).`,
  ),
  "oauth.app-access": supported(
    `App Access tokens (client-credentials grant) for PUBLIC reads: POST ${TWITCH_OAUTH_BASE}/token?grant_type=client_credentials (client_id + client_secret) — token type bearer, expires_in seconds; fixture-tested token manager with expiry-aware caching (live acquisition pending operator credentials — operator item).`,
  ),

  // ---- honest-unsupported (out of this order's scope — truthful states) ------

  "chat.read": unsupported(
    "Twitch chat is a SEPARATE protocol surface (IRC / EventSub chat), not a Helix read; this work order records it honest-unsupported (non-goal) with the surface pending as a later-phase row in the parity matrix. WebFlix shows no chat pane rather than an unofficial one.",
  ),
  "eventsub.subscribe": unsupported(
    "EventSub webhooks are server-side push requiring a public callback endpoint — a later-phase surface per the work order non-goals (pending row in the parity matrix, never an unsupported-API claim: the mechanism exists officially). This desktop connector runs request/response reads only.",
  ),
  "moderation.manage": unsupported(
    "Helix moderation surfaces (bans, timeouts, automod) are moderator-scoped operator surfaces — irrelevant to a viewer app and out of scope this order; WebFlix never requests a moderation scope.",
  ),
  "stream-key.read": unsupported(
    "Reading a stream key (channel:read:stream_key) exposes a creator secret that lets anyone broadcast as the channel; a viewer app has no business holding it. Out of scope by design.",
  ),
  "content-classification.list": unsupported(
    "Content classification labels are an operator/gated surface per the work order (they ride moderation-adjacent configuration); recorded as out of scope this order rather than integrated unreviewed.",
  ),
  "bits.value": unsupported(
    "Bits surfaces (leaderboards, transactions) are creator VALUE surfaces exposing monetary/engagement value data behind broadcaster-scoped tokens; a viewer app never renders monetary value — out of scope.",
  ),
  "subscriptions.value": unsupported(
    "Broadcaster subscriptions expose payer-adjacent monetary data (tier, price, gifting) behind broadcaster-scoped tokens; a viewer app never renders subscription value — out of scope.",
  ),
  "history.provider": unsupported(
    "No Helix endpoint returns a viewer's Twitch watch history. WebFlix keeps its OWN watch history (WebFlix-owned PlaybackProgress) and never claims to read Twitch's.",
  ),
  "recommendations.browse": unsupported(
    "Helix has no recommendations/home-feed endpoint; the first-page recommendation surface exists only in first-party clients. WebFlix's home is its own library/collections — never dressed up as Twitch recommendations.",
  ),
  "notifications.list": unsupported(
    "No Helix endpoint exposes the Twitch notification inbox; WebFlix shows no notification surface rather than fabricate one.",
  ),
  "whispers.list": unsupported(
    "Whispers (direct messages) are a private first-party surface with no third-party read API; WebFlix never touches whispers.",
  ),
  "search.suggestions": unsupported(
    "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no Twitch suggestions.",
  ),
  "video.download": unsupported(
    "Downloading Twitch content outside official surfaces is out of scope by policy (ADR-0003). WebFlix's local library is for user-owned/local content only; VODs stay on Twitch's own player.",
  ),
};

// ---------------------------------------------------------------------------
// Manifest (frozen §2.3 shape)
// ---------------------------------------------------------------------------

export const twitchManifest: ConnectorManifest = {
  providerId: TWITCH_PROVIDER_ID,
  operations: TWITCH_OPERATIONS,
  // Honest empty list: no positive served-region claim is made. Live-observed
  // 2026-10-11 from Hong Kong egress: api.twitch.tv, id.twitch.tv and
  // player.twitch.tv all answer normally (no regional gating observed) — but
  // one reachable egress region is not a global claim, so no region is listed.
  regions: [],
  // Request-envelope approximation of the official point-bucket model: the
  // guide's documented example (Ratelimit-Limit: 800) over the stated
  // 1-minute bucket window. NOT enforced pre-flight — the Ratelimit-*
  // response headers are the authoritative numbers and HTTP 429 the
  // authoritative enforcement (see TWITCH_RATE_LIMIT_BASIS).
  quotas: {
    requestsPerWindow: TWITCH_DOCUMENTED_EXAMPLE_BUCKET,
    windowMs: TWITCH_RATE_WINDOW_MS,
  },
  provenance: {
    connectorId: TWITCH_PROVIDER_ID,
    connectorVersion: TWITCH_MANIFEST_VERSION,
    // Constant seed artifact: generated at connector introduction
    // (fixture-only build; live calls beyond the recorded work-order checks
    // are pending-operator-credential).
    generatedAt: "2026-10-11T00:00:00Z",
  },
  // Typed failure modes the clients know they can hit (network failures,
  // timeouts, 401 auth, 429 rate-limit, unparseable payloads, upstream 5xx).
  failureModes: ["network", "timeout", "auth", "rate-limit", "parse", "upstream"],
};

/** Citation set for the account path (parity matrix + review evidence). */
export const TWITCH_ACCOUNT_PROVENANCE: readonly TwitchProvenanceNote[] = [
  DOC_AUTH_OAUTH_FLOWS,
  DOC_AUTH_REFRESH,
  DOC_AUTH_REVOKE,
  DOC_AUTH_REGISTER_APP,
  AUDIT_SOURCES_CITATION,
];
