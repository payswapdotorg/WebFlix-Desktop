// WFX-NETFLIX-SOURCE-1 — the Netflix play hand-off dialog (the web app's
// src/components/netflix/play-handoff.tsx, ADR 0002 §1 made UI).
//
// The playback policy: Netflix titles play through Netflix's own official
// deep link, never through a faked player. The dialog says so honestly —
// what WebFlix can't do (DRM-licensed playback outside Netflix's apps), what
// it does instead (hand the viewer to Netflix's own player), and the exact
// destination URL. No dark patterns: the open is a plain report to the HOST,
// which owns the system-browser call (the external-handoff law).

import React, { useState } from "react";
import { theme } from "../theme";
import type { NetflixTitleCard } from "webflix-contracts";
import { NETFLIX_COLORS } from "./netflixColors";

export interface NetflixPlayHandoffProps {
  /** The title to hand off (null = closed). */
  readonly title: NetflixTitleCard | null;
  readonly onClose: () => void;
  /** The host-owned external open (the system browser). */
  readonly onOpenExternal?: (url: string) => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
    background: "rgba(0,0,0,0.65)",
  },
  dialog: {
    width: "min(480px, 100%)",
    overflow: "hidden",
    borderRadius: theme.radii.xl,
    background: "#141418",
    color: "#ffffff",
    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
  },
  art: {
    position: "relative",
    height: 176,
    background: `linear-gradient(135deg, ${NETFLIX_COLORS.tile}, ${NETFLIX_COLORS.tileDeep})`,
  },
  artImg: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.8 },
  artScrim: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(to top, #141418 0%, rgba(20,20,24,0.4) 45%, transparent 100%)",
  },
  artLogoRow: { position: "absolute", bottom: 12, left: 20, right: 20 },
  artTitle: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  body: { padding: "16px 20px 20px" },
  title: { margin: 0, display: "flex", alignItems: "center", gap: 8, fontSize: theme.typography.sizes.md },
  badge: {
    padding: "2px 6px",
    borderRadius: 3,
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  description: { margin: "8px 0 0", fontSize: theme.typography.sizes.sm, lineHeight: 1.6, color: "rgba(255,255,255,0.6)" },
  actions: { display: "flex", flexDirection: "column", gap: 8, marginTop: 16 },
  primary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderRadius: theme.radii.md,
    border: "none",
    background: NETFLIX_COLORS.red,
    color: "#ffffff",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 40,
    borderRadius: theme.radii.md,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent",
    color: "rgba(255,255,255,0.8)",
    font: "inherit",
    fontSize: theme.typography.sizes.sm,
    cursor: "pointer",
  },
  destination: {
    display: "flex",
    gap: 6,
    margin: "16px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.4)",
    wordBreak: "break-all",
  },
  destinationUrl: { color: "rgba(255,255,255,0.6)" },
};

export function NetflixPlayHandoff(props: NetflixPlayHandoffProps): React.ReactElement | null {
  const { title, onClose, onOpenExternal } = props;
  const [artBroken, setArtBroken] = useState(false);
  if (title === null) return null;

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Play ${title.title} on Netflix`}
      data-testid="netflix-handoff-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div style={styles.dialog} role="document">
        <div style={styles.art}>
          {title.backdropUrl !== null && !artBroken && (
            <img src={title.backdropUrl} alt="" style={styles.artImg} onError={() => setArtBroken(true)} />
          )}
          <div style={styles.artScrim} />
          <div style={styles.artLogoRow}>
            {title.logoUrl !== null && !artBroken ? (
              <img src={title.logoUrl} alt={title.title} style={{ maxHeight: 40, width: "auto", maxWidth: "60%", objectFit: "contain" }} />
            ) : (
              <h2 style={styles.artTitle}>{title.title}</h2>
            )}
          </div>
        </div>

        <div style={styles.body}>
          <h2 style={styles.title}>
            <span style={styles.badge}>Netflix</span>
            Ready to play on Netflix
          </h2>
          <p style={styles.description}>
            Netflix protects its streams with DRM and licenses them for playback inside its own apps
            only — so WebFlix hands you to Netflix&apos;s own player instead of faking one. Your
            browsing and lists stay here.
          </p>

          <div style={styles.actions}>
            <button
              type="button"
              data-testid="netflix-handoff-link"
              style={styles.primary}
              onClick={() => {
                onOpenExternal?.(title.watchUrl);
                onClose();
              }}
            >
              Play &ldquo;{title.title}&rdquo; on Netflix ↗
            </button>
            <button
              type="button"
              style={styles.secondary}
              onClick={() => {
                onOpenExternal?.(title.titlePageUrl);
                onClose();
              }}
            >
              Open the title page on netflix.com
            </button>
            <button type="button" style={{ ...styles.secondary, border: "none", height: 32, color: "rgba(255,255,255,0.5)" }} onClick={onClose}>
              Stay in WebFlix
            </button>
          </div>

          <p style={styles.destination}>
            <span aria-hidden="true">🛡</span>
            <span>
              Destination: <span style={styles.destinationUrl}>{title.watchUrl}</span> — the official
              per-title deep link. WebFlix never touches Netflix&apos;s video stream.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
