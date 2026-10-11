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
// P4-ARTIFACTS row 0: the frozen application->domain edge landed (workspace
// dependency declared + root lockfile importers updated), so the shared
// contract-parse guard collapses to this public export — application no
// longer carries the mirrored parseContractOrThrow (P4-FD1 resolved).
export { parseOrThrow } from "./internal/parse";
// Media intelligence (Phase 4, P4-CONTRACTS): the MI invariants. The
// built-in deterministic ranker ships in webflix-application (homed there by
// the charter's enumerated mirror collapse — only its parseIsoToEpochMs
// helper collapsed to the domain import above); the domain carries the
// shared invariants (objective rules, lineage checks, policy resolution,
// reasons-mandatory guard) that application enforces through imports.
export * from "./intelligence";
