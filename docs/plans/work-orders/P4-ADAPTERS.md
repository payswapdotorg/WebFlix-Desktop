# Work order — P4-ADAPTERS (Phase 4 row 3): ranker-adapter registry, durable selection, honest selector UI

## Identity

- Work ID: P4-ADAPTERS
- Requirement IDs: desktop-roadmap.md Phase 4 ("user-selected model/ranker adapters"); phase4-mi-plan.md §6 (never a hidden default; user selects) + sequencing row 3; P4-CONTRACTS RankerPort (the seam this order populates); ADR-0003 (per-user/per-profile isolation)
- Owner: D2-lane worker (application + domain + local-library) + a scoped webflix-shell component grant (TL2 arbitrates the seam)
- Branch: p4-adapters
- Base SHA: 00c9ef4 (main after P4-ARTIFACTS merge)

## Objective

The adapter-selection foundation rows 4-6 (transcribe/summarize/translate)
build on: a registry of available adapters, a durable per-profile
selection, and an honest selector UI. TODAY exactly ONE ranker adapter
exists (the built-in deterministic v1) — the registry, selection and UI
must say so honestly; NO fake model options, NO disabled-looking
placeholders that imply unshipped capability, NO hidden defaults.

Scope rows:

1. **Adapter registry + selection (D2 — application/domain)**:
   - `RankerAdapterRegistry`-shaped port + a static default registry
     seeded with exactly one entry: built-in-v1 (id, label, description,
     capabilities summary — deterministic, local, reasons-mandatory).
   - `resolveSelectedRanker` use case: (registry + selection setting) =>
     a RankerPort instance; unknown/deleted adapter id => typed
     intelligence error + HONEST default fallback (documented choice:
     fail-soft to built-in-v1 with the fallback reason surfaced, never a
     silent switch); no selection set => built-in-v1 (the documented
     default, stated in the returned resolution metadata).
   - Selection validation: only registry-known ids selectable.
2. **Durable selection store (D2 — local-library)**: per-profile adapter
   selection persisted on the established MI seam (additive migration
   0003 or an equivalent OWN table — same rules as 0002: canonical JSON
   column, no FK into originals, per-profile isolation, migration-safe);
   restart round-trip + clear/replace semantics tested; deletion of a
   selection resets to default honestly (never an error state).
3. **Honest selector component (scoped D1 grant — webflix-shell)**:
   `RankerAdapterSelector` — renders the registry truthfully: today one
   selectable option (built-in-v1) with its description; an explicit,
   honest "more adapters arrive with later Phase-4 orders" note is
   ALLOWED (a fact statement), but no fake/unavailable entries;
   keyboard-navigable, aria-labelled, selection-change callback with the
   selected id; component tests pin: single-option render, selection
   event, the honest note, no network/no telemetry in the component.
4. **Wiring boundary**: do NOT touch the desktop package or any
   composition root (its own later order — that order also owns the
   LocalLibraryEntry->catalog bridge and the end-to-end
   use-case-over-durable-adapter test). The component ships tested but
   unmounted; the D2 pieces export cleanly for the composition root.

## Non-goals

- No model/LLM adapter implementations (rows 4-6; the registry is the
  seam they will extend); no transcripts/summaries/translation/TTS.
- No desktop-package changes, no composition-root wiring, no catalog
  bridge (later order).
- No connector/playback/catalog/ui/web/services changes.
- No new contract shapes unless genuinely needed — if an additive is
  justified, changelog + semver minor + TL2 note in the report (contracts
  are 0.2.0).

## Allowed and forbidden paths

- Allowed: `packages/webflix-application/**`, `packages/webflix-domain/**`,
  `packages/local-library/**`, `packages/webflix-shell/src/components/**`
  - `packages/webflix-shell/tests/**` (the selector component + its tests
    ONLY — no other shell files), plus the mandated ledger-row commit.
- Forbidden: everything else (contracts unless a justified additive per
  above; root files; desktop; all other lanes).

## Behavior and acceptance

- Happy path: resolveSelectedRanker with no selection => built-in-v1 +
  default metadata; with a valid selection => that adapter + its
  metadata; selection persists across restart (durable store round-trip).
- Unknown adapter id (registry drift, deleted future adapter): typed
  error surfaced + honest fallback to built-in-v1, the fallback reason
  carried in the resolution metadata — tested.
- Empty registry is impossible by construction (static seed) — state it.
- Accessibility: the selector is keyboard-operable, labelled, honest.
- Restart/recovery: selection durability tested; corrupt rows surface as
  typed WebFlixErrors (the 0002 precedent), never mangled reads.

## Acceptance evidence

- Full gate battery green (tsc D2 + local-library + shell lanes,
  unchanged lanes 0, test:unit all-green, test:integration, lint zero-new
  vs 69w/0e, fmt:check, components suite green including the new
  selector tests, architecture:check 0).
- rg evidence: no network/randomness/telemetry in the selection path; no
  fake adapter options; component has no fetch.
- Durable round-trip + fallback + restart tests listed with counts.

## Report protocol (same as prior orders)

Branch from base 00c9ef4, commits (code + separate ledger row update),
full gate numbers, git-bundle relay 00c9ef4..p4-adapters via tmpfiles.org
(.txt rename), report between `=== P4-ADAPTERS REPORT BEGIN/END ===`
markers in the session.
