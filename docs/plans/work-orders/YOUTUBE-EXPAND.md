# Work order — YOUTUBE-EXPAND (Phase 2): fill the highest-value YouTube paths with a per-operation parity matrix

## Identity

- Work ID: YOUTUBE-EXPAND
- Requirement IDs: desktop-roadmap.md Phase 2; AUDIT-SOURCES capability inventory (§2) + honest-unsupported list; contract-freeze §2 (binding shapes); ADR-0003 (per-user identity)
- Owner: Worker 3 lane successor (single worker; TL2 arbitrates splits)
- Branch: youtube-expand
- Base SHA: `__POST_MIRROR_RECON_SHA__` (substitute the MIRROR-RECON relay head at dispatch)
- Contract version / prerequisite SHA: freeze 5549208 (v1.0.0) canonical contracts — BINDING; MIRROR-RECON must land first (catalog/connectors are this order's primary paths)

## Objective

Close the first platform gap list per the roadmap: fill the highest-value YouTube
browse/watch/account paths that are BOTH technically available and allowed by
source policy, and keep a per-operation parity matrix. Inaccessible actions
stay honest (`unsupported` with the official reason) and may hand the user off
to the official YouTube application/site. NO scraping, NO private endpoints,
NO cookie replay — the AUDIT-SOURCES verdict on all of those stands.

Scope rows (from AUDIT-SOURCES §2, statuses to fill/verify):

1. **Search & browse paths**: search.list (quota-constrained: 100 calls/day
   default — the `rate-limited` capability state is a first-class UX state),
   videos.list / channels.list / playlists.list / playlistItems.list reads.
   A quota-ledger-aware client already exists (connectors/youtube/dataApi.ts);
   extend it and surface remaining-quota honestly in the shell.
2. **Watch path**: IFrame official embed (the one reusable playback mechanism)
   via the canonical PlaybackPlan `official-embed { providerId, embedSpec }` —
   drive it end-to-end from catalog → connector → playback → shell Watch screen.
3. **Account path**: per-user OAuth loopback+PKCE (youtube / youtube.readonly
   scopes only; device flow = readonly-only degrade), connected-account
   surfaces using the canonical ProviderAccountRecord, honest
   expired/revoked/reconnect states.
4. **Honest-unsupported rows** (NO official API — keep as truthful states,
   WebFlix-local substitutes only): watch history, notifications,
   related-videos, community posts, memberships, Super Chat, premiere
   reminders, search suggestions, home-recommendations feed. Local
   substitutes live in WebFlix's own store (local history/queue), NEVER as
   provider data.
5. **Parity matrix deliverable**: docs/architecture/youtube-parity-matrix.md —
   per operation: official mechanism, quota cost, status (supported /
   quota-constrained / requires-auth / unsupported + reason), and the
   user-handoff note where the official app/site is the only compliant path.

## Non-goals

- No changes to webflix-contracts (frozen; deviations → TL2 freeze process).
- No InnerTube/SAPISIDHASH/cookie patterns anywhere (rg-verified in review).
- No ad modification/blocking, no background play, no downloads outside
  Premium-sanctioned paths (policy ceilings from AUDIT-SOURCES).
- No next-platform work (Phase 3; selection matrix is TL2-owned).

## Allowed and forbidden paths

- Allowed: `packages/connectors/**`, `packages/catalog/**`, `packages/playback/**`,
  `packages/webflix-shell/**` (Watch/Search/Accounts screens),
  `docs/architecture/youtube-parity-matrix.md` (new).
- Forbidden: `packages/webflix-contracts/**`, `packages/webflix-domain/**`,
  `packages/webflix-application/**`, `packages/local-library/**`,
  `packages/desktop/**`, root config, `.github/workflows/**`, `docs/adr/**`.
- Live-smoke credentials: the operator provides the test Google account at
  dispatch time; until then record live-smoke as pending-operator-credential.

## Dependencies and parallelism

- Must land first: MIRROR-RECON (this order builds on reconciled shapes).
- Can run concurrently with: nothing (primary paths overlap MIRROR-RECON's).
- Merge order: single branch → TL2 gate (same battery as MIRROR-RECON +
  parity-matrix review against AUDIT-SOURCES rows).

## Contract and state

- Public interfaces used: canonical §2.2/§2.3/§2.6 shapes only.
- Public interface changes proposed: none (freeze-deviation proposals → TL2).
- State owner: WebFlix-local stores own all local-substitute data.

## Acceptance evidence

- Full gate battery green (per-package tsc for the four owned packages,
  test:unit / test:integration, lint zero-new, fmt:check).
- Parity matrix committed with per-row official-source links.
- rg evidence: no innertube/SAPISIDHASH/cookie patterns in the diff.
- Honest-state tests for rate-limited / requires-auth / expired / revoked /
  unsupported rows.
- Live smoke status recorded (pending-operator-credential acceptable, clearly
  labeled, until the operator provides the test account).
