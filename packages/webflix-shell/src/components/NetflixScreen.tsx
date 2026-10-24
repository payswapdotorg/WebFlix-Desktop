// WFX-NETFLIX-SOURCE-1 — the Netflix hub surface (the web app's
// src/app/netflix/view.tsx, ported into the shell's token-driven
// inline-style idiom). The Netflix sub-brand's own palette is carried as
// LOCAL constants in netflixColors.ts; the frozen shell theme stays
// untouched.
//
// WFX-NETFLIX-P45-LOOK-1 — the netflix-grade hub, Netflix's own landing:
// the rotating billboard IS the top of the page (no header box above it),
// the sticky sub-nav (All / Movies / TV Shows kind tabs beside the
// Global/US country chips), the session-scoped My List rail, and the
// kind-filtered rails. The billboard + filtering derive from the rails
// client-side exactly like the web app (the weekly top-5 by rank); the
// contract stays 0.15.0.
//
// Honest laws (ADR 0002): every row is Netflix's own published Top 10 data;
// an unreachable upstream renders the unavailable phase — never fake rows;
// playback hands off to Netflix's official player (the hand-off dialog —
// the desktop's honest path; the web app's cloud-desktop watch lane is the
// recorded follow-up); the provenance footnote names the source.

import React, { useState } from "react";
import { theme } from "../theme";
import type { NetflixHomeView, NetflixTitleCard } from "webflix-contracts";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import { NetflixPlayHandoff } from "./netflixPlayHandoff";
import { NetflixCardInline, NETFLIX_HOVER_STYLES } from "./netflixCard";
import { NetflixRailInline } from "./netflixRail";
import { NetflixBillboard } from "./netflixHero";
import { NETFLIX_COLORS } from "./netflixColors";

const COUNTRIES = [
  { id: "Global", label: "Global" },
  { id: "US", label: "United States" },
] as const;

const KIND_TABS = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV Shows" },
] as const;

type KindTab = (typeof KIND_TABS)[number]["id"];

export interface NetflixScreenProps {
  readonly view?: NetflixHomeView | null;
  /** The country view chips report here ("Global" | "US"). */
  readonly onSelectCountry?: (country: string) => void;
  /** A card click opens the title detail (the host routes it). */
  readonly onOpenTitle?: (netflixId: number) => void;
  /** The play hand-off's external open (the host owns the system-browser call). */
  readonly onOpenExternal?: (url: string) => void;
  readonly onRetry?: () => void;
  /** The session-scoped My List (the host holds it; honest session scope). */
  readonly myList?: readonly NetflixTitleCard[];
  /** The My List toggle (the + circles + the billboard button). */
  readonly onToggleMyList?: (title: NetflixTitleCard) => void;
}

/** A pool rail's kind, derived from its homogeneous titles (the pool law). */
function railKind(rail: { titles: readonly NetflixTitleCard[] }): "movie" | "series" | null {
  return rail.titles[0]?.kind ?? null;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    color: "#ffffff",
    minWidth: 0,
    minHeight: "70vh",
    // The Netflix sub-brand's own canvas (#0a0a0c), full-bleed inside the
    // shell's content column — the billboard lands edge-to-edge like the
    // web app's own landing (the P45 look).
    background: NETFLIX_COLORS.canvas,
    flex: 1,
    paddingBottom: 64,
  },
  srHeading: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  },
  subnav: {
    position: "sticky",
    top: 0,
    zIndex: 30,
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    background: "rgba(10,10,12,0.9)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    padding: "0 16px",
  },
  subnavInner: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 0",
  },
  kindTabs: { display: "flex", gap: 4 },
  kindTab: {
    height: 32,
    padding: "0 14px",
    borderRadius: 4,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.7)",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 500,
    cursor: "pointer",
  },
  kindTabActive: { background: "#ffffff", color: "#000000" },
  countryChips: { display: "flex", gap: 8, flexShrink: 0 },
  countryChip: {
    height: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 500,
    background: "transparent",
    color: "rgba(255,255,255,0.6)",
  },
  countryChipActive: {
    background: "rgba(255,255,255,0.15)",
    color: "#ffffff",
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
  },
  myListRail: { display: "flex", flexDirection: "column", marginTop: 28 },
  myListHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    padding: "0 16px",
  },
  myListTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  myListNote: { fontSize: 12, color: "rgba(255,255,255,0.4)" },
  myListRow: { display: "flex", gap: 12, overflowX: "auto", padding: "16px 16px" },
  sourceNote: {
    margin: 0,
    marginTop: 32,
    padding: "0 16px",
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
  },
};

export function NetflixScreen(props: NetflixScreenProps): React.ReactElement {
  const { view, onSelectCountry, onOpenTitle, onOpenExternal, onRetry, myList, onToggleMyList } = props;
  const [handoffTitle, setHandoffTitle] = useState<NetflixTitleCard | null>(null);
  const [kind, setKind] = useState<KindTab>("all");

  if (view === null || view === undefined) {
    return (
      <section aria-label="Netflix" style={styles.root}>
        <ViewNotProvided surfaceLabel="Netflix" testIdPrefix="netflix" />
      </section>
    );
  }

  const country = view.country;
  const savedIds = new Set((myList ?? []).map((t) => t.netflixId));
  const openPlay = (title: NetflixTitleCard): void => {
    setHandoffTitle(title);
  };

  const ready = view.phase === "ready";
  const kindOf = (rail: { titles: readonly NetflixTitleCard[] }): boolean =>
    kind === "all" || railKind(rail) === kind;
  const rails = ready ? view.rails.filter((r) => r.titles.length > 0 && kindOf(r)) : [];
  const billboardTitles = ready
    ? view.rails
        .filter((r) => r.ranking === "weekly" && r.titles.length > 0 && kindOf(r))
        .flatMap((r) => r.titles)
        .sort((a, b) => (a.weeklyRank ?? 99) - (b.weeklyRank ?? 99))
        .slice(0, 5)
    : [];

  return (
    <section aria-label="Netflix" style={styles.root} data-testid="netflix-root">
      <style>{NETFLIX_HOVER_STYLES}</style>
      <h1 style={styles.srHeading} data-testid="netflix-hub-heading">
        Netflix on WebFlix
      </h1>

      {!ready && (
        <div style={{ marginTop: theme.spacing.lg, padding: "0 16px" }}>
          <MediaPhasePanel
            phase={view.phase}
            detail={view.detail}
            surfaceLabel="Netflix"
            onRetry={onRetry}
            skeletonCount={view.phase === "loading" ? 4 : 0}
            testIdPrefix="netflix"
          />
        </div>
      )}

      {ready && (
        <>
          {/* the billboard — full-bleed, Netflix's own landing (no header box) */}
          <NetflixBillboard
            titles={billboardTitles}
            onPlay={openPlay}
            onInfo={(netflixId) => onOpenTitle?.(netflixId)}
            myList={myList ?? []}
            onToggleMyList={onToggleMyList}
          />

          {/* the sticky sub-nav — kind tabs beside the country chips */}
          <div style={styles.subnav}>
            <div style={styles.subnavInner}>
              <nav role="group" aria-label="Catalog filter" style={styles.kindTabs} data-testid="netflix-kind-tabs">
                {KIND_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={kind === t.id}
                    style={{ ...styles.kindTab, ...(kind === t.id ? styles.kindTabActive : undefined) }}
                    onClick={() => setKind(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              <div
                role="group"
                aria-label="Country view"
                style={styles.countryChips}
                data-testid="netflix-country-chips"
              >
                {COUNTRIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={country === c.id}
                    style={{ ...styles.countryChip, ...(country === c.id ? styles.countryChipActive : undefined) }}
                    onClick={() => onSelectCountry?.(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* the session-scoped My List rail (the honest scope note) */}
          {(myList ?? []).length > 0 && (
            <section aria-label="My Netflix List" style={styles.myListRail} data-testid="netflix-my-list-rail">
              <div style={styles.myListHeader}>
                <h2 style={styles.myListTitle}>My List</h2>
                <span style={styles.myListNote}>saved in WebFlix · this session</span>
              </div>
              <div className="wfx-nf-scroll" style={styles.myListRow}>
                {(myList ?? []).map((title) => (
                  <NetflixCardInline
                    key={title.netflixId}
                    title={title}
                    variant="default"
                    onOpen={() => onOpenTitle?.(title.netflixId)}
                    onPlay={() => openPlay(title)}
                    myListSaved={savedIds.has(title.netflixId)}
                    onToggleMyList={onToggleMyList === undefined ? undefined : () => onToggleMyList(title)}
                  />
                ))}
              </div>
            </section>
          )}

          {rails.map((rail) => (
            <NetflixRailInline
              key={`${country}-${rail.key}`}
              rail={rail}
              onOpenTitle={(id) => onOpenTitle?.(id)}
              onPlay={openPlay}
              myList={myList}
              onToggleMyList={onToggleMyList}
            />
          ))}

          <p style={styles.sourceNote} data-testid="netflix-source-note">
            {view.sourceNote} · {view.catalogSize} tracked titles
          </p>
        </>
      )}

      <NetflixPlayHandoff
        title={handoffTitle}
        onClose={() => setHandoffTitle(null)}
        onOpenExternal={(url) => onOpenExternal?.(url)}
      />
    </section>
  );
}
