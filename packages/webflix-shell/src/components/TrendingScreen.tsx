// The trending surface (WFX-UX-SHELL-1, deliverable 5): the frozen §9
// TrendingView — region line (honest when not set), category chips, the
// chart grid of video cards, cursor paging, phase-gated honestly.

import React from "react";
import { theme } from "../theme";
import type { TrendingView, VideoCardView } from "webflix-contracts";
import { CategoryChipRow } from "./media/CategoryChipRow";
import { LoadMoreControl } from "./media/LoadMore";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";

export interface TrendingScreenProps {
  readonly view?: TrendingView | null;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  readonly onChipSelect?: (chip: string | null) => void;
  readonly onLoadMore?: (cursor: string) => void;
  readonly onRetry?: () => void;
  readonly loadingMore?: boolean;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    minWidth: 0,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl, fontWeight: 600 },
  region: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
};

export function TrendingScreen(props: TrendingScreenProps): React.ReactElement {
  const {
    view,
    onPlayCard,
    onOpenChannel,
    onChipSelect,
    onLoadMore,
    onRetry,
    loadingMore = false,
  } = props;

  if (view === null || view === undefined) {
    return (
      <section aria-label="Trending" style={styles.root}>
        <ViewNotProvided surfaceLabel="Trending" testIdPrefix="trending" />
      </section>
    );
  }

  return (
    <section aria-label="Trending" style={styles.root} data-testid="trending-root">
      <h1 style={styles.heading}>Trending</h1>
      <p data-testid="trending-region" style={styles.region}>
        Region: {view.region ?? "not set — the producer sent none"}
      </p>

      {view.chips.length > 0 && (
        <CategoryChipRow
          chips={view.chips}
          selected={view.selectedChip}
          onSelect={
            onChipSelect === undefined ? undefined : (chip: string) => onChipSelect(chip)
          }
          testId="trending-chips"
          ariaLabel="Trending categories"
        />
      )}

      {view.phase !== "ready" && (
        <MediaPhasePanel
          phase={view.phase}
          detail={view.detail}
          surfaceLabel="Trending"
          onRetry={onRetry}
          skeletonCount={view.phase === "loading" ? 4 : 0}
          testIdPrefix="trending"
        />
      )}

      {view.videos.length > 0 ? (
        <MediaCardGrid
          cards={view.videos}
          onPlay={onPlayCard}
          onOpenChannel={onOpenChannel}
          testId="trending-grid"
        />
      ) : (
        view.phase === "ready" && (
          <p data-testid="trending-empty" style={styles.muted}>
            The trending chart returned no rows for this region and category. That is everything
            the producer said — nothing is padded.
          </p>
        )
      )}

      <LoadMoreControl
        nextCursor={view.nextCursor}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        surfaceLabel="trending chart"
        testId="trending-load-more"
      />
    </section>
  );
}
