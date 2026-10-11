/**
 * Honest-unsupported / later-phase rows → WebFlix-local substitutes
 * (REDDIT-CONNECT scope row 4) — the same rules and discipline as the other
 * four platforms' substitutes modules (YOUTUBE-EXPAND precedent):
 *
 *   - a later-phase write row is NEVER faked as available — the documented
 *     write API exists (dev/api) but this order ships reads only; the row
 *     says so and hands the action to the official app/site;
 *   - an unsupported surface is never scraped or proxied (ADR-0003) —
 *     where WebFlix has an OWN-store substitute (local history, local
 *     library/collections) the substitute lives in WebFlix's own stores,
 *     never presented as provider data;
 *   - where no compliant substitute exists, the row says so and hands the
 *     user off to the official Reddit app/site (the only compliant path);
 *   - this map is connector-local documentation data (same pattern as
 *     REDDIT_OPERATION_PROVENANCE — the frozen §2.3 shape has no substitute
 *     field; the structural gap rides the MR-FD3 freeze-deviation queue).
 */
import { REDDIT_OPERATIONS } from "./manifest";

/** Where a substitute lives, when one exists. */
export type RedditLocalSubstitute = "webflix-local-history" | "webflix-local-library" | "none";

export interface RedditUnsupportedOperationSubstitute {
  /** Manifest operation id (must be an unavailable or unsupported row). */
  readonly operationId: string;
  /** The WebFlix-owned substitute surface, or "none" when handoff is the only path. */
  readonly substitute: RedditLocalSubstitute;
  /** What WebFlix honestly does locally (never provider data). */
  readonly substituteNote: string;
  /** The compliant path when the official app/site is the only way. */
  readonly handoffNote: string;
}

export const REDDIT_UNSUPPORTED_SUBSTITUTES: readonly RedditUnsupportedOperationSubstitute[] = [
  {
    operationId: "vote.cast",
    substitute: "none",
    substituteNote:
      "Voting is a documented write (POST /api/vote, vote scope) held for a later phase — WebFlix neither implements it nor requests the write scope, so no local substitute exists (a WebFlix 'like' would be dishonest: it would not be the provider's vote).",
    handoffNote: "Vote in the official Reddit app/site.",
  },
  {
    operationId: "save.toggle",
    substitute: "webflix-local-library",
    substituteNote:
      "Saving is a documented write (POST /api/save, save scope) held for a later phase. WebFlix's own watchlist/library is the local substitute — it saves items in WebFlix's own stores and is never presented as the Reddit account's saved list.",
    handoffNote: "The Reddit saved list lives in the official app/site.",
  },
  {
    operationId: "comment.create",
    substitute: "none",
    substituteNote:
      "Commenting is a documented write (POST /api/comment) held for a later phase; WebFlix's comment context is read-only viewing — no local substitute would be honest.",
    handoffNote: "Reply in the official Reddit app/site.",
  },
  {
    operationId: "post.submit",
    substitute: "none",
    substituteNote:
      "Submitting is a documented write (POST /api/submit, submit scope) held for a later phase — no local substitute exists.",
    handoffNote: "Post in the official Reddit app/site.",
  },
  {
    operationId: "message.compose",
    substitute: "none",
    substituteNote:
      "Private messages are a documented write surface (POST /api/compose, privatemessages scope) held for a later phase — WebFlix is a media client, not a messenger.",
    handoffNote: "Messages live in the official Reddit app/site.",
  },
  {
    operationId: "subscribe.toggle",
    substitute: "webflix-local-library",
    substituteNote:
      "Subscribing is a documented write (POST /api/subscribe, subscribe scope) held for a later phase. WebFlix's own collections are the local substitute: the user can group the subreddits they browse in WebFlix's own stores — never presented as Reddit subscriptions.",
    handoffNote: "Reddit subscriptions live in the official app/site.",
  },
  {
    operationId: "messages.list",
    substitute: "none",
    substituteNote:
      "The classic private-messages listing (GET /message/<where>, privatemessages scope) is a real documented API held for a later phase — a message inbox is outside WebFlix's media scope and no local substitute would be honest.",
    handoffNote: "The inbox lives in the official Reddit app/site.",
  },
  {
    operationId: "activity.mine",
    substitute: "webflix-local-history",
    substituteNote:
      "The user's own Reddit activity listings (history scope) are documented per-user reads held for a later phase. WebFlix's own watch history is the local substitute — WebFlix-owned data about what was watched in WebFlix, never the Reddit account's upvoted/saved data.",
    handoffNote: "The Reddit activity pages live in the official app/site.",
  },
  {
    operationId: "chat.list",
    substitute: "none",
    substituteNote:
      "The Reddit chat system has no public REST read API (dev/api documents classic private messages, not chat; the Data API Wiki references chat only as Bot-API rate limits). No local substitute; chats are never scraped.",
    handoffNote: "Chats live in the official Reddit app/site.",
  },
  {
    operationId: "live.browse",
    substitute: "none",
    substituteNote:
      "No video live-stream read is documented (live THREADS are text-update surfaces on dev/api; the RPAN video surface was discontinued) — no video-live row is invented and no local substitute pretends otherwise.",
    handoffNote: "Reddit live text threads live at reddit.com/live in the official surfaces.",
  },
  {
    operationId: "moderation.manage",
    substitute: "none",
    substituteNote:
      "Moderation surfaces (modmail API, mod notes, removals) are documented but gated to moderator credentials on the target subreddit — a moderator tool, not a consumer media surface. No substitute.",
    handoffNote: "Moderation lives in the official mod tools.",
  },
  {
    operationId: "video.download",
    substitute: "none",
    substituteNote:
      "No official download API exists; the payload's reddit_video fields are the provider's playback sources for its own player. WebFlix embeds the official surface and downloads nothing (the Data API Terms restrict use of API content; WebFlix is a media client).",
    handoffNote: "Media lives at the post's permalink in the official surfaces.",
  },
];

/**
 * The totality check: every unavailable/unsupported manifest row carries a
 * substitute row, and every substitute row names a real manifest row of one
 * of those statuses. Both directions have teeth (the tests assert them).
 */
export function assertRedditSubstituteTotality(): void {
  const manifestIds = new Set(
    Object.entries(REDDIT_OPERATIONS)
      .filter(
        ([, capability]) =>
          capability.status === "unsupported" || capability.status === "unavailable",
      )
      .map(([id]) => id),
  );
  const substituteIds = new Set(REDDIT_UNSUPPORTED_SUBSTITUTES.map((row) => row.operationId));
  for (const id of manifestIds) {
    if (!substituteIds.has(id)) {
      throw new Error(
        `reddit substitutes: manifest row "${id}" (unavailable/unsupported) has no substitute row`,
      );
    }
  }
  for (const id of substituteIds) {
    if (!manifestIds.has(id)) {
      throw new Error(
        `reddit substitutes: substitute row "${id}" does not match an unavailable/unsupported manifest row`,
      );
    }
  }
}
