// WFX-NETFLIX-SOURCE-1 — the Netflix card atom (the web app's P45
// netflix-card.tsx, ported into the shell's inline-style idiom).
// Extracted from NetflixScreen.tsx for the repo's max-lines law;
// NetflixTitleScreen and netflixRail.tsx consume the card too.
//
// WFX-NETFLIX-P45-LOOK-1 — the P45 card family, Netflix's own row look:
// - ranked (the weekly Top-10 rows): the PORTRAIT silhouette — the 1200x675
//   backdrop center-cropped 2:3, the giant outlined rank numeral (3px
//   #575760 stroke, red on hover) riding the card's left edge;
// - default (the Most Popular rows, My List, related): the 16:9 tile that
//   expands on hover/focus (scale 1.08, ring 1px -> 2px white/70) with the
//   SIBLING-overlay info sheet (Play circle + My List + circle + meta line)
//   — no nested interactive elements.

import React from "react";
import { theme } from "../theme";
import type { NetflixTitleCard } from "webflix-contracts";
import { NETFLIX_COLORS } from "./netflixColors";

/**
 * The hover/fade/paging idioms the inline-style system cannot express.
 * Injected by whichever screen renders cards (the class contract is local
 * to this module's family: the card, the rail, the my-list row).
 */
export const NETFLIX_HOVER_STYLES = `
.wfx-nf-tile { transition: transform 200ms ease, box-shadow 200ms ease; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10); }
.wfx-nf-default:hover .wfx-nf-tile, .wfx-nf-default:focus-within .wfx-nf-tile { transform: scale(1.08); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.70); }
.wfx-nf-tile:focus-visible { outline: 2px solid #e50914; outline-offset: 2px; }
.wfx-nf-card:hover .wfx-nf-rank, .wfx-nf-card:focus-within .wfx-nf-rank { -webkit-text-stroke: 3px #e50914; }
.wfx-nf-sheet { opacity: 0; transform: translateY(8px); transition: opacity 200ms ease, transform 200ms ease; }
.wfx-nf-card:hover .wfx-nf-sheet, .wfx-nf-card:focus-within .wfx-nf-sheet { opacity: 1; transform: translateY(0); }
.wfx-nf-sheet-btn { transition: transform 150ms ease; }
.wfx-nf-sheet-btn:hover { transform: scale(1.10); }
.wfx-nf-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.wfx-nf-scroll::-webkit-scrollbar { display: none; }
.wfx-nf-chevron { opacity: 0; transition: opacity 200ms ease; }
.wfx-nf-rail:hover .wfx-nf-chevron:not(:disabled) { opacity: 1; }
`;

const styles: Record<string, React.CSSProperties> = {
  card: { position: "relative", display: "flex", flexDirection: "column", flexShrink: 0 },
  cardDefault: { width: 232 },
  cardRanked: { width: 170 },
  mediaRow: { display: "flex", alignItems: "flex-end" },
  mediaRowDefault: { gap: 4, width: "100%" },
  rank: {
    fontSize: 110,
    fontWeight: 900,
    lineHeight: 0.78,
    color: NETFLIX_COLORS.canvas,
    WebkitTextStroke: `3px ${NETFLIX_COLORS.rankStroke}`,
    marginRight: -16,
    zIndex: 10,
    flexShrink: 0,
    userSelect: "none",
  },
  tile: {
    position: "relative",
    display: "block",
    width: "100%",
    overflow: "hidden",
    borderRadius: 6,
    background: NETFLIX_COLORS.tile,
    padding: 0,
    border: "none",
    cursor: "pointer",
    font: "inherit",
    minWidth: 0,
    textAlign: "left",
  },
  tileRanked: { aspectRatio: "2 / 3" },
  tileDefault: { aspectRatio: "16 / 9" },
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
  logoStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "40%",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingBottom: 8,
    background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
  },
  logoImg: { maxHeight: 40, width: "auto", maxWidth: "85%", objectFit: "contain" },
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
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: "none" },
  sheetInner: {
    background: "linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.7) 60%, transparent)",
    padding: "10px 10px 10px",
    paddingTop: 32,
  },
  sheetRow: { display: "flex", alignItems: "center", gap: 6 },
  circleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 999,
    border: "none",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1,
    cursor: "pointer",
    pointerEvents: "auto",
  },
  playCircle: { background: "#ffffff", color: "#000000", padding: 0 },
  addCircle: {
    background: "rgba(0,0,0,0.6)",
    color: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(255,255,255,0.4)",
    padding: 0,
  },
  addCircleSaved: { borderColor: "#ffffff", color: "#ffffff" },
  infoCircle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.4)",
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    marginLeft: "auto",
  },
  sheetMeta: {
    margin: 0,
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  sheetTop10: { fontWeight: 600, color: NETFLIX_COLORS.green, flexShrink: 0 },
  sheetSynopsis: {
    margin: 0,
    marginTop: 2,
    fontSize: 11,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.7)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  caption: { marginTop: 8, minWidth: 0, width: "100%" },
  captionTitle: {
    margin: 0,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 500,
    color: "rgba(255,255,255,0.95)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  captionMeta: {
    margin: 0,
    marginTop: 2,
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  captionRanked: {
    margin: 0,
    marginTop: 8,
    minWidth: 0,
    textAlign: "center",
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.9)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export interface NetflixCardInlineProps {
  readonly title: NetflixTitleCard;
  /** 1-based rank for the Top-10 numeral (null hides it). */
  readonly rank?: number | null;
  /** ranked = the weekly Top-10 portrait silhouette; default = the 16:9 tile. */
  readonly variant?: "default" | "ranked";
  /** The art (or the card body) opens the title detail. */
  readonly onOpen: () => void;
  /** The hover sheet's Play circle — the host's play path (the hand-off). */
  readonly onPlay?: () => void;
  /** The card's saved state on the session-scoped My List. */
  readonly myListSaved?: boolean;
  /** The hover sheet's + circle — the My List toggle. */
  readonly onToggleMyList?: () => void;
}

export function NetflixCardInline(props: NetflixCardInlineProps): React.ReactElement {
  const { title, rank, variant = "default", onOpen, onPlay, myListSaved = false, onToggleMyList } = props;
  const rankOf = rank ?? title.weeklyRank ?? title.allTimeRank ?? null;
  const ranked = variant === "ranked" && rankOf !== null;
  const metaBits = [title.releaseYear !== null ? String(title.releaseYear) : null, title.maturityRating].filter(
    Boolean,
  ) as string[];

  const onWrapperClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    // The card body opens the detail — except when the click landed on one
    // of the sheet's own buttons (the sibling-overlay pattern).
    if ((event.target as HTMLElement).closest("button") !== null) return;
    onOpen();
  };

  return (
    <div
      className={`wfx-nf-card ${ranked ? "wfx-nf-ranked" : "wfx-nf-default"}`}
      style={{ ...styles.card, ...(ranked ? styles.cardRanked : styles.cardDefault) }}
      data-testid={`netflix-card-${title.netflixId}`}
      onClick={onWrapperClick}
    >
      <div style={{ ...styles.mediaRow, ...(ranked ? undefined : styles.mediaRowDefault) }}>
        {ranked && (
          <span aria-hidden="true" className="wfx-nf-rank" style={styles.rank}>
            {rankOf}
          </span>
        )}
        <button
          type="button"
          className="wfx-nf-tile"
          style={{ ...styles.tile, ...(ranked ? styles.tileRanked : styles.tileDefault) }}
          aria-label={`${title.title} — details${rankOf !== null ? `, number ${rankOf} today` : ""}`}
          onClick={onOpen}
        >
          {(ranked ? title.backdropUrl ?? title.posterUrl : title.posterUrl) !== null ? (
            <img
              src={(ranked ? title.backdropUrl ?? title.posterUrl : title.posterUrl) ?? ""}
              alt=""
              loading="lazy"
              style={styles.tileImg}
            />
          ) : (
            <span style={styles.tileFallback}>{title.title}</span>
          )}
          {title.logoUrl !== null && (
            <span style={styles.logoStrip}>
              <img src={title.logoUrl} alt="" style={styles.logoImg} />
            </span>
          )}
          {title.maturityRating !== null && <span style={styles.maturity}>{title.maturityRating}</span>}
        </button>
      </div>

      {/* the hover sheet — a SIBLING of the art button (no nesting):
          the white Play circle + the My List + circle + the meta line */}
      <div className="wfx-nf-sheet" style={styles.sheet}>
        <div style={styles.sheetInner}>
          <div style={styles.sheetRow}>
            {onPlay !== undefined && (
              <button
                type="button"
                className="wfx-nf-sheet-btn"
                style={{ ...styles.circleBtn, ...styles.playCircle }}
                data-testid="netflix-card-play"
                aria-label={`Play ${title.title} in WebFlix`}
                onClick={onPlay}
              >
                <span aria-hidden="true">▶</span>
              </button>
            )}
            {onToggleMyList !== undefined && (
              <button
                type="button"
                className="wfx-nf-sheet-btn"
                style={{ ...styles.circleBtn, ...styles.addCircle, ...(myListSaved ? styles.addCircleSaved : undefined) }}
                data-testid="netflix-card-add"
                aria-pressed={myListSaved}
                aria-label={
                  myListSaved ? `Remove ${title.title} from My List` : `Add ${title.title} to My List`
                }
                onClick={onToggleMyList}
              >
                <span aria-hidden="true">{myListSaved ? "✓" : "+"}</span>
              </button>
            )}
            <span aria-hidden="true" style={styles.infoCircle}>
              ⓘ
            </span>
          </div>
          <p style={styles.sheetMeta}>
            <span style={styles.sheetTop10}>Top 10</span>
            {metaBits.length > 0 && <span>{metaBits.join(" · ")}</span>}
          </p>
          {title.synopsis !== "" && <p style={styles.sheetSynopsis}>{title.synopsis}</p>}
        </div>
      </div>

      {!ranked && (
        <div style={styles.caption}>
          <p style={styles.captionTitle}>{title.title}</p>
          <p style={styles.captionMeta}>
            {[title.releaseYear !== null ? String(title.releaseYear) : null, title.kind === "series" ? "Series" : "Film"]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {ranked && <p style={styles.captionRanked}>{title.title}</p>}
    </div>
  );
}
