// Catalog merge over the frozen §2.1/§2.2 shapes.
//
// Policy:
//   - every incoming ProviderAsset is scored against every existing item,
//     producing a MatchEvidence with a 0..1 confidence
//   - candidates below the `candidate` threshold are ignored
//   - a best candidate at or above `autoMerge` with a clear margin
//     (more than `ambiguityDelta` over the runner-up) is merged into
//   - anything else — plausible-but-weak or tied/competing candidates —
//     becomes its own separate item; ambiguous matches never overwrite

import type {
  AvailabilityFact,
  CatalogItem,
  CatalogItemId,
  MatchEvidence,
  ProviderAsset,
} from "webflix-contracts";

/** Merge policy thresholds (MatchEvidence semantics, contract-freeze §2.2). */
export interface MergeThresholds {
  /** Confidence at or above which a clear best candidate is merged into. */
  readonly autoMerge: number;
  /** Confidence at or above which a candidate is considered at all. */
  readonly candidate: number;
  /** Best-vs-runner-up gap below which the match counts as ambiguous. */
  readonly ambiguityDelta: number;
}

export const DEFAULT_THRESHOLDS: MergeThresholds = {
  autoMerge: 0.9,
  candidate: 0.6,
  ambiguityDelta: 0.03,
};

/** Fixed confidence values emitted by the built-in evidence scorer. */
export const CONFIDENCE = {
  /** Same providerId + assetId. */
  providerNative: 1,
  /** Shared canonical external id (e.g. tmdb). */
  externalId: 1,
  /** Exact normalized title + matching year (±1). */
  titleYear: 0.98,
  /** Exact normalized title, year unknown on at least one side. */
  titleExactNoYear: 0.9,
  /** Exact normalized title but conflicting years. */
  titleExactYearConflict: 0.4,
  /** Fuzzy title confidences are similarity scaled by this. */
  fuzzyFactor: 0.85,
  /** Extra multiplier applied to fuzzy matches whose years conflict. */
  fuzzyYearConflictFactor: 0.5,
  /** Minimum normalized-title similarity for fuzzy evidence to be emitted. */
  fuzzyMinSimilarity: 0.6,
} as const;

/** How an incoming asset was resolved against the catalog. */
export type MergeOutcome =
  | "merged"
  | "deduped"
  | "created"
  | "ambiguous-separate"
  | "low-confidence-separate";

/** Per-asset audit record. */
export interface MergeRecord {
  readonly asset: ProviderAsset;
  readonly outcome: MergeOutcome;
  readonly targetItemId?: CatalogItemId;
  readonly evidence?: MatchEvidence;
  readonly runnerUpEvidence?: MatchEvidence;
  readonly reason?: string;
}

export interface MergeReport {
  readonly records: MergeRecord[];
  readonly merged: number;
  readonly deduped: number;
  readonly created: number;
  readonly ambiguous: number;
  readonly lowConfidence: number;
}

export interface MergeResult {
  readonly items: CatalogItem[];
  readonly report: MergeReport;
}

/**
 * Builder-side view of MergeReport: the published report is all-readonly
 * (consumer contract), the merge loop needs mutable counters while building.
 */
type MutableMergeReport = { -readonly [K in keyof MergeReport]: MergeReport[K] };

interface Candidate {
  item: CatalogItem;
  evidence: MatchEvidence;
}

/**
 * Score one incoming asset against one existing catalog item.
 * Returns null when there is no plausible evidence (including kind mismatch).
 */
export function scoreMatch(asset: ProviderAsset, item: CatalogItem): MatchEvidence | null {
  if (asset.kind !== item.kind) return null;

  if (item.assets.some((a) => a.providerId === asset.providerId && a.assetId === asset.assetId)) {
    return {
      type: "provider-native",
      confidence: CONFIDENCE.providerNative,
      source: `provider:${asset.providerId}`,
      detail: `same provider asset ${asset.providerId}/${asset.assetId}`,
    };
  }

  if (asset.externalIds) {
    for (const existing of item.assets) {
      if (!existing.externalIds) continue;
      for (const [key, value] of Object.entries(asset.externalIds)) {
        if (value !== "" && existing.externalIds[key] === value) {
          return {
            type: "external-id",
            confidence: CONFIDENCE.externalId,
            source: `external-id:${key}`,
            detail: `${key}=${value} shared with ${existing.providerId}/${existing.assetId}`,
          };
        }
      }
    }
  }

  return titleEvidence(asset, item);
}

function titleEvidence(asset: ProviderAsset, item: CatalogItem): MatchEvidence | null {
  const a = normalizeTitle(asset.title);
  const b = normalizeTitle(item.title);
  if (a.length === 0 || b.length === 0) return null;

  const sim = similarity(a, b);
  const years = compareYears(asset.year, item.year);

  if (sim === 1) {
    if (years === "conflict") {
      return {
        type: "title-fuzzy",
        confidence: CONFIDENCE.titleExactYearConflict,
        source: "title:exact+year-conflict",
        detail: `identical titles but years ${asset.year} vs ${item.year}`,
      };
    }
    if (years === "match") {
      return {
        type: "title-year",
        confidence: CONFIDENCE.titleYear,
        source: "title+year",
        detail: `exact title, year ${asset.year}`,
      };
    }
    return {
      type: "title-year",
      confidence: CONFIDENCE.titleExactNoYear,
      source: "title:exact",
      detail: "exact title, year incomplete on at least one side",
    };
  }

  if (sim < CONFIDENCE.fuzzyMinSimilarity) return null;

  let confidence = sim * CONFIDENCE.fuzzyFactor;
  if (years === "conflict") confidence *= CONFIDENCE.fuzzyYearConflictFactor;

  return {
    type: "title-fuzzy",
    confidence: round3(confidence),
    source: "title:fuzzy",
    detail: `similarity ${sim.toFixed(3)}`,
  };
}

/**
 * Merge incoming provider assets into a catalog.
 *
 * Never mutates `base` or its items; the returned `items` array contains
 * copied items whose `assets`/`availability` arrays are copies.
 * Ambiguous or below-threshold matches are kept as separate new items.
 */
export function mergeCatalogInto(
  base: readonly CatalogItem[],
  incoming: readonly ProviderAsset[],
  thresholds: MergeThresholds = DEFAULT_THRESHOLDS,
): MergeResult {
  const items: CatalogItem[] = base.map((item) => ({
    ...item,
    assets: [...item.assets],
    availability: [...item.availability],
  }));

  const records: MergeRecord[] = [];
  const report: MutableMergeReport = {
    records,
    merged: 0,
    deduped: 0,
    created: 0,
    ambiguous: 0,
    lowConfidence: 0,
  };

  for (const asset of incoming) {
    const candidates = items
      .map((item) => ({ item, evidence: scoreMatch(asset, item) }))
      .filter(
        (c): c is Candidate => c.evidence !== null && c.evidence.confidence >= thresholds.candidate,
      )
      .sort((x, y) => y.evidence.confidence - x.evidence.confidence);

    if (candidates.length === 0) {
      const created = createItem(asset);
      items.push(created);
      report.created += 1;
      records.push({ asset, outcome: "created", targetItemId: created.id });
      continue;
    }

    const best = candidates[0];
    const runnerUp = candidates.length > 1 ? candidates[1] : undefined;

    if (best.evidence.confidence < thresholds.autoMerge) {
      const created = createItem(asset);
      items.push(created);
      report.lowConfidence += 1;
      records.push({
        asset,
        outcome: "low-confidence-separate",
        targetItemId: created.id,
        evidence: best.evidence,
        reason: `best candidate confidence ${pct(best.evidence.confidence)} is below autoMerge ${pct(thresholds.autoMerge)}`,
      });
      continue;
    }

    if (
      runnerUp !== undefined &&
      best.evidence.confidence - runnerUp.evidence.confidence < thresholds.ambiguityDelta
    ) {
      const created = createItem(asset);
      items.push(created);
      report.ambiguous += 1;
      records.push({
        asset,
        outcome: "ambiguous-separate",
        targetItemId: created.id,
        evidence: best.evidence,
        runnerUpEvidence: runnerUp.evidence,
        reason: `top candidates ${pct(best.evidence.confidence)} and ${pct(runnerUp.evidence.confidence)} are within ambiguityDelta ${pct(thresholds.ambiguityDelta)}`,
      });
      continue;
    }

    const target = best.item;
    const alreadyPresent = target.assets.some(
      (a) => a.providerId === asset.providerId && a.assetId === asset.assetId,
    );

    if (!alreadyPresent) {
      target.assets.push(asset);
      applyAvailability(target, availabilityFromAsset(asset));
      if (target.year === undefined && asset.year !== undefined) {
        target.year = asset.year;
      }
    }
    applyEvidence(target, best.evidence);

    if (alreadyPresent) {
      report.deduped += 1;
      records.push({
        asset,
        outcome: "deduped",
        targetItemId: target.id,
        evidence: best.evidence,
      });
    } else {
      report.merged += 1;
      records.push({
        asset,
        outcome: "merged",
        targetItemId: target.id,
        evidence: best.evidence,
      });
    }
  }

  return { items, report };
}

/** Derive the availability fact a provider asset asserts by existing. */
export function availabilityFromAsset(asset: ProviderAsset): AvailabilityFact {
  return {
    providerId: asset.providerId,
    available: true,
    url: asset.url,
  };
}

function createItem(asset: ProviderAsset): CatalogItem {
  return {
    id: makeItemId(asset),
    kind: asset.kind,
    title: asset.title,
    year: asset.year,
    assets: [asset],
    availability: [availabilityFromAsset(asset)],
  };
}

function makeItemId(asset: ProviderAsset): CatalogItemId {
  return `cat:${asset.kind}:${asset.providerId}:${asset.assetId}`;
}

function applyAvailability(item: CatalogItem, fact: AvailabilityFact): void {
  const exists = item.availability.some(
    (f) => f.providerId === fact.providerId && (f.url ?? undefined) === (fact.url ?? undefined),
  );
  if (!exists) item.availability.push(fact);
}

function applyEvidence(item: CatalogItem, evidence: MatchEvidence): void {
  if (!item.matchEvidence || evidence.confidence > item.matchEvidence.confidence) {
    item.matchEvidence = evidence;
  }
}

function compareYears(
  a: number | undefined,
  b: number | undefined,
): "match" | "conflict" | "unknown" {
  if (a === undefined || b === undefined) return "unknown";
  // ±1 tolerates release-date boundary rounding across providers.
  if (Math.abs(a - b) <= 1) return "match";
  return "conflict";
}

function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from<number>({ length: b.length + 1 });
  let curr = Array.from<number>({ length: b.length + 1 });

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[b.length];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function pct(n: number): string {
  return n.toFixed(2);
}
