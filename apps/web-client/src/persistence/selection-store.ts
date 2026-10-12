/**
 * P6-DURABLE-WEB-1 — the DURABLE ranker-selection store: the typed
 * IndexedDB adapter implementing the host's EXISTING store-persistence
 * interface — webflix-application's RankerSelectionStore (the same
 * interface the session-only mode's InMemoryRankerSelectionStore
 * implements) — AS-IS, with zero interface changes and zero forked shapes
 * (contracts stay 0.11.0; no application/domain/shell file is touched).
 *
 * Validation law (mirroring the application layer's in-memory store
 * exactly): every record is re-validated through the contracts' own locked
 * zod schema on write AND on read — a corrupt persisted record surfaces as
 * a typed WebFlixError (IntelligenceAdapterSelectionInvalid), never a
 * silently-mangled record. The helper below replicates webflix-domain's
 * parseOrThrow semantics using only webflix-contracts exports (the host's
 * registered architecture requires list — contracts + application).
 */

import { ErrorCode, RankerAdapterSelectionSchema, WebFlixError } from "webflix-contracts";
import type { RankerAdapterSelection } from "webflix-contracts";
import type { RankerSelectionStore } from "webflix-application";

import {
  RANKER_SELECTION_KEY,
  RANKER_SELECTION_STORE,
  requestToPromise,
  transactionDone,
} from "./idb";

/** Re-validates through the locked contract schema — a corrupt record throws the typed WebFlixError. */
function validateSelection(raw: unknown): RankerAdapterSelection {
  try {
    return RankerAdapterSelectionSchema.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid input";
    const context: Record<string, unknown> = { subject: "RankerAdapterSelection" };
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues)) context.issues = issues;
    throw new WebFlixError({
      code: ErrorCode.IntelligenceAdapterSelectionInvalid,
      reason: `RankerAdapterSelection: ${detail}`,
      retryable: false,
      context,
    });
  }
}

/**
 * The durable ranker-selection store: IndexedDB-backed, one singleton
 * record (out-of-line key "current") in the versioned persistence
 * database. Implements the host's existing store interface unchanged —
 * the composition root swaps this in for the in-memory double when the
 * durable mode is active.
 */
export class DurableRankerSelectionStore implements RankerSelectionStore {
  constructor(private readonly db: IDBDatabase) {}

  async get(): Promise<RankerAdapterSelection | null> {
    const tx = this.db.transaction(RANKER_SELECTION_STORE, "readonly");
    const raw = await requestToPromise(
      tx.objectStore(RANKER_SELECTION_STORE).get(RANKER_SELECTION_KEY),
    );
    if (raw === undefined || raw === null) {
      return null;
    }
    return validateSelection(raw);
  }

  async put(selection: RankerAdapterSelection): Promise<void> {
    const validated = validateSelection(selection);
    const tx = this.db.transaction(RANKER_SELECTION_STORE, "readwrite");
    tx.objectStore(RANKER_SELECTION_STORE).put(validated, RANKER_SELECTION_KEY);
    await transactionDone(tx);
  }

  async clear(): Promise<boolean> {
    const existed = await this.get();
    const tx = this.db.transaction(RANKER_SELECTION_STORE, "readwrite");
    tx.objectStore(RANKER_SELECTION_STORE).delete(RANKER_SELECTION_KEY);
    await transactionDone(tx);
    return existed !== null;
  }
}
