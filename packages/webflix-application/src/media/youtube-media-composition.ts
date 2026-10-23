/**
 * The media-producer composition bundle (WFX-PROVIDER-SLICE-1) — one
 * factory assembling every frozen media-views port implementation over
 * ONE engine handle + the injected local seams.
 *
 * The composition layers (who builds what):
 *   - the CONNECTORS-side live composition root
 *     (`createLiveYouTubeComposition`) builds the engine — a real-network
 *     YouTubeDataApiClient + the engine adapter — or the typed
 *     requires-auth outcome (freeze §9.5 key law); its
 *     `{ kind: "live", source }` maps here to `{ kind: "source", source }`
 *     and its requires-auth detail to the handle the producers answer
 *     honestly.
 *   - THIS factory (app-side) wires the producers over that handle plus
 *     the app-owned seams: the injected clock, the WebFlix-owned local
 *     history store, and the subscriptions account seam. The desktop
 *     composition root calls both; tests call this one with fakes.
 */
import type {
  ChannelPort,
  ChannelResolutionPort,
  HistoryPort,
  HomeFeedPort,
  SearchPagePort,
  ShortsPort,
  SubscriptionsPort,
  TrendingPort,
} from "webflix-contracts";
import type { ClockPort } from "../ports";
import type { MediaWatchHistorySource } from "./media-history-port";
import type { SubscriptionsAccountSource } from "./subscriptions-account-port";
import type { YouTubeCatalogSourceHandle } from "./youtube-source-port";
import { YouTubeChannelProducer } from "./channel-producer";
import { YouTubeChannelResolutionProducer } from "./channel-resolution-producer";
import { YouTubeHomeFeedProducer } from "./home-feed-producer";
import { LocalHistoryProducer } from "./history-producer";
import { YouTubeSearchPageProducer } from "./search-page-producer";
import { YouTubeShortsProducer } from "./shorts-producer";
import { YouTubeSubscriptionsProducer } from "./subscriptions-producer";
import { YouTubeTrendingProducer } from "./trending-producer";

/** Every producer this slice wires, as one bundle. */
export interface YouTubeMediaProducers {
  readonly homeFeed: HomeFeedPort;
  readonly searchPage: SearchPagePort;
  readonly channel: ChannelPort;
  readonly trending: TrendingPort;
  readonly shorts: ShortsPort;
  readonly subscriptions: SubscriptionsPort;
  readonly history: HistoryPort;
  readonly channelResolution: ChannelResolutionPort;
}

export interface YouTubeMediaProducersDeps {
  readonly clock: ClockPort;
  /** The engine handle (source or the honest requires-auth state). */
  readonly source: YouTubeCatalogSourceHandle;
  /** The WebFlix-owned local history seam (Home continue rail + History). */
  readonly history: MediaWatchHistorySource;
  /** The authorized-account seam (Subscriptions). */
  readonly account: SubscriptionsAccountSource;
  /** Default region for trending-backed surfaces (official regionCode). */
  readonly defaultRegionCode?: string;
  /** Chart rows per page (official 1..50 bound; default 24). */
  readonly trendingMaxResults?: number;
  /** Uploads rows per channel page (default 24). */
  readonly uploadsMaxResults?: number;
}

/** Assembles every frozen-port producer over one engine handle + local seams. */
export function createYouTubeMediaProducers(deps: YouTubeMediaProducersDeps): YouTubeMediaProducers {
  return {
    homeFeed: new YouTubeHomeFeedProducer({
      clock: deps.clock,
      source: deps.source,
      history: deps.history,
      ...(deps.defaultRegionCode !== undefined ? { defaultRegionCode: deps.defaultRegionCode } : {}),
      ...(deps.trendingMaxResults !== undefined ? { trendingMaxResults: deps.trendingMaxResults } : {}),
    }),
    searchPage: new YouTubeSearchPageProducer({ clock: deps.clock, source: deps.source }),
    channel: new YouTubeChannelProducer({
      clock: deps.clock,
      source: deps.source,
      ...(deps.uploadsMaxResults !== undefined ? { uploadsMaxResults: deps.uploadsMaxResults } : {}),
    }),
    trending: new YouTubeTrendingProducer({
      clock: deps.clock,
      source: deps.source,
      ...(deps.trendingMaxResults !== undefined ? { trendingMaxResults: deps.trendingMaxResults } : {}),
    }),
    shorts: new YouTubeShortsProducer({
      clock: deps.clock,
      source: deps.source,
      ...(deps.trendingMaxResults !== undefined ? { trendingMaxResults: deps.trendingMaxResults } : {}),
    }),
    subscriptions: new YouTubeSubscriptionsProducer({
      clock: deps.clock,
      source: deps.source,
      account: deps.account,
    }),
    history: new LocalHistoryProducer({ clock: deps.clock, history: deps.history }),
    channelResolution: new YouTubeChannelResolutionProducer({
      clock: deps.clock,
      source: deps.source,
    }),
  };
}
