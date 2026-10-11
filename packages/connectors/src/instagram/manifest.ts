/**
 * Instagram ConnectorManifest — the fourth platform on the exact frozen §2.3
 * contract YouTube, TikTok and Twitch use (INSTAGRAM-CONNECT, Phase 3
 * platform #3; binding platform-selection: Instagram #3 — "high value but the
 * browse/discovery parity users expect is largely unavailable officially" —
 * the audit's verdict IS the design brief: this connector is honesty-forward
 * by construction).
 *
 * Seeded from docs/plans/audits/AUDIT-SOURCES.md §5 (Instagram #3 platform
 * row: Graph API professional-accounts-only; Facebook Login OAuth per-user;
 * oEmbed app-review-required; discovery unavailable) and the Instagram rows
 * in docs/plans/phase3-platform-selection.md. ADR-0003 applies in full:
 * OFFICIAL SURFACES ONLY — no scraping, no private endpoints, no cookie
 * replay, no invented discovery, NO scraping substitutes for removed
 * discovery APIs (the honest state IS the deliverable).
 *
 * Official surfaces this connector is allowed to touch (nothing else):
 *   - Graph API (Instagram API with Facebook Login for Business)
 *                 https://graph.facebook.com/v26.0  — own profile
 *                 (GET /{ig-user-id}), own media (GET /{ig-user-id}/media),
 *                 insights (GET /{ig-user-id}/insights, GET /{media-id}/insights),
 *                 the account discovery chain (GET /me/accounts →
 *                 GET /{page-id}?fields=instagram_business_account) and the
 *                 oEmbed endpoint (GET /instagram_oembed)
 *   - Facebook Login for Business
 *                 https://www.facebook.com/v26.0/dialog/oauth  (authorize)
 *                 + graph.facebook.com/v26.0/oauth/access_token (code
 *                 exchange, long-lived exchange)
 *                 + DELETE /{user-id}/permissions (official revocation)
 *   - Instagram embed surface
 *                 https://www.instagram.com/p|reel/<shortcode>/embed/  and
 *                 the documented embed.js loader — the watch-path surface
 *
 * PROFESSIONAL-ACCOUNTS-ONLY (live-read official docs, 2026-10-11): both
 * Instagram API variants serve "Instagram professionals — businesses and
 * creators" only; the Facebook Login variant additionally requires the
 * professional account to be linked to a Facebook Page, and consumer
 * (personal) accounts "cannot access" the API (both variant guides' own
 * Limitations sections). This is recorded on every requires-auth row.
 *
 * API VERSION HONESTY: v26.0 is the live latest (the Graph API reference
 * pages title themselves "Graph API Reference v26.0", and graph.facebook.com
 * answered v25.0/v26.0 with the proper error envelope while v27.0 answered
 * "Unknown path components" — live probes 2026-10-11). Some markdown doc
 * samples still carry v25.0; the version is a constant, not a guess that
 * could drift silently.
 *
 * RATE HONESTY (work order): the official Business Use Case formula for
 * Instagram Platform reads, verbatim from the rate-limiting doc:
 *   "Calls within 24 hours = 4800 * Number of Impressions"
 * counted per (app, app-user) pair, messaging excluded, with Business
 * Discovery and Hashtag Search instead subject to Platform Rate Limits. The
 * audit's "~200 calls/hour/account (third-party reports)" is the arithmetic
 * equivalent of 4800/24 at ONE impression — an UNVERIFIED approximation this
 * connector models as the envelope figure with the basis label below, never
 * as an enforced ceiling (an account with zero impressions has zero API
 * budget under the official formula — impressions buy budget; there is no
 * fixed hourly floor to promise). The oEmbed endpoint carries its own
 * documented limit — 1,000 requests per hour. The authoritative runtime
 * signals are the provider's own X-App-Usage /
 * X-Business-Use-Case-Usage response headers (percentage-used JSON, recorded
 * verbatim by the client ledger) and the provider's throttle errors; NO call
 * is ever blocked pre-flight.
 *
 * HASHTAG-SEARCH REALITY CHECK (evidence over summaries): the work order and
 * AUDIT-SOURCES record hashtag search as "REMOVED 2024". The live official
 * docs (probed 200 on 2026-10-11) still document a Hashtag Search API —
 * gated behind App Review (Instagram Public Content Access feature +
 * instagram_basic permission, 30 unique hashtags per rolling 7 days,
 * Facebook-Login variant only). Both facts are recorded on the
 * hashtags.search row; either way it is NOT a consumer browse surface
 * WebFlix may offer, so the honest status is unchanged: unsupported, with
 * the gated operator path as a pending matrix row.
 *
 * BASIC DISPLAY REMOVAL (changelog, verbatim): "December 4, 2024 — The
 * Instagram Basic Display API has been deprecated. All requests to the
 * Instagram Basic Display API will return an error message." The
 * basic-display.* rows record this removal honestly instead of silently
 * pretending the surface never existed.
 *
 * Operation ids are dot-namespaced per the frozen OperationIdSchema
 * (^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$).
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

export const INSTAGRAM_PROVIDER_ID = "instagram";
export const INSTAGRAM_DISPLAY_NAME = "Instagram";
export const INSTAGRAM_MANIFEST_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Official surface constants (the ONLY Instagram/Meta hosts this connector
// touches — live-reachable from the HK work-order sandbox, 2026-10-11)
// ---------------------------------------------------------------------------

/**
 * Graph API host for the Instagram API with Facebook Login for Business
 * (the variant this connector uses; the Instagram-Login variant's host
 * graph.instagram.com is NOT called by this connector).
 */
export const INSTAGRAM_GRAPH_BASE = "https://graph.facebook.com";

/**
 * Graph API version pinned to the live latest (basis: reference-page titles
 * "Graph API Reference v26.0" + live probe behavior, 2026-10-11 — see the
 * module header).
 */
export const INSTAGRAM_API_VERSION = "v26.0";

/** Facebook Login dialog base (manual flow: /{version}/dialog/oauth). */
export const INSTAGRAM_LOGIN_DIALOG_BASE = "https://www.facebook.com";

/** The official oEmbed endpoint path on the Graph host. */
export const INSTAGRAM_OEMBED_PATH = "/instagram_oembed";

/** The Instagram web surface (embed pages + the documented embed.js loader). */
export const INSTAGRAM_WEB_BASE = "https://www.instagram.com";

/** The embed.js loader URL (live 200, application/x-javascript, 2026-10-11). */
export const INSTAGRAM_EMBED_SCRIPT_URL = "https://www.instagram.com/embed.js";

/** The loader URL exactly as the oEmbed html field carries it (protocol-relative). */
export const INSTAGRAM_OEMBED_EMBEDS_JS_URL = "//platform.instagram.com/en_US/embeds.js";

export const INSTAGRAM_OFFICIAL_SURFACES: readonly string[] = [
  INSTAGRAM_GRAPH_BASE,
  INSTAGRAM_LOGIN_DIALOG_BASE,
  INSTAGRAM_WEB_BASE,
];

/**
 * Read-only permission set this connector requests (Facebook Login scope
 * list, comma-separated on the wire): instagram_basic + pages_show_list (the
 * documented minimum for the account discovery chain and /media reads;
 * pages_read_engagement also satisfies the /media edge), and
 * instagram_manage_insights for the insights reads. NO publish scope
 * (instagram_content_publish), NO messaging scope
 * (instagram_business_manage_messages / instagram_manage_messages), NO
 * moderation scope (instagram_business_manage_comments) — write surfaces are
 * work-order non-goals recorded as pending rows only.
 */
export const INSTAGRAM_OAUTH_SCOPES: readonly string[] = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement",
  "instagram_manage_insights",
];

// ---------------------------------------------------------------------------
// Rate-limit model (BUC impressions formula — official; ~200/hour — the
// audit's UNVERIFIED third-party approximation; oEmbed 1,000/hour — official)
// ---------------------------------------------------------------------------

/** The official BUC formula, verbatim (Instagram Platform rate limits doc). */
export const INSTAGRAM_BUC_DOCUMENTED_FORMULA =
  "Calls within 24 hours = 4800 * Number of Impressions";

/** The oEmbed endpoint's own documented limit (oEmbed guide, verbatim). */
export const INSTAGRAM_OEMBED_DOCUMENTED_LIMIT = "1,000 requests every hour";

/**
 * The envelope approximation: 4800 calls / 24 hours = 200 calls per hour per
 * (app, app-user) pair at one impression — the figure AUDIT-SOURCES carries
 * as a third-party report. UNVERIFIED basis; never enforced client-side.
 */
export const INSTAGRAM_MODELED_HOURLY_APPROXIMATION = 200;

export const INSTAGRAM_RATE_WINDOW_MS = 3_600_000;

export const INSTAGRAM_RATE_LIMIT_BASIS =
  "Business Use Case rate limiting per the official Graph API rate-limiting doc: Instagram Platform calls (messaging excluded) are counted per (app, app-user) pair over a rolling 24-hour window with the documented formula \"Calls within 24 hours = 4800 * Number of Impressions\" — there is NO fixed hourly ceiling, and an account with zero impressions has zero API budget; the envelope figure (200/hour) is the audit's third-party-reported approximation of 4800/24 at one impression, NOT a verified per-app value and never enforced pre-flight (the provider's X-App-Usage / X-Business-Use-Case-Usage response headers and its own throttle errors are the only authoritative signals acted on). oEmbed carries its own documented limit of 1,000 requests per hour. Business Discovery and Hashtag Search are subject to Platform Rate Limits instead";

// ---------------------------------------------------------------------------
// Provenance citations (official sources; every URL below was probed 200 from
// the work-order sandbox on 2026-10-11 — see the parity matrix live-smoke)
// ---------------------------------------------------------------------------

export interface InstagramProvenanceNote {
  label: string;
  url: string;
}

const AUDIT_SOURCES_CITATION: InstagramProvenanceNote = {
  label:
    "docs/plans/audits/AUDIT-SOURCES.md §5 — platform selection evidence (Instagram #3), professional-accounts-only verdict and the removed/unavailable discovery inventory",
  url: "docs/plans/audits/AUDIT-SOURCES.md",
};
const DOC_PLATFORM_OVERVIEW: InstagramProvenanceNote = {
  label:
    "Instagram Platform overview — the two API variants, both professional-accounts-only (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform",
};
const DOC_API_FACEBOOK_LOGIN: InstagramProvenanceNote = {
  label:
    "Instagram API with Facebook Login — variant guide; Limitations: cannot access consumer accounts; cursor paging (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login",
};
const DOC_API_INSTAGRAM_LOGIN: InstagramProvenanceNote = {
  label:
    "Instagram API with Instagram Login — the other variant (graph.instagram.com host); NOT the variant this connector drives (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login",
};
const DOC_GET_STARTED: InstagramProvenanceNote = {
  label:
    "Getting Started (Facebook Login variant) — the account discovery chain GET /me/accounts → GET /{page-id}?fields=instagram_business_account → GET /{ig-user-id}/media, with verbatim sample payloads (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started",
};
const DOC_BUSINESS_LOGIN: InstagramProvenanceNote = {
  label:
    "Facebook Login for Business for Instagram — the login product, dialog parameters and fragment-token redirect (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/business-login-for-instagram",
};
const DOC_IG_USER_REFERENCE: InstagramProvenanceNote = {
  label:
    "IG User reference — own-profile fields (username, name, biography, followers_count, follows_count, media_count, profile_picture_url, website) and edges (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user",
};
const DOC_IG_MEDIA_EDGE: InstagramProvenanceNote = {
  label:
    "IG User Media edge — own-media reads: 10K most-recent cap, stories excluded, cursor + time-based paging, permission set (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media",
};
const DOC_IG_MEDIA_REFERENCE: InstagramProvenanceNote = {
  label:
    "IG Media reference — media_type (IMAGE/VIDEO/CAROUSEL_ALBUM), media_product_type (AD/FEED/STORY/REELS), shortcode/permalink/thumbnail_url/timestamp fields (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media",
};
const DOC_INSIGHTS: InstagramProvenanceNote = {
  label:
    "Insights guide — account metrics (impressions/reach/profile_views, period=day) and media metrics (engagement/impressions/reach), permission set per variant (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/insights",
};
const DOC_OEMBED: InstagramProvenanceNote = {
  label:
    "Instagram oEmbed guide — GET graph.facebook.com/instagram_oembed, URL formats (/p/, /reel/, profiles), the embed.js mechanism, embedding-only usage terms, 1,000 requests/hour (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/oembed",
};
const DOC_OEMBED_REFERENCE: InstagramProvenanceNote = {
  label:
    "Instagram oEmbed reference (Graph API v26.0) — parameters, fields and the default error codes 200/100/190/368 (official; page is client-rendered — its permission rows could not be re-extracted from this sandbox, recorded honestly)",
  url: "https://developers.facebook.com/docs/graph-api/reference/instagram-oembed",
};
const DOC_EMBED_BUTTON: InstagramProvenanceNote = {
  label:
    "Embed Button guide — the official embed mechanism for public photo/video/Reel posts (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/embed-button",
};
const DOC_HASHTAG_SEARCH: InstagramProvenanceNote = {
  label:
    "Hashtag Search — STILL DOCUMENTED (probed 200, 2026-10-11): App Review + Instagram Public Content Access + instagram_basic, 30 unique hashtags per rolling 7 days, Facebook-Login variant only (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/hashtag-search",
};
const DOC_CHANGELOG: InstagramProvenanceNote = {
  label:
    'Instagram Platform changelog — December 4, 2024: "The Instagram Basic Display API has been deprecated. All requests to the Instagram Basic Display API will return an error message." (official)',
  url: "https://developers.facebook.com/documentation/instagram-platform/changelog",
};
const DOC_MANUAL_FLOW: InstagramProvenanceNote = {
  label:
    "Facebook Login: Manually Build a Login Flow — dialog/oauth parameters (client_id, redirect_uri, state, response_type, scope), the documented desktop webview redirect, code exchange with client_secret (official)",
  url: "https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow",
};
const DOC_LONG_LIVED_TOKENS: InstagramProvenanceNote = {
  label:
    "Facebook Login: Get Long-Lived Tokens — grant_type=fb_exchange_token (~60 days); caveats: an expired token cannot be exchanged, and the call carries the app secret (official)",
  url: "https://developers.facebook.com/documentation/facebook-login/guides/access-tokens/get-long-lived",
};
const DOC_REQUEST_REVOKE: InstagramProvenanceNote = {
  label:
    "Facebook Login: Requesting & Revoking Permissions — DELETE /{user-id}/permissions de-authorizes the app and invalidates its user tokens; response true (official)",
  url: "https://developers.facebook.com/documentation/facebook-login/guides/permissions/request-revoke",
};
const DOC_RATE_LIMITING: InstagramProvenanceNote = {
  label:
    'Graph API rate limiting — Instagram Platform BUC: "Calls within 24 hours = 4800 * Number of Impressions" per (app, app-user) pair; X-App-Usage / X-Business-Use-Case-Usage headers; Business Discovery + Hashtag Search under Platform Rate Limits (official)',
  url: "https://developers.facebook.com/docs/graph-api/overview/rate-limiting",
};
const DOC_CONTENT_PUBLISHING: InstagramProvenanceNote = {
  label:
    "Content Publishing — the official publish surface (media containers, resumable uploads); work-order non-goal, pending row only (official)",
  url: "https://developers.facebook.com/documentation/instagram-platform/content-publishing",
};

/** Per-operation provenance citations (audit trail; connector-local — MR-FD3 precedent). */
export const INSTAGRAM_OPERATION_PROVENANCE: Readonly<
  Record<string, readonly InstagramProvenanceNote[]>
> = {
  "profile.read": [
    DOC_IG_USER_REFERENCE,
    DOC_GET_STARTED,
    DOC_API_FACEBOOK_LOGIN,
    AUDIT_SOURCES_CITATION,
  ],
  "media.list": [
    DOC_IG_MEDIA_EDGE,
    DOC_IG_MEDIA_REFERENCE,
    DOC_GET_STARTED,
    AUDIT_SOURCES_CITATION,
  ],
  "insights.account": [DOC_INSIGHTS, DOC_IG_USER_REFERENCE, AUDIT_SOURCES_CITATION],
  "insights.media": [DOC_INSIGHTS, DOC_IG_MEDIA_REFERENCE, AUDIT_SOURCES_CITATION],
  "oembed.resolve": [DOC_OEMBED, DOC_OEMBED_REFERENCE, DOC_EMBED_BUTTON, AUDIT_SOURCES_CITATION],
  "playback.embed": [DOC_OEMBED, DOC_EMBED_BUTTON, DOC_PLATFORM_OVERVIEW, AUDIT_SOURCES_CITATION],
  "oauth.connect": [DOC_MANUAL_FLOW, DOC_BUSINESS_LOGIN, DOC_GET_STARTED, AUDIT_SOURCES_CITATION],
  "oauth.long-lived": [DOC_LONG_LIVED_TOKENS, DOC_MANUAL_FLOW, AUDIT_SOURCES_CITATION],
  "oauth.disconnect": [DOC_REQUEST_REVOKE, DOC_MANUAL_FLOW, AUDIT_SOURCES_CITATION],
  "feed.home": [DOC_API_FACEBOOK_LOGIN, DOC_PLATFORM_OVERVIEW, AUDIT_SOURCES_CITATION],
  "explore.browse": [DOC_API_FACEBOOK_LOGIN, DOC_PLATFORM_OVERVIEW, AUDIT_SOURCES_CITATION],
  "hashtags.search": [DOC_HASHTAG_SEARCH, AUDIT_SOURCES_CITATION],
  "reels.browse": [DOC_IG_MEDIA_EDGE, DOC_PLATFORM_OVERVIEW, AUDIT_SOURCES_CITATION],
  "stories.read": [DOC_IG_USER_REFERENCE, DOC_OEMBED, AUDIT_SOURCES_CITATION],
  "messages.list": [DOC_PLATFORM_OVERVIEW, DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "notifications.list": [DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "comments.list": [DOC_API_FACEBOOK_LOGIN, DOC_PLATFORM_OVERVIEW, AUDIT_SOURCES_CITATION],
  "publish.media": [DOC_CONTENT_PUBLISHING, AUDIT_SOURCES_CITATION],
  "business-discovery.read": [DOC_API_FACEBOOK_LOGIN, DOC_RATE_LIMITING, AUDIT_SOURCES_CITATION],
  "profile.browse-public": [DOC_BUSINESS_LOGIN, DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "search.query": [DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "search.suggestions": [DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "history.provider": [DOC_API_FACEBOOK_LOGIN, AUDIT_SOURCES_CITATION],
  "live.browse": [DOC_IG_USER_REFERENCE, AUDIT_SOURCES_CITATION],
  "basic-display.profile": [DOC_CHANGELOG, DOC_API_INSTAGRAM_LOGIN, AUDIT_SOURCES_CITATION],
  "video.download": [DOC_OEMBED, AUDIT_SOURCES_CITATION],
};

// ---------------------------------------------------------------------------
// Per-operation capability rows (frozen §2.3: Record<OperationId,
// {status, detail?, checkedAt?}>)
// ---------------------------------------------------------------------------

function requiresAuth(mechanism: string): OperationCapability {
  return { status: "requires-auth", detail: mechanism };
}

function supported(mechanism: string): OperationCapability {
  return { status: "supported", detail: mechanism };
}

function unsupported(reason: string): OperationCapability {
  return { status: "unsupported", detail: reason };
}

function unavailable(reason: string): OperationCapability {
  return { status: "unavailable", detail: reason };
}

export const INSTAGRAM_OPERATIONS: Readonly<Record<string, OperationCapability>> = {
  // ---- requires-auth (professional-account reads via the Facebook Login
  //      variant — per-user token + the operator's approved Meta app) --------

  "profile.read": requiresAuth(
    `The AUTHORIZED account's own Instagram professional-account profile (username, name, biography, followers/follows counts, media_count, profile_picture_url, website) via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/{ig-user-id}?fields=… — Instagram professional accounts (Business/Creator) linked to a Facebook Page ONLY; consumer accounts cannot access the API (official Limitations). The ig-user-id is discovered through the documented chain GET /me/accounts → GET /{page-id}?fields=instagram_business_account. Requires a per-user Facebook Login token with instagram_basic + pages_show_list and the operator's app-review-approved Meta app.`,
  ),
  "media.list": requiresAuth(
    `The AUTHORIZED account's own media (up to the documented 10K most-recent cap; stories excluded — they live on the /stories edge) via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/{ig-user-id}/media?fields=id,caption,media_type,media_product_type,permalink,shortcode,thumbnail_url,timestamp,username,media_url — cursor-based and time-based paging; media_type IMAGE/VIDEO/CAROUSEL_ALBUM with media_product_type FEED/REELS/…. Same professional-accounts-only gate as profile.read (instagram_basic + pages_read_engagement OR pages_show_list).`,
  ),
  "insights.account": requiresAuth(
    `The AUTHORIZED account's own account-level insights (metric set e.g. impressions, reach, profile_views; period=day; some metrics need ≥100 followers; data stored up to 90 days) via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/{ig-user-id}/insights?metric=…&period=… — professional accounts only; instagram_basic + instagram_manage_insights + pages_read_engagement.`,
  ),
  "insights.media": requiresAuth(
    `The AUTHORIZED account's own per-media insights (metric set e.g. engagement, impressions, reach; lifetime period) via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/{media-id}/insights?metric=… — professional accounts only; instagram_manage_insights.`,
  ),
  "oembed.resolve": requiresAuth(
    `Resolve an Instagram post/Reel URL to its official embed markup via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}${INSTAGRAM_OEMBED_PATH}?url=… (the payload's html field carries the blockquote.instagram-media markup + the ${INSTAGRAM_OEMBED_EMBEDS_JS_URL} loader; documented rate limit ${INSTAGRAM_OEMBED_DOCUMENTED_LIMIT}). PENDING APP REVIEW — the operator gate chain this platform carries: a Meta Business-type app + App Review approval (the work order and AUDIT-SOURCES record oEmbed as app-review-required; the reference page's permission rows are client-rendered and could not be re-extracted from this sandbox). LIVE OBSERVATION recorded honestly: on 2026-10-11 an UNAUTHENTICATED call for the oEmbed doc's own example post answered HTTP 200 with the full payload (captured verbatim as a fixture), while a dead shortcode answered 400 code 24 subcode 2207045 "Media Not Found … does not exist or you don't have permission to embed it" — anonymous success on one public post does not waive the production gate, so this row stays requires-auth until the operator's app is approved. Usage terms: embedding only — never a metadata source for catalog enrichment.`,
  ),

  // ---- supported (account path on the shared OAuth seams; fixture-tested) --

  "oauth.connect": supported(
    `Per-user Facebook Login for Business on the shared CredentialPort / OAuthAccountStore seams: authorize at ${INSTAGRAM_LOGIN_DIALOG_BASE}/${INSTAGRAM_API_VERSION}/dialog/oauth (client_id, redirect_uri, state, response_type, scope as a COMMA-separated list — the read-only set ${INSTAGRAM_OAUTH_SCOPES.join(",")}), then exchange the code at ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/oauth/access_token (client_id + redirect_uri + client_secret + code). NO PKCE parameters are sent — Facebook's documented manual flow defines none (client_secret authenticates the exchange), and no Google/TikTok-style parameters are invented. The redirect URI must be registered by the operator in the App Dashboard (the documented desktop webview pattern is https://www.facebook.com/connect/login_success.html — the redirect choice is an operator item, recorded in the parity matrix §account). Fixture-tested; live consent flow pending operator Meta app ID/secret + App Review + business verification — the heaviest operator-credential chain of the four platforms (operator item).`,
  ),
  "oauth.long-lived": supported(
    `Exchange a short-lived User token for a long-lived one (~60 days) via GET ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token — the Facebook "refresh" equivalent, with the documented caveats honored honestly: an EXPIRED token cannot be exchanged (re-login is the only path — the session surfaces RequiresAuthError instead of pretending to refresh), and the call carries the app secret (main-process only, never renderer-side). Fixture-tested; live exchange pending operator credentials.`,
  ),
  "oauth.disconnect": supported(
    `Disconnect with an OFFICIAL revocation call: DELETE ${INSTAGRAM_GRAPH_BASE}/${INSTAGRAM_API_VERSION}/{user-id}/permissions (user or app token) — per the request-revoke doc this de-authorizes the app, invalidates its user tokens and answers true. Like Twitch (and unlike TikTok Login Kit), an official revocation endpoint exists, so disconnect destroys the provider-side grant too; a FAILED revoke leaves the local record intact and retryable (fixture-tested) — the vault-side tokens are only destroyed after the provider confirms.`,
  ),

  // ---- unavailable (the watch-path investigation — the honest default) ----

  "playback.embed": unavailable(
    `Official Instagram media playback, investigated per the work order: the official mechanism is the oEmbed markup (blockquote.instagram-media + the ${INSTAGRAM_OEMBED_EMBEDS_JS_URL} loader; the oEmbed API live-answered an anonymous request for the doc-example public post with exactly that html on 2026-10-11 — captured verbatim) and the embed page https://www.instagram.com/p|reel/<shortcode>/embed/. The embed page live-behaves conditionally: direct navigation answers 200 with x-frame-options: DENY, while an iframe-context request (Sec-Fetch-Dest: iframe + cross-site Referer) answers 200 with NO x-frame-options — a framing gate driven by request context, not a query parameter WebFlix could pin. End-to-end embed playback in the desktop webview therefore CANNOT be verified from this sandbox without the operator's approved Meta app credentials, and the oEmbed API is app-review-gated. HONEST DEFAULT (work order): unavailable{requires-auth} + open-provider-app handoff (the post permalink) — never a guessed embed; the approved-credential path (official-embed plan against the documented embed page, both builders shipped and fixture-tested, off by default) is the pending row in the parity matrix §watch.`,
  ),

  // ---- honest-unsupported (the audit's verdict made concrete, row by row) --

  "feed.home": unsupported(
    "No official API returns the Instagram home/consumer feed — neither API variant exposes a feed read (the variants' own capability lists cover media publish/manage, comments, mentions, messaging, insights). The consumer feed exists only in first-party surfaces. WebFlix never scrapes it and never dresses its own library up as an Instagram feed.",
  ),
  "explore.browse": unsupported(
    "No official API exposes Instagram Explore/discovery browsing. The discovery parity users expect is, per the audit's verdict, 'largely unavailable officially' — that unavailability IS this row; no scraping substitute exists by policy.",
  ),
  "hashtags.search": unsupported(
    `REALITY CHECK, both facts recorded: the work order and AUDIT-SOURCES record hashtag search as REMOVED 2024; the LIVE official docs (probed 200 on 2026-10-11) still document a Hashtag Search API — GET /ig_hashtag_search + /{ig-hashtag-id}/top_media|recent_media — gated behind App Review (Instagram Public Content Access feature + instagram_basic permission; 30 unique hashtags per rolling 7 days per professional account; Facebook-Login variant only; subject to Platform Rate Limits, not the BUC bucket). Either way it is NOT a consumer browse surface WebFlix may offer: it is an operator-gated surface recorded as a pending row in the parity matrix, never an invented discovery feature.`,
  ),
  "reels.browse": unsupported(
    "No public API browses/discovers other accounts' Reels. The authorized account's OWN reels DO arrive through media.list (media_type VIDEO with media_product_type REELS) — that is the only official reels surface this connector carries.",
  ),
  "stories.read": unsupported(
    "The GET /{ig-user-id}/stories edge exists officially (own stories only, 24-hour ephemeral, Facebook-Login variant), but the oEmbed guide explicitly excludes Stories ('Stories are not supported') and the media edge excludes them too — so a story read has NO playback path inside WebFlix. Out of scope this order; recorded as a pending row (read-only, no playback) rather than integrated half-way.",
  ),
  "messages.list": unsupported(
    "Instagram messaging rides the Messenger Platform / business messaging APIs — a server-side webhook-driven surface for business conversations, irrelevant to a viewer app and out of scope this order (pending matrix row, never a DM pane).",
  ),
  "notifications.list": unsupported(
    "No official endpoint exposes the Instagram notification inbox. WebFlix shows no notification surface rather than fabricate one.",
  ),
  "comments.list": unsupported(
    "Comment reads/moderation exist officially (comment moderation guides, manage-comments scope) — a creator-side surface, out of scope for this viewer-app order; pending matrix row. WebFlix shows no comment pane rather than an unofficial one.",
  ),
  "publish.media": unsupported(
    "The official Content Publishing API exists (media containers + resumable uploads; audit row: 100 API posts/24h) — a write surface behind instagram_content_publish and operator gating. Work-order NON-GOAL: recorded as pending only; this connector never requests a publish scope and never uploads anything.",
  ),
  "business-discovery.read": unsupported(
    "The business_discovery edge exists officially (basic metadata + metrics about OTHER professional accounts, by username) — a per-target gated read (instagram_basic; subject to Platform Rate Limits per the rate-limiting doc), not a browse surface. Out of scope this order; pending matrix row.",
  ),
  "profile.browse-public": unsupported(
    "No official API browses arbitrary public Instagram profiles (business_discovery is the gated per-target exception, pending row above). Anonymous web profiles are LOGIN-WALLED from this sandbox's egress (live-verified 2026-10-11: https://www.instagram.com/<username>/ → 302 https://www.instagram.com/accounts/login/…) and scraping is forbidden by ADR-0003 — WebFlix shows other users only as the owner attribution the official payloads themselves carry.",
  ),
  "search.query": unsupported(
    "No public keyword search API exists for Instagram content. The compliant discovery path inside WebFlix is the authorized account's own media (media.list); everything else is a handoff to the official app/site.",
  ),
  "search.suggestions": unsupported(
    "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no Instagram suggestions.",
  ),
  "history.provider": unsupported(
    "No official endpoint returns an Instagram watch/view history. WebFlix keeps its OWN watch history (WebFlix-owned PlaybackProgress) for items played in WebFlix and never claims to read Instagram's.",
  ),
  "live.browse": unsupported(
    "No viewer-facing API browses Instagram LIVE. The live_media edge reads the authorized account's OWN live media — and only while being broadcast — which is not a browse surface. WebFlix shows no LIVE surface rather than fabricate one.",
  ),
  "basic-display.profile": unsupported(
    `REMOVED: the Instagram Basic Display API was deprecated December 4, 2024 — changelog, verbatim: "The Instagram Basic Display API has been deprecated. All requests to the Instagram Basic Display API will return an error message." (the docs page itself now redirects to the Instagram Platform overview — probed 2026-10-11). The own-profile/own-media reads this connector offers ride the current Instagram Platform APIs instead (profile.read / media.list above); nothing here pretends Basic Display still exists.`,
  ),
  "video.download": unsupported(
    "Downloading Instagram content outside official surfaces is out of scope by policy (ADR-0003; work-order non-goal). WebFlix's local library is for user-owned/local content only; the official in-app save (subject to the creator's settings) is the sanctioned path.",
  ),
};

// ---------------------------------------------------------------------------
// Manifest (frozen §2.3 shape)
// ---------------------------------------------------------------------------

export const instagramManifest: ConnectorManifest = {
  providerId: INSTAGRAM_PROVIDER_ID,
  operations: INSTAGRAM_OPERATIONS,
  // Honest empty list: no positive served-region claim is made. Live-observed
  // 2026-10-11 from Hong Kong egress: graph.facebook.com answered with the
  // documented error envelopes (no regional gating), www.instagram.com served
  // the homepage 200 while profile pages 302-redirect to a login wall (an
  // auth wall, not a regional block) — one reachable egress region is not a
  // global claim, so no region is listed.
  regions: [],
  // Envelope approximation (see INSTAGRAM_RATE_LIMIT_BASIS): the audit's
  // UNVERIFIED third-party ~200/hour figure = 4800/24 at one impression,
  // over one hour. The official model is the impressions-based BUC formula —
  // there is no fixed ceiling to promise, and nothing is enforced
  // pre-flight.
  quotas: {
    requestsPerWindow: INSTAGRAM_MODELED_HOURLY_APPROXIMATION,
    windowMs: INSTAGRAM_RATE_WINDOW_MS,
  },
  provenance: {
    connectorId: INSTAGRAM_PROVIDER_ID,
    connectorVersion: INSTAGRAM_MANIFEST_VERSION,
    // Constant seed artifact: generated at connector introduction
    // (fixture-only build; live calls beyond the recorded work-order checks
    // are pending the operator's Meta app review chain).
    generatedAt: "2026-10-11T00:00:00Z",
  },
  // Typed failure modes the clients know they can hit (network failures,
  // timeouts, 401 auth, 429/code-4 throttle, unparseable payloads, upstream 5xx).
  failureModes: ["network", "timeout", "auth", "rate-limit", "parse", "upstream"],
};

/** Citation set for the account path (parity matrix + review evidence). */
export const INSTAGRAM_ACCOUNT_PROVENANCE: readonly InstagramProvenanceNote[] = [
  DOC_MANUAL_FLOW,
  DOC_BUSINESS_LOGIN,
  DOC_LONG_LIVED_TOKENS,
  DOC_REQUEST_REVOKE,
  DOC_GET_STARTED,
  AUDIT_SOURCES_CITATION,
];

/** Citation set for the watch path (parity matrix + review evidence). */
export const INSTAGRAM_WATCH_PROVENANCE: readonly InstagramProvenanceNote[] = [
  DOC_OEMBED,
  DOC_OEMBED_REFERENCE,
  DOC_EMBED_BUTTON,
  DOC_PLATFORM_OVERVIEW,
  AUDIT_SOURCES_CITATION,
];
