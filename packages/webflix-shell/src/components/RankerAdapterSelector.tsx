import React from "react";
import type { RankerAdapterDescriptor } from "webflix-application";
import { theme } from "../theme";

/**
 * RankerAdapterSelector — the honest adapter-selection control
 * (P4-ADAPTERS row 3; phase4-mi-plan §6: user-selected adapters, never a
 * hidden default).
 *
 * Honesty rules this component pins:
 * - it renders the REGISTRY it is given, verbatim — one option per entry
 *   with its real label, description, capabilities and id. Today the
 *   default registry carries exactly ONE entry (the built-in v1); the note
 *   states that fact plus the factual "more adapters arrive with later
 *   Phase-4 orders". NO fake options, NO placeholder rows implying
 *   unshipped capability, NO invented copy;
 * - `selectedAdapterId` is the STORED selection (null = no selection set —
 *   then NO option is checked and the caller's statusNote explains that the
 *   documented default is active; an explicit selection of the built-in is
 *   a checked option, visibly distinct from never-set);
 * - `statusNote` (optional) renders verbatim in a polite live region — the
 *   surface for resolveSelectedRanker's honest metadata (the default note
 *   or a registry-drift fallback reason);
 * - keyboard-navigable (native radios in one named group), labelled (the
 *   fieldset legend + per-option label/aria-describedby);
 * - PURE presentation: no fetch, no network, no telemetry, no effects — the
 *   only callback is onSelectionChange(adapterId) when the user selects.
 */
export interface RankerAdapterSelectorProps {
  /** The registry truth to render (one option per entry, verbatim). */
  readonly entries: readonly RankerAdapterDescriptor[];
  /**
   * The stored selection's adapter id, or null when no selection is set
   * (never-set — NOT the default's id; the default state is explained by
   * statusNote, never faked as a stored choice).
   */
  readonly selectedAdapterId: string | null;
  /** Fires with the selected adapter id when the user selects an option. */
  readonly onSelectionChange: (adapterId: string) => void;
  /**
   * Optional honest status line (e.g. "No adapter selected — the documented
   * default is active." or a registry-drift fallback reason), rendered
   * verbatim. Absent/null renders nothing — nothing is invented.
   */
  readonly statusNote?: string | null;
}

/** One radio group name — keyboard arrow navigation stays within it. */
const RADIO_GROUP_NAME = "webflix-ranker-adapter";

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
    maxWidth: 640,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  status: {
    margin: 0,
    color: theme.colors.textMuted,
    lineHeight: 1.5,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  fieldset: {
    margin: 0,
    padding: 0,
    border: "none",
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
  },
  legend: {
    padding: 0,
    marginBottom: theme.spacing.xs,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
  },
  option: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    background: theme.colors.surface,
  },
  optionRow: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  input: { accentColor: theme.colors.accent, width: 16, height: 16 },
  optionLabel: { fontSize: theme.typography.sizes.md, fontWeight: 600 },
  caps: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  idHint: {
    margin: 0,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    fontFamily: theme.typography.monoFamily,
  },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
  },
  note: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
};

export function RankerAdapterSelector(props: RankerAdapterSelectorProps) {
  const { entries, selectedAdapterId, onSelectionChange, statusNote } = props;

  return (
    <section
      aria-label="Ranker adapter selection"
      data-testid="ranker-selector-root"
      style={styles.root}
    >
      <h2 style={styles.heading}>Ranker adapter</h2>
      <p style={styles.muted}>
        Choose the adapter that ranks your recommendations. WebFlix never switches adapters for you.
      </p>

      {typeof statusNote === "string" && statusNote.length > 0 && (
        <p
          style={styles.status}
          role="status"
          aria-live="polite"
          data-testid="ranker-selector-status"
        >
          {statusNote}
        </p>
      )}

      {entries.length === 0 ? (
        <p style={styles.empty} data-testid="ranker-selector-empty">
          No ranker adapters are available.
        </p>
      ) : (
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Available adapters</legend>
          {entries.map((entry) => {
            const inputId = `ranker-adapter-option-${entry.id}`;
            const descId = `${inputId}-description`;
            const capsId = `${inputId}-capabilities`;
            return (
              <div key={entry.id} style={styles.option} data-testid={`ranker-option-${entry.id}`}>
                <div style={styles.optionRow}>
                  <input
                    id={inputId}
                    type="radio"
                    name={RADIO_GROUP_NAME}
                    value={entry.id}
                    checked={selectedAdapterId === entry.id}
                    onChange={() => onSelectionChange(entry.id)}
                    aria-describedby={`${descId} ${capsId}`}
                    data-testid={`ranker-option-input-${entry.id}`}
                    style={styles.input}
                  />
                  <label htmlFor={inputId} style={styles.optionLabel}>
                    {entry.label}
                  </label>
                </div>
                <p id={descId} style={styles.muted} data-testid={`ranker-option-desc-${entry.id}`}>
                  {entry.description}
                </p>
                <p id={capsId} style={styles.caps} data-testid={`ranker-option-caps-${entry.id}`}>
                  {entry.capabilities.join(" · ")}
                </p>
                <p style={styles.idHint}>{entry.id}</p>
              </div>
            );
          })}
        </fieldset>
      )}

      <p style={styles.note} data-testid="ranker-selector-note">
        {entries.length === 1 ? "1 adapter" : `${entries.length} adapters`} available today. More
        adapters arrive with later Phase-4 orders.
      </p>
    </section>
  );
}
