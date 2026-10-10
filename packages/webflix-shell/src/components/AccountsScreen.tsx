import React from 'react';
import { theme } from '../theme';
import type { AccountState, ProviderAccountRecord, ProviderId } from '../contract-types';

interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly name: string;
  readonly blurb: string;
}

/** Providers the shell knows about in M1. D3 adds 'youtube'; D2 owns 'local'. */
const KNOWN_PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    blurb: 'Connect to search YouTube and watch via the official embed.',
  },
];

const ACCOUNT_STATE_COPY: Record<
  AccountState,
  { badge: string; note: string; action: 'disconnect' | 'connect'; actionLabel: string }
> = {
  connected: {
    badge: 'Connected',
    note: 'Signed in and ready.',
    action: 'disconnect',
    actionLabel: 'Disconnect',
  },
  expired: {
    badge: 'Expired',
    note: 'The access token expired — sign in again to refresh it.',
    action: 'connect',
    actionLabel: 'Reconnect',
  },
  revoked: {
    badge: 'Revoked',
    note: 'Access was revoked. Reconnect to restore it.',
    action: 'connect',
    actionLabel: 'Connect',
  },
};

export interface AccountsScreenProps {
  readonly accounts?: readonly ProviderAccountRecord[];
  readonly onConnect?: (providerId: ProviderId) => void;
  readonly onDisconnect?: (accountId: string) => void;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: theme.spacing.md, color: theme.colors.text },
  heading: { margin: 0, fontSize: theme.typography.sizes.xl },
  muted: { margin: 0, color: theme.colors.textMuted, lineHeight: 1.5 },
  card: {
    background: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  cardTitle: { margin: 0, fontSize: theme.typography.sizes.lg },
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
  accountCard: {
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    padding: theme.spacing.sm,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  badge: {
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: theme.typography.sizes.sm,
    fontWeight: 600,
  },
  badgeOk: { background: 'rgba(63, 200, 120, 0.18)', color: theme.colors.ok },
  badgeWarn: { background: 'rgba(217, 161, 59, 0.18)', color: theme.colors.warning },
  badgeDanger: { background: 'rgba(224, 95, 116, 0.18)', color: theme.colors.danger },
  button: {
    alignSelf: 'flex-start',
    background: theme.colors.accent,
    color: '#08211b',
    border: 'none',
    borderRadius: theme.radii.sm,
    padding: '8px 14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  ghostButton: {
    alignSelf: 'flex-start',
    background: 'transparent',
    color: theme.colors.accent,
    border: `1px solid ${theme.colors.accent}`,
    borderRadius: theme.radii.sm,
    padding: '8px 14px',
    cursor: 'pointer',
  },
};

export function AccountsScreen(props: AccountsScreenProps) {
  const { accounts = [], onConnect, onDisconnect } = props;

  const byProvider = new Map<string, ProviderAccountRecord[]>();
  for (const account of accounts) {
    const list = byProvider.get(account.providerId) ?? [];
    list.push(account);
    byProvider.set(account.providerId, list);
  }

  const knownIds = new Set(KNOWN_PROVIDERS.map((provider) => provider.id));
  const extraProviders: ProviderDescriptor[] = [...byProvider.keys()]
    .filter((id) => !knownIds.has(id))
    .map((id) => ({ id, name: id, blurb: 'Provider registered by another lane.' }));
  const providers: readonly ProviderDescriptor[] = [...KNOWN_PROVIDERS, ...extraProviders];

  return (
    <section aria-label="Accounts" style={styles.root}>
      <h1 style={styles.heading}>Accounts</h1>
      <p style={styles.muted}>
        Account status is reported exactly as the provider reports it — connected, expired, or
        revoked. WebFlix never guesses on your behalf.
      </p>

      {providers.map((provider) => {
        const providerAccounts = byProvider.get(provider.id) ?? [];
        return (
          <div key={provider.id} style={styles.card}>
            <h2 style={styles.cardTitle}>{provider.name}</h2>
            <p style={styles.muted}>{provider.blurb}</p>

            {providerAccounts.length === 0 && (
              <div
                data-testid={`account-card-not-connected-${provider.id}`}
                style={styles.empty}
              >
                <p style={styles.muted}>Not connected. Nothing has been authorized yet.</p>
                <button
                  type="button"
                  data-testid={`connect-${provider.id}`}
                  style={styles.button}
                  onClick={() => onConnect?.(provider.id)}
                >
                  Connect
                </button>
              </div>
            )}

            {providerAccounts.map((account) => {
              const copy = ACCOUNT_STATE_COPY[account.state];
              return (
                <div
                  key={account.accountId}
                  data-testid={`account-card-${account.state}`}
                  style={styles.accountCard}
                >
                  <div style={styles.row}>
                    <span>{account.displayName}</span>
                    <span
                      style={{
                        ...styles.badge,
                        ...(account.state === 'connected'
                          ? styles.badgeOk
                          : account.state === 'expired'
                            ? styles.badgeWarn
                            : styles.badgeDanger),
                      }}
                    >
                      {copy.badge}
                    </span>
                  </div>
                  <p style={styles.muted}>{copy.note}</p>
                  {account.tokenExpiresAt && (
                    <p style={styles.muted}>Token expires: {account.tokenExpiresAt}</p>
                  )}
                  {account.scopes && account.scopes.length > 0 && (
                    <p style={styles.muted}>Scopes: {account.scopes.join(', ')}</p>
                  )}
                  <button
                    type="button"
                    style={copy.action === 'disconnect' ? styles.ghostButton : styles.button}
                    onClick={() =>
                      copy.action === 'disconnect'
                        ? onDisconnect?.(account.accountId)
                        : onConnect?.(provider.id)
                    }
                  >
                    {copy.actionLabel}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
