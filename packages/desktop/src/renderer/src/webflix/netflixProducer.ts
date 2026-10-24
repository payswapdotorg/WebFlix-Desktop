/**
 * WFX-NETFLIX-SOURCE-1 — the NetflixPort producer adapter (the composition
 * root's Netflix half): maps the connector catalog's DTO family onto the
 * frozen contract view family + applies the honest-phase law.
 *
 * Composition law (why this lives renderer-side): webflix-application
 * depends only on webflix-contracts/webflix-domain — the connector catalog
 * is composed HERE, exactly like createLiveYouTubeComposition is (the
 * mediaHostSupport precedent). The upstream seam is injected at
 * construction: the desktop passes the IPC-backed bridge fetch; tests pass
 * fixture-serving fakes.
 */
import type {
  NetflixHomeView,
  NetflixPort,
  NetflixTitleCard,
  NetflixTitleView,
  NetflixCountryRankView,
} from "../../../../../webflix-contracts/src/media-views.js";
import {
  getNetflixHome as catalogGetNetflixHome,
  getNetflixTitlePage as catalogGetNetflixTitlePage,
} from "../../../../../connectors/src/netflix/catalog.js";
import { setNetflixUpstream, type NetflixUpstreamFetch } from "../../../../../connectors/src/netflix/upstream.js";
import { resetTop10PoolCache } from "../../../../../connectors/src/netflix/top10.js";
import type { NetflixTitleDTO } from "../../../../../connectors/src/netflix/types.js";

const SOURCE_NOTE =
  "Data: Netflix's own public Top 10 & Most Popular (Tudum) — playback hands off to Netflix's official player.";

const UNAVAILABLE_REASON =
  "Netflix's Top 10 data is unreachable from this egress right now — the hub stays empty rather than showing fake rows.";

const NOT_IN_TRACKED_UNIVERSE =
  "Title not in the tracked Netflix catalog — the hub tracks only what Netflix's own Top 10 pages currently publish.";

function titleCardFromDTO(dto: NetflixTitleDTO): NetflixTitleCard {
  return {
    netflixId: dto.netflixId,
    title: dto.title,
    kind: dto.kind,
    synopsis: dto.synopsis,
    releaseYear: dto.releaseYear,
    maturityRating: dto.maturityRating,
    backdropUrl: dto.backdropUrl,
    posterUrl: dto.posterUrl,
    logoUrl: dto.logoUrl,
    weeklyRank: dto.weeklyRank,
    allTimeRank: dto.allTimeRank,
    weeksInTop10: dto.weeksInTop10,
    weeklyHoursViewed: dto.weeklyHoursViewed,
    weekEndDate: dto.weekEndDate,
    watchUrl: dto.deepLinkUrl,
    titlePageUrl: dto.titlePageUrl,
  };
}

/** The not-found / dead-upstream title view (no title data — never a placeholder). */
function unavailableTitleView(detail: string): NetflixTitleView {
  return { title: null, countryRanks: [], relatedTitles: [], phase: "unavailable", detail };
}

export interface NetflixProducerDeps {
  /** The transport seam (the bridge-backed fetch in production; fakes in tests). */
  readonly upstream: NetflixUpstreamFetch;
}

/** The NetflixPort implementation over the connector catalog (one per host). */
export class NetflixCatalogProducer implements NetflixPort {
  constructor(deps: NetflixProducerDeps) {
    // The composition root owns the seam injection (the web app's own
    // setNetflixUpstream law); exactly ONE producer exists per host build.
    setNetflixUpstream(deps.upstream);
  }

  async netflixHome(input: { country?: string }): Promise<NetflixHomeView> {
    const country =
      typeof input?.country === "string" && input.country !== "" ? input.country : "Global";
    try {
      const home = await catalogGetNetflixHome(country);
      const rails = home.rails.map((rail) => ({
        key: rail.key,
        label: rail.label,
        ranking: rail.ranking,
        country: rail.country,
        weekEndDate: rail.weekEndDate,
        titles: rail.titles.map(titleCardFromDTO),
      }));
      const hero = rails.flatMap((rail) => rail.titles).find((t) => t.weeklyRank === 1) ?? null;
      return {
        country,
        rails,
        hero,
        catalogSize: home.catalogSize,
        sourceNote: SOURCE_NOTE,
        phase: home.unavailable ? "unavailable" : "ready",
        ...(home.unavailable ? { detail: home.unavailableReason ?? UNAVAILABLE_REASON } : {}),
      };
    } catch {
      return {
        country,
        rails: [],
        hero: null,
        catalogSize: 0,
        sourceNote: SOURCE_NOTE,
        phase: "unavailable",
        detail: UNAVAILABLE_REASON,
      };
    }
  }

  async netflixTitle(input: { netflixId: number }): Promise<NetflixTitleView> {
    const netflixId = input?.netflixId;
    if (typeof netflixId !== "number" || !Number.isInteger(netflixId) || netflixId <= 0) {
      return {
        title: null,
        countryRanks: [],
        relatedTitles: [],
        phase: "unsupported",
        detail: "The Netflix title id in the route is not a valid number.",
      };
    }
    try {
      const result = await catalogGetNetflixTitlePage(netflixId);
      if (result.kind === "not-found") {
        return unavailableTitleView(NOT_IN_TRACKED_UNIVERSE);
      }
      if (result.kind === "unavailable") {
        return unavailableTitleView(UNAVAILABLE_REASON);
      }
      const page = result.page;
      const countryRanks: NetflixCountryRankView[] = page.countryRanks.map((c) => ({
        countryId: c.countryId,
        rank: c.rank,
      }));
      return {
        title: titleCardFromDTO(page.title),
        countryRanks,
        relatedTitles: page.relatedTitles.map(titleCardFromDTO),
        phase: "ready",
      };
    } catch {
      return unavailableTitleView(UNAVAILABLE_REASON);
    }
  }
}

/** Test seam: drop the connector's pool cache + reset the upstream seam between hermetic cases. */
export function resetNetflixPoolCacheForTests(): void {
  resetTop10PoolCache();
  setNetflixUpstream(null);
}
