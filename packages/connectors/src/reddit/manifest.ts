/**
 * Reddit ConnectorManifest — the fifth platform on the exact frozen §2.3
 * contract YouTube, TikTok, Twitch and Instagram use (REDDIT-CONNECT,
 * Phase 3 platform #4; binding platform-selection: Reddit #4 — "community
 * long-form video": the REST API's posts/comments/media reads + the official
 * embed surface).
 *
 * Seeded from docs/plans/audits/AUDIT-SOURCES.md §5 (Reddit #4 platform row:
 * REST API posts/comments/media, OAuth per-user + app-only, ~100 QPM free
 * tier, video embeddable, AI-training terms restriction) and the Reddit rows
 * in docs/plans/phase3-platform-selection.md. ADR-0003 applies in full:
 * OFFICIAL SURFACES ONLY — no scraping, no cookie replay, no AI-training
 * consumption, no undocumented endpoints.
 *
 * Official surfaces this connector is allowed to touch (nothing else):
 *   - The REST API served at https://oauth.reddit.com (OAuth-authenticated
 *     Data API calls; the Reddit Data API Wiki states verbatim: "Clients
 *     must authenticate with a registered OAuth token. We can and will
 *     freely throttle or block unidentified Data API users." and "Traffic
 *     not using OAuth or login credentials will be blocked") —
 *     subreddit listings (GET [/r/subreddit]/hot|new|top, GET /best), the
 *     comment-tree read (GET [/r/subreddit]/comments/<article>), subreddit
 *     about (GET /r/<sub>/about), link search (GET [/r/subreddit]/search),
 *     public user reads (GET /user/<name>/about, /user/<name>/submitted),
 *     per-user identity (GET /api/v1/me) and my subreddits
 *     (GET /subreddits/mine/subscriber) — all documented on
 *     https://www.reddit.com/dev/api (live-probed 200, 2026-10-11).
 *   - OAuth 2.0 at https://www.reddit.com/api/v1/authorize (code flow,
 *     duration=permanent → refresh tokens), the token endpoint
 *     https://www.reddit.com/api/v1/access_token (code + refresh_token +
 *     client_credentials grants), and the OFFICIAL revocation endpoint
 *     https://www.reddit.com/api/v1/revoke_token (all documented on the
 *     OAuth2 wiki; the token + revoke endpoints live-answered dummy-Basic
 *     probes with the verbatim JSON 401 {"message":"Unauthorized","error":401}).
 *   - The official embed surface https://embed.reddit.com (the widgets.js
 *     mechanism's iframe target; live-probed: widgets.js 200, the
 *     /comments/<id> shortlink shape 200 with CSP frame-ancestors * — see
 *     ./playback).
 *
 * The platform's own policy shapes this connector honestly:
 *   - ~100 QPM per OAuth client id free tier — documented VERBATIM in the
 *     Data API Wiki ("The limit is: 100 queries per minute (QPM) per OAuth
 *     client id. QPM limits will be an average over a time window
 *     (currently 10 minutes) to support bursting requests."); the per-app
 *     allocation is UNVERIFIED until the operator registers an app;
 *     authoritative enforcement = HTTP 429 + the served X-Ratelimit-*
 *     headers (documented; not observed from this sandbox's blocked egress).
 *   - The AI-training terms restriction (Responsible Builder Policy,
 *     captured verbatim 2026-10-11: "No Unapproved Commercialization or AI
 *     Training — You must not sell, license, share, or otherwise
 *     commercialize Reddit data without express written approval. This
 *     extends to commercial and non-commercial mining, scraping, or using
 *     data for purposes like ads targeting or to train machine learning or
 *     AI models.") — WebFlix is a MEDIA CLIENT: it renders Reddit posts in
 *     its player surfaces for the watching user and trains nothing on
 *     anything. The restriction is recorded here and in the parity matrix.
 *   - The User-Agent policy (NEVER lie about the UA; the documented format
 *     <platform>:<app ID>:<version string> (by /u/<username>)) — the client
 *     carries an honest descriptive UA constant; the operator item is to
 *     register the app and fill in their own app id + contact username.
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

/** The provider id this connector owns (frozen §2 vocabulary). */
export const REDDIT_PROVIDER_ID = "reddit";

/** Manifest version for this connector (provenance stamp). */
export const REDDIT_MANIFEST_VERSION = "1.0.0";

/** The provider display name (surfaced by the package exports). */
export const REDDIT_DISPLAY_NAME = "Reddit";

// ---------------------------------------------------------------------------
// Official-surface constants (the ONLY hosts/URLs this connector touches)
// ---------------------------------------------------------------------------

/** The OAuth-authenticated Data API host (all reads go through it). */
export const REDDIT_API_BASE = "https://oauth.reddit.com";

/** The public web host (permalinks + the OAuth endpoint paths live here). */
export const REDDIT_WWW_BASE = "https://www.reddit.com";

/** The OAuth authorize endpoint (code flow; space-separated scopes). */
export const REDDIT_AUTHORIZE_URL = "https://www.reddit.com/api/v1/authorize";

/** The OAuth token endpoint (code, refresh_token and client_credentials grants). */
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/** The OFFICIAL token revocation endpoint (token + token_type_hint). */
export const REDDIT_REVOKE_URL = "https://www.reddit.com/api/v1/revoke_token";

/** The official embed surface host (the widgets.js iframe target). */
export const REDDIT_EMBED_BASE = "https://embed.reddit.com";

/** The official embed widget loader (the documented DOM mechanism's script). */
export const REDDIT_WIDGETS_JS_URL = "https://embed.reddit.com/widgets.js";

/** The self-serve app-registration surface (the operator's item). */
export const REDDIT_APP_SETTINGS_URL = "https://www.reddit.com/prefs/apps";

/**
 * The honest descriptive User-Agent this client sends (the Data API Wiki's
 * documented format `<platform>:<app ID>:<version string> (by /u/<username>)`
 * and its rule "NEVER lie about your User-Agent"). The placeholder app id +
 * contact username are OPERATOR ITEMS: reddit.com/prefs/apps is self-serve
 * (lower-friction than Meta's review chain) and the operator registers the
 * app, then fills in their own id + username here.
 */
export const REDDIT_DESKTOP_USER_AGENT =
  "desktop:app.webflix.local:v1.0.0 (by /u/webflix-operator)";

/**
 * The read-only OAuth scope set this connector requests (space-separated per
 * the OAuth2 wiki; identity = /api/v1/me, read = public data reads,
 * mysubreddits = /subreddits/mine). NO write scopes: voting/saving/
 * commenting/submitting are later-phase rows, so the connector never asks
 * for the permissions it does not exercise.
 */
export const REDDIT_OAUTH_SCOPES: readonly string[] = ["identity", "mysubreddits", "read"];

// ---------------------------------------------------------------------------
// Rate-limit model (basis-labeled, per the work order)
// ---------------------------------------------------------------------------

/**
 * The official free-tier rate limit, VERBATIM from the Reddit Data API Wiki
 * (support.reddithelp.com article 16160319875092, captured 2026-10-11 via
 * the help center's own JSON API after the HTML host 403-blocked this
 * sandbox's datacenter egress):
 *
 *   "We enforce rate limits for those eligible for free access usage of our
 *    Data API. The limit is: 100 queries per minute (QPM) per OAuth client
 *    id. QPM limits will be an average over a time window (currently 10
 *    minutes) to support bursting requests."
 *
 * Basis label: DOCUMENTED-OFFICIAL (the quote is the provider's own), with
 * two honest caveats — the per-app allocation is UNVERIFIED until the
 * operator registers an app, and the authoritative enforcement is the
 * served response headers (X-Ratelimit-Used / X-Ratelimit-Remaining /
 * X-Ratelimit-Reset, documented on the same page) plus HTTP 429, never a
 * client-side guess. The client records those headers verbatim when served.
 */
export const REDDIT_DOCUMENTED_QPM = 100;

/** The rate window the QPM number names (one minute). */
export const REDDIT_RATE_WINDOW_MS = 60_000;

/**
 * The served-header names (documented verbatim on the Data API Wiki):
 * "Monitor the following response headers to ensure that you're not
 * exceeding the limits".
 */
export const REDDIT_RATE_HEADER_NAMES = [
  "X-Ratelimit-Used",
  "X-Ratelimit-Remaining",
  "X-Ratelimit-Reset",
] as const;

/**
 * The AI-training terms restriction, as RUNTIME data (the work order: "NO
 * AI-training use… record it in the matrix; WebFlix is a media client, say
 * so, cite the terms"). Captured VERBATIM from the official Responsible
 * Builder Policy (2026-10-11, via the help center's own JSON API). The
 * parity matrix §G carries the full note; this constant is the
 * connector-local runtime record the tests assert.
 */
export const REDDIT_AI_TRAINING_TERMS_NOTE =
  'Reddit Responsible Builder Policy, "No Unapproved Commercialization or AI Training": "You must not sell, license, share, or otherwise commercialize Reddit data without express written approval. This extends to commercial and non-commercial mining, scraping, or using data for purposes like ads targeting or to train machine learning or AI models." WebFlix is a MEDIA CLIENT: it renders Reddit posts in its player surfaces for the watching user and trains nothing on anything (source: https://support.reddithelp.com/hc/en-us/articles/42728983564564).';

// ---------------------------------------------------------------------------
// Official-documentation citations (every operation row cites its sources)
// ---------------------------------------------------------------------------

/** The API reference (live-probed 200 on 2026-10-11 from this sandbox). */
export const DOC_REDDIT_API = "https://www.reddit.com/dev/api";

/** The canonical OAuth2 documentation (live-probed 200; raw markdown read). */
export const DOC_REDDIT_OAUTH2 = "https://github.com/reddit-archive/reddit/wiki/OAuth2";

/** App types + redirect conventions (live-probed 200; raw markdown read). */
export const DOC_REDDIT_APP_TYPES =
  "https://github.com/reddit-archive/reddit/wiki/OAuth2-App-Types";

/**
 * The Reddit Data API Wiki — rate limits (100 QPM verbatim), the
 * X-Ratelimit-* headers, the User-Agent policy, the deletion-compliance
 * rules and the "traffic not using OAuth will be blocked" policy (captured
 * verbatim 2026-10-11 via the help center JSON API; the HTML host
 * 403-blocks this sandbox's datacenter egress — both facts recorded).
 */
export const DOC_REDDIT_DATA_API_WIKI =
  "https://support.reddithelp.com/hc/en-us/articles/16160319875092";

/**
 * The Responsible Builder Policy — includes the AI-training restriction
 * ("No Unapproved Commercialization or AI Training") captured verbatim.
 */
export const DOC_REDDIT_RESPONSIBLE_BUILDER =
  "https://support.reddithelp.com/hc/en-us/articles/42728983564564";

/** The Developer Terms (redditinc.com, live-probed 200). */
export const DOC_REDDIT_DEVELOPER_TERMS = "https://www.redditinc.com/policies/developer-terms";

/** The Data API Terms (redditinc.com, live-probed 200). */
export const DOC_REDDIT_DATA_API_TERMS = "https://www.redditinc.com/policies/data-api-terms";

/** AUDIT-SOURCES §5 platform row (the selection + policy basis). */
const AUDIT_SOURCES_CITATION = "docs/plans/audits/AUDIT-SOURCES.md §5 (Reddit #4)";

/**
 * Provenance citations per operation row (connector-local documentation
 * data — the frozen §2.3 shape has no citations field; this rides the
 * MR-FD3 freeze-deviation queue with the other four platforms' maps).
 */
export const REDDIT_OPERATION_PROVENANCE: Readonly<Record<string, readonly string[]>> = {
  "listings.hot": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "listings.new": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "listings.top": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "listings.best": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "post.detail": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "subreddit.about": [DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
  "search.query": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "user.about": [DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
  "user.submitted": [DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
  "identity.me": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "subreddits.mine": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "oauth.connect": [
    DOC_REDDIT_OAUTH2,
    DOC_REDDIT_APP_TYPES,
    DOC_REDDIT_DATA_API_WIKI,
    AUDIT_SOURCES_CITATION,
  ],
  "oauth.refresh": [DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "oauth.app-only": [DOC_REDDIT_OAUTH2, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "oauth.disconnect": [DOC_REDDIT_OAUTH2, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "playback.embed": [DOC_REDDIT_API, DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "vote.cast": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "save.toggle": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "comment.create": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "post.submit": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "message.compose": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "subscribe.toggle": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "messages.list": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "activity.mine": [DOC_REDDIT_API, DOC_REDDIT_OAUTH2, AUDIT_SOURCES_CITATION],
  "chat.list": [DOC_REDDIT_DATA_API_WIKI, AUDIT_SOURCES_CITATION],
  "live.browse": [DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
  "moderation.manage": [DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
  "video.download": [DOC_REDDIT_DATA_API_TERMS, DOC_REDDIT_API, AUDIT_SOURCES_CITATION],
};

// ---------------------------------------------------------------------------
// Manifest rows (the frozen §2.3 vocabulary, honesty-forward)
// ---------------------------------------------------------------------------

function supported(mechanism: string): OperationCapability {
  return { status: "supported", detail: mechanism };
}

function requiresAuth(mechanism: string): OperationCapability {
  return { status: "requires-auth", detail: mechanism };
}

function unavailable(mechanism: string): OperationCapability {
  return { status: "unavailable", detail: mechanism };
}

function unsupported(reason: string): OperationCapability {
  return { status: "unsupported", detail: reason };
}

/**
 * The Reddit operation rows. The read surface is genuinely rich (this is the
 * platform's honest differentiator vs Instagram): public subreddit listings,
 * post+comment trees, search and public user reads are all documented,
 * OAuth-app-only reads. Writes exist as documented APIs but are later-phase
 * rows for this order; the chat system and video-live have no public read
 * API; moderation is gated to moderator credentials.
 */
export const REDDIT_OPERATIONS: Readonly<Record<string, OperationCapability>> = {
  // ---- supported public reads (app-only OAuth; the "read" scope) --------

  "listings.hot": supported(
    `Subreddit hot listing via GET ${REDDIT_API_BASE}/r/<subreddit>/hot (documented "This endpoint is a listing" with after/before cursors, count, limit default 25 max 100, and a geo parameter on dev/api) — OAuth app-only or per-user token; the Data API Wiki's rule applies: "Traffic not using OAuth or login credentials will be blocked" (live-verified 2026-10-11: unauthenticated www.reddit.com .json reads answer 403 block pages from this sandbox's datacenter egress).`,
  ),
  "listings.new": supported(
    `Subreddit new listing via GET ${REDDIT_API_BASE}/r/<subreddit>/new (documented listing; after/before cursors; limit default 25 max 100).`,
  ),
  "listings.top": supported(
    `Subreddit top listing via GET ${REDDIT_API_BASE}/r/<subreddit>/top?t=hour|day|week|month|year|all (documented listing with the time-window parameter + cursors).`,
  ),
  "listings.best": supported(
    `Front-page best listing via GET ${REDDIT_API_BASE}/best (documented listing; the signed-in front page ranking). This is Reddit's honest "home feed" for apps — the consumer-only feeds of other platforms do not apply here.`,
  ),
  "post.detail": supported(
    `Post + comment tree via GET ${REDDIT_API_BASE}/comments/<article-id> (documented "Get the comment tree for a given Link article"; the deeper-page continuation GET /api/morechildren is the documented follow-up for stubbed MoreComments children). Comments surface as discussion context around the watchable post — never as catalog items.`,
  ),
  "subreddit.about": supported(
    `Subreddit about via GET ${REDDIT_API_BASE}/r/<subreddit>/about (documented: "Return information about the subreddit. Data includes the subscriber count, description, and header image."). Surfaced as a browse CONTAINER descriptor (the Twitch users/games precedent) — a subreddit is where you browse videos, not a watchable item itself.`,
  ),
  "search.query": supported(
    `Link search via GET ${REDDIT_API_BASE}/r/<subreddit>/search?q=…&type=link (documented "Search links page. This endpoint is a listing."; include_facets, cursors, limit). Searches within a subreddit or site-wide.`,
  ),
  "user.about": supported(
    `Public user about via GET ${REDDIT_API_BASE}/user/<username>/about (documented: "Return information about the user, including karma and gold status"). Browse-container descriptor, never a watchable item.`,
  ),
  "user.submitted": supported(
    `Public user submissions via GET ${REDDIT_API_BASE}/user/<username>/submitted (documented history listing). Mapped with the same honesty as subreddit listings (video posts in; images/self-text/galleries honestly dropped).`,
  ),

  // ---- requires-auth (per-user grants; the app-only vs per-user seam) ---

  "identity.me": requiresAuth(
    `The authorized user's own identity via GET ${REDDIT_API_BASE}/api/v1/me (documented "Returns the identity of the user"; identity scope) — REQUIRES a per-user token: an app-only token has no user identity, and this row is the per-user side of the app-only vs per-user distinction (fixture-tested both ways).`,
  ),
  "subreddits.mine": requiresAuth(
    `The authorized user's subreddit subscriptions via GET ${REDDIT_API_BASE}/subreddits/mine/subscriber (documented mysubreddits listing; mysubreddits scope) — per-user token required.`,
  ),

  // ---- supported account rows (fixture-tested on the shared seams) ------

  "oauth.connect": supported(
    `Per-user OAuth 2.0 code flow on the shared CredentialPort / OAuthAccountStore seams: authorize at ${REDDIT_AUTHORIZE_URL}?client_id&response_type=code&state&redirect_uri&duration=permanent&scope=<SPACE-separated list> (the OAuth2 wiki documents space-separated scopes — a deliberate deviation from the OAuth spec the wiki itself calls out — and duration=permanent as the way to receive a refresh_token; all bearer tokens expire after one hour), then exchange the code at ${REDDIT_TOKEN_URL} with HTTP Basic auth (client_id:client_secret — the wiki: "You must supply your OAuth2 client's credentials via HTTP Basic Auth"). Installed-app type (the wiki's App Types page: desktop apps that cannot keep a secret safe; the operator registers the redirect URI). OPERATOR ITEM, honestly lower-friction than Meta's chain: reddit.com/prefs/apps is SELF-SERVE app creation — no app review, no business verification; the operator creates the app, fills in the client_id/secret, and sets the descriptive User-Agent (the Data API Wiki's format <platform>:<app ID>:<version string> (by /u/<username>) and its rule "NEVER lie about your User-Agent").`,
  ),
  "oauth.refresh": supported(
    `Access-token refresh via POST ${REDDIT_TOKEN_URL} grant_type=refresh_token&refresh_token=… (Basic auth; the wiki: use the refresh token "to acquire a new bearer token after your current token expires" — permanent-duration grants only; app-only tokens NEVER receive a refresh token, an honest asymmetry the session models by re-requesting instead).`,
  ),
  "oauth.app-only": supported(
    `App-only (user-less) token via POST ${REDDIT_TOKEN_URL} grant_type=client_credentials (Basic auth) — the OAuth2 wiki's documented "Application Only" flow for confidential clients; the Reddit-specific alternative grant https://oauth.reddit.com/grants/installed_client with a device_id exists for installed apps acting for logged-out users (recorded in the parity matrix; client_credentials is the flow this connector uses). App-only tokens carry no user identity — the app-only vs per-user distinction is structural and fixture-tested both ways.`,
  ),
  "oauth.disconnect": supported(
    `Disconnect with an OFFICIAL revocation call: POST ${REDDIT_REVOKE_URL} with token + token_type_hint (Basic auth) — the OAuth2 wiki's "revoking tokens" section ("When a client is completely done with a token, it can POST to the following URL to permanently revoke the token"; "Revoking a refresh token will also revoke any related access tokens!"). Live-verified 2026-10-11: the endpoint answered a dummy-Basic probe with the verbatim JSON 401 {"message":"Unauthorized","error":401} — reachable, not egress-blocked like the web surfaces. A FAILED revoke leaves the local record intact and retryable (the Twitch/Instagram precedent); vault-side tokens are destroyed only after the provider confirms.`,
  ),

  // ---- supported watch path (the official embed — ON by default) --------

  "playback.embed": supported(
    `Official Reddit media playback via the embed surface ${REDDIT_EMBED_BASE}/comments/<post-id> — the same surface the official widgets.js embed mechanism targets (live-verified 2026-10-11: widgets.js 200; the /comments/<id> shortlink shape answered 200 BOTH direct and iframe-context with CSP frame-ancestors * — explicitly frameable, contrast Instagram's conditional x-frame-options; the legacy www.redditmedia.com/mediaembed/<id> surface answered 404 even for a live post id — retired). The canonical post URL embeds the post (title + media + comment context); the widget's own iframe carries width 640, sandbox allow-scripts allow-same-origin allow-popups, and postMessage-driven height resize — recorded in the embedSpec notes honestly. ON BY DEFAULT: unlike Instagram's app-review-gated oEmbed, this share-embed surface carries no developer gate — the honest default is the official-embed plan, never an unavailable stub (see ./playback).`,
  ),

  // ---- later-phase pending rows (documented write APIs — NOT unsupported)

  "vote.cast": unavailable(
    `LATER-PHASE (not unsupported): POST /api/vote is fully documented on dev/api ("Cast a vote on a thing… Voting 1 is an upvote, -1 a downvote, and 0 is equivalent to un-voting") and the vote scope exists — but this order ships READS ONLY, so WebFlix neither implements the write nor requests the write scope. Voting lives in the official app/site; the row stays honestly pending, never silently "supported".`,
  ),
  "save.toggle": unavailable(
    `LATER-PHASE (not unsupported): POST /api/save + /api/unsave documented (save scope; "Saved things are kept in the user's saved listing"). Reads-only order — pending row.`,
  ),
  "comment.create": unavailable(
    `LATER-PHASE (not unsupported): POST /api/comment documented ("Submit a new comment or reply to a message"). Reads-only order — pending row; WebFlix's comment context is read-only viewing.`,
  ),
  "post.submit": unavailable(
    `LATER-PHASE (not unsupported): POST /api/submit documented (submit scope). Reads-only order — pending row.`,
  ),
  "message.compose": unavailable(
    `LATER-PHASE (not unsupported): POST /api/compose documented (privatemessages scope). Reads-only order — pending row.`,
  ),
  "subscribe.toggle": unavailable(
    `LATER-PHASE (not unsupported): POST /api/subscribe documented (subscribe scope). Reads-only order — pending row.`,
  ),
  "messages.list": unavailable(
    `LATER-PHASE (not unsupported): GET /message/<where> is the documented classic private-messages listing (privatemessages scope; inbox/unread/sent) — a real API, but a per-user message surface outside this order's media read scope. Pending row; the newer CHAT system is a separate honestly-unsupported row (chat.list).`,
  ),
  "activity.mine": unavailable(
    `LATER-PHASE (not unsupported): the documented history-scope listings of the user's own activity (GET /user/<me>/upvoted, /saved, etc.) are per-user reads outside this order's scope. WebFlix's own watch history is the local substitute (WebFlix-owned data, never provider data).`,
  ),

  // ---- honest-unsupported (no public read API / gated out of reach) -----

  "chat.list": unsupported(
    `The Reddit CHAT system has NO public REST read API: the official dev/api reference documents the classic private messages (GET /message/<where>, POST /api/compose — the messages.list pending row above) but no chat endpoints; the Data API Wiki references chat only as Bot-API rate limits ("2,000 messages per day per recipient… Bot API users can join up to 300 chat rooms per day") without public REST docs. Honest state: unsupported — chats live in the official app; never scraped.`,
  ),
  "live.browse": unsupported(
    `Two facts, both cited: (1) dev/api documents LIVE THREADS (GET /api/live/by_id, GET /live/<thread>, GET /api/live/happening_now) — but those are TEXT update threads (the reference's own LiveUpdate shapes), not a watchable video surface; (2) no video live-stream read is documented on the official reference (the RPAN video-live surface was discontinued — the audit's platform row carries no live capability). No video-live row is invented; live text threads are out of WebFlix's media scope.`,
  ),
  "moderation.manage": unsupported(
    `Moderation surfaces are documented but GATED: the modmail API (GET /api/mod/conversations), mod notes, removals and the mod* scopes require moderator credentials on the target subreddit — an operator/moderator surface, not a consumer connector read. Unsupported for this connector with the citation; never driven with consumer grants.`,
  ),
  "video.download": unsupported(
    `No official download API exists. The post payload's own media fields (reddit_video.fallback_url / dash_url / hls_url) are the provider's PLAYBACK sources for its official player — the Data API Terms restrict use of Data API content, and WebFlix is a media client: it EMBEDS the official surface (playback.embed above) and downloads nothing. Handoff: saving media is not offered; the post lives at its permalink.`,
  ),
};

/** The frozen §2.3 manifest for the Reddit connector. */
export const redditManifest: ConnectorManifest = {
  providerId: REDDIT_PROVIDER_ID,
  operations: { ...REDDIT_OPERATIONS },
  regions: [],
  quotas: {
    requestsPerWindow: REDDIT_DOCUMENTED_QPM,
    windowMs: REDDIT_RATE_WINDOW_MS,
  },
  provenance: {
    connectorId: REDDIT_PROVIDER_ID,
    connectorVersion: REDDIT_MANIFEST_VERSION,
    generatedAt: "2026-10-11T00:00:00.000Z",
    inputsHash: "reddit-connect-phase3-platform-4",
  },
  failureModes: ["network", "timeout", "auth", "rate-limit", "parse", "upstream", "unknown"],
};
