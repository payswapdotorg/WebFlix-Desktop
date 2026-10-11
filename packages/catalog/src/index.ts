// packages/catalog — public entrypoint.
//
// Catalog domain over the frozen §2.1 contract shapes (re-pointed to the
// canonical webflix-contracts at integration; the lane-local mirror was
// removed — MIRROR-RECON reconciled the merge to the item-attributed model):
//   - types: canonical webflix-contracts (CatalogItem/ProviderAsset/MediaKind)
//   - merge: MatchEvidence-confidence-driven catalog merge

export * from "webflix-contracts";
export * from "./merge";
