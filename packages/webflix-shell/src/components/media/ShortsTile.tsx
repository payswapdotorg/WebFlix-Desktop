// The shorts tile atom (WFX-UX-SHELL-1) — the reference pattern's 9:16
// vertical tile for short-form shelves and the Shorts feed. Same honesty
// laws as VideoCard: no invented thumbnails/labels, playable only with a
// real handler, decorative glyph semantics.
//
// WFX-WEB-LOOK-1: the tile carries the web product's shorts idiom — the
// rounded-xl tile with the hover scale.

import React from "react";
import { theme } from "../../theme";
import type { VideoCardView } from "webflix-contracts";

export interface ShortsTileProps {
  readonly short: VideoCardView;
  /** Fires on tile activation. Absent = non-interactive preview. */
  readonly onPlay?: (short: VideoCardView) => void;
  /** Full-bleed feed variant (taller, larger type) vs shelf rail tile. */
  readonly variant?: "shelf" | "feed";
  readonly testId?: string;
}

const styles: Record<string, React.CSSProperties> = {
  tile: {
    position: "relative",
    width: "100%",
    aspectRatio: "9 / 16",
    background: theme.colors.surfaceRaised,
    borderRadius: theme.radii.xl,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    font: "inherit",
    color: theme.colors.text,
    flexShrink: 0,
  },
  tileStatic: { cursor: "default" },
  tileShelf: { width: 168 },
  tileFeed: { width: "min(100%, 420px)", margin: "0 auto" },
  image: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  overlay: {
    position: "relative",
    padding: theme.spacing.md,
    background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.72) 100%)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "left",
  },
  title: {
    margin: 0,
    fontWeight: 600,
    fontSize: theme.typography.sizes.md,
    lineHeight: 1.3,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  meta: { margin: 0, color: "rgba(255,255,255,0.82)", fontSize: theme.typography.sizes.sm },
};

export function ShortsTile(props: ShortsTileProps): React.ReactElement {
  const { short, onPlay, variant = "shelf", testId } = props;
  const id = short.item.id;
  const tileId = testId ?? `shorts-tile-${id}`;
  const tileStyle = {
    ...styles.tile,
    ...(variant === "shelf" ? styles.tileShelf : styles.tileFeed),
    ...(onPlay === undefined ? styles.tileStatic : undefined),
  };

  const metaParts = [short.channelTitle, short.viewsLabel].filter(
    (part): part is string => part !== undefined,
  );

  const inner = (
    <>
      {short.thumbnailUrl ? (
        <img src={short.thumbnailUrl} alt="" loading="lazy" style={styles.image} />
      ) : (
        <div style={styles.placeholder} aria-hidden="true">
          no thumbnail
        </div>
      )}
      <span style={styles.overlay}>
        <span style={styles.title}>{short.title}</span>
        {metaParts.length > 0 && <span style={styles.meta}>{metaParts.join(" · ")}</span>}
      </span>
    </>
  );

  if (onPlay === undefined) {
    return (
      <div data-testid={tileId} className="wfx-card" style={tileStyle} aria-label={short.title} role="img">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={tileId}
      className="wfx-card"
      aria-label={`Play ${short.title}`}
      style={tileStyle}
      onClick={() => onPlay(short)}
    >
      {inner}
    </button>
  );
}
