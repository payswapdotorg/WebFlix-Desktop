// WFX-NETFLIX-SOURCE-1 — the Netflix title-detail surface (the web app's
// src/app/netflix/t/[id]/view.tsx, ported into the shell's inline-style
// idiom): hero backdrop + logo art + meta bits, the play hand-off, the
// where-it-ranks pills, and the same-pool "More like this" rail. Non-ready
// phases render the honest phase panel — never a fabricated title.

import React, { useState } from "react";
import { theme } from "../theme";
import type { NetflixTitleCard, NetflixTitleView } from "webflix-contracts";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import { NetflixPlayHandoff } from "./netflixPlayHandoff";
import { NetflixCardInline, NETFLIX_HOVER_STYLES } from "./netflixCard";
import { NETFLIX_COLORS } from "./netflixColors";

const COUNTRY_RANK_DISPLAY_CAP = 18;

export interface NetflixTitleScreenProps {
  readonly view?: NetflixTitleView | null;
  /** Back to the hub. */
  readonly onBack?: () => void;
  /** The play hand-off's external open (the host owns the system-browser call). */
  readonly onOpenExternal?: (url: string) => void;
  /** A "More like this" card click opens that title's detail. */
  readonly onOpenTitle?: (netflixId: number) => void;
  readonly onRetry?: () => void;
  /** The session-scoped My List (drives the button + the cards' + circles). */
  readonly myList?: readonly NetflixTitleCard[];
  /** The My List toggle (the hero button + the cards' + circles). */
  readonly onToggleMyList?: (title: NetflixTitleCard) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    color: "#ffffff",
    minWidth: 0,
    background: NETFLIX_COLORS.canvas,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.lg,
    flex: 1,
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.radii.xl,
    minHeight: 300,
    background: `linear-gradient(135deg, ${NETFLIX_COLORS.tile}, ${NETFLIX_COLORS.tileDeep})`,
  },
  heroImg: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  heroScrim: {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(to top, ${NETFLIX_COLORS.canvas} 0%, rgba(10,10,12,0.5) 50%, transparent 100%)`,
  },
  heroContent: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 12,
    padding: 32,
    maxWidth: 720,
  },
  backLink: {
    position: "absolute",
    top: 16,
    left: 20,
    zIndex: 1,
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.85)",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    cursor: "pointer",
    padding: "6px 10px",
    borderRadius: theme.radii.md,
  },
  backLinkStatic: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    color: "rgba(255,255,255,0.85)",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    cursor: "pointer",
    padding: "6px 10px",
    marginBottom: theme.spacing.md,
    borderRadius: theme.radii.md,
  },
  heroLogo: { maxHeight: 56, width: "auto", maxWidth: "70%", objectFit: "contain" },
  heroTitle: { margin: 0, fontSize: 32, fontWeight: 900, color: "#ffffff" },
  metaRow: { margin: 0, display: "flex", flexWrap: "wrap", gap: 8, fontSize: theme.typography.sizes.sm, color: "rgba(255,255,255,0.7)" },
  metaRankPill: {
    padding: "2px 6px",
    borderRadius: 3,
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  synopsis: { margin: 0, maxWidth: 640, fontSize: theme.typography.sizes.md, lineHeight: 1.6, color: "rgba(255,255,255,0.85)" },
  actionsRow: { display: "flex", flexWrap: "wrap", gap: 12, paddingTop: 4 },
  playButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 24px",
    borderRadius: theme.radii.md,
    border: "none",
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
    cursor: "pointer",
  },
  // WFX-NETFLIX-P45-LOOK-1 — the My List button (the web app's
  // my-list-button.tsx hero variant, session-scoped here).
  myListButton: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 16px",
    borderRadius: theme.radii.md,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.1)",
    color: "#ffffff",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 500,
    cursor: "pointer",
  },
  myListButtonSaved: { borderColor: "rgba(229,9,20,0.6)" },
  section: { marginTop: theme.spacing.xl },
  sectionTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  rankPills: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: theme.spacing.md },
  rankPill: {
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
  },
  rankPillBest: {
    background: NETFLIX_COLORS.red,
    borderColor: NETFLIX_COLORS.red,
    color: "#ffffff",
    fontWeight: 600,
  },
  railRow: { display: "flex", gap: theme.spacing.lg, overflowX: "auto", marginTop: theme.spacing.md, paddingBottom: 8 },
};

export function NetflixTitleScreen(props: NetflixTitleScreenProps): React.ReactElement {
  const { view, onBack, onOpenExternal, onOpenTitle, onRetry, myList, onToggleMyList } = props;
  const [handoffTitle, setHandoffTitle] = useState<NetflixTitleCard | null>(null);
  const [artBroken, setArtBroken] = useState(false);

  if (view === null || view === undefined) {
    return (
      <section aria-label="Netflix title" style={styles.root}>
        <ViewNotProvided surfaceLabel="Netflix title" testIdPrefix="netflix-title" />
      </section>
    );
  }

  const title = view.title;
  const myListSaved =
    title !== null && (myList ?? []).some((m) => m.netflixId === title.netflixId);

  return (
    <section aria-label="Netflix title" style={styles.root} data-testid="netflix-title-root">
      <style>{NETFLIX_HOVER_STYLES}</style>
      {view.phase !== "ready" || title === null ? (
        <>
          {onBack !== undefined && (
            <button type="button" style={styles.backLinkStatic} onClick={onBack} data-testid="netflix-title-back">
              ← Netflix hub
            </button>
          )}
          <MediaPhasePanel
            phase={view.phase}
            detail={view.detail}
            surfaceLabel="Netflix title"
            onRetry={onRetry}
            testIdPrefix="netflix-title"
          />
        </>
      ) : (
        <>
          <div style={styles.hero} data-testid="netflix-title-hero">
            {title.backdropUrl !== null && !artBroken && (
              <img src={title.backdropUrl} alt="" style={styles.heroImg} onError={() => setArtBroken(true)} />
            )}
            <div style={styles.heroScrim} />
            {onBack !== undefined && (
              <button type="button" style={styles.backLink} onClick={onBack} data-testid="netflix-title-back">
                ← Netflix hub
              </button>
            )}
            <div style={styles.heroContent}>
              {title.logoUrl !== null && !artBroken ? (
                <img src={title.logoUrl} alt={title.title} style={styles.heroLogo} />
              ) : (
                <h1 style={styles.heroTitle}>{title.title}</h1>
              )}
              <p style={styles.metaRow}>
                <span style={styles.metaRankPill}>
                  Top {title.weeklyRank ?? title.allTimeRank ?? 10}
                </span>
                {titleMetaBits(title).map((bit) => (
                  <span key={bit}>{bit}</span>
                ))}
              </p>
              {title.synopsis !== "" && <p style={styles.synopsis}>{title.synopsis}</p>}
              <div style={styles.actionsRow}>
                <button
                  type="button"
                  style={styles.playButton}
                  data-testid="netflix-title-play"
                  onClick={() => setHandoffTitle(title)}
                >
                  ▶ Play on Netflix
                </button>
                {onToggleMyList !== undefined && (
                  <button
                    type="button"
                    style={{
                      ...styles.myListButton,
                      ...(myListSaved ? styles.myListButtonSaved : undefined),
                    }}
                    data-testid="netflix-my-list-toggle"
                    aria-pressed={myListSaved}
                    aria-label={
                      myListSaved ? `Remove ${title.title} from My List` : `Add ${title.title} to My List`
                    }
                    onClick={() => onToggleMyList(title)}
                  >
                    {myListSaved ? "✓ In My List" : "+ My List"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {view.countryRanks.length > 0 && (
            <div style={styles.section} data-testid="netflix-country-ranks">
              <h2 style={styles.sectionTitle}>Where it ranks</h2>
              <div style={styles.rankPills}>
                {view.countryRanks.slice(0, COUNTRY_RANK_DISPLAY_CAP).map((c) => (
                  <span
                    key={c.countryId}
                    style={{ ...styles.rankPill, ...(c.rank === 1 ? styles.rankPillBest : undefined) }}
                  >
                    {c.countryId} #{c.rank}
                  </span>
                ))}
              </div>
            </div>
          )}

          {view.relatedTitles.length > 0 && (
            <div style={styles.section}>
              <h2 style={styles.sectionTitle}>More like this</h2>
              <div className="wfx-nf-scroll" style={styles.railRow}>
                {view.relatedTitles.map((t) => (
                  <NetflixCardInline
                    key={t.netflixId}
                    title={t}
                    variant="default"
                    onOpen={() => onOpenTitle?.(t.netflixId)}
                    onPlay={() => setHandoffTitle(t)}
                    myListSaved={(myList ?? []).some((m) => m.netflixId === t.netflixId)}
                    onToggleMyList={
                      onToggleMyList === undefined ? undefined : () => onToggleMyList(t)
                    }
                  />
                ))}
              </div>
            </div>
          )}
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

function titleMetaBits(title: NetflixTitleCard): string[] {
  const bits = [
    title.releaseYear !== null ? String(title.releaseYear) : null,
    title.kind === "series" ? "Series" : "Film",
    title.maturityRating,
    title.weeksInTop10 !== null
      ? `${title.weeksInTop10} ${title.weeksInTop10 === 1 ? "week" : "weeks"} in the Top 10`
      : null,
  ];
  if (title.weeklyHoursViewed !== null && title.weeklyHoursViewed >= 1_000_000) {
    bits.push(`${(title.weeklyHoursViewed / 1_000_000).toFixed(1)}M hours viewed this week`);
  }
  return bits.filter(Boolean) as string[];
}
