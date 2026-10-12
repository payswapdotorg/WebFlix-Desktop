/**
 * The three transparency-source adapters (P5-SOURCES scope row 2) — ALL
 * HONEST-STATE, ZERO NETWORK (rg-provable: this module imports NOTHING
 * but contract shapes/types and performs NO I/O of any kind — no fetch,
 * no http/https, no sockets, no child processes; the adapters are plain
 * objects answering with their typed states).
 *
 * WHY THE APPLICATION PACKAGE (the whisper/argos seam precedent,
 * considered): the local-library seam owns machine-bound adapters
 * (better-sqlite3, filesystem, child processes) — but THESE adapters
 * touch no machine boundary at all this order. Their every operation is
 * a constant typed state + a constant honest reason; when a later order
 * wires real transport for an AUTHORIZED source, THAT adapter re-homes
 * the seam decision (a network-carrying implementation belongs behind
 * the local-library boundary or a dedicated connector lane, per the
 * architecture) — the port in webflix-contracts is the stable seam
 * either way, and swapping implementations changes nothing above it.
 *
 * The three sources and their states (AUDIT-SOURCES §6 finding 13 +
 * §11 — BINDING; phase5-ad-plan §1):
 * - Google Ads Transparency Center: BLOCKED — no official API exists
 *   (public web UI only; third-party scrapers are NOT an approved
 *   path). Every query returns the typed blocked state with that
 *   finding as the reason.
 * - Meta Ad Library (Graph API ads_archive): PENDING-AUTHORIZATION —
 *   access requires app review + business verification + ID
 *   verification; coverage limited to ads about social issues /
 *   elections / politics by region. Every query returns the typed
 *   pending state naming that application path.
 * - TikTok Commercial Content API: PENDING-AUTHORIZATION — approved
 *   research access (application; EU/US regions; fields/query limits/
 *   retention constraints per agreement). Every query returns the typed
 *   pending state naming that path.
 *
 * The blocked/pending states are PRODUCT FEATURES, not failures: they
 * are DATA in the TransparencyQueryResult union, surfaced with the
 * honest reason, never thrown. NO SCRAPING, NO SNEAKY FETCHES — the
 * adapters are the SEAM that lights up when authorizations clear; the
 * ads.import path serves meanwhile (and the import-bridge mapping test
 * proves the authorized flow will land unchanged).
 *
 * CANCELLATION: the signal is honoured at the adapter boundary — an
 * already-aborted call rejects with the typed common/cancelled error
 * (the TranscriptionEnginePort rule, verbatim). Nothing is mid-run in
 * these adapters (there is no run); a future transport-carrying
 * implementation extends the honour mid-run.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  TransparencyQuery,
  TransparencyQueryResult,
  TransparencySourceManifest,
  TransparencySourceOptions,
  TransparencySourcePort,
} from "webflix-contracts";

// ---------------------------------------------------------------------------
// Shared machinery
// ---------------------------------------------------------------------------

/** The adapters' shared implementation version (OUR code's, always known). */
const ADAPTER_VERSION = "1.0.0";

/**
 * The boundary-cancellation check every adapter runs first (the
 * TranscriptionEnginePort rule): an already-aborted call rejects with
 * the typed common/cancelled error and produces no state.
 */
function rejectIfAborted(options: TransparencySourceOptions | undefined): void {
  if (options?.signal?.aborted === true) {
    throw new WebFlixError({
      code: ErrorCode.Cancelled,
      reason: "the transparency-source call was cancelled at the adapter boundary",
      retryable: false,
      context: { phase: "source-boundary" },
    });
  }
}

// ---------------------------------------------------------------------------
// Google Ads Transparency Center — BLOCKED (no official API)
// ---------------------------------------------------------------------------

export const GOOGLE_ADS_TRANSPARENCY_SOURCE_ID = "google-ads-transparency-center";

/** The honest blocked reason — the audit's no-official-API finding, verbatim in substance. */
export const GOOGLE_ADS_TRANSPARENCY_BLOCKED_REASON =
  "Google Ads Transparency Center is BLOCKED for automated access: no official API exists " +
  "(the public web UI is the only sanctioned surface; third-party scrapers are NOT an approved " +
  "path), and Google's terms note geographic/age restrictions. The connector stays blocked " +
  "until a sanctioned access method exists — until then, ad data reaches the Ad Center through " +
  "the import path (ads.import).";

/** GATC's manifest — the coverage declaration AS its own terms state it. */
export const GOOGLE_ADS_TRANSPARENCY_MANIFEST: TransparencySourceManifest = {
  source: GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
  displayName: "Google Ads Transparency Center",
  accessState: "blocked",
  // No declaredRegions / declaredCategories: the terms note geographic/age
  // restrictions but do NOT enumerate a machine-accessible coverage set —
  // absent means absent, never a guessed coverage list.
  coverageNote:
    "Public web UI only. Google's terms note geographic/age restrictions and do not " +
    "enumerate a machine-accessible coverage set — no regions or categories are declared " +
    "for automated access, and no coverage is promised.",
  authorizationPathNote:
    "No sanctioned automated-access path exists today: no official API, and third-party " +
    "scrapers are not an approved path. The connector stays blocked until Google offers an " +
    "approved access method (explicit review required before any automated access).",
  termsUrl: "https://adstransparency.google.com/terms",
};

/**
 * The Google Ads Transparency Center adapter: every operation returns the
 * typed blocked state with the honest no-official-API reason. NO network,
 * NO scraping — this object is the seam that lights up if a sanctioned
 * access method ever exists.
 */
export class GoogleAdsTransparencyAdapter implements TransparencySourcePort {
  readonly descriptor = {
    source: GOOGLE_ADS_TRANSPARENCY_SOURCE_ID,
    version: ADAPTER_VERSION,
  } as const;
  readonly manifest = GOOGLE_ADS_TRANSPARENCY_MANIFEST;

  async query(
    _query: TransparencyQuery,
    options?: TransparencySourceOptions,
  ): Promise<TransparencyQueryResult> {
    rejectIfAborted(options);
    return { status: "blocked", reason: GOOGLE_ADS_TRANSPARENCY_BLOCKED_REASON };
  }
}

// ---------------------------------------------------------------------------
// Meta Ad Library — PENDING-AUTHORIZATION (app review + business + ID)
// ---------------------------------------------------------------------------

export const META_AD_LIBRARY_SOURCE_ID = "meta-ad-library";

/** The honest pending reason — names the application path (the charter's rule). */
export const META_AD_LIBRARY_PENDING_REASON =
  "Meta Ad Library API (Graph API ads_archive) is PENDING-AUTHORIZATION: access requires " +
  "app review plus business verification plus ID verification — apply through Meta's " +
  "developer application path. Coverage stays limited to ads about social issues, elections " +
  "and politics by region (no global-completeness claim). Until the application clears, ad " +
  "data reaches the Ad Center through the import path (ads.import).";

/** Meta's manifest — the coverage declaration AS its own terms state it. */
export const META_AD_LIBRARY_MANIFEST: TransparencySourceManifest = {
  source: META_AD_LIBRARY_SOURCE_ID,
  displayName: "Meta Ad Library",
  accessState: "pending-authorization",
  // Categories AS DECLARED by Meta's own terms (the audit's recorded
  // constraint); regions NOT declared — coverage varies BY REGION and the
  // terms do not enumerate the region set (absent means absent).
  declaredCategories: ["social issues", "elections", "politics"],
  coverageNote:
    "Coverage is limited to ads about social issues, elections and politics, varying by " +
    "region — Meta's terms declare no global-completeness. Regions are not enumerated " +
    "(coverage differs per region); only the categories above are declared.",
  authorizationPathNote:
    "The Meta Ad Library API (Graph API ads_archive) requires app review plus business " +
    "verification plus ID verification — apply through Meta's developer application path; " +
    "coverage remains region- and category-limited after authorization.",
  termsUrl: "https://developers.facebook.com/docs/ads_archive",
};

/**
 * The Meta Ad Library adapter: every operation returns the typed
 * pending-authorization state naming the application path. NO network —
 * this object is the seam that lights up when the application clears.
 */
export class MetaAdLibraryAdapter implements TransparencySourcePort {
  readonly descriptor = {
    source: META_AD_LIBRARY_SOURCE_ID,
    version: ADAPTER_VERSION,
  } as const;
  readonly manifest = META_AD_LIBRARY_MANIFEST;

  async query(
    _query: TransparencyQuery,
    options?: TransparencySourceOptions,
  ): Promise<TransparencyQueryResult> {
    rejectIfAborted(options);
    return { status: "pending-authorization", reason: META_AD_LIBRARY_PENDING_REASON };
  }
}

// ---------------------------------------------------------------------------
// TikTok Commercial Content — PENDING-AUTHORIZATION (research access)
// ---------------------------------------------------------------------------

export const TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID = "tiktok-commercial-content";

/** The honest pending reason — names the approved-research-access path. */
export const TIKTOK_COMMERCIAL_CONTENT_PENDING_REASON =
  "TikTok Commercial Content API is PENDING-AUTHORIZATION: access requires approved " +
  "research access (application; EU/US regions), with fields, query limits and retention " +
  "constraints per the access agreement — apply through TikTok's research-access " +
  "application path. Until the application clears, ad data reaches the Ad Center through " +
  "the import path (ads.import).";

/** TikTok's manifest — the coverage declaration AS its own terms state it. */
export const TIKTOK_COMMERCIAL_CONTENT_MANIFEST: TransparencySourceManifest = {
  source: TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
  displayName: "TikTok Commercial Content",
  accessState: "pending-authorization",
  // Regions AS DECLARED by TikTok's own access terms (the audit's recorded
  // EU/US constraint); no categories are declared by the terms.
  declaredRegions: ["EU", "US"],
  coverageNote:
    "Approved research access covers the EU and US regions; fields, query limits and " +
    "retention constraints apply per the access agreement. No categories are declared " +
    "and no coverage beyond the declared regions is promised.",
  authorizationPathNote:
    "The TikTok Commercial Content API requires approved research access (application; " +
    "EU/US regions) — apply through TikTok's research-access application path; the same " +
    "gate as Meta: no automated access until the application clears.",
  termsUrl: "https://developers.tiktok.com/doc/commercial-content-api-getting-started",
};

/**
 * The TikTok Commercial Content adapter: every operation returns the
 * typed pending-authorization state naming the approved-research-access
 * path. NO network — this object is the seam that lights up when the
 * application clears.
 */
export class TikTokCommercialContentAdapter implements TransparencySourcePort {
  readonly descriptor = {
    source: TIKTOK_COMMERCIAL_CONTENT_SOURCE_ID,
    version: ADAPTER_VERSION,
  } as const;
  readonly manifest = TIKTOK_COMMERCIAL_CONTENT_MANIFEST;

  async query(
    _query: TransparencyQuery,
    options?: TransparencySourceOptions,
  ): Promise<TransparencyQueryResult> {
    rejectIfAborted(options);
    return { status: "pending-authorization", reason: TIKTOK_COMMERCIAL_CONTENT_PENDING_REASON };
  }
}
