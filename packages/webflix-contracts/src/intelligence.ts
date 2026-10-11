/**
 * Media-intelligence contract shapes (Phase 4 opener, P4-CONTRACTS).
 *
 * ADDITIVE module: the frozen §2.1–2.6 shapes (contract-freeze.md §2) are
 * untouched; everything here is new surface added under the §3 method
 * (semver minor bump + changelog entry + consumer-impact note). Sources:
 * docs/plans/phase4-mi-plan.md §1–§8 (binding constraints),
 * docs/plans/desktop-roadmap.md Phase 4, docs/adr/0003 (per-user scope),
 * docs/plans/contract-freeze.md §2.1/§2.2/§2.4/§2.6 (reused frozen shapes
 * below are imported verbatim — never mirrored).
 */
import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";
import type { IsoDateTime } from "./internal/primitives";
import type { CatalogItem } from "./catalog";
import type { WatchedState } from "./library";

// ---------------------------------------------------------------------------
// UserObjective — explicit, inspectable, editable; NEVER inferred
// (phase4-mi-plan §8)
// ---------------------------------------------------------------------------

/**
 * Time-budget constraints. Absent fields mean "no constraint" — there are no
 * silent defaults beyond the documented empty objective (all fields absent
 * or empty). Budgets are positive integers in minutes; zero or negative
 * values are rejected (a user who wants no budget simply leaves it unset).
 */
export const TimeBudgetsSchema = z.object({
  /** Longest single session the user wants, in minutes. */
  perSessionMinutes: z.number().int().min(1).optional(),
  /** Total watch time per week the user wants, in minutes. */
  weeklyMinutes: z.number().int().min(1).optional(),
});
export type TimeBudgets = z.infer<typeof TimeBudgetsSchema>;

/**
 * The user's explicit, inspectable, editable goals. Set only through the
 * set-objectives use case (a user action recorded with `declaredAt`); never
 * inferred from behaviour, never silently defaulted (phase4-mi-plan §8).
 */
export const UserObjectiveSchema = z.object({
  /** Topics the user wants more of; freeform terms, matched deterministically by the ranker. */
  topicFocuses: z.array(z.string().min(1)).default([]),
  /** Topics the user wants kept OUT of recommendations. */
  exclusions: z.array(z.string().min(1)).default([]),
  timeBudgets: TimeBudgetsSchema.default({}),
  /** When the user set this objective (explicit provenance, never inferred). */
  declaredAt: IsoDateTimeSchema,
});
export type UserObjective = z.infer<typeof UserObjectiveSchema>;

// ---------------------------------------------------------------------------
// FeedbackEvent — explicit + implicit, with provenance, idempotent-append
// (phase4-mi-plan §4; ranking signal only — never training data)
// ---------------------------------------------------------------------------

/** Which surface captured the event, plus when — the provenance record. */
export const FeedbackProvenanceSchema = z.object({
  /** Capturing surface, e.g. `recommendation-card`, `watch-screen`. */
  surface: z.string().min(1),
  capturedAt: IsoDateTimeSchema,
});
export type FeedbackProvenance = z.infer<typeof FeedbackProvenanceSchema>;

/** Explicit user actions (phase4-mi-plan §4; the work-order kind list). */
export const ExplicitFeedbackKindSchema = z.enum([
  "thumbs-up",
  "thumbs-down",
  "pin",
  "not-interested",
]);
export type ExplicitFeedbackKind = z.infer<typeof ExplicitFeedbackKindSchema>;

/** Implicit signals captured by a surface, with their numeric payload. */
export const ImplicitFeedbackKindSchema = z.enum(["watched-fraction", "skipped-at"]);
export type ImplicitFeedbackKind = z.infer<typeof ImplicitFeedbackKindSchema>;

const ExplicitFeedbackSchema = z.object({
  id: z.string().min(1),
  /** §2.1 catalog item the event is about. */
  itemId: z.string().min(1),
  channel: z.literal("explicit"),
  kind: ExplicitFeedbackKindSchema,
  provenance: FeedbackProvenanceSchema,
});

const ImplicitFeedbackSchema = z
  .object({
    id: z.string().min(1),
    itemId: z.string().min(1),
    channel: z.literal("implicit"),
    kind: ImplicitFeedbackKindSchema,
    /** watched-fraction: 0..1; skipped-at: seconds into the item. */
    value: z.number(),
    provenance: FeedbackProvenanceSchema,
  })
  .superRefine((event, ctx) => {
    if (event.kind === "watched-fraction" && (event.value < 0 || event.value > 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `watched-fraction value must be within 0..1, got ${event.value}`,
      });
    }
    if (event.kind === "skipped-at" && (!Number.isInteger(event.value) || event.value < 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `skipped-at value must be a non-negative integer of seconds, got ${event.value}`,
      });
    }
  });

/**
 * One feedback event. Explicit events carry a user action; implicit events
 * carry a numeric payload. `id` is the idempotency key for appends: surfaces
 * mint one id per user action and reuse it on retries, so the same id can
 * never append twice (conflicts are a typed integrity error upstream).
 */
export const FeedbackEventSchema = z.discriminatedUnion("channel", [
  ExplicitFeedbackSchema,
  ImplicitFeedbackSchema,
]);
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

// ---------------------------------------------------------------------------
// LibraryFact — the local-library signal, projected onto a catalog item
// ---------------------------------------------------------------------------

/**
 * The local-library facts relevant to ranking, keyed by the §2.1 catalog
 * item id. This is a PROJECTION, not a mirror of the frozen §2.4
 * LocalLibraryEntry: it drops path/fingerprint/mimeType/size (irrelevant to
 * ranking) and re-keys by catalog item id. The composition root builds it
 * from LocalLibraryEntry via the catalog match; this order defines the
 * shape, the pure rules and the port, with tests supplying fixtures
 * directly (the bridge lands with the composition root in a later order).
 */
export const LibraryFactSchema = z.object({
  /** §2.1 catalog item id this library entry matches. */
  itemId: z.string().min(1),
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  /** Known media duration in ms (from library metadata; optional — unknown stays unknown). */
  durationMs: z.number().int().min(0).optional(),
  addedAt: IsoDateTimeSchema.optional(),
});
export type LibraryFact = z.infer<typeof LibraryFactSchema>;

// ---------------------------------------------------------------------------
// RankingPolicy — deterministic, versioned (same inputs + same policy
// version => byte-for-byte same output)
// ---------------------------------------------------------------------------

/** Signal families the built-in policy ranks on (work-order charter row 4). */
export const RankingSignalFamilySchema = z.enum([
  "library-affinity",
  "watch-history",
  "explicit-feedback",
  "objective-match",
]);
export type RankingSignalFamily = z.infer<typeof RankingSignalFamilySchema>;

/** Weights over signal families. Each version pins ONE canonical table. */
export const RankingWeightsSchema = z.object({
  libraryAffinity: z.number().min(0).max(1),
  watchHistory: z.number().min(0).max(1),
  explicitFeedback: z.number().min(0).max(1),
  objectiveMatch: z.number().min(0).max(1),
});
export type RankingWeights = z.infer<typeof RankingWeightsSchema>;

/**
 * The canonical v1 weight table. Weights are a FUNCTION OF THE POLICY
 * VERSION (that is what makes "same inputs + same policy version =>
 * byte-for-byte same output" hold): a v1 policy always ranks with exactly
 * these weights, and the domain layer rejects anything else for v1.
 * Rationale (documented, versioned with the policy):
 * - watch-history 0.30 — recent local behaviour is the strongest local
 *   predictor (internal 50/50 split between recency and fraction);
 * - explicit-feedback 0.30 — explicit user judgements outweigh implicit
 *   ones by policy (a pin saturates the family at 0.8, an up at 0.6;
 *   once pinned, further ups add nothing — a pin is already the strongest
 *   explicit expression);
 * - library-affinity 0.25 — what the user keeps says the most about stable
 *   taste (in-library 0.6 + title/tag similarity 0.4, saturating at three
 *   supporting items);
 * - objective-match 0.15 — objectives steer, they never dominate (focus
 *   hits saturate at two; a per-session time budget contributes only when
 *   the candidate's duration is known and fits).
 * Sum = 1.0. No ML, no randomness, no network anywhere in the ranker.
 */
export const RANKING_POLICY_V1_WEIGHTS: RankingWeights = {
  libraryAffinity: 0.25,
  watchHistory: 0.3,
  explicitFeedback: 0.3,
  objectiveMatch: 0.15,
};

/** Policy versions known to this contract. Closed for now; v2+ is added additively with its own canonical table. */
export const RankingPolicyVersionSchema = z.enum(["v1"]);
export type RankingPolicyVersion = z.infer<typeof RankingPolicyVersionSchema>;

/**
 * The deterministic, versioned policy descriptor. The version alone pins the
 * entire ranking semantics: signal families, weights, tie-breaks and output
 * serialization. `ranker` implementations resolve the weights for a version
 * through the domain layer (unknown versions are a typed error there).
 */
export const RankingPolicySchema = z.object({
  version: RankingPolicyVersionSchema,
});
export type RankingPolicy = z.infer<typeof RankingPolicySchema>;

// ---------------------------------------------------------------------------
// RankedItem — a recommendation; reasons are MANDATORY (mi-plan §4)
// ---------------------------------------------------------------------------

/** A non-empty array: `[head, ...rest]`. Type-level floor of 1 element. */
export type NonEmptyArray<T> = [T, ...T[]];

/** Pointer to the concrete signal that produced a reason. */
export const EvidencePointerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("feedback-event"), eventId: z.string().min(1) }),
  z.object({
    kind: z.literal("objective"),
    field: z.enum([
      "topicFocuses",
      "exclusions",
      "timeBudgets.perSessionMinutes",
      "timeBudgets.weeklyMinutes",
    ]),
  }),
  z.object({ kind: z.literal("library-fact"), itemId: z.string().min(1) }),
  z.object({ kind: z.literal("watched-state"), itemId: z.string().min(1) }),
]);
export type EvidencePointer = z.infer<typeof EvidencePointerSchema>;

/**
 * Why the item ranked: human-readable text PLUS evidence pointers to the
 * concrete signals (which feedback event, which objective field, which
 * library fact, which watched state) and this reason's weighted
 * contribution to the item score (4-decimal precision).
 */
export const RankingReasonSchema = z.object({
  family: RankingSignalFamilySchema,
  text: z.string().min(1),
  contribution: z.number().min(0).max(1),
  evidence: z.array(EvidencePointerSchema).min(1),
});
export type RankingReason = z.infer<typeof RankingReasonSchema>;

const RankedItemDataSchema = z.object({
  itemId: z.string().min(1),
  /** 0..1, quantized to 4 decimals by the ranker. */
  score: z.number().min(0).max(1),
  reasons: z.array(RankingReasonSchema).min(1),
});

/**
 * One ranked item (a single recommendation): a §2.1 catalog item ref, a
 * score, and at least one reason. A reasonless recommendation is a contract
 * violation (phase4-mi-plan §4) — enforced at the type level
 * (`NonEmptyArray`), at the schema level (`.min(1)`) and at the domain
 * runtime guard (`assertReasonedRanking`).
 */
export type RankedItem = {
  readonly itemId: string;
  readonly score: number;
  readonly reasons: NonEmptyArray<RankingReason>;
};

/** Why a ranking came back empty — honest, never fabricated. */
export const RankingEmptyReasonSchema = z.enum([
  "empty-catalog",
  "no-local-signals",
  "no-ranked-candidates",
]);
export type RankingEmptyReason = z.infer<typeof RankingEmptyReasonSchema>;

/**
 * The pure output of a ranker run: either a non-empty ranked list or an
 * honest empty state. Carries NO timestamps — byte-for-byte determinism
 * is over the whole result (job metadata lives in the §2.6 wrapper, never
 * in the ranked payload).
 */
export const RankingResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ranked"),
    policyVersion: RankingPolicyVersionSchema,
    items: z.array(RankedItemDataSchema).min(1),
  }),
  z.object({
    kind: z.literal("empty"),
    policyVersion: RankingPolicyVersionSchema,
    reason: RankingEmptyReasonSchema,
  }),
]);
export type RankingResult = z.infer<typeof RankingResultSchema>;

// ---------------------------------------------------------------------------
// RankerPort — the user-selected adapter interface (mi-plan §6)
// ---------------------------------------------------------------------------

/**
 * Everything a ranker needs. LOCAL SIGNALS ONLY (phase4-mi-plan §5): the
 * catalog snapshot, the library facts, the WebFlix-owned §2.4 watch states,
 * the feedback history and the user's objectives. No provider API reads, no
 * scraping, no network — ever.
 */
export interface RankerInput {
  /** §2.1 catalog snapshot — the rankable universe (frozen shape, reused). */
  readonly catalog: readonly CatalogItem[];
  /** Local-library facts projected onto catalog item ids. */
  readonly library: readonly LibraryFact[];
  /** §2.4 watch states, reused verbatim (never a mirror). */
  readonly watchHistory: readonly WatchedState[];
  readonly feedback: readonly FeedbackEvent[];
  /** null = no objective set (distinct from the documented empty objective). */
  readonly objectives: UserObjective | null;
  readonly policy: RankingPolicy;
  /**
   * The reference instant for recency signals. An explicit input, so the
   * same inputs (including asOf) always produce the same output
   * byte-for-byte; the application job wrapper stamps it from the job's
   * start time.
   */
  readonly asOf: IsoDateTime;
}

/**
 * The user-selected ranker adapter seam (INTERFACE ONLY, like CredentialPort
 * in §2.5). The default implementation is the built-in DETERMINISTIC ranker
 * (RankingPolicy v1: policy/weights resolution + runtime guards in
 * webflix-domain, the engine homed in webflix-application's use-case layer —
 * the P4-ARTIFACTS arbitration kept it there deliberately). Contract rules
 * for every implementation: PURE (no side effects), LOCAL (no network, no
 * provider reads, no scraping), NO hidden LLM, reasons mandatory on every
 * item. Implementations are validated by the domain runtime guard
 * `assertReasonedRanking` and the determinism corpus tests.
 */
export interface RankerPort {
  rank(input: RankerInput): RankingResult;
}

// ---------------------------------------------------------------------------
// RankerAdapterSelection — the user's explicit, persistent adapter choice
// (P4-ADAPTERS; phase4-mi-plan §6: user-selected adapters, never a hidden
// default)
// ---------------------------------------------------------------------------

/**
 * The per-profile ranker-adapter selection record. `adapterId` MUST be an
 * id the active registry knows (validated by the application use case at
 * set time; registry drift at resolve time is a documented fail-soft with
 * this record's invalidity surfaced); `selectedAt` is the explicit
 * provenance instant of the user action — never inferred. null / absence of
 * a stored selection is DISTINCT from selecting the built-in: it means "no
 * selection set", and the documented default (the built-in deterministic
 * ranker) is then active and stated as such by the resolving use case.
 */
export const RankerAdapterSelectionSchema = z.object({
  /** Registry-known adapter id (e.g. `webflix.built-in-ranker`). */
  adapterId: z.string().min(1),
  /** When the user made this choice (explicit provenance). */
  selectedAt: IsoDateTimeSchema,
});
export type RankerAdapterSelection = z.infer<typeof RankerAdapterSelectionSchema>;

// ---------------------------------------------------------------------------
// DerivedArtifact — original/derived separation is structural
// (phase4-mi-plan §3)
// ---------------------------------------------------------------------------

/** Closed kind enum: the Phase-4 derived-artifact kinds (roadmap). */
export const DerivedArtifactKindSchema = z.enum([
  "transcript",
  "summary",
  "overview",
  "translation",
  "dubbing",
  "qa",
]);
export type DerivedArtifactKind = z.infer<typeof DerivedArtifactKindSchema>;

/** Model/provenance lineage — every derived artifact stays auditable to its model run. */
export const ArtifactLineageSchema = z.object({
  modelId: z.string().min(1),
  modelVersion: z.string().min(1),
  /** Adapter that ran the model (P4-ADAPTERS supplies real ids). */
  producedBy: z.string().min(1),
  generatedAt: IsoDateTimeSchema,
  /** Hash of the inputs the artifact was derived from, when known. */
  inputsHash: z.string().min(1).optional(),
});
export type ArtifactLineage = z.infer<typeof ArtifactLineageSchema>;

/**
 * Descriptor for a derived artifact (a NEW object — never a mutation of its
 * original). `sourceItemId` MUST reference an existing §2.1 catalog item;
 * that check is a domain invariant (`validateDerivedArtifactLineage`).
 * Separation is structural: descriptors live in their own registry port,
 * and no operation in this module writes into a catalog item. Persistence
 * is deferred (P4-ARTIFACTS) — this order ships the shapes, the lineage
 * rules and in-memory bookkeeping.
 */
export const DerivedArtifactSchema = z.object({
  id: z.string().min(1),
  /** §2.1 catalog item id of the ORIGINAL this artifact was derived from. */
  sourceItemId: z.string().min(1),
  kind: DerivedArtifactKindSchema,
  lineage: ArtifactLineageSchema,
  /** License note for the derived output (e.g. model-license constraints); null when none applies. */
  licenseNote: z.string().min(1).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type DerivedArtifact = z.infer<typeof DerivedArtifactSchema>;

// ---------------------------------------------------------------------------
// Transcription — the LOCAL-engine seam (P4-TRANSCRIBE; phase4-mi-plan §7:
// whisper.cpp-class engines verified license-clean, XTTS/NLLB excluded)
//
// ADDITIVE §3 surface (0.3.0 -> 0.4.0): the engine port, the request /
// segment / result schemas and the progress/options types the port needs.
// Honest-lineage rules baked into the shapes: every engine-reported field
// (`engineVersion`, `modelLineage`, `language`) is OPTIONAL — an engine that
// does not volunteer the fact in its own output leaves it ABSENT, and absent
// means absent, never a guessed value.
// ---------------------------------------------------------------------------

/**
 * Identity of one transcription engine adapter. `id`/`label`/`version` are
 * the WebFlix ADAPTER's own identity (our code — always known); the optional
 * `engineVersion`/`modelLineage` are facts read from the EXTERNAL engine's
 * own output when it reports them, absent when it does not (never guessed);
 * `licenseNote` carries the engine's license class (whisper.cpp-class =
 * MIT-family, verified in docs/plans/audits/AUDIT-SOURCES.md §6), null when
 * none applies.
 */
export const TranscriptionEngineDescriptorSchema = z.object({
  /** Stable dot-namespaced adapter id (e.g. `webflix.whisper-cpp-local`). */
  id: z.string().trim().min(1),
  /** Human label, rendered verbatim by later UI orders. */
  label: z.string().trim().min(1),
  /** The WebFlix adapter implementation's version (OUR code's version — always known, unlike the external binary's). */
  version: z.string().trim().min(1),
  /** The external engine binary's own version string, READ FROM THE BINARY'S OWN OUTPUT; absent when it reports none — never guessed. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from the engine's own output (e.g. the loaded ggml model name); absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
  /** License note for this engine class; null when none applies. */
  licenseNote: z.string().trim().min(1).nullable(),
});
export type TranscriptionEngineDescriptor = z.infer<typeof TranscriptionEngineDescriptorSchema>;

/**
 * What to transcribe: a LOCAL media file path plus an optional language
 * hint. The path is handed to the engine adapter UNTOUCHED — audio decoding,
 * demux and probing are ENGINE-INTERNAL concerns (mi-plan §7); no
 * WebFlix-layer code in the transcription pipeline reads media bytes. The
 * language hint (an engine-interpreted code, e.g. an ISO 639 tag) is
 * OPTIONAL and engines that do not support hints ignore it (documented per
 * implementation, never silently assumed to have applied).
 */
export const TranscriptionRequestSchema = z.object({
  /** Absolute or adapter-resolvable path to the local media file. */
  mediaPath: z.string().trim().min(1),
  /** Optional language hint (engine-interpreted, e.g. "en"); absent = no hint. */
  language: z.string().trim().min(1).optional(),
});
export type TranscriptionRequest = z.infer<typeof TranscriptionRequestSchema>;

/**
 * One transcript segment: a half-open [startMs, endMs) time range plus its
 * non-empty text. Timestamps are integer milliseconds from the media start.
 */
export const TranscriptSegmentSchema = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    text: z.string().trim().min(1),
  })
  .superRefine((segment, ctx) => {
    if (segment.endMs < segment.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `segment endMs must be >= startMs, got [${segment.startMs}, ${segment.endMs}]`,
      });
    }
  });
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/**
 * The engine's output for one run. `segments` MAY be empty — that is the
 * honest "engine reported no speech" outcome, never an error. The optional
 * facts (`language`, `engineVersion`, `modelLineage`) are read from the
 * ENGINE'S OWN OUTPUT for THIS run; each stays absent when the engine did
 * not report it — never inferred from the request, never guessed.
 */
export const TranscriptionResultSchema = z.object({
  segments: z.array(TranscriptSegmentSchema),
  /** Language the engine itself reported for this run (detected or echoed); absent when unreported. */
  language: z.string().trim().min(1).optional(),
  /** Engine binary version read from this run's own output; absent when unreported. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from this run's own output (e.g. loaded model name); absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
});
export type TranscriptionResult = z.infer<typeof TranscriptionResultSchema>;

/**
 * Progress an engine surfaces between segments. `totalSegments` is present
 * only when the engine HONESTLY knows it up front (a fixture/replay engine
 * does; a streaming ASR engine does not — absent, never estimated).
 */
export interface TranscriptionProgress {
  /** Segments completed so far (monotone non-decreasing). */
  readonly completedSegments: number;
  /** Total segment count when genuinely known up front; absent otherwise. */
  readonly totalSegments?: number;
  /** endMs of the most recently completed segment; absent before the first. */
  readonly lastEndMs?: number;
}

/** Per-run engine options: cooperative cancellation + progress surfacing. */
export interface TranscriptionOptions {
  /** Honoured at the engine boundary AND cooperatively between segments. */
  readonly signal?: AbortSignal;
  /**
   * Called after each completed segment. Implementations treat a THROWN
   * callback as a cooperative stop request (the mi.transcribe use case
   * throws here when its signal aborted) and MUST stop and reject with the
   * typed cancelled error rather than swallow it.
   */
  readonly onProgress?: (progress: TranscriptionProgress) => void;
}

/**
 * The LOCAL transcription-engine seam (INTERFACE ONLY, like RankerPort).
 * Contract rules for every implementation, stated as binding as the ranker's:
 * - LOCAL ONLY: the adapter shells out to a binary on THIS machine (or
 *   replays fixtures in the labeled test double); NO network, NO model
 *   downloads, NO provider reads — ever;
 * - HONEST AVAILABILITY: an implementation whose engine is absent from the
 *   machine REJECTS with the typed `intelligence/engine-unavailable` error
 *   (surfaced with a recovery hint, never hidden, never a silent empty
 *   result);
 * - COOPERATIVE CANCELLATION: `signal` is checked at entry and between
 *   segments; a cancelled run rejects with the typed `common/cancelled`
 *   error and produces NO result;
 * - HONEST LINEAGE: `engineVersion`/`modelLineage`/`language` values are
 *   read from the engine's OWN output; facts the engine did not report
 *   stay absent — never guessed, never defaulted.
 */
export interface TranscriptionEnginePort {
  /** The adapter's identity + honest lineage + license note. */
  readonly descriptor: TranscriptionEngineDescriptor;
  /**
   * Transcribes one local media file. Rejects with the typed
   * engine-unavailable error when the engine is absent, the typed cancelled
   * error when the run was cancelled (at the boundary or between segments),
   * or a typed engine-failed error when the engine ran and itself reported
   * failure.
   */
  transcribe(
    request: TranscriptionRequest,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionResult>;
}
