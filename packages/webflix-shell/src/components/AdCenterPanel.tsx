import React from "react";
import type { AdsQualificationItemOutcome } from "webflix-application";
import type { AdEvidencePointer } from "webflix-contracts";
import { theme } from "../theme";

/**
 * AdCenterPanel — the explainable-qualification read-out surface (P5-QUALIFY
 * scope row 2; the EvaluationPanel precedent: props-driven, native,
 * aria-labelled, NO fetch, NO effects, NO telemetry).
 *
 * Honesty rules this component pins:
 * - DISPLAY-STANDING, STATED PLAINLY: qualification explains an ad's
 *   standing in the AD CENTER view — it is not a promise of ad quality and
 *   it never affects organic recommendations (the standing disclaimer
 *   renders with every result set; phase5-ad-plan §3 + §5);
 * - NO 100% WITHOUT N: every count renders with its population ("3 of 5
 *   claims currently verified") — a bare percentage or a bare count that
 *   could masquerade as a share is never emitted; the per-record facts
 *   line always carries the claim population N;
 * - PER-SOURCE SIGNAL COUNTS, NEVER MERGED: review signals render as one
 *   count per source (as reported) — two sources are two counts, never
 *   one number (the charter's honest non-goal, pinned on the surface too);
 * - REASONS + EVIDENCE POINTERS render verbatim — every reason's text as
 *   the policy minted it, each pointer as its kind + id (claim /
 *   offer-verification / review-signal / evidence-link / source-coverage);
 * - THE HONEST NO-DATA record renders its statement — never a
 *   zero-dressed-as-signal standing, never fabricated reasons;
 * - null (no results) renders the factual "No qualification results yet."
 *   empty state — no fake data, no placeholder numbers;
 * - PURE presentation: it renders EXACTLY the qualification outcomes it is
 *   given, with zero invented copy.
 *
 * UNMOUNTED by design (the P4-ADAPTERS / P4-EVALLOOP precedent): this
 * component ships tested but is NOT wired into any screen and is NOT
 * exported from the shell's index.ts (outside this order's grant); a later
 * composition-root order mounts it.
 */
export interface AdCenterPanelProps {
  /** The completed qualification read-outs to display; null = no run yet. */
  readonly results: readonly AdsQualificationItemOutcome[] | null;
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
  disclaimer: {
    margin: 0,
    color: theme.colors.textMuted,
    lineHeight: 1.5,
    fontSize: theme.typography.sizes.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  record: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  recordHeading: { margin: 0, fontSize: theme.typography.sizes.md, fontWeight: 600 },
  idHint: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    fontFamily: theme.typography.monoFamily,
  },
  standing: { margin: 0, lineHeight: 1.6 },
  facts: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.6,
  },
  reasonsHeading: {
    margin: 0,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
    color: theme.colors.textMuted,
  },
  reasonList: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingInlineStart: theme.spacing.md,
    lineHeight: 1.6,
  },
  evidence: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    fontFamily: theme.typography.monoFamily,
  },
  noData: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    color: theme.colors.textMuted,
  },
  noDataHeading: { margin: 0, fontSize: theme.typography.sizes.md, fontWeight: 600 },
  rejected: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.5,
  },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
  },
};

/** The DISPLAY-STANDING disclaimer — stated plainly, always rendered with results. */
const DISPLAY_STANDING_DISCLAIMER =
  "Qualification explains an ad's standing in the Ad Center view. It is not a promise of " +
  "ad quality, and it never affects organic recommendations.";

/** Renders one evidence pointer as its kind + id (the concrete ads-lane record it names). */
function pointerLabel(pointer: AdEvidencePointer): string {
  switch (pointer.kind) {
    case "claim":
      return `claim ${pointer.claimId}`;
    case "evidence-link":
      return `evidence-link ${pointer.evidenceLinkId}`;
    case "review-signal":
      return `review-signal ${pointer.reviewSignalId}`;
    case "offer-verification":
      return `offer-verification ${pointer.verificationId}`;
    case "source-coverage":
      return `source-coverage ${pointer.source}`;
  }
}

export function AdCenterPanel(props: AdCenterPanelProps) {
  const { results } = props;

  if (results === null) {
    return (
      <section
        aria-label="Ad Center qualification"
        data-testid="ad-center-panel-root"
        style={styles.root}
      >
        <h2 style={styles.heading}>Ad Center</h2>
        <p style={styles.empty} data-testid="ad-center-panel-empty">
          No qualification results yet.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Ad Center qualification"
      data-testid="ad-center-panel-root"
      style={styles.root}
    >
      <h2 style={styles.heading}>Ad Center</h2>
      <p style={styles.disclaimer} data-testid="ad-center-panel-disclaimer">
        {DISPLAY_STANDING_DISCLAIMER}
      </p>
      {results.map((result) => (
        <RecordCard key={`${result.index}-${result.adRecordId}`} result={result} />
      ))}
    </section>
  );
}

/** One per-record card: the standing, the counted populations, the reasons. */
function RecordCard(props: { result: AdsQualificationItemOutcome }) {
  const { result } = props;

  if (result.outcome === "no-data") {
    return (
      <article
        aria-label={`Qualification for ${result.adRecordId}`}
        data-testid={`ad-center-record-${result.index}`}
        style={styles.noData}
      >
        <h3 style={styles.noDataHeading}>No data</h3>
        <p style={styles.idHint}>{result.adRecordId}</p>
        <p style={styles.facts} data-testid={`ad-center-no-data-${result.index}`}>
          {result.statement}
        </p>
      </article>
    );
  }

  if (result.outcome === "rejected") {
    return (
      <article
        aria-label={`Qualification for ${result.adRecordId}`}
        data-testid={`ad-center-record-${result.index}`}
        style={styles.noData}
      >
        <h3 style={styles.noDataHeading}>Not qualified — record absent</h3>
        <p style={styles.idHint}>{result.adRecordId}</p>
        <p style={styles.rejected} data-testid={`ad-center-rejected-${result.index}`}>
          {result.reason}
        </p>
      </article>
    );
  }

  const { explanation, facts } = result;
  const standingText = explanation.qualified
    ? "Qualified for the Ad Center view"
    : "Not qualified for the Ad Center view";
  const signalCounts =
    facts.signalsBySource.length === 0
      ? "no stored review signals attached"
      : facts.signalsBySource
          .map(
            (entry) => `${entry.source}: ${entry.count} (as reported, per source — never merged)`,
          )
          .join(" · ");
  const factsText =
    `Claims: ${facts.claimsTotal} · currently verified ${facts.currentByOutcome.verified} · ` +
    `not verifiable ${facts.currentByOutcome.notVerifiable} · contradicted ` +
    `${facts.currentByOutcome.contradicted} · unchecked ${facts.currentByOutcome.unchecked} · ` +
    `review signals — ${signalCounts}`;

  return (
    <article
      aria-label={`Qualification for ${result.adRecordId}`}
      data-testid={`ad-center-record-${result.index}`}
      style={styles.record}
    >
      <h3 style={styles.recordHeading}>{standingText}</h3>
      <p style={styles.idHint}>{result.adRecordId}</p>
      <p style={styles.facts} data-testid={`ad-center-facts-${result.index}`}>
        {factsText}
      </p>
      <h4 style={styles.reasonsHeading}>Why</h4>
      <ul style={styles.reasonList} data-testid={`ad-center-reasons-${result.index}`}>
        {explanation.reasons.map((reason, reasonIndex) => (
          <li key={reasonIndex}>
            {reason.text}
            <p style={styles.evidence}>
              {reason.evidence.map((pointer) => pointerLabel(pointer)).join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
