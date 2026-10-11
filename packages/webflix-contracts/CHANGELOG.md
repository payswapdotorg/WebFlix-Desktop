# Changelog — webflix-contracts

Semver per package (contract-freeze.md §3): breaking changes bump major with
TL2 approval + migration notes; additive changes bump minor with a consumer
impact note. No CHANGELOG existed before 0.2.0 — the 0.1.0 history is the git
log of this package (frozen §2 shapes, D2-LOCAL lane).

## 0.4.0 — 2026-10-11 — transcription-engine seam (P4-TRANSCRIBE)

Phase-4 row 4. Adds the LOCAL transcription-engine port + the request /
segment / result schemas + the three genuinely-needed MI error codes. Frozen
§2.1–2.6 module files untouched; the §2.7 intelligence module gains one
appended section only. Consumer impact: none on existing consumers (purely
additive; no existing export changed shape).

### Added

- `src/intelligence.ts` (ADDITIVE section, after `DerivedArtifact`):
  - `TranscriptionEngineDescriptor` (+ schema) — adapter identity
    (id/label/version — OUR code's, always known) plus the honest optional
    external facts (`engineVersion`, `modelLineage` — read from the engine's
    own output when reported, ABSENT otherwise, never guessed) and the
    license note (whisper.cpp-class = MIT-family, AUDIT-SOURCES §6; null
    when none applies).
  - `TranscriptionRequest` (+ schema) — a LOCAL media path plus an optional
    engine-interpreted language hint; media bytes stay ENGINE-INTERNAL (no
    WebFlix-layer decoding/demux/ffprobe — the order's honest non-goal).
  - `TranscriptSegment` (+ schema) — integer-ms `[startMs, endMs]` range
    with non-empty text; `endMs < startMs` rejected.
  - `TranscriptionResult` (+ schema) — segments (possibly EMPTY: the honest
    "engine reported no speech" outcome) plus the per-run honest reads
    (`language` / `engineVersion` / `modelLineage`, each absent when the
    engine did not report it — never inferred from the request).
  - `TranscriptionProgress` + `TranscriptionOptions` + `TranscriptionEnginePort`
    (interfaces, the port seam) — transcribe(request, options) with
    cooperative cancellation (signal checked at entry AND between segments;
    a thrown onProgress callback is a stop request) and the binding
    implementation rules: LOCAL only (no network, no model downloads),
    honest typed-unavailable when the engine is absent (surfaced, recovery
    hint, never hidden), typed cancelled, honest lineage.
- `src/errors.ts`: three codes appended to the additive-only enum —
  `intelligence/transcription-invalid` (mi.transcribe caller defects,
  validated before the job exists), `intelligence/engine-unavailable`
  (honest-absent engine), `intelligence/engine-failed` (a FOUND engine
  reporting its own failure — kept distinct from absent because recovery
  differs). Typed cancellation reuses the existing `common/cancelled`: no
  new code needed for it.
- Anti-blank normalization: every string field the transcription section
  adds uses trim-then-min(1) — a whitespace-only value is a BLANK and is
  rejected (media paths, language hints, segment text, per-run lineage
  reports). Padded segment text parses to its trimmed canonical form.

## 0.3.0 — 2026-10-11 — ranker-adapter selection (P4-ADAPTERS)

Phase-4 row 3. Adds the smallest additive surface the adapter-selection
foundation needs: one appended error code and the persisted selection
record. Frozen §2.1–2.6 module files untouched; the §2.7 intelligence
module gains one appended section only. Consumer impact: none on existing
consumers (purely additive; no existing export changed shape).

### Added

- `src/intelligence.ts` (ADDITIVE section, after `RankerPort`):
  - `RankerAdapterSelection` (+ `RankerAdapterSelectionSchema`) — the
    per-profile record of the user's explicit, persistent ranker-adapter
    choice: `adapterId` (registry-known, validated at set time by the
    application use case) + `selectedAt` (explicit provenance instant,
    never inferred). Absence of a stored selection is DISTINCT from
    selecting the built-in adapter — it means "no selection set", with the
    documented built-in default then active and stated as such.
- `src/errors.ts`: `ErrorCode.IntelligenceAdapterSelectionInvalid`
  (`intelligence/adapter-selection-invalid`) appended to the additive-only
  enum — carried by the set-time unknown-id rejection, the resolve-time
  registry-drift fail-soft reason, and corrupt persisted selection rows.

## 0.2.0 — 2026-10-11 — media-intelligence contract module (P4-CONTRACTS)

Phase 4 opener. Adds the media-intelligence shapes the later Phase-4 orders
(P4-ARTIFACTS, P4-ADAPTERS, P4-TRANSCRIBE …) bind to.

### Added

- `src/intelligence.ts` (ADDITIVE; frozen §2.1–2.6 module files untouched):
  - `UserObjective` (+ `TimeBudgets`) — explicit, inspectable, editable user
    goals; never inferred, no silent defaults beyond the documented empty
    objective (phase4-mi-plan §8).
  - `FeedbackEvent` — explicit (thumbs-up/down, pin, not-interested) +
    implicit (watched-fraction, skipped-at) with provenance; id is the
    idempotency key for appends.
  - `LibraryFact` — the local-library ranking projection onto a §2.1 catalog
    item id (a projection, NOT a §2.4 mirror: no path/fingerprint, re-keyed).
  - `RankingPolicy` (+ `RankingPolicyVersion`, `RankingWeights`,
    `RANKING_POLICY_V1_WEIGHTS`) — deterministic, versioned; the version
    alone pins weights/semantics so same inputs + same policy version =>
    byte-for-byte same output.
  - `RankedItem` / `RankingResult` (+ `RankingReason`, `EvidencePointer`,
    `NonEmptyArray`, `RankingEmptyReason`) — reasons are MANDATORY: enforced
    at the type level (`NonEmptyArray`), the schema level (`.min(1)`) and the
    domain runtime guard. Honest-empty variants: empty-catalog /
    no-local-signals / no-ranked-candidates.
  - `RankerPort` (+ `RankerInput`) — the user-selected adapter interface;
    pure, local-only, no hidden LLM. Default implementation = the built-in
    deterministic ranker shipped in webflix-domain (P4-CONTRACTS).
  - `DerivedArtifact` (+ `ArtifactLineage`, closed `DerivedArtifactKind`
    enum: transcript | summary | overview | translation | dubbing | qa) —
    structural original/derived separation; persistence deferred to
    P4-ARTIFACTS.
- `src/errors.ts`: six MI codes appended to `ErrorCode`
  (intelligence/policy-unsupported, objective-invalid, feedback-invalid,
  feedback-conflict, ranking-invalid, artifact-invalid) — appended under the
  enum's own additive-only rule; no existing code repurposed.
- `src/index.ts`: `export * from "./intelligence"` (entrypoint wiring only).

### Consumer impact (additive only — §3 method)

- No breaking changes. No frozen §2.1–2.6 shape edited; existing consumers
  compile and behave identically.
- New exports resolve through the existing single entrypoint
  (`webflix-contracts`); downstream packages gained the MI domain rules
  (webflix-domain) and use cases (webflix-application) in the same order —
  their package versions stay 0.1.0 this order (no version bump mandated;
  the freeze table already registers their dependency edges).
- `ErrorCode` grew by append-only entries; switch statements over the enum
  are unaffected (the set is open by design).
