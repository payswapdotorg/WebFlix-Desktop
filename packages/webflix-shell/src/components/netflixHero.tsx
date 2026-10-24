// WFX-NETFLIX-P45-LOOK-1 — the Netflix billboard (the web app's P45
// src/components/netflix/netflix-hero.tsx, ported into the shell's
// inline-style idiom). Netflix's own landing shape: a full-bleed backdrop
// stack that crossfades through the day's top 5 every 9s (paused on
// hover/focus, honoring prefers-reduced-motion), the "N FILM / N SERIES"
// kicker, logo art or the black title treatment, the TOP badge line, the
// synopsis, and the white Play + translucent More Info buttons with the
// My List button and the netflix.com hand-off circle at the right edge.
// The vertical progress dots are Netflix's own.
//
// Desktop honesty (the frozen §9 laws): Play opens the DRM hand-off dialog
// (the desktop has no in-app watch lane — the web app's cloud-desktop
// stream is the recorded follow-up); More Info opens the WebFlix title
// page; My List is the session-scoped host list; the hand-off circle opens
// the same dialog (the "on netflix.com instead" path).

import React, { useEffect, useRef, useState } from "react";
import { theme } from "../theme";
import type { NetflixTitleCard } from "webflix-contracts";
import { NETFLIX_COLORS } from "./netflixColors";

const ROTATE_MS = 9_000;

export interface NetflixBillboardProps {
  /** The day's top titles (the hub passes the weekly top 5, rank-sorted). */
  readonly titles: readonly NetflixTitleCard[];
  /** The white Play button — the host opens its play path (the hand-off). */
  readonly onPlay: (title: NetflixTitleCard) => void;
  /** More Info — the host routes to the WebFlix title page. */
  readonly onInfo: (netflixId: number) => void;
  /** The session-scoped My List (drives the current slide's saved state). */
  readonly myList: readonly NetflixTitleCard[];
  /** The My List toggle (the session-scoped host list). */
  readonly onToggleMyList?: (title: NetflixTitleCard) => void;
}

/** The hover/fade idioms the inline-style system cannot express. */
const BILLBOARD_STYLES = `
.wfx-nf-bb-play { transition: background-color 150ms ease; }
.wfx-nf-bb-play:hover { background: rgba(255,255,255,0.8); }
.wfx-nf-bb-info { transition: background-color 150ms ease; }
.wfx-nf-bb-info:hover { background: rgba(255,255,255,0.35); }
.wfx-nf-bb-handoff { transition: background-color 150ms ease; }
.wfx-nf-bb-handoff:hover { background: rgba(0,0,0,0.6); }
.wfx-nf-bb-dot { transition: all 200ms ease; }
`;

const styles: Record<string, React.CSSProperties> = {
  stage: {
    position: "relative",
    height: "clamp(380px, 56vw, 560px)",
    width: "100%",
    overflow: "hidden",
    background: NETFLIX_COLORS.tileDeep,
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: "opacity 1000ms ease",
  },
  scrimBottom: {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(to top, ${NETFLIX_COLORS.canvas} 0%, rgba(10,10,12,0.25) 50%, transparent 100%)`,
  },
  scrimLeft: {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(to right, ${NETFLIX_COLORS.canvas}, rgba(10,10,12,0.55) 50%, transparent 100%)`,
  },
  copy: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 12,
    height: "100%",
    padding: "96px 4vw 56px",
    boxSizing: "border-box",
  },
  kicker: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "rgba(255,255,255,0.9)",
  },
  kickerN: { fontSize: 24, fontWeight: 900, lineHeight: 1, color: NETFLIX_COLORS.red },
  logoArt: {
    maxHeight: 80,
    width: "auto",
    maxWidth: "55%",
    objectFit: "contain",
    filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
  },
  titleArt: {
    margin: 0,
    maxWidth: 768,
    fontSize: 34,
    fontWeight: 900,
    lineHeight: 1.15,
    color: "#ffffff",
    filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
  },
  badgeLine: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    fontSize: theme.typography.sizes.sm,
    color: "rgba(255,255,255,0.85)",
  },
  badgeRank: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 700,
    color: "#ffffff",
  },
  badgeTop: {
    display: "flex",
    alignItems: "center",
    height: 20,
    padding: "0 4px",
    borderRadius: 2,
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
  },
  badgeMaturity: {
    padding: "0 6px",
    borderRadius: 3,
    border: "1px solid rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: 600,
  },
  synopsis: {
    margin: 0,
    maxWidth: 560,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.6,
    color: "rgba(255,255,255,0.9)",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 4 },
  play: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 24px",
    borderRadius: 4,
    border: "none",
    background: "#ffffff",
    color: "#000000",
    font: "inherit",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  },
  info: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 44,
    padding: "0 20px",
    borderRadius: 4,
    border: "none",
    background: "rgba(255,255,255,0.25)",
    color: "#ffffff",
    font: "inherit",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    backdropFilter: "blur(4px)",
  },
  rightCluster: { display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" },
  myList: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    padding: "0 16px",
    borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.1)",
    color: "#ffffff",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 500,
    cursor: "pointer",
  },
  myListSaved: { borderColor: "rgba(229,9,20,0.6)" },
  handoff: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.4)",
    background: "rgba(0,0,0,0.4)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 700,
    font: "inherit",
    cursor: "pointer",
  },
  dots: {
    position: "absolute",
    right: 16,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 4,
    height: 4,
    padding: 0,
    borderRadius: 999,
    border: "none",
    background: "rgba(255,255,255,0.5)",
    cursor: "pointer",
  },
  dotActive: { height: 24, background: NETFLIX_COLORS.red },
};

export function NetflixBillboard(props: NetflixBillboardProps): React.ReactElement | null {
  const { titles, onPlay, onInfo, myList, onToggleMyList } = props;
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const list = titles.slice(0, 5);
  const count = list.length;

  useEffect(() => {
    reducedMotion.current =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (count < 2 || paused || reducedMotion.current) return;
    timerRef.current = setInterval(() => setIdx((i) => (i + 1) % count), ROTATE_MS);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [count, paused]);

  if (count === 0) return null;
  const title = list[Math.min(idx, count - 1)];
  const isSeries = title.kind === "series";
  const myListSaved = myList.some((t) => t.netflixId === title.netflixId);
  const rankLine = `#${title.weeklyRank ?? title.allTimeRank ?? 1} in ${isSeries ? "TV Shows" : "Movies"} Today`;

  return (
    <section
      aria-label="Featured on Netflix"
      data-testid="netflix-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <style>{BILLBOARD_STYLES}</style>
      <div style={styles.stage}>
        {list.map((t, i) => (
          <img
            key={t.netflixId}
            src={t.backdropUrl ?? t.posterUrl ?? ""}
            alt=""
            aria-hidden={i !== idx}
            loading={i === 0 ? "eager" : "lazy"}
            style={{ ...styles.backdrop, opacity: i === idx ? 1 : 0 }}
          />
        ))}
        <div style={styles.scrimBottom} />
        <div style={styles.scrimLeft} />
        <div style={styles.copy}>
          <p style={styles.kicker} data-testid="netflix-billboard-kicker">
            <span aria-hidden="true" style={styles.kickerN}>
              N
            </span>
            <span>{isSeries ? "SERIES" : "FILM"}</span>
          </p>
          {title.logoUrl !== null ? (
            <img key={title.netflixId} src={title.logoUrl} alt={title.title} style={styles.logoArt} />
          ) : (
            <h1 style={styles.titleArt}>{title.title}</h1>
          )}
          <p style={styles.badgeLine}>
            <span style={styles.badgeRank}>
              <span aria-hidden="true" style={styles.badgeTop}>
                TOP
              </span>
              <span>{rankLine}</span>
            </span>
            {title.releaseYear !== null && <span>{title.releaseYear}</span>}
            {title.maturityRating !== null && <span style={styles.badgeMaturity}>{title.maturityRating}</span>}
            {title.weeksInTop10 !== null && title.weeksInTop10 > 1 && (
              <span style={{ color: "rgba(255,255,255,0.7)" }}>
                {title.weeksInTop10} weeks in the Top 10
              </span>
            )}
          </p>
          {title.synopsis !== "" && <p style={styles.synopsis}>{title.synopsis}</p>}
          <div style={styles.actions}>
            <button
              type="button"
              className="wfx-nf-bb-play"
              style={styles.play}
              data-testid="netflix-hero-play"
              onClick={() => onPlay(title)}
            >
              ▶ Play
            </button>
            <button
              type="button"
              className="wfx-nf-bb-info"
              style={styles.info}
              data-testid="netflix-hero-info"
              onClick={() => onInfo(title.netflixId)}
            >
              More Info
            </button>
            <div style={styles.rightCluster}>
              {onToggleMyList !== undefined && (
                <button
                  type="button"
                  style={{ ...styles.myList, ...(myListSaved ? styles.myListSaved : undefined) }}
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
              <button
                type="button"
                className="wfx-nf-bb-handoff"
                style={styles.handoff}
                data-testid="netflix-hero-handoff"
                aria-label={`Open ${title.title} on netflix.com instead`}
                onClick={() => onPlay(title)}
              >
                <span aria-hidden="true">N</span>
              </button>
            </div>
          </div>
        </div>
        {count > 1 && (
          <div role="tablist" aria-label="Featured titles" style={styles.dots} data-testid="netflix-billboard-dots">
            {list.map((t, i) => (
              <button
                key={t.netflixId}
                type="button"
                role="tab"
                className="wfx-nf-bb-dot"
                aria-selected={i === idx}
                aria-label={`Show ${t.title}`}
                style={{ ...styles.dot, ...(i === idx ? styles.dotActive : undefined) }}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
