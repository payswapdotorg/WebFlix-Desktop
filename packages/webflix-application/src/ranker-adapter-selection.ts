/**
 * Ranker-adapter selection use cases (P4-ADAPTERS rows 1-2 application side;
 * phase4-mi-plan §6: user-selected adapters — never a hidden default).
 *
 * The selection is the user's explicit, persistent, per-profile choice of a
 * ranker adapter id (RankerAdapterSelection, contracts 0.3.0). Semantics,
 * stated honestly:
 *
 * - SET: only registry-known ids are selectable — an unknown id is a caller
 *   defect and THROWS the typed IntelligenceAdapterSelectionInvalid error
 *   (hard fail at the boundary where the mistake is made).
 * - RESOLVE: (registry + stored selection) => the adapter that will actually
 *   rank, plus resolution metadata that states WHY:
 *     - no selection stored  => the documented DEFAULT (built-in-v1), said so;
 *     - a valid selection    => that adapter;
 *     - an unknown stored id (registry drift — e.g. an adapter a later order
 *       removed) => HONEST fail-soft: the typed error is SURFACED in the
 *       resolution metadata and the built-in-v1 default is returned — never
 *       a silent switch (the documented choice; rethrow the surfaced error
 *       if your caller needs a hard failure instead).
 * - CLEAR: deleting the selection resets to the documented default — an
 *   honest reset, never an error state (null = "no selection set", which is
 *   DISTINCT from explicitly selecting the built-in).
 *
 * Ports: RankerSelectionStore below (in-memory default here; the DURABLE
 * per-profile adapter lives on the local-library storage seam — additive
 * migration 0003, the 0002 rules — exported there for the composition
 * root; wiring is explicitly a later order). No network, no randomness, no
 * telemetry: the only stamp is the injected clock's selectedAt (an explicit
 * user action, never inferred).
 */
import { ErrorCode, RankerAdapterSelectionSchema, WebFlixError } from "webflix-contracts";
import type { RankerAdapterSelection } from "webflix-contracts";
import { parseOrThrow } from "webflix-domain";
import type { ClockPort } from "./ports";
import { BUILT_IN_RANKER_ID } from "./built-in-ranker";
import type { RankerAdapterEntry, RankerAdapterRegistry } from "./ranker-adapter-registry";
import { DEFAULT_RANKER_ADAPTER_REGISTRY } from "./ranker-adapter-registry";

/** The documented default adapter id (the built-in deterministic ranker). */
const DEFAULT_BUILT_IN_ID = BUILT_IN_RANKER_ID;

// ---------------------------------------------------------------------------
// Port — the per-profile selection store (in-memory default below; the
// durable sqlite adapter ships on the local-library seam)
// ---------------------------------------------------------------------------

/**
 * Per-profile ranker-adapter selection store. `put` replaces the selection
 * wholesale (the CURRENT choice — one selection per profile, ADR-0003);
 * `clear` deletes it (back to never-set); implementations MUST validate the
 * record shape on write and read (corrupt persistence surfaces as a typed
 * WebFlixError, never a silently-mangled record).
 */
export interface RankerSelectionStore {
  /** The stored selection, or null when the user never set one. */
  get(): Promise<RankerAdapterSelection | null>;
  put(selection: RankerAdapterSelection): Promise<void>;
  /** Deletes the selection; true when one existed. */
  clear(): Promise<boolean>;
}

/** In-memory RankerSelectionStore (NOT durable — the pure-test default). */
export class InMemoryRankerSelectionStore implements RankerSelectionStore {
  private selection: RankerAdapterSelection | null = null;

  async get(): Promise<RankerAdapterSelection | null> {
    return this.selection;
  }

  async put(selection: RankerAdapterSelection): Promise<void> {
    // Same defensive write validation as the durable adapter: the shape is
    // re-checked through the locked schema before it is accepted.
    this.selection = parseOrThrow(
      RankerAdapterSelectionSchema,
      selection,
      ErrorCode.IntelligenceAdapterSelectionInvalid,
      "RankerAdapterSelection",
    );
  }

  async clear(): Promise<boolean> {
    const existed = this.selection !== null;
    this.selection = null;
    return existed;
  }
}

// ---------------------------------------------------------------------------
// Set / Clear use cases
// ---------------------------------------------------------------------------

export interface SetRankerAdapterSelectionDeps {
  /** The registry the selection is validated against. */
  readonly registry: RankerAdapterRegistry;
  readonly store: RankerSelectionStore;
  readonly clock: ClockPort;
}

/**
 * Sets the user's explicit ranker-adapter selection. Registry-known ids
 * only: an unknown id throws IntelligenceAdapterSelectionInvalid (a caller
 * defect at the boundary — the fail-soft path belongs to RESOLVE, where
 * registry drift is a runtime condition, not a programming mistake).
 * `selectedAt` is stamped from the injected clock (explicit user action).
 */
export class SetRankerAdapterSelection {
  constructor(private readonly deps: SetRankerAdapterSelectionDeps) {}

  async set(adapterId: string): Promise<RankerAdapterSelection> {
    const known = this.deps.registry.get(adapterId);
    if (known === null) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceAdapterSelectionInvalid,
        reason: `unknown ranker adapter id "${adapterId}" — only registry-known ids are selectable`,
        retryable: false,
        context: {
          requestedAdapterId: adapterId,
          registryIds: this.deps.registry.list().map((entry) => entry.id),
        },
      });
    }
    const selection: RankerAdapterSelection = {
      adapterId: known.id,
      selectedAt: this.deps.clock.now().toISOString(),
    };
    const validated = parseOrThrow(
      RankerAdapterSelectionSchema,
      selection,
      ErrorCode.IntelligenceAdapterSelectionInvalid,
      "RankerAdapterSelection",
    );
    await this.deps.store.put(validated);
    return validated;
  }
}

export interface ClearRankerAdapterSelectionDeps {
  readonly store: RankerSelectionStore;
}

/**
 * Deletes the selection — an honest reset to the documented default, never
 * an error state. Resolving afterwards reports `default` (no selection set).
 */
export class ClearRankerAdapterSelection {
  constructor(private readonly deps: ClearRankerAdapterSelectionDeps) {}

  async clear(): Promise<boolean> {
    return this.deps.store.clear();
  }
}

// ---------------------------------------------------------------------------
// ResolveSelectedRanker — the use case rows 4-6 build on
// ---------------------------------------------------------------------------

/**
 * Why the resolved adapter is the one returned:
 * - `default`:  no selection is stored — the DOCUMENTED default (built-in-v1)
 *   is active, and the resolution says so (never a hidden default);
 * - `selected`: the stored selection is registry-known — the user's choice;
 * - `fallback`: the stored selection references an id the registry no longer
 *   knows (registry drift). HONEST fail-soft: the typed error is surfaced
 *   here (as data — the documented choice is fail-soft, never a silent
 *   switch) while the built-in default is returned for use.
 */
export type RankerSelectionResolution =
  | { readonly kind: "default"; readonly note: string }
  | { readonly kind: "selected"; readonly selection: RankerAdapterSelection }
  | {
      readonly kind: "fallback";
      readonly requestedAdapterId: string;
      /** The typed, surfaced error — rethrow it if a hard failure is needed. */
      readonly error: WebFlixError;
    };

/** What resolveSelectedRanker returns: the active adapter + the WHY. */
export interface ResolvedRanker {
  /** The adapter that will actually rank (built-in-v1 on default/fallback). */
  readonly adapter: RankerAdapterEntry;
  readonly resolution: RankerSelectionResolution;
}

export interface ResolveSelectedRankerDeps {
  /** Defaults to the static default registry (the documented default). */
  readonly registry?: RankerAdapterRegistry;
  readonly store: RankerSelectionStore;
}

const DEFAULT_NOTE =
  "No ranker adapter is selected — the documented default (the built-in deterministic ranker v1) is active.";

/**
 * Resolves the adapter that should rank for this profile, with honest
 * resolution metadata (see RankerSelectionResolution). Defaults to the
 * static default registry when none is injected (the documented default
 * registry; tests and the composition root may inject their own).
 */
export class ResolveSelectedRanker {
  private readonly registry: RankerAdapterRegistry;

  constructor(private readonly deps: ResolveSelectedRankerDeps) {
    this.registry = deps.registry ?? DEFAULT_RANKER_ADAPTER_REGISTRY;
  }

  async resolve(): Promise<ResolvedRanker> {
    const selection = await this.deps.store.get();
    if (selection === null) {
      const fallback = this.registry.get(DEFAULT_BUILT_IN_ID) ?? this.firstEntry();
      return { adapter: fallback, resolution: { kind: "default", note: DEFAULT_NOTE } };
    }
    const entry = this.registry.get(selection.adapterId);
    if (entry !== null) {
      return { adapter: entry, resolution: { kind: "selected", selection } };
    }
    // Registry drift: fail-soft with the typed error SURFACED (never silent).
    const requested = selection.adapterId;
    const error = new WebFlixError({
      code: ErrorCode.IntelligenceAdapterSelectionInvalid,
      reason: `the selected ranker adapter "${requested}" is no longer available (registry drift) — falling back to the built-in default`,
      retryable: false,
      context: {
        requestedAdapterId: requested,
        registryIds: this.registry.list().map((known) => known.id),
      },
    });
    const fallback = this.registry.get(DEFAULT_BUILT_IN_ID) ?? this.firstEntry();
    return {
      adapter: fallback,
      resolution: { kind: "fallback", requestedAdapterId: requested, error },
    };
  }

  /**
   * The built-in id is the documented default. A registry that does not
   * carry it is possible for INJECTED registries (tests); the honest
   * behavior is then the registry's first entry — the static default
   * registry always carries the built-in (pinned by tests).
   */
  private firstEntry(): RankerAdapterEntry {
    const entries = this.registry.list();
    const head = entries[0];
    if (head === undefined) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceAdapterSelectionInvalid,
        reason: "the ranker-adapter registry is empty — no adapter can be resolved",
        retryable: false,
        context: {},
      });
    }
    return head;
  }
}
