# Data ownership, scope and retention

Status: Binding. Any new data store or sync feature maps its data to a row below before implementation.

## Ownership rules

There is one authoritative owner for each fact. A cached projection is not another truth. Provider-sourced content has source provenance and retrieval time. Cross-provider links are claims with confidence/evidence, not a fact established by similar titles alone.

| Data class | Default owner | Scope | Sync/cloud default |
|---|---|---|---|
| Source account likes, follows, subscriptions, comments, billing and remote playlists | External provider | Linked provider account | Never mirrored as editable truth; read/cache only as permitted |
| WebFlix library entry, collection, note, pinned item, local playlist | WebFlix | WebFlix profile/device | Local-only initially |
| Playback resume point and personal watched state | WebFlix | Profile/device unless user syncs | Local-only initially; separate from provider history |
| External playback progress write | External provider | Explicit linked account | Only via explicit capability and authorization |
| Provider metadata and availability | Provider is source; WebFlix keeps provenance-bound projection | Source asset/region/time | Cache according to source terms, TTL and deletion policy |
| Local file path, fingerprint and index state | Local device | Device/user profile | Do not sync absolute paths by default |
| Torrent job, peer state and destination path | Local engine/WebFlix record | Device/profile | Local-only |
| Transcript, translation, dub, summary, overview and embeddings | WebFlix derived artifact based on input | Profile/job/source | No cloud upload by default; rights/consent required |
| Recommendation inputs and feedback | WebFlix | User/profile/source policy | Retention configurable; sync only with explicit policy |
| Connected-provider credentials/tokens | Credential adapter/OS vault | Provider account + local OS user | Never sync plaintext or expose to renderer |
| Ad creative discovered in public/transparency source | Source authoritative; WebFlix metadata projection | Source/ad ID and coverage | Store/cache subject to source rules and URL expiry |
| Ad a user reports seeing | Evidence-backed AdObservation | Explicit user/device/session scope | No passive collection without explicit consent scope |
| Ad qualification and evidence graph | WebFlix assessment over versioned evidence | Assessment/version | Retain snapshots/links only where permitted; show timestamps |
| Third-party reviews | Original review source | Source/review ID | Prefer links and short summaries; comply with terms/retention |
| Diagnostics and app logs | WebFlix | Local profile/device | Redact by default; configurable limited retention |

## Profiles and account separation

- Local profiles do not share library state unless the user chooses to share it.
- Every provider account has a stable internal ID and isolated credential scope. UI cannot choose arbitrary credentials or provider identity.
- WebFlix is initially YouTube-first: each user links their own YouTube account through a reviewed supported authorization mechanism. One user's authorization, history, likes, subscriptions, playlists and writes must never be attributed to another user.
- The connected-account record stores provider, stable internal account ID, granted scopes, status/expiry and revocation state. Tokens/cookies remain inside the credential boundary; renderer code receives account-safe status, not raw secrets.
- Keep unauthenticated public viewing separate from account-linked features; missing authorization cannot be patched by silently using another user's session.
- No inherited ZCode session, account, project API key or profile is imported automatically.
- The old WebFlix 2.0 operator session is not an identity for desktop users.
- Development/test profiles use isolated directories and cannot point to production data unless an explicit guarded flow exists.

## Local-first persistence

- Use versioned schema migrations with forward/backward behavior documented.
- Separate durable user state from regenerable caches/indexes.
- File indexes store paths/fingerprints/metadata; they do not copy media bytes into the database.
- Recovery handles missing/unreadable files, interrupted downloads, corrupt indexes and failed migrations without silently discarding user data.
- Provide backup/export and test restore before claiming durability.
- User deletion defines behavior for local rows, derived artifacts, indexes, cloud replicas and provider-owned data separately.

## Optional cloud sync

Do not introduce cloud as an invisible dependency. A sync ADR must define:

- Exactly which owned fields sync.
- Consent state and account/profile scoping.
- Idempotency keys and retry/outbox behavior.
- Conflict resolution for multi-device edits.
- Deletion tombstones and offline deletion reconciliation.
- Secret exclusion, field-level encryption where warranted and retention.
- Sync pause/reset/export controls and acceptance tests.

## Retention and deletion

Retention belongs to the data class and source policy, not a global arbitrary TTL. Source data may have different rules for content, thumbnails, comments, reviews and derived artifacts. Deletion from WebFlix does not claim removal from the original provider or external copies unless the deletion capability was tested and confirmed. Record deletion attempt/result and remaining copies honestly.