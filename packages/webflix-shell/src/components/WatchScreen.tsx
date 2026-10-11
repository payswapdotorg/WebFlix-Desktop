import React from "react";
import { theme } from "../theme";
import type { PlaybackPlan } from "webflix-contracts";

export interface WatchScreenProps {
  /** The item's title — canonical plans carry no title (ownership is
   *  structural per §2.2: the caller knows the item it asked to play). */
  readonly title: string;
  readonly plan: PlaybackPlan;
  readonly onClose?: () => void;
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
  const { title, plan, onClose } = props;
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
    </section>
  );
}
