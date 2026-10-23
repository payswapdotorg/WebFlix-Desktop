// The history surface (WFX-UX-SHELL-1, deliverable 5): the frozen §9
// HistoryView — grouped continue-watching cards with progress overlays.
// The groups and their labels are the producer's own; the shell renders
// them verbatim and invents neither rows nor groups.

import React from "react";
import { theme } from "../theme";
import type { HistoryView, VideoCardView } from "webflix-contracts";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import type { VideoCardProgress } from "./media/VideoCard";

export interface HistoryScreenProps {
  readonly view?: HistoryView | null;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  readonly onRetry?: () => void;
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
  group: { display: "flex", flexDirection: "column", gap: theme.spacing.sm, minWidth: 0 },
  groupTitle: {
    margin: 0,
    fontSize: theme.typography.sizes.md,
    fontWeight: 600,
    color: theme.colors.textMuted,
  },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
};

export function HistoryScreen(props: HistoryScreenProps): React.ReactElement {
  const { view, onPlayCard, onOpenChannel, onRetry } = props;

  if (view === null || view === undefined) {
    return (
      <section aria-label="History" style={styles.root}>
        <ViewNotProvided surfaceLabel="History" testIdPrefix="history" />
      </section>
    );
  }

  return (
    <section aria-label="History" style={styles.root} data-testid="history-root">
      <h1 style={styles.heading}>History</h1>

      {view.phase !== "ready" && (
        <MediaPhasePanel
          phase={view.phase}
          detail={view.detail}
          surfaceLabel="History"
          onRetry={onRetry}
          testIdPrefix="history"
        />
      )}

      {view.groups.length > 0 ? (
        view.groups.map((group, index) => {
          const progressByItemId = new Map<string, VideoCardProgress>(
            group.items.map((item) => [
              item.item.id,
              { percent: item.progressPercent, label: item.progressLabel },
            ]),
          );
          return (
            <section
              key={`${group.label}-${index}`}
              aria-label={`History — ${group.label}`}
              style={styles.group}
              data-testid={`history-group-${index}`}
            >
              <h2 style={styles.groupTitle}>{group.label}</h2>
              <MediaCardGrid
                cards={group.items}
                onPlay={onPlayCard}
                onOpenChannel={onOpenChannel}
                progressByItemId={progressByItemId}
              />
            </section>
          );
        })
      ) : (
        view.phase === "ready" && (
          <p data-testid="history-empty" style={styles.muted}>
            No watch history yet. What you watch shows up here as continue-watching rows — this
            surface never fills itself with anything else.
          </p>
        )
      )}
    </section>
  );
}
