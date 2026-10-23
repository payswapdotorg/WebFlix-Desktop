import React from "react";
import { theme } from "../theme";
import type {
  CatalogItem,
  ContinueCardView,
  HomeFeedView,
  HomeSectionView,
  ProviderAccountRecord,
  VideoCardView,
} from "webflix-contracts";
import { CategoryChipRow } from "./media/CategoryChipRow";
import { LoadMoreControl } from "./media/LoadMore";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { MediaPhasePanel } from "./media/MediaPhasePanel";
import { ShortsTile } from "./media/ShortsTile";
import { VideoCard, type VideoCardProgress } from "./media/VideoCard";

export interface HomeScreenProps {
  // Legacy surface (retained, ADDITIVE-only evolution): rendered when the
  // host has wired no HomeFeedView producer yet — the honest fallback, not
  // a fake feed. The old accounts/recent-items summary stays exactly as
  // the existing battery pins it.
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly recentItems?: readonly CatalogItem[];
  readonly onNavigate?: (screen: "search" | "library" | "accounts") => void;
  readonly onPlay?: (item: CatalogItem) => void;
  // WFX-UX-SHELL-1 (media-first feed): the frozen §9 HomeFeedView. When
  // present (any phase) the media feed renders instead of the legacy cards.
  readonly feed?: HomeFeedView | null;
  /** Host-provided in-flight fact for the append (disables + relabels). */
  readonly loadingMore?: boolean;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  readonly onChipSelect?: (chip: string | null) => void;
  /** The growing-grid append path (cursor pagination). */
  readonly onLoadMore?: (cursor: string) => void;
  readonly onRetry?: () => void;
  readonly onConnect?: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    minWidth: 0,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.display },
  intro: { margin: 0, maxWidth: 640, color: theme.colors.textMuted, lineHeight: 1.5 },
  card: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  cardTitle: { margin: 0, fontSize: theme.typography.sizes.lg },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  row: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
  },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  list: { listStyle: "none", margin: 0, padding: 0, width: "100%" },
  button: {
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 44,
  },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "6px 12px",
    cursor: "pointer",
    minHeight: 44,
  },
  // Feed surface styles.
  feedHeading: { margin: 0, fontSize: theme.typography.sizes.xl, fontWeight: 600 },
  compositionNote: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.5,
  },
  section: { display: "flex", flexDirection: "column", gap: theme.spacing.sm, minWidth: 0 },
  sectionTitle: {
    margin: 0,
    fontSize: theme.typography.sizes.lg,
    fontWeight: 600,
    color: theme.colors.text,
  },
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
  continueGrid: {
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
};

export function HomeScreen(props: HomeScreenProps): React.ReactElement {
  const {
    accounts = [],
    recentItems = [],
    onNavigate,
    onPlay,
    feed,
    loadingMore = false,
    onPlayCard,
    onOpenChannel,
    onChipSelect,
    onLoadMore,
    onRetry,
    onConnect,
  } = props;

  if (feed !== null && feed !== undefined) {
    return (
      <section aria-label="Home" style={styles.root} data-testid="home-feed-root">
        <HomeFeedSurface
          feed={feed}
          loadingMore={loadingMore}
          onPlayCard={onPlayCard}
          onOpenChannel={onOpenChannel}
          onChipSelect={onChipSelect}
          onLoadMore={onLoadMore}
          onRetry={onRetry}
          onConnect={onConnect}
        />
      </section>
    );
  }

  return (
    <section aria-label="Home" style={styles.root}>
      <h1 style={styles.heading}>Welcome to WebFlix</h1>
      <p style={styles.intro}>
        WebFlix plays YouTube videos through the official embed and your own local files through
        your own player — and it always tells you honestly what works, what needs sign-in, and what
        it cannot do.
      </p>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Your accounts</h2>
        {accounts.length === 0 ? (
          <div data-testid="home-accounts-empty" style={styles.empty}>
            <p style={styles.muted}>
              No accounts connected yet — WebFlix will not pretend otherwise. Connect a provider to
              unlock provider-backed search.
            </p>
            <button type="button" style={styles.button} onClick={() => onNavigate?.("accounts")}>
              Go to Accounts
            </button>
          </div>
        ) : (
          <div data-testid="account-summary" style={{ width: "100%" }}>
            <p style={styles.muted}>
              {accounts.length} account{accounts.length === 1 ? "" : "s"} connected
            </p>
            <ul style={styles.list}>
              {accounts.map((account) => (
                <li key={account.internalAccountId} style={styles.row}>
                  <span>{account.displayName}</span>
                  <span style={styles.muted}>
                    {account.providerId} · {account.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Pick up where you left off</h2>
        {recentItems.length === 0 ? (
          <div data-testid="home-library-empty" style={styles.empty}>
            <p style={styles.muted}>
              Nothing in your library yet. Search for something to watch or add local files — this
              space fills up honestly, never with placeholders.
            </p>
            <button type="button" style={styles.button} onClick={() => onNavigate?.("library")}>
              Browse Library
            </button>
          </div>
        ) : (
          <ul style={styles.list}>
            {recentItems.map((item) => (
              <li key={item.id} style={styles.row}>
                <span>{item.title}</span>
                <button
                  type="button"
                  style={styles.ghostButton}
                  aria-label={`Play ${item.title}`}
                  onClick={() => onPlay?.(item)}
                >
                  Play
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The media-first home feed (deliverable 3): the frozen §9 HomeFeedView's
 * sections model rendered IN ORDER — category chips, long-form grids
 * (multi-up or rail per the section's own layout fact), shorts shelves
 * (9:16 tiles in a horizontal rail), the continue-watching rail (progress
 * overlays), per-section honest states, and the cursor-paginated growing
 * grid. The composition note names HOW the feed was composed (the frozen
 * source-labeled law); nothing is invented shell-side. Appends render
 * BELOW existing sections — the shell never scrolls programmatically, so
 * the viewport cannot jump.
 */
function HomeFeedSurface(props: {
  feed: HomeFeedView;
  loadingMore: boolean;
  onPlayCard?: (card: VideoCardView) => void;
  onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  onChipSelect?: (chip: string | null) => void;
  onLoadMore?: (cursor: string) => void;
  onRetry?: () => void;
  onConnect?: () => void;
}): React.ReactElement {
  const {
    feed,
    loadingMore,
    onPlayCard,
    onOpenChannel,
    onChipSelect,
    onLoadMore,
    onRetry,
    onConnect,
  } = props;

  // The non-ready variants: only the degraded-family carries optional
  // partial sections/detail — the loading variant carries neither.
  const partialFeed =
    feed.phase !== "ready" && feed.phase !== "loading" ? feed : null;
  const sections: readonly HomeSectionView[] =
    feed.phase === "ready" ? feed.sections : (partialFeed?.sections ?? []);
  const nextCursor = feed.phase === "ready" ? feed.nextCursor : null;

  return (
    <>
      <h1 style={styles.feedHeading}>Home</h1>

      {feed.phase === "ready" && (
        <CategoryChipRow
          chips={feed.chips}
          selected={feed.selectedChip}
          onSelect={onChipSelect === undefined ? undefined : (chip: string) => onChipSelect(chip)}
          testId="home-chips"
          ariaLabel="Home feed categories"
        />
      )}

      {feed.phase === "ready" && feed.compositionNote && (
        <p data-testid="home-composition-note" style={styles.compositionNote}>
          {feed.compositionNote}
        </p>
      )}

      {feed.phase !== "ready" && (
        <MediaPhasePanel
          phase={feed.phase}
          detail={partialFeed?.detail}
          surfaceLabel="Home feed"
          onRetry={onRetry}
          onConnect={onConnect}
          skeletonCount={feed.phase === "loading" ? 4 : 0}
          testIdPrefix="home-feed"
        />
      )}

      {sections.map((section) => (
        <HomeSection
          key={section.sectionId}
          section={section}
          onPlayCard={onPlayCard}
          onOpenChannel={onOpenChannel}
        />
      ))}

      {feed.phase === "ready" && (
        <LoadMoreControl
          nextCursor={nextCursor}
          onLoadMore={onLoadMore}
          loadingMore={loadingMore}
          surfaceLabel="home feed"
          testId="home-load-more"
        />
      )}
    </>
  );
}

/** One ordered home section — the frozen union rendered by kind, honestly. */
function HomeSection(props: {
  section: HomeSectionView;
  onPlayCard?: (card: VideoCardView) => void;
  onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
}): React.ReactElement {
  const { section, onPlayCard, onOpenChannel } = props;

  if (section.kind === "section-state") {
    return (
      <div style={styles.section} data-testid={`home-section-${section.sectionId}`}>
        {section.title && <h2 style={styles.sectionTitle}>{section.title}</h2>}
        <MediaPhasePanel
          phase={section.phase}
          detail={section.detail}
          surfaceLabel={section.title ?? "section"}
          skeletonCount={section.phase === "loading" ? 3 : 0}
          testIdPrefix={`home-section-${section.sectionId}`}
        />
      </div>
    );
  }

  if (section.kind === "shorts-shelf") {
    return (
      <div style={styles.section} data-testid={`home-section-${section.sectionId}`}>
        {section.title && <h2 style={styles.sectionTitle}>{section.title}</h2>}
        {section.shorts.length === 0 ? (
          <p style={styles.muted}>No shorts in this shelf — nothing is invented to fill it.</p>
        ) : (
          <ul style={styles.shortsRail}>
            {section.shorts.map((short) => (
              <li key={short.item.id}>
                <ShortsTile short={short} onPlay={onPlayCard} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (section.kind === "continue-watching") {
    return (
      <div style={styles.section} data-testid={`home-section-${section.sectionId}`}>
        {section.title && <h2 style={styles.sectionTitle}>{section.title}</h2>}
        {section.items.length === 0 ? (
          <p style={styles.muted}>Nothing in progress — your continue-watching rail is honest.</p>
        ) : (
          <ul style={styles.continueGrid}>
            {section.items.map((item) => (
              <li key={item.item.id}>
                <ContinueTile card={item} onPlay={onPlayCard} onOpenChannel={onOpenChannel} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // video-grid
  return (
    <div style={styles.section} data-testid={`home-section-${section.sectionId}`}>
      {section.title && <h2 style={styles.sectionTitle}>{section.title}</h2>}
      {section.videos.length === 0 ? (
        <p style={styles.muted}>No videos in this section yet.</p>
      ) : (
        <MediaCardGrid
          cards={section.videos}
          onPlay={onPlayCard}
          onOpenChannel={onOpenChannel}
          layout={section.layout === "rail" ? "rail" : "grid"}
        />
      )}
    </div>
  );
}

/** A continue-watching card: the video card + the resume facts overlay. */
function ContinueTile(props: {
  card: ContinueCardView;
  onPlay?: (card: VideoCardView) => void;
  onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
}): React.ReactElement {
  const { card, onPlay, onOpenChannel } = props;
  const progress: VideoCardProgress = {
    percent: card.progressPercent,
    label: card.progressLabel,
  };
  return (
    <VideoCard
      card={card}
      onPlay={onPlay}
      onOpenChannel={onOpenChannel}
      variant="rail"
      progress={progress}
    />
  );
}
