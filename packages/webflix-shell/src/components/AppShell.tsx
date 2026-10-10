import React, { useState } from 'react';
import { theme } from '../theme';
import type { CatalogItem, LibraryCollection, ProviderAccountRecord } from 'webflix-contracts';
import type { SearchState } from '../states';
import { HomeScreen } from './HomeScreen';
import { SearchScreen } from './SearchScreen';
import { LibraryScreen } from './LibraryScreen';
import { AccountsScreen } from './AccountsScreen';

export type ScreenId = 'home' | 'search' | 'library' | 'accounts';

export const NAV_ITEMS: readonly { id: ScreenId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'search', label: 'Search' },
  { id: 'library', label: 'Library' },
  { id: 'accounts', label: 'Accounts' },
];

export interface AppShellProps {
  readonly initialScreen?: ScreenId;
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly recentItems?: readonly CatalogItem[];
  readonly collections?: readonly LibraryCollection[];
  readonly localEntries?: readonly CatalogItem[];
  readonly searchState?: SearchState;
  readonly onPlay?: (item: CatalogItem) => void;
  readonly onConnect?: (providerId: string) => void;
  readonly onDisconnect?: (accountId: string) => void;
  readonly onSearchQuery?: (query: string) => void;
  readonly onSearchSubmit?: (query: string) => void;
  readonly onRetrySearch?: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateRows: 'auto auto 1fr auto',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    background: theme.colors.background,
    color: theme.colors.text,
  },
  header: { display: 'flex', alignItems: 'baseline', gap: theme.spacing.sm },
  brand: {
    fontSize: theme.typography.sizes.display,
    fontWeight: 700,
    letterSpacing: '0.5px',
    color: theme.colors.accent,
  },
  tagline: { color: theme.colors.textMuted },
  nav: { display: 'flex', gap: theme.spacing.sm },
  navButton: {
    background: 'transparent',
    color: theme.colors.textMuted,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: theme.typography.sizes.md,
  },
  navButtonActive: {
    background: theme.colors.accent,
    borderColor: theme.colors.accent,
    color: '#08211b',
    fontWeight: 600,
  },
  main: { display: 'block' },
  footer: {
    borderTop: `1px solid ${theme.colors.border}`,
    paddingTop: theme.spacing.sm,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
};

export function AppShell(props: AppShellProps) {
  const {
    initialScreen = 'home',
    accounts = [],
    recentItems = [],
    collections = [],
    localEntries = [],
    searchState = { phase: 'idle' },
    onPlay,
    onConnect,
    onDisconnect,
    onSearchQuery,
    onSearchSubmit,
    onRetrySearch,
  } = props;

  const [screen, setScreen] = useState<ScreenId>(initialScreen);

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.brand}>{theme.name}</span>
        <span style={styles.tagline}>{theme.tagline}</span>
      </header>

      <nav aria-label="Primary" style={styles.nav}>
        {NAV_ITEMS.map((navItem) => (
          <button
            key={navItem.id}
            type="button"
            data-testid={`nav-${navItem.id}`}
            aria-current={screen === navItem.id ? 'page' : undefined}
            style={
              screen === navItem.id
                ? { ...styles.navButton, ...styles.navButtonActive }
                : styles.navButton
            }
            onClick={() => setScreen(navItem.id)}
          >
            {navItem.label}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {screen === 'home' && (
          <HomeScreen
            accounts={accounts}
            recentItems={recentItems}
            onNavigate={setScreen}
            onPlay={onPlay}
          />
        )}
        {screen === 'search' && (
          <SearchScreen
            state={searchState}
            onQueryChange={onSearchQuery}
            onSubmit={onSearchSubmit}
            onRetry={onRetrySearch}
            onConnect={onConnect}
            onSelectItem={onPlay}
          />
        )}
        {screen === 'library' && (
          <LibraryScreen collections={collections} localEntries={localEntries} onPlay={onPlay} />
        )}
        {screen === 'accounts' && (
          <AccountsScreen accounts={accounts} onConnect={onConnect} onDisconnect={onDisconnect} />
        )}
      </main>

      {/* ADR-0003: the independent-value notice is permanent shell chrome. */}
      <footer data-testid="independent-value-notice" style={styles.footer}>
        {theme.notice.text}
      </footer>
    </div>
  );
}
