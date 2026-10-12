# Work order — DESKTOP-COMPOSITION-1 (post-Phase-5): mount the Ad Center + MI surfaces in the desktop shell

## Identity

- Work ID: DESKTOP-COMPOSITION-1
- Requirement IDs: desktop-roadmap.md Phase 6 entry ("web and mobile clients … after desktop boundaries are stable" — this order completes the desktop boundary); the standing ledger precedents (P4-ADAPTERS / P4-EVALLOOP / P5-QUALIFY each record "UNMOUNTED by design — a later composition-root order mounts it"); requirements-matrix WF-022 (MI display side) + WF-024..WF-028 (Ad Center display side — the typed honest states this order surfaces)
- Owner: D2-lane worker (webflix-shell composition grant)
- Branch: desktop-composition
- Base SHA: 8440ceb (main after the P5-SOURCES merge + the PHASE 5 COMPLETE declaration)

## Objective

The composition row the ledger has promised since P4: mount the three
props-driven panels into the AppShell's screen set and export them —
the Ad Center and MI surfaces become part of the desktop shell's
navigation, with honest never-run empty states until a host app
(Phase 6) passes real data. The panels mount AS-IS (props-driven per
their own grants); this order adds screens, props plumbing, exports
and tests — nothing else.

Scope rows:

1. **AppShell surfaces (webflix-shell)**: extend `ScreenId` with
   `"ads"` and `"evaluation"`; extend `NAV_ITEMS` with the two entries
   (labels "Ad Center" and "MI Evaluation" — match the existing
   capitalization/style); add render branches: the ads screen mounts
   `AdCenterPanel`; the evaluation screen mounts
   `RankerAdapterSelector` above `EvaluationPanel`. Navigation tests
   follow the existing pattern (`data-testid="nav-ads"` /
   `data-testid="nav-evaluation"`, `aria-current="page"` when active).
2. **AppShellProps extension (flat optional, the existing pattern)**:
   `adCenterResults?: readonly AdsQualificationItemOutcome[] | null`
   (default null), `evaluationResult?: EvaluationResult | null`
   (default null), `rankerAdapterEntries?: readonly
RankerAdapterDescriptor[]` (default []), `rankerSelectedAdapterId?:
string | null` (default null), `onRankerAdapterSelectionChange?:
(adapterId: string) => void`, `rankerStatusNote?: string | null`
   (default null — absent renders nothing). Defaults are the honest
   never-run states; NO faked data, NO invented defaults that look
   like real results.
3. **Exports (webflix-shell/src/index.ts)**: export `AdCenterPanel`,
   `EvaluationPanel`, `RankerAdapterSelector` + their props types,
   following the existing export block style.
4. **Component tests (packages/webflix-shell/tests/)**: the two new
   nav buttons render + switch screens; prop pass-through reaches the
   panels (qualification outcomes render in the ads screen; the
   evaluation result + selector entries/selection render in the
   evaluation screen); honest empty states when props are absent
   (null/[] — the panels' own never-run states, no crash); the
   selector's `onSelectionChange` fires through the AppShell prop;
   the ADR-0003 notice stays in the shell chrome. Components suite
   70/70 + your new tests.

## Honest non-goals

- NO host-app wiring (Phase 6 web/mobile clients pass real data —
  this order only mounts the props-driven surfaces), NO contract
  changes (webflix-contracts stays 0.11.0), NO application / domain /
  local-library changes, NO panel-internal changes (the panels mount
  AS-IS — their internals belong to their own grants), NO data
  fetching, NO stores, NO new §2.6 use cases, NO aggregation.
- The never-run empty states are the honest default: an unmounted-
  data screen says so via the panels' own null states — never a
  spinner that pretends loading, never a placeholder that pretends
  data.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (1326 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green)
pnpm --filter webflix-shell test:components   # 70/70 + new
```

Also rg evidence: zero network tokens in any file you touch; no
useEffect/useState additions in the panels themselves (mount-only
changes); the new screens carry the honest null-state defaults.

## Transport (NO push)

- Commits on branch desktop-composition: code commit(s) + SEPARATE
  ledger-row update commit (DESKTOP-COMPOSITION-1 row -> delivered).
- git bundle create /tmp/desktop-composition-bundle.txt
  8440ceb..desktop-composition, upload to tmpfiles.org (.txt rename),
  verify (GET + cmp; token re-mints ~10 min), URL + sha256 in the
  report.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== DESKTOP-COMPOSITION-1 REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: desktop-composition (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total> (+<n> new)
SCREENS: <the two new ScreenId values + nav labels + testids>
PROPS: <the new AppShellProps fields + their honest defaults>
EXPORTS: <the three panels + types>
PANEL CHANGES: none (mounted as-is — state this)
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== DESKTOP-COMPOSITION-1 REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats a
fabricated pass. ENGLISH report markers, verbatim.
