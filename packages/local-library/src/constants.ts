/** Name of the SQLite database file inside the WebFlix data root. */
export const DB_FILENAME = 'webflix.db';

/** Provider metadata cache entries older than this are refreshed or deleted by the TTL sweep (30 days). */
export const PROVIDER_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
