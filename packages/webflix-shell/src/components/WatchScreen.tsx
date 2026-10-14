import React from "react";
import { theme } from "../theme";
import type { PlaybackPlan } from "webflix-contracts";
import { PLAYER_CONTROL_IDS_VIEW, PLAYER_CONTROL_LABELS, seekBoundLine } from "../states";
import type {
  PlayerControlAvailabilityView,
  PlayerControlsView,
  PlayerNonSeekControlIdView,
  PlayerSeekAvailabilityView,
} from "../states";

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
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  frame: {
    width: "100%",
    aspectRatio: "16 / 9",
    border: "none",
    borderRadius: theme.radii.lg,
    background: "#000000",
  },
  player: { width: "100%", borderRadius: theme.radii.lg, background: "#000000" },
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
    fontWeight: 600,
    cursor: "pointer",
  },
  controlsRoot: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
  },
  controlsHeading: { margin: 0, fontSize: theme.typography.sizes.lg },
  controlsList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  },
  controlRow: { display: "flex", flexWrap: "wrap", gap: theme.spacing.xs, alignItems: "baseline" },
  controlLabel: { fontWeight: 600, minWidth: 140 },
  stateOk: { color: theme.colors.ok, fontWeight: 600 },
  stateNotOk: { color: theme.colors.warning, fontWeight: 600 },
  controlMeta: { color: theme.colors.textMuted, lineHeight: 1.5 },
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

export function WatchScreen(props: WatchScreenProps) {
  const { title, plan, onClose, controls } = props;
  const embedUrl = plan.kind === "official-embed" ? embedUrlOf(plan) : undefined;

  return (
    <section aria-label="Watch" style={styles.root}>
      <h1 style={styles.heading}>{title}</h1>

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

      <ControlsStrip controls={controls} />
    </section>
  );
}

/**
 * The WF-006 controls strip (P7-COMPOSE-1): every one of the seven controls
 * renders its TYPED state — available with the capability facts that back
 * it, or unavailable with its typed reason and honest explanation. There
 * are NO dead controls: no command handlers exist at this surface (the
 * hosts wire commands in their own rows), so no button is ever rendered —
 * the typed truth is the whole strip. mini-player / PiP default to
 * unavailable with the host-surface-not-declared reason when the model was
 * derived without host declarations (the engine's own honest default).
 */
function ControlsStrip(props: { controls?: PlayerControlsView | null }) {
  const { controls } = props;

  if (controls == null) {
    return (
      <section
        aria-label="Player controls"
        data-testid="watch-controls"
        style={styles.controlsRoot}
      >
        <h2 style={styles.controlsHeading}>Player controls</h2>
        <p data-testid="watch-controls-empty" style={styles.note}>
          No player-controls model has been derived for this plan yet. Control states appear when
          the host derives them — nothing is assumed in the meantime.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Player controls" data-testid="watch-controls" style={styles.controlsRoot}>
      <h2 style={styles.controlsHeading}>Player controls</h2>
      <p data-testid="watch-controls-plankind" style={styles.note}>
        Control states for this plan: {controls.planKind}
        {controls.unavailableReason ? ` (${controls.unavailableReason})` : ""} — every control
        states exactly what it can and cannot do.
      </p>
      <ul style={styles.controlsList}>
        {PLAYER_CONTROL_IDS_VIEW.map((id) =>
          id === "seek" ? (
            <SeekControlRow key={id} seek={controls.seek} />
          ) : (
            <ControlRow key={id} id={id} control={controls[id]} />
          ),
        )}
      </ul>
    </section>
  );
}

/** One typed control row: label + available-with-facts, or unavailable-with-reason. */
function ControlRow(props: {
  id: PlayerNonSeekControlIdView;
  control: PlayerControlAvailabilityView;
}) {
  const { id, control } = props;
  return (
    <li data-testid={`watch-control-${id}`} style={styles.controlRow}>
      <span style={styles.controlLabel}>{PLAYER_CONTROL_LABELS[id]}</span>
      {control.state === "available" ? (
        <span style={styles.controlMeta}>
          <span style={styles.stateOk}>Available</span> — {control.facts.join(" · ")}
        </span>
      ) : (
        <span style={styles.controlMeta}>
          <span style={styles.stateNotOk}>Unavailable</span> — {control.reason}: {control.detail}
        </span>
      )}
    </li>
  );
}

/** The seek row adds the honest position bound when the control is available. */
function SeekControlRow(props: { seek: PlayerSeekAvailabilityView }) {
  const { seek } = props;
  return (
    <li data-testid="watch-control-seek" style={styles.controlRow}>
      <span style={styles.controlLabel}>{PLAYER_CONTROL_LABELS.seek}</span>
      {seek.state === "available" ? (
        <span style={styles.controlMeta}>
          <span style={styles.stateOk}>Available</span> — {seek.facts.join(" · ")} ·{" "}
          {seekBoundLine(seek)}
        </span>
      ) : (
        <span style={styles.controlMeta}>
          <span style={styles.stateNotOk}>Unavailable</span> — {seek.reason}: {seek.detail}
        </span>
      )}
    </li>
  );
}
