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
