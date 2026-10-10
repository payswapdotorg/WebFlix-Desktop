import React, { useState } from "react";
import { theme } from "../theme";
import type { CatalogItem } from "webflix-contracts";
import { HONEST_COPY } from "../states";
import type { SearchState } from "../states";

export interface SearchScreenProps {
  readonly state: SearchState;
  readonly onQueryChange?: (query: string) => void;
  readonly onSubmit?: (query: string) => void;
  readonly onRetry?: () => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onSelectItem?: (item: CatalogItem) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  form: { display: "flex", gap: theme.spacing.sm },
  input: {
    flex: 1,
    background: theme.colors.surface,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: "10px 12px",
    fontSize: theme.typography.sizes.md,
  },
  button: {
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
  },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    cursor: "pointer",
  },
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
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  row: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
    borderBottom: `1px solid ${theme.colors.border}`,
  },
  list: { listStyle: "none", margin: 0, padding: 0, width: "100%" },
};

export function SearchScreen(props: SearchScreenProps) {
  const { state, onQueryChange, onSubmit, onRetry, onConnect, onSelectItem } = props;
  const [query, setQuery] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    onQueryChange?.(trimmed);
    onSubmit?.(trimmed);
  };

  return (
    <section aria-label="Search" style={styles.root}>
      <h1 style={styles.heading}>Search</h1>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="search"
          data-testid="search-input"
          aria-label="Search query"
          placeholder="Search YouTube…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Search
        </button>
      </form>
      <ResultsArea
        state={state}
        onRetry={onRetry}
        onConnect={onConnect}
        onSelectItem={onSelectItem}
      />
    </section>
  );
}

function ResultsArea(props: {
  state: SearchState;
  onRetry?: () => void;
  onConnect?: (providerId: string) => void;
  onSelectItem?: (item: CatalogItem) => void;
}) {
  const { state, onRetry, onConnect, onSelectItem } = props;

  switch (state.phase) {
    case "idle":
      return (
        <div data-testid="search-idle" role="status" style={styles.panel}>
          <p style={styles.muted}>
            Type a query to search your connected providers. WebFlix will show only what it can
            honestly deliver — never filler, never fake results.
          </p>
        </div>
      );

    case "loading":
      return (
        <div data-testid="search-loading" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY.loading.title}</p>
          <p style={styles.muted}>Searching for “{state.query}”…</p>
        </div>
      );

    case "results":
      return (
        <div data-testid="search-results" style={styles.panel}>
          <p style={styles.panelTitle}>
            {state.items.length} result{state.items.length === 1 ? "" : "s"} for “{state.query}”
          </p>
          <ul style={styles.list}>
            {state.items.map((item) => (
              <li key={item.id} style={styles.row}>
                <span>
                  {item.title}
                  <span style={styles.muted}>
                    {" "}
                    · {item.providerId} · {item.kind}
                  </span>
                </span>
                <button
                  type="button"
                  style={styles.ghostButton}
                  aria-label={`Play ${item.title}`}
                  onClick={() => onSelectItem?.(item)}
                >
                  Play
                </button>
              </li>
            ))}
          </ul>
        </div>
      );

    case "empty":
      return (
        <div data-testid="search-empty" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY.empty.title}</p>
          <p style={styles.muted}>{HONEST_COPY.empty.message}</p>
        </div>
      );

    case "requires-auth":
      return (
        <div data-testid="search-requires-auth" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY["requires-auth"].title}</p>
          <p style={styles.muted}>{HONEST_COPY["requires-auth"].message}</p>
          <button type="button" style={styles.button} onClick={() => onConnect?.(state.providerId)}>
            {HONEST_COPY["requires-auth"].actionLabel}
          </button>
        </div>
      );

    case "rate-limited":
      return (
        <div data-testid="search-rate-limited" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY["rate-limited"].title}</p>
          <p style={styles.muted}>{HONEST_COPY["rate-limited"].message}</p>
          {state.retryAfterSeconds !== undefined && (
            <p style={styles.muted}>Quota should reset in about {state.retryAfterSeconds}s.</p>
          )}
          {onRetry && (
            <button type="button" style={styles.ghostButton} onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      );

    case "unsupported":
      return (
        <div data-testid="search-unsupported" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY.unsupported.title}</p>
          <p style={styles.muted}>{HONEST_COPY.unsupported.message}</p>
          <p style={styles.muted}>Reason: {state.reason}</p>
          {/* Honest by design: 'unsupported' renders no play control. A button
              here would be dead — the state explains itself instead. */}
        </div>
      );

    case "unavailable":
      return (
        <div data-testid="search-unavailable" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY.unavailable.title}</p>
          <p style={styles.muted}>{HONEST_COPY.unavailable.message}</p>
          <p style={styles.muted}>Reason: {state.reason}</p>
          {onRetry && (
            <button type="button" style={styles.ghostButton} onClick={onRetry}>
              {HONEST_COPY.unavailable.actionLabel}
            </button>
          )}
        </div>
      );

    case "status-unknown":
      return (
        <div data-testid="search-status-unknown" role="status" style={styles.panel}>
          <p style={styles.panelTitle}>{HONEST_COPY["status-unknown"].title}</p>
          <p style={styles.muted}>{HONEST_COPY["status-unknown"].message}</p>
          {state.detail && <p style={styles.muted}>{state.detail}</p>}
          {onRetry && (
            <button type="button" style={styles.ghostButton} onClick={onRetry}>
              {HONEST_COPY["status-unknown"].actionLabel}
            </button>
          )}
        </div>
      );
  }
}
