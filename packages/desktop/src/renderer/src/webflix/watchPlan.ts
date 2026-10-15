/**
 * P9-UI-1 (order requirement 3) — the watch-plan resolver for the WebFlix
 * renderer host: REAL plans only, honest typed refusals otherwise.
 *
 *   - A local session entry resolves to its playable object-URL plan; a
 *     removed entry resolves to the typed unavailable/removed state (the
 *     session library is stated honestly — re-import, never a ghost play).
 *   - A YouTube item resolves through the reviewed provider operation ONLY
 *     when it carries a real official-embed reference; WebFlix never wraps
 *     scraped streams.
 *   - Any other provider resolves to the typed unsupported state — this
 *     build supports exactly the local and official-embed paths.
 */
import type { CatalogItem, PlaybackPlan } from "../../../../../webflix-contracts/src/index.js";
import { resolveSearchQuery, YOUTUBE_PROVIDER_ID } from "./searchFlow.js";
import type { LocalLibrarySession } from "./localLibrarySession.js";

/** The watch view: the item being played plus its resolved plan. */
export interface WatchView {
  readonly title: string;
  readonly plan: PlaybackPlan;
}

/** Resolves the plan for a play request — real plans only, honest refusals otherwise. */
export function resolvePlayPlan(item: CatalogItem, localLibrary: LocalLibrarySession): WatchView {
  if (item.providerId === "local") {
    const entry = localLibrary.findEntry(item.id);
    if (entry !== undefined) {
      return { title: item.title, plan: entry.plan };
    }
    return {
      title: item.title,
      plan: {
        kind: "unavailable",
        reason: "removed",
        recovery: {
          action: "retry-later",
          message:
            "This session's local entry is no longer present — import the file again (session library only in this build).",
        },
      },
    };
  }
  if (item.providerId === YOUTUBE_PROVIDER_ID) {
    const videoId = item.metadata?.videoId;
    if (typeof videoId === "string" && videoId !== "") {
      const outcome = resolveSearchQuery(videoId);
      if (outcome.kind === "youtube-link") {
        return { title: item.title, plan: outcome.plan };
      }
    }
    return {
      title: item.title,
      plan: {
        kind: "unavailable",
        reason: "unsupported",
        recovery: {
          action: "open-provider-app",
          message:
            "This item has no official-embed playback reference — WebFlix never wraps scraped streams.",
        },
      },
    };
  }
  return {
    title: item.title,
    plan: {
      kind: "unavailable",
      reason: "unsupported",
      recovery: {
        action: "open-provider-app",
        message: `Playback for provider "${item.providerId}" is not supported in this build.`,
      },
    },
  };
}
