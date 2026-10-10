// swap-at-integration: re-point to packages/webflix-contracts at TL2 merge.
//
// Local mirror of the frozen contract shapes from
// docs/plans/contract-freeze.md §2.1 (catalog domain) and §2.2 (match evidence),
// frozen at contract-freeze 5549208.
//
// Rules while this file is a mirror:
//   - shapes must stay structurally identical to the frozen contract
//   - no local extensions beyond the frozen surface
//   - at TL2 merge: delete this file and import from packages/webflix-contracts

/** Opaque identifier of a catalog item. */
export type CatalogItemId = string;

/** Coarse media classification of a catalog item / provider asset. */
export type MediaKind = 'movie' | 'series' | 'episode';

/** A playable asset as exposed by one provider. */
export interface ProviderAsset {
  /** Provider-native id, unique within `providerId`. */
  assetId: string;
  /** Registered provider id (e.g. 'youtube', 'plex', 'tmdb'). */
  providerId: string;
  /** Provider-displayed title. */
  title: string;
  kind: MediaKind;
  /** Release year, when the provider exposes one. */
  year?: number;
  /** Playback URL, when resolvable. */
  url?: string;
  /** Canonical cross-provider ids (e.g. `{ tmdb: '603' }`). */
  externalIds?: Readonly<Record<string, string>>;
  /** Provider-specific extras; opaque to the catalog domain. */
  metadata?: Readonly<Record<string, unknown>>;
}

/** How a match between assets/items was established. */
export type MatchEvidenceType =
  | 'provider-native' // same providerId + assetId
  | 'external-id' // shared canonical id (e.g. tmdb)
  | 'title-year' // exact normalized title + year agreement
  | 'title-fuzzy'; // fuzzy title similarity

/** Evidence justifying a merge decision (contract-freeze §2.2). */
export interface MatchEvidence {
  type: MatchEvidenceType;
  /** 0..1 — compared against the merge thresholds in packages/catalog/src/merge.ts. */
  confidence: number;
  /** What produced the evidence (e.g. 'external-id:tmdb'). */
  source: string;
  /** Human-readable detail for debugging merge decisions. */
  detail?: string;
}

/** One provider's availability claim for a catalog item. */
export interface AvailabilityFact {
  providerId: string;
  available: boolean;
  url?: string;
  region?: string;
  /** ISO-8601 date the fact was observed / valid from. */
  since?: string;
  /** ISO-8601 date the fact stops being valid. */
  until?: string;
}

/** A catalog item: the deduplicated entity that assets and availability hang off. */
export interface CatalogItem {
  id: CatalogItemId;
  kind: MediaKind;
  title: string;
  year?: number;
  assets: ProviderAsset[];
  availability: AvailabilityFact[];
  /** Strongest evidence that linked assets into this item, if any. */
  matchEvidence?: MatchEvidence;
}
