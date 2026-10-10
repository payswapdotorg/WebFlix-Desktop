/**
 * Round-trip tests for every contract schema in packages/webflix-contracts.
 *
 * For each schema: a known-good instance parses successfully and round-trips
 * unchanged (parsed output deep-equals the input, including through JSON
 * serialization), and a known-bad instance is rejected by safeParse.
 *
 * CredentialPort / CredentialRef are interface-only by contract and have no
 * runtime schema; they are exercised as compile-level seams in the account
 * suite below.
 */
import { describe, expect, it } from "vitest";
import * as contracts from "../index";
import {
  AbsoluteUrlSchema,
  AvailabilityFactSchema,
  CapabilityStatusSchema,
  CatalogItem,
  CatalogItemSchema,
  CollectionSchema,
  ConnectorManifestSchema,
  ConnectorQuotasSchema,
  CredentialPort,
  ErrorCode,
  ErrorCodeSchema,
  ExternalDeepLinkPlanSchema,
  FailureModeSchema,
  FingerprintSchema,
  IsolatedWebsitePlanSchema,
  IsoDateTimeSchema,
  JobDescriptor,
  JobDescriptorSchema,
  JobKindSchema,
  JobStateSchema,
  LocalFilePlanSchema,
  LocalLibraryEntrySchema,
  LocalMediaMetadataSchema,
  LocalPlaylistSchema,
  MatchEvidenceSchema,
  MediaKindSchema,
  OfficialEmbedPlanSchema,
  OperationCapabilitySchema,
  OperationIdSchema,
  PlaybackPlan,
  PlaybackPlanSchema,
  PlaybackProgressSchema,
  ProviderAccountRecord,
  ProviderAccountRecordSchema,
  ProviderAccountStatusSchema,
  ProviderAssetKindSchema,
  ProviderAssetSchema,
  ProvenanceSchema,
  RecoveryActionSchema,
  RecoveryHintSchema,
  RegionCodeSchema,
  RetryPolicySchema,
  SecretFreeRecordSchema,
  SecretFreeStringSchema,
  SmartQuerySchema,
  UnavailablePlanSchema,
  UnavailableReasonSchema,
  WatchedStateSchema,
  WebFlixError,
  WebFlixErrorShapeSchema,
  looksLikeSecret,
} from "../index";

const ISO_NOW = "2025-06-01T12:00:00Z";
const ISO_LATER = "2025-07-01T00:00:00Z";
const SHA256_TEST =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** Parses `valid`, asserts the output deep-equals the input and survives JSON. */
function expectRoundTrip(
  schema: { parse(value: unknown): unknown },
  valid: unknown,
): void {
  const parsed = schema.parse(valid);
  expect(parsed).toEqual(valid);
  expect(JSON.parse(JSON.stringify(parsed))).toEqual(valid);
}

/** Asserts `invalid` is rejected by `schema`. */
function expectRejected(
  schema: { safeParse(value: unknown): { success: boolean } },
  invalid: unknown,
): void {
  expect(schema.safeParse(invalid).success).toBe(false);
}

describe("public entrypoint", () => {
  it("re-exports the complete locked value surface", () => {
    const lockedValueExports = [
      "MediaKindSchema",
      "ProviderAssetKindSchema",
      "ProviderAssetSchema",
      "MatchEvidenceSchema",
      "AvailabilityFactSchema",
      "CatalogItemSchema",
      "UnavailableReasonSchema",
      "RecoveryActionSchema",
      "RecoveryHintSchema",
      "OfficialEmbedPlanSchema",
      "IsolatedWebsitePlanSchema",
      "LocalFilePlanSchema",
      "ExternalDeepLinkPlanSchema",
      "UnavailablePlanSchema",
      "PlaybackPlanSchema",
      "PlaybackProgressSchema",
      "CapabilityStatusSchema",
      "OperationIdSchema",
      "OperationCapabilitySchema",
      "ConnectorQuotasSchema",
      "ProvenanceSchema",
      "FailureModeSchema",
      "ConnectorManifestSchema",
      "LocalMediaMetadataSchema",
      "FingerprintSchema",
      "LocalLibraryEntrySchema",
      "SmartQuerySchema",
      "CollectionSchema",
      "LocalPlaylistSchema",
      "WatchedStateSchema",
      "ProviderAccountStatusSchema",
      "ProviderAccountRecordSchema",
      "JobStateSchema",
      "JobKindSchema",
      "RetryPolicySchema",
      "JobDescriptorSchema",
      "ErrorCodeSchema",
      "WebFlixErrorShapeSchema",
      "WebFlixError",
      "ErrorCode",
      "IsoDateTimeSchema",
      "RegionCodeSchema",
      "AbsoluteUrlSchema",
      "SecretFreeStringSchema",
      "SecretFreeRecordSchema",
      "looksLikeSecret",
    ];
    for (const name of lockedValueExports) {
      expect(contracts).toHaveProperty(name);
    }
  });
});

describe("internal/primitives", () => {
  it("IsoDateTimeSchema accepts UTC instants and rejects offsets/loose strings", () => {
    expectRoundTrip(IsoDateTimeSchema, ISO_NOW);
    expectRejected(IsoDateTimeSchema, "2025-06-01 12:00:00");
    expectRejected(IsoDateTimeSchema, "2025-06-01T12:00:00+02:00");
  });

  it("RegionCodeSchema accepts ISO 3166-1 alpha-2 codes", () => {
    expectRoundTrip(RegionCodeSchema, "US");
    expectRejected(RegionCodeSchema, "usa");
    expectRejected(RegionCodeSchema, "U");
  });

  it("AbsoluteUrlSchema accepts http(s) and app-scheme URLs, rejects secrets", () => {
    expectRoundTrip(AbsoluteUrlSchema, "https://example.com/watch?v=abc");
    expectRoundTrip(AbsoluteUrlSchema, "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
    expectRejected(AbsoluteUrlSchema, "not a url");
    expectRejected(AbsoluteUrlSchema, "app://callback?access_token=hunter2");
  });

  it("looksLikeSecret flags obvious credential material", () => {
    expect(looksLikeSecret("api_key=hunter2")).toBe(true);
    expect(looksLikeSecret("https://cdn.example.com/file?token=hunter2")).toBe(
      true,
    );
    expect(looksLikeSecret("https://example.com/watch?v=abc")).toBe(false);
  });

  it("SecretFreeStringSchema rejects token-bearing strings", () => {
    expectRoundTrip(SecretFreeStringSchema, "https://example.com/watch?v=abc");
    expectRejected(
      SecretFreeStringSchema,
      "https://cdn.example.com/file?token=hunter2",
    );
  });

  it("SecretFreeRecordSchema rejects secret keys and secret string values", () => {
    expectRoundTrip(SecretFreeRecordSchema, {
      videoId: "abc123",
      player: "iframe",
    });
    expectRejected(SecretFreeRecordSchema, { api_key: "hunter2" });
    expectRejected(SecretFreeRecordSchema, {
      src: "https://cdn.example.com/hls?token=hunter2",
    });
  });
});

describe("catalog", () => {
  it("MediaKindSchema accepts exactly the six locked kinds", () => {
    for (const kind of [
      "video",
      "short",
      "live",
      "podcast",
      "audio",
      "local-file",
    ]) {
      expect(MediaKindSchema.parse(kind)).toBe(kind);
    }
    expectRejected(MediaKindSchema, "hologram");
  });

  it("ProviderAssetKindSchema accepts exactly the locked asset kinds", () => {
    for (const kind of [
      "embed",
      "stream",
      "thumbnail",
      "artwork",
      "trailer",
      "subtitle",
      "download",
    ]) {
      expect(ProviderAssetKindSchema.parse(kind)).toBe(kind);
    }
    expectRejected(ProviderAssetKindSchema, "hologram");
  });

  it("ProviderAssetSchema round-trips a secret-free asset", () => {
    expectRoundTrip(ProviderAssetSchema, {
      assetId: "asset-001",
      kind: "thumbnail",
      reference: "https://img.example.com/cat-001.jpg",
      mimeType: "image/jpeg",
      version: "3",
      expiresAt: ISO_NOW,
    });
  });

  it("ProviderAssetSchema rejects references carrying raw secrets", () => {
    expectRejected(ProviderAssetSchema, {
      assetId: "asset-002",
      kind: "stream",
      reference: "https://cdn.example.com/stream.m3u8?token=hunter2",
    });
  });

  it("MatchEvidenceSchema round-trips and bounds confidence to [0, 1]", () => {
    expectRoundTrip(MatchEvidenceSchema, {
      confidence: 0.93,
      evidence: ["exact title match", "release year 1998 matches"],
    });
    expectRejected(MatchEvidenceSchema, {
      confidence: 1.5,
      evidence: ["too confident"],
    });
    expectRejected(MatchEvidenceSchema, { confidence: -0.1, evidence: [] });
  });

  it("AvailabilityFactSchema round-trips and requires region codes", () => {
    expectRoundTrip(AvailabilityFactSchema, {
      providerId: "netflix",
      region: "US",
      available: true,
      observedAt: ISO_NOW,
      untilAt: ISO_LATER,
      note: "Included with subscription",
    });
    expectRejected(AvailabilityFactSchema, {
      providerId: "netflix",
      region: "usa",
      available: true,
      observedAt: ISO_NOW,
    });
  });

  it("CatalogItemSchema round-trips a fully populated item", () => {
    expectRoundTrip(CatalogItemSchema, {
      id: "cat-001",
      providerId: "netflix",
      title: "Example Documentary",
      mediaKind: "video",
      assets: [
        {
          assetId: "asset-001",
          kind: "thumbnail",
          reference: "https://img.example.com/cat-001.jpg",
          mimeType: "image/jpeg",
          version: "3",
          expiresAt: ISO_NOW,
        },
      ],
      matchEvidence: { confidence: 0.93, evidence: ["exact title match"] },
      availability: {
        providerId: "netflix",
        region: "US",
        available: true,
        observedAt: ISO_NOW,
      },
      metadata: { externalIds: { tmdb: "12345" } },
    });
  });

  it("CatalogItemSchema rejects unknown media kinds", () => {
    expectRejected(CatalogItemSchema, {
      id: "cat-002",
      providerId: "netflix",
      title: "Broken Item",
      mediaKind: "hologram",
      assets: [],
      metadata: {},
    });
  });

  it("CatalogItemSchema fills defaults for omitted bags", () => {
    const parsed = CatalogItemSchema.parse({
      id: "cat-004",
      providerId: "netflix",
      title: "Defaults Item",
      mediaKind: "audio",
    });
    expect(parsed.assets).toEqual([]);
    expect(parsed.metadata).toEqual({});
  });

  it("CatalogItemSchema infers the locked CatalogItem type", () => {
    const item: CatalogItem = CatalogItemSchema.parse({
      id: "cat-003",
      providerId: "netflix",
      title: "Typed Item",
      mediaKind: "podcast",
      assets: [],
      metadata: {},
    });
    expect(item.mediaKind).toBe("podcast");
    expect(item.assets).toEqual([]);
  });
});

describe("playback", () => {
  it("UnavailableReasonSchema accepts exactly the seven locked reasons", () => {
    for (const reason of [
      "unsupported",
      "requires-auth",
      "region",
      "rate-limited",
      "removed",
      "offline",
      "policy-restricted",
    ]) {
      expect(UnavailableReasonSchema.parse(reason)).toBe(reason);
    }
    expectRejected(UnavailableReasonSchema, "expired");
  });

  it("RecoveryActionSchema accepts exactly the locked recovery actions", () => {
    for (const action of [
      "sign-in",
      "retry-later",
      "check-connection",
      "change-region",
      "open-provider-app",
      "open-system-settings",
      "contact-support",
    ]) {
      expect(RecoveryActionSchema.parse(action)).toBe(action);
    }
    expectRejected(RecoveryActionSchema, "wish-really-hard");
  });

  it("RecoveryHintSchema round-trips and rejects unknown actions and secret urls", () => {
    expectRoundTrip(RecoveryHintSchema, {
      action: "sign-in",
      message: "Connect your provider account in Settings → Accounts.",
      url: "https://accounts.example.com/connect",
    });
    expectRejected(RecoveryHintSchema, {
      action: "wish-really-hard",
      message: "nope",
    });
    expectRejected(RecoveryHintSchema, {
      action: "sign-in",
      message: "leaks credentials",
      url: "app://callback?access_token=hunter2",
    });
  });

  it("official-embed plan round-trips and rejects secret-bearing embed specs", () => {
    expectRoundTrip(OfficialEmbedPlanSchema, {
      kind: "official-embed",
      providerId: "youtube",
      embedSpec: { videoId: "dQw4w9WgXcQ", player: "iframe", startSeconds: 0 },
    });
    expectRejected(OfficialEmbedPlanSchema, {
      kind: "official-embed",
      providerId: "youtube",
      embedSpec: { api_key: "hunter2" },
    });
  });

  it("isolated-website plan round-trips and rejects non-URLs", () => {
    expectRoundTrip(IsolatedWebsitePlanSchema, {
      kind: "isolated-website",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expectRejected(IsolatedWebsitePlanSchema, {
      kind: "isolated-website",
      url: "not a url",
    });
  });

  it("local-file plan round-trips and rejects bad MIME types", () => {
    expectRoundTrip(LocalFilePlanSchema, {
      kind: "local-file",
      path: "/home/z/media/big-buck-bunny.mp4",
      mimeType: "video/mp4",
    });
    expectRejected(LocalFilePlanSchema, {
      kind: "local-file",
      path: "/home/z/media/big-buck-bunny.mp4",
      mimeType: "not-a-mime",
    });
  });

  it("external-deep-link plan round-trips and rejects secret-bearing links", () => {
    expectRoundTrip(ExternalDeepLinkPlanSchema, {
      kind: "external-deep-link",
      url: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
    });
    expectRejected(ExternalDeepLinkPlanSchema, {
      kind: "external-deep-link",
      url: "app://callback?access_token=hunter2",
    });
  });

  it("unavailable plan round-trips with and without a recovery hint", () => {
    expectRoundTrip(UnavailablePlanSchema, {
      kind: "unavailable",
      reason: "requires-auth",
      recovery: {
        action: "sign-in",
        message: "Sign in to your provider account.",
      },
    });
    expectRoundTrip(UnavailablePlanSchema, {
      kind: "unavailable",
      reason: "offline",
    });
    expectRejected(UnavailablePlanSchema, {
      kind: "unavailable",
      reason: "expired",
    });
  });

  it("PlaybackPlanSchema discriminates on kind and rejects unknown kinds", () => {
    const plan: PlaybackPlan = PlaybackPlanSchema.parse({
      kind: "local-file",
      path: "/home/z/media/big-buck-bunny.mp4",
      mimeType: "video/mp4",
    });
    if (plan.kind !== "local-file") {
      throw new Error("expected the local-file variant");
    }
    expect(plan.path).toBe("/home/z/media/big-buck-bunny.mp4");
    expectRejected(PlaybackPlanSchema, {
      kind: "torrent",
      url: "magnet:?xt=urn:btih:abc",
    });
  });

  it("PlaybackProgressSchema round-trips and rejects negative positions", () => {
    expectRoundTrip(PlaybackProgressSchema, {
      itemId: "cat-001",
      positionMs: 64000,
      durationMs: 3600000,
      updatedAt: ISO_NOW,
    });
    expectRejected(PlaybackProgressSchema, {
      itemId: "cat-001",
      positionMs: -1,
      durationMs: 3600000,
      updatedAt: ISO_NOW,
    });
  });
});

describe("capability", () => {
  it("CapabilityStatusSchema accepts exactly the seven locked statuses", () => {
    for (const status of [
      "supported",
      "requires-auth",
      "unsupported",
      "unavailable",
      "rate-limited",
      "degraded",
      "unknown",
    ]) {
      expect(CapabilityStatusSchema.parse(status)).toBe(status);
    }
    expectRejected(CapabilityStatusSchema, "excellent");
  });

  it("OperationIdSchema enforces dot-namespaced ids", () => {
    expectRoundTrip(OperationIdSchema, "playback.resolve");
    expectRejected(OperationIdSchema, "Playback Resolve");
    expectRejected(OperationIdSchema, "resolve");
  });

  it("OperationCapabilitySchema round-trips and rejects unknown statuses", () => {
    expectRoundTrip(OperationCapabilitySchema, {
      status: "supported",
      detail: "Search API is fully available.",
      checkedAt: ISO_NOW,
    });
    expectRejected(OperationCapabilitySchema, { status: "fine" });
  });

  it("ConnectorQuotasSchema round-trips and rejects negative request budgets", () => {
    expectRoundTrip(ConnectorQuotasSchema, {
      requestsPerWindow: 600,
      windowMs: 60000,
      maxConcurrent: 2,
      burst: 50,
    });
    expectRejected(ConnectorQuotasSchema, {
      requestsPerWindow: -1,
      windowMs: 60000,
    });
  });

  it("ProvenanceSchema round-trips and requires UTC instants", () => {
    expectRoundTrip(ProvenanceSchema, {
      connectorId: "webflix-connector-example",
      connectorVersion: "1.2.3",
      buildId: "ci-2025-06-01.42",
      generatedAt: ISO_NOW,
      inputsHash: `sha256:${SHA256_TEST}`,
    });
    expectRejected(ProvenanceSchema, {
      connectorId: "webflix-connector-example",
      connectorVersion: "1.2.3",
      generatedAt: "2025-06-01",
    });
  });

  it("FailureModeSchema accepts exactly the locked failure modes", () => {
    for (const mode of [
      "network",
      "timeout",
      "auth",
      "rate-limit",
      "region",
      "parse",
      "upstream",
      "unknown",
    ]) {
      expect(FailureModeSchema.parse(mode)).toBe(mode);
    }
    expectRejected(FailureModeSchema, "meteor");
  });

  it("ConnectorManifestSchema round-trips a full manifest", () => {
    expectRoundTrip(ConnectorManifestSchema, {
      providerId: "youtube",
      operations: {
        "catalog.search": { status: "supported", checkedAt: ISO_NOW },
        "playback.resolve": { status: "requires-auth" },
      },
      regions: ["US", "DE"],
      quotas: {
        requestsPerWindow: 600,
        windowMs: 60000,
        maxConcurrent: 2,
        burst: 50,
      },
      provenance: {
        connectorId: "webflix-connector-youtube",
        connectorVersion: "1.2.3",
        buildId: "ci-2025-06-01.42",
        generatedAt: ISO_NOW,
        inputsHash: `sha256:${SHA256_TEST}`,
      },
      failureModes: ["rate-limit", "network"],
    });
  });

  it("ConnectorManifestSchema rejects malformed region codes", () => {
    expectRejected(ConnectorManifestSchema, {
      providerId: "youtube",
      operations: {},
      regions: ["usa"],
      quotas: { requestsPerWindow: 600, windowMs: 60000 },
      provenance: {
        connectorId: "webflix-connector-youtube",
        connectorVersion: "1.2.3",
        generatedAt: ISO_NOW,
      },
      failureModes: [],
    });
  });
});

describe("library", () => {
  const fingerprint = `sha256:${SHA256_TEST}`;

  it("FingerprintSchema enforces <algorithm>:<hex digest>", () => {
    expectRoundTrip(FingerprintSchema, fingerprint);
    expectRejected(FingerprintSchema, "totally-not-a-hash");
    expectRejected(FingerprintSchema, `sha256:${"zz".repeat(32)}`);
  });

  it("LocalMediaMetadataSchema round-trips and rejects empty titles", () => {
    expectRoundTrip(LocalMediaMetadataSchema, {
      title: "Big Buck Bunny",
      durationMs: 596000,
      mimeType: "video/mp4",
      sizeBytes: 158008374,
      tags: ["animation", "creative-commons"],
    });
    expectRejected(LocalMediaMetadataSchema, { title: "", tags: [] });
  });

  it("SmartQuerySchema round-trips and rejects unknown media kinds", () => {
    expectRoundTrip(SmartQuerySchema, {
      text: "bunny",
      mediaKind: "video",
      tags: ["animation"],
    });
    expectRejected(SmartQuerySchema, {
      text: "bunny",
      mediaKind: "hologram",
      tags: [],
    });
  });

  it("LocalLibraryEntrySchema round-trips a fingerprinted entry", () => {
    expectRoundTrip(LocalLibraryEntrySchema, {
      id: "lib-001",
      path: "/home/z/media/big-buck-bunny.mp4",
      fingerprint,
      metadata: {
        title: "Big Buck Bunny",
        durationMs: 596000,
        mimeType: "video/mp4",
        sizeBytes: 158008374,
        tags: ["animation", "creative-commons"],
      },
      addedAt: ISO_NOW,
    });
    expectRejected(LocalLibraryEntrySchema, {
      id: "lib-002",
      path: "/home/z/media/corrupt.mkv",
      fingerprint: "totally-not-a-hash",
      metadata: { title: "Corrupt", tags: [] },
      addedAt: ISO_NOW,
    });
  });

  it("CollectionSchema round-trips manual and smart collections", () => {
    expectRoundTrip(CollectionSchema, {
      id: "col-001",
      name: "Favourites",
      kind: "manual",
      entryIds: ["lib-001", "lib-002"],
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
    expectRoundTrip(CollectionSchema, {
      id: "col-002",
      name: "Recent podcasts",
      kind: "smart",
      entryIds: [],
      smartQuery: { mediaKind: "podcast", tags: ["commute"] },
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
  });

  it("CollectionSchema requires smartQuery for smart collections", () => {
    expectRejected(CollectionSchema, {
      id: "col-003",
      name: "Broken smart collection",
      kind: "smart",
      entryIds: [],
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
  });

  it("LocalPlaylistSchema round-trips ordered playlists", () => {
    expectRoundTrip(LocalPlaylistSchema, {
      id: "pl-001",
      name: "Commute mix",
      itemIds: ["cat-001", "cat-002"],
      loop: false,
      shuffle: true,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
    expectRejected(LocalPlaylistSchema, {
      id: "pl-002",
      name: "",
      itemIds: [],
      loop: false,
      shuffle: false,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    });
  });

  it("WatchedStateSchema round-trips and bounds watchedFraction to [0, 1]", () => {
    expectRoundTrip(WatchedStateSchema, {
      itemId: "cat-001",
      status: "in-progress",
      watchedFraction: 0.42,
      lastPositionMs: 1512000,
      updatedAt: ISO_NOW,
    });
    expectRoundTrip(WatchedStateSchema, {
      itemId: "cat-002",
      status: "watched",
      watchedFraction: 1,
      lastPositionMs: 596000,
      updatedAt: ISO_NOW,
      completedAt: ISO_NOW,
    });
    expectRejected(WatchedStateSchema, {
      itemId: "cat-001",
      status: "in-progress",
      watchedFraction: 1.2,
      lastPositionMs: 0,
      updatedAt: ISO_NOW,
    });
  });
});

describe("account", () => {
  it("ProviderAccountStatusSchema accepts exactly connected | expired | revoked", () => {
    for (const status of ["connected", "expired", "revoked"]) {
      expect(ProviderAccountStatusSchema.parse(status)).toBe(status);
    }
    expectRejected(ProviderAccountStatusSchema, "pending");
  });

  it("ProviderAccountRecordSchema round-trips a renderer-safe record", () => {
    const recordFixture = {
      providerId: "youtube",
      internalAccountId: "acct-001",
      displayName: "Zed's YouTube",
      grantedScopes: ["youtube.readonly"],
      status: "connected",
      connectedAt: ISO_NOW,
      expiresAt: "2025-06-01T13:00:00Z",
    };
    expectRoundTrip(ProviderAccountRecordSchema, recordFixture);
    const record: ProviderAccountRecord =
      ProviderAccountRecordSchema.parse(recordFixture);
    expect(record.grantedScopes).toEqual(["youtube.readonly"]);
  });

  it("ProviderAccountRecordSchema rejects unknown keys, including tokens", () => {
    expectRejected(ProviderAccountRecordSchema, {
      providerId: "youtube",
      internalAccountId: "acct-001",
      displayName: "Zed's YouTube",
      grantedScopes: ["youtube.readonly"],
      status: "connected",
      connectedAt: ISO_NOW,
      accessToken: "ya29.super-secret-token",
    });
    expectRejected(ProviderAccountRecordSchema, {
      providerId: "youtube",
      internalAccountId: "acct-001",
      displayName: "Zed's YouTube",
      grantedScopes: ["youtube.readonly"],
      status: "pending",
      connectedAt: ISO_NOW,
    });
  });

  it("CredentialPort is an interface-only seam resolving opaque handles", async () => {
    const keychainStub: CredentialPort = {
      getToken: async (providerId, internalAccountId) => ({
        handle: `keychain://${providerId}/${internalAccountId}`,
      }),
    };
    expect(typeof keychainStub.getToken).toBe("function");
    await expect(keychainStub.getToken("youtube", "acct-001")).resolves.toEqual(
      { handle: "keychain://youtube/acct-001" },
    );
  });
});

describe("jobs", () => {
  const retryPolicy = {
    maxAttempts: 3,
    backoffMs: 500,
    multiplier: 2,
    on: ["network", "timeout"],
  };
  const provenance = {
    connectorId: "webflix-connector-local",
    connectorVersion: "0.1.0",
    generatedAt: ISO_NOW,
  };
  const jobDescriptor = {
    id: "job-001",
    kind: "library.index",
    state: "queued",
    priority: 0,
    cancellable: true,
    cancelRequested: false,
    retry: retryPolicy,
    provenance,
    payload: { root: "/home/z/media" },
    attempts: 0,
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
  };

  it("JobStateSchema accepts exactly the six locked states", () => {
    for (const state of [
      "queued",
      "running",
      "paused",
      "succeeded",
      "failed",
      "cancelled",
    ]) {
      expect(JobStateSchema.parse(state)).toBe(state);
    }
    expectRejected(JobStateSchema, "archived");
  });

  it("JobKindSchema enforces dot-namespaced kinds", () => {
    expectRoundTrip(JobKindSchema, "library.index");
    expectRejected(JobKindSchema, "Library Index");
  });

  it("RetryPolicySchema round-trips and requires at least one attempt", () => {
    expectRoundTrip(RetryPolicySchema, retryPolicy);
    expectRejected(RetryPolicySchema, {
      maxAttempts: 0,
      backoffMs: 500,
      multiplier: 2,
      on: [],
    });
  });

  it("JobDescriptorSchema round-trips a cancellable, retryable, provenance-preserving job", () => {
    const job: JobDescriptor = JobDescriptorSchema.parse(jobDescriptor);
    expect(job.cancellable).toBe(true);
    expect(job.cancelRequested).toBe(false);
    expect(job.retry.maxAttempts).toBe(3);
    expect(job.provenance.connectorId).toBe("webflix-connector-local");
    expect(JobDescriptorSchema.parse(jobDescriptor)).toEqual(jobDescriptor);
  });

  it("JobDescriptorSchema requires the cancellable flag and a valid provenance", () => {
    expectRejected(JobDescriptorSchema, {
      ...jobDescriptor,
      cancellable: undefined,
    });
    expectRejected(JobDescriptorSchema, {
      ...jobDescriptor,
      provenance: { connectorId: "webflix-connector-local" },
    });
  });
});

describe("errors", () => {
  it("ErrorCodeSchema accepts every ErrorCode and rejects unknown codes", () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
    expectRejected(ErrorCodeSchema, "common/explosion");
  });

  it("WebFlixErrorShapeSchema round-trips and rejects non-boolean retryable", () => {
    expectRoundTrip(WebFlixErrorShapeSchema, {
      code: "common/rate-limited",
      reason: "provider rate limit exhausted",
      retryable: true,
      context: { providerId: "youtube", resetAt: ISO_NOW },
    });
    expectRejected(WebFlixErrorShapeSchema, {
      code: "common/rate-limited",
      reason: "bad shape",
      retryable: "sometimes",
      context: {},
    });
  });

  it("WebFlixError carries code, reason, retryable and context", () => {
    const error = new WebFlixError({
      code: ErrorCode.LocalFileMissing,
      reason: "file vanished mid-playback",
      retryable: false,
      context: { path: "/home/z/media/vanished.mkv" },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("WebFlixError");
    expect(error.message).toBe("file vanished mid-playback");
    expect(error.code).toBe(ErrorCode.LocalFileMissing);
    expect(error.retryable).toBe(false);
    expect(error.context).toEqual({ path: "/home/z/media/vanished.mkv" });
    expect(error.toJSON()).toEqual({
      code: "local/file-missing",
      reason: "file vanished mid-playback",
      retryable: false,
      context: { path: "/home/z/media/vanished.mkv" },
    });
    expect(WebFlixErrorShapeSchema.parse(error.toJSON())).toEqual(
      error.toJSON(),
    );
  });

  it("WebFlixError defaults context to an empty object", () => {
    const error = new WebFlixError({
      code: ErrorCode.Unknown,
      reason: "mystery",
      retryable: false,
    });
    expect(error.context).toEqual({});
  });
});
