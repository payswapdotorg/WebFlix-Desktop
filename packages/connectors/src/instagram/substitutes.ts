/**
 * Honest-unsupported rows → WebFlix-local substitutes (INSTAGRAM-CONNECT
 * scope row 4) — the same rules and discipline as the YouTube/TikTok/Twitch
 * substitutes modules (YOUTUBE-EXPAND precedent):
 *
 *   - an unsupported Instagram capability is NEVER faked, proxied, or
 *     scraped — the work order's non-goal is explicit: "No scraping
 *     substitutes for removed discovery APIs (the honest state IS the
 *     deliverable)";
 *   - where WebFlix has an OWN-store substitute (local history, local
 *     library/collections), the substitute lives in WebFlix's own stores —
 *     it is never presented as provider data;
 *   - where no compliant substitute exists, the row says so and hands the
 *     user off to the official Instagram app/site (the only compliant path);
 *   - this map is connector-local documentation data (same pattern as
 *     INSTAGRAM_OPERATION_PROVENANCE — the frozen §2.3 shape has no
 *     substitute field; the structural gap rides the MR-FD3
 *     freeze-deviation queue).
 */
import { INSTAGRAM_OPERATIONS } from "./manifest";

/** Where a substitute lives, when one exists. */
export type InstagramLocalSubstitute = "webflix-local-history" | "webflix-local-library" | "none";

export interface InstagramUnsupportedOperationSubstitute {
  /** Manifest operation id (must be an unsupported row). */
  readonly operationId: string;
  /** The WebFlix-owned substitute surface, or "none" when handoff is the only path. */
  readonly substitute: InstagramLocalSubstitute;
  /** What WebFlix honestly does locally (never provider data). */
  readonly substituteNote: string;
  /** The compliant path when the official app/site is the only way. */
  readonly handoffNote: string;
}

export const INSTAGRAM_UNSUPPORTED_SUBSTITUTES: readonly InstagramUnsupportedOperationSubstitute[] =
  [
    {
      operationId: "feed.home",
      substitute: "webflix-local-library",
      substituteNote:
        "No official API returns the Instagram home feed — it exists only in first-party surfaces. The WebFlix home screen is WebFlix's own: local library, collections and continue-watching. It is never dressed up as an Instagram feed.",
      handoffNote: "The home feed lives in the official Instagram app/site.",
    },
    {
      operationId: "explore.browse",
      substitute: "webflix-local-library",
      substituteNote:
        "No official Explore API exists. WebFlix's own browse surface is its local library and collections — the audit's verdict (discovery 'largely unavailable officially') is shown as-is, never papered over with a scraped Explore.",
      handoffNote: "Explore lives in the official Instagram app/site (Search & Explore).",
    },
    {
      operationId: "hashtags.search",
      substitute: "none",
      substituteNote:
        "Hashtag discovery is NOT offered: the audit records it as removed (2024) while the live docs still document it — either way only as an App-Review-gated operator surface (Instagram Public Content Access + instagram_basic; 30 unique hashtags per rolling 7 days; Facebook-Login variant only). It is a pending operator row in the parity matrix, never a consumer feature, and never scraped.",
      handoffNote: "Hashtag browsing lives in the official Instagram app/site (Tags tab).",
    },
    {
      operationId: "reels.browse",
      substitute: "webflix-local-library",
      substituteNote:
        "No public API browses other accounts' Reels. The authorized account's OWN reels do arrive through media.list (mapped to WebFlix's short-form kind) and can live in local collections — never presented as a Reels feed.",
      handoffNote: "The Reels feed lives in the official Instagram app/site (Reels tab).",
    },
    {
      operationId: "stories.read",
      substitute: "none",
      substituteNote:
        "The official /stories edge exists for the authorized account's own stories, but the oEmbed surface explicitly excludes Stories — there is no compliant playback path, so WebFlix offers no story surface at all rather than a read without a watch.",
      handoffNote: "Stories live in the official Instagram app/site (24-hour ephemeral).",
    },
    {
      operationId: "messages.list",
      substitute: "none",
      substituteNote:
        "Instagram messaging rides the Messenger Platform business APIs — a webhook-driven business surface. WebFlix never touches DMs.",
      handoffNote: "DMs live in the official Instagram app/site Inbox.",
    },
    {
      operationId: "notifications.list",
      substitute: "none",
      substituteNote:
        "No official endpoint exposes the Instagram notification inbox. WebFlix shows no notification surface rather than fabricate one.",
      handoffNote: "Notifications live in the official Instagram app/site (heart tab).",
    },
    {
      operationId: "comments.list",
      substitute: "none",
      substituteNote:
        "Comment reads/moderation exist officially but are a creator-side surface out of scope for this viewer app. WebFlix shows no comment pane rather than an unofficial one.",
      handoffNote: "Comments live in the official app/site under each post.",
    },
    {
      operationId: "publish.media",
      substitute: "none",
      substituteNote:
        "The Content Publishing API is a write surface behind instagram_content_publish + operator gating — a work-order non-goal recorded as pending only. WebFlix never uploads or publishes anything.",
      handoffNote: "Publishing lives in the official Instagram app/site (create flow).",
    },
    {
      operationId: "business-discovery.read",
      substitute: "none",
      substituteNote:
        "The business_discovery edge is a gated per-target read about other professional accounts — not a browse surface and out of scope this order (pending matrix row). WebFlix shows other users only as the owner attribution official payloads carry.",
      handoffNote: "Other accounts' profiles live in the official app/site.",
    },
    {
      operationId: "profile.browse-public",
      substitute: "none",
      substituteNote:
        "No official API browses arbitrary public profiles, and anonymous web profiles are login-walled (live-verified 302 → accounts/login). WebFlix never scrapes; the only profile surface is the authorized account's own profile read.",
      handoffNote: "Public profiles live in the official Instagram app/site.",
    },
    {
      operationId: "search.query",
      substitute: "none",
      substituteNote:
        "No public keyword search API exists for Instagram content. The compliant in-app discovery surface is the authorized account's own media (media.list); WebFlix offers no Instagram keyword search.",
      handoffNote: "Instagram keyword search lives in the official app/site search box.",
    },
    {
      operationId: "search.suggestions",
      substitute: "none",
      substituteNote:
        "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no Instagram suggestions.",
      handoffNote: "Search suggestions live in the official Instagram search box.",
    },
    {
      operationId: "history.provider",
      substitute: "webflix-local-history",
      substituteNote:
        "WebFlix keeps its OWN watch history — WebFlix-owned PlaybackProgress records for items played in WebFlix. It never reads or writes your Instagram activity (no official API exists for it).",
      handoffNote: "Your Instagram activity lives in the official app: Menu → Your activity.",
    },
    {
      operationId: "live.browse",
      substitute: "none",
      substituteNote:
        "No viewer-facing API browses Instagram LIVE (the live_media edge covers the authorized account's own live media during broadcast only). WebFlix shows no LIVE surface rather than fabricate one.",
      handoffNote: "LIVE content lives in the official Instagram app/site.",
    },
    {
      operationId: "basic-display.profile",
      substitute: "none",
      substituteNote:
        "The Basic Display API was deprecated December 4, 2024 — all requests return an error (changelog, verbatim). There is nothing to substitute: the current own-profile/own-media reads ride the Instagram Platform APIs (profile.read / media.list in the manifest).",
      handoffNote:
        "Own-profile reads for professional accounts are the supported path once the operator's app review completes.",
    },
    {
      operationId: "video.download",
      substitute: "none",
      substituteNote:
        "Downloading Instagram content outside official surfaces is out of scope by policy (ADR-0003; work-order non-goal). WebFlix's local library is for user-owned/local content only; no Instagram downloader exists here.",
      handoffNote:
        "The official in-app save (subject to the creator's settings) is the sanctioned path.",
    },
  ];

/** Substitute row for one unsupported operation, or null when unknown. */
export function instagramSubstituteFor(
  operationId: string,
): InstagramUnsupportedOperationSubstitute | null {
  return INSTAGRAM_UNSUPPORTED_SUBSTITUTES.find((row) => row.operationId === operationId) ?? null;
}

/**
 * Totality check: every "unsupported" manifest row must carry a substitute
 * row here (a missing substitute would leave the UI nothing honest to say),
 * and no substitute row may point at a non-unsupported operation. Throws
 * with the offending ids. Used by tests and app-side sanity checks.
 */
export function assertInstagramSubstitutesCoverManifest(): void {
  const unsupportedIds = Object.entries(INSTAGRAM_OPERATIONS)
    .filter(([, capability]) => capability.status === "unsupported")
    .map(([id]) => id);
  const covered = new Set(INSTAGRAM_UNSUPPORTED_SUBSTITUTES.map((row) => row.operationId));
  const missing = unsupportedIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(
      `honest-unsupported instagram rows without a substitute/handoff entry: ${missing.join(", ")}`,
    );
  }
  const extra = INSTAGRAM_UNSUPPORTED_SUBSTITUTES.filter(
    (row) => INSTAGRAM_OPERATIONS[row.operationId]?.status !== "unsupported",
  ).map((row) => row.operationId);
  if (extra.length > 0) {
    throw new Error(
      `instagram substitute rows that do not match an unsupported manifest row: ${extra.join(", ")}`,
    );
  }
}
