/**
 * Federated search (P7-SEARCH-1, WF-009) — the search use case: a
 * CONCURRENT fan-out across every source in the registry, each source
 * racing its own per-source timeout budget, aggregated into the
 * FederatedSearchResult whose coverage NEVER hides a failed source.
 *
 * Semantics, stated honestly:
 *
 * - CALLER DEFECTS validated BEFORE any adapter is touched (typed
 *   search/source-invalid, the ads/source-invalid style): a malformed
 *   SearchRequest, a per-source cursor/limit key naming a source the
 *   registry does not know (the error names the registry's KNOWN ids —
 *   the honest recovery hint), or a non-positive timeout budget.
 * - THE STATE IS THE ANSWER: an auth-gated, unsupported, timed-out or
 *   partially failed source ANSWERS with that typed state in its
 *   SearchOutcome — surfaced in coverage with its honest reason, never
 *   hidden, never thrown. A federation whose registry holds only
 *   failing sources still SUCCEEDS, honestly saying so per source.
 * - THE BUDGET IS PER-SOURCE: every source's call races the SAME budget
 *   concurrently (Promise.all — WF-009's "concurrently"); a slow source
 *   times out on its own and can never starve the others. Whatever a
 *   timed-out source answers too late is DISCARDED, never spliced in.
 * - ADAPTER DEFECTS ARE DATA TOO: an adapter that rejects with a
 *   non-cancelled error, or resolves a value that fails the
 *   SearchOutcome contract shape, surfaces as that source's
 *   partial-failure with the honest reason — the federation never
 *   crashes and never hides the source. Only the cooperative
 *   cancellation (the typed common/cancelled rejection, boundary or
 *   mid-run) stops the whole call, rethrown as-is.
 * - THE MERGED VIEW IS MatchEvidence-DRIVEN over the frozen catalog
 *   shapes: rows that reference the SAME provider asset (same
 *   providerId + assetId — the catalog merge seam's provider-native
 *   rule, confidence 1) collapse into one merged item whose
 *   matchEvidence records WHY in the seam's own vocabulary; assets
 *   union (dedup by assetId), metadata fills missing keys (never
 *   overwrites), availability keeps the LATER observation. The
 *   title/external-id scoring stays the catalog package's job — no
 *   scorer is mirrored here. Fan-out order (registry order, then each
 *   source's own row order) is preserved; ranking is the intelligence
 *   lane's job, never promised here.
 * - NOTHING IS STORED, NOTHING MUTATED: a read over the registry; the
 *   caller's input is never touched (deep-equal discipline, pinned by
 *   test). elapsedMs is measured on the injected ClockPort (the
 *   product's time); the budget race itself uses the runtime timer —
 *   the only way to abandon a hung adapter.
 */
import {
  ErrorCode,
  SearchError,
  SearchErrorCode,
  SearchRequestSchema,
  SearchOutcomeSchema,
  WebFlixError,
} from "webflix-contracts";
import type {
  CatalogItem,
  FederatedSearchResult,
  MatchEvidence,
  MergedSearchItem,
  SearchOutcome,
  SearchRequest,
  SourceCoverage,
} from "webflix-contracts";
import type { ClockPort, SearchSourcePort } from "./ports";

// ---------------------------------------------------------------------------
// The registry — static data + pure lookups (the transparency pattern)
// ---------------------------------------------------------------------------

/**
 * The search-source registry port (interface only, the
 * TransparencySourceRegistry pattern): `list` returns adapters in a
 * stable, registry-declared order; `get` is the registry-known-id check
 * the use case validates against.
 */
export interface SearchSourceRegistry {
  /** Every registered source adapter, stable order. Never empty (constructor guard). */
  list(): readonly SearchSourcePort[];
  /** The adapter serving `sourceId`, or null when the registry does not know it. */
  get(sourceId: string): SearchSourcePort | null;
}

/** Guards the seed shape rules; throws typed search/source-invalid on any violation. */
function assertValidSearchSources(adapters: readonly SearchSourcePort[]): void {
  if (adapters.length === 0) {
    throw new SearchError({
      code: SearchErrorCode.SourceInvalid,
      reason: "a search-source registry must seed at least one adapter",
      retryable: false,
      context: { subject: "SearchSourceRegistry" },
    });
  }
  const seen = new Set<string>();
  for (const adapter of adapters) {
    const id = adapter?.descriptor?.source;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new SearchError({
        code: SearchErrorCode.SourceInvalid,
        reason: "a search-source adapter must carry a descriptor with a non-blank source id",
        retryable: false,
        context: { subject: "SearchSourcePort.descriptor.source" },
      });
    }
    if (seen.has(id)) {
      throw new SearchError({
        code: SearchErrorCode.SourceInvalid,
        reason: `duplicate search-source id in registry seed: ${id}`,
        retryable: false,
        context: { subject: "SearchSourceRegistry", source: id },
      });
    }
    seen.add(id);
    if (typeof adapter.search !== "function") {
      throw new SearchError({
        code: SearchErrorCode.SourceInvalid,
        reason: `search-source adapter ${id} must implement search()`,
        retryable: false,
        context: { subject: "SearchSourcePort.search", source: id },
      });
    }
  }
}

/**
 * Builds a static registry from a seed list (validated once at
 * construction, the createStaticTransparencySourceRegistry pattern
 * verbatim in shape). The adapters this order are the labeled fixtures;
 * a later order swaps the SEED when real transport is sanctioned —
 * never the shape rules.
 */
export function createStaticSearchSourceRegistry(
  adapters: readonly SearchSourcePort[],
): SearchSourceRegistry {
  assertValidSearchSources(adapters);
  const byId = new Map<string, SearchSourcePort>(
    adapters.map((adapter) => [adapter.descriptor.source, adapter] as const),
  );
  const frozen: readonly SearchSourcePort[] = Object.freeze([...adapters]);
  return {
    list: () => frozen,
    get: (sourceId: string) => byId.get(sourceId) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Inputs / deps
// ---------------------------------------------------------------------------

/**
 * The default per-source timeout budget. A real composition root may
 * override it per call; the default only keeps a hung source from
 * hanging the search.
 */
export const DEFAULT_SEARCH_SOURCE_TIMEOUT_MS = 5000;

/** The federated search request: one contract-shaped SearchRequest plus call options. */
export interface FederatedSearchInput {
  /** The request, in the SearchRequest contract shape. */
  readonly request: SearchRequest;
  /** Honoured at the use-case boundary and passed through to every adapter's boundary. */
  readonly signal?: AbortSignal;
  /** The per-source timeout budget in ms (default {@link DEFAULT_SEARCH_SOURCE_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
}

export interface FederatedSearchDeps {
  /** The search-source registry (this order: the labeled fixture adapters). */
  readonly registry: SearchSourceRegistry;
  /** Injectable time — elapsedMs is measured on it; use-cases never read the wall clock directly. */
  readonly clock: ClockPort;
}

/** One source's fan-out answer: its outcome plus the honest elapsed measurement. */
interface SourceAnswer {
  readonly source: string;
  readonly outcome: SearchOutcome;
  readonly elapsedMs: number;
}

// ---------------------------------------------------------------------------
// The use case
// ---------------------------------------------------------------------------

/** search.federated — concurrent fan-out, per-source budgets, honest coverage + merged view. */
export class FederatedSearch {
  constructor(private readonly deps: FederatedSearchDeps) {}

  async execute(input: FederatedSearchInput): Promise<FederatedSearchResult> {
    // 1. Caller defects validated BEFORE any adapter is touched.
    validateFederatedSearchInput(input, this.deps.registry);

    // 2. Boundary cancellation: the adapter is never touched (the
    //    TranscriptionEnginePort rule, carried verbatim).
    if (input.signal?.aborted === true) {
      throw new WebFlixError({
        code: ErrorCode.Cancelled,
        reason: "the federated search call was cancelled at the use-case boundary",
        retryable: false,
        context: { phase: "use-case-boundary" },
      });
    }
    const budgetMs = input.timeoutMs ?? DEFAULT_SEARCH_SOURCE_TIMEOUT_MS;
    const request = input.request;
    const signal = input.signal;

    // 3. CONCURRENT fan-out: every source races its own budget; a
    //    cancelled rejection from any adapter stops the whole call
    //    (rethrown as-is), everything else is per-source DATA.
    const adapters = this.deps.registry.list();
    const answers = await Promise.all(
      adapters.map((adapter) => this.searchOne(adapter, request, budgetMs, signal)),
    );

    // 4. Aggregate: coverage rows in stable fan-out order (one per source,
    //    NEVER hiding a failed one), outcomes keyed by source id, and the
    //    merged item view over the rows the sources actually returned.
    const outcomes: Record<string, SearchOutcome> = {};
    const coverage: SourceCoverage[] = [];
    const rows: { source: string; item: CatalogItem }[] = [];
    for (const answer of answers) {
      outcomes[answer.source] = answer.outcome;
      coverage.push({
        source: answer.source,
        outcome: answer.outcome.status,
        counts: { returned: itemCountOf(answer.outcome) },
        elapsedMs: answer.elapsedMs,
      });
      if (answer.outcome.status === "ok" || answer.outcome.status === "partial-failure") {
        for (const item of answer.outcome.items) rows.push({ source: answer.source, item });
      }
    }
    return { outcomes, coverage, items: mergeFederatedItems(rows) };
  }

  /** One source's call: raced against the budget, elapsed measured on the injected clock. */
  private async searchOne(
    adapter: SearchSourcePort,
    request: SearchRequest,
    budgetMs: number,
    signal: AbortSignal | undefined,
  ): Promise<SourceAnswer> {
    const source = adapter.descriptor.source;
    const startedAt = this.deps.clock.now().getTime();
    let outcome: SearchOutcome;
    const call = adapter.search(request, { signal });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<"budget">((resolve) => {
      timer = setTimeout(() => resolve("budget"), budgetMs);
    });
    try {
      const winner = await Promise.race([
        call.then((value) => ({ kind: "answered" as const, value })),
        budget.then(() => ({ kind: "budget" as const })),
      ]);
      if (winner.kind === "budget") {
        outcome = {
          status: "timeout",
          reason:
            `the source "${source}" exceeded its per-source timeout budget of ${budgetMs}ms — ` +
            "its late answer, if any, was discarded",
        };
      } else {
        outcome = coerceOutcome(source, winner.value);
      }
    } catch (err) {
      // The cooperative stop stops the whole call; everything else is
      // this source's honest partial-failure.
      if (WebFlixError.is(err) && err.code === ErrorCode.Cancelled) throw err;
      outcome = {
        status: "partial-failure",
        reason:
          `the search-source adapter for "${source}" failed: ` +
          (WebFlixError.is(err)
            ? `${err.code}: ${err.reason}`
            : err instanceof Error
              ? err.message
              : String(err)),
        items: [],
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    const elapsedMs = Math.max(0, this.deps.clock.now().getTime() - startedAt);
    return { source, outcome, elapsedMs };
  }
}

// ---------------------------------------------------------------------------
// Input validation (caller defects — typed search/source-invalid)
// ---------------------------------------------------------------------------

/**
 * Pre-fan-out input validation: the request satisfies the SearchRequest
 * contract shape, the timeout budget is a positive integer, and every
 * per-source cursor/limit key names a source the registry knows (the
 * error names the KNOWN ids — the honest recovery hint).
 */
export function validateFederatedSearchInput(
  input: FederatedSearchInput,
  registry: SearchSourceRegistry,
): void {
  if (input === null || typeof input !== "object") {
    throw new SearchError({
      code: SearchErrorCode.SourceInvalid,
      reason: "the federated search input must be an object carrying a SearchRequest",
      retryable: false,
      context: { subject: "FederatedSearchInput" },
    });
  }
  const parsed = SearchRequestSchema.safeParse(input.request);
  if (!parsed.success) {
    throw new SearchError({
      code: SearchErrorCode.SourceInvalid,
      reason:
        "the federated search request fails the SearchRequest contract shape: " +
        parsed.error.issues.map((issue) => issue.message).join("; "),
      retryable: false,
      context: { subject: "FederatedSearchInput.request" },
    });
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)
  ) {
    throw new SearchError({
      code: SearchErrorCode.SourceInvalid,
      reason: "the per-source timeout budget must be a positive integer number of milliseconds",
      retryable: false,
      context: { subject: "FederatedSearchInput.timeoutMs", value: input.timeoutMs },
    });
  }
  const known = registry.list().map((adapter) => adapter.descriptor.source);
  const named = new Set<string>([
    ...Object.keys(parsed.data.cursors ?? {}),
    ...Object.keys(parsed.data.limits ?? {}),
  ]);
  for (const sourceId of named) {
    if (!known.includes(sourceId)) {
      throw new SearchError({
        code: SearchErrorCode.SourceInvalid,
        reason: `unknown search source id "${sourceId}" — the registry knows: ${known.join(", ")}`,
        retryable: false,
        context: { subject: "SearchRequest.cursors/limits", known },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Outcome coercion + the merged item view
// ---------------------------------------------------------------------------

/** Row tally of an outcome: the items an ok/partial-failure carries, 0 for every other class. */
function itemCountOf(outcome: SearchOutcome): number {
  return outcome.status === "ok" || outcome.status === "partial-failure" ? outcome.items.length : 0;
}

/**
 * Coerces an adapter's resolved value: a contract-shaped outcome passes
 * through (the parsed value — canonical); anything else is the source's
 * honest partial-failure, never a crash and never a silent drop.
 */
function coerceOutcome(source: string, value: SearchOutcome): SearchOutcome {
  const parsed = SearchOutcomeSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return {
    status: "partial-failure",
    reason:
      `the search-source adapter for "${source}" resolved an outcome that fails the ` +
      "SearchOutcome contract shape: " +
      parsed.error.issues.map((issue) => issue.message).join("; "),
    items: [],
  };
}

/**
 * Merges the rows the sources returned into the merged item view. The
 * merge rule is the catalog merge seam's provider-native rule: two rows
 * referencing the SAME provider asset (same providerId + assetId) are
 * the same watchable — the first-seen row is the target (stable fan-out
 * order), the later row's assets union in (dedup by assetId), its
 * metadata fills missing keys (never overwrites), its availability wins
 * only when observed later, and the merged item's matchEvidence records
 * the merge at the provider-native confidence 1 (the catalog seam's own
 * CONFIDENCE.providerNative value) in its own evidence vocabulary.
 * Single-source rows keep the matchEvidence their source reported —
 * absent means absent, never fabricated.
 */
function mergeFederatedItems(
  rows: readonly { source: string; item: CatalogItem }[],
): MergedSearchItem[] {
  const merged: MergedSearchItem[] = [];
  for (const row of rows) {
    let target: MergedSearchItem | undefined;
    let shared: string | undefined;
    for (const candidate of merged) {
      const assetId = sharedProviderAsset(candidate.item, row.item);
      if (assetId !== undefined) {
        target = candidate;
        shared = assetId;
        break;
      }
    }
    if (target === undefined || shared === undefined) {
      merged.push({
        item: { ...row.item, assets: [...row.item.assets], metadata: { ...row.item.metadata } },
        sources: [row.source],
      });
      continue;
    }
    mergeIntoTarget(target, row, shared);
  }
  return merged;
}

/** The provider-native asset identity check: same provider + a shared assetId. */
function sharedProviderAsset(a: CatalogItem, b: CatalogItem): string | undefined {
  if (a.providerId !== b.providerId) return undefined;
  for (const asset of a.assets) {
    if (b.assets.some((other) => other.assetId === asset.assetId)) return asset.assetId;
  }
  return undefined;
}

/**
 * The externalIds bag on a catalog item's metadata (canonical:
 * metadata.externalIds — the catalog seam's own reader); null when the
 * value is not a bag at all.
 */
function externalIdsBagOf(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const bag: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry !== "") bag[key] = entry;
  }
  return bag;
}

/** Merges one row into an existing merged item (the catalog merge seam's rules). */
function mergeIntoTarget(
  target: MergedSearchItem,
  row: { source: string; item: CatalogItem },
  sharedAssetId: string,
): void {
  const item = target.item;
  for (const asset of row.item.assets) {
    if (!item.assets.some((other) => other.assetId === asset.assetId)) item.assets.push(asset);
  }
  // The externalIds bag merges key-by-key, fill-missing (the catalog
  // seam's mergeMetadata rule verbatim in substance); every other
  // metadata key fills only when the target lacks it — never overwrites.
  const incomingIds = externalIdsBagOf(row.item.metadata.externalIds);
  if (incomingIds !== null) {
    const bag = { ...externalIdsBagOf(item.metadata.externalIds) };
    for (const [key, value] of Object.entries(incomingIds)) {
      if (bag[key] === undefined) bag[key] = value;
    }
    item.metadata.externalIds = bag;
  }
  for (const [key, value] of Object.entries(row.item.metadata)) {
    if (key === "externalIds") continue;
    if (!(key in item.metadata)) item.metadata[key] = value;
  }
  item.availability = latestAvailability(item.availability, row.item.availability);
  if (!target.sources.includes(row.source)) target.sources.push(row.source);
  const evidence: MatchEvidence = {
    confidence: 1,
    evidence: [
      `provider-native: same provider asset ${item.providerId}/${sharedAssetId}`,
      `federated: rows from sources ${target.sources.join(", ")} merged on this asset`,
    ],
  };
  if (!item.matchEvidence || evidence.confidence > item.matchEvidence.confidence) {
    item.matchEvidence = evidence;
  }
}

/**
 * Keeps the LATER observation (the catalog seam's latestAvailability
 * rule: availability is one point-in-time fact; ties keep the current).
 */
function latestAvailability(
  current: CatalogItem["availability"],
  incoming: CatalogItem["availability"],
): CatalogItem["availability"] {
  if (current === undefined) return incoming;
  if (incoming === undefined) return current;
  return Date.parse(incoming.observedAt) > Date.parse(current.observedAt) ? incoming : current;
}
