# Phase 4 — media-intelligence execution plan (TL2 decision doc)

Binds at Phase-3 platform-queue completion (main 90d3cba: TikTok, Twitch,
Instagram, Reddit landed; X deferred for cost, Snapchat monitor-only per
phase3-platform-selection.md).

## What Phase 4 is (desktop-roadmap.md, verbatim scope)

Built-in ranking, user objectives, feedback, explainability,
experiment/evaluation loop, user-selected model/ranker adapters,
transcripts, summaries, audio/video overviews, translation, dubbing, TTS
and Q&A — on cancellable jobs with original/derived artifact separation.

## Binding constraints (from frozen decisions — workers must honor)

1. **Contract-first**: frozen §2 shapes bind; Phase-4 additions are
   ADDITIVE (new `intelligence` contract module + semver minor bump +
   changelog entry per contract-freeze §3). No edits to frozen §2.1–2.6
   shapes; deviations → TL2 freeze-deviation queue.
2. **Jobs are already frozen for this**: §2.6 `JobDescriptor`/`JobState`
   (cancellable, retryable, provenance-preserving) was reserved for
   media-intelligence — MI jobs RIDE it, never re-invent it.
3. **Original/derived separation is a hard invariant** (roadmap):
   derived artifacts (transcripts, summaries, overviews, translations,
   dubs, Q&A answers) are NEW objects with provenance + model lineage;
   originals are never mutated.
4. **Explainability is not optional**: every recommendation carries
   reasons[] with evidence pointers (catalog §2.1 "auditable and
   explainable"; ADR-0003 per-user scope). A recommendation without
   reasons is a contract violation.
5. **Local signals only for ranking** (this phase's core): library,
   history, explicit feedback, user objectives. NO provider-API reads in
   the ranking path; no scraping ever.
6. **User-selected adapters**: the default ranker is deterministic and
   built-in; model/ranker adapters are pluggable ports the USER selects
   (model-option-map surface) — never a hidden default LLM.
7. **Engine licenses (AUDIT-SOURCES fold, binding)**: Piper, whisper.cpp,
   Argos, MediaInfo/ffprobe verified for use; **XTTS and NLLB EXCLUDED
   (non-commercial)** — dubbing/translation orders must not use them.
8. **Objectives are explicit**: user-set goals/constraints (time budgets,
   topic focuses, exclusions) — inspectable, editable, never silently
   inferred.

## Sequencing (TL2 ruling)

| Order | Work ID       | Lane                              | Scope                                                                                                |
| ----- | ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | P4-CONTRACTS  | D2 (contracts+domain+application) | §2.7 intelligence shapes + deterministic ranker core + feedback/objective/artifact use cases         |
| 2     | P4-ARTIFACTS  | D2                                | derived-artifact persistence + lineage bookkeeping (if P4-CONTRACTS defers storage)                  |
| 3     | P4-ADAPTERS   | D2+shell                          | user-selected model/ranker adapter selection UI + adapter registry                                   |
| 4     | P4-TRANSCRIBE | D2 (+local-library seam)          | transcripts via whisper.cpp-class local engines, cancellable jobs                                    |
| 5     | P4-SUMMARIZE  | D2                                | summaries/overviews/Q&A on user-selected models                                                      |
| 6     | P4-TRANSLATE  | D2                                | translation (Argos-class) + TTS (Piper-class); dubbing LAST (hardest sync problem); XTTS/NLLB banned |
| 7     | P4-EVALLOOP   | D2+shell                          | experiment/evaluation loop: policy versions, offline replay of feedback, honest metrics              |

Each order lands with the full gate battery + ledger row; later-phase
Reddit writes (vote/save/comment/…) and X/Snapchat remain parked (their
own decisions, not Phase-4).

## Honest boundaries (recorded up front)

- No global ad coverage promises (Phase-5 rule already recorded).
- No background AI anything: MI jobs run when the user runs them, visibly,
  cancellably.
- No model training on user data — adapters INFERENCE only; feedback is
  ranking signal, not training data.
- If a roadmap capability cannot map onto frozen shapes: honest
  unavailable + freeze-deviation proposal, never force.
