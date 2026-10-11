/**
 * YouTube ConnectorManifest — seeded from docs/plans/audits/AUDIT-SOURCES.md
 * §2 (official surfaces inventory) and §8 (honest-unsupported list).
 *
 * §2.3 reconciliation (MIRROR-RECON, 2026-10-11): this manifest originally
 * spoke a lane-local shape (displayName/manifestVersion/policy/officialSurfaces/
 * requiresOAuth/scopes/quota{currency,referenceCosts}/operations-as-array with
 * per-row category/summary/mechanism/quotaCost/reasonUnsupported/provenance).
 * The FROZEN §2.3 ConnectorManifest is:
 *   { providerId, operations: Record<OperationId, OperationCapability>,
 *     regions, quotas: ConnectorQuotas, provenance: Provenance, failureModes }
 * with OperationCapability = { status, detail?, checkedAt? }.
 *
 * Field map (mirror → frozen §2.3):
 *   status "supported-official" → "supported"
 *   status "unsupported"        → "unsupported" (unchanged)
 *   mechanism / reasonUnsupported → OperationCapability.detail (the human-
 *     readable explanation: official mechanism for supported rows, the honest
 *     reason for unsupported rows)
 *   manifestVersion             → provenance.connectorVersion
 *   quota.defaultDailyLimit     → quotas.{requestsPerWindow, windowMs} as the
 *     request-envelope approximation of the official units model: 100
 *     search-class calls per 86,400,000ms day (10,000 units/day at the
 *     official 100 units per search.list — the dominant, binding cost)
 *   checkedAt                   → omitted (fixture-only build; no capability
 *     has been live-probed — an honest absence, never a fabricated timestamp)
 *
 * Mirror data with NO frozen home is preserved as package-level exports
 * (never re-forked as contract types): YOUTUBE_DISPLAY_NAME,
 * YOUTUBE_OFFICIAL_SURFACES, YOUTUBE_OAUTH_SCOPES, the unit-cost constants,
 * and the per-operation provenance citations
 * (YOUTUBE_OPERATION_PROVENANCE). The structural gaps are filed as
 * freeze-deviation proposals MR-FD2/MR-FD3 for TL2.
 *
 * ADR-0003: official surfaces ONLY. Supported rows cite the exact official
 * Google docs page that defines the mechanism and its quota cost; unsupported
 * rows carry an honest reason with citation. This connector never fakes,
 * scrapes, or reverse-engineers a surface.
 *
 * Official quota model (getting-started#quota + determine_quota_cost):
 *   - default project budget: 10,000 units/day
 *   - search.list: 100 units per call
 *   - typical list (read) calls: 1 unit
 *   - typical write calls: 50 units (this connector performs reads only)
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

export const YOUTUBE_PROVIDER_ID = "youtube";
export const YOUTUBE_DISPLAY_NAME = "YouTube";
export const YOUTUBE_MANIFEST_VERSION = "1.0.0";

export const YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS = 10_000;
export const YOUTUBE_SEARCH_LIST_COST = 100;
export const YOUTUBE_READ_COST = 1;
export const YOUTUBE_WRITE_COST = 50;

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/** One day in ms — the official quota window. */
export const YOUTUBE_QUOTA_WINDOW_MS = 86_400_000;
/** Search-class calls per day under the official default budget (10,000 / 100). */
export const YOUTUBE_SEARCH_CALLS_PER_DAY =
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS / YOUTUBE_SEARCH_LIST_COST;

export const YOUTUBE_OFFICIAL_SURFACES: readonly string[] = [
  YOUTUBE_API_BASE,
  "https://accounts.google.com/o/oauth2/v2/auth",
  "https://oauth2.googleapis.com/token",
  "https://oauth2.googleapis.com/revoke",
  "https://www.youtube.com/embed/",
  "https://www.youtube-nocookie.com/embed/",
];

export const YOUTUBE_OAUTH_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/youtube.readonly",
];

// ---------------------------------------------------------------------------
// Provenance citations (official sources; the audit doc is cited for the
// honest-unsupported determinations themselves). Connector-local documentation
// data — the frozen §2.3 shape has no per-operation citation field (MR-FD3);
// keeping it here preserves the audit trail without forking contract types.
// ---------------------------------------------------------------------------

export interface ProvenanceNote {
  label: string;
  url: string;
}

const AUDIT_SOURCES_CITATION: ProvenanceNote = {
  label:
    "docs/plans/audits/AUDIT-SOURCES.md §2/§8 — official-source audit and honest-unsupported list",
  url: "docs/plans/audits/AUDIT-SOURCES.md",
};
const QUOTA_COST_DOC: ProvenanceNote = {
  label: "YouTube Data API quota cost calculator (official)",
  url: "https://developers.google.com/youtube/v3/determine_quota_cost",
};
const DOC_SEARCH: ProvenanceNote = {
  label: "search.list — official reference",
  url: "https://developers.google.com/youtube/v3/docs/search/list",
};
const DOC_VIDEOS: ProvenanceNote = {
  label: "videos.list — official reference",
  url: "https://developers.google.com/youtube/v3/docs/videos/list",
};
const DOC_CHANNELS: ProvenanceNote = {
  label: "channels.list — official reference",
  url: "https://developers.google.com/youtube/v3/docs/channels/list",
};
const DOC_PLAYLISTS: ProvenanceNote = {
  label: "playlists.list — official reference",
  url: "https://developers.google.com/youtube/v3/docs/playlists/list",
};
const DOC_PLAYLIST_ITEMS: ProvenanceNote = {
  label: "playlistItems.list — official reference",
  url: "https://developers.google.com/youtube/v3/docs/playlistItems/list",
};
const DOC_API_INDEX: ProvenanceNote = {
  label: "YouTube Data API v3 reference index (official; absence of a surface is verifiable here)",
  url: "https://developers.google.com/youtube/v3/docs",
};
const DOC_REVISIONS: ProvenanceNote = {
  label: "YouTube Data API revision history (official; relatedToVideoId removal)",
  url: "https://developers.google.com/youtube/v3/revisions",
};

/** Official unit cost per operation (the frozen quotas envelope is request-based — MR-FD2). */
export const YOUTUBE_OPERATION_COSTS: Readonly<Record<string, number>> = {
  "search.list": YOUTUBE_SEARCH_LIST_COST,
  "videos.list": YOUTUBE_READ_COST,
  "channels.list": YOUTUBE_READ_COST,
  "playlists.list": YOUTUBE_READ_COST,
  "playlistItems.list": YOUTUBE_READ_COST,
};

/** Per-operation provenance citations (audit trail; MR-FD3). */
export const YOUTUBE_OPERATION_PROVENANCE: Readonly<Record<string, readonly ProvenanceNote[]>> = {
  "search.list": [DOC_SEARCH, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  "videos.list": [DOC_VIDEOS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  "channels.list": [DOC_CHANNELS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  "playlists.list": [DOC_PLAYLISTS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  "playlistItems.list": [DOC_PLAYLIST_ITEMS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  history: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  notifications: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  related: [DOC_REVISIONS, DOC_SEARCH, AUDIT_SOURCES_CITATION],
  community: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  memberships: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  superchat: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  premiere: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  "search-suggestions": [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  "home-feed": [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
};

// ---------------------------------------------------------------------------
// Per-operation capability rows (frozen §2.3: Record<OperationId,
// {status, detail?, checkedAt?}>)
// ---------------------------------------------------------------------------

function supported(mechanism: string): OperationCapability {
  return { status: "supported", detail: mechanism };
}

function unsupported(reason: string): OperationCapability {
  return { status: "unsupported", detail: reason };
}

export const YOUTUBE_OPERATIONS: Readonly<Record<string, OperationCapability>> = {
  // ---- supported (browse / search / metadata) -------------------------------

  "search.list": supported(
    `Keyword search across videos, channels, and playlists. YouTube Data API v3 search.list (GET ${YOUTUBE_API_BASE}/search).`,
  ),
  "videos.list": supported(
    `Video metadata (title, description, duration, statistics) for known video ids, and trending browse via chart=mostPopular (region/category selectable). YouTube Data API v3 videos.list (GET ${YOUTUBE_API_BASE}/videos).`,
  ),
  "channels.list": supported(
    `Channel metadata, including the authorized account via mine=true. YouTube Data API v3 channels.list (GET ${YOUTUBE_API_BASE}/channels).`,
  ),
  "playlists.list": supported(
    `Browse a channel's public playlists. YouTube Data API v3 playlists.list (GET ${YOUTUBE_API_BASE}/playlists).`,
  ),
  "playlistItems.list": supported(
    `Browse the contents of a playlist (including a channel uploads playlist). YouTube Data API v3 playlistItems.list (GET ${YOUTUBE_API_BASE}/playlistItems).`,
  ),

  // ---- honest-unsupported (AUDIT-SOURCES §8) -------------------------------

  history: unsupported(
    "No official API returns watch history; the Data API reference has no watch-history resource. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  notifications: unsupported(
    "No official endpoint exposes the notification inbox; activities.list covers public upload/event activity, not notifications. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  related: unsupported(
    "search.list's relatedToVideoId parameter was removed from the official API (revision history); no official replacement exists. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  community: unsupported(
    "Community posts have no official read endpoint; commentThreads.list covers video comments only. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  memberships: unsupported(
    "No official endpoint returns Memberships tab content for a viewer; member data in the official API is owner-scoped. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  superchat: unsupported(
    "AUDIT-SOURCES §8 lists Super Chat event feeds as honest-unsupported for WebFlix; the connector requests no scope or surface that could return them.",
  ),
  premiere: unsupported(
    "No official first-class premiere endpoint exists for readers; liveBroadcasts.list does not model premieres as a browsable event feed. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  "search-suggestions": unsupported(
    "Autocomplete has no official API; the suggest endpoints are undocumented internal surfaces and are excluded by ADR-0003. AUDIT-SOURCES §8: honest-unsupported.",
  ),
  "home-feed": unsupported(
    "The home/recommendations feed has no official API; it exists only in first-party surfaces. AUDIT-SOURCES §8: honest-unsupported.",
  ),
};

// ---------------------------------------------------------------------------
// Manifest (frozen §2.3 shape)
// ---------------------------------------------------------------------------

export const youtubeManifest: ConnectorManifest = {
  providerId: YOUTUBE_PROVIDER_ID,
  operations: YOUTUBE_OPERATIONS,
  // Fixture-only build: no region set is claimed (the official API is served
  // globally; no region gating has been probed — an honest empty list).
  regions: [],
  // Request-envelope view of the official quota model: 100 search-class
  // calls/day at the 10,000-units/day default (search.list = 100 units is the
  // binding cost). The precise per-operation unit model stays in
  // YOUTUBE_OPERATION_COSTS + the dataApi ledger (MR-FD2).
  quotas: {
    requestsPerWindow: YOUTUBE_SEARCH_CALLS_PER_DAY,
    windowMs: YOUTUBE_QUOTA_WINDOW_MS,
  },
  provenance: {
    connectorId: YOUTUBE_PROVIDER_ID,
    connectorVersion: YOUTUBE_MANIFEST_VERSION,
    // Constant seed artifact: the manifest was generated at the contract
    // freeze (fixture-only; live probing is pending-operator-credential).
    generatedAt: "2026-10-09T00:00:00Z",
  },
  // Failure modes the dataApi client knows it can hit (its typed error
  // taxonomy): network, timeout, auth, rate-limit, parse, upstream.
  failureModes: ["network", "timeout", "auth", "rate-limit", "parse", "upstream"],
};
