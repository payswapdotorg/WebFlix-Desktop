// Search results renderers (WFX-UX-SHELL-1, deliverable 4), extracted from
// SearchScreen.tsx for the repo's max-lines law. Two areas:
//
// - CardResultsArea: the frozen §9 SearchPageData rendered as the reference's
//   results layout — the query echo, the budget note (the producer's own
//   sentence, verbatim) + the shell's budget line, channel cards (clickable
//   only with a real handler), the video card grid, and cursor "load more"
//   paging. Partial/degraded results keep the honest degraded banner above
//   the cards — never dressed up as fully ready.
// - FederatedResultsArea: the WF-009 federated coverage view (P7-COMPOSE-1)
//   — the merged item list PLUS one honest row per fanned-out source. NEVER
//   hides a failed source: every coverage row renders with its outcome
//   class, its row tally, its elapsed time, and (for every non-ok class)
//   the outcome's own reason. Partial-failure sources keep BOTH their
//   salvaged count and their reason; a federation with no merged items
//   still shows every source's answer.

import React from "react";
import { theme } from "../../theme";
import type { CatalogItem, SearchPageData, VideoCardView } from "webflix-contracts";
import { HONEST_COPY, budgetLine, federatedCoverageSummaryLine, federatedSourceRows } from "../../states";
import type { SearchBudgetView, SearchState } from "../../states";
import { ChannelCard } from "../media/ChannelCard";
import { LoadMoreControl } from "../media/LoadMore";
import { MediaCardGrid } from "../media/MediaCardGrid";

export const searchResultsStyles: Record<string, React.CSSProperties> = {
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
  sourceRow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    padding: `${theme.spacing.xs}px 0`,
    borderBottom: `1px solid ${theme.colors.border}`,
  },
  sourceLine: { display: "flex", flexWrap: "wrap", gap: theme.spacing.xs, alignItems: "baseline" },
  outcomeOk: { color: theme.colors.ok, fontWeight: 600 },
  outcomeNotOk: { color: theme.colors.warning, fontWeight: 600 },
  sourceMeta: { color: theme.colors.textMuted },
  sourcesHeading: {
    margin: 0,
    marginTop: theme.spacing.sm,
    fontSize: theme.typography.sizes.md,
    fontWeight: 600,
  },
  channelGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))",
    gap: theme.spacing.md,
    listStyle: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
  },
  noItems: { margin: 0, color: theme.colors.textMuted },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    cursor: "pointer",
    minHeight: 44,
  },
};

export function BudgetLine(props: { budget?: SearchBudgetView }) {
  // YOUTUBE-EXPAND: remaining-quota is surfaced honestly next to the results
  // it paid for (and in the states where it matters). Absent budget = the
  // app layer had no snapshot to show — nothing is invented here.
  if (!props.budget) return null;
  return (
    <p data-testid="search-budget" style={searchResultsStyles.muted}>
      {budgetLine(props.budget)}
    </p>
  );
}

export function CardResultsArea(props: {
  pageData: SearchPageData;
  query: string;
  budget?: SearchBudgetView;
  degraded: boolean;
  /** The degraded phase's own typed detail, verbatim (ignored when not degraded). */
  detail?: string;
  onPlayCard?: (card: VideoCardView) => void;
  onSelectItem?: (item: CatalogItem) => void;
  onOpenChannel?: (channel: { channelId: string; handle?: string }) => void;
  onLoadMore?: (cursor: string) => void;
  loadingMore: boolean;
}): React.ReactElement {
  const {
    pageData,
    query,
    budget,
    degraded,
    detail,
    onPlayCard,
    onSelectItem,
    onOpenChannel,
    onLoadMore,
    loadingMore,
  } = props;

  const total = pageData.videos.length + pageData.channels.length;
  const playHandler =
    onPlayCard ??
    (onSelectItem === undefined ? undefined : (card: VideoCardView) => onSelectItem(card.item));

  return (
    <div
      data-testid={degraded ? "search-degraded" : "search-results"}
      role={degraded ? "status" : undefined}
      style={searchResultsStyles.panel}
    >
      {degraded && (
        <>
          <p style={searchResultsStyles.panelTitle}>{HONEST_COPY.degraded.title}</p>
          <p style={searchResultsStyles.muted}>{HONEST_COPY.degraded.message}</p>
          {detail && <p style={searchResultsStyles.muted}>{detail}</p>}
        </>
      )}
      <p style={searchResultsStyles.panelTitle}>
        {total} {total === 1 ? "result" : "results"} for “{query}”
      </p>
      <BudgetLine budget={budget} />
      {pageData.budgetNote && (
        <p data-testid="search-budget-note" style={searchResultsStyles.muted}>
          {pageData.budgetNote}
        </p>
      )}

      {pageData.channels.length > 0 && (
        <section aria-label="Channel results" data-testid="search-channels">
          <h3 style={searchResultsStyles.sourcesHeading}>Channels</h3>
          <ul style={searchResultsStyles.channelGrid}>
            {pageData.channels.map((channel) => (
              <li key={channel.channelId}>
                <ChannelCard channel={channel} onOpenChannel={onOpenChannel} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {pageData.videos.length > 0 ? (
        <section aria-label="Video results" data-testid="search-videos">
          <h3 style={searchResultsStyles.sourcesHeading}>Videos</h3>
          <MediaCardGrid cards={pageData.videos} onPlay={playHandler} />
        </section>
      ) : (
        <p style={searchResultsStyles.muted}>
          No video results — the channels above are everything this search returned.
        </p>
      )}

      <LoadMoreControl
        nextCursor={pageData.nextCursor}
        onLoadMore={onLoadMore}
        loadingMore={loadingMore}
        surfaceLabel="search results"
        testId="search-load-more"
      />
    </div>
  );
}

export function FederatedResultsArea(props: {
  state: Extract<SearchState, { phase: "federated" }>;
  onSelectItem?: (item: CatalogItem) => void;
}) {
  const { state, onSelectItem } = props;
  const { result } = state;
  const rows = federatedSourceRows(result);

  return (
    <div data-testid="search-federated" style={searchResultsStyles.panel}>
      <p style={searchResultsStyles.panelTitle}>
        {result.items.length} merged {result.items.length === 1 ? "item" : "items"} for “
        {state.query}”
      </p>
      <BudgetLine budget={state.budget} />
      <p data-testid="search-federated-summary" style={searchResultsStyles.muted}>
        {federatedCoverageSummaryLine(result)}
      </p>
      {result.items.length === 0 ? (
        <p data-testid="search-federated-no-items" style={searchResultsStyles.noItems}>
          The federation returned no merged items — every source’s answer is listed below, failures
          included.
        </p>
      ) : (
        <ul data-testid="search-federated-items" style={searchResultsStyles.list}>
          {result.items.map((merged) => (
            <li key={merged.item.id} style={searchResultsStyles.row}>
              <span>
                {merged.item.title}
                <span style={searchResultsStyles.muted}>
                  {" "}
                  · {merged.item.providerId} · {merged.item.mediaKind} · from{" "}
                  {merged.sources.join(", ")}
                </span>
              </span>
              <button
                type="button"
                style={searchResultsStyles.ghostButton}
                aria-label={`Play ${merged.item.title}`}
                onClick={() => onSelectItem?.(merged.item)}
              >
                Play
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 style={searchResultsStyles.sourcesHeading}>Sources</h3>
      <ul data-testid="search-federated-coverage" style={searchResultsStyles.list}>
        {rows.map((row) => (
          <li
            key={row.source}
            style={searchResultsStyles.sourceRow}
            data-testid={`search-federated-source-${row.source}`}
          >
            <span style={searchResultsStyles.sourceLine}>
              <strong>{row.source}</strong>
              <span
                style={row.outcome === "ok" ? searchResultsStyles.outcomeOk : searchResultsStyles.outcomeNotOk}
              >
                {row.outcome}
              </span>
              <span style={searchResultsStyles.sourceMeta}>
                {row.returned} {row.returned === 1 ? "row" : "rows"} returned · {row.elapsedMs}ms
              </span>
            </span>
            {row.reason && (
              <span
                data-testid={`search-federated-source-reason-${row.source}`}
                style={searchResultsStyles.muted}
              >
                Reason: {row.reason}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
