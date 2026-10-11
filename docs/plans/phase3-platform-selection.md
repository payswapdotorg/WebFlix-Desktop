# Phase 3 — next-platform selection (TL2 decision matrix)

Status: DRAFT (TL2, 2026-10-10) — decision binds at Phase-2 completion.
Evidence base: AUDIT-SOURCES §5 (platform candidate research, official-source
links, verified 2026-10-09); provider-policy-matrix.md; ADR-0002/0003.

## Selection criteria (roadmap order)

1. Official API/embedding availability for browse + watch (no scraping, ever)
2. Per-user authorization UX (OAuth, isolation from other accounts)
3. User value for the WebFlix audience (media-first watch experience)
4. Quota/cost model under the product's usage shape
5. Policy risk and access gates (app review, regional constraints)

## Ranking (from AUDIT-SOURCES §5, TL2-endorsed)

| Rank | Platform   | APIs                                                                                                                              | Auth                                         | Cost                                              | Gates                                                    | Phase-3 verdict                                                              |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1    | **TikTok** | Display API (user info, video list, direct video source), oEmbed, Content Posting, Research (US/EU, approved), Commercial Content | OAuth 2.0 Login Kit + PKCE, per-user refresh | Free, rate-limited (~600 req/min Display, verify) | Display rules strict; Research gated; regional bans      | **SELECT FIRST** — real read APIs + official embed match the shorts audience |
| 2    | **Twitch** | Helix (videos/VODs, clips, streams, users), official embed player                                                                 | OAuth Authorization Code + App Access        | Free, token-bucket                                | Low; best-documented media API                           | **SECOND** — live+VOD watch fits the PlaybackPlan cleanly                    |
| 3    | Instagram  | Graph API (professional accounts only), oEmbed (app review); hashtag search REMOVED                                               | Facebook Login OAuth                         | Free, ~200 c/h/account, 100 posts/24h             | App review + business verification; no consumer-feed API | Deferred — high audience, weak official browse parity                        |
| 4    | Reddit     | REST API posts/comments/media, embeddable video                                                                                   | OAuth 2.0 per-user + app-only                | Free ~100 QPM; paid tiers for scale               | AI-training terms; rate caps                             | Deferred — easy but modest media-first value                                 |
| 5    | X          | API pay-per-usage credits                                                                                                         | OAuth 2.0                                    | Paid credits                                      | Cost model mismatch for a watch-first product            | Deferred — cost                                                              |
| 6    | Snapchat   | Snap Kit (login display + Bitmoji only); NO public media read                                                                     | Snap Kit OAuth                               | Free                                              | No media read path at all                                | Monitor only                                                                 |

Ad-transparency rows (Google Ads Transparency Center, Meta Ad Library,
TikTok Commercial Content) stay `pending-verification` per
provider-policy-matrix.md — they are Phase-5 (Ad Center) inputs, not Phase-3.

## Phase-3 execution sketch (binds after YOUTUBE-EXPAND review)

1. TIKTOK-CONNECTOR work order: connector manifest rows (Display/oEmbed),
   per-user OAuth (Login Kit PKCE), authorized video list + official embed
   render + honest degrade states; parity matrix row-by-row like YOUTUBE-EXPAND.
2. TWITCH-CONNECTOR follows on the same contracts (Helix + embed player).
3. Both reuse: canonical §2 contracts, capability statuses, per-provider
   partitions (integration 2026-10-10), account isolation (ADR-0003).

## Operator dependencies (flag early)

- TikTok developer app + Login Kit product approval (operator action)
- Twitch developer app registration (operator action, low-friction)
