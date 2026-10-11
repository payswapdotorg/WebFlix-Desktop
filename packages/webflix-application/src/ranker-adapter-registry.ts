/**
 * Ranker-adapter registry (P4-ADAPTERS row 1).
 *
 * The seam rows 4-6 (transcribe/summarize/translate adapters) extend: a
 * registry of the adapter entries the USER can select between, plus the
 * static default registry. TODAY exactly ONE ranker adapter exists — the
 * built-in deterministic v1 (./built-in-ranker) — and the registry says so
 * honestly: one seeded entry, no fake model options, no placeholder rows
 * implying unshipped capability, no hidden defaults (phase4-mi-plan §6).
 *
 * Shape rules (enforced at registry construction, tested):
 * - a registry is NEVER empty (the constructor guard rejects an empty seed
 *   list — impossible-by-construction for the static default, which is a
 *   module literal);
 * - adapter ids are unique (a duplicate id would make `get` ambiguous);
 * - every entry carries a non-empty id, label and description (the selector
 *   UI renders them verbatim — no blanks, no invented copy);
 * - capabilities are presentation-truthful summaries of contract properties
 *   (deterministic / local / reasons-mandatory), NOT feature promises.
 *
 * Registry-known ids are the ONLY selectable ids: the selection use cases
 * (./ranker-adapter-selection) validate against `get` here. No network, no
 * randomness, no telemetry anywhere in this module — a registry is static
 * data plus pure lookups.
 */
import type { RankerPort } from "webflix-contracts";
import { BUILT_IN_RANKER, BUILT_IN_RANKER_ID } from "./built-in-ranker";

/**
 * Presentation metadata for one selectable ranker adapter. The label and
 * description render verbatim in the selector UI; `capabilities` is a
 * truthful summary of CONTRACT properties, not a feature promise (today:
 * deterministic, local, reasons-mandatory for the built-in v1).
 */
export interface RankerAdapterDescriptor {
  /** Registry-unique adapter id (e.g. `webflix.built-in-ranker`). */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly capabilities: readonly string[];
}

/** A registry entry: the descriptor plus the adapter instance itself. */
export interface RankerAdapterEntry extends RankerAdapterDescriptor {
  /** The adapter implementation behind this entry (satisfies RankerPort). */
  readonly ranker: RankerPort;
}

/**
 * The registry port (interface only, like the other ports in ./ports.ts).
 * `list` returns entries in a stable, registry-declared order; `get` is the
 * registry-known-id check the selection use cases rely on.
 */
export interface RankerAdapterRegistry {
  /** Every selectable entry, stable order. Never empty (constructor guard). */
  list(): readonly RankerAdapterEntry[];
  /** The entry for `id`, or null when the registry does not know it. */
  get(id: string): RankerAdapterEntry | null;
}

/** Guards the registry shape rules above; throws on any violation. */
function assertValidEntries(entries: readonly RankerAdapterEntry[]): void {
  if (entries.length === 0) {
    throw new Error("a ranker-adapter registry must seed at least one entry");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.id.trim().length === 0) {
      throw new Error("a ranker-adapter entry must carry a non-empty id");
    }
    if (seen.has(entry.id)) {
      throw new Error(`duplicate ranker-adapter id in registry seed: ${entry.id}`);
    }
    seen.add(entry.id);
    if (entry.label.trim().length === 0) {
      throw new Error(`ranker-adapter entry ${entry.id} must carry a non-empty label`);
    }
    if (entry.description.trim().length === 0) {
      throw new Error(`ranker-adapter entry ${entry.id} must carry a non-empty description`);
    }
    if (entry.capabilities.length === 0) {
      throw new Error(`ranker-adapter entry ${entry.id} must carry capabilities`);
    }
    if (typeof entry.ranker.rank !== "function") {
      throw new Error(`ranker-adapter entry ${entry.id} must carry a RankerPort implementation`);
    }
  }
}

/**
 * Builds a static registry from a seed list (validated once at
 * construction). The default registry below is a module literal over this
 * factory; future Phase-4 orders extend the SEED, never the shape rules.
 */
export function createStaticRankerAdapterRegistry(
  entries: readonly RankerAdapterEntry[],
): RankerAdapterRegistry {
  assertValidEntries(entries);
  const byId = new Map<string, RankerAdapterEntry>(
    entries.map((entry) => [entry.id, entry] as const),
  );
  const frozen: readonly RankerAdapterEntry[] = Object.freeze([...entries]);
  return {
    list: () => frozen,
    get: (id: string) => byId.get(id) ?? null,
  };
}

/**
 * The ONE seeded entry today: the built-in deterministic ranker, v1.
 * `id` is the existing BUILT_IN_RANKER_ID (provenance continuity with
 * generate-recommendations' connectorId); the label/description/capabilities
 * are the truthful presentation copy the selector renders verbatim.
 */
export const BUILT_IN_RANKER_V1_ENTRY: RankerAdapterEntry = {
  id: BUILT_IN_RANKER_ID,
  label: "Built-in ranker (v1)",
  description:
    "WebFlix's own deterministic ranking policy v1: local signals only (library, watch history, explicit feedback, objectives), fixed weights, and a reason with evidence on every recommendation.",
  capabilities: ["deterministic", "local", "reasons-mandatory"],
  ranker: BUILT_IN_RANKER,
};

/**
 * The static default registry, seeded with EXACTLY ONE entry (built-in-v1).
 * Empty by construction is impossible (module literal + constructor guard);
 * rows 4-6 add transcribe/summarize/translate adapter entries by extending
 * this seed — the registry shape is the seam they extend.
 */
export const DEFAULT_RANKER_ADAPTER_REGISTRY: RankerAdapterRegistry =
  createStaticRankerAdapterRegistry([BUILT_IN_RANKER_V1_ENTRY]);
