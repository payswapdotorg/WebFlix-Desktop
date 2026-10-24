// Category chips (WFX-UX-SHELL-1) — the home feed's and trending chart's
// filter row. Chips render EXACTLY the producer's vocabulary: the shell
// adds no invented "All" chip (a producer that wants one includes it in
// `chips`); selection state is the producer's `selectedChip` fact, and a
// chip only acts when a real handler is wired.
//
// WFX-WEB-LOOK-1: the chips carry the web product's idiom — borderless
// secondary pills with the INVERTED active state (bg-foreground on
// bg-background, the web product's active category chip).

import React from "react";
import { theme } from "../../theme";

export interface CategoryChipRowProps {
  readonly chips: readonly string[];
  /** The producer's selected-chip fact (null = none selected). */
  readonly selected: string | null;
  /** Fires with the chip value on activation. */
  readonly onSelect?: (chip: string) => void;
  readonly ariaLabel?: string;
  readonly testId?: string;
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.sm + 4,
    padding: 0,
    margin: 0,
    listStyle: "none",
    minWidth: 0,
  },
  chip: {
    background: theme.colors.surfaceRaised,
    color: theme.colors.text,
    border: "none",
    borderRadius: 999,
    padding: "8px 14px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontSize: theme.typography.sizes.md,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  chipSelected: {
    background: theme.colors.text,
    color: theme.colors.background,
    fontWeight: 500,
  },
  chipStatic: { cursor: "default" },
};

export function CategoryChipRow(props: CategoryChipRowProps): React.ReactElement {
  const { chips, selected, onSelect, ariaLabel = "Categories", testId } = props;

  return (
    <ul
      role="list"
      aria-label={ariaLabel}
      data-testid={testId ?? "category-chips"}
      style={styles.row}
    >
      {chips.map((chip, index) => {
        const isSelected = selected === chip;
        const chipStyle = {
          ...styles.chip,
          ...(isSelected ? styles.chipSelected : undefined),
          ...(onSelect === undefined ? styles.chipStatic : undefined),
        };
        return (
          <li key={`${chip}-${index}`}>
            {onSelect === undefined ? (
              <span
                data-testid={`category-chip-${index}`}
                className="wfx-chip"
                data-active={isSelected ? "true" : undefined}
                aria-current={isSelected ? "true" : undefined}
                style={chipStyle}
              >
                {chip}
              </span>
            ) : (
              <button
                type="button"
                data-testid={`category-chip-${index}`}
                className="wfx-chip"
                data-active={isSelected ? "true" : undefined}
                aria-pressed={isSelected}
                onClick={() => onSelect(chip)}
                style={chipStyle}
              >
                {chip}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
