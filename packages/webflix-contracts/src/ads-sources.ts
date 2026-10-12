/**
 * Transparency-source contract shapes (Phase 5 closer, P5-SOURCES — the
 * FINAL Phase-5 row).
 *
 * ADDITIVE module (semver minor 0.10.0 -> 0.11.0 per the §3 method): the
 * frozen §2.1–2.6 shapes, the intelligence modules and every earlier
 * additive sibling are untouched. Like ./ads, this module is an ads-lane
 * sibling that imports ONLY the shared primitives (`./internal/primitives`)
 * and the ads shapes themselves (`./ads`, reused verbatim — never
 * mirrored); nothing from the intelligence/ranking modules, in either
 * direction (phase5-ad-plan §3; the architecture-check `ads-separation`
 * rules pin both directions, and this file matches their `ads*.ts` glob).
 *
 * What this module is: the transparency-source SEAM — the port + the
 * manifest + the query/observation/result shapes that close Phase 5's
 * shape (phase5-ad-plan §1 BINDING access truths; AUDIT-SOURCES §6
 * finding 13 + §11). The automated connectors stay TYPED
 * pending-authorization/blocked until the applications clear; the
 * ads.import path from P5-STORES serves meanwhile. Honesty rules encoded
 * here, binding on every implementation:
 *
 * - THE ACCESS STATES ARE DATA, NOT FAILURES: a source whose automated
 *   access is pending-authorization or blocked ANSWERS with that typed
 *   state in the query result (surfaced with the honest reason naming the
 *   application path, per the charter) — never a silent empty result,
 *   never a thrown not-authorized error, never fabricated observations.
 *   The `unavailable` state exists for a LATER transport order's honest
 *   transient failures; no adapter ships in it this order.
 * - NO NETWORK, NO SCRAPING (this order, rg-provable): the adapters are
 *   the SEAM that lights up when authorizations clear — a later order
 *   wires real transport; until then every adapter is an honest-state
 *   object. A source is observed ONLY through this port or the user's
 *   own imports (ads.import) — never by intercepting playback or network
 *   traffic (phase5-ad-plan §1.2).
 * - THE MANIFEST DECLARES ONLY WHAT THE SOURCE'S OWN TERMS DECLARE
 *   (AUDIT-SOURCES §6 finding 13 + §11): supported regions/categories are
 *   AS-DECLARED honest-absent optionals — a source whose terms do not
 *   enumerate them yields a manifest without them, never a guessed
 *   coverage set, and NO manifest claims more than its source's own
 *   terms (the no-global-ad-coverage rule, stated in the manifest's own
 *   coverage note).
 * - OBSERVATIONS ARE SOURCE-REPORTED ONLY: every field of an observation
 *   is what the transparency source itself reported — the Ad Center's own
 *   ids and import stamps are minted by the import bridge, never here;
 *   absent means absent (no fabricated defaults, no empty-array
 *   stand-ins for "unknown").
 * - CANCELLATION: the port honours the signal at its boundary — an
 *   already-aborted call rejects with the typed `common/cancelled` error
 *   (the TranscriptionEnginePort rule, carried verbatim).
 */
import { z } from "zod";
import { AbsoluteUrlSchema, IsoDateTimeSchema, RegionCodeSchema } from "./internal/primitives";
import { AdServingPeriodSchema, AdvertiserVerificationStateSchema } from "./ads";

// ---------------------------------------------------------------------------
// The access state + the manifest — the per-source coverage declaration
// ---------------------------------------------------------------------------

/**
 * The access state a transparency source's own terms declare for OUR
 * automated access (AUDIT-SOURCES §6 finding 13 — BINDING):
 * - `available`: authorized automated access exists (none ships this
 *   order; the state exists because the manifest is the declaration
 *   vocabulary that lights up when authorizations clear);
 * - `pending-authorization`: an application path exists and is not yet
 *   approved (Meta Ad Library, TikTok Commercial Content today);
 * - `blocked`: no sanctioned automated-access path exists at all (Google
 *   Ads Transparency Center today — no official API, scrapers not an
 *   approved path).
 * The blocked/pending states are PRODUCT features, not failures — the
 * Ad Center's honesty is the point.
 */
export const TransparencySourceAccessStateSchema = z.enum([
  "available",
  "pending-authorization",
  "blocked",
]);
export type TransparencySourceAccessState = z.infer<typeof TransparencySourceAccessStateSchema>;

/**
 * The per-source coverage declaration — what the Ad Center honestly
 * displays about a transparency source. Every field is a DECLARATION, not
 * a promise: regions/categories appear ONLY when the source's own terms
 * enumerate them (AUDIT-SOURCES §6 finding 13 + §11); `coverageNote`
 * states the constraint in plain words; `authorizationPathNote` names
 * the application path for pending/blocked sources (REQUIRED for them —
 * a pending state without its path is an unactionable dead end); the
 * `termsUrl` is the official link the declaration rests on. A manifest
 * NEVER claims more than the source's own terms (the
 * no-global-ad-coverage rule, phase5-ad-plan §1.4).
 */
export const TransparencySourceManifestSchema = z
  .object({
    /** The source id — the registry/provenance id space (e.g. `meta-ad-library`). */
    source: z.string().min(1),
    /** Display name rendered verbatim by the Ad Center's honest display. */
    displayName: z.string().min(1),
    /** The access state for automated access, as the source's terms stand. */
    accessState: TransparencySourceAccessStateSchema,
    /** Regions the source's own terms declare coverage for; absent when the terms do not enumerate regions. */
    declaredRegions: z.array(RegionCodeSchema).min(1).optional(),
    /** Categories the source's own terms declare coverage for; absent when the terms do not enumerate categories. */
    declaredCategories: z.array(z.string().min(1)).min(1).optional(),
    /** The coverage constraint in plain words — the honest display text, never a completeness claim. */
    coverageNote: z.string().min(1),
    /** The path to authorization, named; REQUIRED for pending-authorization/blocked sources. */
    authorizationPathNote: z.string().min(1).optional(),
    /** Where the source's own terms live (the official link, AUDIT-SOURCES §11); absent when unrecorded. */
    termsUrl: AbsoluteUrlSchema.optional(),
  })
  .superRefine((manifest, ctx) => {
    if (
      (manifest.accessState === "pending-authorization" || manifest.accessState === "blocked") &&
      manifest.authorizationPathNote === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "a pending-authorization or blocked manifest must carry authorizationPathNote — the application path (or its honest absence) is part of the state",
      });
    }
  });
export type TransparencySourceManifest = z.infer<typeof TransparencySourceManifestSchema>;

// ---------------------------------------------------------------------------
// The query + the observation — what a source is asked, what it reports
// ---------------------------------------------------------------------------

/**
 * One transparency query: the search terms the source would query on,
 * optionally scoped to one region (absent = the source's whole declared
 * coverage). Deliberately minimal — the seam extends additively when
 * real transport lands (a later order may add pagination/advertiser-id
 * selectors as the authorized APIs actually require them; inventing them
 * now would be promising coverage no source has granted).
 */
export const TransparencyQuerySchema = z.object({
  /** The search terms (non-blank; the source's own search semantics apply). */
  searchTerms: z.string().trim().min(1),
  /** The region the query targets; absent = the source's whole declared coverage. */
  region: RegionCodeSchema.optional(),
});
export type TransparencyQuery = z.infer<typeof TransparencyQuerySchema>;

/**
 * The advertiser identity as one source reports it for one observed ad —
 * the observation's inline identity report, mapped field-for-field onto
 * the AdvertiserIdentity source-reported fields. At least one of
 * `sourceAdvertiserId` / `names` must be present: a report that
 * identifies the advertiser in NO way cannot be attached to an identity
 * honestly (AdRecord.advertiserIdentityId is required downstream).
 */
export const TransparencyAdvertiserReportSchema = z
  .object({
    /** The advertiser's id AS REPORTED by the source; absent when it reports none. */
    sourceAdvertiserId: z.string().min(1).optional(),
    /** The names the source reports (display and/or legal), as reported. */
    names: z.array(z.string().min(1)).min(1).optional(),
    /** Regions the source reports the advertiser as reaching/operating in. */
    regions: z.array(RegionCodeSchema).min(1).optional(),
    /** The source's OWN verification verdict — never our judgment; absent when unreported. */
    verificationState: AdvertiserVerificationStateSchema.optional(),
  })
  .superRefine((report, ctx) => {
    if (report.sourceAdvertiserId === undefined && report.names === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "an advertiser report must carry at least one of sourceAdvertiserId / names (as reported by the source) — an unidentifiable advertiser cannot be imported honestly",
      });
    }
  });
export type TransparencyAdvertiserReport = z.infer<typeof TransparencyAdvertiserReportSchema>;

/**
 * One observed ad — the ad-record-shaped data a transparency source
 * reports, mapped onto the P5-CONTRACTS AdRecord fields with
 * source-reported-only honesty: the creative text/urls, the regions, the
 * serving periods, the source's own ad id, and the exposure instant, all
 * AS REPORTED. The Ad Center's own ids (record id, identity id) and
 * import stamps (importedAt, importBatchId) are minted by the import
 * bridge — never invented here. Every creative field is honest-absent: a
 * source that exposes no creative text yields an observation without it,
 * never a placeholder.
 */
export const TransparencyObservationSchema = z.object({
  /** The ad's id AS REPORTED by its source; absent for sources without one. */
  sourceAdId: z.string().min(1).optional(),
  /** The advertiser identity report the source attached to this ad. */
  advertiser: TransparencyAdvertiserReportSchema,
  /** The creative text the source exposed — the claim-extraction substrate. */
  creativeText: z.string().min(1).optional(),
  /** Creative/landing URLs the source exposed. */
  creativeUrls: z.array(AbsoluteUrlSchema).min(1).optional(),
  /** Regions the source reports the ad as reaching. */
  regions: z.array(RegionCodeSchema).min(1).optional(),
  /** Serving periods the source reports for the ad. */
  periods: z.array(AdServingPeriodSchema).min(1).optional(),
  /** When the source exposed this record, as reported by it; absent when unreported. */
  observedAt: IsoDateTimeSchema.optional(),
});
export type TransparencyObservation = z.infer<typeof TransparencyObservationSchema>;

// ---------------------------------------------------------------------------
// The query result — the typed honest states, DATA not failures
// ---------------------------------------------------------------------------

/**
 * A transparency query's honest answer, a discriminated union on `status`:
 * - `ok`: the authorized source answered — `observations` MAY be empty
 *   (the honest no-results state, never padded);
 * - `unavailable`: the source could not serve the query right now — the
 *   honest transient state a LATER transport order surfaces (no adapter
 *   ships in it this order; it exists so a future failure is DATA, never
 *   a silent empty result);
 * - `pending-authorization`: the application path exists but has not
 *   cleared — `reason` names the path (the charter's rule);
 * - `blocked`: no sanctioned automated-access path exists — `reason`
 *   states the finding (e.g. the no-official-API fact) honestly.
 * The three non-ok states are DATA, surfaced with their honest reasons —
 * never hidden, never thrown (the product-feature rule).
 */
export const TransparencyQueryResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    observations: z.array(TransparencyObservationSchema),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("pending-authorization"),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("blocked"),
    reason: z.string().min(1),
  }),
]);
export type TransparencyQueryResult = z.infer<typeof TransparencyQueryResultSchema>;

// ---------------------------------------------------------------------------
// The port — INTERFACE ONLY, like TranscriptionEnginePort
// ---------------------------------------------------------------------------

/**
 * Identity of one transparency-source adapter: `source` is the id of the
 * SOURCE it serves (the manifest/registry/provenance id space, e.g.
 * `meta-ad-library`); `version` is the WebFlix ADAPTER's own version
 * (OUR code's — always known, unlike the external service's facts).
 */
export interface TransparencySourceDescriptor {
  /** The source id this adapter serves (the manifest.source value). */
  readonly source: string;
  /** The WebFlix adapter implementation's version (our code's). */
  readonly version: string;
}

/** Per-call adapter options: cooperative cancellation at the boundary. */
export interface TransparencySourceOptions {
  /** Checked at the adapter boundary; an already-aborted call rejects with the typed `common/cancelled` error. */
  readonly signal?: AbortSignal;
}

/**
 * The transparency-source seam (INTERFACE ONLY, like
 * TranscriptionEnginePort / RankerPort). Contract rules for every
 * implementation, stated as binding as the transcription engine's:
 * - HONEST STATES, RETURNED AS DATA: `query` on a pending-authorization
 *   or blocked source RESOLVES with that typed state (the honest reason
 *   naming the application path) — never a thrown not-authorized error,
 *   never a silent empty result, never fabricated observations;
 * - NO NETWORK / NO SCRAPING until a later order wires real transport
 *   for an AUTHORIZED source (this order's adapters are honest-state
 *   objects; observation happens only through this port or the user's
 *   own imports — never by intercepting playback or traffic);
 * - THE MANIFEST IS THE DECLARATION: `manifest` must satisfy
 *   TransparencySourceManifestSchema and declare ONLY what the source's
 *   own terms declare (the registry validates this at construction);
 * - CANCELLATION: `signal` is honoured at the boundary — an
 *   already-aborted call rejects with the typed `common/cancelled`
 *   error and produces no result;
 * - SOURCE-REPORTED ONLY: an `ok` result's observations carry only what
 *   the source itself reported; facts the source did not report stay
 *   absent — never guessed, never defaulted.
 */
export interface TransparencySourcePort {
  /** The adapter's identity: which source it serves + our adapter code's version. */
  readonly descriptor: TransparencySourceDescriptor;
  /** The source's coverage + access declaration, as its own terms state it. */
  readonly manifest: TransparencySourceManifest;
  /**
   * Queries the source. Resolves with the typed honest state (the
   * pending-authorization/blocked/unavailable states are DATA); rejects
   * with the typed `common/cancelled` error when the call was aborted at
   * the boundary.
   */
  query(
    query: TransparencyQuery,
    options?: TransparencySourceOptions,
  ): Promise<TransparencyQueryResult>;
}
