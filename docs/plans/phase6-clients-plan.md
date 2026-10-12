# Phase 6 — web and mobile clients execution plan (TL2 decision doc)

Status: ACTIVE (Phase 5 complete at 8440ceb — all six Ad Center rows merged;
DESKTOP-COMPOSITION-1 dispatched to complete the desktop shell boundary).
Base: main @ 4c0b4b5. This plan binds all Phase-6 workers.

## What Phase 6 is (desktop-roadmap.md, verbatim scope)

"Reuse contracts and application use cases after desktop boundaries are
stable. Do not block first desktop acceptance on future clients."

## Binding constraints (frozen decisions — workers must honor)

1. **The desktop boundary completes first**: DESKTOP-COMPOSITION-1 (the
   Ad Center + MI Evaluation screens in AppShell + the three index
   exports) must be MERGED before any Phase-6 row that mounts those
   surfaces. Phase-6 rows base on main AFTER that merge.
2. **Platform-neutral reuse is the point (roadmap)**: web/mobile clients
   REUSE webflix-contracts + webflix-application + webflix-shell — they
   do not fork shapes, do not re-declare stores, do not add parallel use
   cases. A client that needs a NEW contract shape stops and proposes an
   FD (freeze-deviation) instead of forking.
3. **Do not wrap the old Next.js app in Electron** (critical-constraints,
   binding): no resurrection of the fork-era app as the client. Phase-6
   hosts are NEW thin compositions of the WebFlix packages.
4. **Runtime-seam honesty (the sqlite law)**: local-library's durable
   seam is Node-only (better-sqlite3). A browser host composes the
   application layer's in-memory doubles with SESSION-ONLY persistence,
   TYPED and LABELED as such in the UI (never "saved" when it is not);
   durable persistence on web is a LATER, explicitly-designed row. No
   fake-durable, no hidden localStorage "sync" claims.
5. **Network/key honesty**: connectors and engines that need user
   authorization, keys, or Node runtime surface their unavailable state
   HONESTLY (typed, named, with the desktop path named) — no key
   smuggling into the web bundle, no network from engine code (the
   Phase-4 law carries over verbatim).
6. **No tracking, no passive observation** (critical constraints): the
   web client adds no analytics, no hidden telemetry, no cross-source
   linking. Guest/public viewing only where source policy allows —
   stated, never assumed.
7. **Honesty rules carry over from Phase 4/5 (phase4-mi-plan §1-§8 +
   phase5-ad-plan §2)**: additive contracts + semver minor + changelog
   (contracts stay 0.11.0 unless a row is explicitly sanctioned
   additive); §2.6 jobs for long work; explainability mandatory;
   deterministic engines with labeled test doubles; no fabricated
   ground truth; honest empty states everywhere.
8. **A client is a composition, not a product fork**: every Phase-6 row
   must name which existing contracts/application use cases/shell
   surfaces it composes; anything it cannot compose honestly is
   recorded as an honest limit (or an FD proposal), never worked around
   by duplicating logic.

## Sequencing (TL2 ruling)

| Row | Work ID               | Scope                                                                                                                                                                                   | State                                     |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0   | DESKTOP-COMPOSITION-1 | the desktop shell boundary (AppCenter/MI screens + exports) — the Phase-6 gate                                                                                                          | dispatched (in flight)                    |
| 1   | MATRIX-RECON-1        | requirements-matrix status reconciliation vs the ledger (docs-only, evidence-cited)                                                                                                     | queued                                    |
| 2   | P6-WEB-HOST-1         | the first web client host slice: a NEW thin web host that composes AppShell + the application layer's in-memory, browser-safe use cases with session-only persistence typed and labeled | queued (bases on main after row 0 merges) |
| 3+  | mobile + durable-web  | LATER rulings — no claims until a real slice exists                                                                                                                                     | not started                               |

Rulings:

- Rows are ONE-LANE (the D2-lane worker) while capacity windows are the
  constraint; the matrix row is deliberately light so a poor-capacity
  window still lands progress.
- The mobile ruling happens ONLY after P6-WEB-HOST-1 is merged and its
  honest limits recorded — no mobile claims before a mobile slice runs.
