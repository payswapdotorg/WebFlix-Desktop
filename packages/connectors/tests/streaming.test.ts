/**
 * Fixture-only test-suite for the streaming handoff family
 * (P7-STREAM-HANDOFF-1, WF-012 — Netflix, Prime Video, Paramount+ as
 * EXTERNAL-handoff providers). Hermetic by construction: the family HAS no
 * network boundary to inject — zero adapters, zero fetch, zero credentials —
 * so every test exercises pure declarations and pure derivations.
 *
 * What this suite proves, in the order's own words:
 *   1. manifest validity — three providers, external-handoff class, typed
 *      unsupported reasons (the order-verbatim DRM/licensed-streaming
 *      reason in EVERY row);
 *   2. deep-link plan derivation — additive composition: every derived plan
 *      parses against the FROZEN ExternalDeepLinkPlanSchema and the full
 *      frozen PlaybackPlanSchema discriminated union;
 *   3. NO in-app playback claim anywhere — machine-asserted: no operation
 *      row in any streaming manifest carries any status other than the
 *      frozen `unsupported`, and no derivation ever returns an
 *      official-embed or local-file plan;
 *   4. honest isolation flags — the external handoff NEVER inherits the app
 *      session (frozen false-typed flags on every derived handoff).
 *
 * The frozen-vocabulary mapping is part of what is under test: the order's
 * `unsupported-in-app` status literal does NOT exist in the frozen §2.3
 * CapabilityStatus vocabulary (and contract edits are a hard non-goal), so
 * the family maps it onto `unsupported` + the typed reason in detail with
 * the `unsupported-in-app:` discriminator prefix — asserted below, never
 * silently assumed.
 *
 * Scope honesty (mirrors the module docblocks): the family is delivered as
 * source + these tests; it is NOT wired into the package index
 * (src/index.ts) or createDefaultRegistry() (src/registry.ts) — those files
 * are outside this order's Allowed-paths grant and stay untouched. The
 * direct module imports below (../src/streaming/*) are deliberate: they are
 * the only imports available without that wiring, and they keep the suite
 * hermetic against future registration decisions either way.
 */
import { describe, expect, it } from "vitest";

import {
  AbsoluteUrlSchema,
  ConnectorManifestSchema,
  ExternalDeepLinkPlanSchema,
  PlaybackPlanSchema,
  type ConnectorManifest,
} from "webflix-contracts";

import { ConnectorRegistry, validateManifest } from "../src/registry";
import {
  isExternalHandoffManifest,
  netflixManifest,
  NETFLIX_PROVIDER_ID,
  NETFLIX_TITLE_URL_TEMPLATE,
  paramountPlusManifest,
  PARAMOUNT_PLUS_MOVIE_URL_TEMPLATE,
  PARAMOUNT_PLUS_PROVIDER_ID,
  PARAMOUNT_PLUS_SHOW_URL_TEMPLATE,
  PRIME_VIDEO_DETAIL_URL_TEMPLATE,
  PRIME_VIDEO_PROVIDER_ID,
  primeVideoManifest,
  STREAMING_DEEP_LINK_MECHANISM_KIND,
  STREAMING_DEEP_LINK_MECHANISMS,
  STREAMING_FAMILY_PROVENANCE,
  STREAMING_HANDOFF_ISOLATION,
  STREAMING_HANDOFF_REASON,
  STREAMING_MANIFESTS,
  STREAMING_PROVIDER_CLASS,
  STREAMING_UNSUPPORTED_IN_APP_PREFIX,
} from "../src/streaming/manifest";
import {
  buildStreamingHandoff,
  foldStreamingMediaId,
  InvalidStreamingMediaIdError,
  netflixHandoff,
  paramountPlusHandoff,
  primeVideoHandoff,
  UnknownStreamingProviderError,
  type StreamingHandoff,
} from "../src/streaming/handoff";

// ---------------------------------------------------------------------------
// Fixtures (caller-supplied provider ids, the shapes the live probes ground)
// ---------------------------------------------------------------------------

const NETFLIX_TITLE_ID = "81161626";
const PRIME_ASIN = "B0DBRC1MFN";
const PARAMOUNT_SHOW_SLUG = "star-trek-strange-new-worlds";
const PARAMOUNT_MOVIE_SLUG = "the-godfather";

const ALL_STREAMING_MANIFESTS: readonly [string, ConnectorManifest][] = [
  [NETFLIX_PROVIDER_ID, STREAMING_MANIFESTS[0]],
  [PRIME_VIDEO_PROVIDER_ID, STREAMING_MANIFESTS[1]],
  [PARAMOUNT_PLUS_PROVIDER_ID, STREAMING_MANIFESTS[2]],
];

// ---------------------------------------------------------------------------
// 1. Manifest validity — three providers, external-handoff class, typed
//    unsupported reasons
// ---------------------------------------------------------------------------

describe("streaming manifest validity (three external-handoff providers)", () => {
  it("declares exactly the three providers of the streaming trio", () => {
    expect(STREAMING_MANIFESTS).toHaveLength(3);
    expect(STREAMING_MANIFESTS.map((m) => m.providerId).sort()).toEqual([
      "netflix",
      "paramount-plus",
      "prime-video",
    ]);
    expect(netflixManifest.providerId).toBe("netflix");
    expect(primeVideoManifest.providerId).toBe("prime-video");
    expect(paramountPlusManifest.providerId).toBe("paramount-plus");
  });

  it("parses every manifest against the FROZEN ConnectorManifestSchema", () => {
    for (const manifest of STREAMING_MANIFESTS) {
      const parsed = ConnectorManifestSchema.safeParse(manifest);
      expect(parsed.success, `frozen-schema parse for ${manifest.providerId}`).toBe(true);
    }
  });

  it("passes the shared registry's structural honesty validation", () => {
    for (const manifest of STREAMING_MANIFESTS) {
      expect(() => validateManifest(manifest)).not.toThrow();
    }
  });

  it("registers without collision in a fresh ConnectorRegistry", () => {
    const registry = new ConnectorRegistry();
    for (const manifest of STREAMING_MANIFESTS) {
      registry.register(manifest);
    }
    expect(registry.size).toBe(3);
    expect(registry.has(NETFLIX_PROVIDER_ID)).toBe(true);
    expect(registry.has(PRIME_VIDEO_PROVIDER_ID)).toBe(true);
    expect(registry.has(PARAMOUNT_PLUS_PROVIDER_ID)).toBe(true);
  });

  it("declares the external-handoff provider class", () => {
    expect(STREAMING_PROVIDER_CLASS).toBe("external-handoff");
    for (const [, manifest] of ALL_STREAMING_MANIFESTS) {
      expect(isExternalHandoffManifest(manifest)).toBe(true);
    }
  });

  it("carries the typed reason VERBATIM in every operation row of all three manifests", () => {
    expect(STREAMING_HANDOFF_REASON).toBe(
      "DRM and licensed-streaming constraints — official site/player only",
    );
    for (const [providerId, manifest] of ALL_STREAMING_MANIFESTS) {
      const rows = Object.entries(manifest.operations);
      expect(rows.length, `${providerId} operation count`).toBeGreaterThan(0);
      for (const [operationId, capability] of rows) {
        expect(capability.status, `${providerId}/${operationId} status`).toBe("unsupported");
        expect(capability.detail, `${providerId}/${operationId} detail present`).toBeDefined();
        expect(capability.detail).toContain(STREAMING_HANDOFF_REASON);
        expect(capability.detail!.startsWith(`${STREAMING_UNSUPPORTED_IN_APP_PREFIX} `)).toBe(true);
      }
    }
  });

  it("speaks the shared operation vocabulary (dot-namespaced ids, frozen schema shape)", () => {
    for (const [, manifest] of ALL_STREAMING_MANIFESTS) {
      for (const operationId of Object.keys(manifest.operations)) {
        expect(operationId).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
      }
      // The app's core asks are all answered honestly.
      for (const expected of ["playback.embed", "playback.resolve", "oauth.connect"]) {
        expect(manifest.operations[expected], `${manifest.providerId}/${expected}`).toBeDefined();
      }
    }
  });

  it("declares ZERO network truthfully: zero-request quota envelope, no failure modes, no region claim", () => {
    for (const [, manifest] of ALL_STREAMING_MANIFESTS) {
      expect(manifest.quotas.requestsPerWindow).toBe(0);
      expect(manifest.quotas.windowMs).toBeGreaterThan(0);
      expect(manifest.failureModes).toEqual([]);
      expect(manifest.regions).toEqual([]);
    }
  });

  it("publishes one deep-link mechanism per provider (the one thing the family declares)", () => {
    expect(STREAMING_DEEP_LINK_MECHANISM_KIND).toBe("deep-link");
    for (const [providerId, mechanism] of Object.entries(STREAMING_DEEP_LINK_MECHANISMS)) {
      expect(mechanism.kind).toBe("deep-link");
      expect(mechanism.providerId).toBe(providerId);
      expect(mechanism.watchUrlTemplate).toContain("{mediaId}");
      expect(mechanism.urlTemplateBasis.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STREAMING_DEEP_LINK_MECHANISMS).sort()).toEqual([
      "netflix",
      "paramount-plus",
      "prime-video",
    ]);
  });

  it("carries family-level provenance citations (order + phase-7 plan)", () => {
    expect(STREAMING_FAMILY_PROVENANCE.length).toBeGreaterThanOrEqual(2);
    const urls = STREAMING_FAMILY_PROVENANCE.map((note) => note.url);
    expect(urls).toContain("docs/plans/work-orders/P7-STREAM-HANDOFF-1.md");
    expect(urls).toContain("docs/plans/phase7-expanded-rows-plan.md");
  });
});

// ---------------------------------------------------------------------------
// 2. Deep-link plan derivation — additive composition with the frozen
//    external-deep-link plan kind
// ---------------------------------------------------------------------------

describe("deep-link handoff derivation (additive composition)", () => {
  it("derives the Netflix official title-page deep link", () => {
    const handoff = netflixHandoff(NETFLIX_TITLE_ID);
    expect(handoff.providerId).toBe(NETFLIX_PROVIDER_ID);
    expect(handoff.plan.kind).toBe("external-deep-link");
    expect(handoff.plan.url).toBe(`https://www.netflix.com/title/${NETFLIX_TITLE_ID}`);
  });

  it("derives the Prime Video official detail-page deep link (ASIN)", () => {
    const handoff = primeVideoHandoff(PRIME_ASIN);
    expect(handoff.providerId).toBe(PRIME_VIDEO_PROVIDER_ID);
    expect(handoff.plan.url).toBe(`https://www.amazon.com/gp/video/detail/${PRIME_ASIN}/`);
  });

  it("derives Paramount+ show and movie deep links on their distinct official surfaces", () => {
    const show = paramountPlusHandoff(PARAMOUNT_SHOW_SLUG);
    expect(show.plan.url).toBe(`https://www.paramountplus.com/shows/${PARAMOUNT_SHOW_SLUG}/`);
    expect(show.plan.url).toBe(
      PARAMOUNT_PLUS_SHOW_URL_TEMPLATE.replace("{mediaId}", PARAMOUNT_SHOW_SLUG),
    );

    const movie = paramountPlusHandoff(PARAMOUNT_MOVIE_SLUG, "movie");
    expect(movie.plan.url).toBe(`https://www.paramountplus.com/movies/${PARAMOUNT_MOVIE_SLUG}/`);
    expect(movie.plan.url).toBe(
      PARAMOUNT_PLUS_MOVIE_URL_TEMPLATE.replace("{mediaId}", PARAMOUNT_MOVIE_SLUG),
    );

    // The default surface is the show page (single documented default).
    expect(paramountPlusHandoff(PARAMOUNT_SHOW_SLUG).plan.url).toBe(
      paramountPlusHandoff(PARAMOUNT_SHOW_SLUG, "show").plan.url,
    );
  });

  it("ADDITIVITY: every derived plan parses against the frozen ExternalDeepLinkPlanSchema AND the full frozen PlaybackPlanSchema union", () => {
    const handoffs: StreamingHandoff[] = [
      netflixHandoff(NETFLIX_TITLE_ID),
      primeVideoHandoff(PRIME_ASIN),
      paramountPlusHandoff(PARAMOUNT_SHOW_SLUG),
      paramountPlusHandoff(PARAMOUNT_MOVIE_SLUG, "movie"),
    ];
    for (const handoff of handoffs) {
      const asDeepLink = ExternalDeepLinkPlanSchema.safeParse(handoff.plan);
      expect(asDeepLink.success, `ExternalDeepLinkPlanSchema for ${handoff.providerId}`).toBe(true);
      const asUnion = PlaybackPlanSchema.safeParse(handoff.plan);
      expect(asUnion.success, `PlaybackPlanSchema union accepts ${handoff.providerId}`).toBe(true);
    }
  });

  it("REFUSES unknown providers with the typed error (never a guessed URL)", () => {
    expect(() => buildStreamingHandoff({ providerId: "hulu", mediaId: "x" })).toThrow(
      UnknownStreamingProviderError,
    );
    expect(() => buildStreamingHandoff({ providerId: "disney-plus", mediaId: "x" })).toThrow(
      /unknown streaming handoff provider/,
    );
  });

  it("REFUSES provider ids that do not match the declared official shape (never invented ids)", () => {
    // Netflix expects the numeric title-id shape.
    expect(() => netflixHandoff("not-a-number")).toThrow(InvalidStreamingMediaIdError);
    expect(() => netflixHandoff("")).toThrow(InvalidStreamingMediaIdError);
    // Prime Video expects the 10-char uppercase ASIN shape.
    expect(() => primeVideoHandoff("too-short")).toThrow(InvalidStreamingMediaIdError);
    expect(() => primeVideoHandoff("B0DBRC1MFN!")).toThrow(InvalidStreamingMediaIdError);
    // Paramount+ expects a lowercase slug shape.
    expect(() => paramountPlusHandoff("Bad_Slug!")).toThrow(InvalidStreamingMediaIdError);
    expect(() => paramountPlusHandoff("")).toThrow(InvalidStreamingMediaIdError);
    // The refusal message names the expected shape honestly.
    expect(() => netflixHandoff("abc")).toThrow(/refusing to build a handoff plan/);
  });

  it("encodes URL-unsafe id characters in the pure template fold", () => {
    expect(foldStreamingMediaId(NETFLIX_TITLE_URL_TEMPLATE, "81161626")).toBe(
      "https://www.netflix.com/title/81161626",
    );
    expect(foldStreamingMediaId(PRIME_VIDEO_DETAIL_URL_TEMPLATE, "B0DBRC1MFN")).toBe(
      "https://www.amazon.com/gp/video/detail/B0DBRC1MFN/",
    );
    expect(foldStreamingMediaId("https://example.test/w/{mediaId}/", "a b/c")).toBe(
      "https://example.test/w/a%20b%2Fc/",
    );
  });

  it("is deterministic: identical requests derive identical handoffs", () => {
    const a = netflixHandoff(NETFLIX_TITLE_ID);
    const b = netflixHandoff(NETFLIX_TITLE_ID);
    expect(a).toEqual(b);
    expect(a.plan).toEqual(b.plan);
  });
});

// ---------------------------------------------------------------------------
// 3. NO in-app playback claim anywhere (machine-asserted)
// ---------------------------------------------------------------------------

describe("no in-app playback claim (the honest totality)", () => {
  it("carries NO operation row with any status other than the frozen `unsupported`", () => {
    // The machine check behind the rg proof: not one row of any streaming
    // manifest claims supported / requires-auth / any playable status.
    const legalButUnclaimed = [
      "supported",
      "requires-auth",
      "unavailable",
      "rate-limited",
      "degraded",
      "unknown",
    ];
    for (const [, manifest] of ALL_STREAMING_MANIFESTS) {
      for (const [operationId, capability] of Object.entries(manifest.operations)) {
        expect(legalButUnclaimed, `${manifest.providerId}/${operationId}`).not.toContain(
          capability.status,
        );
      }
    }
  });

  it("derives ONLY external-deep-link plans — never official-embed, never local-file, never isolated-website", () => {
    const derived = [
      netflixHandoff(NETFLIX_TITLE_ID).plan,
      primeVideoHandoff(PRIME_ASIN).plan,
      paramountPlusHandoff(PARAMOUNT_SHOW_SLUG).plan,
      paramountPlusHandoff(PARAMOUNT_MOVIE_SLUG, "movie").plan,
    ];
    for (const plan of derived) {
      expect(plan.kind).toBe("external-deep-link");
      expect(["official-embed", "local-file", "isolated-website"]).not.toContain(plan.kind);
    }
  });

  it("declares no embed mechanism — the family's only mechanism class is deep-link", () => {
    for (const mechanism of Object.values(STREAMING_DEEP_LINK_MECHANISMS)) {
      expect(mechanism.kind).toBe("deep-link");
      expect(mechanism.kind).not.toBe("official-embed-surface");
    }
  });

  it("keeps every derived URL secret-free (frozen AbsoluteUrl guard)", () => {
    // The frozen ExternalDeepLinkPlanSchema embeds the AbsoluteUrl guard that
    // refuses raw secret material; parsing the derived plans (above) already
    // proves it. Here the same guard is applied to the site roots.
    for (const mechanism of Object.values(STREAMING_DEEP_LINK_MECHANISMS)) {
      expect(AbsoluteUrlSchema.safeParse(mechanism.siteUrl).success).toBe(true);
      expect(AbsoluteUrlSchema.safeParse(mechanism.watchUrlTemplate).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Honest isolation flags — the external handoff never inherits the app
//    session
// ---------------------------------------------------------------------------

describe("honest isolation flags (external handoff never inherits the app session)", () => {
  it("freezes the honest isolation record", () => {
    expect(STREAMING_HANDOFF_ISOLATION.inheritsAppSession).toBe(false);
    expect(STREAMING_HANDOFF_ISOLATION.carriesCredentials).toBe(false);
    expect(STREAMING_HANDOFF_ISOLATION.sharesAppCookies).toBe(false);
    expect(STREAMING_HANDOFF_ISOLATION.opensIn).toBe("external-context");
  });

  it("carries the frozen isolation record on EVERY derived handoff (by reference — one source of truth)", () => {
    const handoffs = [
      netflixHandoff(NETFLIX_TITLE_ID),
      primeVideoHandoff(PRIME_ASIN),
      paramountPlusHandoff(PARAMOUNT_SHOW_SLUG),
      paramountPlusHandoff(PARAMOUNT_MOVIE_SLUG, "movie"),
    ];
    for (const handoff of handoffs) {
      expect(handoff.isolation).toBe(STREAMING_HANDOFF_ISOLATION);
      expect(handoff.isolation.inheritsAppSession).toBe(false);
      expect(handoff.isolation.carriesCredentials).toBe(false);
      expect(handoff.isolation.sharesAppCookies).toBe(false);
    }
  });

  it("rides no session material on the handoff URL itself (query-string honesty)", () => {
    // The derived URLs carry ONLY the folded media id — no token, session,
    // credential, or auth query parameters ride the deep link.
    const handoffs = [
      netflixHandoff(NETFLIX_TITLE_ID),
      primeVideoHandoff(PRIME_ASIN),
      paramountPlusHandoff(PARAMOUNT_SHOW_SLUG),
    ];
    for (const handoff of handoffs) {
      const url = new URL(handoff.plan.url);
      expect(url.search, `no query on ${handoff.plan.url}`).toBe("");
      expect(/token|session|auth|credential|password|secret|key/i.test(url.href)).toBe(false);
    }
  });
});
