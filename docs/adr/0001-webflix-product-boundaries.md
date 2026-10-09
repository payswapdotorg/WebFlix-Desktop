# ADR-0001: WebFlix product identity and repository boundaries

- Status: Accepted
- Decision owner: TL2
- Date: 2026-10-09

## Context

This repository is a ZCode fork with a substantial Electron/React/agent substrate. The existing WebFlix 2.0 repository is a Next.js/YouTube-oriented web app. Wrapping it in Electron or treating YouTube DTOs as the universal domain would prevent a cross-source product and create identity coupling.

## Decision

1. WebFlix-Desktop is the sole source of truth for the new product.
2. ZCode is upstream infrastructure to selectively retain/adapt, not the shipped product identity.
3. WebFlix 2.0 is a behavior and integration reference, not a runtime dependency or the new desktop architecture.
4. WebFlix domain/application contracts are platform-neutral and provider-neutral.
5. Local library, playback, collections and preferences should be useful without WebFlix login/cloud where possible.
6. Remote account operations are isolated per user/provider, explicitly authorized and capability-checked.
7. Catalog/connectors, playback, local library/downloads, recommendations, media intelligence and Ad Center remain separate domains.
8. Repository requirements, ADRs, work claims and acceptance evidence are binding; chat and agent memory are not.

## Consequences

- The first milestone is a real desktop vertical slice, not a broad feature parade.
- TL2 inventories inherited identity, data paths, telemetry, update config, credentials and external services before release packaging.
- New modules declare contracts and managed architecture rules as their roots are introduced.
- Reuse is incremental and evidence-driven.
- Provider policy/capability differences are visible rather than hidden behind a universal feature promise.

## Rejected alternatives

- Wrapping the existing Next.js application in Electron, because it preserves single-provider coupling.
- Replacing all of ZCode before the first usable release, because it discards working desktop infrastructure.
- Renaming every internal package immediately, because it adds integration risk without user value.
- Treating YouTube as the source of truth for every media type, because WebFlix is multi-source.

## Reconsideration triggers

A change requires a new ADR and updates to the architecture lock, contracts and requirements matrix in the same change.
