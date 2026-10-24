/**
 * WFX-NETFLIX-SOURCE-1 — the second source's host support: the producer
 * build (the bridge-backed upstream seam), the route-driven view state, and
 * the route handler family (country chips / retry / the external open).
 * Extracted from boot.tsx for the repo's max-lines law.
 *
 * WFX-NETFLIX-P45-LOOK-1 — the session-scoped My List (the web app's
 * per-viewer Prisma list adapted to the desktop's honesty: no Netflix
 * viewer identity exists here, so the list lives in this host's session
 * state — exactly the retention-store precedent — and a durable
 * device-local list under the data root is the recorded follow-up).
 */
import { useCallback, useMemo, useState } from "react";
import type { MediaRoute, RouteParams } from "../../../../../webflix-contracts/src/index.js";
import type { NetflixHomeView, NetflixTitleView } from "../../../../../webflix-contracts/src/media-views.js";
import type { NetflixPort } from "../../../../../webflix-contracts/src/media-views.js";
import type { NetflixTitleCard } from "../../../../../webflix-contracts/src/media-views.js";
import { NetflixCatalogProducer } from "./netflixProducer.js";
import { bridgeNetflixUpstreamFetch, getWebFlixNetflixBridge } from "./netflixUpstreamBridge.js";

export interface NetflixHostSupport {
  readonly netflixHome: NetflixHomeView | null;
  readonly netflixTitleView: NetflixTitleView | null;
  readonly setNetflixHome: (view: NetflixHomeView | null) => void;
  readonly setNetflixTitleView: (view: NetflixTitleView | null) => void;
  readonly getNetflixProducer: () => NetflixPort;
  /** The hub's country-view chips (reload the hub under the new region param). */
  readonly handleNetflixCountrySelect: (country: string) => void;
  /** The honest retry: reset whichever netflix surface the route shows. */
  readonly handleNetflixRetry: () => void;
  /** The play hand-off's external open (the main process owns the browser). */
  readonly handleOpenExternalUrl: (url: string) => void;
  /** The session-scoped My List (survives route changes within the session). */
  readonly netflixMyList: readonly NetflixTitleCard[];
  /** The My List toggle (add when absent, remove when present). */
  readonly handleNetflixMyListToggle: (title: NetflixTitleCard) => void;
}

/**
 * The second source's host support (one producer per host; the connector
 * seam is injected once — the composition-root law).
 */
export function useNetflixHostSupport(deps: {
  readonly route: { route: MediaRoute; params: RouteParams };
  readonly setRoute: (route: MediaRoute, params?: RouteParams) => void;
}): NetflixHostSupport {
  const { route, setRoute } = deps;
  const [netflixHome, setNetflixHome] = useState<NetflixHomeView | null>(null);
  const [netflixTitleView, setNetflixTitleView] = useState<NetflixTitleView | null>(null);
  // The session-scoped My List — host-level state so it survives route
  // changes (hub ↔ title detail); resets with the session, honestly noted
  // on the surface itself.
  const [netflixMyList, setNetflixMyList] = useState<readonly NetflixTitleCard[]>([]);

  // The producer — no credentials, no key IPC: the transport is the
  // bridge-backed upstream fetch (or the honest fail-closed throw when the
  // bridge is absent — the producer's unavailable phase).
  const netflixProducer = useMemo(
    () => new NetflixCatalogProducer({ upstream: bridgeNetflixUpstreamFetch(getWebFlixNetflixBridge) }),
    [],
  );
  const getNetflixProducer = useCallback(() => netflixProducer, [netflixProducer]);

  const handleNetflixCountrySelect = useCallback(
    (country: string) => {
      setNetflixHome(null);
      setRoute("netflix", { region: country });
    },
    [setRoute],
  );

  const handleNetflixRetry = useCallback(() => {
    if (route.route === "netflix" && route.params.itemId !== undefined) {
      setNetflixTitleView(null);
    } else {
      setNetflixHome(null);
    }
  }, [route]);

  const handleOpenExternalUrl = useCallback((url: string) => {
    // The play hand-off: the main process owns the system-browser open
    // (the external-handoff law); a refused open is dropped, never faked.
    const bridge = getWebFlixNetflixBridge();
    if (bridge === null) return;
    void bridge.openUrl(url).catch(() => undefined);
  }, []);

  const handleNetflixMyListToggle = useCallback((title: NetflixTitleCard) => {
    setNetflixMyList((prev) =>
      prev.some((t) => t.netflixId === title.netflixId)
        ? prev.filter((t) => t.netflixId !== title.netflixId)
        : [...prev, title],
    );
  }, []);

  return {
    netflixHome,
    netflixTitleView,
    setNetflixHome,
    setNetflixTitleView,
    getNetflixProducer,
    handleNetflixCountrySelect,
    handleNetflixRetry,
    handleOpenExternalUrl,
    netflixMyList,
    handleNetflixMyListToggle,
  };
}
