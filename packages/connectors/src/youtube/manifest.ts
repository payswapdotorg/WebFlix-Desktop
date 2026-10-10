/**
 * YouTube ConnectorManifest — seeded from docs/plans/audits/AUDIT-SOURCES.md
 * §2 (official surfaces inventory) and §8 (honest-unsupported list).
 *
 * ADR-0003: official surfaces ONLY. Supported rows cite the exact official
 * Google docs page that defines the mechanism and its quota cost; unsupported
 * rows carry mechanism=null, quotaCost=0, an honest reason, and a citation.
 * This connector never fakes, scrapes, or reverse-engineers a surface.
 *
 * Official quota model (getting-started#quota + determine_quota_cost):
 *   - default project budget: 10,000 units/day
 *   - search.list: 100 units per call
 *   - typical list (read) calls: 1 unit
 *   - typical write calls: 50 units (this connector performs reads only)
 */
import type {
  ConnectorManifest,
  OperationCapability,
  ProvenanceCitation,
} from '../contract-types';

export const YOUTUBE_PROVIDER_ID = 'youtube';
export const YOUTUBE_DISPLAY_NAME = 'YouTube';
export const YOUTUBE_MANIFEST_VERSION = '1.0.0';

export const YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS = 10_000;
export const YOUTUBE_SEARCH_LIST_COST = 100;
export const YOUTUBE_READ_COST = 1;
export const YOUTUBE_WRITE_COST = 50;

export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

export const YOUTUBE_OFFICIAL_SURFACES: readonly string[] = [
  YOUTUBE_API_BASE,
  'https://accounts.google.com/o/oauth2/v2/auth',
  'https://oauth2.googleapis.com/token',
  'https://oauth2.googleapis.com/revoke',
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
];

export const YOUTUBE_OAUTH_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/youtube.readonly',
];

// ---------------------------------------------------------------------------
// Provenance citations (official sources; the audit doc is cited for the
// honest-unsupported determinations themselves)
// ---------------------------------------------------------------------------

const AUDIT_SOURCES_CITATION: ProvenanceCitation = {
  label: 'docs/plans/audits/AUDIT-SOURCES.md §2/§8 — official-source audit and honest-unsupported list',
  url: 'docs/plans/audits/AUDIT-SOURCES.md',
};
const QUOTA_DOC: ProvenanceCitation = {
  label: 'YouTube Data API quota & cost — getting started (official)',
  url: 'https://developers.google.com/youtube/v3/getting-started#quota',
};
const QUOTA_COST_DOC: ProvenanceCitation = {
  label: 'YouTube Data API quota cost calculator (official)',
  url: 'https://developers.google.com/youtube/v3/determine_quota_cost',
};
const DOC_SEARCH: ProvenanceCitation = {
  label: 'search.list — official reference',
  url: 'https://developers.google.com/youtube/v3/docs/search/list',
};
const DOC_VIDEOS: ProvenanceCitation = {
  label: 'videos.list — official reference',
  url: 'https://developers.google.com/youtube/v3/docs/videos/list',
};
const DOC_CHANNELS: ProvenanceCitation = {
  label: 'channels.list — official reference',
  url: 'https://developers.google.com/youtube/v3/docs/channels/list',
};
const DOC_PLAYLISTS: ProvenanceCitation = {
  label: 'playlists.list — official reference',
  url: 'https://developers.google.com/youtube/v3/docs/playlists/list',
};
const DOC_PLAYLIST_ITEMS: ProvenanceCitation = {
  label: 'playlistItems.list — official reference',
  url: 'https://developers.google.com/youtube/v3/docs/playlistItems/list',
};
const DOC_API_INDEX: ProvenanceCitation = {
  label: 'YouTube Data API v3 reference index (official; absence of a surface is verifiable here)',
  url: 'https://developers.google.com/youtube/v3/docs',
};
const DOC_REVISIONS: ProvenanceCitation = {
  label: 'YouTube Data API revision history (official; relatedToVideoId removal)',
  url: 'https://developers.google.com/youtube/v3/revisions',
};

// ---------------------------------------------------------------------------
// Per-operation capability rows
// ---------------------------------------------------------------------------

export const YOUTUBE_OPERATIONS: OperationCapability[] = [
  // ---- supported-official (browse / search / metadata) ---------------------

  {
    operationId: 'search.list',
    category: 'search',
    summary: 'Keyword search across videos, channels, and playlists.',
    status: 'supported-official',
    mechanism: `YouTube Data API v3 search.list (GET ${YOUTUBE_API_BASE}/search)`,
    quotaCost: YOUTUBE_SEARCH_LIST_COST,
    reasonUnsupported: null,
    provenance: [DOC_SEARCH, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'videos.list',
    category: 'metadata',
    summary: 'Video metadata (title, description, duration, statistics) for known video ids.',
    status: 'supported-official',
    mechanism: `YouTube Data API v3 videos.list (GET ${YOUTUBE_API_BASE}/videos)`,
    quotaCost: YOUTUBE_READ_COST,
    reasonUnsupported: null,
    provenance: [DOC_VIDEOS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'channels.list',
    category: 'metadata',
    summary: 'Channel metadata, including the authorized account via mine=true.',
    status: 'supported-official',
    mechanism: `YouTube Data API v3 channels.list (GET ${YOUTUBE_API_BASE}/channels)`,
    quotaCost: YOUTUBE_READ_COST,
    reasonUnsupported: null,
    provenance: [DOC_CHANNELS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'playlists.list',
    category: 'browse',
    summary: "Browse a channel's public playlists.",
    status: 'supported-official',
    mechanism: `YouTube Data API v3 playlists.list (GET ${YOUTUBE_API_BASE}/playlists)`,
    quotaCost: YOUTUBE_READ_COST,
    reasonUnsupported: null,
    provenance: [DOC_PLAYLISTS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'playlistItems.list',
    category: 'browse',
    summary: 'Browse the contents of a playlist (including a channel uploads playlist).',
    status: 'supported-official',
    mechanism: `YouTube Data API v3 playlistItems.list (GET ${YOUTUBE_API_BASE}/playlistItems)`,
    quotaCost: YOUTUBE_READ_COST,
    reasonUnsupported: null,
    provenance: [DOC_PLAYLIST_ITEMS, QUOTA_COST_DOC, AUDIT_SOURCES_CITATION],
  },

  // ---- honest-unsupported (AUDIT-SOURCES §8) -------------------------------

  {
    operationId: 'history',
    category: 'history',
    summary: "The signed-in user's watch-history feed.",
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'No official API returns watch history; the Data API reference has no watch-history resource. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'notifications',
    category: 'notifications',
    summary: "The signed-in user's notification (bell) inbox feed.",
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'No official endpoint exposes the notification inbox; activities.list covers public upload/event activity, not notifications. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'related',
    category: 'related',
    summary: 'A related-videos rail for a given video.',
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      "search.list's relatedToVideoId parameter was removed from the official API (revision history); no official replacement exists. AUDIT-SOURCES §8: honest-unsupported.",
    provenance: [DOC_REVISIONS, DOC_SEARCH, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'community',
    category: 'community',
    summary: 'A channel Community posts tab.',
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'Community posts have no official read endpoint; commentThreads.list covers video comments only. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'memberships',
    category: 'memberships',
    summary: "A channel's Memberships tab content (members-only posts and perks).",
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'No official endpoint returns Memberships tab content for a viewer; member data in the official API is owner-scoped. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'superchat',
    category: 'superchat',
    summary: 'Super Chat / Super Thanks event feeds.',
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'AUDIT-SOURCES §8 lists Super Chat event feeds as honest-unsupported for WebFlix; the connector requests no scope or surface that could return them.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'premiere',
    category: 'premiere',
    summary: 'Premiere scheduled events and premiere watch-page state.',
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'No official first-class premiere endpoint exists for readers; liveBroadcasts.list does not model premieres as a browsable event feed. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'search-suggestions',
    category: 'search-suggestions',
    summary: 'Search autocomplete / query suggestions.',
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'Autocomplete has no official API; the suggest endpoints are undocumented internal surfaces and are excluded by ADR-0003. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
  {
    operationId: 'home-feed',
    category: 'home-feed',
    summary: "The signed-in user's home recommendation feed.",
    status: 'unsupported',
    mechanism: null,
    quotaCost: 0,
    reasonUnsupported:
      'The home/recommendations feed has no official API; it exists only in first-party surfaces. AUDIT-SOURCES §8: honest-unsupported.',
    provenance: [DOC_API_INDEX, AUDIT_SOURCES_CITATION],
  },
];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const youtubeManifest: ConnectorManifest = {
  providerId: YOUTUBE_PROVIDER_ID,
  displayName: YOUTUBE_DISPLAY_NAME,
  manifestVersion: YOUTUBE_MANIFEST_VERSION,
  policy: { officialSurfacesOnly: true, adr: 'ADR-0003' },
  officialSurfaces: [...YOUTUBE_OFFICIAL_SURFACES],
  requiresOAuth: true,
  scopes: [...YOUTUBE_OAUTH_SCOPES],
  quota: {
    currency: 'youtube-data-api-units',
    defaultDailyLimit: YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
    referenceCosts: {
      read: YOUTUBE_READ_COST,
      write: YOUTUBE_WRITE_COST,
      searchList: YOUTUBE_SEARCH_LIST_COST,
    },
    notes: [
      'Official default project budget is 10,000 units/day (getting-started#quota).',
      'search.list costs 100 units per call; typical list (read) calls cost 1 unit; typical write calls cost 50 units (determine_quota_cost).',
      'This connector performs reads only: it requests youtube.readonly and declares no write operations.',
    ],
  },
  operations: YOUTUBE_OPERATIONS,
  sources: { auditDoc: 'docs/plans/audits/AUDIT-SOURCES.md', sections: ['§2', '§8'] },
  notes: [
    'ADR-0003: official surfaces only — no scraping, no unofficial endpoints, no reverse engineering.',
    'Live smoke tests are pending-operator-credential; this package is fixture-tested only.',
    'Honest-unsupported rows mirror AUDIT-SOURCES.md §8 so product code cannot "discover" capability the provider never offered.',
  ],
};
