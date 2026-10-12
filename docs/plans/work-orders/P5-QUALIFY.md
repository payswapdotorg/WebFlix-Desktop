# Work order — P5-QUALIFY (Phase 5 row 5): explainable qualification + the Ad Center panel

## Identity

- Work ID: P5-QUALIFY
- Requirement IDs: desktop-roadmap.md Phase 5 ("explainable qualification"); phase5-ad-plan.md §1-§5 (BINDING — §3 separation, §5 honesty); the §4 explainability pattern (reasons[] + evidence pointers) from phase4-mi-plan
- Owner: D2-lane worker + scoped webflix-shell component grant
- Branch: p5-qualify
- Base SHA: 8f1dc1b (main after the P5-VERIFY merge)

## Objective

The explainable qualification engine: a DETERMINISTIC policy that scores
an ad's qualification for the Ad Center view — every point carries
reasons[] with evidence pointers into the stored verification/claim/
signal data — plus the Ad Center shell panel (tested, unmounted per the
P4-ADAPTERS/P4-EVALLOOP precedents).

Scope rows:

1. **Qualification policy (application)**: `ads.qualify` — a §2.6
   cancellable job over ad-record ids: resolves each record's claims,
   stored OfferVerifications (P5-VERIFY), review-signal rows, and
   produces per-record a QualificationExplanation (the P5-CONTRACTS
   shape): a deterministic, versioned (its own closed enum ["v1"] —
   the shape already carries the field), DOCUMENTED policy (fixed
   parameters in the module docblock, the built-in-ranker style):
   e.g. claim-verification ratios WITH their populations, contradiction
   presence, signal counts by source — every reason names the evidence
   pointer (claim id / verification id / signal id) it derives from.
   NO opaque score: the output IS the reasons list + the raw counted
   facts; a record with no data => honest empty reasons + "no data"
   statement, never a zero-dressed-as-signal.
2. **Component (shell, scoped grant)**: an `AdCenterPanel`-class
   component — props-driven (qualification results | null), native,
   aria-labelled, NO fetch/effects/telemetry; renders per-record
   qualification with its reasons + evidence pointers and the counted
   populations (the no-100%-without-N rule); honest empty states;
   UNMOUNTED (the shell index.ts is outside the grant — record it);
   component tests.
3. **Determinism + doubles**: a sha256-pinned determinism corpus; a
   fixture policy pattern ONLY if a double is genuinely needed for
   cancellation tests (label it); deep-equal source-untouched evidence
   over claims/verifications/signals.

## Honest non-goals

- NO connectors (P5-SOURCES — the FINAL row), NO network, NO LLM, NO
  aggregation of review signals into scores (counts per source are
  facts, never merged ratings), NO ranking of ADS against ORGANIC
  content (separation: qualification explains an ad's standing in the
  AD CENTER view, it never feeds the organic ranker — the architecture
  rule pins it), NO model training, NO mounted UI, NO composition-root
  wiring.
- Qualification is DISPLAY-STANDING, not a promise of ad quality — the
  panel states this plainly.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1208 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green)
pnpm --filter webflix-shell test:components   # 57/57 + your new panel tests
```

Also rg evidence: no network; no aggregation vocabulary in the policy;
the panel is props-driven (no fetch/effects).

## Transport (NO push)

- Commits on branch p5-qualify: code commit(s) + SEPARATE ledger-row
  update commit (P5-QUALIFY row -> delivered).
- git bundle create /tmp/p5-qualify-bundle.txt 8f1dc1b..p5-qualify,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp; token
  re-mints), URL + sha256 in the report.
- Final report (last message, VERBATIM, between markers — English
  markers exactly as written):

```
=== P5-QUALIFY REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p5-qualify (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total> (+<n> new)
POLICY: ads.qualify — <the documented parameters + the reasons-carry-evidence statement + determinism corpus sha256>
COMPONENT: <file> — <1-line design + population-display statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P5-QUALIFY REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass. Deliver the report with the ENGLISH markers verbatim.
