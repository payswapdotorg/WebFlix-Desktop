# Work order — P5-SOURCES (Phase 5 row 6, the FINAL row): the transparency-source seam

## Identity

- Work ID: P5-SOURCES
- Requirement IDs: desktop-roadmap.md Phase 5 ("supported transparency libraries"); phase5-ad-plan.md §1 BINDING (the access truths: GATC no-API blocked; Meta Ad Library + TikTok CCA pending-authorization; observation-only); AUDIT-SOURCES §6 finding 13 + §11 (the per-source constraints)
- Owner: D2-lane worker (application + contracts for the port shapes)
- Branch: p5-sources
- Base SHA: 67da3c6 (main after the P5-QUALIFY merge)

## Objective

The transparency-source seam: the port + the honest adapters + the
manifest that declares per-source coverage — closing Phase 5's shape
(the automated connectors stay TYPED pending-authorization until the
applications clear; the import path from P5-STORES serves meanwhile).

Scope rows:

1. **Contracts additive (JUSTIFIED, pre-authorized)**: semver minor
   0.10.0->0.11.0 + CHANGELOG; a `TransparencySourcePort` (interface
   only, like TranscriptionEnginePort), `TransparencySourceManifest`
   (source id, display name, coverage declaration — supported
   regions/categories AS DECLARED by the source's own terms, the
   access state enum: available | pending-authorization | blocked,
   the authorization path note), `TransparencyQuery` /
   `TransparencyObservation` (the ad-record-shaped data a source
   reports, mapped to the P5-CONTRACTS AdRecord fields — with
   source-reported-only honesty), error codes genuinely needed
   (ads/source-invalid, ads/source-unavailable, ads/source-not-
   authorized — trim to what the shapes genuinely reject).
2. **Adapters (application or local-library per the architecture —
   follow the whisper/argos seam precedent)**: three
   `TransparencySourcePort` adapters, ALL HONEST-STATE (no network
   calls this order — rg-provable): `GoogleAdsTransparencyAdapter`
   (access state blocked — the manifest carries the no-official-API
   finding + the terms note; every operation returns the typed
   blocked state with the honest reason), `MetaAdLibraryAdapter`
   (pending-authorization — the manifest carries the app-review +
   business-verification path; every operation returns the typed
   pending state naming the application path), `TikTokCommercialContentAdapter`
   (pending-authorization — the approved-research-access path; same
   typed honesty). NO scraping, NO network, NO sneaky fetches — the
   adapters are the SEAM that lights up when authorizations clear.
3. **Source registry + manifest (application)**: a static registry of
   the three adapters (the ranker-registry pattern); a §2.6 use case
   `ads.querySources` that takes a source id + query and returns the
   typed honest state per source (cancelled at boundary; the
   unavailable/pending/blocked states are DATA — surfaced, never
   hidden); a manifest-listing read (`ads.sourceManifests`) returning
   the coverage declarations for the Ad Center's honest display.
4. **Import bridge documentation + tests**: the adapters' output shape
   matches the P5-STORES ads.import input shape (a mapping test — when
   an adapter DOES become authorized, its observations flow through
   the existing import seam unchanged); fixture-replay source doubles
   (CLEARLY LABELED) for the contract/cancellation tests; a manifest
   honesty test (the declared coverage matches the audit's recorded
   constraints — the manifest never claims more than the source's own
   terms).

## Honest non-goals

- NO network calls, NO scraping, NO actual Meta/TikTok API requests
  (authorization is pending — the adapters ship as honest typed
  states; a LATER order wires real transport when/if authorizations
  clear), NO UI changes (the AdCenterPanel is already unmounted), NO
  new stores, NO aggregation, NO coverage promises beyond the
  manifests' declared constraints.
- The blocked/pending states are PRODUCT features, not failures —
  the Ad Center's honesty is the point.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1234 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green)
pnpm --filter webflix-shell test:components   # 70/70 unchanged
```

Also rg evidence: zero network tokens in the adapter files; the three
access states are typed + surfaced; fixture doubles labeled.

## Transport (NO push)

- Commits on branch p5-sources: code commit(s) + SEPARATE ledger-row
  update commit (P5-SOURCES row -> delivered).
- git bundle create /tmp/p5-sources-bundle.txt 67da3c6..p5-sources,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp; token
  re-mints), URL + sha256 in the report.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== P5-SOURCES REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-sources (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
CONTRACTS: 0.10.0 -> 0.11.0 (additive list) | changelog YES/NO
ADAPTERS: <the three + their access states + the honest-reason statements>
MANIFESTS: <the coverage declarations + the audit-constraint match statement>
USE CASES: ads.querySources + ads.sourceManifests — <the typed-state + cancellability statements>
BRIDGE: <the import-shape mapping test statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-SOURCES REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. ENGLISH report markers, verbatim.
