# Connector and engine capability registry contract

Status: Binding for every new connector, provider integration and replaceable engine.

## Purpose

The registry answers what this exact source/engine can do for this user, platform, region and current session. It is not just a list of providers or a static feature checklist. Its output must drive UI affordances, use-case eligibility and honest fallbacks.

## Connector manifest requirements

Each connector manifest declares:

- Stable ID, version and contract version.
- Display name, description, source category and maintainer/owner.
- Supported client surfaces and operating systems.
- Supported media types.
- Authentication type, account scope, requested permissions and re-auth requirements.
- Capabilities for search, metadata/detail, artwork, playback, progress sync, comments/engagement, captions/transcripts, historical search, creator operations, local download, torrent operations where applicable, and deletion/export.
- Region/category/date coverage and source-defined limits.
- Quota/rate limit, timeout, retry and caching guidance.
- Source terms/policy references and the date/reviewer of the last policy check.
- Data collected, stored fields, retention and deletion behavior.
- Provenance fields supplied by the source and known missing fields.
- Health/availability check and typed failure mapping.
- Security requirements and isolation mode for remote browser content.

Do not declare all capabilities implemented by default. A connector may support search and metadata while playback, captions or engagement remain unsupported.

## Capability status enum

Every operation returns one of:

- **supported** — implementation is present and available under the current conditions.
- **unsupported** — the source/adapter does not implement the operation.
- **requires-auth** — the user must connect or reauthorize an account.
- **unavailable** — temporary failure, regional restriction, upstream outage or local prerequisite failure.
- **rate-limited** — source or WebFlix budget prevents the operation now.
- **degraded** — a reduced path is operating with a clear limitation.
- **unknown** — not yet verified; UI must not imply support.

A status includes reason/code, retryability, user-safe message, evidence/check timestamp, affected scope and optional recovery action. Never turn timeout, denial or parse failure into empty success.

## Contract boundaries

- Registry interface: list/query connectors and their declared capabilities.
- Connector interface: search, resolve canonical reference, fetch detail, request playback plan, optional user-authorized actions and source health.
- Playback interface: returns a typed PlaybackPlan or typed failure; a raw URL is not mandatory.
- Engine interface: inspect input, capability list, run a typed job, report progress/cancel/result and expose version/health.
- Auth interface: connect, refresh, revoke and inspect status without leaking credentials to renderer.
- Registry must not expose provider SDK objects directly to UI or domain code.

## Search semantics

1. Determine eligible connectors based on query, filters, source preference, auth and consent.
2. Query eligible connectors concurrently with bounded per-source timeouts and a total latency budget.
3. Normalize responses and preserve source identity/provenance.
4. Deduplicate only with explicit identifiers or explainable, confidence-scored cross-source matching.
5. Return results with queried sources, skipped sources/reasons, partial failures, date/region/category coverage and next-page cursors.
6. Distinguish no results from no eligible source, auth required, timeout and unsupported query.
7. Preserve a stable cursor or defined merge strategy as sources page independently.

## Cache and quota rules

- Cache only data the source permits, with per-type TTL and provenance.
- Never cache secrets, auth results or user-private content in shared caches.
- Include user/tenant/region/provider in keys where scope affects responses.
- Rate-limit per provider and credential/account where appropriate; do not let one connector's outage block others.
- Disclose fetch/check time for stale results wherever freshness matters.
- Retry only idempotent operations unless the contract defines write idempotency.

## Engine replacement

Each engine has a stable contract and implementation ID/version. A feature selects an engine through registry/policy configuration, not by importing a concrete engine. Add contract tests that run against a fake engine, plus adapter tests for real behavior. Fakes are for hermetic contract verification, never a production fallback that pretends to process media.

## Required acceptance per integration

- Manifest validated at startup/build.
- Happy path, unsupported, requires-auth, unavailable, rate-limited, malformed response and cancellation covered.
- Coverage/status rendered truthfully in UI.
- Source identity and provenance preserved.
- Timeouts/quotas/secrets handled within policy.
- Actual external smoke test executed separately from fixtures where authorized.
- Source/policy review, owner, test evidence and date recorded in provider-policy-matrix.md.