# Work order — P7-SEARCH-1 (Phase-7 row 1): federated search, honestly

## Identity

- Work ID: P7-SEARCH-1
- Requirement IDs: WF-009 (federated search); NOT WF-010 (no new provider
  surface), NOT WF-011 (no new connectors)
- Owner: D3-lane worker (contracts+application search grant)
- Branch: p7-search-1
- Base SHA: main @ 61c37a4 (or later; clone main; record HEAD as BASE)
- Dispatch condition: phase7-expanded-rows-plan.md merged on main —
  SATISFIED; TL2 dispatched.

## Precondition (hard)

main contains phase7-expanded-rows-plan.md and the P6-PWA-1 merge
(61c37a4 or later). If absent at your base, STOP and report the blocker.

## Objective

Federated search as a typed, fixture-testable seam — three deliverable
groups:

1. **Contracts 0.11.0 → 0.12.0 (additive sibling)** — NEW file
   `packages/webflix-contracts/src/search.ts` + one additive
   `export * from "./search";` line in `src/index.ts` + package.json
   version bump to 0.12.0. Shapes (zod schemas + inferred types, same
   discipline as the ads-sources sibling):
   - `SearchRequest` (query string, per-source paging cursors, optional
     per-source limits)
   - `SearchOutcome` per-source union: `ok` (items: CatalogItem[] + next
     cursor) | `partial-failure` (reason + partial items) | `timeout` |
     `auth-required` | `unsupported` (typed reason) — access states are
     DATA, never thrown
   - `SourceCoverage` (source id, outcome class, counts, elapsed ms)
   - `FederatedSearchResult` (per-source outcomes + the merged item view
     reusing the existing catalog merge seam types — MatchEvidence-driven)
   - ONE rejecting error code `search/source-invalid` in the same style as
     `ads/source-invalid` if a source id is unknown to the registry
2. **Application use case** — NEW file
   `packages/webflix-application/src/federated-search.ts` + registration in
   the package's public entry exports: fan-out across eligible connected
   sources via a `SearchSourcePort` (NEW port interface defined in
   `ports.ts`, additive only), per-source timeout budget, aggregation into
   `FederatedSearchResult`, coverage reporting that NEVER hides a failed
   source. A fixture adapter set (in `src/tests/` or a fixture file) for
   YouTube-like + Reddit-like + one unsupported + one auth-gated source.
3. **Tests (fixture-only, hermetic)** — the WF-009 test list: mixed-source
   paging, per-source timeout, auth-gated source, no-results, partial
   results, unknown-source error, merge correctness with duplicate
   provider assets across two sources.

## Honest non-goals

- NO live network, NO real provider calls, NO credentials (fixture
  adapters only; tests say so plainly).
- NO new connector implementations and NO edits under
  `packages/connectors/` — existing manifests are read-only context.
- NO shell/UI changes — SearchScreen wiring is the P7-COMPOSE-1 row.
- NO edits to existing contract files (only the NEW search.ts + the one
  additive export line + version bump).
- NO catalog package edits; the merged view uses the existing merge types.
- NO matrix edit (status advance is TL2's ruling).

## Gates (run ALL; record exact commands + totals — real numbers)

- npx tsc -b --force (group 1: contracts/domain/application/
  local-library/shell) — exit 0
- npx tsc -b --force (group 2: catalog/connectors/playback) — exit 0
- pnpm test:unit — exact base green + the new search tests
- pnpm test:integration — 1/1
- pnpm lint — zero NEW vs base
- pnpm fmt:check — PASS
- pnpm architecture:check — 0 violations / 0 baseline / 0 new

## Transport (git push delivery — v2 doctrine 2026-10-13)

- Commits on branch p7-search-1: code/docs commit(s) + SEPARATE
  ledger-row update commit (P7-SEARCH-1 row -> delivered in
  docs/plans/work-claims.md).
- DELIVER BY PUSHING YOUR BRANCH TO ORIGIN (the TL2 station pulls and
  runs ALL gates itself on your branch — you do NOT need to run gates
  worker-side; cite any numbers you have, never block on them):
    git push $PUSH_URL
  ($PUSH_URL is provided VERBATIM in your dispatch directive —
  the token is redacted from this repo file by GitHub push
  protection; use the full URL from the directive as-is) p7-search-1:refs/heads/p7-search-1
- Final reply with VERBATIM ENGLISH markers:
  === P7-SEARCH-1 REPORT BEGIN === (BASE / BRANCH / PUSHED <head-sha> /
  WORK SUMMARY / HONEST LIMITS)
  === P7-SEARCH-1 REPORT END ===
  The PUSH is the delivery: no git bundle, no base64 block, no tmpfiles.
  If push is rejected, run git pull --rebase origin main once and re-push.
  If a tool call serializes into the function-name field, pause and emit
  it again as ONE separate properly-formed call — that cure is proven.

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
