// The WF-006 controls strip (P7-COMPOSE-1), extracted from WatchScreen.tsx
// for the repo's max-lines law. Every one of the seven controls renders its
// TYPED state — available with the capability facts that back it, or
// unavailable with its typed reason and honest explanation. There are NO
// dead controls: no command handlers exist at this surface (the hosts wire
// commands in their own rows), so no button is ever rendered — the typed
// truth is the whole strip. mini-player / PiP default to unavailable with
// the host-surface-not-declared reason when the model was derived without
// host declarations (the engine's own honest default).

import React from "react";
import { theme } from "../../theme";
import { PLAYER_CONTROL_IDS_VIEW, PLAYER_CONTROL_LABELS, seekBoundLine } from "../../states";
import type {
  PlayerControlAvailabilityView,
  PlayerControlsView,
  PlayerNonSeekControlIdView,
  PlayerSeekAvailabilityView,
} from "../../states";

const styles: Record<string, React.CSSProperties> = {
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
  note: { margin: 0, color: theme.colors.textMuted },
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

export function ControlsStrip(props: { controls?: PlayerControlsView | null }) {
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
