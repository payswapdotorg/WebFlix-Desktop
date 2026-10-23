// The responsive media grid + horizontal rail (WFX-UX-SHELL-1).
//
// Responsive law: the grid is CSS auto-fill over minmax(min(320px, 100%),
// 1fr) columns — 1→2→3-up by CONTAINER width, never a horizontal page
// overflow (cards clamp at 100% on the narrowest containers). The rail is
// the reference's horizontal shelf: its own overflow-x scroll area (the
// intended horizontal surface), cards fixed-width inside it.
//
// Honesty law: `loadingSkeleton > 0` renders quiet placeholder tiles —
// skeletons are the loading PHASE's own visual, never fake rows.

import React from "react";
import { theme } from "../../theme";
import type { VideoCardView } from "webflix-contracts";
import { VideoCard, type VideoCardProgress } from "./VideoCard";

export interface MediaCardGridProps {
  readonly cards: readonly VideoCardView[];
  /** Card activation handler; absent = non-interactive cards. */
  readonly onPlay?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  /** `grid` = responsive multi-up; `rail` = horizontal scroller. */
  readonly layout?: "grid" | "rail";
  /** Progress facts keyed by item id (continue-watching grids). */
  readonly progressByItemId?: ReadonlyMap<string, VideoCardProgress>;
  /** Render N skeleton tiles (the loading phase's own visual). */
  readonly loadingSkeleton?: number;
  readonly testId?: string;
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))",
    gap: theme.spacing.md,
    minWidth: 0,
    maxWidth: "100%",
    padding: 0,
    margin: 0,
    listStyle: "none",
  },
  rail: {
    display: "flex",
    gap: theme.spacing.md,
    overflowX: "auto",
    overflowY: "hidden",
    minWidth: 0,
    padding: 0,
    margin: 0,
    listStyle: "none",
    // The rail is the ONLY intended horizontal scroller; a little breathing
    // room so focus rings are not clipped by the scroll container.
    paddingBottom: theme.spacing.xs,
    scrollSnapType: "x proximity",
  },
  skeletonTile: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  skeletonThumb: {
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: theme.radii.md,
    background: theme.colors.surfaceRaised,
    opacity: 0.7,
  },
  skeletonLine: {
    height: 12,
    borderRadius: theme.radii.sm,
    background: theme.colors.surfaceRaised,
    opacity: 0.7,
  },
};

export function MediaCardGrid(props: MediaCardGridProps): React.ReactElement {
  const {
    cards,
    onPlay,
    onOpenChannel,
    layout = "grid",
    progressByItemId,
    loadingSkeleton = 0,
    testId,
  } = props;
  const rootStyle = layout === "rail" ? styles.rail : styles.grid;

  return (
    <ul data-testid={testId ?? (layout === "rail" ? "media-card-rail" : "media-card-grid")} style={rootStyle}>
      {loadingSkeleton > 0 &&
        Array.from({ length: loadingSkeleton }, (_, index) => (
          <li
            key={`skeleton-${index}`}
            data-testid={`${testId ?? "media-card"}-skeleton-${index}`}
            aria-hidden="true"
            style={styles.skeletonTile}
          >
            <div style={styles.skeletonThumb} />
            <div style={{ ...styles.skeletonLine, width: "85%" }} />
            <div style={{ ...styles.skeletonLine, width: "55%" }} />
          </li>
        ))}
      {cards.map((card) => (
        <li
          key={card.item.id}
          style={{ display: "flex", minWidth: layout === "rail" ? undefined : 0 }}
        >
          <VideoCard
            card={card}
            onPlay={onPlay}
            onOpenChannel={onOpenChannel}
            variant={layout === "rail" ? "rail" : "grid"}
            progress={progressByItemId?.get(card.item.id)}
          />
        </li>
      ))}
    </ul>
  );
}
