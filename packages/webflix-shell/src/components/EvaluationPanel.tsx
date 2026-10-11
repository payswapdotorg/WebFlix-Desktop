import React from "react";
import type { EvaluationOutcome, EvaluationResult } from "webflix-contracts";
import { theme } from "../theme";

/**
 * EvaluationPanel — the honest-metrics read-out surface (P4-EVALLOOP
 * scope row 4; the RankerAdapterSelector precedent: props-driven, native,
 * aria-labelled, NO fetch, NO effects, NO telemetry).
 *
 * Honesty rules this component pins:
 * - NO 100% WITHOUT N: every rendered share carries the counts it was
 *   computed from ("1 of 2 (50%)"), and a null share (empty population)
 *   renders as the factual no-population text — never a bare "0%" or
 *   "100%" that could masquerade as evidence;
 * - the replay populations render with the read-out (events replayed of
 *   stored, explicit/implicit under test, objectives applied, items under
 *   test, k) so the metric denominators are always visible;
 * - a FAILED configuration renders its honest reason — never a fabricated
 *   ranking or metrics for a side that did not run;
 * - null (no result) renders the factual "No evaluation run yet." empty
 *   state — no fake data, no placeholder numbers;
 * - PURE presentation: it renders EXACTLY the EvaluationResult it is
 *   given, verbatim (labels, notes, reasons), with zero invented copy.
 *
 * UNMOUNTED by design (the P4-ADAPTERS precedent): this component ships
 * tested but is NOT wired into any screen — the shell's index.ts stays
 * outside this order's grant; a later composition-root order mounts it.
 */
export interface EvaluationPanelProps {
  /** The completed evaluation read-out to display; null = no evaluation run yet. */
  readonly result: EvaluationResult | null;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    maxWidth: 720,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  summary: {
    margin: 0,
    color: theme.colors.textMuted,
    lineHeight: 1.6,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  outcome: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  outcomeHeading: { margin: 0, fontSize: theme.typography.sizes.md, fontWeight: 600 },
  idHint: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    fontFamily: theme.typography.monoFamily,
  },
  note: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  metrics: { margin: 0, lineHeight: 1.6 },
  failed: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    color: theme.colors.textMuted,
  },
  failedHeading: { margin: 0, fontSize: theme.typography.sizes.md, fontWeight: 600 },
  overlapList: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
  },
};

/** Formats a share as a percentage, e.g. 0.5 -> "50%". */
function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A share WITH its population — the no-100%-without-N rendering rule. */
function shareWithPopulation(numerator: number, denominator: number, share: number | null): string {
  if (share === null) return `${numerator} of ${denominator} (no population — no share)`;
  return `${numerator} of ${denominator} (${pct(share)})`;
}

export function EvaluationPanel(props: EvaluationPanelProps) {
  const { result } = props;

  if (result === null) {
    return (
      <section
        aria-label="Evaluation results"
        data-testid="evaluation-panel-root"
        style={styles.root}
      >
        <h2 style={styles.heading}>Evaluation</h2>
        <p style={styles.empty} data-testid="evaluation-panel-empty">
          No evaluation run yet.
        </p>
      </section>
    );
  }

  const { replay, outcomes, pairwiseOverlaps, k } = result;
  return (
    <section
      aria-label="Evaluation results"
      data-testid="evaluation-panel-root"
      style={styles.root}
    >
      <h2 style={styles.heading}>Evaluation</h2>

      <p style={styles.summary} data-testid="evaluation-panel-summary">
        Replayed {replay.feedbackReplayed} of {replay.feedbackTotalStored} stored feedback events (
        {replay.explicitUnderTest} explicit · {replay.implicitUnderTest} implicit under test) ·
        objectives {replay.objectivesApplied ? "applied" : "not set"} · {replay.itemsUnderTest}{" "}
        items under test · k={k} · as of {result.asOf}
      </p>

      {outcomes.map((outcome) => (
        <OutcomeCard key={outcome.configurationIndex} outcome={outcome} k={k} />
      ))}

      {pairwiseOverlaps.length > 0 ? (
        <ul style={styles.overlapList} data-testid="evaluation-overlaps">
          {pairwiseOverlaps.map((overlap) => {
            const labelA = labelOf(outcomes, overlap.a);
            const labelB = labelOf(outcomes, overlap.b);
            const share =
              overlap.share === null
                ? "both top-k lists empty — nothing to compare"
                : pct(overlap.share);
            return (
              <li key={`${overlap.a}-${overlap.b}`}>
                {labelA} vs {labelB}: top-{k} overlap {overlap.overlap} (side sizes {overlap.sizeA},{" "}
                {overlap.sizeB}) — {share}
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={styles.note} data-testid="evaluation-overlaps">
          No pairwise overlaps — fewer than two configurations evaluated.
        </p>
      )}
    </section>
  );
}

/** One per-configuration card: the metrics AND their populations. */
function OutcomeCard(props: { outcome: EvaluationOutcome; k: number }) {
  const { outcome, k } = props;
  if (outcome.kind === "failed") {
    return (
      <article
        aria-label={`Configuration ${outcome.configurationIndex} could not run`}
        data-testid={`evaluation-outcome-${outcome.configurationIndex}`}
        style={styles.failed}
      >
        <h3 style={styles.failedHeading}>Could not run: {outcome.rankerId}</h3>
        <p
          style={styles.note}
          data-testid={`evaluation-failed-reason-${outcome.configurationIndex}`}
        >
          {outcome.reason}
        </p>
      </article>
    );
  }
  const { agreement, scoreStats, ranking } = outcome;
  const rankingSummary =
    ranking.kind === "ranked"
      ? `Ranked ${ranking.items.length} items`
      : `Empty ranking — ${ranking.reason}`;
  const scoreSummary =
    scoreStats.count === 0
      ? "Scores: no ranked items (population 0)"
      : `Scores over ${scoreStats.count} items: min ${scoreStats.min} · median ${scoreStats.median} · mean ${scoreStats.mean} · max ${scoreStats.max}`;
  return (
    <article
      aria-label={`Outcome for ${outcome.rankerLabel}`}
      data-testid={`evaluation-outcome-${outcome.configurationIndex}`}
      style={styles.outcome}
    >
      <h3 style={styles.outcomeHeading}>{outcome.rankerLabel}</h3>
      <p style={styles.idHint}>{outcome.rankerId}</p>
      <p style={styles.note} data-testid={`evaluation-resolution-${outcome.configurationIndex}`}>
        {outcome.resolutionNote}
      </p>
      <p style={styles.metrics}>{rankingSummary}</p>
      <p style={styles.metrics} data-testid={`evaluation-agreement-${outcome.configurationIndex}`}>
        Liked in top-{k}:{" "}
        {shareWithPopulation(agreement.likedInTopK, agreement.likedTotal, agreement.likedShare)} ·
        disliked in bottom-{k}:{" "}
        {shareWithPopulation(
          agreement.dislikedInBottomK,
          agreement.dislikedTotal,
          agreement.dislikedShare,
        )}{" "}
        · abstained: {agreement.abstained} · agreement:{" "}
        {agreement.agreedShare === null
          ? "no rated items"
          : shareWithPopulation(
              agreement.likedInTopK + agreement.dislikedInBottomK,
              agreement.likedTotal + agreement.dislikedTotal,
              agreement.agreedShare,
            )}
      </p>
      <p style={styles.metrics} data-testid={`evaluation-scores-${outcome.configurationIndex}`}>
        {scoreSummary}
      </p>
    </article>
  );
}

/** The label of the outcome at a configuration index (defensive fallback). */
function labelOf(outcomes: readonly EvaluationOutcome[], configurationIndex: number): string {
  const outcome = outcomes.find((candidate) => candidate.configurationIndex === configurationIndex);
  if (outcome === undefined) return `configuration ${configurationIndex}`;
  return outcome.kind === "evaluated" ? outcome.rankerLabel : `#${configurationIndex}`;
}
