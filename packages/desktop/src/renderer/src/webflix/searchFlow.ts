/**
 * P9-UI-1 (requirements 3+4) — the WebFlix search flow for the desktop host.
 *
 * Truthfulness rules (order requirements; freeze §2.3):
 *   - No search results are ever invented. There is no authorized search
 *     transport in this build (no operator OAuth client — freeze AS-Q3; no
 *     authorized account; no API key), so a keyword query resolves to the
 *     honest requires-auth state pointing at the connect flow.
 *   - An OFFICIAL YouTube link (or bare id) is a direct navigation, not a
 *     search: it resolves through the reviewed provider operation (the
 *     official IFrame embed, connectors/src/youtube/playback.ts) and plays
 *     immediately. Public embeds need no credentials (lock §1).
 * PURE module (injectable id-parser and plan-builder for tests).
 */
import type { CatalogItem, PlaybackPlan } from "../../../../../webflix-contracts/src/index.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import { buildYouTubePlaybackPlan } from "../../../../../connectors/src/youtube/playback.js";
import { parseYouTubeLinkId } from "./youtubeLinks.js";

export const YOUTUBE_PROVIDER_ID = "youtube";

export type SearchOutcome =
  | {
      readonly kind: "youtube-link";
      readonly videoId: string;
      readonly plan: PlaybackPlan;
      readonly catalogItem: CatalogItem;
    }
  | {
      readonly kind: "state";
      readonly state: SearchState;
    };

export interface SearchFlowDeps {
  /** Recognizes official YouTube links/ids (injectable for tests). */
  readonly parseLinkId?: (input: string) => string | null;
  /** Builds the official-embed playback plan (injectable for tests). */
  readonly buildPlan?: (videoId: string) => PlaybackPlan;
}

/**
 * Resolve one submitted search query.
 *
 * Order: official-link recognition first (direct navigation through the
 * reviewed embed path); everything else → the honest requires-auth state
 * (providerId "youtube", the connect action target). The state carries the
 * query verbatim; nothing about the query is assumed or answered.
 */
export function resolveSearchQuery(query: string, deps: SearchFlowDeps = {}): SearchOutcome {
  const parseLinkId = deps.parseLinkId ?? parseYouTubeLinkId;
  const buildPlan =
    deps.buildPlan ?? ((videoId: string) => buildYouTubePlaybackPlan({ videoId }) as PlaybackPlan);

  const trimmed = query.trim();
  if (trimmed === "") {
    return { kind: "state", state: { phase: "idle" } };
  }

  const videoId = parseLinkId(trimmed);
  if (videoId !== null) {
    const plan = buildPlan(videoId);
    const catalogItem: CatalogItem = {
      id: `youtube-video-${videoId}`,
      providerId: YOUTUBE_PROVIDER_ID,
      title: `YouTube video ${videoId}`,
      mediaKind: "video",
      assets: [
        {
          assetId: `youtube-embed-${videoId}`,
          kind: "embed",
          reference: `https://www.youtube-nocookie.com/embed/${videoId}`,
        },
      ],
      metadata: { videoId, openedFrom: "webflix-search-link" },
    };
    return { kind: "youtube-link", videoId, plan, catalogItem };
  }

  return {
    kind: "state",
    state: {
      phase: "requires-auth",
      query: trimmed,
      providerId: YOUTUBE_PROVIDER_ID,
    },
  };
}
