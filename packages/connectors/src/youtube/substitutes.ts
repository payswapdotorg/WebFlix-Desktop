/**
 * Honest-unsupported rows → WebFlix-local substitutes (YOUTUBE-EXPAND scope
 * row 4; AUDIT-SOURCES §2/§8).
 *
 * Rules encoded here (work order + ADR-0003 #6/#8):
 *   - an unsupported YouTube capability is NEVER faked, proxied, or scraped;
 *   - where WebFlix has an OWN-store substitute (local history, local
 *     library/collections), the substitute lives in WebFlix's own stores —
 *     it is never presented as provider data;
 *   - where no compliant substitute exists, the row says so and hands the
 *     user off to the official YouTube app/site (the only compliant path);
 *   - this map is connector-local documentation data (same pattern as
 *     YOUTUBE_OPERATION_PROVENANCE — the frozen §2.3 shape has no
 *     substitute field; structural gaps are the MR-FD3 freeze-deviation
 *     queue, not a reason to fork contract types).
 */
import { YOUTUBE_OPERATIONS } from "./manifest";

/** Where a substitute lives, when one exists. */
export type YouTubeLocalSubstitute = "webflix-local-history" | "webflix-local-library" | "none";

export interface UnsupportedOperationSubstitute {
  /** Manifest operation id (must be an unsupported row). */
  readonly operationId: string;
  /** The WebFlix-owned substitute surface, or "none" when handoff is the only path. */
  readonly substitute: YouTubeLocalSubstitute;
  /** What WebFlix honestly does locally (never provider data). */
  readonly substituteNote: string;
  /** The compliant path when the official app/site is the only way. */
  readonly handoffNote: string;
}

export const YOUTUBE_UNSUPPORTED_SUBSTITUTES: readonly UnsupportedOperationSubstitute[] = [
  {
    operationId: "history",
    substitute: "webflix-local-history",
    substituteNote:
      "WebFlix keeps its OWN watch history — WebFlix-owned PlaybackProgress records for items you played in WebFlix. It never reads or writes your YouTube watch history (no official API exists for it).",
    handoffNote:
      "Your full YouTube watch history lives in the official app/site: History → Manage all history.",
  },
  {
    operationId: "home-feed",
    substitute: "webflix-local-library",
    substituteNote:
      "The WebFlix home screen is WebFlix's own: your local library, collections and continue-watching shelf. It is never dressed up as a YouTube recommendations feed (no official API exists).",
    handoffNote: "YouTube's personalized home recommendations exist only in the official app/site.",
  },
  {
    operationId: "notifications",
    substitute: "none",
    substituteNote:
      "No substitute: WebFlix shows no notification surface rather than fabricate one from unofficial endpoints.",
    handoffNote: "Notifications live in the official YouTube app/site (bell icon).",
  },
  {
    operationId: "related",
    substitute: "none",
    substituteNote:
      "No related feed is fabricated: the official IFrame player's own end-screen is the only related-videos surface inside WebFlix (official player behavior is preserved, never replaced).",
    handoffNote:
      "For YouTube's related recommendations, use the official player end-screen or the video page on youtube.com.",
  },
  {
    operationId: "community",
    substitute: "none",
    substituteNote:
      "Community posts have no official read API; WebFlix shows nothing rather than scrape.",
    handoffNote: "Community posts live on the channel's Community tab in the official app/site.",
  },
  {
    operationId: "memberships",
    substitute: "none",
    substituteNote:
      "No official viewer-side Memberships API; WebFlix does not proxy member content.",
    handoffNote: "Memberships are managed in the official app/site (Join button on the channel).",
  },
  {
    operationId: "superchat",
    substitute: "none",
    substituteNote:
      "Super Chat events are not requested by any scope this connector asks for; no surface is shown.",
    handoffNote: "Super Chat lives in the official live chat on youtube.com.",
  },
  {
    operationId: "premiere",
    substitute: "none",
    substituteNote:
      "No official premiere-reminder API for viewers; WebFlix never fakes a reminder system.",
    handoffNote: "Premiere reminders are set in the official app/site (Notify me button).",
  },
  {
    operationId: "search-suggestions",
    substitute: "none",
    substituteNote:
      "Autocomplete has no official API; WebFlix's search input offers no suggestions rather than call undocumented suggest endpoints (ADR-0003).",
    handoffNote: "Search suggestions live in the official YouTube search box.",
  },
];

/** Substitute row for one unsupported operation, or null when unknown. */
export function substituteFor(operationId: string): UnsupportedOperationSubstitute | null {
  return YOUTUBE_UNSUPPORTED_SUBSTITUTES.find((row) => row.operationId === operationId) ?? null;
}

/**
 * Totality check: every "unsupported" manifest row must carry a substitute
 * row here (a missing substitute would leave the UI nothing honest to say).
 * Throws with the offending ids. Used by tests and app-side sanity checks.
 */
export function assertSubstitutesCoverManifest(): void {
  const unsupportedIds = Object.entries(YOUTUBE_OPERATIONS)
    .filter(([, capability]) => capability.status === "unsupported")
    .map(([id]) => id);
  const covered = new Set(YOUTUBE_UNSUPPORTED_SUBSTITUTES.map((row) => row.operationId));
  const missing = unsupportedIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(
      `honest-unsupported rows without a substitute/handoff entry: ${missing.join(", ")}`,
    );
  }
  const extra = YOUTUBE_UNSUPPORTED_SUBSTITUTES.filter(
    (row) => YOUTUBE_OPERATIONS[row.operationId]?.status !== "unsupported",
  ).map((row) => row.operationId);
  if (extra.length > 0) {
    throw new Error(
      `substitute rows that do not match an unsupported manifest row: ${extra.join(", ")}`,
    );
  }
}
