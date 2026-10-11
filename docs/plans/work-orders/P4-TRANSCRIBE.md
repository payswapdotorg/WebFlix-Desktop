# Work order — P4-TRANSCRIBE (Phase 4 row 4): the transcript artifact pipeline on a local-engine port

## Identity

- Work ID: P4-TRANSCRIBE
- Requirement IDs: desktop-roadmap.md Phase 4 ("transcripts … cancellable jobs and original/derived artifact separation"); phase4-mi-plan.md §2 (jobs ride §2.6), §3 (originals never mutated), §7 (whisper.cpp-class local engines licensed OK; XTTS/NLLB banned — not this order anyway); P4-CONTRACTS DerivedArtifact (closed 6-kind enum INCLUDES transcript); P4-ARTIFACTS durable ArtifactRegistry
- Owner: D2-lane worker (application + domain + local-library; contracts only for the justified additive)
- Branch: p4-transcribe
- Base SHA: 4217ea1 (main after P4-ADAPTERS merge)

## Objective

The first REAL derived-artifact producer: the transcript pipeline. A
local transcription-engine PORT (the seam), a cancellable transcribe use
case riding §2.6 jobs, artifacts stored through the P4-ARTIFACTS durable
registry with full lineage, and honest engine availability (a real
engine adapter that discovers a local whisper.cpp-class binary and is
honestly typed-unavailable when absent — the connector honest-state
pattern applied to engines). NO engine is bundled; NO network ever.

Scope rows:

1. **Engine port + contracts additive (justified)**:
   `TranscriptionEnginePort` — pure-ish engine seam: (engine descriptor,
   transcribe(input, signal) → transcript segments); the descriptor
   carries id/label/model-lineage/license note (whisper.cpp-class =
   MIT-family, verified in AUDIT-SOURCES); §3 additive:
   TranscriptionRequest/TranscriptSegment/TranscriptionResult schemas +
   the error code(s) genuinely needed (typed honest-unavailable for
   engine-absent; typed cancelled). Semver minor + changelog + TL2 note.
2. **Transcribe use case (application)**: rides §2.6 as
   `mi.transcribe` — cancellable AT THE BOUNDARY and cooperatively
   between segments if the engine surfaces progress (cancelled mid-run =>
   Cancelled state + NO artifact stored, documented); success => a
   DerivedArtifact kind=transcript created through the durable registry
   with lineage (source item id + engine descriptor + model lineage in
   the artifact's provenance), stored via the P4-ARTIFACTS seam; the
   ORIGINAL is never touched (deep-equal test).
3. **Engine adapters (application)**: (a) a deterministic
   fixture-replay engine (test double — canned segments, progress
   callbacks, cancellation honors); (b) the REAL local-engine adapter:
   binary discovery on PATH + standard locations (whisper-cli /
   whisper.cpp main names), honest typed-unavailable when absent (the
   Reddit-block honesty pattern: surfaced never hidden, with the recovery
   hint "install whisper.cpp and set WEBFLIX_WHISPER_BIN"); version +
   model-lineage read from the binary's own output when available
   (honest: absent info stays absent, never guessed).
4. **Honest non-goals**: no audio decoding/demux/ffprobe integration
   (engine-internal concern), no model download, no UI, no composition
   wiring, no summaries/Q&A (P4-SUMMARIZE).

## Non-goals

- No bundling or building of whisper.cpp; no model weights; no network
  (the engine port is LOCAL only); no ffmpeg integration.
- No desktop/shell/ui/web/connector/playback/catalog changes; no
  composition-root wiring.
- No new ranker/adapter work; no objectives/feedback changes.

## Allowed and forbidden paths

- Allowed: `packages/webflix-contracts/**` (the justified additive +
  changelog + version), `packages/webflix-application/**`,
  `packages/webflix-domain/**` (only if a genuine invariant belongs
  there), `packages/local-library/**` (only if the durable seam needs an
  extension — justify), plus the mandated ledger-row commit.
- Forbidden: everything else.

## Behavior and acceptance

- Happy path: fixture engine => segments => artifact stored with
  lineage; job Succeeded; artifact listable via the existing registry
  (listWithLineage attached).
- Engine absent: typed honest-unavailable surfaced, job Failed with the
  typed error, NO artifact, recovery hint present.
- Cancellation: pre-start cancel => Cancelled no artifact; mid-segment
  cancel (fixture engine cooperates) => Cancelled no artifact; the
  original untouched (deep-equal).
- Determinism: fixture-engine transcripts byte-stable (same input =>
  same segments); the artifact record carries the engine lineage.
- Restart: artifacts durable across restart (existing seam tests extend
  to transcript-kind records).

## Acceptance evidence

- Full gate battery green (tsc lanes, unit, integration, lint zero-new,
  fmt, components 44/44 untouched-green, architecture 0).
- Honest-state tests: engine-absent, cancelled (both phases), lineage
  intact, original untouched.
- rg evidence: no network anywhere in the pipeline; no fake transcripts
  (fixture engine clearly labeled a test double); the real adapter never
  invents version info.

## Report protocol (same as prior orders)

Branch from base 4217ea1, commits (code + separate ledger row update),
full gate numbers, git-bundle relay 4217ea1..p4-transcribe via
tmpfiles.org (.txt rename), report between
`=== P4-TRANSCRIBE REPORT BEGIN/END ===` markers in the session.
