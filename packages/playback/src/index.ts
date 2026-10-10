/**
 * packages/playback/src/index.ts
 *
 * Public surface of playback:
 *  - §2.2 contract types re-exported from the CANONICAL webflix-contracts
 *    package (PlaybackPlan union, UnavailableReason, RecoveryHint,
 *    PlaybackProgress) — the lane-local mirror was removed at integration
 *    (2026-10-10) because it had drifted from the frozen §2.2 shapes.
 *  - pure PlaybackPlan resolution (official-embed | local-file | unavailable)
 *  - WebFlix-owned progress helpers (provider writes are explicit ops only)
 */

export {
  ExternalDeepLinkPlanSchema,
  type ExternalDeepLinkPlan,
  IsolatedWebsitePlanSchema,
  type IsolatedWebsitePlan,
  LocalFilePlanSchema,
  type LocalFilePlan,
  OfficialEmbedPlanSchema,
  type OfficialEmbedPlan,
  PlaybackPlanSchema,
  type PlaybackPlan,
  PlaybackProgressSchema,
  type PlaybackProgress,
  RecoveryActionSchema,
  type RecoveryAction,
  RecoveryHintSchema,
  type RecoveryHint,
  UnavailablePlanSchema,
  type UnavailablePlan,
  UnavailableReasonSchema,
  type UnavailableReason,
} from "webflix-contracts";
export * from "./resolve.js";
