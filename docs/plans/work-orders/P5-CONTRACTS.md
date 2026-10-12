# Work order — P5-CONTRACTS (Phase 5 row 1): the Ad Center contract module

## Identity

- Work ID: P5-CONTRACTS
- Requirement IDs: desktop-roadmap.md Phase 5 ("advertiser identity, claim extraction, evidence graph, independent review signals, offer verification and explainable qualification … keep Ad Center separate from organic recommendations"); phase5-ad-plan.md §1-§6 (BINDING — read it first); phase4-mi-plan.md §1-§4 (the additive + honesty patterns carry over)
- Owner: D2-lane worker (contracts + domain invariants; application only if a use case is needed to prove the shapes)
- Branch: p5-contracts
- Base SHA: 9d90ebd (main head: the Phase-5 decision doc commit atop ba089a5)

## Objective

The Ad Center contract module — a NEW additive sibling in
webflix-contracts (e.g. src/ads.ts) — carrying the shapes every later
Phase-5 row builds on, plus the architecture rule that PINS the
separation (ad types never in the organic ranking path).

Scope rows:

1. **Contracts additive (JUSTIFIED, pre-authorized)**: semver minor
   0.7.0->0.8.0 + CHANGELOG + TL2 note; frozen §2.1-2.6, the
   intelligence module, and every earlier additive untouched.
   Shapes (zod + readonly TS views per the house style):
   - `AdvertiserIdentity` — verified-identity facts a transparency
     source reports (ids, names, regions, verification state as
     SOURCE-REPORTED enums — never our own judgment; absent means
     absent)
   - `AdRecord` — one observed ad: source id, advertiser identity
     ref, creative text/urls the source exposed, regions/periods,
     provenance (which source, when imported/observed, the import
     batch id); NO ranking signals, NO user data — separation starts
     in the shapes
   - `Claim` — an EXTRACTIVE claim: a quoted span of the ad's own
     text with its character offsets + the AdRecord id it came from
     (a claim the source did not state is a defect — offsets + quote
     discipline like the Phase-4 Q&A spans)
   - `EvidenceLink` — one evidence-graph edge: a Claim id linked to
     an evidence node (typed kinds: source-reported-fact,
     independent-review, offer-terms, user-imported-document), each
     carrying provenance + the relationship (supports / contradicts /
     contextualizes)
   - `ReviewSignal` — an independent review signal (source,
     as-reported rating/classification, region/scope, provenance);
     as-reported ONLY — no aggregation into "scores" this order
   - `OfferVerification` — the honest verification record: WHAT was
     checked, against WHICH declared sources, WHEN, and the OUTCOME
     as a typed state (verified-against-declared-source /
     not-verifiable / contradicted / unchecked) — never a bare
     "verified" badge without the evidence list
   - `QualificationExplanation` — reasons[] with evidence pointers
     (the §4 explainability pattern) + the deterministic policy
     version pin (its own closed enum, ["v1"], like the ranking
     policy)
   - Error codes genuinely needed (e.g. ads/record-invalid,
     ads/claim-invalid — trim to what the schemas genuinely reject;
     naming follows the existing intelligence/* conventions but the
     ads/* lane is its own)
2. **Separation architecture rule**: extend the architecture-check
   configuration so that packages/webflix-application ranking use
   cases (the organic path: built-in-ranker, record-feedback,
   set-objectives, mi-*) CANNOT import the new ads module (and vice
   versa where senseless) — the rule PINS phase5-ad-plan §3. Wire it
   as a real arch violation with a test that proves it fires (a
   deliberate bad-import fixture in the arch test suite).
3. **Domain invariants (webflix-domain, genuine only)**: claim-offset
   validation (offsets within the source text, quote byte-equal),
   evidence-edge referential shape checks, the offer-verification
   state machine legality (unchecked -> checked states only) — as
   pure functions in the domain style, with tests.
4. **Contract tests**: round-trip + rejection suites for every schema
   (the house pattern), including honest-absent optionals, and the
   separation rule's firing test.

## Honest non-goals

- NO stores, NO migrations (P5-STORES), NO extraction engine
  (P5-CLAIMS), NO verification logic beyond the STATE SHAPES
  (P5-VERIFY), NO qualification scoring (P5-QUALIFY), NO connectors
  (P5-SOURCES), NO UI, NO network, NO LLM anywhere.
- No aggregation of review signals into scores; no "verified" without
  the evidence list — the SHAPES make dishonesty hard, this order
  does not build the machinery.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (982 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (the NEW separation rule must pass on a clean tree)
pnpm --filter webflix-shell test:components   # 57/57 unchanged
```

Also rg evidence: no network; the ads module imports nothing from
ranking/intelligence modules and vice versa.

## Transport (NO push)

- Commits on branch p5-contracts: code commit(s) + SEPARATE ledger-row
  update commit (P5-CONTRACTS row -> delivered).
- git bundle create /tmp/p5-contracts-bundle.txt 9d90ebd..p5-contracts,
  upload to tmpfiles.org (.txt rename), verify the direct link (GET +
  cmp; the /dl/ token ~10-min — the landing page re-mints), URL +
  sha256 in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P5-CONTRACTS REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-contracts (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations> (separation rule live: YES/NO + firing-test evidence)
- components: <pass>/<total>
CONTRACTS: 0.7.0 -> 0.8.0 (additive list) | changelog YES/NO
SHAPES: <the 7 shapes + error codes, 1 line each>
INVARIANTS: <the domain validations, 1 line each>
SEPARATION: <the arch rule + the firing test statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-CONTRACTS REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
