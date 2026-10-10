import { z } from "zod";
import { IsoDateTimeSchema, RegionCodeSchema, SecretFreeStringSchema } from "./internal/primitives";

/** The kind of media a catalog item represents. */
export const MediaKindSchema = z.enum(["video", "short", "live", "podcast", "audio", "local-file"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

/** Kinds of provider-side assets a catalog item can reference. */
export const ProviderAssetKindSchema = z.enum([
  "embed",
  "stream",
  "thumbnail",
  "artwork",
  "trailer",
  "subtitle",
  "download",
]);
export type ProviderAssetKind = z.infer<typeof ProviderAssetKindSchema>;

/**
 * A reference to an asset owned by a provider (embed handle, stream
 * descriptor, artwork, …). References point at provider surfaces and NEVER
 * carry raw secrets — enforced at parse time — so catalog data can be
 * cached and rendered safely.
 */
export const ProviderAssetSchema = z.object({
  assetId: z.string().min(1),
  kind: ProviderAssetKindSchema,
  /** Provider-relative reference (URL, embed handle, path). Secret-free. */
  reference: SecretFreeStringSchema,
  mimeType: z.string().min(1).optional(),
  /** Opaque cache-busting version supplied by the provider. */
  version: z.string().min(1).optional(),
  /** ISO 8601 UTC instant after which the reference may go stale. */
  expiresAt: IsoDateTimeSchema.optional(),
});
export type ProviderAsset = z.infer<typeof ProviderAssetSchema>;

/**
 * Why a catalog item was matched, with human-readable evidence so matches
 * stay auditable and explainable in the UI.
 */
export const MatchEvidenceSchema = z.object({
  /** 0 = no confidence, 1 = certain. */
  confidence: z.number().min(0).max(1),
  /** Human-readable signals supporting the match, strongest first. */
  evidence: z.array(z.string().min(1)),
});
export type MatchEvidence = z.infer<typeof MatchEvidenceSchema>;

/** A point-in-time observation of whether an item is available in a region. */
export const AvailabilityFactSchema = z.object({
  providerId: z.string().min(1),
  region: RegionCodeSchema,
  available: z.boolean(),
  /** When the fact was observed. */
  observedAt: IsoDateTimeSchema,
  /** When the fact may stop holding, when known. */
  untilAt: IsoDateTimeSchema.optional(),
  note: z.string().min(1).optional(),
});
export type AvailabilityFact = z.infer<typeof AvailabilityFactSchema>;

/**
 * The canonical, provider-attributed description of something watchable or
 * playable. CatalogItems are the unit matched against local library
 * entries and the unit resolved into PlaybackPlans.
 */
export const CatalogItemSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  title: z.string().min(1),
  mediaKind: MediaKindSchema,
  assets: z.array(ProviderAssetSchema).default([]),
  matchEvidence: MatchEvidenceSchema.optional(),
  availability: AvailabilityFactSchema.optional(),
  /** Provider-neutral bag for extra descriptors (external ids, artwork, …). */
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
