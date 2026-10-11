# Work order — TWITCH-CONNECT (Phase 3, platform #2): live + VOD platform on the canonical contracts

## Identity

- Work ID: TWITCH-CONNECT
- Requirement IDs: desktop-roadmap.md Phase 3; phase3-platform-selection.md (Twitch #2 — dispatch after TikTok #1 landed); AUDIT-SOURCES §5 Twitch rows (Helix video/VOD/embed; "best-documented free media API"); provider-policy-matrix.md Twitch rows; contract-freeze §2 (binding shapes); ADR-0003 (per-user identity)
- Owner: connectors-lane worker (single worker; TL2 arbitrates splits)
- Branch: twitch-connect
- Base SHA: 4104e16 (main after TIKTOK-CONNECT merge + TL2 ruling)
- Contract version / prerequisite SHA: freeze 5549208 (v1.0.0) canonical contracts — BINDING; TIKTOK-CONNECT landed (registry now two-provider — extend, do not fork)

## Objective

Stand up Twitch as the third platform (Phase-3 #2) on the exact contracts
YouTube and TikTok use. Official surfaces only: Twitch Helix API (streams,
videos/VODs, clips, users, games/categories — the browse/watch rows), the
official embed player (player.twitch.tv), and OAuth Authorization Code +
PKCE (per-user) alongside App Access tokens (client credentials) for public
reads. NO scraping, NO private endpoints, NO cookie replay.

Scope rows:

1. **Connector foundation**: `packages/connectors/src/twitch/` — frozen
   ConnectorManifest (operations Record, provenance, quotas envelope);
   registry default seeds youtube+tiktok+twitch; Helix client with
   Client-Id + Bearer (App Access for public reads); rate-limit ledger from
   the authoritative response headers (point-based token bucket — provider
   reports Ratelimit headers; basis-label them, NO invented numbers);
   catalogMapping per canonical §2.1 (item-level attribution,
   metadata.externalIds.twitch, official player + thumbnail assets,
   provider-native MatchEvidence, honest mediaKind: live for streams, video
   for VODs; no fabricated facts).
2. **Watch path**: official embed player — player.twitch.tv with the
   documented `parent` parameter (investigate what parent means for the
   desktop app's embedded webview origin; at dev time use the documented
   localhost/dev origin and record the production-origin decision as an
   integration note; do NOT guess silently). Live (channel) and VOD (video)
   plans via the canonical PlaybackPlan official-embed embedSpec. If the
   parent mechanism cannot map cleanly onto frozen shapes, emit honest
   unavailable + handoff and file TW-FD — do not force.
3. **Account path**: OAuth Authorization Code + PKCE per-user on the
   existing CredentialPort / OAuthAccountStore seams (fixture-tested;
   operator item: Twitch client_id/secret not provisioned — same ruling
   class as Google/TikTok client credentials). App Access flow
   (client-credentials) for public reads, also fixture-tested.
4. **Honest-unsupported / later-phase rows**: enumerate Helix operations
   outside this scope honestly (chat IRC, moderation, streams key, content
   classification labels — operator/gated surfaces) plus non-API surfaces
   (bits, subscriptions value surfaces); WebFlix-local substitutes or
   explicit none + official-app handoff; totality-tested.
5. **Parity matrix deliverable**: docs/architecture/twitch-parity-matrix.md —
   per operation: mechanism, quota/rate cost (header-based, basis-labeled),
   status, user-handoff note, official-source link; parent-parameter
   integration note; operator-credential pending rows clearly labeled.

## Non-goals

- No changes to webflix-contracts (frozen; deviations → TL2 freeze process).
- No EventSub webhooks (server-side push is a later-phase surface — record
  as pending only).
- No chat/IRC integration (record honest-unsupported for this order).
- No next-platform work (Instagram #3 stays queued; TL2-owned).

## Allowed and forbidden paths

- Allowed: `packages/connectors/**` (incl. fixtures, tests, tsconfig),
  `packages/playback/**` (adapter seam only), `packages/webflix-shell/**`
  (surfaces only if a Twitch row requires UI),
  `docs/architecture/twitch-parity-matrix.md` (new).
- Forbidden: `packages/webflix-contracts/**`, `packages/webflix-domain/**`,
  `packages/webflix-application/**`, `packages/local-library/**`,
  `packages/catalog/**` (source; seam tests in the connectors suite),
  `packages/desktop/**`, root config, `.github/workflows/**`, `docs/adr/**`,
  `docs/plans/**` (except the mandated ledger-row commit).

## Dependencies and parallelism

- Must land first: TIKTOK-CONNECT (merged — satisfied).
- Single worker session; TL2 gate same battery as TIKTOK-CONNECT +
  parity-matrix review against AUDIT-SOURCES Twitch rows.

## Acceptance evidence

- Full gate battery green (8-lane tsc, test:unit / test:integration, lint
  zero-new, fmt:check on touched files, components suite, architecture:check).
- Parity matrix committed with per-row official-source links.
- rg evidence: no scraping/cookie/undocumented-endpoint patterns in the diff.
- Honest-state tests: rate-limited (header-ledger), requires-auth,
  expired/revoked, unsupported, and the parent-parameter honesty row.
- Live checks (honest, from sandbox): Helix unauthenticated error shape
  captured verbatim (no Client-Id/token); player.twitch.tv endpoint
  reachability + served content; official doc URLs probed 200.
- Transport: git bundle base..twitch-connect via tmpfiles.org (.txt
  rename); ledger row update as a separate final commit.
- Final report: last message, delimited
  `=== TWITCH-CONNECT REPORT BEGIN/END ===`. Evidence over summaries.
