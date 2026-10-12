# Work order — P5-STORES (Phase 5 row 2): the durable Ad Center stores

## Identity

- Work ID: P5-STORES
- Requirement IDs: desktop-roadmap.md Phase 5 (advertiser identity / claim / evidence-graph persistence — the shapes P5-CONTRACTS just landed); phase5-ad-plan.md §1-§5 (BINDING: separation, honest coverage, honesty rules); phase4-mi-plan.md §2-§3 patterns (jobs, originals-never-mutated) carry over
- Owner: D2-lane worker (application + local-library; domain only for genuine invariants)
- Branch: p5-stores
- Base SHA: d0ee1ab (main after the P5-CONTRACTS merge)

## Objective

The durable Ad Center stores: every P5-CONTRACTS shape gets a
migration-backed store (local-library), plus the IMPORT SEAM — the
honest path ad data enters the system until transparency connectors
are authorized (P5-SOURCES).

Scope rows:

1. **Migration 0006** (the 0002-0005 rules): OWN ad\_\* tables —
   ad_records, ad_identities, ad_claims, ad_evidence_edges,
   ad_review_signals — canonical JSON columns for the shape payloads,
   per-profile structural isolation (one profile-scoped db handle per
   adapter), NO FK into catalog/intelligence tables (separation is
   structural: ad tables reference ONLY each other where genuinely
   needed, e.g. claims -> records).
2. **Stores (local-library)**: one store module per table family with
   the house pattern — put/get/list with typed absent errors
   (ads/\*-absent codes as genuinely needed), append-only where the
   shape is append-only (review signals, evidence edges), put-replaces
   where the shape is a record (ad records by source id — re-import
   REPLACES with the new batch provenance), deterministic listing
   order. A store-level checksum per canonical payload (the FNV-1a
   identity-checksum pattern), re-verified on read (tamper surfaces
   typed).
3. **Import seam (application)**: `ads.import` — a §2.6 cancellable
   job taking an import batch (ad records + identities + claims as
   extracted spans + optional review signals, all carrying the
   P5-CONTRACTS provenance), validating through the domain
   invariants, persisting atomically-per-record (a bad record fails
   THAT record typed — the batch reports per-record outcomes, honest
   counts: accepted / rejected-with-reason); NO silent merges, NO
   dedup magic (same source id + same batch = replace; same source id
   different batch = a NEW version appended with provenance — never
   overwrite history silently).
4. **In-memory doubles + tests**: in-memory store doubles (the
   house pattern) for application tests; local-library suite per the
   0004/0005 patterns (round-trips, absent-typed, tamper-typed,
   restart durability, pre-0006-migration regression, per-profile
   isolation).

## Honest non-goals

- NO extraction engine (P5-CLAIMS builds ON these stores — the
  import seam takes claims AS DATA, it does not extract them), NO
  verification machinery (P5-VERIFY), NO connectors (P5-SOURCES — the
  import seam is the honest interim path), NO UI, NO network, NO
  aggregation of review signals.
- No cross-store inferences (an evidence edge references a claim id;
  the stores never JOIN across the ad/intelligence boundary —
  separation).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1041 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (the separation rule stays green)
pnpm --filter webflix-shell test:components   # 57/57 unchanged
```

Also rg evidence: no network; the ads stores import nothing from
intelligence/ranking modules and vice versa.

## Transport (NO push)

- Commits on branch p5-stores: code commit(s) + SEPARATE ledger-row
  update commit (P5-STORES row -> delivered).
- git bundle create /tmp/p5-stores-bundle.txt d0ee1ab..p5-stores,
  upload to tmpfiles.org (.txt rename), verify the direct link (GET +
  cmp; the /dl/ token ~10-min — the landing page re-mints), URL +
  sha256 in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P5-STORES REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-stores (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
MIGRATION: 0006 <name + the ad_* table list + isolation statement>
STORES: <one line per store — the typed absent/tamper/replace semantics>
IMPORT: ads.import <cancellability evidence + per-record-outcome statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-STORES REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
