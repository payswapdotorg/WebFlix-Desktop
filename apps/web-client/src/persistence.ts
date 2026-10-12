/**
 * P6-WEB-HOST-1 — session-only persistence honesty, TYPED + LABELED
 * (phase6-clients-plan §4, the "sqlite law").
 *
 * The web host composes the application layer's IN-MEMORY doubles. Nothing
 * durable exists on the web runtime: local-library's durable seam is
 * Node-only (better-sqlite3) and is NEVER imported here. The mode is a
 * typed literal — not a stringly claim — and the notice renders in the
 * host chrome so no screen can imply "saved" when nothing is.
 *
 * NO localStorage / sessionStorage writes exist anywhere in this app
 * (rg-provable): there is no hidden "sync", no fake-durable, no cached
 * preferences. Durable web storage is a LATER, explicitly-designed row.
 */

/** The web host's persistence mode — a typed literal, the only value. */
export const PERSISTENCE_MODE = "session-only" as const;

/** The mode's type: exactly one honest value, no stringly-typed drift. */
export type PersistenceMode = typeof PERSISTENCE_MODE;

/** Stated in the host chrome (the ADR-0003 notice pattern: plain, permanent). */
export const SESSION_ONLY_NOTICE =
  "Session-only: this web client keeps everything in memory for this tab session " +
  "and stores nothing durably — nothing is saved, and everything resets when the " +
  "tab closes. Durable web storage is a later, explicitly-designed milestone.";
