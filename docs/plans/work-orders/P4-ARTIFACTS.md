# Work order — P4-ARTIFACTS (Phase 4 row 2): land the frozen edge, collapse the mirrors, persist the MI stores

## Identity

- Work ID: P4-ARTIFACTS
- Requirement IDs: desktop-roadmap.md Phase 4 (original/derived artifact separation, cancellable jobs); phase4-mi-plan.md sequencing row 2 + §3 (originals never mutated) + §8; P4-CONTRACTS ledger row (P4-FD1 accepted-temporarily, collapse bound HERE); contract-freeze §2.4 (library lane), §2.6 (jobs), §3 (additive changes)
- Owner: D2-lane worker (contracts + domain + application + local-library; TL2 arbitrates splits)
- Branch: p4-artifacts
- Base SHA: c2122ae (main after P4-CONTRACTS merge)

## Objective

Three rows, in order. Row 0 first — it unblocks the rest:

1. **Row 0 — land the frozen application→webflix-domain edge and collapse
   the P4-FD1 mirrors**: add the workspace dependency to
   packages/webflix-application/package.json and update the root
   pnpm-lock.yaml importers accordingly (pnpm install --lockfile-only is
   the light path; a full install is acceptable if needed for the
   better-sqlite3 native binding). THIS ORDER IS GRANTED the root
   pnpm-lock.yaml + packages/webflix-application/package.json paths for
   EXACTLY this dependency declaration — no other root changes. Then
   collapse: the inlined mirrors in webflix-application (the parseIsoToEpochMs
   helper in built-in-ranker.ts, contract-parse.ts, the 3 inlined §2.6 job
   transitions, the objective/lineage list rules in derive-artifact-bookkeeping
   and set-objectives) become webflix-domain imports; the mirrored tests
   collapse to direct domain tests. BEHAVIOR UNCHANGED: the pinned
   determinism corpus byte-for-byte output MUST still pass UNCHANGED (any
   output change means the collapse altered semantics — stop and fix).
2. **Row 1 — durable MI stores**: implement ObjectiveStore, FeedbackStore
   and ArtifactRegistry ports durably on the local-library package's
   storage seam (better-sqlite3; per-profile isolation per ADR-0003 —
   profile-scoped storage like the library's own stores; original/derived
   separation structural: artifacts live in their OWN tables, originals
   never referenced mutably). Schema additive to local-library's; a
   migration/recreate path if the store file predates the tables (honest
   handling, documented). Idempotent feedback append persists; artifact
   descriptors persist with lineage; objectives persist with declaredAt.
   The in-memory defaults from P4-CONTRACTS remain as the pure-test
   defaults; the durable adapters are exported for the composition root
   (do NOT wire the desktop composition root — later order).
3. **Row 2 — retention + deletion honesty**: user data rules per plan §8:
   objectives/feedback/artifacts are user data — deletable individually
   and in bulk (clear-all per profile); deletion of an original NEVER
   cascades silently into deleting derived artifacts (they become
   lineage-dangling honestly: list them with an explicit dangling marker
   or reject at read — pick, document, test); no silent retention beyond
   the stores themselves; no telemetry.

## Non-goals

- No new intelligence shapes (contracts stay 0.2.0 unless a genuinely
  needed additive lands — then changelog + semver minor + TL2 note in the
  report).
- No model/LLM adapters, no transcripts/summaries/overviews/TTS (later
  rows; XTTS/NLLB banned regardless).
- No connector/playback/shell/ui/web/desktop changes; no composition-root
  wiring; no LocalLibraryEntry→catalog bridge (composition root's job,
  later order).
- No root changes beyond the granted lockfile+manifest edge declaration.

## Allowed and forbidden paths

- Allowed: packages/webflix-application/**, packages/webflix-domain/**,
  packages/webflix-contracts/** (only if a needed additive is justified in
  the report), packages/local-library/**, root pnpm-lock.yaml +
  packages/webflix-application/package.json (EXACTLY the dependency-edge
  declaration, row 0), plus the mandated ledger-row commit.
- Forbidden: everything else.

## Behavior and acceptance

- Happy path: durable stores round-trip (write → fresh store instance →
  read identical); feedback idempotency survives restart; artifact
  lineage checks enforce against the DURABLE registry (dangling original
  rejected at create).
- Determinism corpus: byte-for-byte UNCHANGED through the mirror collapse
  (pin it in the report).
- Empty/no-results: empty stores => honest empty states (P4-CONTRACTS
  honest-empty matrix still passes).
- Offline/restart/recovery: durability IS the point — restart-safety
  tests (close + reopen the sqlite store).
- Permission and cancellation: unchanged from P4-CONTRACTS (job boundary).
- Migration: pre-existing store files handled honestly (documented).

## Acceptance evidence

- Full gate battery green (tsc D2 + local-library lanes, unchanged lanes
  0, test:unit all-green with the collapsed tests counted honestly,
  test:integration, lint zero-new vs 69w/0e, fmt:check, components 34/34,
  architecture:check 0 — NOTE: architecture gate must still pass with the
  new application→domain edge; if the arch policy needs the edge
  registered, that's an additive policy edit — flag it in the report, do
  it only if the checker demands).
- pnpm-lock.yaml diff shows ONLY the importers-edge addition.
- rg evidence: no behavior drift in the collapse (the corpus pins it), no
  network, no randomness in the MI path.
- Durable round-trip + restart-safety + deletion + dangling-lineage tests.

## Report protocol (same as prior orders)

Branch from base c2122ae, commits (code + separate ledger row update),
full gate numbers, git-bundle relay c2122ae..p4-artifacts via tmpfiles.org
(.txt rename), report between `=== P4-ARTIFACTS REPORT BEGIN/END ===`
markers in the session.
