/**
 * SubscriptionsPort producer (WFX-PROVIDER-SLICE-1) — the subscriptions
 * surface.
 *
 * THE FROZEN DEGRADE-NOTE LAW (media-views.ts): YouTube exposes NO
 * subscriptions-feed API for third-party clients, so a subscriptions view
 * composed from per-channel upload polling MUST carry `degradeNote` —
 * this producer sets it on EVERY connected compose, ready or degraded.
 *
 * Honest composition (documented):
 *   - without a connected account → the frozen requires-auth phase (the
 *     surface names the connect path; never a fabricated feed);
 *   - connected (the injected account seam) → poll each subscribed
 *     channel's uploads shelf via the engine (~2 units per channel per
 *     refresh — channels.list contentDetails + playlistItems.list, plus
 *     the documented enrichment read) and merge the rows newest-first
 *     (publishedAt DESC, re-sorted client-side — never trusting API row
 *     order);
 *   - a partially failing poll set → the degraded phase with the videos
 *     that DID answer + the mandatory degradeNote + a detail naming the
 *     failed channels — partial data is never hidden and never padded.
 */
import type { ChannelCardView, SubscriptionsPort, SubscriptionsView, VideoCardView } from "webflix-contracts";
import {
  channelCardFromSummary,
  phaseFromCapability,
  sortRowsNewestFirst,
  videoCardFromRow,
} from "./media-cards";
import type { ClockPort } from "../ports";
import { channelSummaryFromRef } from "./subscriptions-account-port";
import type { SubscriptionsAccountSource } from "./subscriptions-account-port";
import type { YouTubeCatalogSourceHandle, YouTubeVideoRow } from "./youtube-source-port";

export const SUBSCRIPTIONS_DEGRADE_NOTE =
  "YouTube exposes no subscriptions-feed API for third-party clients — this feed is composed by polling each subscribed channel's uploads playlist (newest-first merge, not a live feed; each refresh costs ~2 Data API quota units per channel).";

export interface SubscriptionsProducerDeps {
  readonly clock: ClockPort;
  readonly source: YouTubeCatalogSourceHandle;
  /** The authorized-account seam (the connect path lives app-side). */
  readonly account: SubscriptionsAccountSource;
  /** Channels polled per refresh (polls are quota-hungry; default 8). */
  readonly maxChannelsPolled?: number;
  /** Uploads rows requested per channel poll (default 5). */
  readonly uploadsPerChannel?: number;
}

const DEFAULT_MAX_CHANNELS = 8;
const DEFAULT_UPLOADS_PER_CHANNEL = 5;

/** The subscriptions producer over the per-channel-uploads compose. */
export class YouTubeSubscriptionsProducer implements SubscriptionsPort {
  private readonly deps: SubscriptionsProducerDeps;

  constructor(deps: SubscriptionsProducerDeps) {
    this.deps = deps;
  }

  async subscriptions(): Promise<SubscriptionsView> {
    if (this.deps.account.connectionState() !== "connected") {
      return {
        channels: [],
        videos: [],
        phase: "requires-auth",
        detail:
          "Connect your YouTube account to see subscriptions — WebFlix composes the feed from your account's subscribed channels (per-channel upload polling; no subscriptions-feed API exists for third-party clients).",
      };
    }
    if (this.deps.source.kind !== "source") {
      return {
        channels: [],
        videos: [],
        phase: "requires-auth",
        detail: `${this.deps.source.detail} — the account is connected, but the per-channel upload polling needs the official Data API key.`,
      };
    }

    let subscribed;
    try {
      subscribed = await this.deps.account.listSubscribedChannels();
    } catch (error) {
      return {
        channels: [],
        videos: [],
        degradeNote: SUBSCRIPTIONS_DEGRADE_NOTE,
        phase: "degraded",
        detail: `the subscribed-channels read failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const capped = subscribed.slice(0, this.deps.maxChannelsPolled ?? DEFAULT_MAX_CHANNELS);
    if (capped.length === 0) {
      return {
        channels: [],
        videos: [],
        degradeNote: SUBSCRIPTIONS_DEGRADE_NOTE,
        phase: "empty",
        detail: "The connected account subscribes to no channels.",
      };
    }

    const now = this.deps.clock.now();
    const engine = this.deps.source.source;
    const uploadsPerChannel = this.deps.uploadsPerChannel ?? DEFAULT_UPLOADS_PER_CHANNEL;
    const channels: ChannelCardView[] = [];
    const rows: YouTubeVideoRow[] = [];
    const failed: string[] = [];

    await Promise.all(
      capped.map(async (ref) => {
        const poll = await engine.channelUploads({
          channelId: ref.channelId,
          maxResults: uploadsPerChannel,
        });
        if (poll.kind === "honest-state") {
          failed.push(`${ref.title ?? ref.channelId} (${phaseFromCapability(poll.capability)})`);
          return;
        }
        channels.push(channelCardFromSummary(channelSummaryFromRef(ref)));
        rows.push(...poll.value.rows);
      }),
    );

    // Newest-first merge, re-sorted client-side (binding compose law).
    const videos: VideoCardView[] = sortRowsNewestFirst(rows).map((row) => videoCardFromRow(row, now));

    if (failed.length > 0) {
      return {
        channels,
        videos,
        degradeNote: SUBSCRIPTIONS_DEGRADE_NOTE,
        phase: "degraded",
        detail: `per-channel upload polling failed for: ${failed.join(", ")} — the videos shown are the channels that answered.`,
      };
    }
    return {
      channels,
      videos,
      degradeNote: SUBSCRIPTIONS_DEGRADE_NOTE,
      phase: "ready",
    };
  }
}
