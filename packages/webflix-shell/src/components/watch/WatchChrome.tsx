// Watch-surface chrome (WFX-UX-SHELL-1, deliverable 6): the metadata band,
// the honest action row, and the WebFlix-local queue strip. Extracted from
// WatchScreen.tsx for the repo's max-lines law; the component set and every
// testid are unchanged.

import React from "react";
import { theme } from "../../theme";
import type { VideoCardView } from "webflix-contracts";

/**
 * One action row entry. The host passes its own honest set; the DEFAULT
 * below is the shell's honest-unavailable trio — freeze §9.1 forbids account
 * mutations riding the agent bridge, and the watch surface will not fake
 * like/subscribe support that no authorized path backs.
 */
export interface WatchActionView {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  /** The honest reason rendered when unavailable (verbatim). */
  readonly reason?: string;
}

/** The honest default action row (disabled with reasons — never dead). */
export const DEFAULT_WATCH_ACTIONS: readonly WatchActionView[] = [
  {
    id: "like",
    label: "Like",
    available: false,
    reason:
      "Liking is a YouTube account action — it needs your express action through a connected account, and no authorized path is wired here.",
  },
  {
    id: "subscribe",
    label: "Subscribe",
    available: false,
    reason:
      "Subscribing is a YouTube account action — not offered until an authorized account path exists.",
  },
  {
    id: "save",
    label: "Save",
    available: false,
    reason: "Saving to a WebFlix collection is not wired in this surface yet.",
  },
];

/** One WebFlix-local queue entry with its now-playing fact. */
export interface WatchQueueEntryView {
  readonly card: VideoCardView;
  readonly nowPlaying: boolean;
}

export const watchChromeStyles: Record<string, React.CSSProperties> = {
  metadata: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  metaLine: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  metaChannelButton: {
    background: "transparent",
    border: "none",
    padding: 0,
    color: theme.colors.text,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
    textDecoration: "underline",
  },
  metaChannelText: { margin: 0, fontWeight: 600, fontSize: theme.typography.sizes.md },
  actionRow: { display: "flex", flexWrap: "wrap", gap: theme.spacing.md, minWidth: 0 },
  actionEntry: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    minWidth: 0,
  },
  actionButton: {
    background: theme.colors.surface,
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
  },
  actionButtonDisabled: {
    color: theme.colors.textMuted,
    borderColor: theme.colors.border,
    cursor: "default",
  },
  actionReason: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.4,
    maxWidth: 360,
  },
  queueRoot: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    minWidth: 0,
  },
  queueHeading: { margin: 0, fontSize: theme.typography.sizes.md, fontWeight: 600 },
  queueList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  },
  queueRow: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
    borderBottom: `1px solid ${theme.colors.border}`,
    minWidth: 0,
  },
  queueTitle: { flex: "1 1 auto", minWidth: 0, margin: 0, lineHeight: 1.4 },
  nowPlayingChip: {
    flexShrink: 0,
    fontSize: 11,
    lineHeight: 1,
    padding: "4px 8px",
    borderRadius: 999,
    background: theme.colors.accent,
    color: "#08211b",
    fontWeight: 700,
  },
  queuePlayButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "6px 12px",
    cursor: "pointer",
    font: "inherit",
    minHeight: 44,
  },
};

/** The metadata band: the item's card facts, verbatim (deliverable 6). */
export function MetadataBand(props: {
  card: VideoCardView;
  onOpenChannel?: (channelId: string) => void;
}): React.ReactElement {
  const { card, onOpenChannel } = props;
  const channelId = card.channelId;
  const metaParts = [card.viewsLabel, card.publishedLabel].filter(
    (part): part is string => part !== undefined,
  );
  return (
    <div data-testid="watch-metadata" style={watchChromeStyles.metadata}>
      {card.channelTitle !== undefined &&
        (onOpenChannel !== undefined && channelId !== undefined ? (
          <button
            type="button"
            data-testid="watch-metadata-channel"
            style={watchChromeStyles.metaChannelButton}
            onClick={() => onOpenChannel(channelId)}
          >
            {card.channelTitle}
          </button>
        ) : (
          <p data-testid="watch-metadata-channel" style={watchChromeStyles.metaChannelText}>
            {card.channelTitle}
          </p>
        ))}
      {metaParts.length > 0 && (
        <p style={watchChromeStyles.metaLine}>{metaParts.join(" · ")}</p>
      )}
      <p style={watchChromeStyles.metaLine}>
        Source: {card.item.providerId} · {card.item.mediaKind}
      </p>
    </div>
  );
}

/** The honest action row: every entry works or is disabled with its reason. */
export function WatchActionRow(props: {
  actions: readonly WatchActionView[];
  onAction?: (id: string) => void;
  testId: string;
}): React.ReactElement {
  const { actions, onAction, testId } = props;
  return (
    <div
      data-testid={testId}
      style={watchChromeStyles.actionRow}
      role="group"
      aria-label="Watch actions"
    >
      {actions.map((action) => {
        const enabled = action.available && onAction !== undefined;
        return (
          <div key={action.id} style={watchChromeStyles.actionEntry}>
            <button
              type="button"
              data-testid={`watch-action-${action.id}`}
              disabled={!enabled}
              aria-label={
                enabled
                  ? action.label
                  : `${action.label} — unavailable${action.reason ? `: ${action.reason}` : ""}`
              }
              style={{
                ...watchChromeStyles.actionButton,
                ...(!enabled ? watchChromeStyles.actionButtonDisabled : undefined),
              }}
              onClick={() => {
                if (enabled) onAction?.(action.id);
              }}
            >
              {action.label}
            </button>
            {!enabled && action.reason && (
              <p
                data-testid={`watch-action-${action.id}-reason`}
                style={watchChromeStyles.actionReason}
              >
                {action.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The WebFlix-local queue strip: entries + the now-playing marker. */
export function QueueStrip(props: {
  queue: readonly WatchQueueEntryView[];
  onPlayCard?: (card: VideoCardView) => void;
}): React.ReactElement {
  const { queue, onPlayCard } = props;
  return (
    <section aria-label="Queue" data-testid="watch-queue" style={watchChromeStyles.queueRoot}>
      <h2 style={watchChromeStyles.queueHeading}>Queue (WebFlix-local)</h2>
      <ul style={watchChromeStyles.queueList}>
        {queue.map((entry) => (
          <li
            key={entry.card.item.id}
            data-testid={`watch-queue-entry-${entry.card.item.id}`}
            style={watchChromeStyles.queueRow}
          >
            {entry.nowPlaying && (
              <span
                data-testid={`watch-queue-now-playing-${entry.card.item.id}`}
                style={watchChromeStyles.nowPlayingChip}
              >
                Now playing
              </span>
            )}
            <span style={watchChromeStyles.queueTitle}>{entry.card.title}</span>
            {onPlayCard !== undefined && !entry.nowPlaying && (
              <button
                type="button"
                style={watchChromeStyles.queuePlayButton}
                aria-label={`Play ${entry.card.title} from the queue`}
                onClick={() => onPlayCard(entry.card)}
              >
                Play
              </button>
            )}
          </li>
        ))}
      </ul>
      <p style={watchChromeStyles.metaLine}>
        The queue is WebFlix-local data (freeze §9.6) — it never writes to a provider account.
      </p>
    </section>
  );
}
