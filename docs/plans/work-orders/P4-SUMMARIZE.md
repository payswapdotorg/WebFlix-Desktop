# Work order — P4-SUMMARIZE (Phase 4 row 5): summary / overview / Q&A derived artifacts on the built-in extractive engine

## Identity

- Work ID: P4-SUMMARIZE
- Requirement IDs: desktop-roadmap.md Phase 4 ("summaries … Q&A. Use cancellable jobs and original/derived artifact separation"); phase4-mi-plan.md §2 (jobs ride §2.6), §3 (originals never mutated), §4 (explainability — every derived output stays auditable to its source), §6 (never a hidden default LLM — the built-in engine is deterministic and local); P4-CONTRACTS DerivedArtifact (closed 6-kind enum ALREADY includes summary/overview/qa — do NOT extend it); P4-TRANSCRIBE transcript pipeline (just merged — includes its recorded honest limit: transcript segment payloads are NOT persisted yet, "P4-SUMMARIZE adjacency")
- Owner: D2-lane worker (application + domain + local-library; contracts only for the justified additive)
- Branch: p4-summarize
- Base SHA: 2b652df (main after P4-TRANSCRIBE merge)

## Objective

The text-intelligence derived-artifact producers: summaries, structured
overviews and extractive Q&A over STORED transcripts, all produced by a
DETERMINISTIC built-in engine (pure functions — no model, no network,
no generative text), each riding §2.6 as a cancellable job and each
storing a DerivedArtifact with full lineage. This order also resolves
P4-TRANSCRIBE's recorded adjacency: transcript segment payloads become
durable so downstream consumers read stored transcripts without
re-transcribing.

Scope rows:

1. **Transcript payload persistence (the P4-TRANSCRIBE adjacency)**:
   a durable `TranscriptPayloadStore` (local-library, migration 0004
   per the 0002/0003 rules — OWN mi_* table, canonical JSON columns,
   per-profile structural isolation, no FK into originals); `put` keyed
   by transcript artifact id (segments + a payload checksum), `get`
   returns segments or a typed absent error. AMEND `mi.transcribe`
   (application) minimally: on SUCCESS also persist the payload through
   the store (cancelled/failed runs persist nothing — unchanged); the
   ORIGINAL catalog item still never touched. The amendment is
   sanctioned by this order (the pipeline needs payloads downstream).
2. **Contracts additive (JUSTIFIED, pre-authorized)**:
   `SummaryEnginePort` — the seam for text-intelligence engines
   (summarize/overview/qa methods or one discriminated operation —
   worker's design freedom, documented); SummaryRequest/SummaryResult,
   OverviewRequest/OverviewResult (timeline chapters), QaRequest/QaAnswer
   (answer as QUOTED spans with segment citations) schemas; error codes
   genuinely needed: `intelligence/summary-invalid` (caller defects),
   `intelligence/transcript-payload-absent` (referenced transcript has
   no stored payload — typed, surfaced), cancellation reuses
   `common/cancelled`. Semver minor 0.4.0->0.5.0 + CHANGELOG + TL2 note;
   frozen §2.1-2.6 and the kind enum untouched.
3. **Built-in extractive engine (application)**: DETERMINISTIC, pure, no
   model, no network. (a) Summarize: sentence scoring over the
   transcript text (term-frequency + position weighting; parameters
   fixed and documented in the module docblock); (b) Overview: timeline
   chapters from transcript segments (time-ranged sections titled by
   dominant terms); (c) Q&A: the question is matched to segments and
   the answer is QUOTED spans with segment time positions as citations
   — NO generative text EVER (an answer inventing wording outside the
   source quotes is a defect; rg-provable quote discipline).
4. **Use cases (application)**: `mi.summarize`, `mi.overview`, `mi.qa`
   — each rides §2.6 (cancellable at boundary + cooperative between
   engine steps; cancelled => Cancelled + NO artifact); each reads the
   stored transcript payload by artifact id (typed absent error when
   missing); success => DerivedArtifact kinds summary/overview/qa
   through the durable registry with lineage (modelId
   `webflix.extractive.v1`, producedBy `webflix.built-in-summary-engine`,
   the source transcript artifact id in the lineage/inputsHash); the
   SOURCE transcript artifact is never mutated (deep-equal test).
5. **Test double + determinism**: a fixture-replay engine (CLEARLY
   LABELED test double) implementing the port for cancellation and
   contract tests; the built-in engine gets a determinism corpus test
   (same input => byte-identical output, sha256-pinned).

## Honest non-goals

- NO generative LLM anywhere (adapters may come later; the port is the
  seam), NO model download, NO network, NO TTS or audio/video overview
  synthesis (row 6's TTS/dubbing), NO translation, NO UI, NO
  composition wiring, NO summary-engine selection UI (defers until real
  model adapters exist — record it).
- Summary-engine selection deferral is an honest limit to state in the
  report, not a scope expansion.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (705 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components   # 44/44 unchanged
```

Also rg evidence: no network in the pipeline; fixture engine labeled a
test double; no generative strings outside quoted spans in Q&A results.

## Transport (NO push)

- Commits on branch p4-summarize: code commit(s) + SEPARATE ledger-row
  update commit (P4-SUMMARIZE row -> delivered).
- git bundle create /tmp/p4-summarize-bundle.txt 2b652df..p4-summarize,
  upload to tmpfiles.org (.txt rename), verify the direct download link
  (GET + cmp byte-identical), URL in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P4-SUMMARIZE REPORT BEGIN ===
BASE: 2b652df
BRANCH: p4-summarize (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base 69 (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
CONTRACTS: 0.4.0 -> 0.5.0 (additive list) | changelog YES/NO
PAYLOADS: migration 0004 <name + isolation statement>; mi.transcribe amendment <1-line>; absent-typed <test evidence>
ARTIFACTS:
- summarize: <files> — <1-line design>
- overview: <files> — <1-line design>
- qa: <files> — <1-line design + quote-discipline evidence>
- determinism corpus: <file + sha256 stability statement>
- cancellability: <how proven per operation>
- source-transcript-untouched: <test evidence>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P4-SUMMARIZE REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure
beats a fabricated pass.
