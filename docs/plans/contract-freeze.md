# Contract freeze — Phase 1 implementation contracts

Status: BINDING (TL2) — frozen 2026-10-09 at the freeze commit (see git history). Reconciliation state: awaiting Phase-0 audit reports (AUDIT-DESKTOP / AUDIT-DATA / AUDIT-SOURCES). Audit findings may adjust IMPLEMENTATION notes below; the SHAPES and OWNERSHIP are locked per architecture-lock.md §2 binding decisions and ADR-0003. Any deviation requires TL2 decision, versioning and changelog (worker-protocol.md).

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
- [x] AUDIT-DESKTOP findings folded (identity/IPC risks → D1 guardrails) — report docs/plans/audits/AUDIT-DESKTOP.md (base 7a14bc9, 2026-10-09). Folds: identity switch points centralized in `packages/desktop/scripts/desktop-product-identity.mjs` (D1 adapts via a WebFlix flavor — §6.1); Electron trust boundary RETAINED wholesale (webview attach hardening desktopWindowChrome.ts:640-667, window-open deny :373-447, will-navigate guard :449-481, single-bridge preload, typed channels.ts IPC vocabulary); `zcode-media://` local preview protocol + TTL/realpath allowlist RETAINED and rebranded (local-first playback foundation); shared persistent partition `persist:zcode-embedded-browser` (browserDataManager.ts:30) + Chrome bulk cookie import (chromeCookieManager.ts et al.) ISOLATED flag-off per §6.2; pre-existing dev-launch crash autoUpdater.ts:23 (eager updater construction, "0.0" semver) FIX assigned to D1 (lazy/guarded init + dev-launch E2E); root typecheck gate omits desktop main/preload/renderer (216 pre-existing errors) → D1 extends gates with noEmit + baseline file; NO test infra/CI at base → D1 delivers the runner + first GitHub Actions workflow (TL2 owns workflow files); packaging identity test matrix + ZCode/WebFlix coexistence test required; renderer production build OOMs in 4GB sandboxes (environment note for all workers — typecheck, not vite build, is the worker-side gate).
- [x] AUDIT-DATA findings folded (inherited store verdict → local-library implementation note) — report docs/plans/audits/AUDIT-DATA.md (base 7a14bc9, 2026-10-09). Folds: mature `tasks-index.sqlite` schema is the local-library blueprint (D2 adapts the WAL/migration patterns, not the file); deterministic credential-fallback key is FORBIDDEN — D2 implements CredentialPort strictly behind the OS-vault boundary (contracts §2.5, ADR-0003 §2); independent WebFlix data root `~/.webflix` (+ `~/.webflix-dev` for dev) — never `~/.zcode` (§6.8); backup/restore of the library store is a Phase-1 deliverable (D2), not deferred; first-class test commands (`pnpm test:unit` / `test:integration` hermetic) are part of D2's deliverable per the audit's mandate.
- [x] AUDIT-SOURCES findings folded (YouTube policy rows → connector manifest seed + provider-policy-matrix updates) — report docs/plans/audits/AUDIT-SOURCES.md (base 7a14bc9, 2026-10-09, session wfx-a3b-sources). Folds: pinned tree has ZERO provider code (greenfield confirmed — the "inherited provider runtime" is the ZCode LLM registry); old WebFlix 2.0 reference is policy-prohibited evidence only (InnerTube client, operator cookies, SAPISIDHASH, CDP broker — none portable per ADR-0003); the IFrame Player wrapper pattern is the one reusable playback mechanism; YouTube capability inventory with quota costs + honest-unsupported list (history/notifications/related/community/memberships/SuperChat/premiere/search-suggestions/home-feed have NO official API — local substitutes only); OAuth plan = loopback PKCE + incremental least-privilege scopes (device flow = readonly-only degrade); token boundary = main-process OS-vault adapter wrapping the inherited credentialService shape; hard policy ceilings recorded (no downloads outside Premium, no background play, no ad modification, 30-day API data delete-or-refresh, per-user data isolation, independent value); engine licenses verified (WebTorrent/libtorrent/aria2, Piper, Argos, whisper.cpp, MediaInfo/ffprobe — XTTS and NLLB excluded as non-commercial); platform ranking for Phase 3 (TikTok, Twitch, Instagram, Reddit, X, Snapchat).
- [x] architecture-policy.yaml registrations committed (from staged freeze-registrations.yaml: 8 new managed package roots + desktop promotion)
- [x] Contract-freeze SHA recorded in work-claims.md; D1/D2/D3 rows activated

## 7. Post-audit TL2 decisions (AUDIT-SOURCES open questions — binding)

1. **Independent-value compliance review (AS-Q1)**: does not block Phase-1 hermetic work. D3 ships honest capability states; the API Compliance Audit submission (required before any public release of a YouTube-mimicking experience) is an ops follow-up owned by the operator + TL2, gated at Phase 2.
2. **Quota architecture (AS-Q2)**: default allocation (100 search.list/day, 100 uploads/day, 10K units/day) cannot carry a search-heavy product. D3 designs quota-aware UX: local-catalog-first search, explicit search-budget states, honest rate-limited/unsupported statuses; quota-extension application is an ops follow-up (needs a live Google Cloud project).
3. **OAuth logistics (AS-Q3)**: operator owns the Google Cloud project/client. D3 implements loopback+PKCE with incremental scopes (youtube.readonly → youtube.force-ssl → youtube.upload as needed); refresh-token 7-day expiry under Testing status documented; sensitive-scope verification is an ops follow-up; live smoke is pending-operator-credential.
4. **Electron embed context (AS-Q4)**: D1+D3 run a live embed smoke in the packaged app before release; until then the playback manifest marks embed integrity `unknown`, never `supported`.
5-7. **Captions / Watch-Later / live-chat reality (AS-Q5-7)**: manifest rows stay `unknown` until live smoke with an authorized account; no capability is claimed `supported` on documentation alone when the audit flagged verification gaps.
8. **30-day API-data rule vs local persistence (AS-Q8)**: storage profile = WebFlix-owned facts (IDs, timestamps, playback progress, user collections) persist indefinitely; cached provider metadata is refresh-or-delete with a 30-day TTL job in D2's store; schema carries `fetchedAt` on every provider-sourced field set.
9. **Chrome-import disposition (AS-Q9)**: unchanged from §6.2 — isolated flag-off, IPC unreachable when off; never part of any provider identity path.
10. **Torrent engine order (AS-Q10)**: WebTorrent (Node-native) first behind the engine port, user-visible/cancellable; libtorrent power path deferred to Phase 4; aria2 sidecar is the fallback candidate. No torrent ships in Phase 1.
11. **Ad-transparency start set (AS-Q11)**: Phase 5 starts with Meta Ad Library API + TikTok CCA application paths; Google Ads Transparency Center is manual/linked-source only (no API exists).
12. **Miniplayer/PiP (AS-Q12)**: no miniplayer, PiP, or any playback control whose background-play boundary is unresolved ships until a written compliance position exists (Phase 2 item).

Status: this file is BINDING as of the freeze commit. Version 1.0.0.

## 6. TL2 decisions on audit open questions (pre-freeze; binding unless revised at freeze)

1. **WebFlix identity values (AUDIT-DESKTOP Q1)**: appId `org.webflix.desktop`; productName `WebFlix`; deep-link scheme `webflix://`; data root `~/.webflix` (dev: `~/.webflix-dev`); dev AUMID `org.webflix.desktop.dev` (the legacy `cn.aminer.zcode` dev AUMID must not survive); Linux package names `webflix-desktop*`; updater feed origin: DEFERRED (no Phase-1 releases; the packaged `publish.url` placeholder must be provably inert — D1 test). All switch points via `desktop-product-identity.mjs` flavor; `ZCODE_*` env names kept as aliases during migration (lock §2.1).
2. **Chrome cookie import + shared embedded-browser partition (Q2)**: cookie/localStorage/credential bulk import — feature-flag OFF by default with unreachable IPC when off (ISOLATE, not delete, per lock §2.12; removal revisited after D3 proves per-user flows). Shared partition — replaced by per-provider-profile partitions; Worker 1 owns partition mechanics + isolation tests; Worker 3 owns per-provider session/credential policy (per AUDIT-DESKTOP §7 ownership split).
3. **Updater (Q3)**: manifest provider is the only runtime update source; the `http://localhost:8081` placeholder must never receive a request in any packaged state (D1 packaging-tier test); WebFlix feed decision deferred with the release tier.
4. **Telemetry (Q4)**: OFF by default for WebFlix. No ARMS/OTLP/warehouse endpoints configured; no telemetry network calls when endpoints unset (test); `device_mid` absent from payloads when disabled; consent model is a post-Phase-1 decision.
5. **Pre-existing hygiene debt (Q5)**: TL2 runs `pnpm fmt` once on the freeze commit (50-file drift cleared before Phase-1 branches); 70 lint warnings + 216 desktop type errors recorded as the frozen baseline — workers must not add new violations in owned paths; a follow-up work order (not Phase-1 lanes) retires the baseline; D1 lands the typecheck gate extension (noEmit) + clean-tree guard.
6. **Gates location (Q6)**: GitHub Actions. TL2 owns `.github/workflows/*`; D1 delivers the runner + first workflow (install, lint, typecheck-extended, architecture:check, hermetic tests, Linux GUI smoke tier).
7. **ZCode commercial/ops substrate (Q7)**: Coding Plan + PayPal bridge, CUA helper, Lark SDK, SSH/Docker/WSL remotes, force-update prompt — all ISOLATED behind one `webflix-product-surface` flag, default OFF, with unreachable-when-off IPC/menu tests; removal decisions deferred (lock §2.12).
8. **Coexistence + dev data root (Q8)**: WebFlix MUST coexist with real ZCode installs — separate userData, AUMID, package names (identity test matrix); WebFlix dev NEVER writes `~/.zcode`: dev scripts default to the isolated `~/.webflix-dev` root (AUDIT-DESKTOP found `dev:desktop:prod` shares `~/.zcode` — that mode is forbidden for WebFlix work; `mise dev`-style isolation becomes the default).
