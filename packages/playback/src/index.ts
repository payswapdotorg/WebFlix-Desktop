/**
 * packages/playback/src/index.ts
 *
 * Public surface of @webflix/playback:
 *  - §2.2 contract mirror types (PlaybackPlan union, UnavailableReason,
 *    RecoveryHint, PlaybackProgress, ProviderHistoryWriteOp)
 *  - pure PlaybackPlan resolution (official-embed | local-file | unavailable)
 *  - WebFlix-owned progress helpers (provider writes are explicit ops only)
 */

export * from './contract-types.js';
export * from './resolve.js';
