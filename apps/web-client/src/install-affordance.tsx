import React, { useEffect, useState } from "react";

/**
 * InstallAffordance — P6-PWA-1's install control, honestly.
 *
 * The CLAIM is the exact pinned string (the work order's words, tested
 * verbatim): "install the app shell — media and catalog need a session;
 * nothing but the shell works offline". That string IS the whole claim —
 * nothing offline beyond the shell is ever implied, and media/catalog
 * needing a session is stated up front.
 *
 * Honesty rules this component pins:
 * - the affordance renders ALWAYS (visible control), but it only PROMPTS
 *   when the browser itself has offered `beforeinstallprompt` — never a
 *   fake install, never a fabricated flow;
 * - with no deferred prompt available (unsupported context, already
 *   installed, or the browser simply not offering), the click states
 *   that fact plainly — a no-op is honest, a simulated install is not;
 * - the outcome line reports what the browser answered
 *   (accepted/dismissed) — nothing invented;
 * - NO network, NO telemetry, NO analytics (the event + the prompt are
 *   browser APIs only).
 */

/** The pinned honest claim — the work order's exact string. */
export const INSTALL_CLAIM =
  "install the app shell — media and catalog need a session; nothing but the shell works offline";

/** The deferred-install event's honest shape (not in lib.dom; typed locally). */
interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: "accepted" | "dismissed" }>;
}

interface InstallAffordanceState {
  /** The browser's deferred prompt when it has offered installation; null otherwise. */
  deferred: BeforeInstallPromptEvent | null;
  /** The plain outcome line (set after a click). */
  status: string | null;
}

export function InstallAffordance() {
  const [state, setState] = useState<InstallAffordanceState>({
    deferred: null,
    status: null,
  });

  useEffect(() => {
    // The browser offers the install criteria check as an event; capturing
    // it (with preventDefault, per the platform contract) defers the
    // browser's own mini-infobar so OUR control is the affordance.
    const handler = (event: Event) => {
      event.preventDefault();
      setState((prev) => ({ ...prev, deferred: event as BeforeInstallPromptEvent }));
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  const onInstallClick = () => {
    const deferred = state.deferred;
    if (deferred === null) {
      // Honest no-op: this context has no deferred install prompt.
      setState({
        deferred: null,
        status: "the browser has not offered installation for this context",
      });
      return;
    }
    setState((prev) => ({ ...prev, status: "the browser's install prompt is open…" }));
    void deferred
      .prompt()
      .then(() => deferred.userChoice)
      .then((choice) => {
        setState((prev) => ({
          ...prev,
          deferred: null,
          status:
            choice.outcome === "accepted"
              ? "install accepted — the app shell is installed (the claim above is the whole offline truth)"
              : "install dismissed — nothing changed",
        }));
      })
      .catch(() => {
        setState((prev) => ({ ...prev, deferred: null, status: "install prompt failed" }));
      });
  };

  return (
    <div data-testid="install-affordance-root">
      <button
        type="button"
        data-testid="install-affordance-button"
        onClick={onInstallClick}
        style={{
          background: "transparent",
          color: "#9aa8c0",
          border: "1px solid #2c3a58",
          borderRadius: 4,
          padding: "6px 12px",
          cursor: "pointer",
          fontSize: 13,
          minHeight: 44,
        }}
      >
        Install the app shell
      </button>
      <p data-testid="install-claim" style={{ margin: "6px 0 0", fontSize: 13, color: "#9aa8c0" }}>
        {INSTALL_CLAIM}
      </p>
      {state.status !== null && (
        <p
          data-testid="install-status"
          role="status"
          style={{ margin: "6px 0 0", fontSize: 13, color: "#9aa8c0" }}
        >
          {state.status}
        </p>
      )}
    </div>
  );
}
