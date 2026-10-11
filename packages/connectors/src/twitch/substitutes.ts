/**
 * Honest-unsupported rows → WebFlix-local substitutes (TWITCH-CONNECT scope
 * row 4) — the same rules and discipline as the YouTube/TikTok substitute
 * maps (YOUTUBE-EXPAND / TIKTOK-CONNECT precedents):
 *
 *   - an unsupported Twitch capability is NEVER faked, proxied, or scraped;
 *   - where WebFlix has an OWN-store substitute (local history, local
 *     library/collections), the substitute lives in WebFlix's own stores —
 *     it is never presented as provider data;
 *   - where no compliant substitute exists, the row says so and hands the
 *     user off to the official Twitch app/site (the only compliant path);
 *   - this map is connector-local documentation data (same pattern as
 *     TWITCH_OPERATION_PROVENANCE — the frozen §2.3 shape has no substitute
 *     field; the structural gap rides the MR-FD3 freeze-deviation queue).
 */
import { TWITCH_OPERATIONS } from "./manifest";

/** Where a substitute lives, when one exists. */
export type TwitchLocalSubstitute = "webflix-local-history" | "webflix-local-library" | "none";

export interface TwitchUnsupportedOperationSubstitute {
  /** Manifest operation id (must be an unsupported row). */
  readonly operationId: string;
  /** The WebFlix-owned substitute surface, or "none" when handoff is the only path. */
  readonly substitute: TwitchLocalSubstitute;
  /** What WebFlix honestly does locally (never provider data). */
  readonly substituteNote: string;
  /** The compliant path when the official app/site is the only way. */
  readonly handoffNote: string;
}

export const TWITCH_UNSUPPORTED_SUBSTITUTES: readonly TwitchUnsupportedOperationSubstitute[] = [
  {
    operationId: "chat.read",
    substitute: "none",
    substituteNote:
      "Twitch chat is a separate IRC/EventSub protocol surface (this order's non-goal, pending as a later-phase row); WebFlix shows no chat pane rather than an unofficial one.",
    handoffNote: "Chat lives in the official Twitch player/app under every stream.",
  },
  {
    operationId: "eventsub.subscribe",
    substitute: "none",
    substituteNote:
      "EventSub is server-side push webhooks requiring a public callback endpoint — later-phase infrastructure, not a desktop read; no local substitute pretends to be live push.",
    handoffNote:
      "Live channel updates arrive through the official player/app (and future WebFlix polling is a separately reviewed surface).",
  },
  {
    operationId: "moderation.manage",
    substitute: "none",
    substituteNote:
      "Moderation surfaces are moderator-scoped operator tools — irrelevant to a viewer app; WebFlix requests no moderation scope and shows no moderation UI.",
    handoffNote: "Moderation lives in the official Twitch moderator view / dashboard.",
  },
  {
    operationId: "stream-key.read",
    substitute: "none",
    substituteNote:
      "A stream key is a creator secret that lets anyone broadcast as the channel; a viewer app never holds one. No local substitute exists by design.",
    handoffNote: "Stream keys live in the official Twitch creator dashboard.",
  },
  {
    operationId: "content-classification.list",
    substitute: "none",
    substituteNote:
      "Content classification labels are an operator/gated configuration surface per the work order; not integrated unreviewed and no local substitute exists.",
    handoffNote: "Classification settings live in the official creator dashboard.",
  },
  {
    operationId: "bits.value",
    substitute: "none",
    substituteNote:
      "Bits surfaces expose creator monetary/engagement value behind broadcaster scopes; a viewer app never renders monetary value — no substitute, ever.",
    handoffNote: "Bits stats live in the official creator dashboard.",
  },
  {
    operationId: "subscriptions.value",
    substitute: "none",
    substituteNote:
      "Broadcaster subscription surfaces expose payer-adjacent monetary data behind broadcaster scopes; a viewer app never renders subscription value.",
    handoffNote: "Subscription stats live in the official creator dashboard.",
  },
  {
    operationId: "history.provider",
    substitute: "webflix-local-history",
    substituteNote:
      "WebFlix keeps its OWN watch history — WebFlix-owned PlaybackProgress records for items you played in WebFlix. It never reads or writes your Twitch watch history (no Helix endpoint exists for it).",
    handoffNote:
      "Your full Twitch viewing history lives in the official app: Settings → Privacy → View my watch history.",
  },
  {
    operationId: "recommendations.browse",
    substitute: "webflix-local-library",
    substituteNote:
      "Helix has no recommendations/home-feed endpoint (the first-page algorithm is first-party only). WebFlix's home is its own library, collections and continue-watching — never dressed up as Twitch recommendations.",
    handoffNote: "Twitch's recommended front page lives in the official app/site.",
  },
  {
    operationId: "notifications.list",
    substitute: "none",
    substituteNote:
      "No Helix endpoint exposes the Twitch notification inbox; WebFlix shows no notification surface rather than fabricate one.",
    handoffNote: "Notifications live in the official app/site.",
  },
  {
    operationId: "whispers.list",
    substitute: "none",
    substituteNote:
      "Whispers (direct messages) are a private first-party surface with no third-party read API; WebFlix never touches whispers.",
    handoffNote: "Whispers live in the official Twitch app/site.",
  },
  {
    operationId: "search.suggestions",
    substitute: "none",
    substituteNote:
      "Autocomplete has no official API; undocumented suggest surfaces are excluded by ADR-0003. The search input offers no Twitch suggestions.",
    handoffNote: "Search suggestions live in the official Twitch search box.",
  },
  {
    operationId: "video.download",
    substitute: "none",
    substituteNote:
      "Downloading Twitch content outside official surfaces is out of scope by policy (ADR-0003). WebFlix's local library is for user-owned/local content only; VODs stay on Twitch's own player.",
    handoffNote:
      "Official highlights/clips management lives in the creator dashboard; watching stays in the official player.",
  },
];

/** Substitute row for one unsupported operation, or null when unknown. */
export function twitchSubstituteFor(
  operationId: string,
): TwitchUnsupportedOperationSubstitute | null {
  return TWITCH_UNSUPPORTED_SUBSTITUTES.find((row) => row.operationId === operationId) ?? null;
}

/**
 * Totality check: every "unsupported" manifest row must carry a substitute
 * row here (a missing substitute would leave the UI nothing honest to say),
 * and no substitute row may point at a non-unsupported operation. Throws
 * with the offending ids. Used by tests and app-side sanity checks.
 */
export function assertTwitchSubstitutesCoverManifest(): void {
  const unsupportedIds = Object.entries(TWITCH_OPERATIONS)
    .filter(([, capability]) => capability.status === "unsupported")
    .map(([id]) => id);
  const covered = new Set(TWITCH_UNSUPPORTED_SUBSTITUTES.map((row) => row.operationId));
  const missing = unsupportedIds.filter((id) => !covered.has(id));
  if (missing.length > 0) {
    throw new Error(
      `honest-unsupported twitch rows without a substitute/handoff entry: ${missing.join(", ")}`,
    );
  }
  const extra = TWITCH_UNSUPPORTED_SUBSTITUTES.filter(
    (row) => TWITCH_OPERATIONS[row.operationId]?.status !== "unsupported",
  ).map((row) => row.operationId);
  if (extra.length > 0) {
    throw new Error(
      `twitch substitute rows that do not match an unsupported manifest row: ${extra.join(", ")}`,
    );
  }
}
