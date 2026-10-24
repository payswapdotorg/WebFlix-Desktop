// The honest-phase panel (WFX-UX-SHELL-1) — the shared renderer for the
// frozen §9 MediaViewPhase vocabulary. The phase enum is VALUE-IDENTICAL
// to the shell's frozen HonestState vocabulary, so the HONEST_COPY mapping
// rides AS-IS: phases are data, never thrown errors, never invented rows.
//
// Laws encoded here:
// - "ready" renders nothing (the caller renders data; a ready-but-empty
//   surface is the caller's own honest empty line).
// - "loading" renders the copy PLUS quiet skeleton tiles (the loading
//   phase's own visual — never fake rows).
// - "requires-auth" offers the connect action ONLY when the caller wired
//   one; otherwise the copy explains itself (a dead button is worse).
// - "unavailable"/"status-unknown" offer retry ONLY when wired.
// - "degraded" says so; partial data renders AROUND the panel (caller).
//
// The not-provided state (no view at all — the host wired no producer for
// this surface yet) is its own honest panel: never a spinner pretending a
// load is in flight, never fabricated content.

import React from "react";
import { theme } from "../../theme";
import type { MediaViewPhase } from "webflix-contracts";
import { HONEST_COPY } from "../../states";

export interface MediaPhasePanelProps {
  /** The frozen phase (ready renders nothing — callers render data). */
  readonly phase: MediaViewPhase;
  /** The phase's own typed detail, verbatim. */
  readonly detail?: string;
  /** Surface label for the heading context (e.g. "Home feed"). */
  readonly surfaceLabel?: string;
  readonly onRetry?: () => void;
  readonly onConnect?: () => void;
  /** Skeleton tile count for the loading phase (0 = copy only). */
  readonly skeletonCount?: number;
  /** Testid prefix — the panel renders `{prefix}-{phase}`. */
  readonly testIdPrefix?: string;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    minWidth: 0,
  },
  title: { margin: 0, fontSize: theme.typography.sizes.lg, fontWeight: 600 },
  message: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5, maxWidth: 640 },
  detail: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5, maxWidth: 640 },
  button: {
    background: theme.colors.accent,
    color: "#ffffff",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
    font: "inherit",
  },
  skeletonRow: {
    display: "flex",
    gap: theme.spacing.md,
    flexWrap: "wrap",
    minWidth: 0,
    width: "100%",
  },
  skeletonTile: {
    width: 224,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  },
  skeletonThumb: {
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: theme.radii.md,
    background: theme.colors.surfaceRaised,
    opacity: 0.7,
  },
  skeletonLine: {
    height: 12,
    borderRadius: theme.radii.sm,
    background: theme.colors.surfaceRaised,
    opacity: 0.7,
  },
};

/** Renders the honest panel for one frozen MediaViewPhase (ready → null). */
export function MediaPhasePanel(props: MediaPhasePanelProps): React.ReactElement | null {
  const { phase, detail, surfaceLabel, onRetry, onConnect, skeletonCount = 3, testIdPrefix = "media-phase" } =
    props;

  if (phase === "ready") return null;

  const copy = HONEST_COPY[phase];
  const testId = `${testIdPrefix}-${phase}`;
  // The action label is the frozen copy's own: connect for requires-auth,
  // retry/check-again for the retry-able phases. Rendered ONLY with a real
  // handler — the copy explains itself otherwise.
  const actionHandler =
    phase === "requires-auth"
      ? onConnect
      : phase === "unavailable" || phase === "status-unknown"
        ? onRetry
        : undefined;

  return (
    <div data-testid={testId} role="status" style={styles.panel}>
      <p style={styles.title}>
        {copy.title}
        {surfaceLabel ? <span style={styles.detail}>{` — ${surfaceLabel}`}</span> : null}
      </p>
      <p style={styles.message}>{copy.message}</p>
      {detail && <p style={styles.detail}>{detail}</p>}
      {phase === "loading" && skeletonCount > 0 && (
        <div style={styles.skeletonRow} aria-hidden="true">
          {Array.from({ length: skeletonCount }, (_, index) => (
            <div key={index} style={styles.skeletonTile}>
              <div style={styles.skeletonThumb} />
              <div style={{ ...styles.skeletonLine, width: "85%" }} />
              <div style={{ ...styles.skeletonLine, width: "55%" }} />
            </div>
          ))}
        </div>
      )}
      {copy.actionLabel !== null && actionHandler !== undefined && (
        <button type="button" style={styles.button} onClick={actionHandler}>
          {copy.actionLabel}
        </button>
      )}
    </div>
  );
}

export interface ViewNotProvidedProps {
  /** The surface's own name, rendered verbatim in the heading. */
  readonly surfaceLabel: string;
  readonly testIdPrefix: string;
}

/**
 * The not-provided panel: the host wired no view producer for this surface
 * yet. Honest by construction — no spinner (nothing is loading), no rows
 * (nothing is known), and the message says exactly that.
 */
export function ViewNotProvided(props: ViewNotProvidedProps): React.ReactElement {
  const { surfaceLabel, testIdPrefix } = props;
  return (
    <div data-testid={`${testIdPrefix}-not-provided`} role="status" style={styles.panel}>
      <p style={styles.title}>{surfaceLabel}</p>
      <p style={styles.message}>
        No data source is wired for this surface yet. WebFlix does not invent rows — it will show
        exactly what the app provides once a real view is connected.
      </p>
    </div>
  );
}
