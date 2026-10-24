// The video card atom (WFX-UX-SHELL-1) — the reference pattern's long-form
// card, composed from the frozen §9 VideoCardView (which carries the
// canonical CatalogItem VERBATIM — the card's play path resolves through the
// same playback planning the buttons use, never a fabricated item).
//
// Honesty laws encoded here:
// - No thumbnailUrl → a quiet placeholder tile, NEVER an invented image.
// - Labels (duration/views/published) render only when the producer sent
//   them; nothing is formatted or guessed shell-side.
// - The card is playable only when a real handler is wired; otherwise it
//   renders as plain non-interactive markup (no dead buttons).
// - Progress overlay renders only when the caller passes progress facts
//   (continue-watching cards carry them; plain cards do not).
//
// WFX-WEB-LOOK-1: the card now carries the webflix-2.0 web product's card
// idiom — the rounded-xl 16:9 tile, the rgba(0,0,0,0.8) duration badge, the
// channel avatar disc, the two-line medium title and the quiet meta lines.
// Every data-testid contract is unchanged.

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

// The web product's badge tones: LIVE + Members carry the red fill; the
// quiet facts stay muted (no invented colors).
const BADGE_TONES: Record<VideoBadge, { color: string; background?: string }> = {
  live: { color: "#ffffff", background: theme.colors.accent },
  new: { color: "#ffffff", background: theme.colors.surfaceRaised },
  verified: { color: theme.colors.textMuted },
  "members-only": { color: "#ffffff", background: theme.colors.accent },
  progress: { color: theme.colors.textMuted },
};

const styles: Record<string, React.CSSProperties> = {
  article: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    minWidth: 0,
  },
  // The web product's rail card width (w-[320px]).
  articleRail: { width: 320, flexShrink: 0 },
  playTarget: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    textAlign: "left",
    background: "transparent",
    border: "none",
    padding: 0,
    margin: 0,
    color: theme.colors.text,
    cursor: "pointer",
    font: "inherit",
    borderRadius: 0,
    minWidth: 0,
  },
  playTargetStatic: { cursor: "default" },
  thumbWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    background: theme.colors.surfaceRaised,
    borderRadius: theme.radii.xl,
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
  // The web product's duration badge: rgba(0,0,0,0.8), bottom-right, 11px.
  duration: {
    position: "absolute",
    right: 6,
    bottom: 6,
    background: "rgba(0,0,0,0.8)",
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1,
    padding: "4px 5px",
    borderRadius: 4,
    fontVariantNumeric: "tabular-nums",
  },
  progressBarTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    background: "rgba(255,255,255,0.30)",
  },
  progressBarFill: { height: "100%", background: theme.colors.accent },
  liveDot: {
    position: "absolute",
    left: 6,
    top: 6,
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: theme.colors.accent,
  },
  // The web card's meta row: the channel avatar disc + the text column.
  metaRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: theme.spacing.sm + 2,
    minWidth: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: theme.colors.surfaceRaised,
    color: theme.colors.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 15,
    fontWeight: 600,
    flexShrink: 0,
    lineHeight: 1,
    textAlign: "center",
  },
  textColumn: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: theme.typography.sizes.md,
    fontWeight: 500,
    lineHeight: 1.4,
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
  badge: { fontSize: 11, fontWeight: 600, lineHeight: 1, padding: "4px 6px", borderRadius: 4 },
  progressLabel: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
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

  // The channel avatar disc: the channel's own initial when the producer
  // named a channel, a quiet dot otherwise — never an invented image.
  const avatarGlyph = card.channelTitle?.trim()?.charAt(0)?.toUpperCase() || "•";

  const content = (
    <>
      <Thumb card={card} progress={progress} />
      <div style={styles.metaRow}>
        <span style={styles.avatar} aria-hidden="true">
          {avatarGlyph}
        </span>
        <div style={styles.textColumn}>
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
                        ? `1px solid ${theme.colors.border}`
                        : "none",
                  }}
                >
                  {BADGE_LABELS[badge]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {progress?.label && <p style={styles.progressLabel}>{progress.label}</p>}
    </>
  );

  const channelRow =
    card.channelTitle !== undefined ? (
      onOpenChannel !== undefined && card.channelId !== undefined ? (
        <button
          type="button"
          style={{ ...styles.channelButton, marginLeft: 44 }}
          data-testid={`${id}-channel`}
          onClick={() => onOpenChannel({ channelId: card.channelId })}
        >
          {card.channelTitle}
          {card.badges.includes("verified") && (
            <Icon name="verified" size={14} title="Verified channel" />
          )}
        </button>
      ) : (
        <span style={{ ...styles.channelRow, marginLeft: 44 }} data-testid={`${id}-channel`}>
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
