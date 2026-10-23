// The video card atom (WFX-UX-SHELL-1) — the reference pattern's long-form
// card, composed from the frozen §9 VideoCardView (which carries the
// canonical CatalogItem VERBATIM — the card's play path resolves through
// the same playback planning the buttons use, never a fabricated item).
//
// Honesty laws encoded here:
// - No thumbnailUrl → a quiet placeholder tile, NEVER an invented image.
// - Labels (duration/views/published) render only when the producer sent
//   them; nothing is formatted or guessed shell-side.
// - The card is playable only when a real handler is wired; otherwise it
//   renders as plain non-interactive markup (no dead buttons).
// - Progress overlay renders only when the caller passes progress facts
//   (continue-watching cards carry them; plain cards do not).

import React from "react";
import { theme } from "../../theme";
import type { VideoBadge, VideoCardView } from "webflix-contracts";
import { Icon } from "./icons";

export interface VideoCardProgress {
  /** 0..1 (the frozen ContinueCardView bound); null = no progress known. */
  readonly percent: number | null;
  /** Producer-formatted label (e.g. "Resume at 1:23"). */
  readonly label?: string;
}

export interface VideoCardProps {
  readonly card: VideoCardView;
  /** Fires on card activation (thumbnail+title). Absent = non-interactive. */
  readonly onPlay?: (card: VideoCardView) => void;
  /** Fires on channel-row activation; absent = plain channel text. */
  readonly onOpenChannel?: (channel: { channelId?: string; handle?: string }) => void;
  /** `rail` = fixed-width card inside a horizontal shelf. */
  readonly variant?: "grid" | "rail";
  /** Continue-watching progress facts (overlay + label). */
  readonly progress?: VideoCardProgress;
  readonly testId?: string;
}

/** Badge labels — plain words, colored by meaning, no invented chips. */
const BADGE_LABELS: Record<VideoBadge, string> = {
  live: "LIVE",
  new: "New",
  verified: "Verified",
  "members-only": "Members only",
  progress: "In progress",
};

const BADGE_TONES: Record<VideoBadge, { color: string; background?: string }> = {
  live: { color: "#ffffff", background: theme.colors.danger },
  new: { color: "#08211b", background: theme.colors.accent },
  verified: { color: theme.colors.ok },
  "members-only": { color: theme.colors.warning },
  progress: { color: theme.colors.accent },
};

const styles: Record<string, React.CSSProperties> = {
  article: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  articleRail: { width: 264, flexShrink: 0 },
  playTarget: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    textAlign: "left",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    color: theme.colors.text,
    cursor: "pointer",
    font: "inherit",
    borderRadius: theme.radii.md,
    minWidth: 0,
  },
  playTargetStatic: { cursor: "default" },
  thumbWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    background: theme.colors.surfaceRaised,
    borderRadius: theme.radii.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  thumbImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  duration: {
    position: "absolute",
    right: 6,
    bottom: 6,
    background: "rgba(0,0,0,0.8)",
    color: "#ffffff",
    fontSize: 11,
    lineHeight: 1,
    padding: "4px 6px",
    borderRadius: theme.radii.sm,
    fontFamily: theme.typography.monoFamily,
  },
  progressBarTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    background: "rgba(255,255,255,0.25)",
  },
  progressBarFill: { height: "100%", background: theme.colors.accent },
  liveDot: {
    position: "absolute",
    left: 6,
    top: 6,
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: theme.colors.danger,
  },
  title: {
    margin: 0,
    fontSize: theme.typography.sizes.md,
    fontWeight: 600,
    lineHeight: 1.35,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  meta: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  channelRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  channelButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "none",
    padding: 0,
    color: theme.colors.textMuted,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    textDecoration: "underline",
    textDecorationColor: "transparent",
  },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 },
  badge: { fontSize: 11, lineHeight: 1, padding: "4px 6px", borderRadius: theme.radii.sm },
  progressLabel: { margin: 0, color: theme.colors.accent, fontSize: theme.typography.sizes.sm },
};

function Thumb(props: { card: VideoCardView; progress?: VideoCardProgress }) {
  const { card, progress } = props;
  return (
    <div style={styles.thumbWrap}>
      {card.thumbnailUrl ? (
        <img
          src={card.thumbnailUrl}
          alt=""
          loading="lazy"
          style={styles.thumbImage}
          data-testid={`${cardTestId(card)}-thumb`}
        />
      ) : (
        <div style={styles.thumbPlaceholder} aria-hidden="true">
          no thumbnail
        </div>
      )}
      {card.badges.includes("live") && <span style={styles.liveDot} aria-hidden="true" />}
      {card.durationLabel && <span style={styles.duration}>{card.durationLabel}</span>}
      {progress && progress.percent !== null && (
        <div
          style={styles.progressBarTrack}
          data-testid={`${cardTestId(card)}-progress`}
          aria-hidden="true"
        >
          <div
            style={{ ...styles.progressBarFill, width: `${Math.round(progress.percent * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function cardTestId(card: VideoCardView): string {
  return `video-card-${card.item.id}`;
}

export function VideoCard(props: VideoCardProps): React.ReactElement {
  const { card, onPlay, onOpenChannel, variant = "grid", progress, testId } = props;
  const id = cardTestId(card);
  const articleStyle =
    variant === "rail" ? { ...styles.article, ...styles.articleRail } : styles.article;
  const metaParts = [
    card.viewsLabel,
    card.publishedLabel,
    card.item.mediaKind !== "video" ? card.item.mediaKind : undefined,
  ].filter((part): part is string => part !== undefined);

  const content = (
    <>
      <Thumb card={card} progress={progress} />
      <p style={styles.title}>{card.title}</p>
      {metaParts.length > 0 && <p style={styles.meta}>{metaParts.join(" · ")}</p>}
      {card.badges.length > 0 && (
        <div style={styles.badgeRow}>
          {card.badges.map((badge) => (
            <span
              key={badge}
              data-testid={`${id}-badge-${badge}`}
              style={{
                ...styles.badge,
                color: BADGE_TONES[badge].color,
                background: BADGE_TONES[badge].background ?? "transparent",
                border:
                  BADGE_TONES[badge].background === undefined
                    ? `1px solid ${BADGE_TONES[badge].color}`
                    : "none",
              }}
            >
              {BADGE_LABELS[badge]}
            </span>
          ))}
        </div>
      )}
      {progress?.label && <p style={styles.progressLabel}>{progress.label}</p>}
    </>
  );

  const channelRow =
    card.channelTitle !== undefined ? (
      onOpenChannel !== undefined && card.channelId !== undefined ? (
        <button
          type="button"
          style={styles.channelButton}
          data-testid={`${id}-channel`}
          onClick={() => onOpenChannel({ channelId: card.channelId })}
        >
          {card.channelTitle}
          {card.badges.includes("verified") && (
            <Icon name="verified" size={14} title="Verified channel" />
          )}
        </button>
      ) : (
        <span style={styles.channelRow} data-testid={`${id}-channel`}>
          {card.channelTitle}
          {card.badges.includes("verified") && (
            <Icon name="verified" size={14} title="Verified channel" />
          )}
        </span>
      )
    ) : null;

  return (
    <article data-testid={testId ?? id} style={articleStyle}>
      {onPlay ? (
        <button
          type="button"
          style={styles.playTarget}
          aria-label={`Play ${card.title}`}
          data-testid={`${id}-play`}
          onClick={() => onPlay(card)}
        >
          {content}
        </button>
      ) : (
        <div style={{ ...styles.playTarget, ...styles.playTargetStatic }}>{content}</div>
      )}
      {channelRow}
    </article>
  );
}
