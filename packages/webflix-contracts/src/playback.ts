import { z } from "zod";
import {
  AbsoluteUrlSchema,
  IsoDateTimeSchema,
  SecretFreeRecordSchema,
} from "./internal/primitives";

/** Why a playback plan is unavailable. */
export const UnavailableReasonSchema = z.enum([
  "unsupported",
  "requires-auth",
  "region",
  "rate-limited",
  "removed",
  "offline",
  "policy-restricted",
]);
export type UnavailableReason = z.infer<typeof UnavailableReasonSchema>;

/** What the user can do next when playback is unavailable. */
export const RecoveryActionSchema = z.enum([
  "sign-in",
  "retry-later",
  "check-connection",
  "change-region",
  "open-provider-app",
  "open-system-settings",
  "contact-support",
]);
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

/** Renderer-safe guidance attached to an unavailable playback plan. */
export const RecoveryHintSchema = z.object({
  action: RecoveryActionSchema,
  /** User-facing explanation of the recovery step. */
  message: z.string().min(1),
  /** Optional deep link that starts the recovery step. Secret-free by contract. */
  url: AbsoluteUrlSchema.optional(),
});
export type RecoveryHint = z.infer<typeof RecoveryHintSchema>;

/** Play the item through the provider's official embedded player. */
export const OfficialEmbedPlanSchema = z.object({
  kind: z.literal("official-embed"),
  providerId: z.string().min(1),
  /**
   * Provider-defined embed parameters (video id, player flavour, start
   * time, …). Never carries raw secrets — validated at parse time.
   */
  embedSpec: SecretFreeRecordSchema,
});
export type OfficialEmbedPlan = z.infer<typeof OfficialEmbedPlanSchema>;

/** Open the item on the provider's own site inside an isolated webview/profile. */
export const IsolatedWebsitePlanSchema = z.object({
  kind: z.literal("isolated-website"),
  url: AbsoluteUrlSchema,
});
export type IsolatedWebsitePlan = z.infer<typeof IsolatedWebsitePlanSchema>;

/** Play a file from the local library directly (no network involved). */
export const LocalFilePlanSchema = z.object({
  kind: z.literal("local-file"),
  /** Absolute filesystem path of the local file. */
  path: z.string().min(1),
  mimeType: z
    .string()
    .regex(/^[\w.+-]+\/[\w.+-]+$/, "must be a MIME type such as video/mp4"),
});
export type LocalFilePlan = z.infer<typeof LocalFilePlanSchema>;

/** Hand playback off to an external application via a deep link. */
export const ExternalDeepLinkPlanSchema = z.object({
  kind: z.literal("external-deep-link"),
  url: AbsoluteUrlSchema,
});
export type ExternalDeepLinkPlan = z.infer<typeof ExternalDeepLinkPlanSchema>;

/** Playback cannot proceed; explain why and how the user can recover. */
export const UnavailablePlanSchema = z.object({
  kind: z.literal("unavailable"),
  reason: UnavailableReasonSchema,
  recovery: RecoveryHintSchema.optional(),
});
export type UnavailablePlan = z.infer<typeof UnavailablePlanSchema>;

/**
 * The single locked resolution type for "how do we play this item?" — a
 * discriminated union on `kind` covering every strategy the desktop app
 * supports, from official embeds down to a truthful `unavailable` answer.
 */
export const PlaybackPlanSchema = z.discriminatedUnion("kind", [
  OfficialEmbedPlanSchema,
  IsolatedWebsitePlanSchema,
  LocalFilePlanSchema,
  ExternalDeepLinkPlanSchema,
  UnavailablePlanSchema,
]);
export type PlaybackPlan = z.infer<typeof PlaybackPlanSchema>;

/** Resume position of a playback session for one item. */
export const PlaybackProgressSchema = z.object({
  itemId: z.string().min(1),
  positionMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  updatedAt: IsoDateTimeSchema,
});
export type PlaybackProgress = z.infer<typeof PlaybackProgressSchema>;
