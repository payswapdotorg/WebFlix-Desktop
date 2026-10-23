import React from "react";
import { theme } from "../theme";
import type { PlaybackPlan, VideoCardView } from "webflix-contracts";
import type { PlayerControlsView } from "../states";
import { MediaCardGrid } from "./media/MediaCardGrid";
import { ControlsStrip } from "./watch/ControlsStrip";
import {
  DEFAULT_WATCH_ACTIONS,
  MetadataBand,
  QueueStrip,
  WatchActionRow,
} from "./watch/WatchChrome";
import type { WatchActionView, WatchQueueEntryView } from "./watch/WatchChrome";

// Public re-exports (the barrel + the existing battery pin these names here).
export type { WatchActionView, WatchQueueEntryView };
export { DEFAULT_WATCH_ACTIONS };

export interface WatchScreenProps {
  /** The item's title — canonical plans carry no title (ownership is
   *  structural per §2.2: the caller knows the item it asked to play). */
  readonly title: string;
  readonly plan: PlaybackPlan;
  readonly onClose?: () => void;
  /**
   * P7-COMPOSE-1 (WF-006 surface): the player-controls model, shaped
   * exactly like the playback package's ControlsAvailability (structural
   * typing — the host passes deriveControls()'s output AS-IS; the shell
   * never imports the engine package). null/undefined = the honest
   * not-derived-yet state; NOTHING is invented in the meantime.
   */
  readonly controls?: PlayerControlsView | null;
  // ---- WFX-UX-SHELL-1 additions (all optional; the standalone surface
  // keeps its legacy contract EXACTLY when these are absent) ----
  /** Theater layout (controlled by the host when a handler is wired). */
  readonly theater?: boolean;
  /** Fires on the theater/normal toggle. Absent + theater given → the
   *  toggle renders disabled with its reason; both absent → no toggle. */
  readonly onToggleTheater?: () => void;
  /**
   * The docked persistent-player variant (freeze §9.6): player + title +
   * now-playing + close only. The full metadata/action/queue/related
   * chrome renders in the normal/theater variants. The player element
   * itself NEVER remounts between variants — see the tree-stability note
   * inside the component.
   */
  readonly compact?: boolean;
  /** The item's card view — the metadata band's facts (labels verbatim). */
  readonly card?: VideoCardView | null;
  /** The related rail's video cards. */
  readonly related?: readonly VideoCardView[];
  /** The WebFlix-local queue (items + now-playing marker). */
  readonly queue?: readonly WatchQueueEntryView[];
  /** The action row (defaults handled by the host; see DEFAULT_WATCH_ACTIONS). */
  readonly actions?: readonly WatchActionView[];
  /** Fires for an available action row entry. */
  readonly onAction?: (id: string) => void;
  /** Plays a related/queue card. */
  readonly onPlayCard?: (card: VideoCardView) => void;
  /** Opens the channel from the metadata band (needs card.channelId). */
  readonly onOpenChannel?: (channelId: string) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    minWidth: 0,
  },
  // The columns row: primary + (full variants only) the related rail aside.
  // NORMAL = row; THEATER and COMPACT stack (the rail moves below / is
  // omitted). The style MUTATES between variants on the SAME DOM node.
  columns: {
    display: "flex",
    flexDirection: "row",
    gap: theme.spacing.lg,
    alignItems: "flex-start",
    minWidth: 0,
  },
  columnsStacked: { flexDirection: "column", gap: theme.spacing.md },
  // The primary column: heading + PLAYER + variant chrome, in that order,
  // in EVERY variant. The heading and the player occupy children[0] and
  // children[1] of this same element whether the surface is compact,
  // normal or theater — React therefore NEVER remounts the player element
  // (iframe or <video>) when the variant flips, which is exactly the
  // freeze §9.6 persistent-player posture (the docked shell keeps this
  // component mounted across non-watch routes; only the later chrome
  // children swap).
  primary: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: theme.spacing.md },
  secondary: {
    width: 360,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    minWidth: 0,
  },
  secondaryStacked: { width: "100%" },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  headingCompact: { margin: 0, fontSize: theme.typography.sizes.md, lineHeight: 1.4 },
  frame: {
    width: "100%",
    aspectRatio: "16 / 9",
    border: "none",
    borderRadius: theme.radii.lg,
    background: "#000000",
    display: "block",
  },
  player: { width: "100%", borderRadius: theme.radii.lg, background: "#000000", display: "block" },
  note: { margin: 0, color: theme.colors.textMuted },
  panel: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  panelTitle: { margin: 0, fontSize: theme.typography.sizes.lg },
  reason: { margin: 0, color: theme.colors.warning, lineHeight: 1.5 },
  recovery: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  button: {
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
  },
  toolbar: { display: "flex", flexWrap: "wrap", gap: theme.spacing.sm, alignItems: "center" },
  toolbarButton: {
    background: theme.colors.surface,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
  },
  toolbarButtonDisabled: {
    color: theme.colors.textMuted,
    cursor: "default",
  },
  toolbarReason: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  relatedHeading: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  dockNowPlaying: {
    margin: 0,
    color: theme.colors.accent,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
  },
  dockCloseRow: { display: "flex", gap: theme.spacing.sm },
};

/*
 * §2.2 reconciliation (MIRROR-RECON): the mirror plan carried strategy/title/
 * embedUrl/filePath/free-text reason+recovery. The frozen PlaybackPlan is a
 * kind-discriminated union: official-embed{providerId, embedSpec} |
 * local-file{path, mimeType} | unavailable{reason, recovery?}. The iframe src
 * is read from embedSpec.embedUrl (the key the playback resolver and the
 * YouTube plan builder both emit); the unavailable panel renders the frozen
 * UnavailableReason enum plus RecoveryHint.message for the human context.
 */

function embedUrlOf(plan: Extract<PlaybackPlan, { kind: "official-embed" }>): string | undefined {
  const embedUrl = plan.embedSpec.embedUrl;
  return typeof embedUrl === "string" && embedUrl.length > 0 ? embedUrl : undefined;
}

export function WatchScreen(props: WatchScreenProps): React.ReactElement {
  const {
    title,
    plan,
    onClose,
    controls,
    theater,
    onToggleTheater,
    compact = false,
    card = null,
    related,
    queue,
    actions,
    onAction,
    onPlayCard,
    onOpenChannel,
  } = props;
  const embedUrl = plan.kind === "official-embed" ? embedUrlOf(plan) : undefined;

  // The player block is ALWAYS the second child (after the heading) of the
  // SAME primary column in every variant (compact, normal, theater): the
  // persistent-player layout relies on its stable tree position, so
  // route/mode changes never remount the iframe or the local <video>
  // element (freeze §9.6 compliance).
  const playerBlock = (
    <>
      {plan.kind === "official-embed" && (
        <>
          {embedUrl ? (
            <iframe
              data-testid="watch-embed"
              title={`${title} — official embed`}
              src={embedUrl}
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              style={styles.frame}
            />
          ) : (
            <div data-testid="watch-unavailable" role="alert" style={styles.panel}>
              <p style={styles.panelTitle}>Unavailable</p>
              <p data-testid="watch-unavailable-reason" style={styles.reason}>
                Why: the embed plan carries no usable embed reference.
              </p>
            </div>
          )}
          <p style={styles.note}>
            Playing through the provider's official embed — WebFlix never wraps scraped streams.
          </p>
        </>
      )}

      {plan.kind === "local-file" && (
        <>
          <video data-testid="watch-local-player" controls src={plan.path} style={styles.player} />
          <p style={styles.note}>
            Playing a local file from your disk{plan.mimeType ? ` (${plan.mimeType})` : ""}.
          </p>
        </>
      )}

      {plan.kind === "unavailable" && (
        <div data-testid="watch-unavailable" role="alert" style={styles.panel}>
          <p style={styles.panelTitle}>Unavailable</p>
          <p data-testid="watch-unavailable-reason" style={styles.reason}>
            Why: {plan.reason}
          </p>
          {plan.recovery && (
            <p data-testid="watch-unavailable-recovery" style={styles.recovery}>
              What you can do: {plan.recovery.message}
              {plan.recovery.url ? ` (${plan.recovery.url})` : ""}
            </p>
          )}
          {/* The Back control exists only when a real handler is wired — never a dead button. */}
          {onClose && (
            <button type="button" style={styles.button} onClick={onClose}>
              Back
            </button>
          )}
        </div>
      )}
      {plan.kind === "external-deep-link" && (
        <div data-testid="watch-external-deep-link" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>Opens outside WebFlix</p>
          <p style={styles.recovery}>
            This item is planned as an external deep link — the host decides whether (and how) to
            open it. WebFlix does not fake an in-app player for it.
          </p>
        </div>
      )}

      {plan.kind === "isolated-website" && (
        <div data-testid="watch-isolated-website" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>Isolated website view</p>
          <p style={styles.recovery}>
            This item is planned as an isolated website embed — no website host surface is mounted
            here, so nothing is pretended to play.
          </p>
        </div>
      )}
    </>
  );

  const nowPlaying = queue?.find((entry) => entry.nowPlaying);
  const showTheaterToggle = !compact && (theater !== undefined || onToggleTheater !== undefined);
  const theaterDisabled = onToggleTheater === undefined;
  const columnsStyle = compact || theater ? { ...styles.columns, ...styles.columnsStacked } : styles.columns;

  return (
    <section
      aria-label="Watch"
      style={styles.root}
      data-testid={compact ? "watch-compact-root" : "watch-full-root"}
    >
      <div style={columnsStyle}>
        <div style={styles.primary}>
          <h1 style={compact ? styles.headingCompact : styles.heading}>{title}</h1>
          {playerBlock}

          {compact ? (
            <>
              {nowPlaying && (
                <p data-testid="watch-dock-now-playing" style={styles.dockNowPlaying}>
                  Now playing in your queue: {nowPlaying.card.title}
                </p>
              )}
              {onClose && (
                <div style={styles.dockCloseRow}>
                  <button
                    type="button"
                    data-testid="watch-dock-close"
                    aria-label={`Close the persistent player for ${title}`}
                    style={styles.button}
                    onClick={onClose}
                  >
                    Close player
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {showTheaterToggle && (
                <div style={styles.toolbar}>
                  <button
                    type="button"
                    data-testid="watch-theater-toggle"
                    disabled={theaterDisabled}
                    aria-label={theater ? "Switch to the default layout" : "Switch to theater layout"}
                    style={{
                      ...styles.toolbarButton,
                      ...(theaterDisabled ? styles.toolbarButtonDisabled : undefined),
                    }}
                    onClick={() => onToggleTheater?.()}
                  >
                    {theater ? "Default view" : "Theater mode"}
                  </button>
                  {theaterDisabled && (
                    <p data-testid="watch-theater-toggle-reason" style={styles.toolbarReason}>
                      Layout switching is not wired by this host.
                    </p>
                  )}
                </div>
              )}

              {card !== null && <MetadataBand card={card} onOpenChannel={onOpenChannel} />}

              {actions !== undefined && (
                <WatchActionRow actions={actions} onAction={onAction} testId="watch-action-row" />
              )}

              {queue !== undefined && queue.length > 0 && (
                <QueueStrip queue={queue} onPlayCard={onPlayCard} />
              )}
            </>
          )}
        </div>

        {!compact && related !== undefined && related.length > 0 && (
          <aside
            aria-label="Related videos"
            data-testid="watch-related"
            style={theater ? { ...styles.secondary, ...styles.secondaryStacked } : styles.secondary}
          >
            <h2 style={styles.relatedHeading}>Up next</h2>
            <MediaCardGrid cards={related} onPlay={onPlayCard} layout="rail" />
          </aside>
        )}
      </div>

      <ControlsStrip controls={controls} />
    </section>
  );
}
