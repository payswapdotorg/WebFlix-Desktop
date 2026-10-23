// The subscriptions surface (WFX-UX-SHELL-1, deliverable 5): the frozen §9
// SubscriptionsView — a channel rail (horizontal ChannelCard shelf), the
// composed uploads grid, and the BINDING degradeNote (freeze §9.2: a
// subscriptions compose from per-channel upload polling MUST say so). The
// not-connected producer answers requires-auth; the panel renders that
// honestly — `channels` may be empty and nothing is invented.

import React from "react";
import { theme } from "../theme";
import type { SubscriptionsView, VideoCardView } from "webflix-contracts";
import { ChannelCard } from "./media/ChannelCard";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";

export interface SubscriptionsScreenProps {
  readonly view?: SubscriptionsView | null;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId: string; handle?: string }) => void;
  readonly onRetry?: () => void;
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
  degradeNote: {
    margin: 0,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.warning}`,
    borderRadius: theme.radii.md,
    color: theme.colors.warning,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.5,
  },
  channelRail: {
    display: "flex",
    gap: theme.spacing.md,
    overflowX: "auto",
    overflowY: "hidden",
    padding: 0,
    margin: 0,
    listStyle: "none",
    minWidth: 0,
    paddingBottom: theme.spacing.xs,
    scrollSnapType: "x proximity",
  },
  sectionTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
};

export function SubscriptionsScreen(props: SubscriptionsScreenProps): React.ReactElement {
  const { view, onPlayCard, onOpenChannel, onRetry } = props;

  if (view === null || view === undefined) {
    return (
      <section aria-label="Subscriptions" style={styles.root}>
        <ViewNotProvided surfaceLabel="Subscriptions" testIdPrefix="subscriptions" />
      </section>
    );
  }

  return (
    <section aria-label="Subscriptions" style={styles.root} data-testid="subscriptions-root">
      <h1 style={styles.heading}>Subscriptions</h1>

      {view.degradeNote && (
        <p data-testid="subscriptions-degrade-note" style={styles.degradeNote} role="status">
          {view.degradeNote}
        </p>
      )}

      {view.phase !== "ready" && (
        <MediaPhasePanel
          phase={view.phase}
          detail={view.detail}
          surfaceLabel="Subscriptions"
          onRetry={onRetry}
          testIdPrefix="subscriptions"
        />
      )}

      {view.channels.length > 0 ? (
        <section aria-label="Subscribed channels">
          <h2 style={styles.sectionTitle}>Channels</h2>
          <ul data-testid="subscriptions-channel-rail" style={styles.channelRail}>
            {view.channels.map((channel) => (
              <li key={channel.channelId}>
                <ChannelCard channel={channel} onOpenChannel={onOpenChannel} variant="rail" />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        view.phase === "ready" && (
          <p data-testid="subscriptions-channels-empty" style={styles.muted}>
            No subscribed channels came back for this account. YouTube exposes no
            subscriptions-feed API to third-party clients — the compose below is per-channel
            upload polling, labeled for exactly what it is.
          </p>
        )
      )}

      {view.videos.length > 0 ? (
        <section aria-label="Subscription uploads">
          <h2 style={styles.sectionTitle}>Latest from your subscriptions</h2>
          <MediaCardGrid
            cards={view.videos}
            onPlay={onPlayCard}
            testId="subscriptions-grid"
          />
        </section>
      ) : (
        view.phase === "ready" && (
          <p data-testid="subscriptions-videos-empty" style={styles.muted}>
            No uploads yet from the channels above — the grid fills only with real rows.
          </p>
        )
      )}
    </section>
  );
}
