// WFX-NETFLIX-SOURCE-1 — the Netflix hub surface (the web app's
// src/app/netflix/view.tsx + netflix-hero.tsx, ported into the shell's
// token-driven inline-style idiom). The Netflix sub-brand's own palette is
// carried as LOCAL constants in netflixColors.ts (the web app's
// arbitrary-value classes — #0a0a0c canvas, #e50914 red): the frozen shell
// theme stays untouched.
//
// Honest laws (ADR 0002): every row is Netflix's own published Top 10 data;
// an unreachable upstream renders the unavailable phase — never fake rows;
// playback hands off to Netflix's official player (the hand-off dialog);
// the provenance footnote names the source.

import React, { useState } from "react";
import { theme } from "../theme";
import type { NetflixHomeView, NetflixTitleCard } from "webflix-contracts";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import { NetflixPlayHandoff } from "./netflixPlayHandoff";
import { NetflixRailInline, NETFLIX_HOVER_STYLES } from "./netflixCard";
import { NETFLIX_COLORS } from "./netflixColors";

const COUNTRIES = [
  { id: "Global", label: "Global" },
  { id: "US", label: "United States" },
] as const;

export interface NetflixScreenProps {
  readonly view?: NetflixHomeView | null;
  /** The country view chips report here ("Global" | "US"). */
  readonly onSelectCountry?: (country: string) => void;
  /** A card click opens the title detail (the host routes it). */
  readonly onOpenTitle?: (netflixId: number) => void;
  /** The play hand-off's external open (the host owns the system-browser call). */
  readonly onOpenExternal?: (url: string) => void;
  readonly onRetry?: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    color: "#ffffff",
    minWidth: 0,
    minHeight: "70vh",
    // The Netflix sub-brand's own canvas (#0a0a0c) as a full-width surface
    // inside the shell's content gutters (the web app renders it edge-to-edge;
    // the desktop shell keeps its chrome — this is the faithful adaptation).
    background: NETFLIX_COLORS.canvas,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.lg,
    flex: 1,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  headerIdentity: { display: "flex", alignItems: "center", gap: theme.spacing.md, minWidth: 0 },
  brandChip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    padding: "0 10px",
    borderRadius: 4,
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    fontSize: 24,
    fontWeight: 900,
    lineHeight: 1,
    flexShrink: 0,
  },
  headerTitle: { margin: 0, fontSize: theme.typography.sizes.xl, fontWeight: 700 },
  headerSub: { margin: 0, fontSize: theme.typography.sizes.sm, color: "rgba(255,255,255,0.5)" },
  countryChips: { display: "flex", gap: theme.spacing.sm, flexShrink: 0 },
  countryChip: {
    height: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 500,
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.7)",
  },
  countryChipActive: { background: "#ffffff", color: "#000000" },
  sourceNote: {
    margin: 0,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
    textAlign: "center",
    fontSize: 12,
    color: "rgba(255,255,255,0.35)",
  },
};

export function NetflixScreen(props: NetflixScreenProps): React.ReactElement {
  const { view, onSelectCountry, onOpenTitle, onOpenExternal, onRetry } = props;
  const [handoffTitle, setHandoffTitle] = useState<NetflixTitleCard | null>(null);

  if (view === null || view === undefined) {
    return (
      <section aria-label="Netflix" style={styles.root}>
        <ViewNotProvided surfaceLabel="Netflix" testIdPrefix="netflix" />
      </section>
    );
  }

  const country = view.country;

  return (
    <section aria-label="Netflix" style={styles.root} data-testid="netflix-root">
      <style>{NETFLIX_HOVER_STYLES}</style>

      <div style={styles.header}>
        <div style={styles.headerIdentity}>
          <span aria-hidden="true" style={styles.brandChip}>
            N
          </span>
          <div>
            <h1 style={styles.headerTitle}>Netflix on WebFlix</h1>
            <p style={styles.headerSub}>
              Netflix&apos;s official Top 10 &amp; Most Popular — browsed here, played on Netflix.
            </p>
          </div>
        </div>
        <div role="group" aria-label="Country view" style={styles.countryChips} data-testid="netflix-country-chips">
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

      {view.phase !== "ready" && (
        <div style={{ marginTop: theme.spacing.lg }}>
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

      {view.phase === "ready" && view.hero !== null && (
        <NetflixHeroInline title={view.hero} onPlay={() => setHandoffTitle(view.hero)} />
      )}

      {view.phase === "ready" &&
        view.rails.map((rail) => (
          <NetflixRailInline
            key={`${country}-${rail.key}`}
            rail={rail}
            onOpenTitle={(id) => onOpenTitle?.(id)}
          />
        ))}

      {view.phase === "ready" && (
        <p style={styles.sourceNote} data-testid="netflix-source-note">
          {view.sourceNote} · {view.catalogSize} tracked titles
        </p>
      )}

      <NetflixPlayHandoff
        title={handoffTitle}
        onClose={() => setHandoffTitle(null)}
        onOpenExternal={(url) => onOpenExternal?.(url)}
      />
    </section>
  );
}

function NetflixHeroInline(props: { title: NetflixTitleCard; onPlay: () => void }): React.ReactElement {
  const { title, onPlay } = props;
  const [artBroken, setArtBroken] = useState(false);
  const isSeries = title.kind === "series";
  const metaBits = [
    title.releaseYear !== null ? String(title.releaseYear) : null,
    isSeries ? "Series" : "Film",
    title.maturityRating,
    title.weeksInTop10 !== null
      ? `${title.weeksInTop10} ${title.weeksInTop10 === 1 ? "week" : "weeks"} in Top 10`
      : null,
  ].filter(Boolean) as string[];

  return (
    <section
      aria-label="Featured on Netflix"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: theme.radii.xl,
        marginTop: theme.spacing.md,
      }}
      data-testid="netflix-hero"
    >
      <div
        style={{
          position: "relative",
          minHeight: 280,
          background: `linear-gradient(135deg, ${NETFLIX_COLORS.tile}, ${NETFLIX_COLORS.tileDeep})`,
        }}
      >
        {title.backdropUrl !== null && !artBroken && (
          <img
            src={title.backdropUrl}
            alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setArtBroken(true)}
          />
        )}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to top, ${NETFLIX_COLORS.canvas} 0%, rgba(10,10,12,0.55) 50%, transparent 100%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to right, rgba(10,10,12,0.8), transparent 60%)`,
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            gap: 12,
            padding: 32,
            maxWidth: 672,
            minHeight: 280,
          }}
        >
          {title.logoUrl !== null && !artBroken ? (
            <img
              src={title.logoUrl}
              alt={title.title}
              style={{ maxHeight: 56, width: "auto", maxWidth: "70%", objectFit: "contain" }}
            />
          ) : (
            <h2 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#ffffff" }}>{title.title}</h2>
          )}
          <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 8, fontSize: theme.typography.sizes.sm, color: "rgba(255,255,255,0.7)" }}>
            <span
              style={{
                padding: "2px 6px",
                borderRadius: 3,
                background: NETFLIX_COLORS.red,
                color: "#ffffff",
                fontSize: 10,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Top {title.weeklyRank ?? 1}
            </span>
            {metaBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
          </p>
          {title.synopsis !== "" && (
            <p
              style={{
                margin: 0,
                maxWidth: 560,
                fontSize: theme.typography.sizes.sm,
                lineHeight: 1.6,
                color: "rgba(255,255,255,0.85)",
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {title.synopsis}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, paddingTop: 4 }}>
            <button
              type="button"
              onClick={onPlay}
              data-testid="netflix-hero-play"
              style={{
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
              }}
            >
              ▶ Play
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
