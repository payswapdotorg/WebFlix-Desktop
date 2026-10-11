# Work order — P4-TRANSLATE (Phase 4 row 6): Argos-class translation + Piper-class TTS

## Identity

- Work ID: P4-TRANSLATE
- Requirement IDs: desktop-roadmap.md Phase 4 ("translation, dubbing/TTS"; dubbing LAST — the sync problem is a later order); phase4-mi-plan.md §2 (jobs ride §2.6), §3 (originals never mutated), §7 (engine licenses BINDING: Piper + Argos verified; XTTS and NLLB EXCLUDED non-commercial — never reference them in src); P4-CONTRACTS DerivedArtifact (closed 6-kind enum ALREADY includes translation + dubbing — do NOT extend it)
- Owner: D2-lane worker (application + local-library; contracts only for the justified additive)
- Branch: p4-translate
- Base SHA: 15b1d3c (main after the P4-SUMMARIZE merge; the worker pins this plans commit)

## Objective

Local translation and text-to-speech over stored text payloads, each riding
§2.6 as a cancellable job, with engine ports in contracts and honest local
adapters on the local-library seam. Dubbing (translation + TTS + sync) is
explicitly NOT this order.

Scope rows:

1. **Contracts additive (JUSTIFIED, pre-authorized)**: two
   interface-only seams like TranscriptionEnginePort —
   `TranslationEnginePort` and `TtsEnginePort`;
   TranslationRequest/TranslationResult (source/target language tags,
   translated text, engine-reported lineage OPTIONAL — absent means
   absent, never guessed) and TtsRequest/TtsResult (text, voice identity,
   audio bytes/payload handle, engine-reported lineage optional) schemas;
   error codes genuinely needed (intelligence/translation-invalid,
   intelligence/translation-engine-unavailable,
   intelligence/translation-engine-failed, intelligence/tts-invalid,
   intelligence/tts-engine-unavailable, intelligence/tts-engine-failed —
   trim to what the implementation genuinely needs and say so;
   cancellation reuses common/cancelled). Semver minor 0.5.0->0.6.0 +
   CHANGELOG + TL2 note; frozen §2.1-2.6 and the kind enum untouched.
2. **Use cases (application)**: `mi.translate` + `mi.tts` — each rides
   §2.6 (cancellable at boundary + cooperative between engine steps;
   cancelled => Cancelled + NO artifact / no payload). mi.translate reads
   a stored text payload by artifact id (transcript/summary/overview/qa —
   typed absent error when missing), success => DerivedArtifact
   kind=translation through the durable registry with lineage
   (engine-reported model facts when volunteered, producedBy the adapter
   id, source artifact id in lineage/inputsHash) AND the translated-text
   payload persisted (migration 0005 store). mi.tts reads a stored text
   payload by artifact id, success => the AUDIO persisted as a payload
   rendition attached to the SOURCE artifact (payload-store pattern — the
   rendition record carries its OWN lineage: engine, voice, inputsHash);
   the source artifact is NOT mutated (deep-equal test) and NO new
   artifact kind is introduced (the kind enum is closed; if genuinely
   insufficient, STOP and file an FD proposal — never extend the enum
   unilaterally).
3. **Local adapters (local-library, mirroring WhisperCppLocalEngine)**:
   `ArgosClassLocalTranslationEngine` — discovery via WEBFLIX_ARGOS_BIN
   override -> PATH (argos-translate/argos CLI shapes) -> HOME-templated
   standard locations; engine-absent => typed unavailable + recovery
   hint; output parsed ONLY from documented CLI shapes (anything
   unparsable skipped, never fabricated); lineage from the engine's own
   banners when present. `PiperLocalTtsEngine` — discovery via
   WEBFLIX_PIPER_BIN -> PATH (piper) -> HOME-templated locations; voice
   model discovery (.onnx voice files, WEBFLIX_PIPER_VOICE override);
   no-voice/no-engine => typed unavailable + honest recovery hint; audio
   bytes read from the engine's own output path; injectable spawn/seam
   so tests replay canned children with ZERO process I/O. NO engine
   bundled, NO voice/model downloads, NO network (rg-provable).
4. **Fixture-replay engines (CLEARLY-LABELED test doubles)** implementing
   both ports for cancellation/contract tests.

## Honest non-goals

- NO dubbing pipeline (sequencing: dubbing LAST — a later order owns the
  sync problem). NO XTTS/NLLB anywhere in src (banned licenses).
- NO model/voice downloads, NO network, NO engine bundling.
- NO selection UI for these engines (composition wiring defers until a
  composition-root order — record it). NO audio playback of synthesized
  output. NO new DerivedArtifact kind.

## Gates (run all; record exact commands + totals)

```
npx tsc -b --force packages/webflix-contracts packages/webflix-domain packages/webflix-application packages/local-library packages/webflix-shell   # 0 each
npx tsc -b --force packages/catalog packages/connectors packages/playback    # 0
pnpm test:unit          # all green (800 at base + your new tests)
pnpm test:integration   # green
pnpm lint               # zero NEW vs base 69w/0e
pnpm fmt:check          # PASS
pnpm architecture:check # 0
pnpm --filter webflix-shell test:components   # 44/44 unchanged
```

Also rg evidence: no network in the pipeline; fixture engines labeled
test doubles; no XTTS/NLLB references anywhere in src.

## Transport (NO push)

- Commits on branch p4-translate: code commit(s) + SEPARATE ledger-row
  update commit (P4-TRANSLATE row -> delivered).
- git bundle create /tmp/p4-translate-bundle.txt 15b1d3c..p4-translate,
  upload to tmpfiles.org (.txt rename), verify the direct download link
  (GET + cmp byte-identical), URL in the report.
- Final report (last message, VERBATIM, between markers):

```
=== P4-TRANSLATE REPORT BEGIN ===
BASE: <base sha> (branch base <dispatch-lock sha>)
BRANCH: p4-translate (head <sha>, <n> commits)
GATES:
- tsc contracts/domain/application/local-library/shell: <errors each>
- tsc unchanged lanes: <errors each>
- test:unit: <pass>/<total> (+<n> new)
- test:integration: <pass>/<total>
- lint: <warnings> vs base <baseline> (new: <n>)
- fmt:check: PASS/FAIL
- architecture:check: <violations>
- components: <pass>/<total>
CONTRACTS: 0.5.0 -> 0.6.0 (additive list) | changelog YES/NO
PIPELINE:
- mi.translate: <files> — <1-line design + source-artifact-untouched evidence>
- mi.tts: <files> — <1-line design + rendition-lineage evidence>
- payload stores: migration 0005 <name + isolation statement>
- cancellability: <how proven per operation>
- absent-typed: <test evidence for payload-absent + engine-unavailable>
ADAPTERS:
- argos-class engine: <discovery + honest-unavailable + spawn-seam statement>
- piper engine: <discovery + voice model + honest-unavailable + spawn-seam statement>
HONEST LIMITS: <plain list>
FD PROPOSALS: <ids or none>
BUNDLE: <url> (sha256 <hash>)
=== P4-TRANSLATE REPORT END ===
```

Reminder: report numbers must come from the gates you ACTUALLY ran. If a
gate cannot run, say so plainly with the reason — an honest failure beats
a fabricated pass.
