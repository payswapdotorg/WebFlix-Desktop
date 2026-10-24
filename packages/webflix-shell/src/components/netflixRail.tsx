// WFX-NETFLIX-P45-LOOK-1 — the Netflix rail atom (the web app's P45
// netflix-rail.tsx, ported into the shell's inline-style idiom): the header
// with the "TOP 10" red tag on ranked rows, and the hover-revealed chevron
// paging (an 85%-viewport smooth step, keyboard reachable). Weekly rows
// render the ranked portrait cards with the giant numerals; the Most
// Popular rows stay 16:9. Extracted from netflixCard.tsx for the repo's
// max-lines law (the netflixCard.tsx precedent). Renders nothing when the
// pool dropped out (the honest absence).

import React, { useRef, useState } from "react";
import { theme } from "../theme";
import type { NetflixRailView, NetflixTitleCard } from "webflix-contracts";
import { NetflixCardInline } from "./netflixCard";
import { NETFLIX_COLORS } from "./netflixColors";

const styles: Record<string, React.CSSProperties> = {
  rail: { position: "relative", display: "flex", flexDirection: "column", marginTop: 28 },
  railHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    padding: "0 16px",
    minWidth: 0,
  },
  railTitle: {
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: theme.typography.sizes.lg,
    fontWeight: 600,
  },
  top10Tag: {
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
    flexShrink: 0,
  },
  railCountry: { fontSize: theme.typography.sizes.md, fontWeight: 400, color: "rgba(255,255,255,0.5)" },
  railWeek: { fontSize: 12, color: "rgba(255,255,255,0.4)", flexShrink: 0 },
  scrollerWrap: { position: "relative", marginTop: 12 },
  railRow: { display: "flex", gap: 12, overflowX: "auto", scrollBehavior: "smooth", padding: "16px 16px" },
  chevron: {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 20,
    height: "70%",
    width: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
    color: "#ffffff",
    border: "none",
    font: "inherit",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
  },
  chevronLeft: { left: 0, borderRadius: "0 6px 6px 0" },
  chevronRight: { right: 0, borderRadius: "6px 0 0 6px" },
};

export interface NetflixRailInlineProps {
  readonly rail: NetflixRailView;
  readonly onOpenTitle: (netflixId: number) => void;
  /** The hover sheets' Play circles (the host's play path). */
  readonly onPlay?: (title: NetflixTitleCard) => void;
  /** The session-scoped My List (drives the + circles' saved state). */
  readonly myList?: readonly NetflixTitleCard[];
  /** The My List toggle. */
  readonly onToggleMyList?: (title: NetflixTitleCard) => void;
}

export function NetflixRailInline(props: NetflixRailInlineProps): React.ReactElement {
  const { rail, onOpenTitle, onPlay, myList, onToggleMyList } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  if (rail.titles.length === 0) return <></>;
  const ranked = rail.ranking === "weekly";

  const page = (dir: -1 | 1): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const updateArrows = (): void => {
    const el = scrollerRef.current;
    if (el === null) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  return (
    <section
      aria-label={rail.label}
      className="wfx-nf-rail"
      style={styles.rail}
      data-testid={`netflix-rail-${rail.key}`}
    >
      <div style={styles.railHeader}>
        <h2 style={styles.railTitle}>
          {ranked && (
            <span aria-hidden="true" style={styles.top10Tag}>
              TOP 10
            </span>
          )}
          {rail.label}
          <span style={styles.railCountry}>· {rail.country}</span>
        </h2>
        {rail.weekEndDate !== null && <span style={styles.railWeek}>week of {rail.weekEndDate}</span>}
      </div>
      <div style={styles.scrollerWrap}>
        <button
          type="button"
          className="wfx-nf-chevron"
          style={{ ...styles.chevron, ...styles.chevronLeft }}
          disabled={!canPrev}
          aria-label={`Scroll ${rail.label} back`}
          onClick={() => page(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          className="wfx-nf-chevron"
          style={{ ...styles.chevron, ...styles.chevronRight }}
          disabled={!canNext}
          aria-label={`Scroll ${rail.label} forward`}
          onClick={() => page(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
        <div
          ref={scrollerRef}
          className="wfx-nf-scroll"
          style={styles.railRow}
          onScroll={updateArrows}
          data-testid={`netflix-rail-scroll-${rail.key}`}
        >
          {rail.titles.map((title, i) => (
            <NetflixCardInline
              key={`${rail.key}-${title.netflixId}`}
              title={title}
              rank={ranked ? i + 1 : null}
              variant={ranked ? "ranked" : "default"}
              onOpen={() => onOpenTitle(title.netflixId)}
              onPlay={onPlay === undefined ? undefined : () => onPlay(title)}
              myListSaved={(myList ?? []).some((t) => t.netflixId === title.netflixId)}
              onToggleMyList={onToggleMyList === undefined ? undefined : () => onToggleMyList(title)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
