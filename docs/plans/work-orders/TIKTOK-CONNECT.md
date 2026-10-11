# Work order — TIKTOK-CONNECT (Phase 3 opener): second platform on the canonical contracts

## Identity

- Work ID: TIKTOK-CONNECT
- Requirement IDs: desktop-roadmap.md Phase 3; phase3-platform-selection.md (TikTok #1, binding at Phase-2 completion — Phase-2 is merged); AUDIT-SOURCES §5 TikTok rows (Display API, oEmbed, Login Kit) + provider-policy-matrix.md TikTok rows; contract-freeze §2 (binding shapes); ADR-0003 (per-user identity)
- Owner: connectors-lane worker (single worker; TL2 arbitrates splits)
- Branch: tiktok-connect
- Base SHA: 29586c1 (main after YOUTUBE-EXPAND merge; fetch it: `git fetch origin main`)
- Contract version / prerequisite SHA: freeze 5549208 (v1.0.0) canonical contracts — BINDING; MIRROR-RECON + YOUTUBE-EXPAND must land first (both merged — this order builds on the reconciled lanes)

## Objective

Stand up TikTok as the second platform on the exact contracts YouTube uses —
connector manifest, registry honesty, per-user identity, playback plan, honest
states — per the binding platform-selection matrix (TikTok #1). Official
surfaces only: TikTok Display API (user info, video list), TikTok oEmbed, and
Login Kit OAuth 2.0 + PKCE. NO scraping, NO private endpoints, NO cookie
replay, NO undocumented API guessing (AUDIT-SOURCES verdict stands). Rate
limits reported by third parties (~600 req/min Display API) are UNVERIFIED —
model honestly as provider-reported-at-integration; degrade honestly until
the provider states numbers in a response envelope or official doc.

Scope rows:

1. **Connector foundation**: `packages/connectors/src/tiktok/` — frozen
   ConnectorManifest (operations Record, provenance, quotas envelope);
   registry integration; Display API client (user.info, video.list fields per
   the official docs); oEmbed client (public, no auth) returning canonical
   catalog items via a catalogMapping (same discipline as YouTube's:
   item-level provider attribution, provider-native MatchEvidence, no invented
   mediaKind, non-video results dropped).
2. **Watch path**: TikTok official embed — investigate the exact official
   mechanism (oEmbed `embed_html` blockquote + embed script; the embed player
   product) and fold it into the canonical PlaybackPlan `official-embed`
   `embedSpec` record WITHOUT changing frozen shapes. If the mechanism cannot
   map cleanly to the frozen embedSpec, do NOT force it: emit the honest
   unavailable state + user-handoff (open official app/site) and record the
   gap as a freeze-deviation proposal (TT-FD queue) for TL2 — same discipline
   as MR-FD.
3. **Account path**: Login Kit OAuth 2.0 + PKCE (per-user) on the existing
   canonical CredentialPort / OAuthAccountStore seam (readonly-style scopes
   only; no publish/post scope — Content Posting API is out of scope for this
   order). Fixture-tested; live consent flow records as pending Google-class
   client credentials (operator item: TikTok app client_id/secret not
   provisioned).
4. **Honest-unsupported rows**: enumerate TikTok operations with NO official
   API for this scope (For You feed, search — TikTok has no public search
   API, comments, DMs, live, notifications, …) with WebFlix-local substitutes
   or explicit none + official-app handoff note; totality-tested against the
   manifest (same as YouTube's substitutes.ts).
5. **Parity matrix deliverable**: docs/architecture/tiktok-parity-matrix.md —
   per operation: official mechanism, quota/rate cost, status (supported /
   rate-limited / requires-auth / unsupported + reason), user-handoff note,
   official-source link. Include the unverified-rate-limit caveat row and the
   regional-availability honesty (regional bans affect user experience —
   honest states, never silent).

## Non-goals

- No changes to webflix-contracts (frozen; deviations → TL2 freeze process).
- No Content Posting API, Research API, or Commercial Content API (gated /
  approved-access / Phase-5 surfaces — record as pending rows only).
- No next-next-platform work (Twitch #2 stays queued; TL2-owned).
- No ad modification/blocking, no downloads outside official surfaces.

## Allowed and forbidden paths

- Allowed: `packages/connectors/**` (incl. fixtures, tests, tsconfig),
  `packages/playback/**` (adapter seam only), `packages/webflix-shell/**`
  (surfaces only if a TikTok row requires UI), `docs/architecture/tiktok-parity-matrix.md` (new).
- Forbidden: `packages/webflix-contracts/**`, `packages/webflix-domain/**`,
  `packages/webflix-application/**`, `packages/local-library/**`,
  `packages/catalog/**` (source; cross-package seam tests go in the
  connectors suite — YOUTUBE-EXPAND precedent), `packages/desktop/**`, root
  config, `.github/workflows/**`, `docs/adr/**`, `docs/plans/**`.

## Dependencies and parallelism

- Must land first: MIRROR-RECON + YOUTUBE-EXPAND (both merged — satisfied).
- Can run concurrently with: nothing (single worker session).
- Merge order: single branch → TL2 gate (same battery as YOUTUBE-EXPAND +
  parity-matrix review against AUDIT-Sources TikTok rows).

## Contract and state

- Public interfaces used: canonical §2.1 CatalogItem, §2.2 PlaybackPlan,
  §2.3 CapabilityStatus/OperationCapability, §2.5 OAuth vocabulary,
  §2.6 CredentialPort — exactly as YouTube consumes them.
- Public interface changes proposed: none (freeze-deviation proposals → TL2,
  TT-FD queue).
- State owner: WebFlix-local stores own all local-substitute data;
  per-user partitions own all account state (ADR-0003).

## Acceptance evidence

- Full gate battery green (per-package tsc for owned packages, test:unit /
  test:integration, lint zero-new, fmt:check on touched files, components
  suite if shell touched, architecture:check).
- Parity matrix committed with per-row official-source links.
- rg evidence: no scraping/cookie/undocumented-endpoint patterns in the diff.
- Honest-state tests for rate-limited / requires-auth / expired / revoked /
  unsupported / regionally-unavailable rows.
- Live checks (honest, from sandbox): oEmbed public endpoint live fetch
  (HTTP status + served content-type, one public video id); embed player
  official host reachability; Display API unauthenticated error shape
  captured verbatim. Account-interactive flows fixture-tested; record
  'pending operator TikTok client credentials (operator item)'.
- Transport: git bundle base..tiktok-connect relayed per TL2 protocol
  (tmpfiles.org .txt rename); ledger row update as a separate final commit.
- Final report: last message, delimited
  `=== TIKTOK-CONNECT REPORT BEGIN/END ===`. Evidence over summaries.
