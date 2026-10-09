# ADR-0002: Provider capabilities and playback plans

- Status: Accepted
- Decision owner: TL2
- Date: 2026-10-09

## Context

Sources differ in search APIs, auth, region access, embed support, direct playback, download rights, quotas and retention. Modeling every result as a universal video URL or assuming uniform capabilities would make the experience inaccurate and hard to replace.

## Decision

- Connectors publish manifests and per-operation capability states through a registry.
- Catalog identity and source-specific ProviderAsset are different entities.
- Playback returns a typed plan: official embed; isolated official website/browser; local file; source-authorized direct media; user-authorized torrent stream; external app/deep link; or a typed unsupported/unavailable result.
- Federated search includes coverage/partial-failure metadata and never promises completeness beyond queried sources.
- Every provider operation requires a source-specific policy review and evidence record; API/embedding access is not blanket permission to download, rehost or mirror data.
- No universal DRM circumvention, covert stream extraction or source-independent guarantee of playback is part of WebFlix architecture.

## Consequences

- Source limitations become first-class UI states.
- A provider may be searchable without being playable or downloadable.
- New providers need manifest and contract tests, source/policy evidence, actual smoke and E2E verification.
- Ranking consumes canonical items while retaining source provenance.
- Policy changes can disable an operation without redesigning the domain/UI.

## Reconsideration

Revisit only with concrete evidence that an operation cannot be represented by the contracts or status model. Update the capability contract and acceptance matrix in the same reviewed change.