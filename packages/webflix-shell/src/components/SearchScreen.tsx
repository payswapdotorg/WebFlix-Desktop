import React, { useEffect, useState } from "react";
import { theme } from "../theme";
import type { CatalogItem, SearchPageData, VideoCardView } from "webflix-contracts";
import { HONEST_COPY } from "../states";
import type { SearchState } from "../states";
import {
  BudgetLine,
  CardResultsArea,
  FederatedResultsArea,
  searchResultsStyles as shared,
} from "./search/SearchResults";

export interface SearchScreenProps {
  readonly state: SearchState;
  readonly onQueryChange?: (query: string) => void;
  readonly onSubmit?: (query: string) => void;
  readonly onRetry?: () => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onSelectItem?: (item: CatalogItem) => void;
  // WFX-UX-SHELL-1 (card results, ADDITIVE): the frozen §9 SearchPageData.
  // Present (alongside the results/degraded phase) → the results render as
  // the reference's card list — video cards + channel cards + load-more
  // paging. Absent → the legacy item rows render exactly as before.
  readonly pageData?: SearchPageData | null;
  /** Prefills the input (the global-search navigation path). */
  readonly initialQuery?: string;
  readonly onPlayCard?: (card: VideoCardView) => void;
  readonly onOpenChannel?: (channel: { channelId: string; handle?: string }) => void;
  /** Cursor "load more" paging for the card results. */
  readonly onLoadMore?: (cursor: string) => void;
  readonly loadingMore?: boolean;
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
    // P6-SHELL-RESPONSIVE-1: the 44px touch-target bar (additive prop only).
    minHeight: 44,
    fontSize: theme.typography.sizes.md,
  },
  button: {
    background: theme.colors.accent,
    color: "#ffffff",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "10px 16px",
    // P6-SHELL-RESPONSIVE-1: the 44px touch-target bar (additive prop only).
    minHeight: 44,
    fontWeight: 600,
    cursor: "pointer",
  },
  row: shared.row,
  list: shared.list,
};

export function SearchScreen(props: SearchScreenProps) {
  const {
    state,
    onQueryChange,
    onSubmit,
    onRetry,
    onConnect,
    onSelectItem,
    pageData,
    initialQuery,
    onPlayCard,
    onOpenChannel,
    onLoadMore,
    loadingMore = false,
  } = props;
  const [query, setQuery] = useState(initialQuery ?? "");

  // The global-search navigation path prefill: syncs when the host-driven
  // route param changes (a no-op when it already matches).
  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

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
        pageData={pageData ?? null}
        onPlayCard={onPlayCard}
        onOpenChannel={onOpenChannel}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
      />
    </section>
  );
}

function ResultsArea(props: {
  state: SearchState;
  onRetry?: () => void;
  onConnect?: (providerId: string) => void;
  onSelectItem?: (item: CatalogItem) => void;
  pageData: SearchPageData | null;
  onPlayCard?: (card: VideoCardView) => void;
  onOpenChannel?: (channel: { channelId: string; handle?: string }) => void;
  onLoadMore?: (cursor: string) => void;
  loadingMore: boolean;
}) {
  const {
    state,
    onRetry,
    onConnect,
    onSelectItem,
    pageData,
    onPlayCard,
    onOpenChannel,
    onLoadMore,
    loadingMore,
  } = props;

  switch (state.phase) {
    case "idle":
      return (
        <div data-testid="search-idle" role="status" style={shared.panel}>
          <p style={shared.muted}>
            Type a query to search your connected providers. WebFlix will show only what it can
            honestly deliver — never filler, never fake results.
          </p>
        </div>
      );

    case "loading":
      return (
        <div data-testid="search-loading" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY.loading.title}</p>
          <p style={shared.muted}>Searching for “{state.query}”…</p>
        </div>
      );

    case "results":
      if (pageData !== null) {
        return (
          <CardResultsArea
            pageData={pageData}
            query={state.query}
            budget={state.budget}
            onPlayCard={onPlayCard}
            onSelectItem={onSelectItem}
            onOpenChannel={onOpenChannel}
            onLoadMore={onLoadMore}
            loadingMore={loadingMore}
            degraded={false}
          />
        );
      }
      return (
        <div data-testid="search-results" style={shared.panel}>
          <p style={shared.panelTitle}>
            {state.items.length} result{state.items.length === 1 ? "" : "s"} for “{state.query}”
          </p>
          <BudgetLine budget={state.budget} />
          <ul style={styles.list}>
            {state.items.map((item) => (
              <li key={item.id} style={styles.row}>
                <span>
                  {item.title}
                  <span style={shared.muted}>
                    {" "}
                    · {item.providerId} · {item.mediaKind}
                  </span>
                </span>
                <button
                  type="button"
                  style={shared.ghostButton}
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
        <div data-testid="search-empty" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY.empty.title}</p>
          <p style={shared.muted}>{HONEST_COPY.empty.message}</p>
          <BudgetLine budget={state.budget} />
        </div>
      );

    case "requires-auth":
      return (
        <div data-testid="search-requires-auth" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY["requires-auth"].title}</p>
          <p style={shared.muted}>{HONEST_COPY["requires-auth"].message}</p>
          <button type="button" style={styles.button} onClick={() => onConnect?.(state.providerId)}>
            {HONEST_COPY["requires-auth"].actionLabel}
          </button>
        </div>
      );

    case "rate-limited":
      return (
        <div data-testid="search-rate-limited" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY["rate-limited"].title}</p>
          <p style={shared.muted}>{HONEST_COPY["rate-limited"].message}</p>
          {/* §2.3: the reset hint arrives as OperationCapability.detail text
              (the frozen shapes carry no structured retryAfterSeconds —
              freeze-deviation MR-FD1). */}
          {state.detail && <p style={shared.muted}>{state.detail}</p>}
          <BudgetLine budget={state.budget} />
          {onRetry && (
            <button type="button" style={shared.ghostButton} onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      );

    case "unsupported":
      return (
        <div data-testid="search-unsupported" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY.unsupported.title}</p>
          <p style={shared.muted}>{HONEST_COPY.unsupported.message}</p>
          {state.detail && <p style={shared.muted}>Reason: {state.detail}</p>}
          {/* Honest by design: 'unsupported' renders no play control. A button
              here would be dead — the state explains itself instead. */}
        </div>
      );

    case "unavailable":
      return (
        <div data-testid="search-unavailable" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY.unavailable.title}</p>
          <p style={shared.muted}>{HONEST_COPY.unavailable.message}</p>
          {state.detail && <p style={shared.muted}>Reason: {state.detail}</p>}
          {onRetry && (
            <button type="button" style={shared.ghostButton} onClick={onRetry}>
              {HONEST_COPY.unavailable.actionLabel}
            </button>
          )}
        </div>
      );

    case "degraded":
      if (pageData !== null) {
        return (
          <CardResultsArea
            pageData={pageData}
            query={state.query}
            budget={state.budget}
            detail={state.detail}
            onPlayCard={onPlayCard}
            onSelectItem={onSelectItem}
            onOpenChannel={onOpenChannel}
            onLoadMore={onLoadMore}
            loadingMore={loadingMore}
            degraded
          />
        );
      }
      return (
        <div data-testid="search-degraded" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY.degraded.title}</p>
          <p style={shared.muted}>{HONEST_COPY.degraded.message}</p>
          {state.detail && <p style={shared.muted}>{state.detail}</p>}
          <BudgetLine budget={state.budget} />
          {state.items.length > 0 && (
            <ul style={styles.list}>
              {state.items.map((item) => (
                <li key={item.id} style={styles.row}>
                  <span>
                    {item.title}
                    <span style={shared.muted}>
                      {" "}
                      · {item.providerId} · {item.mediaKind}
                    </span>
                  </span>
                  <button
                    type="button"
                    style={shared.ghostButton}
                    aria-label={`Play ${item.title}`}
                    onClick={() => onSelectItem?.(item)}
                  >
                    Play
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );

    case "status-unknown":
      return (
        <div data-testid="search-status-unknown" role="status" style={shared.panel}>
          <p style={shared.panelTitle}>{HONEST_COPY["status-unknown"].title}</p>
          <p style={shared.muted}>{HONEST_COPY["status-unknown"].message}</p>
          {state.detail && <p style={shared.muted}>{state.detail}</p>}
          {onRetry && (
            <button type="button" style={shared.ghostButton} onClick={onRetry}>
              {HONEST_COPY["status-unknown"].actionLabel}
            </button>
          )}
        </div>
      );

    case "federated":
      return <FederatedResultsArea state={state} onSelectItem={onSelectItem} />;
  }
}
