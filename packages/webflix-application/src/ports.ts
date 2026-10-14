/**
 * PORTS — hexagonal seams owned by the application layer (D2-LOCAL).
 *
 * Interfaces here are implemented by adapters in later milestones:
 *
 *   - `LocalStore`           -> packages/webflix-local-store (offline DB)
 *   - `IndexingPort`         -> packages/webflix-indexer (filesystem + tags)
 *   - `ProviderMetadataPort` -> packages/webflix-providers (online lookup)
 *   - `CredentialPort`       -> desktop keychain adapter (contract re-export)
 *   - `ClockPort`            -> provided by the composition root
 *
 * Use-cases depend only on these interfaces; tests substitute in-memory fakes
 * (see `src/__tests__/application.test.ts`).
 */
import type {
  CollectionId,
  CollectionRecord,
  Fingerprint,
  LibraryTrack,
  PlaybackProgressRecord,
  ProviderFieldSetRecord,
  ProviderFields,
  ProviderId,
  TrackId,
  TrackProbe,
} from "./types";
import type { DerivedArtifact, FeedbackEvent, UserObjective } from "webflix-contracts";
import type {
  AdRecord,
  AdvertiserIdentity,
  Claim,
  EvidenceLink,
  OfferVerification,
  ReviewSignal,
} from "webflix-contracts";
import type { SearchOutcome, SearchRequest } from "webflix-contracts";
import type { TranscriptPayload } from "./transcript-payload";
import type { AudioRendition } from "./audio-rendition";
import type { TextPayload } from "./text-payload";

/**
 * The credential contract is frozen in `@webflix/contracts`; re-exported here
 * so use-cases, adapters and tests share a single definition.
 */
export type { CredentialPort } from "webflix-contracts";

/** Injectable time — use-cases never read the wall clock directly. */
export interface ClockPort {
  /** The current instant. */
  now(): Date;
}

/** Factory for opaque identifiers; the composition root supplies `crypto.randomUUID`. */
export type IdGenerator = () => string;

// ---------------------------------------------------------------------------
// LocalStore — everything WebFlix owns, fully offline
// ---------------------------------------------------------------------------

/**
 * Local persistence for tracks, collections, WebFlix-owned playback progress
 * and provider-sourced field sets. Implementations must work fully offline.
 */
export interface LocalStore {
  // --- tracks ---
  listTracks(): Promise<readonly LibraryTrack[]>;
  getTrack(id: TrackId): Promise<LibraryTrack | null>;
  findTrackByFingerprint(fingerprint: Fingerprint): Promise<LibraryTrack | null>;
  putTrack(track: LibraryTrack): Promise<void>;
  removeTrack(id: TrackId): Promise<void>;

  // --- collections ---
  listCollections(): Promise<readonly CollectionRecord[]>;
  getCollection(id: CollectionId): Promise<CollectionRecord | null>;
  putCollection(collection: CollectionRecord): Promise<void>;
  deleteCollection(id: CollectionId): Promise<void>;

  // --- WebFlix-owned playback progress ---
  getPlaybackProgress(trackId: TrackId): Promise<PlaybackProgressRecord | null>;
  listPlaybackProgress(): Promise<readonly PlaybackProgressRecord[]>;
  putPlaybackProgress(progress: PlaybackProgressRecord): Promise<void>;
  clearPlaybackProgress(trackId: TrackId): Promise<void>;

  // --- provider-sourced field sets ---
  getProviderFieldSet(
    trackId: TrackId,
    provider: ProviderId,
  ): Promise<ProviderFieldSetRecord | null>;
  listProviderFieldSets(provider?: ProviderId): Promise<readonly ProviderFieldSetRecord[]>;
  putProviderFieldSet(record: ProviderFieldSetRecord): Promise<void>;
  deleteProviderFieldSet(trackId: TrackId, provider: ProviderId): Promise<void>;
}

// ---------------------------------------------------------------------------
// IndexingPort — path-safe local indexing
// ---------------------------------------------------------------------------

export type IndexingStatus = "running" | "completed" | "cancelled" | "failed";

export interface IndexingJobHandle {
  readonly jobId: string;
}

/** Per-path failure inside an indexing job; never fatal to the whole job. */
export interface IndexingFailure {
  readonly path: string;
  readonly reason: string;
}

export interface IndexingResult {
  readonly jobId: string;
  readonly status: IndexingStatus;
  /** Successfully probed paths, in completion order. */
  readonly probes: readonly TrackProbe[];
  readonly failures: readonly IndexingFailure[];
  /** Whole-job error message; set only when `status === 'failed'`. */
  readonly error: string | null;
}

/**
 * Streaming progress for an indexing job. `result` is non-null exactly when
 * `status` is terminal (`completed`, `cancelled` or `failed`); adapters MUST
 * emit that terminal event exactly once per job.
 */
export interface IndexingProgress {
  readonly jobId: string;
  readonly status: IndexingStatus;
  readonly done: number;
  readonly total: number;
  readonly result: IndexingResult | null;
}

/**
 * Local indexing seam. Use-cases hand over PATHS ONLY; the adapter owns every
 * filesystem and media-byte access. That division is what keeps the
 * application layer path-safe.
 *
 * Emission-timing rule for implementers: consumers subscribe via `onProgress`
 * in the microtask continuation that follows the awaited `start()` promise.
 * Adapters MUST therefore defer their first emission until after that
 * subscription can exist (e.g. process on a macrotask / next tick), so a
 * fast-completing job can never fire its terminal event into the void.
 */
export interface IndexingPort {
  /** Start probing `paths`; resolves immediately with a job handle. */
  start(paths: readonly string[]): Promise<IndexingJobHandle>;
  /** Best-effort cancel; resolves `true` when the job acknowledged cancellation. */
  cancel(jobId: string): Promise<boolean>;
  /**
   * Subscribe to progress events; returns an unsubscribe function.
   * See `IndexingProgress` for the terminal-event contract.
   */
  onProgress(jobId: string, listener: (progress: IndexingProgress) => void): () => void;
}

// ---------------------------------------------------------------------------
// ProviderMetadataPort — online lookup for the 30-day refresh
// ---------------------------------------------------------------------------

/** Outcome of a single track's provider lookup (contract-freeze §7.8). */
export type ProviderMetadataOutcome =
  | { readonly kind: "fetched"; readonly trackId: TrackId; readonly fields: ProviderFields }
  | { readonly kind: "not-found"; readonly trackId: TrackId }
  | { readonly kind: "error"; readonly trackId: TrackId; readonly reason: string };

/**
 * Online provider seam used by `RefreshProviderMetadata`. The adapter performs
 * the network call; the use-case owns TTL decisions and refresh-or-delete.
 */
export interface ProviderMetadataPort {
  fetch(trackId: TrackId, provider: ProviderId): Promise<ProviderMetadataOutcome>;
}

// ---------------------------------------------------------------------------
// Media intelligence (Phase 4, P4-CONTRACTS) — objective / feedback /
// artifact-bookkeeping seams
//
// Per-user, per-profile isolation (ADR-0003): every port instance is
// profile-scoped by construction — the composition root creates one store
// per profile, and no port crosses profiles. Durability update
// (P4-ARTIFACTS row 1): the DURABLE adapters for all three ports ship on
// the local-library storage seam (better-sqlite3, own `mi_*` tables,
// additive migration 0002, per-profile by construction) and are exported
// there for the composition root — wiring them here is explicitly a later
// order. The in-memory defaults below remain the pure-test defaults; the
// port boundary is the stable seam.
// ---------------------------------------------------------------------------

/** Outcome of an idempotent feedback append. */
export type FeedbackAppendResult =
  | { readonly outcome: "appended"; readonly event: FeedbackEvent }
  /** Same id as a stored event: the store returns the stored one; the use-case decides idempotency vs conflict. */
  | { readonly outcome: "duplicate"; readonly existing: FeedbackEvent };

/**
 * Per-profile objective store. `put` replaces the objective wholesale —
 * objectives are the user's CURRENT goals, editable any time (never
 * inferred, never versioned history this order; evaluation replay is
 * P4-EVALLOOP's concern).
 */
export interface ObjectiveStore {
  /** The current objective, or null when the user never set one. */
  get(): Promise<UserObjective | null>;
  put(objective: UserObjective): Promise<void>;
}

/**
 * Per-profile feedback store with idempotent-append semantics keyed by
 * event id: re-appending a stored id MUST NOT create a second entry —
 * implementations return the stored event instead.
 */
export interface FeedbackStore {
  append(event: FeedbackEvent): Promise<FeedbackAppendResult>;
  get(id: string): Promise<FeedbackEvent | null>;
  list(): Promise<readonly FeedbackEvent[]>;
}

/**
 * Per-profile derived-artifact descriptor registry. Stores descriptors
 * ONLY — structural original/derived separation: nothing here can write
 * into a catalog item, and the original catalog snapshot is supplied by the
 * caller at each create call for the lineage check.
 */
export interface ArtifactRegistry {
  put(descriptor: DerivedArtifact): Promise<void>;
  get(id: string): Promise<DerivedArtifact | null>;
  list(): Promise<readonly DerivedArtifact[]>;
}

/**
 * Per-profile transcript segment payload store (P4-SUMMARIZE row 1 — the
 * P4-TRANSCRIBE recorded adjacency resolved). Keyed by the TRANSCRIPT
 * artifact id; `put` persists the payload (segments + checksum, both
 * re-validated defensively — a mismatched checksum is a caller defect, not
 * silently stored); `get` resolves it.
 *
 * ABSENCE IS TYPED, never null: a transcript artifact whose payload was
 * never persisted (a pre-0004 transcript) makes `get` reject with the typed
 * `intelligence/transcript-payload-absent` WebFlixError — surfaced with
 * re-transcription as the recovery, never hidden and never substituted with
 * an empty payload. The durable implementation is local-library migration
 * 0004 (own `mi_transcript_payloads` table, per-profile by construction);
 * the in-memory default below serves hermetic tests. The store does NOT
 * know the artifact registry — it persists what the validated use cases
 * hand over, keyed by the id they computed.
 */
export interface TranscriptPayloadStore {
  /** Persists (or replaces) the payload for one transcript artifact id. */
  put(payload: TranscriptPayload): Promise<void>;
  /**
   * The stored payload for a transcript artifact id; rejects with the typed
   * absent error when none was persisted. Same-id re-puts replace.
   */
  get(artifactId: string): Promise<TranscriptPayload>;
}

/**
 * Per-profile TEXT payload store (P4-TRANSLATE row 2) for non-transcript
 * derived artifacts (kinds summary / overview / qa / translation): the
 * artifact's documented text projection, keyed by its artifact id.
 *
 * ABSENCE IS TYPED, never null: an artifact whose text projection was
 * never persisted makes `get` reject with the typed
 * `intelligence/text-payload-absent` WebFlixError — surfaced with
 * re-running the producing use case as the recovery, never hidden and
 * never substituted with an empty payload. `put` re-validates the record
 * defensively (a mismatched checksum is a caller defect, never silently
 * stored); same-id re-puts replace (the put-replaces house semantic). The
 * durable implementation is local-library migration 0005 (`mi_text_payloads`,
 * the 0002/0003/0004 rules); the in-memory default serves hermetic tests.
 */
export interface TextPayloadStore {
  /** Persists (or replaces) the text payload for one derived artifact id. */
  put(payload: TextPayload): Promise<void>;
  /**
   * The stored text payload; rejects with the typed absent error when none
   * was persisted (never null — absence is typed and surfaced).
   */
  get(artifactId: string): Promise<TextPayload>;
}

/**
 * Per-profile AUDIO rendition store (P4-TRANSLATE row 2, the TTS side):
 * synthesized audio attached to its SOURCE artifact as payload renditions
 * — each carrying its OWN lineage (engine, voice, inputsHash) — with the
 * source artifact's descriptor never mutated (audio-as-rendition, NOT a
 * derived-artifact kind; the kind enum stays closed).
 *
 * Renditions list BY SOURCE artifact id (the attachment surface — a source
 * may honestly carry MANY renditions: different voices, different engine
 * runs); listing order is deterministic (createdAt then renditionId — the
 * DeriveArtifactBookkeeping.list precedent). The retention surface (delete
 * / deleteBySource / clearAll) mirrors the payload stores'. The durable
 * implementation is local-library migration 0005 (`mi_audio_renditions`,
 * the 0002/0003/0004 rules — the audio bytes a BLOB column, the canonical
 * form of bytes); the in-memory default serves hermetic tests.
 */
export interface AudioRenditionStore {
  /** Persists one rendition (id-keyed; a re-put of the same id replaces). */
  put(rendition: AudioRendition): Promise<void>;
  /** The source artifact's renditions, deterministic order; empty when none (honest). */
  listBySource(sourceArtifactId: string): Promise<readonly AudioRendition[]>;
  /** Deletes one rendition by id; true when it existed (retention surface). */
  delete(renditionId: string): Promise<boolean>;
  /** Deletes every rendition attached to one source artifact; returns how many (retention surface). */
  deleteBySource(sourceArtifactId: string): Promise<number>;
  /** Clear-all per profile; returns the number of renditions removed (retention surface). */
  clearAll(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Ad Center stores (P5-STORES row 2, Phase-5 row 2) — the ads lane's OWN
// store seams, structurally separate from every intelligence/ranking port
// above (phase5-ad-plan §3: separation is structural; the architecture rule
// pins the import direction, and these ports import ONLY the ads shapes
// from webflix-contracts).
// ---------------------------------------------------------------------------

/** Idempotent-append outcome for review signals (append-only facts). */
export type ReviewSignalAppendResult =
  | { readonly outcome: "appended"; readonly signal: ReviewSignal }
  /** Same id as a stored signal: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: ReviewSignal };

/** Idempotent-append outcome for evidence edges (append-only facts). */
export type EvidenceEdgeAppendResult =
  | { readonly outcome: "appended"; readonly edge: EvidenceLink }
  /** Same id as a stored edge: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: EvidenceLink };

/** Idempotent-append outcome for offer verifications (immutable read-outs). */
export type OfferVerificationAppendResult =
  | { readonly outcome: "appended"; readonly verification: OfferVerification }
  /** Same id as a stored verification: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: OfferVerification };

/**
 * Per-profile AdvertiserIdentity store: the source-reported identity
 * REFERENCE TARGETS (the 0.8.0 shape). `put` replaces wholesale for the
 * identity's own id (the put-replaces house semantic — a source re-reporting
 * an identity updates it; the import seam's id-stability check keeps an id
 * from silently migrating between sources).
 *
 * ABSENCE IS TYPED, never null: `get` on an id with no stored row rejects
 * with the typed `ads/identity-absent` WebFlixError — the honest pre-import
 * state surfaced with re-import as the recovery, never hidden and never
 * substituted. Listing order is deterministic (stored order then id). The
 * durable implementation is local-library migration 0006 (`ad_identities`,
 * the 0002–0005 rules); the in-memory default serves hermetic tests.
 */
export interface AdvertiserIdentityStore {
  /** Persists (or replaces wholesale) the identity for its id. */
  put(identity: AdvertiserIdentity): Promise<void>;
  /**
   * The stored identity; rejects with the typed `ads/identity-absent` error
   * when none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<AdvertiserIdentity>;
  /** All stored identities, deterministic order. */
  list(): Promise<readonly AdvertiserIdentity[]>;
}

/**
 * Per-profile AdRecord store: one observed ad per row (the 0.8.0 shape —
 * NO ranking signals, NO user data), keyed by the record's own id.
 *
 * `put` replaces wholesale for the same id (the put-replaces house
 * semantic); `delete` removes one row explicitly — together they are the
 * import seam's REPLACE building blocks, and the VERSION DECISION lives in
 * the ads.import use case (never in the store: same source id + same batch
 * = replace; same source id + different batch = a NEW version appended
 * with provenance — never overwrite history silently). `listBySourceAdId`
 * is that decision's read surface: the version history of ONE source-
 * reported ad, deterministic order, honest-empty when the source never
 * reported that ad id. A record with NO sourceAdId carries no matchable
 * source identity — the seam performs NO dedup magic on it.
 *
 * ABSENCE IS TYPED, never null: `get` rejects with the typed
 * `ads/record-absent` WebFlixError. The durable implementation is
 * local-library migration 0006 (`ad_records`); the in-memory default serves
 * hermetic tests.
 */
export interface AdRecordStore {
  /** Persists (or replaces wholesale) the record for its id. */
  put(record: AdRecord): Promise<void>;
  /**
   * The stored record; rejects with the typed `ads/record-absent` error
   * when none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<AdRecord>;
  /** All stored records, deterministic order. */
  list(): Promise<readonly AdRecord[]>;
  /**
   * The version history of one source-reported ad (every stored record the
   * given source reports under the given source ad id), deterministic
   * order; empty when none (honest empty — the pre-import state).
   */
  listBySourceAdId(source: string, sourceAdId: string): Promise<readonly AdRecord[]>;
  /**
   * Deletes one record by id; true when it existed. The import seam's
   * same-batch replace path uses it EXPLICITLY (the superseded row goes
   * only when the seam says so — never a silent cascade: claims of a
   * deleted record stay stored and readable).
   */
  delete(id: string): Promise<boolean>;
}

/**
 * Per-profile Claim store: the EXTRACTIVE claim spans (the 0.8.0 shape —
 * a verbatim quoted span of an ad record's own creative text with its
 * UTF-16 offsets), keyed by the claim's own id.
 *
 * `put` replaces wholesale for the same id (claims are records, not
 * append-only facts: the id is the idempotency key, and the import seam's
 * adRecordId-stability check keeps an id from silently re-pointing at a
 * different record). The EXTRACTIVE discipline itself (offsets within the
 * referenced record's creative text, quote byte-equal to the offset
 * window) is the domain invariant `validateClaimOffsets`, which the
 * ads.import seam runs BEFORE persisting — stores persist claims AS DATA.
 * `listByAdRecordId` is the attachment surface (one record's claims, for
 * the P5-CLAIMS evidence-graph construction over imported records).
 *
 * ABSENCE IS TYPED, never null: `get` rejects with the typed
 * `ads/claim-absent` WebFlixError. The durable implementation is
 * local-library migration 0006 (`ad_claims`); the in-memory default serves
 * hermetic tests.
 */
export interface ClaimStore {
  /** Persists (or replaces wholesale) the claim for its id. */
  put(claim: Claim): Promise<void>;
  /**
   * The stored claim; rejects with the typed `ads/claim-absent` error when
   * none was persisted (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<Claim>;
  /** All stored claims, deterministic order. */
  list(): Promise<readonly Claim[]>;
  /**
   * The claims extracted from ONE ad record, deterministic order; empty
   * when the record has none (honest empty).
   */
  listByAdRecordId(adRecordId: string): Promise<readonly Claim[]>;
}

/**
 * Per-profile EvidenceEdge store: the evidence-graph edges (the 0.8.0
 * EvidenceLink union — a claim linked to a source-reported fact / an
 * independent review / offer terms / a user-imported document, with the
 * relationship and import provenance).
 *
 * APPEND-ONLY by design: `append` is idempotent-by-id (a stored id
 * re-appends as a duplicate returning the STORED edge — never a second
 * row, idempotency surviving restarts); there is no put, no delete, no
 * clearAll — correcting an edge means appending a new edge with a new id
 * (history is the point of an evidence graph). The REFERENTIAL checks (the
 * edge's claim resolves; an independent-review edge's review signal
 * resolves) are the domain invariant `validateEvidenceLinkReferential`,
 * run at the application's boundaries — stores persist edges AS DATA.
 * NOTE: the ads.import seam does NOT import edges this order (the charter's
 * batch is records + identities + claims + optional review signals);
 * P5-CLAIMS constructs evidence graphs on this store.
 *
 * ABSENCE IS TYPED, never null: `get` rejects with the typed
 * `ads/evidence-absent` WebFlixError. The durable implementation is
 * local-library migration 0006 (`ad_evidence_edges`); the in-memory default
 * serves hermetic tests.
 */
export interface EvidenceEdgeStore {
  /** Appends one edge; a stored id re-appends as a duplicate (idempotent). */
  append(edge: EvidenceLink): Promise<EvidenceEdgeAppendResult>;
  /**
   * The stored edge; rejects with the typed `ads/evidence-absent` error
   * when none was appended (never null — absence is typed and surfaced).
   */
  get(id: string): Promise<EvidenceLink>;
  /** All stored edges, deterministic order. */
  list(): Promise<readonly EvidenceLink[]>;
  /**
   * The evidence edges attached to ONE claim, deterministic order; empty
   * when the claim has none (honest empty).
   */
  listByClaim(claimId: string): Promise<readonly EvidenceLink[]>;
}

/**
 * Per-profile ReviewSignal store: the AS-REPORTED independent review
 * signals (the 0.8.0 shape — a review source's own rating/classification
 * vocabulary, verbatim; NO score, NO normalization, NO aggregation
 * anywhere: the store lists what sources report, nothing more).
 *
 * APPEND-ONLY by design: `append` is idempotent-by-id (a stored id
 * re-appends as a duplicate returning the STORED signal); a re-reported
 * signal is a NEW signal with a NEW id. There is no put, no delete, no
 * clearAll.
 *
 * ABSENCE IS TYPED, never null: `get` rejects with the typed
 * `ads/review-signal-absent` WebFlixError. The durable implementation is
 * local-library migration 0006 (`ad_review_signals`); the in-memory default
 * serves hermetic tests.
 */
export interface ReviewSignalStore {
  /** Appends one signal; a stored id re-appends as a duplicate (idempotent). */
  append(signal: ReviewSignal): Promise<ReviewSignalAppendResult>;
  /**
   * The stored signal; rejects with the typed `ads/review-signal-absent`
   * error when none was appended (never null — absence is typed and
   * surfaced).
   */
  get(id: string): Promise<ReviewSignal>;
  /** All stored signals, deterministic order. */
  list(): Promise<readonly ReviewSignal[]>;
}

/**
 * Per-profile OfferVerification store: the ads.verify engine's read-outs
 * (the 0.8.0 shape — WHAT was checked via `claimId`, against WHICH
 * declared sources via `declaredSources`, WHEN via `checkedAt`, the TYPED
 * `outcome`; the state-machine legality is the domain invariant
 * `validateOfferVerificationState`, which ads.verify runs over every
 * record BEFORE appending — stores persist verifications AS DATA).
 *
 * APPEND-ONLY BY VERIFICATION ID, by design: an OfferVerification is an
 * IMMUTABLE read-out of one check instant (the domain transition rule
 * allows only unchecked -> checked within a record, and a re-verification
 * is a NEW record with its own id), so `append` is idempotent-by-id (a
 * stored id re-appends as a duplicate returning the STORED record — never
 * a second row, idempotency surviving restarts); there is no put, no
 * delete, no clearAll. `listByClaim` is the attachment surface (one
 * claim's verification history, for the reading path).
 *
 * ABSENCE IS TYPED, never null: `get` rejects with the typed
 * `ads/verification-absent` WebFlixError (the 0.10.0 code). The durable
 * implementation is local-library migration 0007
 * (`ad_offer_verifications`); the in-memory default serves hermetic tests.
 */
export interface OfferVerificationStore {
  /** Appends one verification; a stored id re-appends as a duplicate. */
  append(verification: OfferVerification): Promise<OfferVerificationAppendResult>;
  /**
   * The stored verification; rejects with the typed
   * `ads/verification-absent` error when none was appended (never null —
   * absence is typed and surfaced).
   */
  get(id: string): Promise<OfferVerification>;
  /** All stored verifications, deterministic order. */
  list(): Promise<readonly OfferVerification[]>;
  /**
   * The verification history of ONE claim, deterministic order; empty when
   * the claim has none (honest empty — the not-yet-verified state).
   */
  listByClaim(claimId: string): Promise<readonly OfferVerification[]>;
}

// ---------------------------------------------------------------------------
// AdsClaimExtractor — the deterministic EXTRACTIVE engine seam (P5-CLAIMS)
// ---------------------------------------------------------------------------

/**
 * The claim-extraction engine seam (P5-CLAIMS): a PURE, DETERMINISTIC,
 * pattern-based extractor over ONE ad record's creative text — no I/O, no
 * clock, no randomness, no LLM, no network. The same record produces the
 * BYTE-IDENTICAL claim set on every run, forever.
 *
 * The contract, stated as binding rules for every implementation:
 * - EXTRACTIVE ONLY: every returned Claim's `quote` is the verbatim
 *   `creativeText.slice(startOffset, endOffset)` of the record it was
 *   extracted from (the P5-CONTRACTS discipline; the use case re-validates
 *   through the domain invariant `validateClaimOffsets` before persisting —
 *   a claim the source did not state is a defect).
 * - HONEST EMPTY: a record whose text matches no pattern (or carries no
 *   creative text) yields an empty list — never a forced claim.
 * - ID DISCIPLINE: the minted claim ids are a deterministic function of
 *   the extractor's own `id` + `version` + the matched span, so the same
 *   version + the same record re-produces the same ids (the claim store's
 *   put-replaces semantics then make re-runs idempotent) while a DIFFERENT
 *   version mints different ids (a new provenance append — prior claims
 *   are never silently overwritten). The extractor's identity/version
 *   rides the minted ids and the §2.6 job provenance (the Claim shape
 *   itself carries no provenance fields — 0.9.0).
 *
 * The real implementation is the documented fixed-pattern engine
 * (`./ads-claim-extractor.ts`, the built-in-summary-engine house style);
 * the labeled test double is `./fixture-replay-ads-claim-extractor.ts`.
 */
export interface AdsClaimExtractor {
  /** The extractor's identity (rides the minted claim ids + job provenance). */
  readonly id: string;
  /** The extractor's version (same version + same record = idempotent replace). */
  readonly version: string;
  /**
   * Extracts the claim spans of ONE ad record's creative text. Pure and
   * synchronous — cancellation is the USE CASE's concern (cooperative
   * checkpoints between records, §2.6), never the extractor's.
   */
  extract(record: AdRecord): readonly Claim[];
}

// ---------------------------------------------------------------------------
// Federated search (Phase 7, P7-SEARCH-1 — WF-009)
// ---------------------------------------------------------------------------

/**
 * Identity of one federated-search source adapter: `source` is the id of
 * the SOURCE it serves (the registry id space, e.g. `fixture-youtube-like`
 * this order); `version` is the WebFlix ADAPTER's own version (OUR code's
 * — always known, unlike the external service's facts).
 */
export interface SearchSourceDescriptor {
  /** The source id this adapter serves (the registry key). */
  readonly source: string;
  /** The WebFlix adapter implementation's version (our code's). */
  readonly version: string;
}

/** Per-call adapter options: cooperative cancellation at the boundary. */
export interface SearchSourceOptions {
  /** Checked at the adapter boundary; an already-aborted call rejects with the typed `common/cancelled` error. */
  readonly signal?: AbortSignal;
}

/**
 * The federated-search source seam (INTERFACE ONLY, the
 * TransparencySourcePort pattern). Contract rules for every
 * implementation, binding as the transparency seam's:
 * - HONEST STATES, RETURNED AS DATA: `search` on an unsupported,
 *   auth-gated, over-budget or partially failed source RESOLVES with
 *   that typed state in its SearchOutcome (the honest reason naming the
 *   authorization path where applicable) — never a thrown access error,
 *   never a silent empty result, never fabricated items;
 * - NO NETWORK this order: the only implementations that exist are the
 *   LABELED fixtures (./fixture-search-sources); real transport for a
 *   sanctioned source is a later order's adapter, behind this same port;
 * - CANCELLATION: `signal` is honoured at the boundary — an
 *   already-aborted call rejects with the typed `common/cancelled` error
 *   and produces no outcome;
 * - SOURCE-REPORTED ONLY: an ok/partial-failure outcome's items carry
 *   only what the source itself reported; facts the source did not
 *   report stay absent — never guessed, never defaulted.
 */
export interface SearchSourcePort {
  /** The adapter's identity: which source it serves + our adapter code's version. */
  readonly descriptor: SearchSourceDescriptor;
  /**
   * Searches the source. Resolves with the typed honest state (the
   * timeout/auth-required/unsupported/partial-failure states are DATA);
   * rejects with the typed `common/cancelled` error when the call was
   * aborted at the boundary.
   */
  search(request: SearchRequest, options?: SearchSourceOptions): Promise<SearchOutcome>;
}
