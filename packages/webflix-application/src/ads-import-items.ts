/**
 * The per-item import steps of the ads.import seam (P5-STORES row 3) —
 * one module-level async function per batch kind (identity / record /
 * claim / review signal), each taking the store deps and returning the
 * item's typed outcome. Extracted from ./ads-import.ts (the §2.6 job
 * wrapper) so neither module exceeds the lane's file-size discipline —
 * the split mirrors the house evaluation-replay / mi-evaluate division:
 * the job wrapper owns the descriptor + checkpoints, these functions own
 * validate -> referential-checks -> persist for ONE item.
 *
 * Honesty rules these functions enforce (stated as DATA in the outcomes —
 * a rejected item is the report's content, never a thrown control flow):
 * - SHAPE validation through the 0.8.0 schemas (typed ads/*-invalid codes);
 * - SEAM-LEVEL REFERENTIAL CHECKS: a record's advertiserIdentityId must
 *   resolve (batch identities already processed + stored ones — a rejected
 *   batch identity was never stored, so its records fail here, honestly);
 *   a claim's adRecordId must resolve to a STORED record;
 * - THE EXTRACTIVE DISCIPLINE for claims: the domain invariant
 *   validateClaimOffsets (offsets within the referenced record's creative
 *   text, quote byte-equal to the offset window) runs BEFORE persisting;
 * - ID STABILITY: an identity id never migrates between sources; a claim
 *   id never re-points at a different record;
 * - the RECORD VERSION RULE is the pure decision decideRecordImport
 *   (./ads-import-rules.ts) applied to the stores: superseded same-batch
 *   ids are deleted EXPLICITLY (never a silent cascade).
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { AdRecord, AdvertiserIdentity, Claim, ReviewSignal } from "webflix-contracts";
import {
  AdRecordSchema,
  AdvertiserIdentitySchema,
  ClaimSchema,
  ReviewSignalSchema,
} from "webflix-contracts";
import { validateClaimOffsets } from "webflix-domain";
import type { ImportAdsDeps } from "./ads-import";
import {
  adsImportAccepted,
  adsImportItemId,
  adsImportRejected,
  decideRecordImport,
  isAdsAbsentCode,
} from "./ads-import-rules";
import type { AdsImportItemOutcome } from "./ads-import-rules";

/** Imports ONE advertiser identity (validate -> stability -> put-replaces). */
export async function importAdsIdentity(
  deps: ImportAdsDeps,
  identity: AdvertiserIdentity,
  index: number,
): Promise<AdsImportItemOutcome> {
  const parsed = AdvertiserIdentitySchema.safeParse(identity);
  if (!parsed.success) {
    return adsImportRejected(
      "identity",
      index,
      adsImportItemId(identity),
      ErrorCode.AdsRecordInvalid,
      parsed.error.message,
    );
  }
  const stored = await tryGetIdentity(deps, parsed.data.id);
  if (stored !== undefined && stored.source !== parsed.data.source) {
    return adsImportRejected(
      "identity",
      index,
      parsed.data.id,
      ErrorCode.AdsRecordInvalid,
      `identity id "${parsed.data.id}" is stored with source "${stored.source}" but arrives claiming source "${parsed.data.source}" — an id never migrates between sources`,
    );
  }
  await deps.identities.put(parsed.data);
  return adsImportAccepted(
    "identity",
    index,
    parsed.data.id,
    stored !== undefined ? "replaced" : "inserted",
  );
}

/** Imports ONE ad record (validate -> identity resolution -> the version rule). */
export async function importAdsRecord(
  deps: ImportAdsDeps,
  record: AdRecord,
  index: number,
  batchId: string,
): Promise<AdsImportItemOutcome> {
  const parsed = AdRecordSchema.safeParse(record);
  if (!parsed.success) {
    return adsImportRejected(
      "record",
      index,
      adsImportItemId(record),
      ErrorCode.AdsRecordInvalid,
      parsed.error.message,
    );
  }
  // Seam-level referential check: the advertiser identity must resolve
  // (batch identities already processed + stored ones).
  const identity = await tryGetIdentity(deps, parsed.data.advertiserIdentityId);
  if (identity === undefined) {
    return adsImportRejected(
      "record",
      index,
      parsed.data.id,
      ErrorCode.AdsRecordInvalid,
      `record "${parsed.data.id}" references advertiser identity "${parsed.data.advertiserIdentityId}", which is not stored (rejected in this batch or never imported)`,
    );
  }
  // The charter's version rule, decided PURE then applied to the stores.
  const storedById = await tryGetRecord(deps, parsed.data.id);
  const priors =
    parsed.data.sourceAdId !== undefined
      ? await deps.records.listBySourceAdId(parsed.data.provenance.source, parsed.data.sourceAdId)
      : [];
  const decision = decideRecordImport({
    record: parsed.data,
    batchId,
    storedById,
    sameBatchPriors: priors.filter((prior) => prior.provenance.importBatchId === batchId),
    otherBatchPriors: priors.filter((prior) => prior.provenance.importBatchId !== batchId),
  });
  if (decision.outcome === "reject") {
    return adsImportRejected(
      "record",
      index,
      parsed.data.id,
      ErrorCode.AdsRecordInvalid,
      decision.reason,
    );
  }
  await deps.records.put(parsed.data);
  for (const supersededId of decision.supersededIds) {
    await deps.records.delete(supersededId);
  }
  return adsImportAccepted("record", index, parsed.data.id, decision.disposition);
}

/** Imports ONE claim (validate -> stability -> record resolution -> the extractive discipline). */
export async function importAdsClaim(
  deps: ImportAdsDeps,
  claim: Claim,
  index: number,
): Promise<AdsImportItemOutcome> {
  const parsed = ClaimSchema.safeParse(claim);
  if (!parsed.success) {
    return adsImportRejected(
      "claim",
      index,
      adsImportItemId(claim),
      ErrorCode.AdsClaimInvalid,
      parsed.error.message,
    );
  }
  const stored = await tryGetClaim(deps, parsed.data.id);
  if (stored !== undefined && stored.adRecordId !== parsed.data.adRecordId) {
    return adsImportRejected(
      "claim",
      index,
      parsed.data.id,
      ErrorCode.AdsClaimInvalid,
      `claim id "${parsed.data.id}" is stored against record "${stored.adRecordId}" but arrives against record "${parsed.data.adRecordId}" — a claim id never re-points at a different record`,
    );
  }
  const record = await tryGetRecord(deps, parsed.data.adRecordId);
  if (record === undefined) {
    return adsImportRejected(
      "claim",
      index,
      parsed.data.id,
      ErrorCode.AdsClaimInvalid,
      `claim "${parsed.data.id}" references record "${parsed.data.adRecordId}", which is not stored (rejected in this batch or never imported)`,
    );
  }
  // THE EXTRACTIVE DISCIPLINE (the domain invariant, run before persisting):
  // offsets within the referenced record's creative text + quote
  // byte-equal to the offset window — a claim the source did not state is
  // a defect.
  const violations = validateClaimOffsets(parsed.data, record);
  if (violations.length > 0) {
    const violation = violations[0]!;
    return adsImportRejected(
      "claim",
      index,
      parsed.data.id,
      ErrorCode.AdsClaimInvalid,
      `claim "${parsed.data.id}" violates the extractive discipline (${violation.code}): ${violation.message}`,
    );
  }
  await deps.claims.put(parsed.data);
  return adsImportAccepted(
    "claim",
    index,
    parsed.data.id,
    stored !== undefined ? "replaced" : "inserted",
  );
}

/** Imports ONE review signal (validate -> batch check -> idempotent append). */
export async function importAdsReviewSignal(
  deps: ImportAdsDeps,
  signal: ReviewSignal,
  index: number,
  batchId: string,
): Promise<AdsImportItemOutcome> {
  const parsed = ReviewSignalSchema.safeParse(signal);
  if (!parsed.success) {
    return adsImportRejected(
      "review-signal",
      index,
      adsImportItemId(signal),
      ErrorCode.AdsRecordInvalid,
      parsed.error.message,
    );
  }
  if (parsed.data.provenance.importBatchId !== batchId) {
    return adsImportRejected(
      "review-signal",
      index,
      parsed.data.id,
      ErrorCode.AdsRecordInvalid,
      `review signal "${parsed.data.id}" carries batch "${parsed.data.provenance.importBatchId}" but arrives in batch "${batchId}" — every import is one batch`,
    );
  }
  const appended = await deps.reviewSignals.append(parsed.data);
  return adsImportAccepted("review-signal", index, parsed.data.id, appended.outcome);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Typed-absent-aware gets: undefined when the id is not stored. */
async function tryGetIdentity(
  deps: ImportAdsDeps,
  id: string,
): Promise<AdvertiserIdentity | undefined> {
  try {
    return await deps.identities.get(id);
  } catch (err) {
    if (WebFlixError.is(err) && isAdsAbsentCode(err.code)) return undefined;
    throw err;
  }
}

async function tryGetRecord(deps: ImportAdsDeps, id: string): Promise<AdRecord | undefined> {
  try {
    return await deps.records.get(id);
  } catch (err) {
    if (WebFlixError.is(err) && isAdsAbsentCode(err.code)) return undefined;
    throw err;
  }
}

async function tryGetClaim(deps: ImportAdsDeps, id: string): Promise<Claim | undefined> {
  try {
    return await deps.claims.get(id);
  } catch (err) {
    if (WebFlixError.is(err) && isAdsAbsentCode(err.code)) return undefined;
    throw err;
  }
}
