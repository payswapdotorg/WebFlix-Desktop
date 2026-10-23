import React from "react";
import { theme } from "../theme";
import type { CatalogItem, Collection } from "webflix-contracts";
export interface LibraryScreenProps {
  readonly collections?: readonly Collection[];
  readonly localEntries?: readonly CatalogItem[];
  readonly onPlay?: (item: CatalogItem) => void;
  /**
   * P9-UI-1 (order requirement 3 — the real local import path): fires when
   * the user asks to import local media files. The HOST owns the picker
   * (a real file input in the desktop renderer); the shell only renders the
   * affordance — absent handler = no button (never a dead control).
   */
  readonly onImportLocalFiles?: () => void;
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
  // WFX-UX-SHELL-1 (visual upgrade): local entries render as card tiles —
  // the media-first grid pattern. Local files carry no thumbnails, so the
  // tile shows an honest placeholder plate with the media kind, never a
  // fabricated image.
  localGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))",
    gap: theme.spacing.md,
    listStyle: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
  },
  localTile: {
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  localTilePlate: {
    width: "100%",
    aspectRatio: "16 / 9",
    borderRadius: theme.radii.md,
    background: theme.colors.surfaceRaised,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  localTileTitle: {
    margin: 0,
    fontSize: theme.typography.sizes.md,
    fontWeight: 600,
    lineHeight: 1.35,
    overflowWrap: "anywhere",
  },
  localTileMeta: { margin: 0, color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm },
  localTileActions: { display: "flex", gap: theme.spacing.sm },
  ghostButton: {
    background: "transparent",
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: "6px 12px",
    cursor: "pointer",
  },
  // P9-UI-1: the import affordance is a PRIMARY action — accent-filled like
  // the shell's other primary buttons (AccountsScreen connect button).
  importButton: {
    alignSelf: "flex-start",
    background: theme.colors.accent,
    color: "#08211b",
    border: "none",
    borderRadius: theme.radii.sm,
    padding: "8px 14px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 44,
  },
};

export function LibraryScreen(props: LibraryScreenProps) {
  const { collections = [], localEntries = [], onPlay, onImportLocalFiles } = props;

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
                  <p style={styles.muted}>
                    {collection.kind === "smart" ? "Smart collection" : "Manual collection"}
                  </p>
                </div>
                <span style={styles.muted}>
                  {collection.entryIds.length} item{collection.entryIds.length === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Local entries</h2>
        {/* P9-UI-1: the real import path — rendered only when the host wired a
            real picker; the honest empty state below still explains itself. */}
        {onImportLocalFiles && (
          <button
            type="button"
            style={styles.importButton}
            data-testid="library-import-local-files"
            onClick={onImportLocalFiles}
          >
            Import local files…
          </button>
        )}
        {localEntries.length === 0 ? (
          <div data-testid="library-local-empty" style={styles.empty}>
            <p style={styles.muted}>
              No local files yet.{" "}
              {onImportLocalFiles
                ? "Import files you own with the button above — entries are session-only in this build (the durable local-library bridge is a later order)."
                : "Point the local library (D2) at a folder of videos you own and they will be listed here."}
            </p>
          </div>
        ) : (
          <ul data-testid="library-local-grid" style={styles.localGrid}>
            {localEntries.map((item) => (
              <li key={item.id} style={styles.localTile} data-testid={`library-local-tile-${item.id}`}>
                <div style={styles.localTilePlate} aria-hidden="true">
                  local {item.mediaKind}
                </div>
                <p style={styles.localTileTitle}>{item.title}</p>
                <p style={styles.localTileMeta}>
                  {item.providerId} · local file
                </p>
                <div style={styles.localTileActions}>
                  <button
                    type="button"
                    style={styles.ghostButton}
                    aria-label={`Play ${item.title}`}
                    onClick={() => onPlay?.(item)}
                  >
                    Play
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
