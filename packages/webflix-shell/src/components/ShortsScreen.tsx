// The shorts surface (WFX-UX-SHELL-1, deliverable 5): the frozen §9
// ShortsView as a vertical full-bleed feed of 9:16 tiles, each carrying its
// own play action. Honest phases: the not-connected producer answers
// requires-auth and the panel says so — no invented shorts ever render.

import React from "react";
import { theme } from "../theme";
import type { ShortsView, VideoCardView } from "webflix-contracts";
import { LoadMoreControl } from "./media/LoadMore";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import { ShortsTile } from "./media/ShortsTile";

export interface ShortsScreenProps {
  readonly view?: ShortsView | null;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onLoadMore?: (cursor: string) => void;
  readonly onRetry?: () => void;
  readonly loadingMore?: boolean;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.lg,
    color: theme.colors.text,
    minWidth: 0,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl, fontWeight: 600 },
  feed: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.lg,
    listStyle: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
    // The vertical feed's own scroll-snap rhythm (progressive enhancement —
    // inert where the host lacks CSS snap support).
    scrollSnapType: "y proximity",
  },
  feedItem: { scrollSnapAlign: "start", display: "flex", justifyContent: "center", minWidth: 0 },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
};

export function ShortsScreen(props: ShortsScreenProps): React.ReactElement {
  const { view, onPlayCard, onLoadMore, onRetry, loadingMore = false } = props;

  if (view === null || view === undefined) {
    return (
      <section aria-label="Shorts" style={styles.root}>
        <ViewNotProvided surfaceLabel="Shorts" testIdPrefix="shorts" />
      </section>
    );
  }

  return (
    <section aria-label="Shorts" style={styles.root} data-testid="shorts-root">
      <h1 style={styles.heading}>Shorts</h1>

      {view.phase !== "ready" && (
        <MediaPhasePanel
          phase={view.phase}
          detail={view.detail}
          surfaceLabel="Shorts"
          onRetry={onRetry}
          skeletonCount={0}
          testIdPrefix="shorts"
        />
      )}

      {view.shorts.length > 0 ? (
        <ul data-testid="shorts-feed" style={styles.feed}>
          {view.shorts.map((short) => (
            <li key={short.item.id} style={styles.feedItem}>
              <ShortsTile short={short} onPlay={onPlayCard} variant="feed" />
            </li>
          ))}
        </ul>
      ) : (
        view.phase === "ready" && (
          <p data-testid="shorts-empty" style={styles.muted}>
            No shorts-classified rows came back. The feed stays empty rather than filling with
            long-form videos pretending to be shorts.
          </p>
        )
      )}

      <LoadMoreControl
        nextCursor={view.nextCursor}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        surfaceLabel="shorts feed"
        testId="shorts-load-more"
      />
    </section>
  );
}
