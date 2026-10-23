// The channel card atom (WFX-UX-SHELL-1) — search results and subscription
// rows render channels as cards. Frozen §9 ChannelCardView drives every
// label; no avatar → placeholder disc, no invented subscriber counts.

import React from "react";
import { theme } from "../../theme";
import type { ChannelCardView } from "webflix-contracts";
import { Icon } from "./icons";

export interface ChannelCardProps {
  readonly channel: ChannelCardView;
  /** Fires on card activation; absent = non-interactive summary. */
  readonly onOpenChannel?: (channel: { channelId: string; handle?: string }) => void;
  /** `rail` = fixed-width card inside a horizontal shelf. */
  readonly variant?: "grid" | "rail";
  readonly testId?: string;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    textAlign: "center",
    font: "inherit",
    color: theme.colors.text,
    cursor: "pointer",
    minWidth: 0,
  },
  cardStatic: { cursor: "default" },
  cardRail: { width: 208, flexShrink: 0 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: theme.colors.surfaceRaised,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.textMuted,
    flexShrink: 0,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 6, margin: 0, fontWeight: 600 },
  meta: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  description: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
};

export function ChannelCard(props: ChannelCardProps): React.ReactElement {
  const { channel, onOpenChannel, variant = "grid", testId } = props;
  const id = testId ?? `channel-card-${channel.channelId}`;
  const metaParts = [channel.subscriberLabel, channel.videoCountLabel].filter(
    (part): part is string => part !== undefined,
  );

  const inner = (
    <>
      {channel.avatarUrl ? (
        <img src={channel.avatarUrl} alt="" loading="lazy" style={styles.avatar} />
      ) : (
        <div style={styles.avatarPlaceholder} aria-hidden="true">
          <Icon name="accounts" size={28} />
        </div>
      )}
      <span style={styles.titleRow}>
        {channel.title}
        {channel.verified && <Icon name="verified" size={14} title="Verified channel" />}
      </span>
      {channel.handle && <span style={styles.meta}>{channel.handle}</span>}
      {metaParts.length > 0 && <span style={styles.meta}>{metaParts.join(" · ")}</span>}
      {channel.description && <span style={styles.description}>{channel.description}</span>}
    </>
  );

  const cardStyle = {
    ...styles.card,
    ...(variant === "rail" ? styles.cardRail : undefined),
    ...(onOpenChannel === undefined ? styles.cardStatic : undefined),
  };

  if (onOpenChannel === undefined) {
    return (
      <article data-testid={id} style={cardStyle} aria-label={channel.title}>
        {inner}
      </article>
    );
  }

  return (
    <button
      type="button"
      data-testid={id}
      aria-label={`Open channel ${channel.title}`}
      style={cardStyle}
      onClick={() => onOpenChannel({ channelId: channel.channelId, handle: channel.handle })}
    >
      {inner}
    </button>
  );
}
