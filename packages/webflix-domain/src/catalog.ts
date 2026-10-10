import {
  CatalogItemSchema,
  ErrorCode,
  MatchEvidenceSchema,
  ProviderAssetSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  MatchEvidence,
  MediaKind,
  ProviderAsset,
} from "webflix-contracts";
import { parseOrThrow } from "./internal/parse";

/**
 * Confidence thresholds governing catalog merges.
 *
 * - confidence >= autoMergeAt  → merge automatically
 * - ambiguousBelow <= confidence < autoMergeAt → ambiguous: keep separate items
 * - confidence < ambiguousBelow → reject the match outright
 */
export interface MergeThresholds {
  autoMergeAt: number;
  ambiguousBelow: number;
}

export const DEFAULT_MERGE_THRESHOLDS: MergeThresholds = {
  autoMergeAt: 0.9,
  ambiguousBelow: 0.6,
};

/**
 * The decision produced by {@link mergeCatalogItem}. Every variant carries
 * either the merged item or the pair of items that stay separate; inputs
 * are never mutated.
 */
export type CatalogMergeResult =
  | { kind: "merged"; item: CatalogItem; reason: string }
  | { kind: "unchanged"; item: CatalogItem; reason: string }
  | {
      kind: "ambiguous";
      existing: CatalogItem;
      candidate: CatalogItem;
      reason: string;
    }
  | {
      kind: "separate";
      existing: CatalogItem;
      candidate: CatalogItem;
      reason: string;
    }
  | {
      kind: "conflict";
      existing: CatalogItem;
      incoming: ProviderAsset;
      reason: string;
    };

/**
 * Optional seed for candidate items built on ambiguous/separate outcomes.
 * Defaults: id `candidate:<assetId>`, the existing item's title/mediaKind.
 */
export interface CandidateSeed {
  id?: string;
  title?: string;
  mediaKind?: MediaKind;
}

export interface CatalogMergeOptions {
  thresholds?: MergeThresholds;
  candidateSeed?: CandidateSeed;
}

function validatedThresholds(thresholds: MergeThresholds): MergeThresholds {
  const { autoMergeAt, ambiguousBelow } = thresholds;
  const ok =
    Number.isFinite(autoMergeAt) &&
    Number.isFinite(ambiguousBelow) &&
    ambiguousBelow >= 0 &&
    ambiguousBelow <= autoMergeAt &&
    autoMergeAt <= 1;
  if (!ok) {
    throw new WebFlixError({
      code: ErrorCode.CatalogMatchFailed,
      reason: `invalid merge thresholds: ambiguousBelow=${ambiguousBelow}, autoMergeAt=${autoMergeAt} (need 0 <= ambiguousBelow <= autoMergeAt <= 1)`,
      retryable: false,
      context: { autoMergeAt, ambiguousBelow },
    });
  }
  return { autoMergeAt, ambiguousBelow };
}

/** Picks the evidence with the higher confidence; ties keep `a`. */
export function strongerEvidence(
  a: MatchEvidence | undefined,
  b: MatchEvidence | undefined,
): MatchEvidence | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.confidence > a.confidence ? b : a;
}

function buildCandidate(
  existing: CatalogItem,
  asset: ProviderAsset,
  evidence: MatchEvidence,
  seed: CandidateSeed | undefined,
): CatalogItem {
  return {
    id: seed?.id ?? `candidate:${asset.assetId}`,
    providerId: existing.providerId,
    title: seed?.title ?? existing.title,
    mediaKind: seed?.mediaKind ?? existing.mediaKind,
    assets: [asset],
    matchEvidence: evidence,
    metadata: {},
  };
}

/**
 * Merge an incoming provider asset into an existing catalog item, gated by
 * match-evidence confidence:
 *
 * 1. identical asset (same assetId, kind and reference) → `unchanged` (idempotent);
 * 2. same assetId with different content below autoMergeAt → `conflict`;
 * 3. same assetId with different content at/above autoMergeAt → `merged` (refresh);
 * 4. same kind+reference under a different assetId → `conflict`;
 * 5. confidence < ambiguousBelow → `separate` items;
 * 6. confidence in the ambiguous band → `ambiguous` (stays separate items);
 * 7. confidence >= autoMergeAt → `merged` (append + strongest evidence wins).
 *
 * Pure: validates inputs against the locked contract schemas and returns
 * new objects; the inputs are never mutated.
 */
export function mergeCatalogItem(
  existing: CatalogItem,
  incoming: ProviderAsset,
  evidence: MatchEvidence,
  options: CatalogMergeOptions = {},
): CatalogMergeResult {
  const item = parseOrThrow(
    CatalogItemSchema,
    existing,
    ErrorCode.CatalogMatchFailed,
    "existing CatalogItem",
  );
  const asset = parseOrThrow(
    ProviderAssetSchema,
    incoming,
    ErrorCode.CatalogMatchFailed,
    "incoming ProviderAsset",
  );
  const match = parseOrThrow(
    MatchEvidenceSchema,
    evidence,
    ErrorCode.CatalogMatchFailed,
    "MatchEvidence",
  );
  const thresholds = validatedThresholds(
    options.thresholds ?? DEFAULT_MERGE_THRESHOLDS,
  );

  const sameId = item.assets.find(
    (candidate) => candidate.assetId === asset.assetId,
  );
  if (sameId !== undefined) {
    if (sameId.kind === asset.kind && sameId.reference === asset.reference) {
      return {
        kind: "unchanged",
        item,
        reason: `asset ${asset.assetId} is already attached to item ${item.id}`,
      };
    }
    if (match.confidence < thresholds.autoMergeAt) {
      return {
        kind: "conflict",
        existing: item,
        incoming: asset,
        reason: `asset ${asset.assetId} is already attached with different content and confidence ${match.confidence} is below autoMergeAt=${thresholds.autoMergeAt}`,
      };
    }
    const assets = item.assets.map((candidate) =>
      candidate.assetId === asset.assetId ? asset : candidate,
    );
    return {
      kind: "merged",
      item: {
        ...item,
        assets,
        matchEvidence: strongerEvidence(item.matchEvidence, match),
      },
      reason: `refreshed asset ${asset.assetId} on item ${item.id}`,
    };
  }

  const duplicateReference = item.assets.find(
    (candidate) =>
      candidate.kind === asset.kind && candidate.reference === asset.reference,
  );
  if (duplicateReference !== undefined) {
    return {
      kind: "conflict",
      existing: item,
      incoming: asset,
      reason: `asset ${duplicateReference.assetId} already carries the ${asset.kind} reference ${asset.reference} under a different assetId`,
    };
  }

  if (match.confidence < thresholds.ambiguousBelow) {
    return {
      kind: "separate",
      existing: item,
      candidate: buildCandidate(item, asset, match, options.candidateSeed),
      reason: `confidence ${match.confidence} is below the ambiguity floor ${thresholds.ambiguousBelow}; keeping a separate item`,
    };
  }
  if (match.confidence < thresholds.autoMergeAt) {
    return {
      kind: "ambiguous",
      existing: item,
      candidate: buildCandidate(item, asset, match, options.candidateSeed),
      reason: `confidence ${match.confidence} sits between ambiguousBelow=${thresholds.ambiguousBelow} and autoMergeAt=${thresholds.autoMergeAt}; keeping separate items`,
    };
  }
  return {
    kind: "merged",
    item: {
      ...item,
      assets: [...item.assets, asset],
      matchEvidence: strongerEvidence(item.matchEvidence, match),
    },
    reason: `attached asset ${asset.assetId} to item ${item.id}`,
  };
}
