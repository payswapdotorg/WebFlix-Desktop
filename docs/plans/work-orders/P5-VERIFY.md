# Work order — P5-VERIFY (Phase 5 row 4): offer verification + independent review signals

## Identity

- Work ID: P5-VERIFY
- Requirement IDs: desktop-roadmap.md Phase 5 ("independent review signals, offer verification"); phase5-ad-plan.md §1-§5 (BINDING — especially §5: verification states WHAT was checked and against WHAT, never a "verified" badge without evidence); P5-CONTRACTS OfferVerification/ReviewSignal shapes + P5-STORES/CLAIMS (the stores + claims/evidence the verification READS)
- Owner: D2-lane worker (application + local-library for the verification store; domain for genuine invariants; contracts only for a genuinely-missing code)
- Branch: p5-verify
- Base SHA: a931caf (main after the P5-CLAIMS merge)

## Objective

The offer-verification machinery: checking claims/offers against the
EVIDENCE the system holds (imported evidence edges, stored review
signals, offer-terms documents), producing OfferVerification records
that state exactly WHAT was checked, against WHICH evidence, and a
TYPED outcome — plus the review-signal reading path (as-reported,
provenance-carrying, NO aggregation).

Scope rows:

1. **Verification store (local-library, migration 0007)**: the
   OfferVerification records table (own ad_* family table, the 0006
   rules — canonical JSON, per-profile isolation, no cross-boundary
   FKs); put/get/list, append-only by verification id, deterministic
   listing.
2. **Verification engine (application)**: `ads.verify` — a §2.6
   cancellable job taking claim ids (or an ad-record id => its
   claims), RESOLVING the evidence available per claim through the
   stored evidence edges + review signals + imported offer-terms, and
   producing a typed OfferVerification per claim: the checks list
   (each check names the evidence node id + kind + what was compared),
   the outcome enum (verified-against-declared-source /
   not-verifiable / contradicted / unchecked) DERIVED ONLY from the
   resolved evidence (a claim with NO linked evidence => unchecked,
   honestly; a contradicting review signal => contradicted with the
   signal id; NEVER a fabricated verified). The comparison itself is
   DETERMINISTIC and documented (e.g. offer-terms numeric/text
   comparison rules, review-signal polarity mapping — fixed
   parameters in the module docblock).
3. **Review-signal reading (application)**: `ads.reviewSignals` — a
   §2.6 read job listing the stored signals for an advertiser/ad
   AS-REPORTED (the provenance carries source + as-of; NO aggregation,
   NO scoring, NO normalization across sources — two sources' ratings
   are displayed as two rows, never merged into one number).
4. **Invariants + tests**: the domain invariant for the verification
   state machine (unchecked -> checked transitions only; the outcome
   must be consistent with the checks list — an empty checks list can
   never yield verified); engine determinism corpus (sha256-pinned);
   honest-empty tests (no evidence => unchecked, no signals => empty
   list); cancellation both phases; the source claims/signals NEVER
   mutated (deep-equal).

## Honest non-goals

- NO external fetching (verification runs over STORED evidence only —
  live-source verification would need P5-SOURCES authorization),
  NO qualification scoring (P5-QUALIFY), NO connectors, NO UI, NO
  network, NO LLM, NO truth invention: the engine compares what the
  user imported, and says so.
- No aggregation of review signals (the roadmap's "independent" is
  per-source independence — preserved by never merging).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1166 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green)
pnpm --filter webflix-shell test:components   # 57/57 unchanged
```

Also rg evidence: no network; no aggregation in the review-signal
path; the outcome derivation reads only resolved evidence.

## Transport (NO push)

- Commits on branch p5-verify: code commit(s) + SEPARATE ledger-row
  update commit (P5-VERIFY row -> delivered).
- git bundle create /tmp/p5-verify-bundle.txt a931caf..p5-verify,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp; token
  re-mints), URL + sha256 in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P5-VERIFY REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-verify (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
STORE: migration 0007 <name + isolation statement>
VERIFY: ads.verify — <the evidence-resolution + typed-outcome statement + the deterministic comparison rules>
- outcome-derivation evidence: <tests statement — empty-checks-never-verified etc>
SIGNALS: ads.reviewSignals — <the as-reported no-aggregation statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-VERIFY REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
