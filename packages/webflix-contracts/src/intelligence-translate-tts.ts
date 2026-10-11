/**
 * The translation + TTS engine seams — the §2.7 intelligence module's
 * ADDITIVE continuation for P4-TRANSLATE (0.5.0 -> 0.6.0), split into its
 * own sibling module when the parent (intelligence.ts) reached the
 * repo's 400-effective-line max-lines limit. Same entrypoint, same
 * exports: index.ts re-exports this module beside intelligence.ts, so the
 * public surface is byte-identical to a single-file section (consumers
 * import contracts ONLY from the package entrypoint — the auditability
 * rule). Frozen §2.1–2.6 module files untouched; the DerivedArtifact kind
 * enum stays CLOSED at six kinds.
 *
 * Every honesty rule in this module is stated where it is enforced; the
 * section below is verbatim the additive section the order's charter
 * specified.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Translation + TTS — the local engine seams (P4-TRANSLATE; phase4-mi-plan
// row 6: Argos-class translation and Piper-class TTS over stored text
// payloads, phase4-mi-plan §7: both engine families verified license-clean
// and binding — engines under non-commercial licenses are excluded from
// this seam entirely and must never appear in any src).
//
// ADDITIVE §3 surface (0.5.0 -> 0.6.0): two interface-only engine ports
// (the TranscriptionEnginePort shape — one method each), their descriptor /
// request / result schemas and the progress/options types the ports need.
// Frozen §2.1–2.6 module files untouched; this section appends only.
//
// AUDIO-AS-RENDITION, binding on the TTS side: synthesized audio is NOT a
// derived artifact (the kind enum stays CLOSED at six kinds — this order
// adds none). Audio attaches to its SOURCE artifact as a payload RENDITION
// carrying its own lineage (engine, voice, inputsHash) in a rendition
// store; the source artifact descriptor is never mutated. The
// TtsResultSchema's `audio` bytes are what the rendition store persists.
// ---------------------------------------------------------------------------

/**
 * Identity of one translation engine adapter — the same honesty rules as
 * the transcription descriptor: `id`/`label`/`version` are the WebFlix
 * ADAPTER's own identity (our code — always known); the optional
 * `engineVersion`/`modelLineage` are facts read from the EXTERNAL engine's
 * own output when it reports them, absent when it does not (never guessed);
 * `licenseNote` carries the engine family's license class (Argos-class =
 * MIT-family verified in docs/plans/audits/AUDIT-SOURCES.md §6), null when
 * none applies.
 */
export const TranslationEngineDescriptorSchema = z.object({
  /** Stable dot-namespaced adapter id (e.g. `webflix.argos-local-translation`). */
  id: z.string().trim().min(1),
  /** Human label, rendered verbatim by later UI orders. */
  label: z.string().trim().min(1),
  /** The WebFlix adapter implementation's version (OUR code's — always known, unlike the external binary's). */
  version: z.string().trim().min(1),
  /** The external engine binary's own version string, READ FROM THE BINARY'S OWN OUTPUT; absent when it reports none — never guessed. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from the engine's own output; absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
  /** License note for this engine family; null when none applies. */
  licenseNote: z.string().trim().min(1).nullable(),
});
export type TranslationEngineDescriptor = z.infer<typeof TranslationEngineDescriptorSchema>;

/**
 * What to translate: the source text (already resolved by the calling use
 * case from a STORED text payload — engines are pure over text and never
 * touch storage) plus the source and target language tags. Language tags
 * are ENGINE-INTERPRETED codes (e.g. ISO 639 tags like "en"/"es" for
 * Argos-class CLIs) — non-blank strings the engine maps through its own
 * language table; WebFlix never validates them beyond shape (the
 * TranscriptionRequest.language precedent: an unsupported tag is the
 * ENGINE'S failure to report, never ours to guess).
 */
export const TranslationRequestSchema = z.object({
  /** The source text, resolved from a stored text payload by the use case. */
  text: z.string().min(1),
  /** The source language tag (engine-interpreted, e.g. "en"). */
  sourceLanguageTag: z.string().trim().min(1),
  /** The target language tag (engine-interpreted, e.g. "es"). */
  targetLanguageTag: z.string().trim().min(1),
});
/** Readonly view over the schema (the SummaryRequest precedent). */
export type TranslationRequest = {
  readonly text: string;
  readonly sourceLanguageTag: string;
  readonly targetLanguageTag: string;
};

/**
 * The engine's output for one run. `translatedText` is the engine's own
 * translation, non-empty (an engine that produces no translation text is a
 * FAILED run — the adapter maps that to the typed engine-failed error,
 * never an empty success). The optional lineage facts are read from the
 * ENGINE'S OWN OUTPUT for THIS run; each stays absent when the engine did
 * not report it — never inferred from the request, never guessed.
 */
export const TranslationResultSchema = z.object({
  /** The translated text, exactly as the engine printed it. */
  translatedText: z.string().min(1),
  /** Engine binary version read from this run's own output; absent when unreported. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from this run's own output; absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;

/**
 * Identity of one TTS engine adapter — the same honesty rules as every
 * other engine descriptor: `id`/`label`/`version` are the WebFlix adapter's
 * own identity (always known); the optional `engineVersion`/`modelLineage`
 * are facts read from the EXTERNAL engine's own output when it reports
 * them, absent when it does not (never guessed); `licenseNote` carries the
 * engine family's license class (Piper-class = MIT-family verified in
 * docs/plans/audits/AUDIT-SOURCES.md §6), null when none applies.
 */
export const TtsEngineDescriptorSchema = z.object({
  /** Stable dot-namespaced adapter id (e.g. `webflix.piper-local-tts`). */
  id: z.string().trim().min(1),
  /** Human label, rendered verbatim by later UI orders. */
  label: z.string().trim().min(1),
  /** The WebFlix adapter implementation's version (OUR code's — always known). */
  version: z.string().trim().min(1),
  /** The external engine binary's own version string, READ FROM THE BINARY'S OWN OUTPUT; absent when it reports none — never guessed. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from the engine's own output; absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
  /** License note for this engine family; null when none applies. */
  licenseNote: z.string().trim().min(1).nullable(),
});
export type TtsEngineDescriptor = z.infer<typeof TtsEngineDescriptorSchema>;

/**
 * What to synthesize: the text (resolved from a stored text payload by the
 * calling use case — engines never touch storage) plus the VOICE identity.
 * A voice is an engine-resolved model identity (e.g. a Piper voice name
 * like "en_US-amy-medium" mapped to its .onnx model file); the tag is
 * non-blank and the ENGINE resolves it against its own discovered voices —
 * an unknown voice is the honest engine-unavailable state (surfaced with
 * the recovery hint), never our guess.
 */
export const TtsRequestSchema = z.object({
  /** The text to synthesize, resolved from a stored text payload by the use case. */
  text: z.string().min(1),
  /** The voice identity the engine resolves against its discovered voices. */
  voice: z.object({
    id: z.string().trim().min(1),
  }),
});
/** Readonly view over the schema (the SummaryRequest precedent). */
export type TtsRequest = {
  readonly text: string;
  readonly voice: { readonly id: string };
};

/**
 * The engine's output for one run: the synthesized AUDIO bytes plus the
 * content type the engine itself produced (e.g. "audio/wav" for a
 * Piper-class CLI writing a WAV file) — the rendition store persists both,
 * and the optional lineage facts stay absent when the engine did not
 * report them (never guessed).
 */
export const TtsResultSchema = z.object({
  /** The synthesized audio bytes, exactly as the engine wrote them out. */
  audio: z.instanceof(Uint8Array),
  /** The audio's content type (engine-produced, e.g. "audio/wav"). */
  contentType: z.string().trim().min(1),
  /** Engine binary version read from this run's own output; absent when unreported. */
  engineVersion: z.string().trim().min(1).optional(),
  /** Model lineage read from this run's own output (e.g. the loaded voice model); absent when unreported. */
  modelLineage: z.string().trim().min(1).optional(),
});
export type TtsResult = z.infer<typeof TtsResultSchema>;

/**
 * Progress a translation engine surfaces between work units. Spawn-based
 * CLI engines have a single work unit (the run), so the honest totals are
 * 1/1 after exit; a fixture double replays canned unit counts. The shape
 * mirrors TranscriptionProgress/SummaryEngineProgress deliberately.
 */
export interface TranslationEngineProgress {
  /** Work units completed so far (monotone non-decreasing). */
  readonly completedUnits: number;
  /** Total units when genuinely known up front; absent otherwise. */
  readonly totalUnits?: number;
}

/** Per-run engine options: cooperative cancellation + progress surfacing. */
export interface TranslationEngineOptions {
  /** Honoured at the engine boundary AND cooperatively between units. */
  readonly signal?: AbortSignal;
  /**
   * Called after each completed unit. Implementations treat a THROWN
   * callback as a cooperative stop request and MUST stop and reject with
   * the typed cancelled error rather than swallow it.
   */
  readonly onProgress?: (progress: TranslationEngineProgress) => void;
}

/**
 * Progress a TTS engine surfaces between work units (the translation
 * progress shape, mirrored for the TTS seam).
 */
export interface TtsEngineProgress {
  /** Work units completed so far (monotone non-decreasing). */
  readonly completedUnits: number;
  /** Total units when genuinely known up front; absent otherwise. */
  readonly totalUnits?: number;
}

/** Per-run engine options: cooperative cancellation + progress surfacing. */
export interface TtsEngineOptions {
  /** Honoured at the engine boundary AND cooperatively between units. */
  readonly signal?: AbortSignal;
  /**
   * Called after each completed unit. Implementations treat a THROWN
   * callback as a cooperative stop request and MUST stop and reject with
   * the typed cancelled error rather than swallow it.
   */
  readonly onProgress?: (progress: TtsEngineProgress) => void;
}

/**
 * The LOCAL translation-engine seam (INTERFACE ONLY, like
 * TranscriptionEnginePort). Contract rules for every implementation,
 * binding:
 * - LOCAL ONLY: the adapter shells out to a binary on THIS machine (or
 *   replays fixtures in the labeled test double); NO network, NO model
 *   downloads, NO provider reads — ever;
 * - HONEST AVAILABILITY: an implementation whose engine is absent from the
 *   machine REJECTS with the typed `intelligence/translation-engine-
 *   unavailable` error (surfaced with a recovery hint, never hidden, never
 *   a silent empty result);
 * - COOPERATIVE CANCELLATION: `signal` is checked at entry (the boundary —
 *   never spawn an already-cancelled run) and honoured mid-run (the child
 *   is killed; the run rejects with the typed `common/cancelled` error)
 *   and produces NO result;
 * - HONEST LINEAGE: `engineVersion`/`modelLineage` values are read from
 *   the engine's OWN output; facts the engine did not report stay absent —
 *   never guessed, never defaulted;
 * - OUTPUT IS THE ENGINE'S OWN: the translation text is parsed ONLY from
 *   the engine's documented CLI output shapes — anything unparsable is a
 *   failure, never fabricated.
 */
export interface TranslationEnginePort {
  /** The adapter's identity + honest lineage + license note. */
  readonly descriptor: TranslationEngineDescriptor;
  /**
   * Translates one text between two language tags. Rejects with the typed
   * engine-unavailable error when the engine is absent, the typed cancelled
   * error when the run was cancelled (at the boundary or mid-run), or a
   * typed engine-failed error when the engine ran and itself reported
   * failure (including producing no parseable translation).
   */
  translate(
    request: TranslationRequest,
    options?: TranslationEngineOptions,
  ): Promise<TranslationResult>;
}

/**
 * The LOCAL TTS-engine seam (INTERFACE ONLY, like TranscriptionEnginePort).
 * Contract rules for every implementation, binding (the translation seam's
 * rules, plus the voice model):
 * - LOCAL ONLY: the adapter shells out to a binary on THIS machine; NO
 *   network, NO voice/model downloads, NO provider reads — ever;
 * - HONEST AVAILABILITY: an implementation whose ENGINE or VOICE model is
 *   absent from the machine REJECTS with the typed
 *   `intelligence/tts-engine-unavailable` error (surfaced with a recovery
 *   hint naming which fact was absent, never hidden, never a silent empty
 *   result);
 * - COOPERATIVE CANCELLATION: `signal` is checked at entry and honoured
 *   mid-run (the child is killed); a cancelled run rejects with the typed
 *   `common/cancelled` error and produces NO result;
 * - HONEST LINEAGE: `engineVersion`/`modelLineage` values are read from
 *   the engine's OWN output; facts the engine did not report stay absent —
 *   never guessed, never defaulted;
 * - AUDIO FROM THE ENGINE'S OWN OUTPUT PATH: bytes are read from the file
 *   the engine itself wrote — never synthesized, never substituted.
 */
export interface TtsEnginePort {
  /** The adapter's identity + honest lineage + license note. */
  readonly descriptor: TtsEngineDescriptor;
  /**
   * Synthesizes one text with one voice. Rejects with the typed
   * engine-unavailable error when the engine or voice model is absent, the
   * typed cancelled error when the run was cancelled, or a typed
   * engine-failed error when the engine ran and itself reported failure
   * (including writing no audio).
   */
  synthesize(request: TtsRequest, options?: TtsEngineOptions): Promise<TtsResult>;
}
