import { z } from "zod";
import { IsoDateTimeSchema, RegionCodeSchema } from "./internal/primitives";

/** Coarse health of a connector operation. */
export const CapabilityStatusSchema = z.enum([
  "supported",
  "requires-auth",
  "unsupported",
  "unavailable",
  "rate-limited",
  "degraded",
  "unknown",
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>;

/**
 * Dot-namespaced operation identifier, e.g. `catalog.search` or
 * `playback.resolve`. An open set: connectors declare the operations they
 * implement via `ConnectorManifest.operations`.
 */
export const OperationIdSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/,
    "must be a dot-namespaced operation id such as playback.resolve",
  );
export type OperationId = z.infer<typeof OperationIdSchema>;

/** Current capability of a single connector operation. */
export const OperationCapabilitySchema = z.object({
  status: CapabilityStatusSchema,
  /** Human-readable detail, e.g. why an operation is unsupported. */
  detail: z.string().min(1).optional(),
  /** When this capability was last probed. */
  checkedAt: IsoDateTimeSchema.optional(),
});
export type OperationCapability = z.infer<typeof OperationCapabilitySchema>;

/** Rate/quota envelope for a connector. */
export const ConnectorQuotasSchema = z.object({
  requestsPerWindow: z.number().int().min(0),
  windowMs: z.number().int().min(1),
  maxConcurrent: z.number().int().min(1).optional(),
  burst: z.number().int().min(0).optional(),
});
export type ConnectorQuotas = z.infer<typeof ConnectorQuotasSchema>;

/**
 * Provenance of a generated artifact: which connector build produced it,
 * when, and from which inputs. Preserved end-to-end so every downstream
 * artifact can be audited back to its origin.
 */
export const ProvenanceSchema = z.object({
  connectorId: z.string().min(1),
  connectorVersion: z.string().min(1),
  buildId: z.string().min(1).optional(),
  generatedAt: IsoDateTimeSchema,
  /** Hash of the inputs the artifact was derived from. */
  inputsHash: z.string().min(1).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Failure modes a connector knows it can hit. */
export const FailureModeSchema = z.enum([
  "network",
  "timeout",
  "auth",
  "rate-limit",
  "region",
  "parse",
  "upstream",
  "unknown",
]);
export type FailureMode = z.infer<typeof FailureModeSchema>;

/**
 * What a connector can do, where, how fast, and how it fails. Consulted by
 * the orchestrator before invoking operations and rendered by the UI.
 */
export const ConnectorManifestSchema = z.object({
  providerId: z.string().min(1),
  /** Operation id -> capability; connectors declare what they support. */
  operations: z.record(OperationIdSchema, OperationCapabilitySchema),
  regions: z.array(RegionCodeSchema),
  quotas: ConnectorQuotasSchema,
  provenance: ProvenanceSchema,
  failureModes: z.array(FailureModeSchema),
});
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;
