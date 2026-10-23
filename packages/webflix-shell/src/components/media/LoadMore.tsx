// Cursor pagination affordances (WFX-UX-SHELL-1) — the shared "load more"
// control every growing surface mounts. Two honest paths:
//
// - The BUTTON (keyboard path): visible, labeled, disabled-with-reason when
//   no handler is wired or the cursor is exhausted. Never a dead control.
// - The SENTINEL (pointer/infinite-scroll path): feature-detected — hosts
//   without IntersectionObserver (jsdom included) render the sentinel inert
//   and rely on the button, which is why the button always exists.
//
// The shell never fetches: the host owns the port call (freeze §9), the
// shell reports the cursor. Append-only rendering (order preserved, no
// programmatic scrolling) is each surface's own layout law — appending
// BELOW existing content cannot jump the viewport.

import React, { useEffect, useRef } from "react";
import { theme } from "../../theme";

export interface LoadMoreControlProps {
  /** The view's own cursor (null = no more pages — the producer said so). */
  readonly nextCursor: string | null;
  /** Fires with the cursor when more is requested. */
  readonly onLoadMore?: (cursor: string) => void;
  /** Host-provided in-flight fact; true disables + relabels the button. */
  readonly loadingMore?: boolean;
  /** ARIA label naming the surface (e.g. "home feed"). */
  readonly surfaceLabel?: string;
  readonly testId?: string;
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.md}px 0`,
    minWidth: 0,
  },
  button: {
    background: theme.colors.surface,
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    minHeight: 44,
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
  },
  buttonDisabled: {
    color: theme.colors.textMuted,
    borderColor: theme.colors.border,
    cursor: "default",
  },
  reason: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  sentinel: { width: "100%", height: 1 },
};

/**
 * Observes a sentinel element and fires `onIntersect` while visible.
 * Feature-detected: without IntersectionObserver the hook is inert and the
 * caller's explicit button remains the only paging path (honest fallback).
 */
export function useIntersectionSentinel(
  enabled: boolean,
  onIntersect: () => void,
): React.RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onIntersectRef = useRef(onIntersect);
  onIntersectRef.current = onIntersect;

  useEffect(() => {
    if (!enabled) return;
    if (typeof IntersectionObserver === "undefined") return;
    const element = sentinelRef.current;
    if (element === null) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onIntersectRef.current();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);

  return sentinelRef;
}

export function LoadMoreControl(props: LoadMoreControlProps): React.ReactElement {
  const { nextCursor, onLoadMore, loadingMore = false, surfaceLabel, testId } = props;
  const enabled = nextCursor !== null && onLoadMore !== undefined && !loadingMore;
  const sentinelRef = useIntersectionSentinel(
    enabled && nextCursor !== null,
    () => {
      if (nextCursor !== null && onLoadMore !== undefined) onLoadMore(nextCursor);
    },
  );

  const label = loadingMore ? "Loading more…" : "Load more";
  const reason =
    nextCursor === null
      ? "No more pages — the view said so."
      : onLoadMore === undefined
        ? "Paging is not wired by this host yet."
        : undefined;

  return (
    <div style={styles.wrap} data-testid={testId ?? "load-more"}>
      <button
        type="button"
        data-testid={(testId ?? "load-more") + "-button"}
        disabled={!enabled}
        aria-label={
          surfaceLabel === undefined ? label : `${label} from the ${surfaceLabel}`
        }
        style={{
          ...styles.button,
          ...(!enabled ? styles.buttonDisabled : undefined),
        }}
        onClick={() => {
          if (nextCursor !== null && onLoadMore !== undefined && !loadingMore) {
            onLoadMore(nextCursor);
          }
        }}
      >
        {label}
      </button>
      {!enabled && reason && (
        <p data-testid={(testId ?? "load-more") + "-reason"} style={styles.reason}>
          {reason}
        </p>
      )}
      {nextCursor !== null && (
        <div
          ref={sentinelRef}
          data-testid={(testId ?? "load-more") + "-sentinel"}
          aria-hidden="true"
          style={styles.sentinel}
        />
      )}
    </div>
  );
}
