// WFX-NETFLIX-SOURCE-1 — the Netflix card + rail atoms (the web app's
// netflix-card.tsx / netflix-rail.tsx, ported into the shell's inline-style
// idiom): the 16:9 boxart tile, the big outlined rank numeral riding the
// card's left edge (the Netflix Top-10 site idiom), the maturity badge, and
// one horizontal rail per Tudum pool. Extracted from NetflixScreen.tsx for
// the repo's max-lines law; NetflixTitleScreen consumes the card too.

import React from "react";
import { theme } from "../theme";
import type { NetflixRailView, NetflixTitleCard } from "webflix-contracts";
import { NETFLIX_COLORS } from "./netflixColors";

/** The hover idioms the inline-style system cannot express (rank stroke + card scale). */
export const NETFLIX_HOVER_STYLES = `
.wfx-nf-card:hover .wfx-nf-tile { transform: scale(1.03); }
.wfx-nf-card:focus-visible .wfx-nf-tile { outline: 2px solid #e50914; outline-offset: 2px; }
.wfx-nf-card:hover .wfx-nf-rank { -webkit-text-stroke: 2.5px #e50914; }
`;

const styles: Record<string, React.CSSProperties> = {
  rail: { display: "flex", flexDirection: "column", gap: theme.spacing.md, marginTop: theme.spacing.xl },
  railHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minWidth: 0,
  },
  railTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  railCountry: { marginLeft: 8, fontSize: theme.typography.sizes.md, fontWeight: 400, color: "rgba(255,255,255,0.5)" },
  railWeek: { fontSize: 12, color: "rgba(255,255,255,0.4)", flexShrink: 0 },
  railRow: { display: "flex", gap: theme.spacing.lg, overflowX: "auto", paddingBottom: 8 },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    width: 232,
    flexShrink: 0,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  },
  cardMediaRow: { display: "flex", alignItems: "flex-end", gap: 4, width: "100%" },
  rank: {
    fontSize: 64,
    fontWeight: 900,
    lineHeight: 0.8,
    paddingBottom: 4,
    color: NETFLIX_COLORS.rankFill,
    WebkitTextStroke: `2.5px ${NETFLIX_COLORS.rankStroke}`,
    marginRight: -12,
    flexShrink: 0,
    userSelect: "none",
    transition: "-webkit-text-stroke 150ms ease",
  },
  tile: {
    position: "relative",
    aspectRatio: "16 / 9",
    width: "100%",
    overflow: "hidden",
    borderRadius: theme.radii.lg,
    background: NETFLIX_COLORS.tile,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.10)",
    transition: "transform 200ms ease",
    minWidth: 0,
  },
  tileImg: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  tileFallback: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    textAlign: "center",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
    color: "rgba(255,255,255,0.8)",
    background: `linear-gradient(135deg, ${NETFLIX_COLORS.tile}, ${NETFLIX_COLORS.tileDeep})`,
  },
  maturity: {
    position: "absolute",
    top: 6,
    right: 6,
    padding: "1px 4px",
    borderRadius: 3,
    border: "1px solid rgba(255,255,255,0.3)",
    background: "rgba(0,0,0,0.6)",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.9)",
  },
  cardTitle: {
    margin: 0,
    marginTop: 8,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 500,
    color: "rgba(255,255,255,0.95)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  cardMeta: {
    margin: 0,
    marginTop: 2,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
};

export function NetflixCardInline(props: {
  title: NetflixTitleCard;
  rank?: number | null;
  onOpen: () => void;
}): React.ReactElement {
  const { title, rank, onOpen } = props;
  const rankOf = rank ?? title.weeklyRank ?? title.allTimeRank ?? null;
  return (
    <button
      type="button"
      className="wfx-nf-card"
      aria-label={`${title.title}${rankOf !== null ? ` — number ${rankOf}` : ""}`}
      style={styles.card}
      onClick={onOpen}
      data-testid={`netflix-card-${title.netflixId}`}
    >
      <span style={styles.cardMediaRow}>
        {rankOf !== null && (
          <span aria-hidden="true" className="wfx-nf-rank" style={styles.rank}>
            {rankOf}
          </span>
        )}
        <span className="wfx-nf-tile" style={styles.tile}>
          {title.posterUrl !== null ? (
            <img src={title.posterUrl} alt="" loading="lazy" style={styles.tileImg} />
          ) : (
            <span style={styles.tileFallback}>{title.title}</span>
          )}
          {title.maturityRating !== null && (
            <span style={styles.maturity}>{title.maturityRating}</span>
          )}
        </span>
      </span>
      <span style={styles.cardTitle}>{title.title}</span>
      <span style={styles.cardMeta}>
        {[title.releaseYear !== null ? String(title.releaseYear) : null, title.kind === "series" ? "Series" : "Film"]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </button>
  );
}

export function NetflixRailInline(props: {
  rail: NetflixRailView;
  onOpenTitle: (netflixId: number) => void;
}): React.ReactElement {
  const { rail, onOpenTitle } = props;
  if (rail.titles.length === 0) return <></>;
  return (
    <section aria-label={rail.label} style={styles.rail} data-testid={`netflix-rail-${rail.key}`}>
      <div style={styles.railHeader}>
        <h2 style={styles.railTitle}>
          {rail.label}
          <span style={styles.railCountry}>· {rail.country !== "Global" ? rail.country : "Global"}</span>
        </h2>
        {rail.weekEndDate !== null && (
          <span style={styles.railWeek}>week of {rail.weekEndDate}</span>
        )}
      </div>
      <div className="wfx-scroll" style={styles.railRow}>
        {rail.titles.map((title, i) => (
          <NetflixCardInline
            key={`${rail.key}-${title.netflixId}`}
            title={title}
            rank={i + 1}
            onOpen={() => onOpenTitle(title.netflixId)}
          />
        ))}
      </div>
    </section>
  );
}
