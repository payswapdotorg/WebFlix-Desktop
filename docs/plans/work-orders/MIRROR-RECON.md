# Work order — MIRROR-RECON (Phase-2 opener): reconcile D1/D3 lane code to the canonical §2 contracts

## Identity

- Work ID: MIRROR-RECON
- Requirement IDs: contract-freeze §2 (binding), architecture-policy registrations, D1-SHELL/D3-YOUTUBE work orders (mirror rule: "swap-at-integration")
- Owner: Worker 1+3 lanes (or a single reconciliation worker; TL2 arbitrates split)
- Branch: mirror-recon (branched from the post-acceptance phase-1 head recorded in work-claims.md)
- Base SHA: (recorded at dispatch — the phase-1 head after the 2026-10-10 acceptance pass)
- Contract version / prerequisite SHA: freeze 5549208 (v1.0.0) — canonical `packages/webflix-contracts` is BINDING

## Objective

The 2026-10-10 integration pass removed the lane-local `contract-types.ts` mirrors and
re-pointed every lane at the canonical `webflix-contracts` package. The playback lane was
fully reconciled at integration (reference implementation — see the playback commits on
phase-1: canonical §2.2 plan shapes, canonical reason/action vocabulary, canonical
PlaybackProgress). Three surfaces still carry mirror-era vocabulary and FAIL their
package typechecks (the lane-tsc gate TL2 added at integration, closing D1 deliverable #7):

- `packages/webflix-shell` (67 errors): components were written against D1's mirror —
  `AccountState`/`ProviderId` imports that don't exist canonically; account fixtures using
  `accountId`/`state`/`scopes` instead of `internalAccountId`/`status`/`grantedScopes`;
  playback plans read with `strategy`/`kind` fields the canonical union doesn't carry.
- `packages/catalog` (88 errors, mostly fixtures in `src/__tests__/catalog.test.ts`): test
  fixtures use `kind: "movie"` asset kinds (canonical: embed|stream|thumbnail|artwork|trailer|subtitle|download),
  per-asset `title`/`year`/`providerId` fields the canonical ProviderAsset doesn't carry,
  MatchEvidence with `type` (canonical: `{confidence, evidence: string[]}`), and simplified
  availability facts (canonical AvailabilityFact requires providerId/region/available/observedAt).
- `packages/connectors` (68 errors): `registry.ts` reads `displayName`/`manifestVersion`/`policy`
  off the canonical ConnectorManifest (which has none of these) and iterates `operations` as
  an iterable (canonical: `Record<string, {status, detail?, checkedAt?}>`); status vocabulary
  uses `supported-official`/`authorized`/`requires-auth`-as-account-status instead of the
  canonical capability statuses and account statuses (`connected|expired|revoked`); tests
  exercise `credentials.get/put` on CredentialPort (canonical §2.6: `getToken(providerId,
internalAccountId) → CredentialRef {handle}`, handles never tokens).

Reconcile these three surfaces to the canonical shapes the way playback was reconciled:
preserve every behavior/intent, re-express it in the frozen vocabulary, keep tests green
(the substrate is already widened: `pnpm test:unit` now covers top-level `__tests__` dirs,
304/304 green at base).

## Non-goals

- Do NOT change `packages/webflix-contracts` — the canonical §2 shapes are frozen. If a
  canonical shape genuinely cannot express a needed behavior (e.g. a capability detail
  field like retryAfterSeconds), STOP and record it as a freeze-deviation proposal for TL2
  (worker-protocol: deviations require TL2 decision + versioning). Do not fork types again.
- Do NOT reintroduce local contract mirrors of any form.
- Do NOT touch the desktop package, services, or other lanes' paths.

## Allowed and forbidden paths

- Allowed: `packages/webflix-shell/**`, `packages/catalog/**`, `packages/connectors/**`
  (including their tests/fixtures), plus per-package tsconfig alignment if needed.
- Forbidden: everything else; in particular `packages/webflix-contracts/**`,
  `packages/webflix-domain/**`, `packages/webflix-application/**`, `packages/playback/**`,
  `packages/local-library/**`, root config, `docs/adr/**`, `.github/workflows/**`.
- Shared-file owner: n/a (disjoint paths).
- Architecture policy update needed: no (registrations already corrected to the legacy
  maturity model at integration).

## Dependencies and parallelism

- Must land first: this work order (recorded base SHA).
- Can run concurrently with: nothing in Phase-2 (this IS the Phase-2 opener).
- Must not overlap with: any work touching contracts or the desktop package.
- Merge order: single branch → TL2 gate (`pnpm test:unit` + `test:integration` + per-package
  `npx tsc -b packages/<pkg>` for the 8 lane roots + `pnpm lint` zero-new + `pnpm fmt:check`).

## Contract and state

- Public interfaces used: canonical `webflix-contracts` §2.1–§2.8 shapes only.
- Public interface changes proposed: none (freeze-deviation proposals go to TL2 separately).
- State owner: unchanged (stores/ports keep their owners).

## Acceptance evidence

- `npx tsc -b --force packages/webflix-shell packages/catalog packages/connectors` → 0 errors
  (the other five lane roots already pass at base).
- `pnpm test:unit` → all green (count recorded; 304 at base).
- `pnpm test:integration` → 1/1 green.
- `pnpm lint` → zero NEW warnings vs the recorded baseline; `pnpm fmt:check` PASS.
- Ledger row updated (status, head SHA, evidence) before relay.
