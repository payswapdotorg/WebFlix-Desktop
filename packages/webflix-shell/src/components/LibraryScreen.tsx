import React from "react";
import { theme } from "../theme";
import type { CatalogItem, LibraryCollection } from "webflix-contracts";

export interface LibraryScreenProps {
  readonly collections?: readonly LibraryCollection[];
  readonly localEntries?: readonly CatalogItem[];
  readonly onPlay?: (item: CatalogItem) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
    color: theme.colors.text,
  },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  card: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.sm,
  },
  cardTitle: { margin: 0, fontSize: theme.typography.sizes.lg },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
  },
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
  collectionName: { margin: 0, fontWeight: 600 },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "6px 12px",
    cursor: "pointer",
  },
};

export function LibraryScreen(props: LibraryScreenProps) {
  const { collections = [], localEntries = [], onPlay } = props;

  return (
    <section aria-label="Library" style={styles.root}>
      <h1 style={styles.heading}>Library</h1>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Collections</h2>
        {collections.length === 0 ? (
          <div data-testid="library-collections-empty" style={styles.empty}>
            <p style={styles.muted}>
              No collections yet. Save a search or group local files and one will appear here —
              WebFlix does not ship fake starter content.
            </p>
          </div>
        ) : (
          <ul style={styles.list}>
            {collections.map((collection) => (
              <li key={collection.id} style={styles.row}>
                <div>
                  <p style={styles.collectionName}>{collection.name}</p>
                  {collection.description && <p style={styles.muted}>{collection.description}</p>}
                </div>
                <span style={styles.muted}>
                  {collection.itemIds.length} item{collection.itemIds.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Local entries</h2>
        {localEntries.length === 0 ? (
          <div data-testid="library-local-empty" style={styles.empty}>
            <p style={styles.muted}>
              No local files yet. Point the local library (D2) at a folder of videos you own and
              they will be listed here.
            </p>
          </div>
        ) : (
          <ul style={styles.list}>
            {localEntries.map((item) => (
              <li key={item.id} style={styles.row}>
                <span>
                  {item.title}
                  <span style={styles.muted}> · local file</span>
                </span>
                <button
                  type="button"
                  style={styles.ghostButton}
                  aria-label={`Play ${item.title}`}
                  onClick={() => onPlay?.(item)}
                >
                  Play
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
