# Work order — REDDIT-CONNECT (Phase 3, platform #4): community long-form video on the canonical contracts

## Identity

- Work ID: REDDIT-CONNECT
- Requirement IDs: desktop-roadmap.md Phase 3; phase3-platform-selection.md (Reddit #4); AUDIT-SOURCES §5 Reddit row (REST API posts/comments/media, OAuth per-user + app-only, ~100 QPM free tier, video embeddable, AI-training terms restriction); provider-policy-matrix.md Reddit rows; contract-freeze §2 (binding shapes); ADR-0003 (per-user identity)
- Owner: connectors-lane worker (single worker; TL2 arbitrates splits)
- Branch: reddit-connect
- Base SHA: 6b013b3 (main after INSTAGRAM-CONNECT merge + TL2 ruling)

## Objective

Stand up Reddit as the fifth platform on the exact contracts the other four
use. Official surfaces only: the official REST API (posts, comments, media
reads; oauth.reddit.com for per-user calls, the documented app-only flow for
public reads), official OAuth 2.0 (per-user code flow + app-only), and the
official video/media embed mechanism (investigate; Reddit-hosted video has
official player surfaces). NO scraping, NO cookie replay, NO AI-training
use (the API terms restriction — record it in the matrix; WebFlix is a
media client, say so, cite the terms).

Scope rows:

1. **Connector foundation**: `packages/connectors/src/reddit/` — frozen
   ConnectorManifest (operations Record, provenance, quotas envelope: the
   documented ~100 QPM free tier as the envelope approximation,
   basis-labeled UNVERIFIED-per-app; authoritative enforcement = 429 +
   served headers, typed error -> frozen rate-limited state); registry
   default seeds youtube+tiktok+twitch+instagram+reddit; REST client
   (per-user Bearer + app-only, official shapes); catalogMapping per
   canonical §2.1 (item-level attribution, metadata.externalIds.reddit,
   official player + preview assets, provider-native MatchEvidence, honest
   mediaKind: video for Reddit video posts; text/image posts per the
   canonical kinds investigation — never invent; crossposts attributed to
   their original provider when the official payload says so).
2. **Watch path**: official embed/media player mechanism — investigate how
   Reddit video is officially embeddable (the documented embed surfaces);
   fold into canonical PlaybackPlan official-embed embedSpec. If the
   mechanism cannot map cleanly onto frozen shapes: honest unavailable +
   handoff + RD-FD proposal. Do not force.
3. **Account path**: OAuth 2.0 per-user (code flow) + app-only on the
   existing CredentialPort / OAuthAccountStore seams — fixture-tested;
   operator item: Reddit app client_id/secret (record: Reddit apps are
   self-serve — note that the operator can create one at
   reddit.com/prefs/apps — lower-friction than Meta's review chain, record
   honestly). Revocation: investigate the official mechanism; model
   honestly whatever exists (including no-endpoint -> local-only, TikTok
   precedent).
4. **Honest-unsupported / later-phase rows**: enumerate Reddit surfaces
   outside read-scope honestly: voting/saving/commenting (writes —
   later-phase rows, not unsupported), DMs/chat (API status per official
   docs — cite), live streams, mod surfaces (gated). WebFlix-local
   substitutes or explicit none + official-app handoff; totality-tested.
5. **Parity matrix deliverable**: docs/architecture/reddit-parity-matrix.md —
   per-row mechanism/quota/status/handoff/official-link; the AI-training
   terms note; the ~100 QPM basis-label; operator-item chain (self-serve
   app creation recorded).

## Non-goals

- No contract edits (deviations → TL2, RD-FD queue).
- No write operations (votes/comments/saves = later-phase pending rows).
- No AI/ML training consumption of API data (terms restriction recorded).
- No next-platform work (X #5 queued; TL2-owned).

## Allowed and forbidden paths

- Allowed: `packages/connectors/**`, `packages/playback/**` (adapter seam
  only), `packages/webflix-shell/**` (surfaces only if a row requires UI),
  `docs/architecture/reddit-parity-matrix.md` (new).
- Forbidden: everything else (same list as prior orders; the mandated
  ledger-row commit excepted).

## Acceptance evidence

- Full gate battery green (8-lane tsc, test:unit / test:integration, lint
  zero-new, fmt:check on touched files, components suite, architecture:check).
- Parity matrix committed with per-row official-source links.
- rg evidence: no scraping/cookie/undocumented-endpoint patterns.
- Honest-state tests: rate-limited (429 + served headers), requires-auth,
  expired/revoked, unsupported, app-only vs per-user distinction rows.
- Live checks (honest, from sandbox): unauthenticated API error shape
  verbatim; official media/embed endpoints reachability; doc URLs probed
  200 (expect regional/redirect shapes if any — model, don't hide).
- Transport: git bundle base..reddit-connect via tmpfiles.org (.txt
  rename); ledger row update as separate final commit.
- Final report: last message, delimited
  `=== REDDIT-CONNECT REPORT BEGIN/END ===`. Evidence over summaries.
