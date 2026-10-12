import type { SqliteDatabase } from "./db/adapter";
import {
  SqliteAdvertiserIdentityStore,
  type AdvertiserIdentityStoreOptions,
  type AdvertiserIdentityStorePort,
} from "./ads-identity-store";
import {
  SqliteAdRecordStore,
  type AdRecordStoreOptions,
  type AdRecordStorePort,
} from "./ads-record-store";
import { SqliteClaimStore, type ClaimStoreOptions, type ClaimStorePort } from "./ads-claim-store";
import {
  SqliteEvidenceEdgeStore,
  type EvidenceEdgeStoreOptions,
  type EvidenceEdgeStorePort,
} from "./ads-evidence-edge-store";
import {
  SqliteReviewSignalStore,
  type ReviewSignalStoreOptions,
  type ReviewSignalStorePort,
} from "./ads-review-signal-store";

/**
 * The durable Ad Center store bundle (P5-STORES row 2): one adapter per
 * `ad_*` table family over ONE profile-scoped database handle (the
 * createIntelligenceStores precedent). Per-profile isolation is STRUCTURAL
 * (ADR-0003): every adapter below binds to the single handle handed in
 * here, and openStore mints one store per profile directory — no adapter
 * ever crosses profiles, no ad_* row ever leaves this profile's database.
 *
 * SEPARATION (phase5-ad-plan §3), stated structurally: these stores and
 * their tables are the ads lane's OWN — they import nothing from any
 * intelligence/ranking module (the imports above are the contracts
 * package's ads schemas and this lane's own db adapter + checksum helper
 * ONLY), they never JOIN across the ad/intelligence boundary, and no
 * catalog/intelligence table references them or is referenced by them. The
 * architecture-check `ads-separation` rule pins the import direction; the
 * schema pins the data direction.
 *
 * NOT composition-root wiring: connecting these adapters to the
 * application layer's ads.import use case is a later order's scope — both
 * sides are structurally typed port mirrors, so wiring is assignment.
 */
export interface AdsStores {
  /** AdvertiserIdentity rows (`ad_identities`): put-replaces, typed absent. */
  readonly identities: AdvertiserIdentityStorePort;
  /** AdRecord rows (`ad_records`): put-replaces by id + the version query. */
  readonly records: AdRecordStorePort;
  /** Claim rows (`ad_claims`): put-replaces by id + the by-record listing. */
  readonly claims: ClaimStorePort;
  /** EvidenceLink rows (`ad_evidence_edges`): append-only, idempotent-by-id. */
  readonly evidenceEdges: EvidenceEdgeStorePort;
  /** ReviewSignal rows (`ad_review_signals`): append-only, idempotent-by-id. */
  readonly reviewSignals: ReviewSignalStorePort;
}

/** Options shared by every ads store adapter (the injectable clock). */
export type AdsStoreOptions = AdvertiserIdentityStoreOptions &
  AdRecordStoreOptions &
  ClaimStoreOptions &
  EvidenceEdgeStoreOptions &
  ReviewSignalStoreOptions;

/** Creates the five durable ads stores over ONE profile-scoped db handle. */
export function createAdsStores(db: SqliteDatabase, options: AdsStoreOptions = {}): AdsStores {
  return {
    identities: new SqliteAdvertiserIdentityStore(db, options),
    records: new SqliteAdRecordStore(db, options),
    claims: new SqliteClaimStore(db, options),
    evidenceEdges: new SqliteEvidenceEdgeStore(db, options),
    reviewSignals: new SqliteReviewSignalStore(db, options),
  };
}
