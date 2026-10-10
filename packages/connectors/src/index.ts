/**
 * @webflix/connectors — public surface.
 *
 * ADR-0003: official surfaces only. This package is fixture-tested only; live
 * smoke tests are pending-operator-credential per the connectors work order.
 */
export * from "webflix-contracts";
export * from "./registry";
export * from "./youtube/manifest";
export * from "./youtube/dataApi";
export * from "./youtube/oauth";
export * from "./youtube/playback";
