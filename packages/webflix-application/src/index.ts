/**
 * @webflix/application — public surface (D2-LOCAL).
 *
 * Use-cases orchestrate the (pure) domain rules over the ports defined in
 * `./ports.ts`; entity shapes in `./types.ts` mirror `@webflix/domain` and are
 * bridged by adapters at the edges. Adapters implement the ports:
 *
 *   - LocalStore           -> packages/webflix-local-store
 *   - IndexingPort         -> packages/webflix-indexer
 *   - ProviderMetadataPort -> packages/webflix-providers
 *   - CredentialPort       -> desktop keychain adapter (contract re-export)
 */
export * from "./types";
export * from "./ports";
export * from "./path-safety";
export * from "./indexing-session";
export * from "./add-local-files-to-library";
export * from "./manage-collections";
export * from "./track-playback-progress";
export * from "./refresh-provider-metadata";
export * from "./run-indexing-job";
// Media intelligence (Phase 4, P4-CONTRACTS + P4-ARTIFACTS): in-memory store
// defaults (pure-test defaults — the durable adapters live on the
// local-library seam and are exported there), the built-in deterministic
// ranker (RankingPolicy v1) and the MI use cases (objectives, feedback,
// ranking job, artifact bookkeeping). The P4-FD1 mirrors collapsed to
// webflix-domain imports when the frozen edge landed (P4-ARTIFACTS row 0):
// parseOrThrow/parseIsoToEpochMs/transitionJob/the objective+lineage rules
// all come from the domain package now.
export * from "./in-memory-intelligence-stores";
export * from "./built-in-ranker";
// P4-ADAPTERS row 1: the ranker-adapter registry (static default seeded
// with exactly one entry — the built-in v1) and the selection use cases
// (set/clear validate registry-known ids; resolveSelectedRanker returns the
// active adapter with honest resolution metadata — default, selected, or
// fail-soft fallback with the typed error surfaced).
export * from "./ranker-adapter-registry";
export * from "./ranker-adapter-selection";
export * from "./set-objectives";
export * from "./record-feedback";
export * from "./generate-recommendations";
export * from "./derive-artifact-bookkeeping";
// P4-TRANSCRIBE: the transcript pipeline — the first REAL derived-artifact
// producer. mi.transcribe rides the frozen §2.6 job wrapper (boundary +
// cooperative mid-run cancellation; cancelled/failed runs store NO artifact),
// and the fixture-replay engine is the DETERMINISTIC TEST DOUBLE (canned
// segments, labelled as such, no real ASR). The REAL local whisper.cpp
// adapter is node-bound (child_process/fs/os) and therefore lives on the
// local-library adapters seam (which already owns every machine-bound
// adapter) implementing the SAME contracts TranscriptionEnginePort —
// structural typing wires it into mi.transcribe's `engine` dep without a
// cross-package edge. No engine is bundled; no network exists anywhere in
// this path.
export * from "./transcribe-media-file";
export * from "./fixture-replay-engine";
// P4-SUMMARIZE: the text-intelligence producers. The transcript payload
// record + checksum (and its port, in ./ports.ts) resolve the P4-TRANSCRIBE
// recorded adjacency; mi.transcribe now persists the payload on success
// (the sanctioned amendment above). The built-in extractive engine is
// DETERMINISTIC, pure, local (no model, no network, no generative text);
// the fixture-replay summary engine is its DETERMINISTIC TEST DOUBLE; and
// mi.summarize / mi.overview / mi.qa ride the frozen §2.6 wrapper with
// lineage (webflix.extractive.v1 via webflix.built-in-summary-engine) and
// the source transcript artifact never mutated. The DURABLE payload store
// lives on the local-library seam (migration 0004) — a later order wires
// the composition root.
export * from "./transcript-payload";
export * from "./built-in-summary-engine";
export * from "./fixture-replay-summary-engine";
export * from "./mi-text-intelligence";

// P4-TRANSLATE: the translation + TTS text pipeline — the text payload and
// audio rendition records/ports, their in-memory defaults, the fixture-
// replay engine TEST DOUBLES, and mi.translate / mi.tts riding the frozen
// §2.6 wrapper (translation = a DerivedArtifact kind=translation with
// engine-reported lineage; TTS = an audio payload RENDITION attached to
// the source artifact — NO new artifact kind, the enum stays closed). The
// DURABLE stores live on the local-library seam (migration 0005) — a
// later order wires the composition root.
export * from "./text-payload";
export * from "./audio-rendition";
export * from "./fixture-replay-translation-engine";
export * from "./fixture-replay-tts-engine";
export * from "./mi-translate";
export * from "./mi-tts";

// P4-EVALLOOP: the experiment/evaluation loop — the pure metric
// computations (population-named honest metrics), the deterministic
// read-only replay core (ranker resolution + per-configuration replay),
// the mi.evaluate use case riding the frozen §2.6 wrapper (the result is
// returned in the job result — NOT a DerivedArtifact, nothing persisted),
// and the fixture-replay ranker TEST DOUBLE the evaluation tests use.
export * from "./evaluation-metrics";
export * from "./evaluation-replay";
export * from "./mi-evaluate";
export * from "./fixture-replay-ranker";

// P5-STORES (Phase-5 row 2): the Ad Center store ports (five ads-lane seams
// structurally separate from every intelligence/ranking port — phase5-ad-
// plan §3), their IN-MEMORY doubles for hermetic tests, and ads.import —
// the IMPORT SEAM, the honest path ad data enters the system until
// transparency connectors are authorized (P5-SOURCES). ads.import rides the
// frozen §2.6 wrapper (boundary + per-item cooperative cancellation),
// validates each item through the 0.8.0 schemas + the domain invariants
// (the extractive discipline), persists atomically PER RECORD with honest
// per-item outcomes (accepted-with-disposition / rejected-with-reason),
// and makes the charter's version rule literal: same source id + same
// batch = replace; different batch = a NEW version appended with
// provenance; NEVER a silent overwrite of history. The DURABLE stores live
// on the local-library seam (migration 0006 ad_* tables) — a later order
// wires the composition root.
export * from "./in-memory-ads-stores";
export * from "./ads-import";
export * from "./ads-import-rules";
export * from "./ads-import-items";

// P5-CLAIMS (Phase-5 row 3): the deterministic EXTRACTIVE claim engine —
// the built-in pattern extractor (a documented, fixed, lexical parameter
// set in the module docblock, the built-in-summary-engine house style) +
// its labeled TEST DOUBLE (the fixture-replay pattern) + the two §2.6 use
// cases riding the P5-STORES claim/evidence stores: ads.extractClaims
// (per-record honest outcomes, the version rule literal through the
// minted claim ids, the source record never mutated) and ads.linkEvidence
// (explicit-input-only evidence-graph construction — NO inference: the
// engine links exactly what the input batch carries, idempotent by edge
// identity). No qualification (P5-QUALIFY), no connectors (P5-SOURCES),
// no LLM, no network — recall is not promised.
export * from "./ads-claim-extractor";
export * from "./ads-extract-claims";
export * from "./ads-link-evidence";
export * from "./fixture-replay-ads-claim-extractor";

// P5-VERIFY (Phase-5 row 4): offer verification over STORED evidence +
// the as-reported review-signal reading path. ads.verify resolves each
// claim's stored evidence edges + review signals, runs the DETERMINISTIC
// documented comparison (numeric/text rules + the declared-relationship
// polarity mapping — fixed parameters in ads-verify-comparison.ts's
// docblock, the built-in-summary-engine house style), and appends one
// typed OfferVerification per claim through the migration-0007
// verification store (append-only by verification id; every record
// re-validated through the domain state-machine invariant BEFORE it is
// stored — an empty checks list can never yield verified, structurally).
// ads.reviewSignals lists the stored signals AS-REPORTED (one row per
// signal, verbatim vocabulary + full provenance, NO aggregation, NO
// scoring, NO normalization across sources). No external fetching, no
// truth invention: the engine compares what the user imported, and says
// so. The in-memory OfferVerificationStore double rides the P5-STORES
// in-memory set above.
export * from "./ads-verify";
export * from "./ads-verify-comparison";
export * from "./ads-review-signals";

// P5-QUALIFY (Phase-5 row 5): the explainable qualification engine. The
// deterministic v1 policy (ads-qualify-policy.ts: fixed documented
// parameters — populations from the stores' own listing orders, the
// standing rule, the fixed reason mint order — the built-in-ranker house
// style) + ads.qualify, the §2.6 READ use case: per-record
// QualificationExplanation (reasons[] with evidence pointers into the
// stored claim/verification/signal data) + the raw counted facts
// (AdQualificationFacts — NO score, NO weights: the output IS the reasons
// list + the counted populations), the honest typed no-data outcome for
// claimless records (never a zero-dressed-as-signal — the 0.10.0 shape's
// min(1) makes it structural), nothing stored (recomputed from current
// data), nothing mutated. Qualification is DISPLAY-STANDING in the Ad
// Center view — never an organic-ranking input (the architecture rule
// pins the separation). No signal aggregation (per-source counts are
// facts, never merged ratings), no connectors (P5-SOURCES), no network.
export * from "./ads-qualify-policy";
export * from "./ads-qualify";

// P5-SOURCES (Phase-5 row 6 — the FINAL row): the transparency-source
// seam. The three honest-state adapters (transparency-source-adapters.ts:
// GATC blocked — no official API; Meta + TikTok pending-authorization
// naming their application paths — ZERO network, rg-provable) + the
// static registry (transparency-source-registry.ts: the
// ranker-registry pattern, manifest schema-validated at construction) +
// ads.querySources (ads-query-sources.ts: the §2.6 query use case — the
// unavailable/pending/blocked states are DATA, surfaced never hidden)
// + ads.sourceManifests (ads-source-manifests.ts: the §2.6 manifest
// listing read for the Ad Center's honest display) + the import bridge
// (transparency-source-bridge.ts: ok-result observations map into the
// ads.import seam unchanged — our ids + import stamps minted there
// only) + the LABELED fixture-replay double
// (fixture-replay-transparency-source.ts — TEST DOUBLE, no real source
// access, for the contract/cancellation tests). No scraping, no
// transport, no coverage promises beyond the manifests' own terms.
export * from "./transparency-source-adapters";
export * from "./transparency-source-registry";
export * from "./ads-query-sources";
export * from "./ads-source-manifests";
export * from "./transparency-source-bridge";
export * from "./fixture-replay-transparency-source";

// P7-SEARCH-1 (Phase-7 wave-1 row 1, WF-009 federated search): the
// search-source seam — the SearchSourcePort itself lives in ./ports.ts
// (additive); here land the static registry + the FederatedSearch use
// case (concurrent fan-out across every registered source, per-source
// timeout budget, aggregation into FederatedSearchResult with coverage
// that NEVER hides a failed source, and the MatchEvidence-driven merged
// item view over the frozen catalog shapes) and the LABELED fixture
// adapter set (YouTube-like + Reddit-like + unsupported + auth-gated —
// TEST DOUBLES, no network, no credentials; real transport is a later
// order behind the same port).
export * from "./federated-search";
export * from "./fixture-search-sources";
// P7-RETENTION-1 (Phase-7 wave-1 row 3): WF-021 history/retention controls
// — typed use cases + the retention store seams over WebFlix-owned local
// records ONLY. history-retention.ts owns the ports (the persisted pause
// preference store; the scoped record stores for history/progress/feedback,
// with the watch-history append PAUSE-AWARE at the store seam — the typed
// `paused` outcome, never a silent no-op) and the five use cases:
// pauseHistoryTracking / resumeHistoryTracking (persisted preference),
// resetLocalData (scoped history | progress | feedback | all — deletes only
// ever claim the confirmed WebFlix-local scope), getRetentionState (the
// boundary view model) and describeDataBoundaries (the typed, i18n-ready
// local/provider/derived explanation — provider-owned records are reported
// as not deletable here, never touched, never claimed).
// in-memory-retention-stores.ts ships the NOT-DURABLE fixture doubles
// (pure-test defaults; the durable adapters are a later local-library
// order, wired by P7-COMPOSE-1). NO contract edits, NO shell edits, NO
// existing use-case edits in this lane.
export * from "./history-retention";
export * from "./in-memory-retention-stores";

// P7-AD-MEMORY-1 (Phase-7 wave-2 row 5, WF-029 ad personal memory): the
// EXPLICIT OPT-IN memory lane over the 0.13.0 ads-memory contracts —
// ad-memory.ts owns the ports (the per-scope consent store, the
// saved-ad store, the append-only user-observation store) and the use
// cases: GrantAdMemoryConsent / RevokeAdMemoryConsent (the ONLY consent
// writers — explicit user actions, injected clock), SaveAd / ForgetAd /
// RecordObservation / ListMemory (each gated by the per-scope consent;
// the refusals ads-memory/consent-required and ads-memory/scope-revoked
// are DATA, never thrown — a listing never hides a closed scope, a user
// observation is user-stated and never conflated with source-backed
// evidence, and nothing auto-joins across sources).
// in-memory-ad-memory-stores.ts ships the NOT-DURABLE fixture doubles
// (pure-test defaults; the durable adapters are a later local-library
// order if sanctioned). NO shell edits, NO engine rework, NO provider
// calls, NO telemetry.
export * from "./ad-memory";
export * from "./in-memory-ad-memory-stores";

// P7-GUEST-1 (Phase-7 wave-3, WF-003 guest viewing): the guest session
// lane. guest-session.ts owns the READ-ONLY account-state port and the
// manifest-source port, plus the GuestSessionFactory (minting a FRESH
// guest profile with NO provider accounts connected — closed kind
// literal, injected id + clock, fresh-profile law guarded with the typed
// GuestRuleError) and the GuestSession (gate() / capabilities() derive
// LIVE from the manifest source plus the observed account state).
// guest-capabilities.ts owns the pure view model: per provider
// operation, whether the GUEST state permits it (manifest "supported" =
// public browse/search/watch, permitted with auth "public") or refuses
// with the typed auth-required reason pointing at the connect flow (the
// settings/accounts surface + the manifest's own oauth.connect row with
// its status — never a dead action), plus declared-unavailable rows that
// surface the manifest's own non-auth state VERBATIM (never re-labeled
// auth-required) and the honest connected-account reads (WF-010's
// post-connect vocabulary — this lane writes no account state, ever).
// The in-memory doubles + the public-capability connector manifest
// fixture are TESTS-TREE fixtures (src/tests/guest-fixtures.ts) per the
// order; durable adapters and composition wiring are later orders. NO
// contract edits, NO shell edits, NO provider calls, NO credentials, NO
// telemetry.
export * from "./guest-session";
export * from "./guest-capabilities";
