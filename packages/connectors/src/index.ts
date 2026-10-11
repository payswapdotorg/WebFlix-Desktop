/**
 * connectors — public surface.
 *
 * ADR-0003: official surfaces only. This package is fixture-tested only; live
 * smoke tests are pending-operator-credential per the connectors work order.
 * Contract types come from the canonical webflix-contracts (the lane-local
 * mirror was removed at integration; MIRROR-RECON reconciled the manifest,
 * registry, OAuth session and playback builder to the frozen §2 shapes).
 */
export * from "webflix-contracts";
export * from "./registry";
export * from "./youtube/manifest";
export * from "./youtube/dataApi";
export * from "./youtube/oauth";
export * from "./youtube/playback";
export * from "./youtube/catalogMapping";
export * from "./youtube/service";
export * from "./youtube/substitutes";
