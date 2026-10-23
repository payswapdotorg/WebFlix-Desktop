/**
 * The subscriptions-account seam (WFX-PROVIDER-SLICE-1) — the injected
 * authorized-account source behind the Subscriptions producer.
 *
 * What this seam is:
 *   - the connected-YouTube-account view the subscriptions surface needs:
 *     connection state + the account's subscribed channels. The REAL
 *     implementation is the per-user OAuth account path on the desktop side
 *     (subscriptions.list mine=true over the authorized session — an
 *     official Data API read that requires the user's own OAuth grant;
 *     wiring it is a later order gated on the operator's Google Cloud
 *     OAuth configuration, per the parent order §3.6/§3.7). This slice
 *     consumes the seam; it does not ship the OAuth transport.
 *   - HONEST BY CONSTRUCTION: without a connected account the producer
 *     answers the frozen requires-auth phase — never a fabricated feed.
 *     With a connected account, the feed is the documented COMPOSE (poll
 *     each subscribed channel's uploads; YouTube exposes no
 *     subscriptions-feed API for third-party clients) and MUST carry the
 *     degradeNote (frozen SubscriptionsView law).
 */
import type { YouTubeChannelSummary } from "./youtube-source-port";

/** The per-provider account connection view this seam reports. */
export type SubscriptionsConnectionState = "connected" | "not-connected";

/**
 * The subscribed-channel reference the compose polls. Only provider-
 * reported facts; a minimal ref (channelId) is legal — the compose fills
 * display facts from the polls themselves.
 */
export interface SubscribedChannelRef {
  readonly channelId: string;
  readonly title?: string;
  readonly handle?: string;
  readonly thumbnailUrl?: string;
  readonly subscriberCount?: number;
}

/** The authorized-account seam the Subscriptions producer consumes. */
export interface SubscriptionsAccountSource {
  /** The current connection state (never throws — state is data). */
  connectionState(): SubscriptionsConnectionState;
  /**
   * The connected account's subscribed channels. Only called when
   * connectionState() is "connected". An honest empty list is legal (the
   * account subscribes to nothing); failures reject and surface as the
   * degraded compose.
   */
  listSubscribedChannels(): Promise<readonly SubscribedChannelRef[]>;
}

/** Narrows any channel-shaped ref to the summary the cards need. */
export function channelSummaryFromRef(ref: SubscribedChannelRef): YouTubeChannelSummary {
  return {
    channelId: ref.channelId,
    title: ref.title ?? `YouTube channel ${ref.channelId}`,
    ...(ref.handle !== undefined ? { handle: ref.handle } : {}),
    ...(ref.thumbnailUrl !== undefined ? { thumbnailUrl: ref.thumbnailUrl } : {}),
    ...(ref.subscriberCount !== undefined ? { subscriberCount: ref.subscriberCount } : {}),
  };
}
