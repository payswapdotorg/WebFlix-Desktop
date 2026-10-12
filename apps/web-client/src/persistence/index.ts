/**
 * P6-DURABLE-WEB-1 — the web host's persistence seam, PUBLIC SURFACE.
 *
 * This module replaces the former flat src/persistence.ts (the P6-WEB-HOST-1
 * session-only literal) with the explicitly-designed durable seam:
 * - the typed mode union ("session-only" | "durable") + the notice lines
 *   composed from typed data (./mode);
 * - the versioned IndexedDB core (./idb);
 * - the persistence-mode SETTING store — the opt-in choice, persisted in
 *   IndexedDB itself (./setting-store);
 * - the DURABLE ranker-selection store — the host's EXISTING
 *   RankerSelectionStore interface, IndexedDB-backed (./selection-store);
 * - the typed bootstrap read (ok / degraded) that runs BEFORE mount
 *   (./bootstrap);
 * - the mode-routing store that keeps one seam for both modes
 *   (./routing-store).
 *
 * Everything the UI claims about persistence flows through the typed
 * exports below — no stringly drift, no hidden web storage (rg-provable:
 * zero localStorage/sessionStorage tokens in this app's source).
 */

export type { PersistenceMode, PersistenceSettingStatus } from "./mode";
export {
  DEFAULT_PERSISTENCE_MODE,
  DURABLE_MODE_NOTICE,
  LEFTOVER_DURABLE_NOTE,
  PERSISTENCE_MODES,
  SESSION_ONLY_NOTICE,
  SETTING_FIRST_RUN_NOTE,
  SETTING_INVALID_NOTE,
  SETTING_STORED_DURABLE_NOTE,
  SETTING_STORED_SESSION_ONLY_NOTE,
  composePersistenceNotice,
  degradedNotice,
} from "./mode";

export type {
  BootstrapPersistenceDeps,
  DurablePersistence,
  PersistenceBootstrap,
  PersistenceBootstrapDegraded,
  PersistenceBootstrapOk,
} from "./bootstrap";
export { bootstrapPersistence } from "./bootstrap";

export { ModeRoutingRankerSelectionStore } from "./routing-store";
export type { ModeRoutingRankerSelectionStoreDeps } from "./routing-store";

export { DurableRankerSelectionStore } from "./selection-store";
export { PersistenceModeSettingStore } from "./setting-store";
export type { PersistenceModeSetting, PersistenceModeSettingRead } from "./setting-store";

export { PERSISTENCE_DB_NAME, PERSISTENCE_DB_VERSION } from "./idb";
