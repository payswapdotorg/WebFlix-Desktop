# Work order — P6-WEB-HOST-1 (Phase-6 row 2): the first web client host slice

## Identity

- Work ID: P6-WEB-HOST-1
- Requirement IDs: phase6-clients-plan.md (binding constraints §1-§8 + sequencing row 2); desktop-roadmap.md Phase 6 ("Reuse contracts and application use cases after desktop boundaries are stable"); requirements-matrix "platform-neutral application contracts for future web/mobile clients"
- Owner: D2-lane worker (new-app grant: apps/web-client/\*\*)
- Branch: p6-web-host
- Base SHA: main AFTER the DESKTOP-COMPOSITION-1 merge (clone main; the base is main HEAD at your clone — record it; the composition screens must already be in the shell you mount)

## Objective

The first REAL web client: a NEW thin host (apps/web-client, Vite +
React 19, pnpm-workspace-wired) that composes the existing
webflix-shell + webflix-application packages — proving the roadmap's
reuse claim on the web runtime, with every seam honest.

Dependency facts (verified at authoring): webflix-application depends
ONLY on webflix-contracts + webflix-domain (no Node-only imports);
webflix-shell depends on application + contracts. The browser host
therefore imports BOTH cleanly. local-library (better-sqlite3) is
NEVER imported by the host.

Scope rows:

1. **Host skeleton**: apps/web-client — Vite + React 19 + TypeScript,
   wired into the pnpm workspace (workspace: package), its own
   tsconfig project (composite, referencing the two package projects
   per the monorepo's existing project-reference pattern), vitest
   config following the shell's component-test pattern.
2. **Composition (the reuse proof)**: the host renders `AppShell`
   with ALL screens (home / search / library / accounts / ads /
   evaluation — the post-COMPOSITION set) and wires the
   browser-safe application layer: the in-memory stores + use cases
   the application package exports. The Ad Center / MI surfaces mount
   with their honest never-run empty states (session-only reality:
   no durable persistence on web — phase6 plan §4).
3. **Session-only honesty, TYPED + LABELED**: a host-level constant
   (e.g. PERSISTENCE_MODE = "session-only" as a typed literal) +
   a shell-chrome notice in the host's App wrapper (the ADR-0003
   notice pattern): session-only storage, durable sync is a later
   row. NO localStorage persistence claims, NO fake-durable.
4. **Unavailable-surface honesty**: connector/engine surfaces that
   need user authorization, keys, or the Node runtime render their
   typed unavailable states (named, with the desktop path named) —
   the host adds NO keys, NO network calls, NO analytics.
5. **Tests + build**: component tests (AppShell renders in the host,
   screens switch, the session-only notice is present, honest empty
   states render); `pnpm --filter web-client build` (or the app's
   build script) succeeds — the bundle is the proof the web runtime
   composes.

## Honest non-goals

- NO durable persistence (later, explicitly-designed row), NO mobile
  claims, NO connector network/key wiring, NO new contract shapes
  (contracts stay 0.11.0; an FD proposal if a shape is genuinely
  missing), NO application/domain/shell changes (the host CONSUMES
  them; if a change feels needed, propose the FD instead), NO
  analytics/telemetry, NO resurrection of fork-era app code (the
  critical constraint: do not wrap the old Next.js app).

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
npx tsc -b --force apps/web-client   # 0 (NEW — the host project)
pnpm test:unit          # all green (base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base
pnpm fmt:check          # PASS
pnpm architecture:check # 0 (separation stays green; the host adds no violations)
pnpm --filter webflix-shell test:components   # unchanged green
pnpm --filter web-client test   # your host tests green (NEW)
pnpm --filter web-client build  # bundle emitted (NEW)
```

Also rg evidence: zero network tokens in apps/web-client source; zero
local-library imports in apps/web-client source; no
localStorage/sessionStorage writes beyond what is typed + labeled.

## Transport (NO push)

- Commits on branch p6-web-host: code commit(s) + SEPARATE ledger-row
  update commit (P6-WEB-HOST-1 row -> delivered).
- git bundle create /tmp/p6-web-host-bundle.txt <base>..p6-web-host,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp; the /dl/
  token re-mints ~10 min — the landing page carries the current
  link), URL + sha256 in the report.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== P6-WEB-HOST-1 REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p6-web-host (head <sha>, <n> commits)
GATES:
- tsc the three groups: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- shell components: <pass>/<total>
- web-client tests: <pass>/<total>
- web-client build: <emitted | failed + reason>
COMPOSITION: <the AppShell screens mounted + the application layer wired>
SESSION-ONLY HONESTY: <the typed literal + the notice statement>
UNAVAILABLE SURFACES: <the typed states + the named desktop paths>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P6-WEB-HOST-1 REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats a
fabricated pass. ENGLISH report markers, verbatim.
