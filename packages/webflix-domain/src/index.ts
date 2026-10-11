/**
 * Public entrypoint of `webflix-domain`.
 *
 * Pure domain rules over `webflix-contracts` — no I/O, no Electron, no DB.
 * Every rule is a deterministic function of its inputs, which keeps the
 * domain layer unit-testable and reusable across main/renderer workers.
 */
export * from "./catalog";
export * from "./library";
export * from "./jobs";
export * from "./internal/time";
// Media intelligence (Phase 4, P4-CONTRACTS): the MI invariants. The
// built-in deterministic ranker ships in webflix-application (this order):
// application's package manifest cannot declare the domain edge without a
// root pnpm-lock.yaml change (forbidden path this order) — see the
// P4-FD1 proposal in the delivery report.
export * from "./intelligence";
