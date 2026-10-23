// The channel surface (WFX-UX-SHELL-1, deliverable 5): the frozen §9
// ChannelView rendered as the reference pattern — a ChannelHeaderView
// identity band (banner + avatar + facts), tabs the producer can HONESTLY
// serve (availableTabs — never an invented tab), the videos grid, the
// shorts rail, and cursor paging. Phase-gated honestly: the panel renders
// for every non-ready phase; partial data still shows.

import React from "react";
import { theme } from "../theme";
import type { ChannelView, VideoCardView } from "webflix-contracts";
import { LoadMoreControl } from "./media/LoadMore";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { MediaPhasePanel, ViewNotProvided } from "./media/MediaPhasePanel";
import { ShortsTile } from "./media/ShortsTile";
import { Icon } from "./media/icons";

export interface ChannelScreenProps {
  /** The frozen channel view; null/undefined = the not-provided state. */
  readonly view?: ChannelView | null;
  /** The selected tab (the route's channelTab param). */
  readonly activeTab?: string;
  /** Fires when the user picks a tab the producer serves. */
  readonly onTabSelect?: (tab: string) => void;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onLoadMore?: (cursor: string) => void;
  readonly onRetry?: () => void;
  readonly loadingMore?: boolean;
}

const TAB_LABELS: Record<string, string> = {
  home: "Home",
  videos: "Videos",
  shorts: "Shorts",
  live: "Live",
  playlists: "Playlists",
  about: "About",
};

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    minWidth: 0,
  },
  banner: {
    width: "100%",
    aspectRatio: "6 / 1",
    objectFit: "cover",
    borderRadius: theme.radii.lg,
    display: "block",
    background: theme.colors.surfaceRaised,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    alignItems: "center",
    textAlign: "center",
    minWidth: 0,
  },
  avatarRow: { display: "flex", alignItems: "center", gap: theme.spacing.md },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: "50%",
    background: theme.colors.surfaceRaised,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.textMuted,
    flexShrink: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    margin: 0,
    fontSize: theme.typography.sizes.xl,
    fontWeight: 600,
  },
  meta: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  tabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    borderBottom: `1px solid ${theme.colors.border}`,
    paddingBottom: theme.spacing.sm,
    listStyle: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
  },
  tabButton: {
    background: "transparent",
    color: theme.colors.textMuted,
    border: "none",
    borderBottom: `2px solid transparent`,
    padding: "10px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
  },
  tabButtonActive: {
    color: theme.colors.text,
    fontWeight: 600,
    borderBottom: `2px solid ${theme.colors.accent}`,
  },
  tabButtonStatic: { cursor: "default" },
  sectionTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  shortsRail: {
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
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
};

export function ChannelScreen(props: ChannelScreenProps): React.ReactElement {
  const {
    view,
    activeTab,
    onTabSelect,
    onPlayCard,
    onLoadMore,
    onRetry,
    loadingMore = false,
  } = props;

  if (view === null || view === undefined) {
    return (
      <section aria-label="Channel" style={styles.root}>
        <ViewNotProvided surfaceLabel="Channel" testIdPrefix="channel" />
      </section>
    );
  }

  const { channel, availableTabs } = view;
  const selectedTab =
    activeTab !== undefined && (availableTabs as readonly string[]).includes(activeTab)
      ? activeTab
      : (availableTabs[0] ?? "videos");
  const metaParts = [
    channel.handle,
    channel.subscriberLabel,
    channel.videoCountLabel,
    channel.createdAtLabel,
  ].filter((part): part is string => part !== undefined);

  const shortsVisible = selectedTab === "home" || selectedTab === "shorts";
  const videosVisible =
    selectedTab === "home" || selectedTab === "videos" || selectedTab === "live";

  return (
    <section aria-label="Channel" style={styles.root} data-testid="channel-root">
      {channel.bannerUrl && (
        <img src={channel.bannerUrl} alt="" style={styles.banner} data-testid="channel-banner" />
      )}

      <header data-testid="channel-header" style={styles.header}>
        <div style={styles.avatarRow}>
          {channel.avatarUrl ? (
            <img src={channel.avatarUrl} alt="" style={styles.avatar} />
          ) : (
            <div style={styles.avatarPlaceholder} aria-hidden="true">
              <Icon name="accounts" size={34} />
            </div>
          )}
          <div>
            <h1 style={styles.titleRow}>
              {channel.title}
              {channel.verified && <Icon name="verified" size={18} title="Verified channel" />}
            </h1>
            {metaParts.length > 0 && <p style={styles.meta}>{metaParts.join(" · ")}</p>}
            {channel.description && <p style={styles.meta}>{channel.description}</p>}
          </div>
        </div>
      </header>

      <nav aria-label="Channel tabs" data-testid="channel-tabs">
        <ul style={styles.tabs}>
          {availableTabs.map((tab) => {
            const isActive = selectedTab === tab;
            const style = {
              ...styles.tabButton,
              ...(isActive ? styles.tabButtonActive : undefined),
              ...(onTabSelect === undefined ? styles.tabButtonStatic : undefined),
            };
            return (
              <li key={tab}>
                {onTabSelect === undefined ? (
                  <span
                    data-testid={`channel-tab-${tab}`}
                    aria-current={isActive ? "page" : undefined}
                    style={style}
                  >
                    {TAB_LABELS[tab] ?? tab}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid={`channel-tab-${tab}`}
                    aria-current={isActive ? "page" : undefined}
                    style={style}
                    onClick={() => onTabSelect(tab)}
                  >
                    {TAB_LABELS[tab] ?? tab}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {view.phase !== "ready" && (
        <MediaPhasePanel
          phase={view.phase}
          detail={view.detail}
          surfaceLabel={`${channel.title} — channel`}
          onRetry={onRetry}
          testIdPrefix="channel"
        />
      )}

      {videosVisible &&
        (view.videos.length > 0 ? (
          <section aria-label="Channel videos">
            <h2 style={styles.sectionTitle}>Videos</h2>
            <MediaCardGrid cards={view.videos} onPlay={onPlayCard} />
          </section>
        ) : (
          view.phase === "ready" && (
            <p data-testid="channel-videos-empty" style={styles.muted}>
              No videos on this tab yet — the producer returned none, and none are invented.
            </p>
          )
        ))}

      {shortsVisible &&
        view.shorts.length > 0 && (
          <section aria-label="Channel shorts">
            <h2 style={styles.sectionTitle}>Shorts</h2>
            <ul style={styles.shortsRail}>
              {view.shorts.map((short) => (
                <li key={short.item.id}>
                  <ShortsTile short={short} onPlay={onPlayCard} />
                </li>
              ))}
            </ul>
          </section>
        )}

      {shortsVisible &&
        view.phase === "ready" &&
        view.shorts.length === 0 &&
        selectedTab === "shorts" && (
          <p data-testid="channel-shorts-empty" style={styles.muted}>
            No shorts on this channel yet — nothing is invented to fill the shelf.
          </p>
        )}

      <LoadMoreControl
        nextCursor={view.nextCursor}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        surfaceLabel="channel videos"
        testId="channel-load-more"
      />
    </section>
  );
}
