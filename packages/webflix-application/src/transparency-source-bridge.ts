/**
 * The transparency-source IMPORT BRIDGE (P5-SOURCES scope row 4) — the
 * mapping that carries a source's ok-result observations into the
 * P5-STORES ads.import seam, UNCHANGED. When an adapter DOES become
 * authorized (a later order wires its real transport), its observations
 * flow through the existing import seam exactly as this mapping
 * constructs them: the source-reported fields land in the stored
 * records byte-equal (creativeText/creativeUrls/regions/periods/
 * sourceAdId/observedAt — pinned by the mapping test); the Ad Center's
 * own fields are minted HERE and ONLY here:
 *
 * - AdvertiserIdentity.id and AdRecord.id — minted from the injected
 *   id generator, ONE identity + ONE record per observation, in
 *   observation order (identity first, then its record — the
 *   deterministic minting order the mapping test pins);
 * - provenance.source — the manifest's source id (the id space the
 *   whole lane shares: `meta-ad-library`, …);
 * - provenance.observedAt — the observation's OWN reported instant
 *   (absent stays absent); the identity's reportedAt carries the SAME
 *   exposure instant the identity report rode (documented mapping, not
 *   a guess — the source reported both in one exposure);
 * - provenance.importedAt + importBatchId — the caller's import stamps
 *   (the bridge takes them as inputs; ads.import mints its own batch
 *   identity around them).
 *
 * HONEST NON-MERGING: the bridge performs NO identity dedup — two
 * observations reporting the same advertiser yield two identity rows,
 * because deciding "same advertiser" from names/ids is an
 * identity-equality judgment this order does not make (the import
 * seam's own id-stability rules apply once stored; a later composition
 * order may add a merge policy additively). The bridge emits NO claims
 * (claim extraction is the P5-CLAIMS step over the STORED records, not
 * the bridge's) and NO review signals (a transparency source reports
 * ads, not independent reviews).
 *
 * Pure function discipline: the observations array is READ, never
 * mutated (deep-equal pinned by test); every output identity + record
 * is schema-validated before the batch is returned (the every-minted-
 * record-revalidated discipline).
 */
import {
  AdRecordSchema,
  AdvertiserIdentitySchema,
  ErrorCode,
  TransparencyObservationSchema,
  WebFlixError,
} from "webflix-contracts";
import type { AdRecord, AdvertiserIdentity, TransparencyObservation } from "webflix-contracts";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

/** The id-minting dependency (the ads.import seam's generateId shape). */
export type MintSourceRecordId = () => string;

/** The bridge's inputs: what the source reported + our own import stamps. */
export interface MapObservationsToImportBatchInput {
  /** The source id (the manifest's — becomes every record's provenance.source). */
  readonly source: string;
  /** The ok-result observations to carry into the import seam. */
  readonly observations: readonly TransparencyObservation[];
  /** The import batch id (ours; every provenance row carries it). */
  readonly importBatchId: string;
  /** The import instant (ours; every provenance row carries it). */
  readonly importedAt: string;
  /** Mints the Ad Center's own ids: per observation, identity first then record. */
  readonly generateId: MintSourceRecordId;
}

/**
 * The import-batch fragment the bridge emits — the identities + records
 * arrays of an ImportAdsInput (the caller adds claims — the bridge emits
 * none — and the batch id it already supplied).
 */
export interface TransparencyImportBatch {
  readonly identities: readonly AdvertiserIdentity[];
  readonly records: readonly AdRecord[];
}

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

/**
 * Maps ok-result observations into the ads.import input shape. Throws
 * the typed ads/source-invalid error on a malformed input (blank source
 * or batch id, a non-ISO importedAt, an observation that fails the
 * TransparencyObservation contract shape) — the caller-defect surface.
 */
export function mapObservationsToImportBatch(
  input: MapObservationsToImportBatchInput,
): TransparencyImportBatch {
  if (typeof input.source !== "string" || input.source.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "the import bridge needs a non-blank source id (the manifest's source)",
      retryable: false,
      context: { subject: "MapObservationsToImportBatchInput.source" },
    });
  }
  if (typeof input.importBatchId !== "string" || input.importBatchId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "the import bridge needs a non-blank importBatchId (ours, minted per import)",
      retryable: false,
      context: { subject: "MapObservationsToImportBatchInput.importBatchId" },
    });
  }
  if (typeof input.importedAt !== "string" || Number.isNaN(Date.parse(input.importedAt))) {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "the import bridge needs an ISO-8601 importedAt instant",
      retryable: false,
      context: { subject: "MapObservationsToImportBatchInput.importedAt" },
    });
  }
  if (typeof input.generateId !== "function") {
    throw new WebFlixError({
      code: ErrorCode.AdsSourceInvalid,
      reason: "the import bridge needs an id generator (the ads.import seam's shape)",
      retryable: false,
      context: { subject: "MapObservationsToImportBatchInput.generateId" },
    });
  }

  const identities: AdvertiserIdentity[] = [];
  const records: AdRecord[] = [];
  for (const [index, raw] of input.observations.entries()) {
    const observation = TransparencyObservationSchema.safeParse(raw);
    if (!observation.success) {
      throw new WebFlixError({
        code: ErrorCode.AdsSourceInvalid,
        reason:
          `observation at index ${index} fails the TransparencyObservation contract shape: ` +
          observation.error.issues.map((issue) => issue.message).join("; "),
        retryable: false,
        context: { subject: "MapObservationsToImportBatchInput.observations", index },
      });
    }
    const reported = observation.data;

    // One identity + one record per observation, identity id minted first.
    const identityId = input.generateId();
    const identity: AdvertiserIdentity = {
      id: identityId,
      source: input.source,
      ...(reported.advertiser.sourceAdvertiserId !== undefined
        ? { sourceAdvertiserId: reported.advertiser.sourceAdvertiserId }
        : {}),
      ...(reported.advertiser.names !== undefined ? { names: reported.advertiser.names } : {}),
      ...(reported.advertiser.regions !== undefined
        ? { regions: reported.advertiser.regions }
        : {}),
      ...(reported.advertiser.verificationState !== undefined
        ? { verificationState: reported.advertiser.verificationState }
        : {}),
      // The exposure instant the identity report rode (documented mapping).
      ...(reported.observedAt !== undefined ? { reportedAt: reported.observedAt } : {}),
    };
    const record: AdRecord = {
      id: input.generateId(),
      ...(reported.sourceAdId !== undefined ? { sourceAdId: reported.sourceAdId } : {}),
      advertiserIdentityId: identityId,
      ...(reported.creativeText !== undefined ? { creativeText: reported.creativeText } : {}),
      ...(reported.creativeUrls !== undefined ? { creativeUrls: reported.creativeUrls } : {}),
      ...(reported.regions !== undefined ? { regions: reported.regions } : {}),
      ...(reported.periods !== undefined ? { periods: reported.periods } : {}),
      provenance: {
        source: input.source,
        ...(reported.observedAt !== undefined ? { observedAt: reported.observedAt } : {}),
        importedAt: input.importedAt,
        importBatchId: input.importBatchId,
      },
    };

    // Every minted row re-validated before the batch is returned (the
    // every-minted-record-revalidated discipline).
    identities.push(AdvertiserIdentitySchema.parse(identity));
    records.push(AdRecordSchema.parse(record));
  }
  return { identities, records };
}
