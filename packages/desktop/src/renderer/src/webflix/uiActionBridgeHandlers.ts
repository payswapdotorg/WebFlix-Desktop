/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the typed UI-action
 * bridge handlers factory: the SAME use cases the UI buttons use, packaged
 * as the stable UiActionHandlers record Worker 3's AgentPanel consumes
 * (freeze §9.1). Extracted from boot.tsx for the max-lines law.
 *
 * LIVE-STATE LAW: the bridge is created ONCE per handlers record, so the
 * panel-visibility read goes through the injected live-state getter —
 * never a stale closure. Verification is the caller's second read:
 * dispatch, then getVisibleMediaContext — the ok results carry evidence,
 * never an unverified "post-action" snapshot.
 */
import type {
  MediaRoute,
  RouteParams,
  SearchPageData,
  VisibleMediaContext,
} from "../../../../../webflix-contracts/src/index.js";
import type { VideoCardView } from "../../../../../webflix-contracts/src/media-views.js";
import type { SearchState } from "../../../../../webflix-shell/src/states.js";
import type { UiActionHandlers } from "../agent/uiActionBridge.js";
import type { YouTubeMediaProducers } from "../../../../../webflix-application/src/media/youtube-media-composition.js";
import type { LocalLibrarySession } from "./localLibrarySession.js";
import { resolvePlayPlan } from "./watchPlan.js";
import { searchPhaseFromPageData } from "./mediaHostSupport.js";

export interface UiActionHostDeps {
  /** The producers ref (null = the honest unconfigured transport). */
  readonly getProducers: () => YouTubeMediaProducers | null;
  /** The item registry getter (playCatalogItem resolves ids against it). */
  readonly getRegisteredCard: (itemId: string) => VideoCardView | undefined;
  /** The shared play path — the exact callback the UI cards use. */
  readonly playCard: (card: VideoCardView) => void;
  /** Registers surfaced cards into the item registry. */
  readonly registerCards: (cards: readonly VideoCardView[] | undefined | null) => void;
  /** The live panel-visibility read (never a stale closure). */
  readonly getAgentPanelVisible: () => boolean;
  readonly setAgentPanelVisible: (visible: boolean) => void;
  readonly setSearchPage: (page: SearchPageData | null) => void;
  readonly setSearchState: (state: SearchState) => void;
  readonly setRoute: (route: MediaRoute, params?: RouteParams) => void;
  readonly handleConnect: (providerId: string) => void;
  readonly localLibrary: LocalLibrarySession;
  readonly getVisibleMediaContext: () => VisibleMediaContext;
}

/** Builds the stable handlers record over the injected host seams. */
export function createUiActionHandlers(deps: UiActionHostDeps): UiActionHandlers {
  return {
    async searchCatalog(action) {
      const producers = deps.getProducers();
      if (producers === null) {
        return {
          kind: "unsupported",
          capability: "requires-auth",
          reason:
            "No YouTube Data API transport is configured in this runtime — search answers requires-auth.",
        };
      }
      try {
        const data = await producers.searchPage.searchPage(action.query, {
          ...(action.limit !== undefined && { limit: action.limit }),
        });
        deps.registerCards(data.videos);
        deps.setSearchPage(data);
        deps.setSearchState(searchPhaseFromPageData(action.query, data));
        deps.setRoute("search", { query: action.query });
        const phase = searchPhaseFromPageData(action.query, data).phase;
        if (phase !== "results") {
          return {
            kind: "unsupported",
            capability:
              phase === "requires-auth" ? "requires-auth" : phase === "rate-limited" ? "rate-limited" : "unavailable",
            reason:
              data.budgetNote ?? `Search answered ${phase} for "${action.query}" — nothing was fabricated.`,
          };
        }
        return {
          kind: "ok",
          summary: `Search returned ${data.videos.length} videos and ${data.channels.length} channels for "${action.query}".`,
          items: data.videos.map((card) => ({
            itemId: card.item.id,
            title: card.title,
            providerId: card.item.providerId,
            mediaKind: card.item.mediaKind,
            ...(card.channelTitle !== undefined ? { channelTitle: card.channelTitle } : {}),
            ...(card.publishedLabel !== undefined ? { publishedLabel: card.publishedLabel } : {}),
          })),
          channels: data.channels.map((channel) => ({
            channelId: channel.channelId,
            title: channel.title,
            ...(channel.handle !== undefined ? { handle: channel.handle } : {}),
            ...(channel.subscriberLabel !== undefined ? { subscriberLabel: channel.subscriberLabel } : {}),
            ...(channel.verified !== undefined ? { verified: channel.verified } : {}),
          })),
          evidence: [
            ...(data.budgetNote !== undefined ? [data.budgetNote] : []),
            ...(data.nextCursor !== null ? ["next page available (cursor)"] : []),
          ],
        };
      } catch {
        return {
          kind: "failure",
          code: "provider-unreachable",
          message: "The YouTube search could not be reached.",
          retryable: true,
        };
      }
    },
    async resolveChannel(action) {
      const producers = deps.getProducers();
      if (producers === null) {
        return {
          kind: "unsupported",
          capability: "requires-auth",
          reason:
            "No YouTube Data API transport is configured — channel resolution answers requires-auth.",
        };
      }
      try {
        const outcome = await producers.channelResolution.resolveChannel(action.query, {
          uploadsLimit: 12,
        });
        if (outcome.kind === "resolved") {
          deps.registerCards(outcome.uploads);
          return {
            kind: "ok",
            summary: `Resolved ${outcome.channel.title} with ${outcome.uploads.length} newest uploads (newest first).`,
            channels: [
              {
                channelId: outcome.channel.channelId,
                title: outcome.channel.title,
                ...(outcome.channel.handle !== undefined ? { handle: outcome.channel.handle } : {}),
                ...(outcome.channel.subscriberLabel !== undefined
                  ? { subscriberLabel: outcome.channel.subscriberLabel }
                  : {}),
                ...(outcome.channel.verified !== undefined ? { verified: outcome.channel.verified } : {}),
              },
            ],
            items: outcome.uploads.map((card) => ({
              itemId: card.item.id,
              title: card.title,
              providerId: card.item.providerId,
              mediaKind: card.item.mediaKind,
              ...(card.channelTitle !== undefined ? { channelTitle: card.channelTitle } : {}),
              ...(card.publishedLabel !== undefined ? { publishedLabel: card.publishedLabel } : {}),
            })),
            evidence: outcome.uploads.map(
              (card) => `${card.title}${card.publishedLabel !== undefined ? ` — ${card.publishedLabel}` : ""}`,
            ),
          };
        }
        if (outcome.kind === "ambiguous") {
          return {
            kind: "needs-user-choice",
            prompt: `Multiple channels match "${action.query}" — which one did you mean?`,
            choices: outcome.candidates.map((candidate) => ({
              id: candidate.channelId,
              label: candidate.title,
              ...(candidate.subscriberLabel !== undefined ? { description: candidate.subscriberLabel } : {}),
            })),
          };
        }
        if (outcome.kind === "not-found") {
          return {
            kind: "failure",
            code: "item-not-found",
            message: `No channel matches "${action.query}".`,
            retryable: false,
          };
        }
        return {
          kind: "unsupported",
          capability:
            outcome.phase === "requires-auth"
              ? "requires-auth"
              : outcome.phase === "rate-limited"
                ? "rate-limited"
                : "unavailable",
          reason: outcome.detail ?? `Channel resolution is ${outcome.phase}.`,
        };
      } catch {
        return {
          kind: "failure",
          code: "provider-unreachable",
          message: "Channel resolution could not be reached.",
          retryable: true,
        };
      }
    },
    async openRoute(action) {
      deps.setRoute(action.route, action.params ?? {});
      return {
        kind: "ok",
        summary: `Opened ${action.route}.`,
        items: [],
        channels: [],
        evidence: ["verify with getVisibleMediaContext"],
      };
    },
    async playCatalogItem(action) {
      const card = deps.getRegisteredCard(action.itemId);
      if (card === undefined) {
        return {
          kind: "failure",
          code: "item-not-found",
          message: `No item with id "${action.itemId}" is present in the app state — reference items from tool results or the visible context.`,
          retryable: false,
        };
      }
      deps.playCard(card);
      return {
        kind: "ok",
        summary: `Playing ${card.title}.`,
        items: [
          {
            itemId: card.item.id,
            title: card.title,
            providerId: card.item.providerId,
            mediaKind: card.item.mediaKind,
            ...(card.channelTitle !== undefined ? { channelTitle: card.channelTitle } : {}),
          },
        ],
        channels: [],
        evidence: [
          `playback plan: ${resolvePlayPlan(card.item, deps.localLibrary).plan.kind}`,
          "verify with getVisibleMediaContext",
        ],
      };
    },
    async openAccountConnection(action) {
      deps.setRoute("accounts");
      deps.handleConnect(action.providerId);
      return {
        kind: "ok",
        summary: `Opened the account connection surface for ${action.providerId} — the connect flow runs only with the user's own explicit action.`,
        items: [],
        channels: [],
        evidence: ["route: accounts"],
      };
    },
    async toggleAgentPanel(action) {
      const next = action.visible ?? !deps.getAgentPanelVisible();
      deps.setAgentPanelVisible(next);
      return {
        kind: "ok",
        summary: next ? "Agent panel opened." : "Agent panel closed.",
        items: [],
        channels: [],
        evidence: ["verify with getVisibleMediaContext"],
      };
    },
    getVisibleMediaContext: () => deps.getVisibleMediaContext(),
  };
}
