/**
 * Honest-unsupported rows → WebFlix-local substitutes (TIKTOK-CONNECT scope
 * row 4) — the same rules and discipline as YouTube's substitutes.ts
 * (YOUTUBE-EXPAND precedent):
 *
 *   - an unsupported TikTok capability is NEVER faked, proxied, or scraped;
 *   - where WebFlix has an OWN-store substitute (local history, local
 *     library/collections), the substitute lives in WebFlix's own stores —
 *     it is never presented as provider data;
 *   - where no compliant substitute exists, the row says so and hands the
 *     user off to the official TikTok app/site (the only compliant path);
 *   - this map is connector-local documentation data (same pattern as
 *     TIKTOK_OPERATION_PROVENANCE — the frozen §2.3 shape has no substitute
 *     field; the structural gap rides the MR-FD3 freeze-deviation queue).
 */
import { TIKTOK_OPERATIONS } from "./manifest";

/** Where a substitute lives, when one exists. */
export type TikTokLocalSubstitute = "webflix-local-history" | "webflix-local-library" | "none";

export interface TikTokUnsupportedOperationSubstitute {
  /** Manifest operation id (must be an unsupported row). */
  readonly operationId: string;
  /** The WebFlix-owned substitute surface, or "none" when handoff is the only path. */
  readonly substitute: TikTokLocalSubstitute;
  /** What WebFlix honestly does locally (never provider data). */
  readonly substituteNote: string;
  /** The compliant path when the official app/site is the only way. */
  readonly handoffNote: string;
}

export const TIKTOK_UNSUPPORTED_SUBSTITUTES: readonly TikTokUnsupportedOperationSubstitute[] = [
  {
    operationId: "search.query",
    substitute: "none",
    substituteNote:
      "TikTok has no public search API, so WebFlix offers no TikTok keyword search. The compliant discovery path inside WebFlix is paste-a-link: a canonical video URL resolves through the official oEmbed endpoint into a catalog item (oembed.resolve) — an official surface, not a substitute for search.",
    handoffNote: "TikTok keyword search lives in the official app/site search box.",
  },
  {
    operationId: "feed.for-you",
    substitute: "webflix-local-library",
    substituteNote:
      "The WebFlix home screen is WebFlix's own: local library, collections and continue-watching. It is never dressed up as a For You feed (no official API exists; the feed exists only in first-party surfaces).",
    handoffNote: "The For You feed lives in the official TikTok app/site.",
  },
  {
    operationId: "feed.following",
    substitute: "webflix-local-library",
    substituteNote:
      "No official API returns videos from accounts you follow (video.list covers your OWN videos only). WebFlix offers local collections you curate yourself — never presented as a Following feed.",
    handoffNote: "The Following feed lives in the official TikTok app/site.",
  },
  {
    operationId: "comments.list",
    substitute: "none",
    substituteNote:
      "No public API reads TikTok comments (Display API statistics expose counts, not comment text). WebFlix shows nothing rather than scrape.",
    handoffNote: "Comments live in the official app/site under each video.",
  },
  {
    operationId: "messages.list",
    substitute: "none",
    substituteNote:
      "Direct messages are a private first-party surface with no public API; WebFlix never touches DMs.",
    handoffNote: "DMs live in the official TikTok app/site Inbox.",
  },
  {
    operationId: "live.browse",
    substitute: "none",
    substituteNote:
      "No public API lists TikTok LIVE streams for viewers; WebFlix shows no LIVE surface rather than fabricate one.",
    handoffNote: "LIVE content lives in the official app/site (LIVE tab).",
  },
  {
    operationId: "notifications.list",
    substitute: "none",
    substituteNote:
      "No official endpoint exposes the TikTok notification inbox. WebFlix shows no notification surface rather than fabricate one.",
    handoffNote: "Notifications live in the official app/site (Inbox → Activities).",
  },
  {
    operationId: "search.suggestions",
    substitute: "none",
    substituteNote:
      "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no TikTok suggestions.",
    handoffNote: "Search suggestions live in the official TikTok search box.",
  },
  {
    operationId: "trends.browse",
    substitute: "none",
    substituteNote:
      "Trend/hashtag discovery has no public API; the Research and Commercial Content APIs are gated (approved access) Phase-5 surfaces, recorded as pending rows in the parity matrix — not substitutes.",
    handoffNote: "Trends and hashtags live in the official app/site (Discover/Explore).",
  },
  {
    operationId: "history.provider",
    substitute: "webflix-local-history",
    substituteNote:
      "WebFlix keeps its OWN watch history — WebFlix-owned PlaybackProgress records for items you played in WebFlix. It never reads or writes your TikTok watch history (no official API exists for it).",
    handoffNote:
      "Your full TikTok watch history lives in the official app: Profile → Menu → Watch history.",
  },
  {
    operationId: "profile.browse-public",
    substitute: "none",
    substituteNote:
      "No public API browses arbitrary TikTok profiles; user.info returns the authorized account's own profile only. WebFlix shows other users' profiles only as the author attribution on items their videos produced (oEmbed author fields) — never a scraped profile page.",
    handoffNote: "Public profiles live in the official app/site.",
  },
  {
    operationId: "video.download",
    substitute: "none",
    substituteNote:
      "Downloading TikTok videos outside official surfaces is out of scope by policy (work-order non-goal; ADR-0003). WebFlix's local library is for user-owned/local content only; no TikTok downloader exists here.",
    handoffNote:
      "The official in-app download (subject to the creator's download setting) is the sanctioned path.",
  },
];

/** Substitute row for one unsupported operation, or null when unknown. */
export function tikTokSubstituteFor(
  operationId: string,
): TikTokUnsupportedOperationSubstitute | null {
  return TIKTOK_UNSUPPORTED_SUBSTITUTES.find((row) => row.operationId === operationId) ?? null;
}

/**
 * Totality check: every "unsupported" manifest row must carry a substitute
 * row here (a missing substitute would leave the UI nothing honest to say),
 * and no substitute row may point at a non-unsupported operation. Throws
 * with the offending ids. Used by tests and app-side sanity checks.
 */
export function assertTikTokSubstitutesCoverManifest(): void {
  const unsupportedIds = Object.entries(TIKTOK_OPERATIONS)
    .filter(([, capability]) => capability.status === "unsupported")
    .map(([id]) => id);
  const covered = new Set(TIKTOK_UNSUPPORTED_SUBSTITUTES.map((row) => row.operationId));
  const missing = unsupportedIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(
      `honest-unsupported tiktok rows without a substitute/handoff entry: ${missing.join(", ")}`,
    );
  }
  const extra = TIKTOK_UNSUPPORTED_SUBSTITUTES.filter(
    (row) => TIKTOK_OPERATIONS[row.operationId]?.status !== "unsupported",
  ).map((row) => row.operationId);
  if (extra.length > 0) {
    throw new Error(
      `tiktok substitute rows that do not match an unsupported manifest row: ${extra.join(", ")}`,
    );
  }
}
