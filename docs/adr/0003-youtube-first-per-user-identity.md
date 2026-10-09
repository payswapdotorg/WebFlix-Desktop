# ADR-0003: YouTube-first rollout with per-user provider identity

- Status: Accepted product direction; operation-level access remains subject to technical and policy verification.
- Decision owner: Product architecture / TL2.
- Date: 2026-10-09.

## Context

The product intent is to make WebFlix a primary alternative interface for YouTube first, then expand to additional major social platforms. The existing WebFlix 2.0 app demonstrates many YouTube-facing surfaces but currently relies in places on a single operator session and a CDP-driven broker. That is not the user/account model for the desktop product.

Current YouTube API Developer Policies say API clients that mimic YouTube experiences must add sufficient independent value; API clients must not diminish or remove required standard player behavior, block required advertisements, or use API access to enable restricted downloads/background playback. They also limit data combining/derived metrics and require transparency/privacy protections. The official policies and Terms of Service are authoritative and can change:

- https://developers.google.com/youtube/terms/developer-policies-guide
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/api-services-terms-of-service
- https://www.youtube.com/t/terms

## Decision

1. **YouTube is the first platform integration priority.** The first product slice should provide the broadest useful YouTube interface achievable through reviewed, supported access paths.
2. **Each user connects their own account.** OAuth/access grants and any approved user-mediated session are scoped to that user's local WebFlix profile. There is no shared operator identity, shared user session, or cross-user account action.
3. **Use official APIs and official playback/embedding paths first.** For every operation, document supported scopes, user-visible behavior, quota, region/coverage, storage/retention, test evidence and restrictions.
4. **Do not assume API access authorizes a 1:1 clone.** The product must demonstrate sufficient independent value, remain clearly identified as WebFlix, preserve required player and advertising behavior, and meet applicable API data-use requirements. TL2 must seek an API Compliance Audit or other appropriate guidance if the proposed user experience remains uncertain.
5. **No covert gap-filling.** Missing API capability does not justify quietly shipping scraping, private endpoints, credentials/cookie replay, ad blocking, DRM bypass, unauthorized downloading or background playback. Alternative user-mediated/official-site flows require a distinct source-backed technical and policy review.
6. **Honest parity matrix.** Each desired YouTube surface/action is marked as supported, degraded, requires authentication, unavailable or blocked pending review. The UI must not imply unsupported parity. The matrix records which operations act on YouTube's state and which are WebFlix-local.
7. **Generalize next.** After the first YouTube slice is verified, select the next social platform from explicit capability, authorization, region, quota/cost, policy and user-value evidence. Keep the connector/account/playback architecture provider-neutral.
8. **Preserve local-first behavior.** Local library, local playback and WebFlix-owned preferences remain available without a connected provider account or cloud service.

## Consequences

- D3's first implementation target is the YouTube connector and per-user authorization/playback path, not an abstract provider with no real source.
- D2 must model per-profile connected accounts and keep credentials out of the renderer.
- D1 needs a YouTube-oriented shell and visible account state while keeping WebFlix product identity distinct.
- A source-specific compliance decision may constrain the feature set or the UI shape. TL2 must record the limitation and keep independent work moving.
- Current policies may not allow every desired parity feature through YouTube API Services. Architecture approval is not a claim of legal permission; source operations are accepted one by one after current-policy review.

## Rejected alternatives

- Reusing the old WebFlix 2.0 operator account/broker as a shared identity: rejected because it confuses user ownership and is not the multi-user account model.
- Starting with a generic provider abstraction but no actual YouTube path: rejected because YouTube is the first product milestone.
- Promising feature-for-feature parity independent of source access/policy: rejected because not every operation is available or permitted through every access path.
- Treating the old reverse-engineered integration as automatically approved for the desktop app: rejected because each path requires an explicit review.

## Reconsideration

Revisit the implementation method if official access limits a core operation. Record a new ADR describing the desired operation, user benefit, alternatives, policy evidence, risks and acceptance behavior. Do not silently weaken this ADR.
