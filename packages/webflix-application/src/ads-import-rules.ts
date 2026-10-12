/**
 * The pure Ad Center import RULES (P5-STORES row 3) — the decision core
 * the ads.import §2.6 use case (./ads-import.ts) rides, the
 * evaluation-replay precedent carried into the ads lane: no I/O, no clock,
 * no globals; every rule is a pure function over its arguments, stated as
 * DATA (typed outcomes and decisions, never thrown control flow — the one
 * sanctioned exception is the pre-job batch-shape validation, which throws
 * the typed caller-defect error exactly as the generate-recommendations
 * precedent does).
 *
 * The charter's version rule lives here, made literal and pure:
 * - same source id + same batch => REPLACE (the incoming record replaces
 *   the same-batch prior rows; the superseded ids are listed explicitly —
 *   the caller deletes them through the store, never a silent cascade);
 * - same source id + different batch => a NEW VERSION APPENDED with its
 *   own provenance (prior versions stay untouched);
 * - a record id naming a stored record from a different batch or a
 *   different (source, sourceAdId) => REJECT (history is never silently
 *   overwritten: mint a new id for a new version);
 * - a record with NO sourceAdId carries no matchable source identity —
 *   keyed by id alone (same batch = replace, different batch = reject);
 *   no dedup magic without a source id.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { AdRecord } from "webflix-contracts";
import type { ImportAdsInput } from "./ads-import";

/** Which batch array an outcome belongs to. */
export type AdsImportItemKind = "identity" | "record" | "claim" | "review-signal";

/** The honest disposition of an accepted item. */
export type AdsImportDisposition =
  /** No prior row for the id. */
  | "inserted"
  /** A same-batch prior row was replaced wholesale (the replace rule). */
  | "replaced"
  /** Prior versions from OTHER batches stay; this row is a NEW version. */
  | "version-appended"
  /** Append-only store: first append of the id. */
  | "appended"
  /** Append-only store: idempotent re-append (the stored one won). */
  | "duplicate";

export interface AdsImportAccepted {
  readonly outcome: "accepted";
  readonly kind: AdsImportItemKind;
  /** The item's index within its batch array. */
  readonly index: number;
  readonly id: string;
  readonly disposition: AdsImportDisposition;
}

export interface AdsImportRejected {
  readonly outcome: "rejected";
  readonly kind: AdsImportItemKind;
  /** The item's index within its batch array. */
  readonly index: number;
  /** The item's id when the shape carried one; null when it did not parse. */
  readonly id: string | null;
  /** The typed ads/* code the item failed with. */
  readonly code: ErrorCode;
  readonly reason: string;
}

/** The per-record outcome union (accepted | rejected-with-reason). */
export type AdsImportItemOutcome = AdsImportAccepted | AdsImportRejected;

/** The honest batch report: per-item outcomes + counts that add up. */
export interface AdsImportReport {
  readonly importBatchId: string;
  readonly outcomes: readonly AdsImportItemOutcome[];
  readonly counts: {
    readonly accepted: number;
    readonly rejected: number;
    readonly total: number;
  };
}

/**
 * The record-persistence decision (the charter's version rule, pure): what
 * to do with ONE validated incoming record given the store's facts —
 * reject it typed, or persist it with the disposition and the list of
 * same-batch ids it supersedes (the caller deletes those EXPLICITLY).
 */
export type RecordImportDecision =
  | { readonly outcome: "reject"; readonly reason: string }
  | {
      readonly outcome: "persist";
      readonly disposition: AdsImportDisposition;
      readonly supersededIds: readonly string[];
    };

/**
 * Decides one record's persistence against the store facts: the row
 * currently stored under the record's own id (if any) and the version
 * history of its (source, sourceAdId) identity split by batch. Pure — the
 * use case gathers the facts and applies the decision.
 */
export function decideRecordImport(input: {
  readonly record: AdRecord;
  readonly batchId: string;
  readonly storedById: AdRecord | undefined;
  readonly sameBatchPriors: readonly AdRecord[];
  readonly otherBatchPriors: readonly AdRecord[];
}): RecordImportDecision {
  const { record, batchId, storedById, sameBatchPriors, otherBatchPriors } = input;
  if (record.sourceAdId === undefined) {
    // No matchable source identity: keyed by id alone (no dedup magic).
    if (storedById === undefined) {
      return { outcome: "persist", disposition: "inserted", supersededIds: [] };
    }
    if (storedById.provenance.importBatchId !== batchId) {
      return {
        outcome: "reject",
        reason:
          `record id "${record.id}" is stored from batch "${storedById.provenance.importBatchId}" ` +
          `and arrives in batch "${batchId}" — history is never silently overwritten; ` +
          "mint a new id for a new version",
      };
    }
    return { outcome: "persist", disposition: "replaced", supersededIds: [] };
  }
  if (storedById !== undefined && !sameBatchPriors.some((prior) => prior.id === record.id)) {
    return {
      outcome: "reject",
      reason:
        `record id "${record.id}" is stored from batch "${storedById.provenance.importBatchId}" ` +
        `and arrives claiming (${record.provenance.source}, ${record.sourceAdId}) in batch "${batchId}" — ` +
        "history is never silently overwritten: an id never migrates between ads or batches; " +
        "mint a new id for a new version",
    };
  }
  const supersededIds = sameBatchPriors.filter((prior) => prior.id !== record.id).map((p) => p.id);
  const disposition =
    sameBatchPriors.length > 0
      ? "replaced"
      : otherBatchPriors.length > 0
        ? "version-appended"
        : "inserted";
  return { outcome: "persist", disposition, supersededIds };
}

// ---------------------------------------------------------------------------
// Outcome constructors + item helpers
// ---------------------------------------------------------------------------

/** The accepted-outcome constructor. */
export function adsImportAccepted(
  kind: AdsImportItemKind,
  index: number,
  id: string,
  disposition: AdsImportDisposition,
): AdsImportAccepted {
  return { outcome: "accepted", kind, index, id, disposition };
}

/** The rejected-outcome constructor. */
export function adsImportRejected(
  kind: AdsImportItemKind,
  index: number,
  id: string | null,
  code: ErrorCode,
  reason: string,
): AdsImportRejected {
  return { outcome: "rejected", kind, index, id, code, reason };
}

/** The best-effort id of a malformed item (null when unreadable). */
export function adsImportItemId(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** True for the ads/*-absent codes (the typed-absent family). */
export function isAdsAbsentCode(code: ErrorCode): boolean {
  return (
    code === ErrorCode.AdsIdentityAbsent ||
    code === ErrorCode.AdsRecordAbsent ||
    code === ErrorCode.AdsClaimAbsent ||
    code === ErrorCode.AdsEvidenceAbsent ||
    code === ErrorCode.AdsReviewSignalAbsent
  );
}

// ---------------------------------------------------------------------------
// Pre-job batch-shape validation (caller defects — the one throwing rule)
// ---------------------------------------------------------------------------

/**
 * Pre-job batch-shape validation (caller defects, typed ads/record-invalid,
 * thrown BEFORE the job exists): a non-blank batch id, no duplicate ids
 * within any one array, and every provenance-carrying item (records, review
 * signals) must carry THE batch's id. Returns the validated batch id.
 */
export function validateAdsImportBatch(input: ImportAdsInput): string {
  if (typeof input.importBatchId !== "string" || input.importBatchId.trim().length === 0) {
    throw new WebFlixError({
      code: ErrorCode.AdsRecordInvalid,
      reason: "importBatchId must be a non-blank string — every import mints one batch id",
      retryable: false,
      context: { subject: "ImportAdsInput.importBatchId" },
    });
  }
  const duplicateIn = (items: readonly { readonly id?: unknown }[]): string | null => {
    const seen = new Set<string>();
    for (const item of items) {
      if (typeof item.id !== "string") continue;
      if (seen.has(item.id)) return item.id;
      seen.add(item.id);
    }
    return null;
  };
  for (const [items, what] of [
    [input.identities, "identities"],
    [input.records, "records"],
    [input.claims, "claims"],
    [input.reviewSignals ?? [], "reviewSignals"],
  ] as const) {
    const duplicate = duplicateIn(items);
    if (duplicate !== null) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `the batch names id "${duplicate}" twice within ${what} — a batch that names one id twice is ambiguous`,
        retryable: false,
        context: { subject: `ImportAdsInput.${what}`, duplicateId: duplicate },
      });
    }
  }
  for (const record of input.records) {
    if (
      typeof record === "object" &&
      record !== null &&
      record.provenance?.importBatchId !== input.importBatchId
    ) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `record "${String(record.id)}" carries batch "${String(record.provenance?.importBatchId)}" but arrives in batch "${input.importBatchId}" — every import is one batch`,
        retryable: false,
        context: { subject: "ImportAdsInput.records", recordId: String(record.id) },
      });
    }
  }
  for (const signal of input.reviewSignals ?? []) {
    if (
      typeof signal === "object" &&
      signal !== null &&
      signal.provenance?.importBatchId !== input.importBatchId
    ) {
      throw new WebFlixError({
        code: ErrorCode.AdsRecordInvalid,
        reason: `review signal "${String(signal.id)}" carries batch "${String(signal.provenance?.importBatchId)}" but arrives in batch "${input.importBatchId}" — every import is one batch`,
        retryable: false,
        context: { subject: "ImportAdsInput.reviewSignals", signalId: String(signal.id) },
      });
    }
  }
  return input.importBatchId;
}
