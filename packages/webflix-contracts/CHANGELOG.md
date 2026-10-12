# Changelog — webflix-contracts

Semver per package (contract-freeze.md §3): breaking changes bump major with
TL2 approval + migration notes; additive changes bump minor with a consumer
impact note. No CHANGELOG existed before 0.2.0 — the 0.1.0 history is the git
log of this package (frozen §2 shapes, D2-LOCAL lane).

## 0.11.0 — 2026-10-12 — the transparency-source seam (P5-SOURCES)

Phase-5 row 6 (the FINAL row). Adds the transparency-source seam that closes
Phase 5's shape: the `TransparencySourcePort` (INTERFACE ONLY, the
TranscriptionEnginePort pattern), the `TransparencySourceManifest` (the
per-source coverage declaration — regions/categories AS DECLARED by the
source's own terms, honest-absent when the terms do not enumerate them; the
access state enum available | pending-authorization | blocked; the
authorization path note REQUIRED for pending/blocked — a pending state
without its application path is an unactionable dead end; the termsUrl from
AUDIT-SOURCES §11), the `TransparencyQuery` / `TransparencyAdvertiserReport`
/ `TransparencyObservation` shapes (the ad-record-shaped data a source
reports, mapped onto the AdRecord fields with source-reported-only honesty
— the Ad Center's own ids and import stamps are minted by the import
bridge, never here), and the `TransparencyQueryResult` union whose access
states are DATA (ok-with-observations | unavailable |
pending-authorization | blocked, each non-ok state carrying its honest
reason; the states are surfaced, never thrown — the charter's
product-feature rule). The 0.10.0 shapes and codes are otherwise untouched.
Consumer impact: none on existing consumers (purely additive; no existing
export changed shape; the architecture-policy ads-separation symbol list
extends in lockstep with the new exports, per its own standing comment).

### Added

- `TransparencySourceAccessStateSchema` / `TransparencySourceAccessState` —
  the access-state enum (available | pending-authorization | blocked).
- `TransparencySourceManifestSchema` / `TransparencySourceManifest` — the
  per-source coverage declaration (declaredRegions / declaredCategories
  honest-absent; coverageNote; authorizationPathNote required for
  pending/blocked; termsUrl).
- `TransparencyQuerySchema` / `TransparencyQuery` — the search-terms +
  optional-region query shape (deliberately minimal; extends additively
  when real transport lands).
- `TransparencyAdvertiserReportSchema` / `TransparencyAdvertiserReport` —
  the observation's inline advertiser identity report (at least one of
  sourceAdvertiserId / names).
- `TransparencyObservationSchema` / `TransparencyObservation` — one
  observed ad, source-reported only.
- `TransparencyQueryResultSchema` / `TransparencyQueryResult` — the typed
  honest-state query result union (the states are DATA, never failures).
- `TransparencySourceDescriptor` / `TransparencySourceOptions` /
  `TransparencySourcePort` — the seam interfaces (port is interface only).
- `ErrorCode.AdsSourceInvalid` = `ads/source-invalid` — the ONE code the
  shapes genuinely reject this order (caller defects: blank/unknown source
  id, malformed query, malformed observation at the import bridge,
  malformed registry seed). The work order's candidate codes
  `ads/source-unavailable` / `ads/source-not-authorized` are TRIMMED: the
  unavailable/pending/blocked states are DATA in
  TransparencyQueryResult — surfaced, never thrown — so no error form
  exists for them (a later transport order lands error forms additively
  if it genuinely needs them, the 0.9.0 -> 0.10.0 pre-announcement
  precedent).

## 0.10.0 — 2026-10-12 — the verification store's absent code (P5-VERIFY)

Phase-5 row 4 (offer verification + review signals). Adds the ONE code this
order genuinely needed: the durable OfferVerification store's typed absence
(local-library migration 0007, this order) — `get` on a verification id no
ads.verify run ever appended rejects with `ads/verification-absent`, never
null and never an invented read-out (the 0.9.0 family rule; the 0.9.0 entry
pre-announced exactly this addition: "no verification-absent code exists
because no verification store exists yet (P5-VERIFY builds the verification
machinery)"). The 0.8.0/0.9.0 shapes and codes are otherwise untouched —
the OfferVerification shape already carries everything the verification
engine states (WHAT was checked via `claimId`, against WHICH declared
sources via `declaredSources`, WHEN via `checkedAt`, the typed `outcome`);
the engine's checks list rides `VerificationSource.source` (the evidence
node id + kind + what was compared, as the check consulted it), `url`, and
`asReported` (the evidence text, verbatim). Consumer impact: none on
existing consumers (purely additive; no existing export changed shape).

### Added

- `ErrorCode.AdsVerificationAbsent` = `ads/verification-absent` — the
  OfferVerificationStore's typed absence.

## 0.9.0 — 2026-10-12 — the Ad Center absent error codes (P5-STORES)

Phase-5 row 2 (the durable Ad Center stores). Adds the typed-ABSENT half of
the ads-lane error vocabulary: the durable ads stores (local-library
migration 0006, this order) key their rows by id and follow the house
typed-absent rule — a get on an id with no stored row rejects with the
shape's own absent code, never null and never an invented substitute (the
intelligence transcript-payload-absent precedent, carried into the ads
lane). Absence is never invalidity: an absent row is the honest pre-import
state, and the error's reason names re-import as the recovery. Five codes,
one per store family this order persists; no verification-absent code
exists because no verification store exists yet (P5-VERIFY builds the
verification machinery). The 0.8.0 shapes and the four 0.8.0 invalid codes
are untouched. Consumer impact: none on existing consumers (purely
additive; no existing export changed shape).

### Added

- `ErrorCode.AdsIdentityAbsent` = `ads/identity-absent` — the
  AdvertiserIdentityStore's typed absence.
- `ErrorCode.AdsRecordAbsent` = `ads/record-absent` — the AdRecordStore's
  typed absence.
- `ErrorCode.AdsClaimAbsent` = `ads/claim-absent` — the ClaimStore's typed
  absence.
- `ErrorCode.AdsEvidenceAbsent` = `ads/evidence-absent` — the
  EvidenceEdgeStore's typed absence.
- `ErrorCode.AdsReviewSignalAbsent` = `ads/review-signal-absent` — the
  ReviewSignalStore's typed absence.

## 0.8.0 — 2026-10-12 — the Ad Center contract module (P5-CONTRACTS)

Phase-5 row 1 (the Ad Center opener). Adds the ads lane's own contract
module `src/ads.ts` — a NEW additive sibling importing ONLY the shared
primitives (`internal/primitives`): nothing from the intelligence/ranking
modules, in either direction. Separation is structural (phase5-ad-plan
§3): the shapes carry NO ranking signals and NO user data, and the
architecture-check `ads-separation` rule added in this order PINS the
organic ranking path (the ranking use cases, their ranker seam, and the
ranking domain invariants) away from every ads symbol — type-only
imports included, and the reverse direction too. Every identity and
verification fact is SOURCE-REPORTED (the access truths of
AUDIT-SOURCES §6 finding 13 + §11 encoded as shapes): absent means
absent throughout (honest-absent optionals; present arrays are
non-empty), no aggregation of review signals, no bare "verified"
badges. Frozen §2.1–2.6, the intelligence modules and every earlier
additive sibling are untouched. Consumer impact: none on existing
consumers (purely additive; no existing export changed shape).

### Added

- `src/ads.ts` (NEW sibling module):
  - `AdProvenance` (+ schema) — the shared import provenance: source /
    observedAt? / importedAt / importBatchId.
  - `AdvertiserIdentity` (+ `AdvertiserVerificationState` enum) —
    source-reported identity facts; the verification state is the
    SOURCE's verdict (source-reported-verified / -unverified /
    -revoked), never our own judgment.
  - `AdRecord` (+ `AdServingPeriod`) — one observed ad: the creative
    text/urls the source exposed, regions/periods as reported, the
    advertiser identity ref, the import provenance. NO ranking signals,
    NO user data.
  - `Claim` — an EXTRACTIVE claim: a verbatim quoted span of an ad's
    own text with UTF-16 character offsets + the AdRecord id it came
    from; a claim the source did not state is a defect (the Phase-4
    Q&A-span discipline; offset bounds + quote byte-equality are domain
    invariants).
  - `EvidenceLink` (+ `EvidenceNodeKind` + `EvidenceRelationship`
    enums) — one evidence-graph edge off a claim, a discriminated union
    over the four node kinds (source-reported-fact with its url,
    independent-review pointing at the ReviewSignal that IS the node,
    offer-terms with its declared url, user-imported-document with the
    user's document reference), each carrying provenance + the
    relationship (supports / contradicts / contextualizes).
  - `ReviewSignal` — an independent review AS REPORTED ONLY: the
    source, its verbatim rating and/or classification (at least one
    required), region/scope, provenance. NO score, NO aggregation.
  - `OfferVerification` (+ `OfferVerificationState` enum +
    `VerificationSource`) — the honest verification record: WHAT was
    checked (the claim), against WHICH declared sources (the evidence
    list), WHEN, and the typed outcome (unchecked /
    verified-against-declared-source / not-verifiable / contradicted);
    the state-machine legality (unchecked records are bare; checked
    records carry the full evidence list) is a domain invariant.
  - `QualificationExplanation` (+ `AdQualificationPolicyVersion` closed
    enum `["v1"]` + `AdEvidencePointer` union + `QualificationReason`) —
    the §4 explainability pattern in the ads lane: reasons[] with
    evidence pointers, mandatory in both outcome directions, pinned to
    the deterministic policy version.
- Error codes: `ads/record-invalid`, `ads/claim-invalid`,
  `ads/evidence-invalid`, `ads/verification-invalid` — the four distinct
  typed failures the shapes + domain invariants genuinely reject
  through (the work order's trim directive honored: one code per
  invariant family; no machinery exists this order — the codes are the
  typed vocabulary).
- Domain invariants (webflix-domain `src/ads-invariants.ts`, re-exported
  from that package's entrypoint): `validateClaimOffsets` (offsets
  within the source text + quote byte-equal to the offset window),
  `validateEvidenceLinkReferential` (the edge's claim resolves; an
  independent-review edge's review signal resolves),
  `validateOfferVerificationState` (the bare-unchecked / full-evidence
  pairing), `validateOfferVerificationTransition` (unchecked -> checked
  states only).
- Architecture: the `forbiddenImports` rule type (engine + policy) and
  the `ads-separation` / `ads-separation-reverse` rules with a firing
  test proving the rule detects a deliberate bad import through the
  real checker over the real policy.

## 0.7.0 — 2026-10-11 — the experiment/evaluation loop shapes (P4-EVALLOOP)

Phase-4 row 7 (the FINAL Phase-4 row). Adds the offline-replay contract
shapes: the evaluation request (profile-scoped replay scope + universe +
configurations + yardstick), the per-configuration outcomes with their
POPULATION-CARRYING metrics, and the one genuinely-needed caller-defect
error code. Frozen §2.1–2.6 module files untouched; `intelligence.ts` and
`intelligence-translate-tts.ts` untouched (the new section ships as the
sibling module `intelligence-evaluation.ts`, re-exported from the same
entrypoint — byte-identical public-surface method); the
RankingPolicyVersion enum stays CLOSED at `["v1"]` (the loop compares the
built-in v1 against SELECTED adapters, never an invented v2); the
DerivedArtifact kind enum stays CLOSED at six kinds — an evaluation is an
experiment READ-OUT returned in the job result, NOT a derived artifact of
a catalog item (no shape here references DerivedArtifact, and the
mi.evaluate use case writes nothing to the artifact registry). Consumer
impact: none on existing consumers (purely additive; no existing export
changed shape).

### Added

- `src/intelligence-evaluation.ts` (NEW sibling module — the §2.7
  intelligence module's additive continuation, the
  `intelligence-translate-tts.ts` precedent):
  - `EvaluationConfiguration` (+ schema) — the comparison's sides, exactly
    three kinds: `built-in` (the deterministic policy v1), `adapter` (an
    explicit registry-known adapter id — the typical source being the
    selection store's stored `adapterId`, read by the caller), and
    `selected` (resolve the profile's CURRENT selection at run time; no
    stored selection => the documented default, stated so in the outcome's
    resolution note; a DRIFTED selection is a per-configuration honest
    failure, never a silent switch).
  - `EvaluationRequest` (+ schema, hand-declared readonly type — the
    SummaryRequest precedent) — `itemIds` (the replay universe; MAY be
    empty = the honest-empty population-0 case; duplicates rejected),
    optional `feedbackEventIds` scope filter (absent = replay all stored
    events; duplicates rejected), `configurations` (min 1; literal
    duplicates rejected — a comparison needs distinct sides),
    `k` (int >= 1, one yardstick for every side), `asOf` (the deterministic
    reference instant, the RankerInput precedent).
  - `ExplicitFeedbackAgreement` (+ schema) — the agreement metric with the
    counted populations NAMED: `likedTotal` / `likedInTopK` /
    `dislikedTotal` / `dislikedInBottomK` / `abstained`, plus
    `likedShare` / `dislikedShare` / `agreedShare` — each NULL when its
    denominator is 0 (no population => no share, so a 1/1 "100%" can never
    masquerade as strong evidence). Disliked items ABSENT from the ranking
    (suppressed) count as agreeing — the policy's strongest "not
    recommended" (documented on the field). NO fabricated ground truth:
    the metric measures agreement with the USER'S OWN explicit signals and
    its name says so.
  - `ScoreDistributionStats` (+ schema) — descriptive stats over the
    produced ranking's scores (`count`/`min`/`max`/`mean`/`median`), every
    stat null at count 0 (honest empty), all quantized to 4 decimals.
  - `PairwiseTopKOverlap` (+ schema) — the A/B overlap@k between two
    EVALUATED sides: `overlap`, the ACTUAL per-side top-k sizes
    (`sizeA`/`sizeB` = min(k, ranked count)), and `share` =
    overlap/max(sizeA, sizeB), NULL when both are 0 (two empty rankings —
    nothing to compare, never a fabricated 0%).
  - `EvaluationOutcome` (+ schema) — per request configuration, in request
    order: `evaluated` (the resolved ranker identity + the honest
    `resolutionNote` + the verbatim frozen `RankingResult` + the metrics)
    or `failed` (the per-configuration FAIL-SOFT outcome: an
    unknown adapter id / a thrown ranker — surfaced as DATA, the other
    sides still evaluated, nothing fabricated for a side that did not
    run).
  - `EvaluationReplaySummary` (+ schema) — the replay's populations: total
    stored feedback, replayed count, explicit/implicit under test,
    objectives applied, items under test.
  - `EvaluationResult` (+ schema) — `k`, the echoed `asOf`, the canonical
    SORTED `itemIds`, the replay summary, the outcomes, and the pairwise
    overlaps for every unordered pair of evaluated sides. Carries NO run
    timestamps (determinism is over the whole result; job metadata lives
    ONLY in the frozen §2.6 descriptor).
- `ErrorCode.IntelligenceEvaluationInvalid` (`intelligence/evaluation-invalid`)
  — the ONE new error code: the mi.evaluate caller defects (malformed
  request, duplicate ids, literal-duplicate configurations, empty
  configuration list, universe ids absent from the supplied catalog
  snapshot) plus the read-time unknown-feedbackEventIds variant. Ranker
  failures need no new code (per-configuration fail-soft data); typed
  cancellation reuses the existing `common/cancelled`.

## 0.6.0 — 2026-10-11 — translation + TTS engine seams (P4-TRANSLATE)

Phase-4 row 6. Adds the two LOCAL engine ports (translation + TTS) + their
descriptor / request / result schemas + the progress/options types + the
genuinely-needed MI error codes. Frozen §2.1–2.6 module files untouched; the
§2.7 intelligence module gains one appended section only; the DerivedArtifact
kind enum stays CLOSED at six kinds (audio is a payload RENDITION, not an
artifact kind). Consumer impact: none on existing consumers (purely additive;
no existing export changed shape).

### Added

- `src/intelligence-translate-tts.ts` (NEW sibling module — the §2.7
  intelligence module's additive continuation; the section was split into
  its own file when `intelligence.ts` reached the repo's
  400-effective-line max-lines limit. `index.ts` re-exports it beside
  `intelligence.ts`, so the public surface is byte-identical to a
  single-file section; frozen §2.1–2.6 module files and `intelligence.ts`
  itself stay untouched):
  - `TranslationEngineDescriptor` + `TtsEngineDescriptor` (+ schemas) — the
    engine-adapter identities, same honesty rules as every engine
    descriptor: our adapter's id/label/version always known; optional
    `engineVersion` / `modelLineage` read from the EXTERNAL engine's own
    output when reported, ABSENT otherwise (never guessed); `licenseNote`
    (Argos-class and Piper-class = MIT-family, AUDIT-SOURCES §6; null when
    none applies).
  - `TranslationRequest` (+ schema) — the source text (resolved from a
    STORED text payload by the calling use case — engines stay pure over
    text) plus source/target language tags, ENGINE-INTERPRETED codes (the
    TranscriptionRequest.language precedent: shape-checked only; an
    unsupported tag is the engine's failure to report, never our guess).
  - `TranslationResult` (+ schema) — `translatedText` non-empty (an engine
    producing no translation is a FAILED run, never an empty success) plus
    the optional run-reported lineage facts.
  - `TtsRequest` (+ schema) — the text plus the VOICE identity the engine
    resolves against its own discovered voices (an unknown voice is the
    honest engine-unavailable state, surfaced with a recovery hint).
  - `TtsResult` (+ schema) — the synthesized `audio` bytes
    (`z.instanceof(Uint8Array)`) + the engine-produced `contentType` (e.g.
    "audio/wav") + the optional run-reported lineage facts.
  - `TranslationEngineProgress` / `TranslationEngineOptions` /
    `TtsEngineProgress` / `TtsEngineOptions` (interfaces) — the cooperative
    cancellation + progress shapes, mirroring the existing engine seams.
  - `TranslationEnginePort` / `TtsEnginePort` (interface-only seams, the
    TranscriptionEnginePort shape) — one method each (`translate` /
    `synthesize`) with the binding implementation rules: LOCAL ONLY (no
    network, no model/voice downloads, no provider reads — ever), HONEST
    AVAILABILITY (engine absent — or, for TTS, the voice model absent —
    rejects typed engine-unavailable with a recovery hint), COOPERATIVE
    CANCELLATION (boundary check + mid-run child kill; typed
    common/cancelled; no result), HONEST LINEAGE (engine-reported facts
    only; absent means absent), OUTPUT FROM THE ENGINE'S OWN OUTPUT ONLY
    (translation text parsed from documented CLI shapes; TTS bytes read
    from the engine's own output path — never fabricated, never
    substituted).
- `src/errors.ts`: seven codes appended to the additive-only enum. The work
  order's six listed codes are ALL kept — the trim directive was applied
  and each maps to a distinct typed failure with its own recovery:
  `intelligence/translation-invalid` and `intelligence/tts-invalid`
  (mi.translate / mi.tts caller defects: blank artifact ids, language tags
  or voice ids, referenced artifacts that are not text sources);
  `intelligence/translation-engine-unavailable` and
  `intelligence/tts-engine-unavailable` (the honest-absent states — engine
  or voice model not on this machine, surfaced with a recovery hint);
  `intelligence/translation-engine-failed` and
  `intelligence/tts-engine-failed` (FOUND engines reporting their own
  failures — distinct from absent because the recovery differs). PLUS one
  code the order's four-kind text-read contract genuinely requires beyond
  the listed six: `intelligence/text-payload-absent` — the non-transcript
  analog of `transcript-payload-absent` (a summary/overview/qa/translation
  artifact whose text payload was never persisted — typed, surfaced, never
  an empty substitute). Typed cancellation reuses the existing
  cross-cutting `common/cancelled`: no new code needed for it.
- Anti-blank normalization: every string field the section adds uses
  trim-then-min(1) (ids, tags, labels, lineage facts, contentType) — a
  whitespace-only value is a BLANK and is rejected. The payload-borne text
  fields (`text`, `translatedText`) are data, not ids: `min(1)` untrimmed.

## 0.5.0 — 2026-10-11 — text-intelligence engine seam (P4-SUMMARIZE)

Phase-4 row 5. Adds the summary/overview/Q&A engine port + the six
request/result schemas + the two genuinely-needed MI error codes. Frozen
§2.1–2.6 module files untouched; the §2.7 intelligence module gains one
appended section only. Consumer impact: none on existing consumers (purely
additive; no existing export changed shape).

### Added

- `src/intelligence.ts` (ADDITIVE section, after `TranscriptionEnginePort`):
  - `SummaryEngineDescriptor` (+ schema) — the text-intelligence adapter
    identity, same honesty rules as the transcription descriptor: our
    adapter's id/label/version always known; optional `engineVersion` /
    `modelLineage` read from an external model's own output when reported,
    ABSENT otherwise (never guessed); `licenseNote` (null for the built-in —
    it is our own deterministic code, no external model license applies).
  - `SummaryRequest` / `OverviewRequest` (+ schemas) — the STORED transcript
    segments (engines are pure over segments; the calling use case resolves
    the payload from the transcript-payload store). Empty segments is the
    honest "no speech" transcript — every operation returns its honest
    empty result over it.
  - `SummaryResult` (+ `SummarySentence` + schemas) — the selected sentences
    in SOURCE order, each a VERBATIM excerpt of its source segment's text
    with a citation (segment index + [startMs, endMs) range).
  - `OverviewResult` (+ `OverviewChapter` + schemas) — timeline chapters in
    transcript order: contiguous time-ranged sections titled by dominant
    terms, each citing its segment count; `endMs < startMs` rejected.
  - `QaRequest` / `QaAnswer` (+ `QaSpan` + schemas) — the answer IS the
    QUOTED spans: the `QaAnswer` shape deliberately has NO free-text answer
    field, so quote discipline is STRUCTURAL (no generative wording can be
    represented). Empty spans is the honest "no segment matched" outcome.
  - `SummaryEngineProgress` + `SummaryEngineOptions` + `SummaryEnginePort`
    (interfaces, the port seam) — summarize/overview/answer methods over one
    seam with cooperative cancellation (signal checked at entry AND between
    units; a thrown onProgress callback is a stop request) and the binding
    implementation rules: quote discipline (inventing wording outside the
    source quotes is a defect), extraction over the given segments only
    (pure — no storage, no network, no model files), honest empties. The
    BUILT-IN implementation is fully deterministic (corpus-pinned); a later
    user-selected model adapter honestly is not and says so through its
    lineage — never a hidden default LLM.
- `src/errors.ts`: two codes appended to the additive-only enum —
  `intelligence/summary-invalid` (mi.summarize / mi.overview / mi.qa caller
  defects: blank ids or questions, bad request shapes, referenced artifacts
  that are not transcripts) and `intelligence/transcript-payload-absent`
  (a transcript artifact exists but its segment payload was never persisted
  — typed, surfaced, re-transcription as the recovery; never hidden, never
  an empty substitute). Typed cancellation reuses the existing
  `common/cancelled`: no new code needed for it.
- Anti-blank normalization: every string field the section adds uses
  trim-then-min(1) — a whitespace-only question / sentence text / span
  quote / chapter title is a BLANK and is rejected.

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
