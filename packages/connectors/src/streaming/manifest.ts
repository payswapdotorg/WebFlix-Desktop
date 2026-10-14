/**
 * Streaming-services ConnectorManifest family — P7-STREAM-HANDOFF-1
 * (Phase-7 wave-3, WF-012): Netflix, Prime Video and Paramount+ as
 * EXTERNAL-handoff providers, honestly.
 *
 * THE DESIGN IN ONE SENTENCE: licensed streaming services play on their own
 * official site/player and NOWHERE ELSE — so every operation this family
 * declares is `unsupported-in-app` with the same typed reason, and the ONLY
 * thing the family publishes is a `deep-link` mechanism class pointing at
 * the providers' own official surfaces.
 *
 * FROZEN-VOCABULARY HONESTY (recorded, not papered over): the order's
 * per-operation status literal is `unsupported-in-app`; the frozen §2.3
 * CapabilityStatus vocabulary is
 * {supported, requires-auth, unsupported, unavailable, rate-limited,
 * degraded, unknown} and carries NO `unsupported-in-app` member — and
 * contract edits are a hard non-goal of this order. Every row therefore
 * lands on the nearest frozen status `unsupported` with the typed reason
 * carried verbatim in OperationCapability.detail, prefixed by the
 * machine-readable `unsupported-in-app:` discriminator so the in-app
 * semantics stay extractable at the connectors layer without touching the
 * frozen shapes. The mapping is stated here, in the tests, and in the
 * delivery report — never silently.
 *
 * TYPED REASON (order-verbatim):
 *   "DRM and licensed-streaming constraints — official site/player only"
 *
 * ZERO NETWORK (hard): this family has NO network adapters, NO fetch of any
 * provider surface, NO scraping, NO DRM-adjacent anything, NO credentials.
 * The official URLs below are HANDOFF TARGETS — strings the app hands to the
 * user's external browser / the provider's own app at the user's request.
 * Nothing in this family ever requests them. quotas therefore truthfully
 * declare zero requests per window, and failureModes truthfully declares an
 * empty list: there is no network path in this connector that can fail.
 *
 * OFFICIAL SURFACES the deep links point at (nothing else, never fetched):
 *   - Netflix      https://www.netflix.com  (canonical title page
 *                  /title/<numeric-id> — the shareable deep link shape the
 *                  provider's own site resolves; the /watch/<id> form folds
 *                  to /title/<id>?fromWatch=true when unauthenticated)
 *   - Prime Video  https://www.amazon.com/gp/video/detail/<ASIN>/ (the
 *                  detail-page shape the provider's own pages and help
 *                  forum publish; www.primevideo.com is the provider's
 *                  regional alternate surface)
 *   - Paramount+   https://www.paramountplus.com/shows/<slug>/ and
 *                  /movies/<slug>/ (the URL shapes the provider's own
 *                  social posts publish)
 *
 * LIVE-PROBE HONESTY (work-order sandbox, HK datacenter egress, 2026-10-14;
 * recorded verbatim — the same class of egress the Reddit connector's 403
 * block page came from):
 *   - www.netflix.com/                        → 302 → /hk-en/ (reachable,
 *     regional locale redirect)
 *   - www.netflix.com/title/81215586          → 301 → /title/81215567 (the
 *     title surface itself resolves near-miss ids to a canonical title)
 *   - www.netflix.com/watch/258069505         → 302 → /title/258069505
 *     ?fromWatch=true (the watch form folds to the title page when
 *     unauthenticated — recorded, which is why the mechanism's canonical
 *     template is the /title/ form)
 *   - www.netflix.com/title/81161626          → 301 → /hk-en/title/81161626
 *     (a real title id resolves to the locale-prefixed canonical)
 *   - www.primevideo.com/                     → 302 → offers page
 *     (reachable)
 *   - www.amazon.com/gp/video/detail/B0DBRC1MFN → 200 (a real detail page,
 *     live-verified)
 *   - www.amazon.com/gp/video/detail/B0875SSWFS → 200 (a real detail page,
 *     live-verified)
 *   - www.amazon.com/gp/video/detail/B00FGAR6D6 → 404 (an INVENTED ASIN —
 *     honestly recorded: the connector never invents ids, it only folds
 *     caller-supplied provider ids into the template)
 *   - www.paramountplus.com (root, /shows/<real-slug>/, /movies/<slug>/)
 *     → HTTP 406 (Not Acceptable) to EVERY probe from this egress,
 *     browser-like headers included — the surface is not verifiable from
 *     this sandbox. The Paramount+ template shapes are grounded in the
 *     provider's own published links (its @paramountplus social posts
 *     reference paramountplus.com/shows/<slug>), NOT in a live 200, and the
 *     mechanism's basis label says exactly that. No 200 is claimed that was
 *     not observed.
 *
 * HONEST ISOLATION (the WF-012 point): the external handoff NEVER inherits
 * the app session — no WebFlix session, cookies, or credentials ride the
 * deep link; the target opens in the user's external browser / provider
 * app. The flags are frozen constants below and are asserted by test.
 *
 * REGISTRATION HONESTY (scope): this order's path grant is the streaming
 * family directory + tests only (the ledger's Allowed-paths column); the
 * package index (src/index.ts) and createDefaultRegistry() (src/registry.ts)
 * are OUTSIDE the grant and are NOT edited. The family is delivered as
 * source + hermetic tests; wiring it into the package's public exports and
 * the default registry is a one-line additive change reserved to the holder
 * of those files (TL2 / the compositing order) — stated here and in the
 * report rather than smuggled in.
 *
 * Operation ids are dot-namespaced per the frozen OperationIdSchema
 * (^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$), using the same operation nouns the
 * other families speak (catalog.*, playback.*, video.download,
 * history.provider, recommendations.browse, oauth.*, search.*) so the app
 * can ask every family the same questions and get the same honest answer:
 * not in this app — on the provider's official site/player.
 */
import type { ConnectorManifest, OperationCapability } from "webflix-contracts";

// ---------------------------------------------------------------------------
// Family + provider identity
// ---------------------------------------------------------------------------

/** The family id (a label for the streaming-handoff family, not a provider). */
export const STREAMING_FAMILY_ID = "streaming";

export const NETFLIX_PROVIDER_ID = "netflix";
export const NETFLIX_DISPLAY_NAME = "Netflix";

export const PRIME_VIDEO_PROVIDER_ID = "prime-video";
export const PRIME_VIDEO_DISPLAY_NAME = "Prime Video";

export const PARAMOUNT_PLUS_PROVIDER_ID = "paramount-plus";
export const PARAMOUNT_PLUS_DISPLAY_NAME = "Paramount+";

export const STREAMING_MANIFEST_VERSION = "1.0.0";

/** Constant seed timestamp (connector introduction; no live calls exist). */
export const STREAMING_MANIFEST_GENERATED_AT = "2026-10-14T00:00:00Z";

// ---------------------------------------------------------------------------
// The typed reason + the frozen-vocabulary mapping
// ---------------------------------------------------------------------------

/**
 * The typed reason every streaming-family unsupported row carries —
 * ORDER-VERBATIM: "DRM and licensed-streaming constraints — official
 * site/player only".
 */
export const STREAMING_HANDOFF_REASON =
  "DRM and licensed-streaming constraints — official site/player only";

/**
 * The machine-readable in-app discriminator. The frozen §2.3
 * CapabilityStatus vocabulary has no `unsupported-in-app` member (and
 * contract edits are a hard non-goal), so the family maps the order's
 * `unsupported-in-app` status onto the nearest frozen status `unsupported`
 * and prefixes the detail with this discriminator.
 */
export const STREAMING_UNSUPPORTED_IN_APP_PREFIX = "unsupported-in-app:";

/**
 * Composes one unsupported-in-app operation row: frozen status
 * `unsupported` + detail = "<prefix> <typed reason> — <per-operation
 * handoff note>". The registry's honesty rule (unsupported rows must explain
 * themselves) is satisfied by construction; the tests additionally assert
 * the typed reason appears verbatim in EVERY row.
 */
function unsupportedInApp(handoffNote: string): OperationCapability {
  return {
    status: "unsupported",
    detail: `${STREAMING_UNSUPPORTED_IN_APP_PREFIX} ${STREAMING_HANDOFF_REASON} — ${handoffNote}`,
  };
}

// ---------------------------------------------------------------------------
// Official surfaces (handoff targets ONLY — never fetched by this family)
// ---------------------------------------------------------------------------

/** Netflix official site root (handoff target). */
export const NETFLIX_SITE_URL = "https://www.netflix.com";

/** The canonical shareable Netflix title deep link (the /title/ form). */
export const NETFLIX_TITLE_URL_TEMPLATE = "https://www.netflix.com/title/{mediaId}";

/**
 * The Netflix watch form (recorded for honesty: it 302-folds to the title
 * page when unauthenticated — live probe 2026-10-14 — so the mechanism's
 * canonical template is the /title/ form, never this one).
 */
export const NETFLIX_WATCH_URL_TEMPLATE = "https://www.netflix.com/watch/{mediaId}";

/** Prime Video detail pages on amazon.com (ASIN-addressed, handoff target). */
export const PRIME_VIDEO_DETAIL_URL_TEMPLATE = "https://www.amazon.com/gp/video/detail/{mediaId}/";

/** The provider's regional alternate surface (recorded, not canonical here). */
export const PRIME_VIDEO_SITE_URL = "https://www.primevideo.com";

/** Paramount+ official site root (handoff target). */
export const PARAMOUNT_PLUS_SITE_URL = "https://www.paramountplus.com";

/** Paramount+ show pages (slug-addressed, handoff target). */
export const PARAMOUNT_PLUS_SHOW_URL_TEMPLATE = "https://www.paramountplus.com/shows/{mediaId}/";

/** Paramount+ movie pages (slug-addressed, handoff target). */
export const PARAMOUNT_PLUS_MOVIE_URL_TEMPLATE = "https://www.paramountplus.com/movies/{mediaId}/";

// ---------------------------------------------------------------------------
// Honest isolation flags (WF-012: the external handoff never inherits the
// app session)
// ---------------------------------------------------------------------------

/**
 * The honest isolation contract of every external handoff this family
 * derives. The literal `false` types are load-bearing: a future edit that
 * flips one of these flags has to CHANGE THE TYPE, which review sees.
 */
export interface StreamingHandoffIsolation {
  /** The external handoff NEVER inherits the app session. */
  inheritsAppSession: false;
  /** No WebFlix credential ever rides a handoff deep link. */
  carriesCredentials: false;
  /** No WebFlix cookie jar is attached to the handoff target. */
  sharesAppCookies: false;
  /**
   * Where the handoff opens: the user's external browser / the provider's
   * own app — never a WebFlix-owned webview session.
   */
  opensIn: "external-context";
}

/** The single frozen isolation record every handoff carries (asserted by test). */
export const STREAMING_HANDOFF_ISOLATION: StreamingHandoffIsolation = {
  inheritsAppSession: false,
  carriesCredentials: false,
  sharesAppCookies: false,
  opensIn: "external-context",
};

// ---------------------------------------------------------------------------
// The deep-link mechanism class (the ONE thing this family publishes)
// ---------------------------------------------------------------------------

/** The mechanism class kind (order language: a `deep-link` mechanism class). */
export const STREAMING_DEEP_LINK_MECHANISM_KIND = "deep-link";

/** Provenance citation (connector-local, the family's discipline). */
export interface StreamingProvenanceNote {
  label: string;
  url: string;
}

/**
 * The deep-link mechanism class: WHERE the provider publishes official deep
 * links, and what id shape folds into the template. A declaration of
 * handoff targets — the family NEVER fetches any of these URLs.
 */
export interface StreamingDeepLinkMechanism {
  kind: typeof STREAMING_DEEP_LINK_MECHANISM_KIND;
  providerId: string;
  displayName: string;
  /** The provider's official site root (the no-id handoff target). */
  siteUrl: string;
  /**
   * The canonical official deep-link template; `{mediaId}` is replaced with
   * the caller-supplied provider-side id (never invented here).
   */
  watchUrlTemplate: string;
  /**
   * Additional official surface templates the provider publishes, keyed by
   * media kind (Paramount+ distinguishes /shows/ and /movies/; Netflix's
   * /watch/ form is recorded here for honesty, not as the canonical).
   */
  alternateTemplates: Readonly<Record<string, string>>;
  /** The id shape the template's {mediaId} expects (validated at handoff). */
  mediaIdPattern: string;
  /** Honest basis label for the template shapes (see live-probe record). */
  urlTemplateBasis: string;
}

// --- Netflix mechanism ------------------------------------------------------

const NETFLIX_MECHANISM: StreamingDeepLinkMechanism = {
  kind: STREAMING_DEEP_LINK_MECHANISM_KIND,
  providerId: NETFLIX_PROVIDER_ID,
  displayName: NETFLIX_DISPLAY_NAME,
  siteUrl: NETFLIX_SITE_URL,
  watchUrlTemplate: NETFLIX_TITLE_URL_TEMPLATE,
  alternateTemplates: {
    watch: NETFLIX_WATCH_URL_TEMPLATE,
  },
  mediaIdPattern: "^\\d{6,}$",
  urlTemplateBasis:
    "the provider's own /title/<numeric-id> shareable page — live-probed 2026-10-14 from the work-order sandbox (HK egress): /title/81161626 → 301 → /hk-en/title/81161626 (locale-fold, surface resolves), /title/81215586 → 301 → /title/81215567 (near-miss id folds to a canonical title), /watch/<id> → 302 → /title/<id>?fromWatch=true when unauthenticated (why /title/ is the canonical template); no third-party API is involved and this connector fetches nothing",
};

// --- Prime Video mechanism --------------------------------------------------

const PRIME_VIDEO_MECHANISM: StreamingDeepLinkMechanism = {
  kind: STREAMING_DEEP_LINK_MECHANISM_KIND,
  providerId: PRIME_VIDEO_PROVIDER_ID,
  displayName: PRIME_VIDEO_DISPLAY_NAME,
  siteUrl: PRIME_VIDEO_SITE_URL,
  watchUrlTemplate: PRIME_VIDEO_DETAIL_URL_TEMPLATE,
  alternateTemplates: {},
  mediaIdPattern: "^[A-Z0-9]{10}$",
  urlTemplateBasis:
    "the provider's own /gp/video/detail/<ASIN>/ detail-page shape — live-probed 2026-10-14 from the work-order sandbox (HK egress): real detail pages B0DBRC1MFN and B0875SSWFS both answered HTTP 200; an invented ASIN honestly answered 404 (this connector never invents ids); www.primevideo.com root answered 302 → offers page; the ASIN shape is 10 uppercase alphanumeric characters per the provider's own URL space",
};

// --- Paramount+ mechanism ---------------------------------------------------

const PARAMOUNT_PLUS_MECHANISM: StreamingDeepLinkMechanism = {
  kind: STREAMING_DEEP_LINK_MECHANISM_KIND,
  providerId: PARAMOUNT_PLUS_PROVIDER_ID,
  displayName: PARAMOUNT_PLUS_DISPLAY_NAME,
  siteUrl: PARAMOUNT_PLUS_SITE_URL,
  watchUrlTemplate: PARAMOUNT_PLUS_SHOW_URL_TEMPLATE,
  alternateTemplates: {
    movie: PARAMOUNT_PLUS_MOVIE_URL_TEMPLATE,
  },
  mediaIdPattern: "^[a-z0-9][a-z0-9-]*$",
  urlTemplateBasis:
    "the provider's own /shows/<slug>/ and /movies/<slug>/ page shapes, grounded in the links Paramount+ itself publishes on its official social channels (paramountplus.com/shows/<slug>); NOT live-verified — www.paramountplus.com answered HTTP 406 (Not Acceptable) to every probe from this work-order sandbox egress (root, real show slug, movie slug, browser-like headers included), so no 200 is claimed that was not observed; this connector fetches nothing either way",
};

/** All three deep-link mechanisms, keyed by providerId (deterministic order). */
export const STREAMING_DEEP_LINK_MECHANISMS: Readonly<Record<string, StreamingDeepLinkMechanism>> =
  {
    [NETFLIX_PROVIDER_ID]: NETFLIX_MECHANISM,
    [PRIME_VIDEO_PROVIDER_ID]: PRIME_VIDEO_MECHANISM,
    [PARAMOUNT_PLUS_PROVIDER_ID]: PARAMOUNT_PLUS_MECHANISM,
  };

/** The external-handoff class label this family declares (order language). */
export const STREAMING_PROVIDER_CLASS = "external-handoff";

// ---------------------------------------------------------------------------
// Per-operation capability rows — EVERY row unsupported-in-app
// ---------------------------------------------------------------------------

/**
 * The shared operation vocabulary for the streaming trio: the same operation
 * nouns the other families speak, so the app can ask every family the same
 * questions. EVERY row is unsupported-in-app with the typed reason —
 * licensed streaming plays on the provider's official site/player only.
 *
 * The per-provider handoff note names that provider's deep-link target so
 * each row is self-explanatory in the UI ("open on Netflix via
 * netflix.com/title/<id>").
 */
function streamingOperations(
  mechanism: StreamingDeepLinkMechanism,
): Readonly<Record<string, OperationCapability>> {
  const handoffTarget = `${mechanism.siteUrl} (deep link: ${mechanism.watchUrlTemplate})`;
  return {
    "catalog.browse": unsupportedInApp(
      `no in-app catalog browse — the catalog lives on the provider's official site; hand off to ${handoffTarget}`,
    ),
    "catalog.search": unsupportedInApp(
      `no in-app catalog search — search runs in the provider's own player/site; hand off to ${handoffTarget}`,
    ),
    "search.suggestions": unsupportedInApp(
      `no suggestion surface exists for third-party clients; the provider's own search lives on its site — hand off to ${handoffTarget}`,
    ),
    "playback.embed": unsupportedInApp(
      `no official embeddable player is published for third-party desktop apps — the licensed player runs on the provider's official site only; hand off to ${handoffTarget}`,
    ),
    "playback.resolve": unsupportedInApp(
      `no stream resolution happens in this app — licensed streams are served by the provider's own player; hand off to ${handoffTarget}`,
    ),
    "video.download": unsupportedInApp(
      `no offline downloads outside the provider's own app — the provider's licensed download surface stays in the provider's player; hand off to ${handoffTarget}`,
    ),
    "oauth.connect": unsupportedInApp(
      `no account connection — this connector holds no credentials and authenticates nothing; the provider's account lives on its official site; hand off to ${handoffTarget}`,
    ),
    "oauth.disconnect": unsupportedInApp(
      `no account connection exists to disconnect — this connector holds no credentials; account management stays on the provider's official site; hand off to ${handoffTarget}`,
    ),
    "history.provider": unsupportedInApp(
      `the provider's watch history is not readable by third-party clients; WebFlix keeps its OWN history and claims nothing provider-side; hand off to ${handoffTarget}`,
    ),
    "recommendations.browse": unsupportedInApp(
      `the provider's recommendations surface is first-party only; WebFlix's own library/collections are never dressed up as provider recommendations; hand off to ${handoffTarget}`,
    ),
    "profiles.manage": unsupportedInApp(
      `the provider's profile switching stays in the provider's own player; hand off to ${handoffTarget}`,
    ),
  };
}

export const NETFLIX_OPERATIONS: Readonly<Record<string, OperationCapability>> =
  streamingOperations(NETFLIX_MECHANISM);
export const PRIME_VIDEO_OPERATIONS: Readonly<Record<string, OperationCapability>> =
  streamingOperations(PRIME_VIDEO_MECHANISM);
export const PARAMOUNT_PLUS_OPERATIONS: Readonly<Record<string, OperationCapability>> =
  streamingOperations(PARAMOUNT_PLUS_MECHANISM);

// ---------------------------------------------------------------------------
// Family-level provenance citations (audit trail; connector-local — the
// family declares handoff-target surfaces, not API documentation)
// ---------------------------------------------------------------------------

export interface StreamingFamilyProvenance {
  label: string;
  url: string;
}

const WORK_ORDER_CITATION: StreamingFamilyProvenance = {
  label:
    "docs/plans/work-orders/P7-STREAM-HANDOFF-1.md — the binding order (WF-012 external-handoff class; typed unsupported reason verbatim; zero network/scraping/DRM-adjacent work)",
  url: "docs/plans/work-orders/P7-STREAM-HANDOFF-1.md",
};

const PHASE7_PLAN_CITATION: StreamingFamilyProvenance = {
  label:
    "docs/plans/phase7-expanded-rows-plan.md wave-3 — WF-012: official website/deep-link isolated handoff paths; no DRM promises",
  url: "docs/plans/phase7-expanded-rows-plan.md",
};

/** Family-level citations carried by every manifest (MR-FD3 precedent). */
export const STREAMING_FAMILY_PROVENANCE: readonly StreamingFamilyProvenance[] = [
  WORK_ORDER_CITATION,
  PHASE7_PLAN_CITATION,
];

// ---------------------------------------------------------------------------
// Manifests (frozen §2.3 shape) — one per provider, all external-handoff
// ---------------------------------------------------------------------------

function streamingManifest(
  mechanism: StreamingDeepLinkMechanism,
  operations: Readonly<Record<string, OperationCapability>>,
): ConnectorManifest {
  return {
    providerId: mechanism.providerId,
    operations,
    // Honest empty list: no positive served-region claim — the family serves
    // nothing in-app; where the provider's own site serves is the
    // provider's business, not a claim this manifest makes.
    regions: [],
    // TRUTHFUL ZERO: this family issues ZERO network requests (no adapter
    // exists), so the quota envelope is zero requests over a one-minute
    // nominal window — an honest statement of "no traffic", never a
    // rate-limit promise.
    quotas: {
      requestsPerWindow: 0,
      windowMs: 60_000,
    },
    provenance: {
      connectorId: mechanism.providerId,
      connectorVersion: STREAMING_MANIFEST_VERSION,
      generatedAt: STREAMING_MANIFEST_GENERATED_AT,
    },
    // TRUTHFUL EMPTY LIST: there is no network path in this connector that
    // can fail; the handoff target's availability is the provider's own
    // runtime concern, observed only by the user's external browser.
    failureModes: [],
  };
}

/** Netflix — EXTERNAL-handoff provider (unsupported-in-app everywhere). */
export const netflixManifest: ConnectorManifest = streamingManifest(
  NETFLIX_MECHANISM,
  NETFLIX_OPERATIONS,
);

/** Prime Video — EXTERNAL-handoff provider (unsupported-in-app everywhere). */
export const primeVideoManifest: ConnectorManifest = streamingManifest(
  PRIME_VIDEO_MECHANISM,
  PRIME_VIDEO_OPERATIONS,
);

/** Paramount+ — EXTERNAL-handoff provider (unsupported-in-app everywhere). */
export const paramountPlusManifest: ConnectorManifest = streamingManifest(
  PARAMOUNT_PLUS_MECHANISM,
  PARAMOUNT_PLUS_OPERATIONS,
);

/** All three streaming-family manifests, deterministic providerId order. */
export const STREAMING_MANIFESTS: readonly ConnectorManifest[] = [
  netflixManifest,
  primeVideoManifest,
  paramountPlusManifest,
];

// ---------------------------------------------------------------------------
// Machine-checkable honesty helpers (used by the test suite)
// ---------------------------------------------------------------------------

/**
 * The external-handoff class test: a streaming manifest is valid exactly
 * when every operation row is the frozen `unsupported` status carrying the
 * typed reason verbatim (the unsupported-in-app mapping), the declared
 * mechanism exists, and the isolation flags are the frozen honest record.
 */
export function isExternalHandoffManifest(manifest: ConnectorManifest): boolean {
  const operations = Object.values(manifest.operations);
  if (operations.length === 0) return false;
  const allUnsupportedWithReason = operations.every(
    (op) =>
      op.status === "unsupported" &&
      typeof op.detail === "string" &&
      op.detail.startsWith(`${STREAMING_UNSUPPORTED_IN_APP_PREFIX} `) &&
      op.detail.includes(STREAMING_HANDOFF_REASON),
  );
  const mechanismExists = manifest.providerId in STREAMING_DEEP_LINK_MECHANISMS;
  return allUnsupportedWithReason && mechanismExists;
}
