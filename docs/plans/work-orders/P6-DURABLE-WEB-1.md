# Work order — P6-DURABLE-WEB-1 (Phase-6 row 3): durable persistence for the web host

## Identity

- Work ID: P6-DURABLE-WEB-1
- Requirement IDs: phase6-clients-plan.md constraint §4 ("durable persistence on web is a LATER, explicitly-designed row") + sequencing row 3; desktop-roadmap.md Phase 6; requirements-matrix WF-029 (retention controls / persistence honesty)
- Owner: D2-lane worker (apps/web-client grant + a typed persistence adapter seam)
- Branch: p6-durable-web
- Base SHA: main AFTER the P6-WEB-HOST-1 merge (clone main; record HEAD as BASE)

## Precondition (hard)

P6-WEB-HOST-1 must be MERGED on main (the host exists at apps/web-client
with PERSISTENCE_MODE = "session-only"). If apps/web-client is absent at
your base, STOP and report the blocker instead of improvising.

## Objective

Make the web host's persistence DURABLE, honestly: extend the typed
persistence seam with an IndexedDB-backed adapter that the host mounts
BEHIND the existing PERSISTENCE_MODE literal — the mode becomes
"durable" (typed union: "session-only" | "durable") when the adapter is
active, and every user-visible claim follows the actual mode.

Scope rows:

1. **The durable adapter**: a typed IndexedDB persistence adapter
   (apps/web-client/src/persistence/) implementing the host's existing
   store-persistence interface (the one the session-only mode uses);
   versioned database schema; graceful degradation (unavailable
   IndexedDB -> typed fallback to session-only, surfaced in the UI).
2. **Mode extension**: PERSISTENCE_MODE becomes a typed literal union
   ("session-only" | "durable"); the host's notice states the ACTUAL
   active mode; no "saved" claims when the mode is session-only.
3. **Explicit user control**: the persistence mode is a deliberate,
   discoverable host setting (default per the honest default ruling:
   session-only UNLESS the user opts into durable), persisted in
   IndexedDB itself (a bootstrap read before mount; first-run default
   session-only).
4. **Tests**: adapter unit tests (fake-indexeddb or the established
   test-double pattern), component tests (mode notice reflects the
   active mode; the opt-in control works; graceful degradation path),
   the existing web-client tests stay green.
5. **Gates + rg evidence**: zero localStorage persistence beyond the
   typed+labeled seams; zero network; zero application/domain/shell
   changes (the adapter lives in the HOST; if a store interface change
   is genuinely needed, propose an FD instead of forking).

## Honest non-goals

- NO server/cloud sync (nothing leaves the browser), NO cross-device
  claims, NO contract changes (contracts stay 0.11.0), NO
  application/domain/shell modifications, NO analytics, NO mobile
  claims.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
npx tsc -b --force apps/web-client   # 0
pnpm test:unit          # all green
pnpm test:integration   # green
pnpm lint               # zero NEW vs base
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components  # unchanged green
pnpm --filter web-client test    # all green (+new)
pnpm --filter web-client build   # bundle emitted
```

## Transport (NO push)

- Commits on branch p6-durable-web: code commit(s) + SEPARATE
  ledger-row update commit (P6-DURABLE-WEB-1 row -> delivered).
- git bundle create /tmp/p6-durable-web-bundle.txt <base>..p6-durable-web,
  upload to tmpfiles.org (.txt rename), verify (GET + cmp), URL + sha256.
- Final report (last message, VERBATIM, ENGLISH markers):

```
=== P6-DURABLE-WEB-1 REPORT BEGIN ===
BASE: <base sha>
BRANCH: p6-durable-web (head <sha>, <n> commits)
GATES: (the gate lines with real numbers)
ADAPTER: <the typed IndexedDB seam + schema versioning + degradation path>
MODE EXTENSION: <the typed union + the notice statement per mode>
USER CONTROL: <the opt-in setting + default ruling + bootstrap read>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P6-DURABLE-WEB-1 REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats a
fabricated pass. ENGLISH report markers, verbatim.
