/**
 * P6-DURABLE-WEB-1 — the MODE-ROUTING ranker-selection store (host code).
 *
 * ONE RankerSelectionStore — the host's existing seam, UNCHANGED (the
 * application layer's use cases keep taking the same interface; zero
 * application/domain/shell changes) — that routes by the ACTIVE
 * persistence mode, seen live through the injected getMode():
 * - session-only: the in-memory double only (nothing durable is touched —
 *   the sqlite law's web complement, now mode-scoped);
 * - durable: write-through BOTH stores (the durable record IS the
 *   persistence; the in-memory copy keeps the live session coherent),
 *   reads from the durable record.
 *
 * A runtime mode flip is seen on the NEXT call — no store reconstruction,
 * no use-case rewiring, no interface change (this is the composition the
 * work order's "behind the existing interface" clause asks for).
 */

import type { RankerAdapterSelection } from "webflix-contracts";
import type { RankerSelectionStore } from "webflix-application";

import type { PersistenceMode } from "./mode";

export interface ModeRoutingRankerSelectionStoreDeps {
  /** The session-only in-memory double (the live session state, always coherent). */
  readonly memory: RankerSelectionStore;
  /** The durable adapter when IndexedDB opened (null when degraded — routing stays in-memory). */
  readonly durable: RankerSelectionStore | null;
  /** Reads the ACTIVE mode at call time (live — flips are seen on the next call). */
  readonly getMode: () => PersistenceMode;
}

/** The mode-routing store: the host's one selection seam, routed by the active persistence mode. */
export class ModeRoutingRankerSelectionStore implements RankerSelectionStore {
  private readonly deps: ModeRoutingRankerSelectionStoreDeps;

  constructor(deps: ModeRoutingRankerSelectionStoreDeps) {
    this.deps = deps;
  }

  private durableActive(): boolean {
    return this.deps.getMode() === "durable" && this.deps.durable !== null;
  }

  async get(): Promise<RankerAdapterSelection | null> {
    return this.durableActive() ? (this.deps.durable?.get() ?? null) : this.deps.memory.get();
  }

  async put(selection: RankerAdapterSelection): Promise<void> {
    // The live session state stays coherent in every mode.
    await this.deps.memory.put(selection);
    if (this.durableActive() && this.deps.durable !== null) {
      await this.deps.durable.put(selection);
    }
  }

  async clear(): Promise<boolean> {
    const memoryCleared = await this.deps.memory.clear();
    if (!this.durableActive() || this.deps.durable === null) {
      return memoryCleared;
    }
    const durableCleared = await this.deps.durable.clear();
    return memoryCleared || durableCleared;
  }
}
