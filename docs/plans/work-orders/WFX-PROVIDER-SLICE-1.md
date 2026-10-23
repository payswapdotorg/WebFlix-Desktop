# Work Order — WFX-PROVIDER-SLICE-1 (Worker 2: provider vertical slice)

Parent order: `docs/plans/work-orders/WFX-DESKTOP-WEBFLIX-UX-1.md` (source of truth — read it first).
Frozen law: `docs/plans/contract-freeze.md` §9 + `webflix-contracts` v0.14.0 (`src/ui-actions.ts`, `src/media-views.ts` — the ports you implement are frozen there; read both first).
Existing engines you build on: `packages/connectors/src/youtube/**` (official Data API v3 client with quota ledger, catalogMapping, playback plan builder — fixture-tested, never wired live), `packages/webflix-application/src/**` (ports + use cases), `packages/catalog`, `packages/playback`.

## Ownership (strict — no edits outside)

- **owns**: `packages/connectors/src/youtube/**` (+ `packages/connectors/tests/**` for your new tests), `packages/webflix-application/src/**` (+ `src/tests/**`), `docs/architecture/provider-policy-matrix.md` (the capability matrix rows for your operations).
- **explicitly granted**: `packages/connectors/src/index.ts` ONLY if a new export must be added (additive).
- Do NOT touch: webflix-shell, webflix-domain (unless an additive invariant is genuinely required — justify), packages/desktop, packages/ui, root config.

## Deliverables

1. **The live Data API composition root** (the freeze §9.5 key law): a factory that constructs `YouTubeDataApiClient` with a REAL `fetchImpl` (global fetch) + the configured API key, reading the key from an injected `CredentialsSource` port (implementations live app-side/desktop-side — NOT in connectors; connectors stay credential-free except the injected value). No key configured ⇒ the composition returns a typed `requires-auth` outcome object (never a thrown crash) that callers map to the frozen honest phases. Record the key-handling surface in the policy matrix (never in binary, never renderer-visible).
2. **The media-producer use cases** in `webflix-application` implementing the FROZEN ports from `webflix-contracts/src/media-views.ts`:
   - `HomeFeedPort` — honest composition (freeze §9: no official home API): trending chart rows + shorts classification + local continue-watching (from injected history/progress stores) + growing-grid cursor over trending/search pages; `compositionNote` always names the compose; per-section honest states; `requires-auth` phase without a key.
   - `SearchPagePort` — over `searchYouTubeCatalog` + channels (Data API search or a documented channels.list path), mapping errors via `searchCapabilityFromError`; `nextCursor` from `nextPageToken`; `budgetNote` from the quota ledger snapshot.
   - `ChannelPort` — channels.list by id/handle (handle → `forHandle` param; verify the client supports it — add the param additively if missing, with fixture test), videos via `channelUploadsCatalog`, shorts classification (short mediaKind or duration ≤ 60s classification — document the rule), `availableTabs` honest (only tabs the data supports).
   - `TrendingPort` — `trendingYouTubeCatalog` with region/category.
   - `ShortsPort` — shorts-classified rows from trending/search (documented honest compose — no official shorts feed API; label in detail).
   - `SubscriptionsPort` — requires-auth without a connected account; the connected compose polls per-channel uploads with the MANDATORY degradeNote (frozen law).
   - `HistoryPort` — grouped continue-watching from the injected local progress/history store (WebFlix-owned facts only).
   - `ChannelResolutionPort` — THE MRBEAST JOURNEY DATA PATH: resolve a query (name/@handle/id) → search.list type=channel (or channels.list forHandle) → if exactly one strong match: resolved + newest-first uploads (uploads playlist, playlistItems.list ordered by publishedAt DESC — re-sort client-side, don't trust API order) with `publishedLabel` evidence; if multiple plausible: `ambiguous` with candidates; not-found typed; requires-auth/other honest phases typed. Ambiguity rule: exact handle match or verified-exact-name match resolves directly; otherwise ambiguous.
3. **A `SearchSourcePort` adapter** (federated-search seam, `webflix-application/src/ports.ts` vocabulary) over the YouTube client so the existing `FederatedSearch` use case can fan out to the real source (registry composition stays TL2/app-side).
4. **Capability/source matrix update**: `docs/architecture/provider-policy-matrix.md` — one row per operation you wired (search.list, channels.list, playlistItems.list, videos.list chart, shorts-classification compose, home compose, subscriptions degrade) with: official surface, quota cost, key requirement, honest state without key, verification date (2026-10-23) and policy citation. Mark anything not live-verified as fixture-tested only.
5. **Tests** (all hermetic — mock fetch with canned Data API response fixtures in the existing `packages/connectors/tests/fixtures/youtube/*.json` conventions): factory requires-auth law, each use case's happy path + honest-state paths (quota exhausted → rate-limited phase, network failure → unavailable, no key → requires-auth), ChannelResolutionPort ambiguity/newest-first/forHandle paths, subscriptions degradeNote law, home compose note law. Add the corresponding `webflix-application/src/tests/*.test.ts` suites.

## Binding laws

- Official Data API v3 + official surfaces ONLY (ADR-0003). NO InnerTube, no scraping, no cookie replay, no unofficial fallback — even though the web reference uses them (parent order §3.8).
- The frozen port interfaces are IMMUTABLE — if a signature genuinely cannot serve, report the gap; do not fork the shape.
- Honest states are DATA (typed outcomes), never thrown errors at the port boundary.
- Labels (viewsLabel, publishedLabel, durationLabel) are producer-formatted (Intl-style formatting helpers fine — deterministic, no locale guessing: use en-US defaults and document).
- CatalogItems come from the existing `catalogMapping` (videoId in `metadata.youtube`); thumbnails from the standard `i.ytimg.com` URLs the API returns (highest-rez default).

## Gates (run + record exact commands, exit codes, totals)

1. `pnpm exec vitest run packages/connectors packages/webflix-application` (existing suites stay green).
2. `pnpm --filter connectors typecheck` / the repo's established typecheck path for both packages.
3. `pnpm exec oxlint` scoped to changed files.

## Report back (worklog + final message)

Base SHA, head SHA, files changed, test totals (before/after), the exact use-case inventory (port → class → file → honest states covered), the matrix diff summary, limitations (especially anything live-gated on the operator's API key).
