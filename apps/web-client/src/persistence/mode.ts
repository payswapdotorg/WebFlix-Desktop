/**
 * P6-DURABLE-WEB-1 — the persistence MODE, typed (phase6-clients-plan §4:
 * "durable persistence on web is a LATER, explicitly-designed row" — this
 * is that row; requirements-matrix WF-029 retention honesty).
 *
 * The mode is a TYPED LITERAL UNION — "session-only" (the honest default:
 * nothing is saved unless the user opts in) or "durable" (an IndexedDB-
 * backed adapter is active and exactly two records persist: the setting
 * itself + the ranker-adapter selection). Every user-visible claim follows
 * the ACTUAL active mode: no "saved" wording when the mode is session-only,
 * no silent fallback when durable is unavailable (that degradation is typed
 * and surfaced — see ./bootstrap.ts).
 *
 * NO localStorage / sessionStorage anywhere in this seam (rg-provable):
 * durable persistence is IndexedDB ONLY, and only ever written through the
 * typed stores below.
 */

/** The web host's persistence mode — a typed literal union, exactly two honest values. */
export type PersistenceMode = "session-only" | "durable";

/** Both modes, in selector order. */
export const PERSISTENCE_MODES: readonly PersistenceMode[] = ["session-only", "durable"];

/** The honest default ruling: session-only UNLESS the user opts into durable. */
export const DEFAULT_PERSISTENCE_MODE: PersistenceMode = "session-only";

/** The session-only mode statement (context lines compose around it — see composePersistenceNotice). */
export const SESSION_ONLY_NOTICE =
  "Session-only: this web client keeps everything in memory for this tab session — " +
  "the session's contents reset when the tab closes. Nothing is saved unless you opt in " +
  "to the durable mode.";

/** The durable mode statement — states exactly WHAT persists and what does not. */
export const DURABLE_MODE_NOTICE =
  "Durable: your persistence setting and your ranker-adapter selection are stored in " +
  "this browser's IndexedDB, for this site only — no server, no sync, no cross-device. " +
  "Nothing else is stored. Switching back to session-only stops new saving; already-saved " +
  "records remain until you clear them.";

/** First-run line: no setting record exists yet — the default is active, unstored. */
export const SETTING_FIRST_RUN_NOTE =
  "First run: the session-only default is active and nothing is stored yet; it becomes " +
  "a stored setting when you change it.";

/** Stored-setting line for session-only mode (the choice sticks; nothing else is stored). */
export const SETTING_STORED_SESSION_ONLY_NOTE =
  "Your session-only choice itself is stored in this browser's IndexedDB so it sticks — " +
  "nothing else is stored.";

/** Stored-setting line for durable mode. */
export const SETTING_STORED_DURABLE_NOTE =
  "Your durable choice is stored in this browser's IndexedDB.";

/** Corrupt-setting line (fail-safe: the session-only default applies; the record is not rewritten on read). */
export const SETTING_INVALID_NOTE =
  "The stored persistence setting was unreadable; the session-only default applies.";

/** Leftover-durable-data line (session-only mode with records from an earlier durable period). */
export const LEFTOVER_DURABLE_NOTE =
  "Records saved during an earlier durable period remain in this browser until cleared " +
  "(Clear durable data below).";

/** The degradation line — IndexedDB unavailable, the typed session-only fallback surfaced. */
export function degradedNotice(reason: string): string {
  return (
    "Durable storage is unavailable in this browser (" +
    reason +
    ") — the session-only mode is active and the durable setting cannot be saved."
  );
}

/** The active setting-status vocabulary (mirrors the bootstrap read's typed outcome). */
export type PersistenceSettingStatus = "first-run" | "stored" | "invalid";

/**
 * Composes the host notice's lines FROM TYPED DATA — the single source of
 * every persistence claim the UI makes. Pure: no I/O, no globals.
 */
export function composePersistenceNotice(input: {
  readonly activeMode: PersistenceMode;
  readonly degraded: { readonly reason: string } | null;
  readonly settingStatus: PersistenceSettingStatus;
  readonly durableSelectionPresent: boolean;
}): readonly string[] {
  if (input.degraded !== null) {
    // Degraded: no IndexedDB at all — nothing is stored, nothing can be.
    return [SESSION_ONLY_NOTICE, degradedNotice(input.degraded.reason)];
  }
  if (input.activeMode === "durable") {
    return [
      DURABLE_MODE_NOTICE,
      input.settingStatus === "invalid" ? SETTING_INVALID_NOTE : SETTING_STORED_DURABLE_NOTE,
    ];
  }
  const settingLine =
    input.settingStatus === "stored"
      ? SETTING_STORED_SESSION_ONLY_NOTE
      : input.settingStatus === "invalid"
        ? SETTING_INVALID_NOTE
        : SETTING_FIRST_RUN_NOTE;
  return input.durableSelectionPresent
    ? [SESSION_ONLY_NOTICE, settingLine, LEFTOVER_DURABLE_NOTE]
    : [SESSION_ONLY_NOTICE, settingLine];
}
