# Work order — INSTAGRAM-CONNECT (Phase 3, platform #3): professional-account surface on the canonical contracts

## Identity

- Work ID: INSTAGRAM-CONNECT
- Requirement IDs: desktop-roadmap.md Phase 3; phase3-platform-selection.md (Instagram #3); AUDIT-SOURCES §5 Instagram row (professional-accounts-only, discovery removed, app-review gates); provider-policy-matrix.md Instagram rows; contract-freeze §2 (binding shapes); ADR-0003 (per-user identity)
- Owner: connectors-lane worker (single worker; TL2 arbitrates splits)
- Branch: instagram-connect
- Base SHA: b312968 (main after TWITCH-CONNECT merge + TL2 ruling)

## Objective

Stand up Instagram as the fourth platform at its HONEST capability level: the
audit's verdict — "high value but the browse/discovery parity users expect is
largely unavailable officially" — is the design brief. Official surfaces only:
Instagram Graph API professional-account reads (own profile, own media,
insights), basic display profile, and oEmbed (app-review-required — record
the gate honestly). Facebook Login OAuth per-user. NO scraping, NO private
endpoints, NO cookie replay, NO invented discovery.

Scope rows:

1. **Connector foundation**: `packages/connectors/src/instagram/` — frozen
   ConnectorManifest with an honesty-forward operation set: most browse
   rows honestly unsupported (hashtag search REMOVED 2024 — cite it;
   consumer feed/discovery NO official API — cite it), profile/media/
   insights reads requires-auth (professional accounts), oEmbed
   pending-app-review (record the gate); registry default seeds
   youtube+tiktok+twitch+instagram; Graph API client fixture-tested
   (official shapes: paging cursors, media types); catalogMapping per
   canonical §2.1 for own-media reads (item-level attribution,
   metadata.externalIds.instagram, provider-native MatchEvidence, honest
   mediaKind mapping — post/reel/video; no fabricated facts).
2. **Watch path**: Instagram media playback — investigate the official
   embed/oEmbed mechanism INCLUDING its app-review gate; if playback cannot
   be driven officially without approved credentials, emit honest
   unavailable + user-handoff (open official app) as the DEFAULT state and
   record the approved-credential path as the pending row. Do NOT force
   shapes; file IG-FD if a gap is structural.
3. **Account path**: Facebook Login OAuth (per-user) on the existing
   CredentialPort / OAuthAccountStore seams — fixture-tested; operator
   items: Meta app ID/secret + app review + business verification (record
   the full gate chain honestly — this platform has the heaviest
   operator-credential dependency; say so).
4. **Honest-unsupported totality**: enumerate every Instagram surface users
   expect (feed, explore, hashtag search, stories browse, reels browse,
   DMs, notifications…) with official-status citations (removed / no
   public API / gated); WebFlix-local substitutes or explicit none +
   official-app handoff; totality-tested both directions.
5. **Parity matrix deliverable**: docs/architecture/instagram-parity-matrix.md —
   per-row mechanism/quota/status/handoff/official-link; the
   professional-accounts-only section; the removed-API citations; the
   app-review gate chain; the ~200 calls/hour/account UNVERIFIED
   third-party rate caveat (basis-labeled, modeled honestly like TikTok's).

## Non-goals

- No contract edits (deviations → TL2, IG-FD queue).
- No Content Publishing for this order (media publish/manage = operator
  gated; record as pending only).
- No scraping substitutes for removed discovery APIs (the honest state IS
  the deliverable).
- No next-platform work (Reddit #4 queued; TL2-owned).

## Allowed and forbidden paths

- Allowed: `packages/connectors/**`, `packages/playback/**` (adapter seam
  only), `packages/webflix-shell/**` (surfaces only if a row requires UI),
  `docs/architecture/instagram-parity-matrix.md` (new).
- Forbidden: everything else (same list as TWITCH-CONNECT; the mandated
  ledger-row commit excepted).

## Acceptance evidence

- Full gate battery green (8-lane tsc, test:unit / test:integration, lint
  zero-new, fmt:check on touched files, components suite, architecture:check).
- Parity matrix committed with per-row official-source links.
- rg evidence: no scraping/cookie/undocumented-endpoint patterns.
- Honest-state tests: requires-auth, pending-app-review, unsupported
  (removed-API citations), rate-limited (unverified-basis), expired/revoked.
- Live checks (honest, from sandbox): Graph API unauthenticated error shape
  verbatim; graph.instagram.com / www.instagram.com endpoints reachability
  (expect regional/redirect shapes if any — model, don't hide); official
  doc URLs probed 200.
- Transport: git bundle base..instagram-connect via tmpfiles.org (.txt
  rename); ledger row update as separate final commit.
- Final report: last message, delimited
  `=== INSTAGRAM-CONNECT REPORT BEGIN/END ===`. Evidence over summaries.
