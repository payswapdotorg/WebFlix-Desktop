/**
 * mi.translate / mi.tts use-case tests (P4-TRANSLATE row 2): the two
 * §2.6-riding text-pipeline producers over STORED text payloads, plus the
 * P4-TRANSLATE read contract that feeds them (transcript / summary /
 * overview / qa — and, for mi.tts, translation — all resolved from the
 * DURABLE payload stores, never re-derived).
 *
 * Honest states pinned (the mi-text-intelligence suite's shape, extended):
 * - the §2.6 job descriptor shape is exact for BOTH job kinds;
 * - caller defects are typed BEFORE the job exists (the engine is never
 *   invoked, no artifact/payload/rendition is written);
 * - boundary cancellation: queued -> cancelled, nothing read, nothing run;
 * - mid-run cooperative cancellation: Cancelled => NO artifact, NO text
 *   payload, NO rendition (partial work discarded);
 * - read-time typed failures stamp the job FAILED and rethrow through
 *   TranslateTtsJobError with the cause's code intact: unknown artifact,
 *   non-text-source kind, transcript/text payload absent, EMPTY projection;
 * - engine failures/unavailable propagate typed (cause code intact);
 * - mi.translate success: kind=translation artifact + the translated-text
 *   payload persisted under the SAME upfront-generated artifact id (put
 *   BEFORE the descriptor — a put failure leaves NO artifact); lineage
 *   resolves engine-reported facts when volunteered with the adapter
 *   identity as the always-known floor; inputsHash is deterministic;
 * - mi.tts success: an audio RENDITION attached to the source artifact id
 *   (own lineage: engine/voice/inputsHash/contentType/bytes) with NO
 *   artifact created (the kind enum stays closed) and the SOURCE artifact
 *   descriptor deep-equal untouched;
 * - a payload-put failure leaves NO artifact (translate) / NO rendition
 *   (tts) — the no-artifact-on-failure contract.
 */
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  CatalogItem,
  DerivedArtifact,
  TranslationEngineDescriptor,
  TranslationEnginePort,
  TranslationResult,
  TtsEngineDescriptor,
  TtsEnginePort,
  TtsResult,
} from "webflix-contracts";
import {
  DeriveArtifactBookkeeping,
  FixtureReplaySummaryEngine,
  FixtureReplayTranscriptionEngine,
  FixtureReplayTranslationEngine,
  FixtureReplayTtsEngine,
  InMemoryArtifactRegistry,
  InMemoryAudioRenditionStore,
  InMemoryTextPayloadStore,
  InMemoryTranscriptPayloadStore,
  SummarizeTranscript,
  TranslateArtifact,
  TranslateTtsJobError,
  TranscribeMediaFile,
  SynthesizeSpeech,
  textPayloadChecksum,
  TRANSLATE_JOB_KIND,
  TTS_JOB_KIND,
  ttsRenditionInputsHash,
  textPayloadAbsent,
  transcriptPayloadAbsent,
} from "../index";
import type {
  FixtureReplaySummaryScript,
  FixtureReplayTranslationScript,
  FixtureReplayTtsScript,
} from "../index";
import type { AudioRendition, TextPayloadStore } from "../index";
import type { ClockPort } from "../ports";

// The exact toISOString() form of the pinned instant (no truncation games).
const AS_OF = "2026-10-12T09:00:00.000Z";

const SEGMENTS: readonly { startMs: number; endMs: number; text: string }[] = [
  { startMs: 0, endMs: 1500, text: "hello" },
  { startMs: 1500, endMs: 3000, text: "brave" },
  { startMs: 3000, endMs: 4500, text: "world" },
];
/** The transcript kind's text projection: segment texts joined " ". */
const TRANSCRIPT_TEXT = "hello brave world";

const CANNED_SUMMARY: FixtureReplaySummaryScript = {
  summarize: { sentences: [{ text: "hello", segmentIndex: 0, startMs: 0, endMs: 1500 }] },
  overview: { chapters: [{ title: "chapter 1", startMs: 0, endMs: 4500, segmentCount: 3 }] },
  answer: { spans: [{ quote: "brave", segmentIndex: 1, startMs: 1500, endMs: 3000 }] },
  units: 3,
};

const CANNED_TRANSLATION: FixtureReplayTranslationScript = {
  translate: { translatedText: "hola valiente mundo" },
  units: 3,
};

const CANNED_TTS: FixtureReplayTtsScript = {
  synthesize: { audio: new Uint8Array([1, 2, 3, 4, 5]), contentType: "audio/wav" },
  units: 3,
};

const catalogItem = (id: string, title: string): CatalogItem => ({
  id,
  providerId: "youtube",
  title,
  mediaKind: "video",
  assets: [],
  matchEvidence: undefined,
  availability: undefined,
  metadata: {},
});

const CATALOG: readonly CatalogItem[] = [
  catalogItem("item-a", "Rust Compiler Deep Dive"),
  catalogItem("item-b", "Advanced Pasta Making"),
];

class FakeClock implements ClockPort {
  now(): Date {
    return new Date(AS_OF);
  }
}

/** Deterministic id source: same prefix + same call count => same ids. */
function sequenceIds(prefix = "id"): () => string {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}

async function expectTypedError(
  fn: () => Promise<unknown>,
  code: ErrorCode,
): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(code);
    return wfe;
  }
  throw new Error(`expected a WebFlixError with code ${code}, nothing was thrown`);
}

/**
 * An engine double that is HONESTLY ABSENT: implements the port and
 * rejects with the typed engine-unavailable error (the real local
 * adapters' absent-machine state, replayed deterministically).
 */
class UnavailableTranslationEngine implements TranslationEnginePort {
  readonly descriptor: TranslationEngineDescriptor = {
    id: "webflix.test-unavailable-translation",
    label: "Unavailable translation engine (test)",
    version: "0.1.0",
    licenseNote: null,
  };
  async translate(): Promise<TranslationResult> {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceTranslationEngineUnavailable,
      reason: "no engine on this machine (test double)",
      retryable: false,
      context: {},
    });
  }
}

class UnavailableTtsEngine implements TtsEnginePort {
  readonly descriptor: TtsEngineDescriptor = {
    id: "webflix.test-unavailable-tts",
    label: "Unavailable TTS engine (test)",
    version: "0.1.0",
    licenseNote: null,
  };
  async synthesize(): Promise<TtsResult> {
    throw new WebFlixError({
      code: ErrorCode.IntelligenceTtsEngineUnavailable,
      reason: "no engine or voice on this machine (test double)",
      retryable: false,
      context: {},
    });
  }
}

/** A text payload store that FAILS every put after the first N succeed. */
class PutFailingTextPayloadStore {
  constructor(
    private readonly inner: InMemoryTextPayloadStore,
    private readonly failAfter: number,
  ) {}
  private puts = 0;
  async put(payload: Parameters<TextPayloadStore["put"]>[0]): Promise<void> {
    this.puts += 1;
    if (this.puts > this.failAfter) {
      throw new WebFlixError({
        code: ErrorCode.IntelligenceArtifactInvalid,
        reason: "injected put failure (test)",
        retryable: false,
        context: {},
      });
    }
    return this.inner.put(payload);
  }
  async get(artifactId: string) {
    return this.inner.get(artifactId);
  }
}

interface Harness {
  readonly translationEngine: FixtureReplayTranslationEngine;
  readonly ttsEngine: FixtureReplayTtsEngine;
  readonly registry: InMemoryArtifactRegistry;
  readonly transcriptPayloads: InMemoryTranscriptPayloadStore;
  readonly textPayloads: InMemoryTextPayloadStore;
  readonly audioRenditions: InMemoryAudioRenditionStore;
  readonly translate: TranslateArtifact;
  readonly synthesize: SynthesizeSpeech;
  readonly summarize: SummarizeTranscript;
  readonly transcript: DerivedArtifact;
  readonly generateId: () => string;
}

/**
 * Seeds a REAL transcript artifact (mi.transcribe with the transcription
 * fixture double — its amendment persists the segment payload), then builds
 * mi.translate + mi.tts over the SAME registry/stores: the pipeline's own
 * amendments feed them.
 */
async function makeHarness(
  translationScript: FixtureReplayTranslationScript = CANNED_TRANSLATION,
  ttsScript: FixtureReplayTtsScript = CANNED_TTS,
  summaryScript: FixtureReplaySummaryScript = CANNED_SUMMARY,
): Promise<Harness> {
  const translationEngine = new FixtureReplayTranslationEngine(translationScript);
  const ttsEngine = new FixtureReplayTtsEngine(ttsScript);
  const registry = new InMemoryArtifactRegistry();
  const transcriptPayloads = new InMemoryTranscriptPayloadStore();
  const textPayloads = new InMemoryTextPayloadStore();
  const audioRenditions = new InMemoryAudioRenditionStore();
  const clock = new FakeClock();
  const generateId = sequenceIds("id");
  const transcribe = new TranscribeMediaFile({
    engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
    registry,
    payloadStore: transcriptPayloads,
    clock,
    generateId: sequenceIds("seed"),
  });
  const { artifact } = await transcribe.execute({
    sourceItemId: "item-a",
    mediaPath: "/library/videos/item-a.mkv",
    catalog: CATALOG,
  });
  if (artifact === null) {
    throw new Error("transcript seeding failed — the fixture engine never fails unprompted");
  }
  const translate = new TranslateArtifact({
    engine: translationEngine,
    registry,
    transcriptPayloads,
    textPayloads,
    clock,
    generateId,
  });
  const synthesize = new SynthesizeSpeech({
    engine: ttsEngine,
    registry,
    transcriptPayloads,
    textPayloads,
    audioRenditions,
    clock,
    generateId,
  });
  const summarize = new SummarizeTranscript({
    engine: new FixtureReplaySummaryEngine(summaryScript),
    registry,
    payloads: transcriptPayloads,
    textPayloads,
    clock,
    generateId,
  });
  return {
    translationEngine,
    ttsEngine,
    registry,
    transcriptPayloads,
    textPayloads,
    audioRenditions,
    translate,
    synthesize,
    summarize,
    transcript: artifact,
    generateId,
  };
}

/** Produces a summary artifact through the pipeline (its text payload is persisted by the amendment). */
async function seedSummary(h: Harness): Promise<DerivedArtifact> {
  const output = await h.summarize.execute({
    transcriptArtifactId: h.transcript.id,
    catalog: CATALOG,
  });
  if (output.artifact === null) throw new Error("summary seeding failed");
  return output.artifact;
}

/** Produces a translation artifact through mi.translate itself. */
async function seedTranslation(h: Harness): Promise<DerivedArtifact> {
  const output = await h.translate.execute({
    sourceArtifactId: h.transcript.id,
    sourceLanguageTag: "en",
    targetLanguageTag: "es",
    catalog: CATALOG,
  });
  if (output.artifact === null) throw new Error("translation seeding failed");
  return output.artifact;
}

describe("mi.translate — the translation derived artifact (§2.6)", () => {
  it("the §2.6 job descriptor shape is exact (cancellable, single-attempt, provenance)", async () => {
    const h = await makeHarness();
    const { job } = await h.translate.execute({
      sourceArtifactId: h.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
      catalog: CATALOG,
    });
    expect(Object.keys(job).sort()).toEqual(
      [
        "attempts",
        "cancelRequested",
        "cancellable",
        "createdAt",
        "finishedAt",
        "id",
        "kind",
        "payload",
        "priority",
        "provenance",
        "retry",
        "startedAt",
        "state",
        "updatedAt",
      ].sort(),
    );
    expect(job.kind).toBe(TRANSLATE_JOB_KIND);
    expect(job.state).toBe("succeeded");
    expect(job.cancellable).toBe(true);
    expect(job.retry).toEqual({ maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] });
    expect(job.provenance).toEqual({
      connectorId: h.translationEngine.descriptor.id,
      connectorVersion: h.translationEngine.descriptor.version,
      generatedAt: AS_OF,
    });
    expect(job.payload).toEqual({
      sourceArtifactId: h.transcript.id,
      engineId: h.translationEngine.descriptor.id,
      engineLabel: h.translationEngine.descriptor.label,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
    });
  });

  it("happy path over a TRANSCRIPT: the engine sees the joined segment texts; the artifact + text payload persist under the SAME upfront id", async () => {
    const h = await makeHarness();
    const output = await h.translate.execute({
      sourceArtifactId: h.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
      catalog: CATALOG,
    });
    expect(output.job.state).toBe("succeeded");
    expect(output.result?.translatedText).toBe("hola valiente mundo");
    // The engine received EXACTLY the transcript's text projection.
    expect(h.translationEngine.calls[0]?.request.text).toBe(TRANSCRIPT_TEXT);
    expect(h.translationEngine.calls[0]?.request.sourceLanguageTag).toBe("en");
    expect(h.translationEngine.calls[0]?.request.targetLanguageTag).toBe("es");
    // The artifact: kind=translation, same original, honest floor lineage.
    expect(output.artifact?.kind).toBe("translation");
    expect(output.artifact?.sourceItemId).toBe("item-a");
    expect(output.artifact?.lineage.producedBy).toBe(h.translationEngine.descriptor.id);
    expect(output.artifact?.lineage.modelId).toBe(h.translationEngine.descriptor.id);
    expect(output.artifact?.lineage.modelVersion).toBe(h.translationEngine.descriptor.version);
    // The translated-text payload: same id, target language, checksummed.
    const stored = await h.textPayloads.get(output.artifact!.id);
    expect(stored).toEqual({
      artifactId: output.artifact!.id,
      kind: "translation",
      text: "hola valiente mundo",
      languageTag: "es",
      checksum: textPayloadChecksum("hola valiente mundo"),
    });
  });

  it("happy path over a SUMMARY (the 0005 text-payload read contract)", async () => {
    const h = await makeHarness();
    const summary = await seedSummary(h);
    const output = await h.translate.execute({
      sourceArtifactId: summary.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "de",
      catalog: CATALOG,
    });
    expect(output.job.state).toBe("succeeded");
    // The summary's text projection = its sentence texts joined " ".
    expect(h.translationEngine.calls[0]?.request.text).toBe("hello");
    expect(output.artifact?.kind).toBe("translation");
    expect(output.artifact?.sourceItemId).toBe("item-a");
  });

  it("lineage resolves ENGINE-REPORTED facts when volunteered (never guessed)", async () => {
    const h = await makeHarness({
      ...CANNED_TRANSLATION,
      translate: {
        translatedText: "hola valiente mundo",
        engineVersion: "1.9.6",
        modelLineage: "argos-translate/en→es",
      },
    });
    const output = await h.translate.execute({
      sourceArtifactId: h.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
      catalog: CATALOG,
    });
    expect(output.artifact?.lineage.modelId).toBe("argos-translate/en→es");
    expect(output.artifact?.lineage.modelVersion).toBe("1.9.6");
  });

  it("inputsHash is deterministic: identical inputs => identical digest, forever", async () => {
    const first = await makeHarness();
    const second = await makeHarness();
    const run = (h: Harness) =>
      h.translate.execute({
        sourceArtifactId: h.transcript.id,
        sourceLanguageTag: "en",
        targetLanguageTag: "es",
        catalog: CATALOG,
      });
    const a = await run(first);
    const b = await run(second);
    expect(a.artifact?.lineage.inputsHash).toBe(b.artifact?.lineage.inputsHash);
    // And honest about WHAT varied: a different target language differs.
    const c = await first.translate.execute({
      sourceArtifactId: first.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "de",
      catalog: CATALOG,
    });
    expect(c.artifact?.lineage.inputsHash).not.toBe(a.artifact?.lineage.inputsHash);
  });

  it("caller defects are typed translation-invalid BEFORE the job exists (engine never invoked)", async () => {
    const h = await makeHarness();
    const artifactsBefore = (await h.registry.list()).length;
    await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: "  ",
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: h.transcript.id,
          sourceLanguageTag: "",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: h.transcript.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "  ",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    expect(h.translationEngine.calls).toHaveLength(0);
    expect((await h.registry.list()).length).toBe(artifactsBefore);
  });

  it("boundary cancellation: a pre-aborted signal Cancels the job, nothing is read or run", async () => {
    const h = await makeHarness();
    const controller = new AbortController();
    controller.abort();
    const output = await h.translate.execute({
      sourceArtifactId: h.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
      catalog: CATALOG,
      signal: controller.signal,
    });
    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    expect(h.translationEngine.calls).toHaveLength(0);
    expect((await h.registry.list()).length).toBe(1); // the seed transcript only
  });

  it("mid-run cooperative cancellation: Cancelled => NO artifact and NO text payload", async () => {
    const h = await makeHarness({ ...CANNED_TRANSLATION, units: 4 });
    // Deterministic mid-run abort (the flip-after-N-reads pattern): the
    // boundary check + the engine's unit checkpoints each read the flag —
    // reads=5 lands the abort inside the engine's cooperative checkpoints.
    const flip = flipAfterReads(5);
    const output = await h.translate.execute({
      sourceArtifactId: h.transcript.id,
      sourceLanguageTag: "en",
      targetLanguageTag: "es",
      catalog: CATALOG,
      signal: flip,
    });
    expect(output.job.state).toBe("cancelled");
    expect(output.artifact).toBeNull();
    expect(output.result).toBeNull();
    // No artifact was created and no text payload exists for the would-be id.
    expect((await h.registry.list()).length).toBe(1);
    await expect(h.textPayloads.get("id-1")).rejects.toSatisfy((err: unknown) => {
      return WebFlixError.is(err) && err.code === ErrorCode.IntelligenceTextPayloadAbsent;
    });
  });

  it("engine failure mid-run: job FAILED, the typed cause rethrows through TranslateTtsJobError (code intact)", async () => {
    const h = await makeHarness({
      ...CANNED_TRANSLATION,
      units: 3,
      failAfterUnits: 2,
    });
    const err = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: h.transcript.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationEngineFailed,
    );
    expect(err).toBeInstanceOf(TranslateTtsJobError);
    expect((err as TranslateTtsJobError).job.state).toBe("failed");
    expect((err as TranslateTtsJobError).job.lastError).toContain(
      "intelligence/translation-engine-failed",
    );
    // No artifact, no payload.
    expect((await h.registry.list()).length).toBe(1);
  });

  it("engine-unavailable propagates typed (cause code intact, job failed)", async () => {
    const registry = new InMemoryArtifactRegistry();
    const transcriptPayloads = new InMemoryTranscriptPayloadStore();
    const textPayloads = new InMemoryTextPayloadStore();
    const clock = new FakeClock();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
      registry,
      payloadStore: transcriptPayloads,
      clock,
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const translate = new TranslateArtifact({
      engine: new UnavailableTranslationEngine(),
      registry,
      transcriptPayloads,
      textPayloads,
      clock,
      generateId: sequenceIds("id"),
    });
    const err = await expectTypedError(
      () =>
        translate.execute({
          sourceArtifactId: artifact!.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationEngineUnavailable,
    );
    expect(err).toBeInstanceOf(TranslateTtsJobError);
    expect((err as TranslateTtsJobError).job.state).toBe("failed");
  });

  it("read-time typed failures: unknown artifact / non-text-source kind / payload absent / empty projection", async () => {
    const h = await makeHarness();
    // Unknown artifact.
    const unknown = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: "no-such-artifact",
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    expect(unknown).toBeInstanceOf(TranslateTtsJobError);
    // A translation artifact is NOT a translate source (the order's
    // four-kind list is explicit).
    const translation = await seedTranslation(h);
    const kindErr = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: translation.id,
          sourceLanguageTag: "es",
          targetLanguageTag: "en",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    expect((kindErr as TranslateTtsJobError).job.state).toBe("failed");
    // A transcript whose payload was never persisted (a pre-0004 artifact).
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: h.registry,
      clock: new FakeClock(),
      generateId: sequenceIds("bare"),
    });
    const bare = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "transcript",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    const absent = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: bare.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
    expect((absent as TranslateTtsJobError).job.state).toBe("failed");
    // A summary artifact with NO text payload (a pre-0005 artifact).
    const bareSummary = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "summary",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    const textAbsent = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: bareSummary.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTextPayloadAbsent,
    );
    expect((textAbsent as TranslateTtsJobError).job.state).toBe("failed");
  });

  it("an EMPTY text projection is the honest typed nothing-to-translate (never a fabricated run)", async () => {
    const h = await makeHarness({ ...CANNED_TRANSLATION }, CANNED_TTS, {
      ...CANNED_SUMMARY,
      summarize: { sentences: [] },
    });
    const summary = await seedSummary(h);
    // The amendment persisted the EMPTY projection (the artifact is honest).
    const stored = await h.textPayloads.get(summary.id);
    expect(stored.text).toBe("");
    const err = await expectTypedError(
      () =>
        h.translate.execute({
          sourceArtifactId: summary.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceTranslationInvalid,
    );
    expect(err.reason).toContain("nothing to translate");
    expect(h.translationEngine.calls).toHaveLength(0);
  });

  it("a text-payload PUT failure leaves NO artifact (put-before-descriptor ordering)", async () => {
    const registry = new InMemoryArtifactRegistry();
    const transcriptPayloads = new InMemoryTranscriptPayloadStore();
    const clock = new FakeClock();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
      registry,
      payloadStore: transcriptPayloads,
      clock,
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const inner = new InMemoryTextPayloadStore();
    const failing = new PutFailingTextPayloadStore(inner, 0);
    const translate = new TranslateArtifact({
      engine: new FixtureReplayTranslationEngine(CANNED_TRANSLATION),
      registry,
      transcriptPayloads,
      textPayloads: failing,
      clock,
      generateId: sequenceIds("id"),
    });
    const err = await expectTypedError(
      () =>
        translate.execute({
          sourceArtifactId: artifact!.id,
          sourceLanguageTag: "en",
          targetLanguageTag: "es",
          catalog: CATALOG,
        }),
      ErrorCode.IntelligenceArtifactInvalid,
    );
    expect(err).toBeInstanceOf(TranslateTtsJobError);
    expect((err as TranslateTtsJobError).job.state).toBe("failed");
    // The registry holds ONLY the seed transcript — no artifact existed.
    expect((await registry.list()).length).toBe(1);
  });
});

describe("mi.tts — the audio RENDITION over a stored text payload (§2.6, no artifact)", () => {
  it("the §2.6 job descriptor shape is exact for mi.tts", async () => {
    const h = await makeHarness();
    const { job } = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-amy-medium",
    });
    expect(job.kind).toBe(TTS_JOB_KIND);
    expect(job.state).toBe("succeeded");
    expect(job.cancellable).toBe(true);
    expect(job.retry).toEqual({ maxAttempts: 1, backoffMs: 0, multiplier: 1, on: [] });
    expect(job.provenance).toEqual({
      connectorId: h.ttsEngine.descriptor.id,
      connectorVersion: h.ttsEngine.descriptor.version,
      generatedAt: AS_OF,
    });
    expect(job.payload).toEqual({
      sourceArtifactId: h.transcript.id,
      engineId: h.ttsEngine.descriptor.id,
      engineLabel: h.ttsEngine.descriptor.label,
      voiceId: "en_US-amy-medium",
    });
  });

  it("happy path over a TRANSCRIPT: the rendition persists with its OWN lineage; NO artifact is created; the source is deep-equal untouched", async () => {
    const h = await makeHarness();
    const sourceBefore = await h.registry.get(h.transcript.id);
    const registryListBefore = (await h.registry.list()).length;
    const output = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-amy-medium",
    });
    expect(output.job.state).toBe("succeeded");
    expect(output.rendition).not.toBeNull();
    // The engine received EXACTLY the transcript's text projection.
    expect(h.ttsEngine.calls[0]?.request.text).toBe(TRANSCRIPT_TEXT);
    expect(h.ttsEngine.calls[0]?.request.voice.id).toBe("en_US-amy-medium");
    // The rendition: attached to the SOURCE artifact id, own lineage, bytes.
    const rendition = output.rendition as AudioRendition;
    expect(rendition.sourceArtifactId).toBe(h.transcript.id);
    expect(rendition.engine).toEqual({
      id: h.ttsEngine.descriptor.id,
      label: h.ttsEngine.descriptor.label,
      version: h.ttsEngine.descriptor.version,
    });
    expect(rendition.voiceId).toBe("en_US-amy-medium");
    expect(rendition.contentType).toBe("audio/wav");
    expect(Array.from(rendition.audio)).toEqual([1, 2, 3, 4, 5]);
    expect(rendition.createdAt).toBe(AS_OF);
    expect(rendition.inputsHash).toBe(
      ttsRenditionInputsHash({
        sourceArtifactId: h.transcript.id,
        textChecksum: textPayloadChecksum(TRANSCRIPT_TEXT),
        engineId: h.ttsEngine.descriptor.id,
        engineVersion: h.ttsEngine.descriptor.version,
        voiceId: "en_US-amy-medium",
      }),
    );
    // AUDIO-AS-RENDITION: no descriptor was created (the kind enum stays
    // closed) and the source artifact descriptor is untouched.
    expect((await h.registry.list()).length).toBe(registryListBefore);
    expect(await h.registry.get(h.transcript.id)).toEqual(sourceBefore);
    // The rendition lists BY SOURCE (the attachment surface).
    const listed = await h.audioRenditions.listBySource(h.transcript.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.renditionId).toBe(rendition.renditionId);
  });

  it("happy path over a TRANSLATION (the dubbing precursor — mi.tts reads every text payload kind)", async () => {
    const h = await makeHarness();
    const translation = await seedTranslation(h);
    const output = await h.synthesize.execute({
      sourceArtifactId: translation.id,
      voiceId: "es_ES-mls-medium",
    });
    expect(output.job.state).toBe("succeeded");
    // The engine received the TRANSLATED text (the payload this order persists).
    expect(h.ttsEngine.calls[0]?.request.text).toBe("hola valiente mundo");
    expect(output.rendition?.sourceArtifactId).toBe(translation.id);
  });

  it("a second rendition on the SAME source attaches alongside the first (many renditions, deterministic order)", async () => {
    const h = await makeHarness();
    const first = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-amy-medium",
    });
    const second = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-ryan-high",
    });
    expect(second.job.state).toBe("succeeded");
    const listed = await h.audioRenditions.listBySource(h.transcript.id);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.renditionId).toBe(first.rendition?.renditionId);
    expect(listed[1]?.renditionId).toBe(second.rendition?.renditionId);
    expect(listed[1]?.voiceId).toBe("en_US-ryan-high");
    // Still NO new artifact.
    expect((await h.registry.list()).length).toBe(1);
  });

  it("caller defects are typed tts-invalid BEFORE the job exists (engine never invoked)", async () => {
    const h = await makeHarness();
    await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: "", voiceId: "v" }),
      ErrorCode.IntelligenceTtsInvalid,
    );
    await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: h.transcript.id, voiceId: "  " }),
      ErrorCode.IntelligenceTtsInvalid,
    );
    expect(h.ttsEngine.calls).toHaveLength(0);
    expect(await h.audioRenditions.listBySource(h.transcript.id)).toHaveLength(0);
  });

  it("boundary cancellation: a pre-aborted signal Cancels the job, nothing is read or run", async () => {
    const h = await makeHarness();
    const controller = new AbortController();
    controller.abort();
    const output = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-amy-medium",
      signal: controller.signal,
    });
    expect(output.job.state).toBe("cancelled");
    expect(output.rendition).toBeNull();
    expect(h.ttsEngine.calls).toHaveLength(0);
    expect(await h.audioRenditions.listBySource(h.transcript.id)).toHaveLength(0);
  });

  it("mid-run cooperative cancellation: Cancelled => NO rendition (the flip-after-reads pattern)", async () => {
    const h = await makeHarness({ ...CANNED_TRANSLATION }, { ...CANNED_TTS, units: 4 });
    const flip = flipAfterReads(4);
    const output = await h.synthesize.execute({
      sourceArtifactId: h.transcript.id,
      voiceId: "en_US-amy-medium",
      signal: flip,
    });
    expect(output.job.state).toBe("cancelled");
    expect(output.rendition).toBeNull();
    expect(await h.audioRenditions.listBySource(h.transcript.id)).toHaveLength(0);
    expect((await h.registry.list()).length).toBe(1);
  });

  it("engine failure mid-run: job FAILED, the typed cause rethrows (code intact), NO rendition", async () => {
    const h = await makeHarness({}, { ...CANNED_TTS, units: 3, failAfterUnits: 2 });
    const err = await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: h.transcript.id, voiceId: "v" }),
      ErrorCode.IntelligenceTtsEngineFailed,
    );
    expect(err).toBeInstanceOf(TranslateTtsJobError);
    expect((err as TranslateTtsJobError).job.state).toBe("failed");
    expect(await h.audioRenditions.listBySource(h.transcript.id)).toHaveLength(0);
  });

  it("engine-unavailable propagates typed (cause code intact, job failed)", async () => {
    const registry = new InMemoryArtifactRegistry();
    const transcriptPayloads = new InMemoryTranscriptPayloadStore();
    const textPayloads = new InMemoryTextPayloadStore();
    const audioRenditions = new InMemoryAudioRenditionStore();
    const clock = new FakeClock();
    const transcribe = new TranscribeMediaFile({
      engine: new FixtureReplayTranscriptionEngine({ segments: SEGMENTS }),
      registry,
      payloadStore: transcriptPayloads,
      clock,
      generateId: sequenceIds("seed"),
    });
    const { artifact } = await transcribe.execute({
      sourceItemId: "item-a",
      mediaPath: "/library/videos/item-a.mkv",
      catalog: CATALOG,
    });
    const synthesize = new SynthesizeSpeech({
      engine: new UnavailableTtsEngine(),
      registry,
      transcriptPayloads,
      textPayloads,
      audioRenditions,
      clock,
      generateId: sequenceIds("id"),
    });
    const err = await expectTypedError(
      () => synthesize.execute({ sourceArtifactId: artifact!.id, voiceId: "v" }),
      ErrorCode.IntelligenceTtsEngineUnavailable,
    );
    expect(err).toBeInstanceOf(TranslateTtsJobError);
    expect((err as TranslateTtsJobError).job.state).toBe("failed");
    expect(await audioRenditions.listBySource(artifact!.id)).toHaveLength(0);
  });

  it("read-time typed failures for mi.tts: unknown artifact / non-text kind / transcript absent / text absent / empty projection", async () => {
    const h = await makeHarness();
    await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: "no-such-artifact", voiceId: "v" }),
      ErrorCode.IntelligenceTtsInvalid,
    );
    // dubbing artifacts are NOT text sources (no payload exists for them).
    const bookkeeping = new DeriveArtifactBookkeeping({
      registry: h.registry,
      clock: new FakeClock(),
      generateId: sequenceIds("bare"),
    });
    const dubbing = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "dubbing",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: dubbing.id, voiceId: "v" }),
      ErrorCode.IntelligenceTtsInvalid,
    );
    const bareTranscript = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "transcript",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    const absent = await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: bareTranscript.id, voiceId: "v" }),
      ErrorCode.IntelligenceTranscriptPayloadAbsent,
    );
    expect((absent as TranslateTtsJobError).job.state).toBe("failed");
    const bareOverview = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "overview",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    const textAbsent = await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: bareOverview.id, voiceId: "v" }),
      ErrorCode.IntelligenceTextPayloadAbsent,
    );
    expect((textAbsent as TranslateTtsJobError).job.state).toBe("failed");
    // Empty projection: an empty-qa artifact (its quotes joined = "").
    const emptyQa = await bookkeeping.create({
      sourceItemId: "item-a",
      kind: "qa",
      lineage: { modelId: "m", modelVersion: "v", producedBy: "p" },
      catalog: CATALOG,
    });
    await h.textPayloads.put({
      artifactId: emptyQa.id,
      kind: "qa",
      text: "",
      checksum: textPayloadChecksum(""),
    });
    const empty = await expectTypedError(
      () => h.synthesize.execute({ sourceArtifactId: emptyQa.id, voiceId: "v" }),
      ErrorCode.IntelligenceTtsInvalid,
    );
    expect(empty.reason).toContain("nothing to synthesize");
    expect(h.ttsEngine.calls).toHaveLength(0);
  });

  it("the store factories' absent errors are the honest typed ones (never null)", async () => {
    expect(transcriptPayloadAbsent("x").code).toBe(ErrorCode.IntelligenceTranscriptPayloadAbsent);
    expect(textPayloadAbsent("x").code).toBe(ErrorCode.IntelligenceTextPayloadAbsent);
  });
});

/**
 * A deterministic, timer-free test signal: `aborted` reads FALSE for the
 * first `reads` accesses and TRUE afterwards — the cooperative-mid-run
 * cancellation probe (the mi-text-intelligence precedent). The read
 * sequence on the translate path: boundary check (1) + engine boundary (2)
 * + engine unit checkpoints (3..) — reads=5 lands the abort inside the
 * engine's second/third unit checkpoint. On the tts path reads=4 lands it
 * at the engine's second checkpoint.
 */
function flipAfterReads(reads: number): AbortSignal {
  let count = 0;
  return {
    get aborted() {
      count += 1;
      return count > reads;
    },
  } as unknown as AbortSignal;
}
