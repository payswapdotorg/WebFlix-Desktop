/**
 * P9-UI-1 (requirement 4) — official YouTube link recognition for the
 * WebFlix renderer host.
 *
 * YouTube-first (lock §2.2/§13): the first external-platform interface is
 * YouTube, and the ONLY reviewed provider operation mounted in this order
 * is the official IFrame embed (ADR-0003; connectors/src/youtube/playback.ts
 * — official player parameters, no stream extraction, no scraping, no
 * cookie replay, no private endpoints). This module recognizes ONLY
 * official YouTube link forms and bare 11-char video ids; anything else is
 * not a link and returns null (the caller then applies the honest
 * search-gate state — no results are ever invented).
 *
 * The 11-char id pattern is the connector's own frozen constant
 * (YOUTUBE_VIDEO_ID_PATTERN, imported by value below); the URL forms are
 * the official share/embed hosts (youtube.com, youtu.be, m.youtube.com,
 * youtube-nocookie.com — all in the connector's YOUTUBE_OFFICIAL_SURFACES).
 * PURE module — no DOM, no network.
 */
import { YOUTUBE_VIDEO_ID_PATTERN } from "../../../../../connectors/src/youtube/playback.js";

const OFFICIAL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * Recognized forms → the official 11-char video id:
 *   - bare id:            dQw4w9WgXcQ
 *   - watch:              https://www.youtube.com/watch?v=<id>
 *   - short share:        https://youtu.be/<id>
 *   - embed / shorts:     https://www.youtube.com/(embed|shorts|live)/<id>
 * Anything else (including non-official hosts and malformed ids) → null.
 */
export function parseYouTubeLinkId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  // Bare 11-char id (the connector's own frozen pattern).
  if (YOUTUBE_VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (!OFFICIAL_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const pathSegments = url.pathname.split("/").filter((segment) => segment !== "");
  const last = pathSegments[pathSegments.length - 1] ?? "";

  // youtu.be/<id>
  if (url.hostname.toLowerCase().endsWith("youtu.be")) {
    return YOUTUBE_VIDEO_ID_PATTERN.test(last) ? last : null;
  }

  // youtube.com/watch?v=<id>
  const watchV = url.searchParams.get("v");
  if (url.pathname === "/watch") {
    return watchV !== null && YOUTUBE_VIDEO_ID_PATTERN.test(watchV) ? watchV : null;
  }

  // youtube.com/(embed|shorts|live)/<id>
  if (pathSegments.length === 2 && ["embed", "shorts", "live"].includes(pathSegments[0])) {
    return YOUTUBE_VIDEO_ID_PATTERN.test(last) ? last : null;
  }

  return null;
}
