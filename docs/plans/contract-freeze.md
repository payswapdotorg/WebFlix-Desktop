# Contract freeze — Phase 1 implementation contracts

Status: DRAFT (TL2) — becomes binding at the contract-freeze commit. Reconciliation state: awaiting Phase-0 audit reports (AUDIT-DESKTOP / AUDIT-DATA / AUDIT-SOURCES). Audit findings may adjust IMPLEMENTATION notes below; the SHAPES and OWNERSHIP are locked per architecture-lock.md §2 binding decisions and ADR-0003. Any deviation requires TL2 decision, versioning and changelog (worker-protocol.md).

Owner: TL2. Version: 1.0.0 (semver; breaking changes bump major with migration notes).

## 1. Package roots (registered in architecture-policy.yaml at freeze)

| Package | Owner | Public entrypoint | Requires (direction) | Layer |
|---|---|---|---|---|
| packages/webflix-contracts | TL2 (shape) / Worker 2 (impl) | src/index.ts | (none — leaf) | contracts |
| packages/webflix-domain | Worker 2 | src/index.ts | webflix-contracts | domain |
| packages/webflix-application | Worker 2 | src/index.ts | webflix-contracts, webflix-domain | app |
| packages/local-library | Worker 2 | src/index.ts | webflix-contracts, webflix-domain | adapters |
| packages/catalog | Worker 3 | src/index.ts | webflix-contracts | domain |
| packages/connectors | Worker 3 | src/index.ts (+ per-connector subpaths) | webflix-contracts, catalog | adapters |
| packages/playback | Worker 3 | src/index.ts | webflix-contracts, catalog | app |
| packages/webflix-shell | Worker 1 | src/index.ts | webflix-contracts, webflix-application | clients |

Dependency direction is inward (lock §3): clients → adapters → app → domain → contracts. No package imports Electron, React renderer components, provider SDKs or DB clients except its declared adapter layer. Connectors never import each other; composition lives in webflix-application/playback.

## 2. Locked contract shapes (webflix-contracts)

All types live in `packages/webflix-contracts/src/` with zod schemas + contract tests. TS type declarations are the shape authority; zod schemas validate at runtime boundaries (IPC, storage, connector responses).

### 2.1 Catalog (catalog.ts)
- `CatalogItem` — WebFlix-canonical: `{ id: CatalogItemId, kind: MediaKind, title, durationMs?, providers: ProviderAssetRef[], firstSeenAt, provenance }`
- `ProviderAsset` — `{ providerId, sourceAssetId, capabilities: AssetCapabilitySet, urls/tokens: never raw secrets, availability: AvailabilityFact[], region, rights, lastCheckedAt }` — one CatalogItem ↔ many ProviderAssets; merges carry `MatchEvidence { confidence, evidence }`; ambiguous matches stay separate (lock §5).
- `MediaKind` — `video | short | live | podcast | audio | local-file` (extensible).

### 2.2 Playback (playback.ts)
- `PlaybackPlan` — discriminated union, resolved never assumed (lock §6):
  `official-embed { providerId, embedSpec }` | `isolated-website { url }` | `local-file { path, mimeType }` | `external-deep-link { url }` | `unavailable { reason: UnavailableReason, recovery?: RecoveryHint }`
- `UnavailableReason` — `unsupported | requires-auth | region | rate-limited | removed | offline | policy-restricted`
- Progress: WebFlix-owned `PlaybackProgress { itemId, positionMs, durationMs, updatedAt }` — distinct from provider history; provider writes are explicit connector ops.

### 2.3 Capability (capability.ts)
- `CapabilityStatus` — `supported | requires-auth | unsupported | unavailable | rate-limited | degraded | unknown` (lock §11) — unknown is honest and distinct from unsupported.
- `ConnectorManifest` — `{ providerId, operations: Record<OperationId, OperationCapability>, regions, quotas, provenance, failureModes }` — a connector may implement a subset; UI renders the status, never dead controls (lock §2.13).

### 2.4 Library (library.ts)
- `LocalLibraryEntry` — `{ id, path, fingerprint, metadata, addedAt }` — paths device-scoped; no media bytes in the store.
- `Collection` / `LocalPlaylist` — WebFlix-owned; never mutate provider playlists implicitly (WF-016).
- `WatchedState` — WebFlix resume/watched facts (WF-007).

### 2.5 Provider account & credentials (account.ts)
- `ProviderAccountRecord` — `{ providerId, internalAccountId, displayName, grantedScopes, status: connected|expired|revoked, connectedAt, expiresAt? }` — renderer-safe (NO tokens).
- `CredentialPort` (interface only in contracts) — `getToken(providerId, internalAccountId): Promise<CredentialRef>` — implementations live behind the OS vault boundary in the desktop adapter; credentials never cross into renderer-visible types, logs or storage (data-ownership.md credential rows; ADR-0003 §2).
- Per-user isolation: every account record is profile-scoped; no shared operator identity (lock §2.11).

### 2.6 Jobs (jobs.ts)
- `JobDescriptor` / `JobState` — cancellable, retryable, provenance-preserving (lock §9) — used by media-intelligence later; Phase 1 uses it for indexing.

## 3. Failure vocabulary and versioning
- Errors: typed `WebFlixError { code: ErrorCode, reason, retryable, context }` — no stringly-typed failures across package boundaries.
- Contract versioning: semver per package; breaking change = TL2 decision + changelog entry + consumer impact note (worker-protocol.md §Concurrent-work method 3).
- IPC payloads validate against the same zod schemas at the boundary.

## 4. Phase-1 lane mapping (frozen)
- D1-SHELL (Worker 1): packages/desktop + packages/webflix-shell — consumes 2.1–2.5 types via application use cases; renders CapabilityStatus honestly.
- D2-LOCAL (Worker 2): implements webflix-contracts + domain + application + local-library (migration-backed store per lock §7).
- D3-YOUTUBE (Worker 3): catalog + connectors (YouTube manifest/adapter per ADR-0003: official Data API v3 + IFrame embed only) + playback plan resolution.

## 5. Reconciliation log (TL2 fills at freeze)
- [ ] AUDIT-DESKTOP findings folded (identity/IPC risks → D1 guardrails)
- [ ] AUDIT-DATA findings folded (inherited store verdict → local-library implementation note)
- [ ] AUDIT-SOURCES findings folded (YouTube policy rows → connector manifest seed + provider-policy-matrix updates)
- [ ] architecture-policy.yaml registrations committed
- [ ] Contract-freeze SHA recorded in work-claims.md; D1/D2/D3 rows activated
