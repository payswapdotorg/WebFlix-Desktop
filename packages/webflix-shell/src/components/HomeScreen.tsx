import React from 'react';
import { theme } from '../theme';
import type { CatalogItem, ProviderAccountRecord } from 'webflix-contracts';

export interface HomeScreenProps {
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly recentItems?: readonly CatalogItem[];
  readonly onNavigate?: (screen: 'search' | 'library' | 'accounts') => void;
  readonly onPlay?: (item: CatalogItem) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: theme.spacing.md, color: theme.colors.text },
  heading: { margin: 0, fontSize: theme.typography.sizes.display },
  intro: { margin: 0, maxWidth: 640, color: theme.colors.textMuted, lineHeight: 1.5 },
  card: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  cardTitle: { margin: 0, fontSize: theme.typography.sizes.lg },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  row: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    padding: `${theme.spacing.xs}px 0`,
  },
  empty: {
    border: `1px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  list: { listStyle: 'none', margin: 0, padding: 0, width: '100%' },
  button: {
    background: theme.colors.accent,
    color: '#08211b',
    border: 'none',
    borderRadius: theme.radii.sm,
    padding: '8px 14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  ghostButton: {
    background: 'transparent',
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: '6px 12px',
    cursor: 'pointer',
  },
};

export function HomeScreen(props: HomeScreenProps) {
  const { accounts = [], recentItems = [], onNavigate, onPlay } = props;

  return (
    <section aria-label="Home" style={styles.root}>
      <h1 style={styles.heading}>Welcome to WebFlix</h1>
      <p style={styles.intro}>
        WebFlix plays YouTube videos through the official embed and your own local files through
        your own player — and it always tells you honestly what works, what needs sign-in, and
        what it cannot do.
      </p>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Your accounts</h2>
        {accounts.length === 0 ? (
          <div data-testid="home-accounts-empty" style={styles.empty}>
            <p style={styles.muted}>
              No accounts connected yet — WebFlix will not pretend otherwise. Connect a provider
              to unlock provider-backed search.
            </p>
            <button type="button" style={styles.button} onClick={() => onNavigate?.('accounts')}>
              Go to Accounts
            </button>
          </div>
        ) : (
          <div data-testid="account-summary" style={{ width: '100%' }}>
            <p style={styles.muted}>
              {accounts.length} account{accounts.length === 1 ? '' : 's'} connected
            </p>
            <ul style={styles.list}>
              {accounts.map((account) => (
                <li key={account.accountId} style={styles.row}>
                  <span>{account.displayName}</span>
                  <span style={styles.muted}>
                    {account.providerId} · {account.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Pick up where you left off</h2>
        {recentItems.length === 0 ? (
          <div data-testid="home-library-empty" style={styles.empty}>
            <p style={styles.muted}>
              Nothing in your library yet. Search for something to watch or add local files —
              this space fills up honestly, never with placeholders.
            </p>
            <button type="button" style={styles.button} onClick={() => onNavigate?.('library')}>
              Browse Library
            </button>
          </div>
        ) : (
          <ul style={styles.list}>
            {recentItems.map((item) => (
              <li key={item.id} style={styles.row}>
                <span>{item.title}</span>
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
