# Work order — P4-EVALLOOP (Phase 4 row 7): the experiment/evaluation loop

## Identity

- Work ID: P4-EVALLOOP
- Requirement IDs: desktop-roadmap.md Phase 4 ("experiment/evaluation loop … Use cancellable jobs and original/derived artifact separation"); phase4-mi-plan.md §2 (jobs ride §2.6), §3 (originals never mutated — evaluation is read-only), §4 (explainability), §5 (local signals only), §6 (user-selected adapters — the A/B seam); P4-CONTRACTS FeedbackEvent/UserObjective/RankingPolicyVersion (the closed enum stays ["v1"] — NO v2 this order; the loop compares the built-in v1 policy against SELECTED ADAPTERS, not against an invented v2)
- Owner: D2-lane worker + scoped webflix-shell component grant
- Branch: p4-evalloop
- Base SHA: 2870df3 (main after the P4-TRANSLATE merge)

## Objective

The experiment/evaluation loop: OFFLINE replay of stored feedback +
objectives through ranking policies (the built-in v1 and any
user-selected adapter), producing HONEST metrics — deterministic,
side-effect-free, cancellable — plus a shell evaluation panel component
(tested, unmounted per the P4-ADAPTERS precedent).

Scope rows:

1. **Contracts additive (JUSTIFIED, pre-authorized)**:
   `EvaluationRequest` (profile-scoped: which feedback/objectives to
   replay, the catalog item ids under test, the ranker configurations to
   compare — built-in policy AND/OR adapter ids from the selection
   store), `EvaluationResult` + per-configuration `EvaluationOutcome`
   (the rankings produced + the metrics), metric shapes:
   explicit-feedback agreement (share of explicitly-rated items whose
   policy ranking agrees with the rating direction, with the counted
   populations NAMED — liked-in-top-k, disliked-in-bottom-k, abstained),
   overlap@k, and descriptive distribution stats — every metric carries
   its population size so a 1/1 "100%" can never masquerade as strong
   evidence; error code `intelligence/evaluation-invalid` (caller
   defects); cancellation reuses common/cancelled. Semver minor
   0.6.0->0.7.0 + CHANGELOG + TL2 note; frozen §2.1-2.6, the policy
   enum, and the kind enum untouched.
2. **Replay engine (application)**: a DETERMINISTIC, PURE offline replay
   — reads the stored feedback events + objectives + the catalog items
   under test, runs each configured ranker (the built-in policy through
   the domain resolver + selected adapters through the adapter registry
   with fail-soft surfaced per configuration), produces rankings +
   metrics. READ-ONLY over every store (deep-equal untouched evidence);
   NO writes to feedback/objectives/artifacts; no network; no
   fabricated ground truth (metrics measure AGREEMENT with the user's
   own explicit signals, and say so in their names/docblocks).
   Honest-empty: zero feedback or empty item sets => typed honest
   results with population 0, never invented numbers.
3. **Use case (application)**: `mi.evaluate` — rides §2.6 (cancellable
   at boundary + cooperative between ranker configurations); cancelled
   => Cancelled + NO partial result persisted; the evaluation result is
   returned in the job result (NOT a DerivedArtifact — an evaluation is
   an experiment read-out, not a derived artifact of a catalog item;
   document this decision in the module docblock).
4. **Shell component (scoped grant)**: an `EvaluationPanel`-class
   component — native, aria-labelled, displays a completed evaluation's
   per-configuration outcomes with their metrics AND population sizes
   (an honest-metrics UI: no 100% without N), factual "no evaluation
   run yet" empty state; NO fake data, NO fetch/effects/telemetry
   (props-driven, like the RankerAdapterSelector); component tests.
   Unmounted (shell index.ts outside the grant — record it).
5. **Test double + determinism**: fixture-replay adapters as needed for
   cancellation/contract tests (CLEARLY LABELED doubles); a determinism
   corpus test (same feedback+objectives+items => byte-identical
   evaluation result, sha256-pinned).

## Honest non-goals

- NO policy v2 (the enum stays ["v1"] — v2 arrives additively when a
  real v2 design exists; this order ships the LOOP, not a new policy).
- NO online metrics, NO telemetry, NO network, NO model training, NO
  writing back evaluation results into ranking state (offline means
  offline: the loop informs the USER, never mutates the live ranker).
- NO composition-root wiring, NO mounted UI (the panel ships tested
  but unmounted; wiring is a later order).
- NO DerivedArtifact for evaluations (documented decision above).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (921 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components   # 44/44 + your new component tests
```

Also rg evidence: no network in the pipeline; no writes into
feedback/objective/artifact stores from the evaluation path; fixture
adapters labeled test doubles.

## Transport (NO push)

- Commits on branch p4-evalloop: code commit(s) + SEPARATE ledger-row
  update commit (P4-EVALLOOP row -> delivered).
- git bundle create /tmp/p4-evalloop-bundle.txt 2870df3..p4-evalloop,
  upload to tmpfiles.org (.txt rename), verify the direct download link
  (GET + cmp byte-identical; NOTE: the /dl/ token is ~10-min — the
  landing page re-mints), URL + sha256 in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P4-EVALLOOP REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p4-evalloop (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total> (+<n> new)
CONTRACTS: 0.6.0 -> 0.7.0 (additive list) | changelog YES/NO
REPLAY:
- engine: <files> — <1-line design + read-only evidence>
- metrics: <list with population-naming statement>
- adapters: <built-in + selected-adapter comparison statement + fail-soft handling>
- mi.evaluate: <cancellability evidence>
- determinism corpus: <file + sha256 stability statement>
- honest-empty: <zero-feedback/empty-items test evidence>
COMPONENT: <file> — <1-line design + population-display statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P4-EVALLOOP REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
