/**
 * WFX-DESKTOP-WEBFLIX-UX-1 (TL2 integration lane) — the host chrome pieces:
 * the WebFlix-only error boundary, the shared host styles, the startup
 * ready notifier, the product-mark header row and the fail-closed vault
 * banner. Extracted from boot.tsx for the max-lines law; behavior is
 * byte-equivalent.
 */
import { Component, useEffect, type ReactNode } from "react";
import { theme } from "../../../../../webflix-shell/src/theme.js";
import { WEBFLIX_MARK_ALT, WEBFLIX_MARK_SVG } from "./brand.js";
import type { WebFlixAccountsStatus } from "./accountsBridge.js";

/** An app-wide error boundary with WebFlix styling only (no @zcode/ui dependency in this process). */
export class WebFlixErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: theme.colors.background,
            color: theme.colors.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            data-testid="webflix-error-boundary"
            role="alert"
            style={{
              background: theme.colors.surface,
              border: `1px solid ${theme.colors.danger}`,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.md,
              maxWidth: 520,
            }}
          >
            <h1 style={{ margin: 0, fontSize: theme.typography.sizes.xl }}>Something went wrong</h1>
            <p style={{ color: theme.colors.textMuted, lineHeight: 1.5 }}>
              WebFlix hit an unexpected error in this screen. The details below are exactly what was
              reported — nothing is summarized away.
            </p>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: theme.typography.sizes.sm,
              }}
            >
              {String(this.state.error?.message ?? this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const hostStyles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: theme.colors.background,
    display: "flex",
    flexDirection: "column",
  },
  shell: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  mark: { width: 22, height: 22, flex: "0 0 auto" },
  about: {
    borderTop: `1px solid ${theme.colors.border}`,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
  },
  vaultBanner: {
    margin: `0 ${theme.spacing.md}px`,
    marginTop: theme.spacing.sm,
    border: `1px solid ${theme.colors.warning}`,
    borderRadius: theme.radii.md,
    background: theme.colors.surface,
    color: theme.colors.warning,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
  },
  panelUnavailable: {
    padding: theme.spacing.md,
    color: theme.colors.textMuted,
    fontSize: theme.typography.sizes.sm,
    lineHeight: 1.5,
  },
  fileInput: { display: "none" },
};

/** Notifies the HTML startup shell that React committed (the inherited fade-out contract). */
export function StartupReadyNotifier(): ReactNode {
  useEffect(() => {
    window.dispatchEvent(new Event("zcode-react-startup-ready"));
  }, []);
  return null;
}

/** The product mark header row — WebFlix chrome, never ZCode. */
export function ProductMarkRow(): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.sm,
        padding: `${theme.spacing.sm}px ${theme.spacing.md}px 0`,
      }}
    >
      <span
        style={hostStyles.mark}
        aria-label={WEBFLIX_MARK_ALT}
        role="img"
        data-testid="webflix-product-mark"
        dangerouslySetInnerHTML={{ __html: WEBFLIX_MARK_SVG }}
      />
    </div>
  );
}

/** The fail-closed vault banner (requirement 5): rendered only when the vault actually refused. */
export function VaultUnavailableBanner(props: { status: WebFlixAccountsStatus }): ReactNode {
  return (
    <p data-testid="webflix-vault-unavailable" role="alert" style={hostStyles.vaultBanner}>
      Account storage is unavailable on this system: {props.status.vault.reason} — sign-in cannot be
      offered until the OS secure-storage backend (e.g. a keyring service) is available. No
      credentials are stored insecurely, ever.
    </p>
  );
}
