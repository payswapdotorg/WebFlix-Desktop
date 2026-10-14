/**
 * Federated-search contract shapes (Phase 7, P7-SEARCH-1 — WF-009).
 *
 * ADDITIVE module (semver minor 0.11.0 -> 0.12.0 per the §3 method): the
 * frozen §2.1–2.6 shapes, the intelligence modules and every earlier
 * additive sibling (ads, ads-sources) are untouched. Like ./ads-sources,
 * this module is a lane sibling that reuses the frozen catalog shapes
 * VERBATIM from ./catalog (CatalogItem — never mirrored), because the
 * merged item view speaks exactly the catalog merge seam's vocabulary.
 *
 * What this module is: the federated-search SEAM's data shapes — the
 * request, the per-source outcome union, the per-source coverage row, and
 * the federated result with its merged item view. Honesty rules encoded
 * here, binding on every implementation:
 *
 * - THE ACCESS STATES ARE DATA, NOT FAILURES: a source whose search is
 *   unsupported, auth-gated, timed out or partially failed ANSWERS with
 *   that typed state in its SearchOutcome — surfaced in SourceCoverage
 *   with its honest reason, never a silent empty result, never a thrown
 *   error, never fabricated items. A federation NEVER hides a failed
 *   source: the FederatedSearchResult invariant (superRefine-pinned)
 *   requires every coverage row to agree with the per-source outcomes
 *   map, in both directions.
 * - THE MERGED VIEW IS MatchEvidence-DRIVEN: rows that reference the SAME
 *   provider asset (same providerId + assetId — the catalog merge seam's
 *   provider-native rule, confidence 1) collapse into one merged item
 *   whose matchEvidence records WHY, in the seam's own evidence
 *   vocabulary. The title/external-id scoring stays the catalog package's
 *   job (a later order may route the merged view through it — no scorer
 *   is mirrored here).
 * - NO NETWORK, NO CREDENTIALS (this order, binding): the shapes are the
 *   seam; the only adapters that exist are labeled fixtures. A source is
 *   searched ONLY through the port, never by intercepting anything.
 * - ONE REJECTING ERROR CODE: `search/source-invalid` — the caller-defect
 *   surface (a malformed request, a per-source cursor/limit key naming a
 *   source the registry does not know). It rides THIS sibling as the
 *   lane's own typed vocabulary because the shared errors.ts enum is
 *   read-only this order (additive-only contracts); merging it into the
 *   shared ErrorCode vocabulary is a later additive order's call.
 */
import { z } from "zod";
import { CatalogItemSchema } from "./catalog";

// ---------------------------------------------------------------------------
// The request — what a federated search is asked
// ---------------------------------------------------------------------------

/**
 * One federated search request: the query terms, optionally per-source
 * paging cursors (the opaque cursor a source's previous ok outcome handed
 * back — absent for a source = its first page) and optional per-source
 * limits (the max rows a source may return). Deliberately minimal: the
 * seam extends additively when real transport lands; inventing selectors
 * no source supports would promise coverage that does not exist.
 */
export const SearchRequestSchema = z.object({
  /** The search terms (non-blank; each source's own search semantics apply). */
  query: z.string().trim().min(1),
  /**
   * Per-source paging cursors, keyed by source id. The cursor values are
   * opaque strings a source itself produced; a key for a source the
   * registry does not know is a caller defect (search/source-invalid).
   */
  cursors: z.record(z.string().min(1), z.string().min(1)).optional(),
  /**
   * Optional per-source limits, keyed by source id — the maximum number of
   * rows that source may return. The 1..500 bounds are OUR request-shape
   * guard (a caller defect surface), never a promise any source honors.
   */
  limits: z.record(z.string().min(1), z.number().int().min(1).max(500)).optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// ---------------------------------------------------------------------------
// The per-source outcome — the typed honest states, DATA not failures
// ---------------------------------------------------------------------------

/** The outcome classes a federated source can answer with (SourceCoverage's vocabulary). */
export const SearchOutcomeClassSchema = z.enum([
  "ok",
  "partial-failure",
  "timeout",
  "auth-required",
  "unsupported",
]);
export type SearchOutcomeClass = z.infer<typeof SearchOutcomeClassSchema>;

/**
 * One federated source's honest answer, a discriminated union on `status`:
 * - `ok`: the source answered — `items` MAY be empty (the honest no-results
 *   state, never padded) and `nextCursor` is present only when more pages
 *   exist (absent means no more — never a fabricated end cursor);
 * - `partial-failure`: the source failed to complete and reports why,
 *   salvaging the `items` it did return (possibly none);
 * - `timeout`: the source exceeded its per-source budget — the reason
 *   names the budget; whatever arrived too late is DISCARDED, never
 *   silently spliced in;
 * - `auth-required`: the source needs an authenticated connection before
 *   it can search — the reason names the authorization path (the
 *   pending-authorization rule: a state without its path is an
 *   unactionable dead end);
 * - `unsupported`: the source does not support search at all — the typed
 *   reason says so (an honest state, never a dead control).
 * The four non-ok states are DATA, surfaced with their honest reasons —
 * never hidden, never thrown (the product-feature rule).
 */
export const SearchOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    items: z.array(CatalogItemSchema),
    nextCursor: z.string().min(1).optional(),
  }),
  z.object({
    status: z.literal("partial-failure"),
    reason: z.string().min(1),
    items: z.array(CatalogItemSchema),
  }),
  z.object({
    status: z.literal("timeout"),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("auth-required"),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("unsupported"),
    reason: z.string().min(1),
  }),
]);
export type SearchOutcome = z.infer<typeof SearchOutcomeSchema>;

// ---------------------------------------------------------------------------
// The coverage row — what the federation honestly reports per source
// ---------------------------------------------------------------------------

/**
 * The per-source coverage row: which source answered, with which outcome
 * class, how many rows it returned, and how long its call took. `counts`
 * are row tallies only (a count, never a fabricated completeness claim):
 * `returned` counts the ok/partial-failure items — 0 for every other
 * class. A federation NEVER hides a failed source: every fanned-out
 * source gets exactly one row, whatever it answered.
 */
export const SourceCoverageSchema = z.object({
  /** The source id — the registry id space. */
  source: z.string().min(1),
  /** The outcome class this source answered with. */
  outcome: SearchOutcomeClassSchema,
  /** Row tallies only: the rows the source returned (0 for non-item states). */
  counts: z.object({
    returned: z.number().int().min(0),
  }),
  /** How long this source's call took, in milliseconds (>= 0). */
  elapsedMs: z.number().min(0),
});
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>;

// ---------------------------------------------------------------------------
// The federated result — per-source outcomes + the merged item view
// ---------------------------------------------------------------------------

/**
 * One row of the merged item view: the merged CatalogItem (the frozen
 * shape, reused verbatim) plus the sources whose results contributed to
 * it. When several rows collapsed (the same provider asset found through
 * more than one source — or twice in one source), the item's
 * `matchEvidence` records WHY in the catalog merge seam's own vocabulary
 * (provider-native, confidence 1); a single-source row keeps the
 * matchEvidence its source reported, absent means absent.
 */
export const MergedSearchItemSchema = z.object({
  /** The merged item — the frozen CatalogItem shape, reused verbatim. */
  item: CatalogItemSchema,
  /** The sources whose results contributed to this merged item (registry id space, stable fan-out order). */
  sources: z.array(z.string().min(1)).min(1),
});
export type MergedSearchItem = z.infer<typeof MergedSearchItemSchema>;

/**
 * The federated search's whole honest answer: one outcome per fanned-out
 * source (keyed by source id), one coverage row per fanned-out source,
 * and the merged item view. The superRefine pins the never-hide
 * invariant: every coverage row names a source the outcomes map carries
 * with the SAME outcome class, and every outcomes entry has its coverage
 * row — a result that drops a failed source from coverage (or reports a
 * class its outcome contradicts) is not a valid FederatedSearchResult.
 */
export const FederatedSearchResultSchema = z
  .object({
    /** Per-source outcomes, keyed by source id (every fanned-out source answers). */
    outcomes: z.record(z.string().min(1), SearchOutcomeSchema),
    /** Per-source coverage rows, one per fanned-out source, stable fan-out order. */
    coverage: z.array(SourceCoverageSchema).min(1),
    /** The merged item view — duplicate provider assets collapsed, MatchEvidence-driven. */
    items: z.array(MergedSearchItemSchema),
  })
  .superRefine((result, ctx) => {
    const coverageSources = new Set(result.coverage.map((row) => row.source));
    for (const row of result.coverage) {
      const outcome = result.outcomes[row.source];
      if (outcome === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `coverage row for source "${row.source}" has no outcomes entry — a federation ` +
            "never hides a source it fanned out to",
        });
        continue;
      }
      if (outcome.status !== row.outcome) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `coverage row for source "${row.source}" reports outcome "${row.outcome}" but its ` +
            `outcome entry says "${outcome.status}" — the two must agree`,
        });
      }
    }
    for (const source of Object.keys(result.outcomes)) {
      if (!coverageSources.has(source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `outcomes entry for source "${source}" has no coverage row — a federation ` +
            "never hides a source it fanned out to",
        });
      }
    }
  });
export type FederatedSearchResult = z.infer<typeof FederatedSearchResultSchema>;

// ---------------------------------------------------------------------------
// The one rejecting error code — the caller-defect surface
// ---------------------------------------------------------------------------

/**
 * The search lane's typed error codes. ONE code this order, appended per
 * the same additive-only law as the shared ErrorCode vocabulary:
 * `search/source-invalid` carries the federated-search CALLER DEFECTS —
 * a malformed SearchRequest, a per-source cursor/limit key naming a
 * source the registry does not know (the error names the registry's
 * KNOWN ids — the honest recovery hint), or a malformed registry seed.
 * The source ACCESS states (timeout, auth-required, unsupported,
 * partial-failure) are DATA in SearchOutcome — no error code exists for
 * them, by design.
 */
export enum SearchErrorCode {
  SourceInvalid = "search/source-invalid",
}

/**
 * Zod schema for {@link SearchErrorCode} values. Built via `Object.values`
 * (not `z.nativeEnum`) so the schema behaves identically on zod 3 and zod 4
 * (the ErrorCodeSchema pattern, verbatim).
 */
export const SearchErrorCodeSchema = z.enum(
  Object.values(SearchErrorCode) as [SearchErrorCode, ...SearchErrorCode[]],
);

/** Serializable, persistable shape of a {@link SearchError} (the WebFlixErrorShape style). */
export const SearchErrorShapeSchema = z.object({
  code: SearchErrorCodeSchema,
  /** Human-readable, renderer-safe reason (no secrets in reason or context). */
  reason: z.string().min(1),
  /** True when the caller may retry the failed operation as-is. */
  retryable: z.boolean(),
  /** Structured, secret-free diagnostics bag. */
  context: z.record(z.string(), z.unknown()).default({}),
});
export type SearchErrorShape = z.infer<typeof SearchErrorShapeSchema>;

/** Constructor input for {@link SearchError}; `context` defaults to `{}`. */
export type SearchErrorInit = {
  code: SearchErrorCode;
  reason: string;
  retryable: boolean;
  context?: Record<string, unknown>;
};

/**
 * The typed error the federated-search lane REJECTS with (the WebFlixError
 * style — stable machine-readable code, human-readable reason, retryable
 * flag, secret-free context bag — carried on this sibling's own code
 * vocabulary because the shared ErrorCode enum is read-only this order).
 * Only caller defects reject; every source access state is DATA in
 * SearchOutcome.
 */
export class SearchError extends Error {
  readonly code: SearchErrorCode;
  readonly reason: string;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(init: SearchErrorInit) {
    super(init.reason);
    this.name = "SearchError";
    this.code = init.code;
    this.reason = init.reason;
    this.retryable = init.retryable;
    this.context = init.context ?? {};
  }

  /** Structural type guard (robust across bundle-duplicated classes). */
  static is(value: unknown): value is SearchError {
    return value instanceof SearchError;
  }

  /** IPC-safe, secret-free serialization of the error (frozen SearchErrorShape). */
  toJSON(): {
    code: SearchErrorCode;
    reason: string;
    retryable: boolean;
    context: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      reason: this.reason,
      retryable: this.retryable,
      context: this.context,
    };
  }
}
