// Catalog merge over the frozen §2.1 shapes.
//
// §2.1 reconciliation (MIRROR-RECON, 2026-10-11): this module originally
// scored lane-local "rich" ProviderAssets (providerId/title/year/url/
// externalIds on the asset itself — a mirror vocabulary) against mirror
// CatalogItems (asset-style `kind`, per-asset `title`/`year`, an
// `availability` ARRAY). The FROZEN §2.1 shapes attribute the provider at the
// ITEM level (CatalogItem.providerId), carry match context in item.title and
// the item.metadata bag (externalIds/year — the metadata bag is the canonical
// home for external descriptors), and hold ONE optional AvailabilityFact per
// item. The merge unit is therefore the incoming CatalogItem (a connector's
// provider-attributed candidate); its assets attach to the matched item, and
// the provider attribution of the target item is preserved (structural, per
// the frozen shape).
//
// Field map (mirror → frozen §2.1):
//   asset.providerId      → item.providerId (item-level attribution)
//   asset.title/year      → item.title / item.metadata.year
//   asset.externalIds     → item.metadata.externalIds (canonical metadata bag)
//   asset.url             → asset.reference (secret-free provider reference)
//   item.kind ("movie"…)  → item.mediaKind (video|short|live|podcast|audio|local-file)
//   item.availability[]   → item.availability (single fact; latest observedAt wins —
//                            the mirror's per-provider fact accumulation is not
//                            expressible in the frozen shape; freeze-deviation MR-FD5)
//   MatchEvidence{type,   → MatchEvidence{confidence, evidence: string[]} — the
//    source, detail}         match kind and human detail live in the evidence
//                            strings ("provider-native: …", "external-id: …",
//                            "title:exact+year …"), strongest-first
//
// Policy (unchanged from the mirror — every threshold and outcome preserved):
//   - every incoming item is scored against every existing item,
//     producing a MatchEvidence with a 0..1 confidence
//   - candidates below the `candidate` threshold are ignored
//   - a best candidate at or above `autoMerge` with a clear margin
//     (more than `ambiguityDelta` over the runner-up) is merged into
//   - anything else — plausible-but-weak or tied/competing candidates —
//     becomes its own separate item; ambiguous matches never overwrite

import type {
  AvailabilityFact,
  CatalogItem,
  MatchEvidence,
  ProviderAsset,
} from "webflix-contracts";

/** Merge policy thresholds (MatchEvidence semantics, contract-freeze §2.1). */
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
  /** Same provider + same assetId. */
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

/** How an incoming item was resolved against the catalog. */
export type MergeOutcome =
  | "merged"
  | "deduped"
  | "created"
  | "ambiguous-separate"
  | "low-confidence-separate";

/** Per-item audit record. */
export interface MergeRecord {
  readonly item: CatalogItem;
  readonly outcome: MergeOutcome;
  readonly targetItemId?: string;
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

/** External-id bag on a catalog item's metadata (canonical: metadata.externalIds). */
function externalIdsOf(item: CatalogItem): Record<string, string> {
  const bag = item.metadata.externalIds;
  if (bag === undefined || bag === null || typeof bag !== "object" || Array.isArray(bag)) {
    return {};
  }
  const ids: Record<string, string> = {};
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") ids[key] = value;
  }
  return ids;
}

/** Release year on a catalog item's metadata (canonical: metadata.year). */
function yearOf(item: CatalogItem): number | undefined {
  const year = item.metadata.year;
  return typeof year === "number" && Number.isFinite(year) ? year : undefined;
}

/**
 * Score one incoming item against one existing catalog item.
 * Returns null when there is no plausible evidence (including mediaKind mismatch).
 */
export function scoreMatch(incoming: CatalogItem, existing: CatalogItem): MatchEvidence | null {
  if (incoming.mediaKind !== existing.mediaKind) return null;

  if (incoming.providerId === existing.providerId) {
    const nativeAsset = incoming.assets.find((asset) =>
      existing.assets.some((other) => other.assetId === asset.assetId),
    );
    if (nativeAsset !== undefined) {
      return {
        confidence: CONFIDENCE.providerNative,
        evidence: [
          `provider-native: same provider asset ${incoming.providerId}/${nativeAsset.assetId}`,
        ],
      };
    }
  }

  const incomingIds = externalIdsOf(incoming);
  if (Object.keys(incomingIds).length > 0) {
    const existingIds = externalIdsOf(existing);
    for (const [key, value] of Object.entries(incomingIds)) {
      if (existingIds[key] === value) {
        return {
          confidence: CONFIDENCE.externalId,
          evidence: [
            `external-id:${key}=${value} shared with item ${existing.id}`,
            `provider attribution ${incoming.providerId} vs ${existing.providerId}`,
          ],
        };
      }
    }
  }

  return titleEvidence(incoming, existing);
}

function titleEvidence(incoming: CatalogItem, existing: CatalogItem): MatchEvidence | null {
  const a = normalizeTitle(incoming.title);
  const b = normalizeTitle(existing.title);
  if (a.length === 0 || b.length === 0) return null;

  const sim = similarity(a, b);
  const incomingYear = yearOf(incoming);
  const existingYear = yearOf(existing);
  const years = compareYears(incomingYear, existingYear);

  if (sim === 1) {
    if (years === "conflict") {
      return {
        confidence: CONFIDENCE.titleExactYearConflict,
        evidence: [
          `title:exact but years conflict (${incomingYear} vs ${existingYear})`,
          `providers ${incoming.providerId} vs ${existing.providerId}`,
        ],
      };
    }
    if (years === "match") {
      return {
        confidence: CONFIDENCE.titleYear,
        evidence: [
          `title:exact + year ${incomingYear}`,
          `providers ${incoming.providerId} vs ${existing.providerId}`,
        ],
      };
    }
    return {
      confidence: CONFIDENCE.titleExactNoYear,
      evidence: ["title:exact, year incomplete on at least one side"],
    };
  }

  if (sim < CONFIDENCE.fuzzyMinSimilarity) return null;

  let confidence = sim * CONFIDENCE.fuzzyFactor;
  if (years === "conflict") confidence *= CONFIDENCE.fuzzyYearConflictFactor;

  const evidence = [`title:fuzzy similarity ${sim.toFixed(3)}`];
  if (years === "conflict") {
    evidence.push(`years conflict (${incomingYear} vs ${existingYear})`);
  }
  return { confidence: round3(confidence), evidence };
}

/**
 * Merge incoming provider-attributed items into a catalog.
 *
 * Never mutates `base` or its items; the returned `items` array contains
 * copied items whose `assets` arrays and `metadata` bags are copies.
 * Ambiguous or below-threshold matches are kept as separate new items.
 */
export function mergeCatalogInto(
  base: readonly CatalogItem[],
  incoming: readonly CatalogItem[],
  thresholds: MergeThresholds = DEFAULT_THRESHOLDS,
): MergeResult {
  const items: CatalogItem[] = base.map((item) => ({
    ...item,
    assets: [...item.assets],
    metadata: { ...item.metadata },
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

  for (const candidate of incoming) {
    const scored = items
      .map((item) => ({ item, evidence: scoreMatch(candidate, item) }))
      .filter(
        (c): c is Candidate => c.evidence !== null && c.evidence.confidence >= thresholds.candidate,
      )
      .sort((x, y) => y.evidence.confidence - x.evidence.confidence);

    if (scored.length === 0) {
      items.push(copyItem(candidate));
      report.created += 1;
      records.push({ item: candidate, outcome: "created", targetItemId: candidate.id });
      continue;
    }

    const best = scored[0];
    const runnerUp = scored.length > 1 ? scored[1] : undefined;

    if (best.evidence.confidence < thresholds.autoMerge) {
      items.push(copyItem(candidate));
      report.lowConfidence += 1;
      records.push({
        item: candidate,
        outcome: "low-confidence-separate",
        targetItemId: candidate.id,
        evidence: best.evidence,
        reason: `best candidate confidence ${pct(best.evidence.confidence)} is below autoMerge ${pct(thresholds.autoMerge)}`,
      });
      continue;
    }

    if (
      runnerUp !== undefined &&
      best.evidence.confidence - runnerUp.evidence.confidence < thresholds.ambiguityDelta
    ) {
      items.push(copyItem(candidate));
      report.ambiguous += 1;
      records.push({
        item: candidate,
        outcome: "ambiguous-separate",
        targetItemId: candidate.id,
        evidence: best.evidence,
        runnerUpEvidence: runnerUp.evidence,
        reason: `top candidates ${pct(best.evidence.confidence)} and ${pct(runnerUp.evidence.confidence)} are within ambiguityDelta ${pct(thresholds.ambiguityDelta)}`,
      });
      continue;
    }

    const target = best.item;
    const newAssets = candidate.assets.filter(
      (asset) => !target.assets.some((other) => other.assetId === asset.assetId),
    );
    const alreadyPresent = newAssets.length === 0;

    if (!alreadyPresent) {
      target.assets.push(...newAssets);
    }
    mergeMetadata(target, candidate);
    target.availability = latestAvailability(target.availability, candidate.availability);
    applyEvidence(target, best.evidence);

    if (alreadyPresent) {
      report.deduped += 1;
      records.push({
        item: candidate,
        outcome: "deduped",
        targetItemId: target.id,
        evidence: best.evidence,
      });
    } else {
      report.merged += 1;
      records.push({
        item: candidate,
        outcome: "merged",
        targetItemId: target.id,
        evidence: best.evidence,
      });
    }
  }

  return { items, report };
}

/** Copy an incoming item so the caller's array is never aliased into the result. */
function copyItem(item: CatalogItem): CatalogItem {
  return { ...item, assets: [...item.assets], metadata: { ...item.metadata } };
}

/**
 * Keep the LATER observation (§2.1: availability is one point-in-time fact —
 * the mirror's per-provider fact list is not expressible; freeze-deviation
 * MR-FD5). Returns undefined when neither side carries a fact.
 */
function latestAvailability(
  current: AvailabilityFact | undefined,
  incoming: AvailabilityFact | undefined,
): AvailabilityFact | undefined {
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  return Date.parse(incoming.observedAt) > Date.parse(current.observedAt) ? incoming : current;
}

/** Fill missing metadata keys (year, externalIds) from the incoming item; never overwrites. */
function mergeMetadata(target: CatalogItem, incoming: CatalogItem): void {
  if (yearOf(target) === undefined && yearOf(incoming) !== undefined) {
    target.metadata.year = yearOf(incoming);
  }
  const targetIds = externalIdsOf(target);
  for (const [key, value] of Object.entries(externalIdsOf(incoming))) {
    if (targetIds[key] === undefined) {
      const bag = { ...externalIdsOf(target), [key]: value };
      target.metadata.externalIds = bag;
    }
  }
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

// Re-exported so consumers of this module can speak the frozen asset shape
// without importing the contracts package separately.
export type { ProviderAsset };
