import React, { useState } from "react";
import { theme } from "../theme";
import type {
  DataBoundaryDescription,
  RetentionBoundaryClass,
  RetentionRecordScope,
  RetentionScope,
  RetentionState,
  ResetLocalDataResult,
} from "webflix-application";

/**
 * SettingsScreen — the WF-021 history/retention surface (P7-COMPOSE-1),
 * mounting the MERGED P7-RETENTION-1 use cases' view models AS-IS:
 * RetentionState (pause status + counts + the boundary table) in,
 * pause/resume/scoped-reset intents out, ResetLocalDataResult rendered
 * verbatim. Props stay flat + optional (the AppShell conventions):
 * null = the honest never-loaded state, [] = the honest empty one —
 * NO faked data, NO invented defaults, NO dead buttons (every rendered
 * control has a real wired handler or is not rendered at all).
 *
 * Honesty rules this surface pins:
 * - the never-set preference is surfaced DISTINCTLY ("no preference set
 *   yet — tracking is active by default"), never dressed up as an
 *   explicit resume;
 * - a scoped reset ALWAYS takes two explicit steps (select scope → read
 *   exactly what it clears and what it never touches → confirm); one
 *   click never deletes anything;
 * - `all` is stated as the UNION of the three local record scopes — never
 *   "everything on disk" (the library, objectives and derived artifacts
 *   stay; their own management surfaces own them);
 * - provider-owned record classes are named as NOT deletable here, in the
 *   boundary view AND after every reset (the boundary IS the feature);
 * - derived classes are labeled as held locally with the provider-side
 *   source remaining.
 */
export interface SettingsScreenProps {
  /**
   * The retention state view model (GetRetentionState's output shape):
   * pause status with the never-set flag, the three local record counts,
   * and the full boundary table. null = not loaded yet (honest default).
   */
  readonly retentionState?: RetentionState | null;
  /** Fires on the explicit pause action (persisted preference write). */
  readonly onPauseHistoryTracking?: () => void;
  /** Fires on the explicit resume action (the paused-state recovery). */
  readonly onResumeHistoryTracking?: () => void;
  /** Fires with the CONFIRMED scope when the user completes the reset step. */
  readonly onResetLocalData?: (scope: RetentionScope) => void;
  /** The last reset's result, rendered verbatim; null = no reset yet. */
  readonly resetResult?: ResetLocalDataResult | null;
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
  statusPaused: { margin: 0, color: theme.colors.warning, fontWeight: 600 },
  statusActive: { margin: 0, color: theme.colors.ok, fontWeight: 600 },
  button: {
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
  },
  dangerButton: {
    background: theme.colors.danger,
    color: "#fff",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
  },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
  },
  empty: {
    margin: 0,
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
  },
  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  },
  scopeRow: { display: "flex", alignItems: "center", gap: theme.spacing.sm, minHeight: 44 },
  scopeLabel: { cursor: "pointer", fontWeight: 600 },
  confirm: {
    border: `1px solid ${theme.colors.danger}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    width: "100%",
  },
  confirmTitle: { margin: 0, color: theme.colors.danger, fontWeight: 600 },
  boundaryList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
  },
  boundaryRow: {
    width: "100%",
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    alignItems: "baseline",
    padding: `${theme.spacing.xs}px 0`,
    borderBottom: `1px solid ${theme.colors.border}`,
  },
  boundaryClass: { fontWeight: 600 },
  boundaryMeta: { color: theme.colors.textMuted },
};

/** The four reset scopes in display order (the contract's own vocabulary). */
const RESET_SCOPES: readonly RetentionScope[] = ["history", "progress", "feedback", "all"];

const RESET_SCOPE_LABELS: Record<RetentionScope, string> = {
  history: "Watch history",
  progress: "Playback progress",
  feedback: "Feedback events",
  all: "All three — history + progress + feedback",
};

/** Readable boundary-class labels (the engine's i18n keys resolve host-side). */
const BOUNDARY_LABELS: Record<RetentionBoundaryClass, string> = {
  "webflix-local": "WebFlix-local",
  "provider-owned": "Provider-owned",
  derived: "Derived",
};

const SCOPE_RADIO_GROUP = "webflix-retention-reset-scope";

/** The record classes a reset scope clears, from the boundary table AS DATA. */
function classesCoveredByScope(
  boundaries: readonly DataBoundaryDescription[] | null,
  scope: RetentionScope,
): readonly DataBoundaryDescription[] {
  if (boundaries === null) return [];
  return boundaries.filter((row) => row.resetScope !== null && scopeCovers(scope, row.resetScope));
}

/** all covers every local scope; a named scope covers only itself. */
function scopeCovers(scope: RetentionScope, rowScope: RetentionRecordScope): boolean {
  return scope === "all" || scope === rowScope;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const { onPauseHistoryTracking, onResumeHistoryTracking, onResetLocalData } = props;
  // Normalize the flat-optional props to their honest null defaults.
  const retentionState = props.retentionState ?? null;
  const resetResult = props.resetResult ?? null;

  return (
    <section aria-label="Settings" data-testid="settings-root" style={styles.root}>
      <h1 style={styles.heading}>Settings</h1>
      <p style={styles.muted}>
        History and retention controls for the records WebFlix owns locally. Provider-owned data is
        never touched from here — the boundary is stated, never implied.
      </p>

      <TrackingSection
        state={retentionState}
        onPause={onPauseHistoryTracking}
        onResume={onResumeHistoryTracking}
      />

      <ResetSection
        boundaries={retentionState?.boundaries ?? null}
        counts={retentionState?.localRecordCounts ?? null}
        onReset={onResetLocalData}
        result={resetResult}
      />

      <BoundarySection state={retentionState} />
    </section>
  );
}

/** The tracking pause/resume control (persisted preference, explicit actions). */
function TrackingSection(props: {
  state: RetentionState | null;
  onPause?: () => void;
  onResume?: () => void;
}) {
  const { state, onPause, onResume } = props;

  return (
    <section aria-label="History tracking" data-testid="retention-tracking" style={styles.panel}>
      <h2 style={styles.panelTitle}>History tracking</h2>
      {state === null ? (
        <p data-testid="retention-tracking-empty" style={styles.empty}>
          Retention state has not been loaded yet — pause status and record counts appear when the
          host loads them. Nothing is assumed in the meantime.
        </p>
      ) : (
        <>
          <p
            data-testid="retention-tracking-status"
            style={state.historyTrackingPaused ? styles.statusPaused : styles.statusActive}
          >
            {state.historyTrackingPaused
              ? "History tracking is PAUSED"
              : "History tracking is ACTIVE"}
          </p>
          {state.preferenceNeverSet && (
            <p data-testid="retention-tracking-neverset" style={styles.muted}>
              No preference has been set yet — tracking is active by default. Never-set is never
              disguised as an explicit resume.
            </p>
          )}
          {state.preferenceUpdatedAt !== null && (
            <p data-testid="retention-tracking-updated" style={styles.muted}>
              Last explicit change: {state.preferenceUpdatedAt}
            </p>
          )}
        </>
      )}
      {/* Controls render ONLY with a real wired handler — never dead buttons. */}
      {state?.historyTrackingPaused === false && onPause && (
        <button
          type="button"
          data-testid="retention-tracking-pause"
          style={styles.button}
          onClick={onPause}
        >
          Pause history tracking
        </button>
      )}
      {state?.historyTrackingPaused === true && onResume && (
        <button
          type="button"
          data-testid="retention-tracking-resume"
          style={styles.button}
          onClick={onResume}
        >
          Resume history tracking
        </button>
      )}
    </section>
  );
}

/** The scoped reset — select, read exactly what it does, then confirm. */
function ResetSection(props: {
  boundaries: readonly DataBoundaryDescription[] | null;
  counts: Readonly<Record<RetentionRecordScope, number>> | null;
  onReset?: (scope: RetentionScope) => void;
  result: ResetLocalDataResult | null;
}) {
  const { boundaries, counts, onReset, result } = props;
  const [selected, setSelected] = useState<RetentionScope | null>(null);

  const covered = selected !== null ? classesCoveredByScope(boundaries, selected) : [];
  const providerOwned = boundaries?.filter((row) => row.boundary === "provider-owned") ?? [];

  return (
    <section aria-label="Reset local data" data-testid="retention-reset" style={styles.panel}>
      <h2 style={styles.panelTitle}>Reset local data</h2>
      {counts !== null && (
        <p data-testid="retention-reset-counts" style={styles.muted}>
          Current local records — history: {counts.history} · progress: {counts.progress} ·
          feedback: {counts.feedback}
        </p>
      )}
      <p style={styles.muted}>
        Deleting is always two steps: choose a scope, read exactly what it clears and what it never
        touches, then confirm.
      </p>
      <ul style={styles.scopeList} data-testid="retention-reset-scopes">
        {RESET_SCOPES.map((scope) => (
          <li key={scope} style={styles.scopeRow}>
            <input
              id={`retention-reset-scope-${scope}`}
              type="radio"
              name={SCOPE_RADIO_GROUP}
              value={scope}
              checked={selected === scope}
              onChange={() => setSelected(scope)}
              data-testid={`retention-reset-scope-input-${scope}`}
              style={{ accentColor: theme.colors.accent }}
            />
            <label htmlFor={`retention-reset-scope-${scope}`} style={styles.scopeLabel}>
              {RESET_SCOPE_LABELS[scope]}
            </label>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <div data-testid="retention-reset-confirm" style={styles.confirm}>
          <p style={styles.confirmTitle}>
            Confirm the reset: {RESET_SCOPE_LABELS[selected]}
            {selected === "all"
              ? " (the union of the three local scopes — NOT everything on disk)"
              : ""}
          </p>
          {boundaries === null ? (
            <p style={styles.muted}>
              Record-class coverage loads with the retention state — confirm without that list is
              not offered from invented data.
            </p>
          ) : (
            <p style={styles.muted}>
              This will delete:{" "}
              {covered.length > 0
                ? covered.map((row) => row.recordClass).join(", ")
                : `the ${selected} records`}
              . Untouched: the local library, objectives, derived artifacts and cached provider
              field sets (their own management surfaces own them). Never deletable from WebFlix:{" "}
              {providerOwned.map((row) => row.recordClass).join(", ")}.
            </p>
          )}
          {onReset ? (
            <button
              type="button"
              data-testid="retention-reset-confirm-button"
              style={styles.dangerButton}
              onClick={() => onReset(selected)}
            >
              Delete {RESET_SCOPE_LABELS[selected]}
            </button>
          ) : (
            <p style={styles.muted}>
              No reset handler is wired — the confirm control is not shown.
            </p>
          )}
          <button
            type="button"
            data-testid="retention-reset-cancel"
            style={styles.ghostButton}
            onClick={() => setSelected(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {result !== null && (
        <div data-testid="retention-reset-result" style={styles.confirm}>
          <p style={{ ...styles.confirmTitle, color: theme.colors.ok }}>
            Reset completed — scope: {result.scope}
          </p>
          <p style={styles.muted}>
            Removed: history {result.removed.history} · progress {result.removed.progress} ·
            feedback {result.removed.feedback}. Untouched local scopes:{" "}
            {result.untouchedLocalScopes.length > 0
              ? result.untouchedLocalScopes.join(", ")
              : "none — every local scope was in the confirmed reset"}
            .
          </p>
          <p style={styles.muted}>
            Provider-owned record classes NOT deleted here:{" "}
            {result.providerOwnedRecordClassesNotDeletableHere.join(", ")}.
          </p>
        </div>
      )}
    </section>
  );
}

/** The data-boundary explanation view — every record class, its boundary, deletability. */
function BoundarySection(props: { state: RetentionState | null }) {
  const { state } = props;

  return (
    <section
      aria-label="Data boundaries"
      data-testid="retention-boundaries-section"
      style={styles.panel}
    >
      <h2 style={styles.panelTitle}>Where your data lives</h2>
      {state === null ? (
        <p data-testid="retention-boundaries-empty" style={styles.empty}>
          The data-boundary explanation loads with the retention state.
        </p>
      ) : (
        <ul data-testid="retention-boundaries" style={styles.boundaryList}>
          {state.boundaries.map((row) => (
            <li
              key={row.recordClass}
              data-testid={`retention-boundary-${row.recordClass}`}
              style={styles.boundaryRow}
            >
              <span style={styles.boundaryClass}>{BOUNDARY_LABELS[row.boundary]}</span>
              <span>{row.recordClass}</span>
              <span style={styles.boundaryMeta}>
                {row.deletableHere && row.resetScope !== null
                  ? `deletable here (reset scope: ${row.resetScope})`
                  : row.boundary === "provider-owned"
                    ? "not deletable from WebFlix — the provider owns it"
                    : "not covered by any reset scope here — its own management surface owns it"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
