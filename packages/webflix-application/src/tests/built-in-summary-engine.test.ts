/**
 * BuiltInSummaryEngine tests (P4-SUMMARIZE row 3): the deterministic
 * extractive engine — summarize / overview / Q&A over stored transcript
 * segments.
 *
 * Everything the work order demands is pinned here:
 * - QUOTE DISCIPLINE: every summary sentence is a byte-SUBSTRING of its
 *   cited segment's text; every Q&A span's quote is byte-EQUAL to its
 *   cited segment's ENTIRE text (no generative wording — ever);
 * - the FIXED parameters: the 7-sentence summary cap, 10-segment chapters,
 *   3-term titles, 3-span answers, the stopword-filtered tokenizer;
 * - honest empties: empty segments => empty summary/overview; no-match or
 *   no-token questions => empty spans;
 * - cooperative cancellation at the boundary AND between units (the
 *   deterministic queueMicrotask ordering the transcription suite pinned);
 *   a thrown onProgress is a stop request and propagates as-is;
 * - DETERMINISM: the corpus — same inputs => byte-identical outputs,
 *   sha256-pinned (the pins were computed from THIS engine's output and
 *   any parameter or algorithm change breaks them).
 *
 * HERMETIC: no filesystem, no network, no wall clock, no timers — the only
 * asynchrony is the deterministic microtask queue.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { TranscriptSegment } from "webflix-contracts";
import {
  BuiltInSummaryEngine,
  extractiveTokens,
  EXTRACTIVE_STOPWORDS,
  OVERVIEW_SEGMENTS_PER_CHAPTER,
  SUMMARY_MAX_SENTENCES,
  QA_MAX_SPANS,
  BUILT_IN_SUMMARY_ENGINE_DESCRIPTOR,
} from "../index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The 12-segment determinism-corpus transcript (shared with the pin values). */
const LECTURE: readonly TranscriptSegment[] = [
  {
    startMs: 0,
    endMs: 6000,
    text: "Good morning everyone. Today we are going to talk about the deployment pipeline.",
  },
  {
    startMs: 6000,
    endMs: 12000,
    text: "A deployment pipeline takes your commit from review all the way to production.",
  },
  {
    startMs: 12000,
    endMs: 18000,
    text: "The first stage is testing. Unit tests run on every single commit.",
  },
  {
    startMs: 18000,
    endMs: 24000,
    text: "Integration tests follow. They exercise the whole system together.",
  },
  {
    startMs: 24000,
    endMs: 30000,
    text: "Once testing passes, the build artifact is packaged and stamped with a checksum.",
  },
  {
    startMs: 30000,
    endMs: 36000,
    text: "The second stage is rollout. We deploy to staging first, never straight to production.",
  },
  {
    startMs: 36000,
    endMs: 42000,
    text: "Staging runs for an hour while monitoring collects error rates and latency.",
  },
  {
    startMs: 42000,
    endMs: 48000,
    text: "If the error budget holds, promotion to production happens automatically.",
  },
  {
    startMs: 48000,
    endMs: 54000,
    text: "Database changes are the risky part. Migrations must be backwards compatible.",
  },
  {
    startMs: 54000,
    endMs: 60000,
    text: "A failed migration means rollback, and rollback plans must be rehearsed.",
  },
  {
    startMs: 60000,
    endMs: 66000,
    text: "Finally, observability. Dashboards tell you the pipeline is actually healthy.",
  },
  { startMs: 66000, endMs: 72000, text: "Thank you for listening. Questions are welcome now." },
];

/** The 25-segment chapter fixture: three topical blocks of 10/10/5. */
const chapterSegment = (topic: string, index: number, startMs: number): TranscriptSegment => ({
  startMs,
  endMs: startMs + 5000,
  // The three topic words repeat per block; the note token is UNIQUE per
  // segment (count 1) so only the topic words can dominate a title.
  text: `${topic} note${index}`,
});
const CHAPTERS_FIXTURE: readonly TranscriptSegment[] = [
  ...Array.from({ length: 10 }, (_, i) =>
    chapterSegment("deployment testing pipeline", i, i * 5000),
  ),
  ...Array.from({ length: 10 }, (_, i) =>
    chapterSegment("database migration schema", i, 50000 + i * 5000),
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    chapterSegment("rollout canary monitoring", i, 100000 + i * 5000),
  ),
];

/** The Q&A fixture: known overlaps for the pinned question. */
const QA_FIXTURE: readonly TranscriptSegment[] = [
  { startMs: 0, endMs: 2000, text: "the deployment failed on staging today" },
  { startMs: 2000, endMs: 4000, text: "what happened during the deployment was a rollback" },
  { startMs: 4000, endMs: 6000, text: "we restored the database from backup" },
  { startMs: 6000, endMs: 8000, text: "the deployment happened again later" },
];

const engine = new BuiltInSummaryEngine();

async function expectCancelled(fn: () => Promise<unknown>): Promise<WebFlixError> {
  try {
    await fn();
  } catch (err) {
    expect(WebFlixError.is(err)).toBe(true);
    const wfe = err as WebFlixError;
    expect(wfe.code).toBe(ErrorCode.Cancelled);
    return wfe;
  }
  throw new Error("expected a typed cancelled error, nothing was thrown");
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
describe("extractiveTokens (the shared fixed tokenizer)", () => {
  it("lowercases, keeps alphanumeric runs >= 3 chars, drops the fixed stopwords", () => {
    expect(extractiveTokens("The AND of to Deployment-Testing 42x a")).toEqual([
      "deployment",
      "testing",
      "42x",
    ]);
  });

  it("the stopword list is alphabetical, non-empty and contains the classic function words", () => {
    expect(EXTRACTIVE_STOPWORDS.length).toBeGreaterThan(50);
    const sorted = [...EXTRACTIVE_STOPWORDS];
    expect(sorted.sort()).toEqual([...EXTRACTIVE_STOPWORDS]);
    for (const word of ["the", "and", "that", "what", "with"]) {
      expect(EXTRACTIVE_STOPWORDS).toContain(word);
    }
    // Content words are NOT stopwords.
    for (const word of ["deployment", "testing", "database", "migration", "pipeline"]) {
      expect(EXTRACTIVE_STOPWORDS).not.toContain(word);
    }
  });

  it("keeps duplicates (term frequency counts them)", () => {
    expect(extractiveTokens("roll roll rollout")).toEqual(["roll", "roll", "rollout"]);
  });
});

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------
describe("BuiltInSummaryEngine.summarize", () => {
  it("returns sentences in SOURCE order with exact citations", async () => {
    const result = await engine.summarize({ segments: LECTURE });
    expect(result.sentences.length).toBe(SUMMARY_MAX_SENTENCES);
    // Source order: the segment indices along the list are non-decreasing.
    const indices = result.sentences.map((s) => s.segmentIndex);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
    for (const sentence of result.sentences) {
      const segment = LECTURE[sentence.segmentIndex] as TranscriptSegment;
      expect(sentence.startMs).toBe(segment.startMs);
      expect(sentence.endMs).toBe(segment.endMs);
    }
  });

  it("QUOTE DISCIPLINE: every sentence is a byte-substring of its cited segment's text", async () => {
    const result = await engine.summarize({ segments: LECTURE });
    expect(result.sentences.length).toBeGreaterThan(0);
    for (const sentence of result.sentences) {
      const segment = LECTURE[sentence.segmentIndex] as TranscriptSegment;
      expect(segment.text.includes(sentence.text)).toBe(true);
    }
  });

  it("splits sentences WITHIN segments (no cross-segment merging) and keeps unpunctuated tails", async () => {
    const segments: readonly TranscriptSegment[] = [
      { startMs: 0, endMs: 3000, text: "One sentence here. And another one" },
      { startMs: 3000, endMs: 6000, text: "second segment single sentence." },
    ];
    const result = await engine.summarize({ segments });
    // 3 sentences total: 2 from segment 0 (incl. the unpunctuated tail) + 1 from segment 1.
    expect(result.sentences.map((s) => s.text)).toEqual([
      "One sentence here.",
      "And another one",
      "second segment single sentence.",
    ]);
    expect(result.sentences.map((s) => s.segmentIndex)).toEqual([0, 0, 1]);
  });

  it("caps the summary at the fixed maximum and keeps fewer for short transcripts", async () => {
    const capped = await engine.summarize({ segments: LECTURE });
    expect(capped.sentences).toHaveLength(SUMMARY_MAX_SENTENCES);

    const small: readonly TranscriptSegment[] = [
      { startMs: 0, endMs: 1000, text: "only one sentence" },
    ];
    const uncapped = await engine.summarize({ segments: small });
    expect(uncapped.sentences).toHaveLength(1);
    expect(uncapped.sentences[0]?.text).toBe("only one sentence");
  });

  it("term-frequency repetition ranks the repeated sentence into the summary", async () => {
    // "wombat" repeats across three sentences (high document tf); the
    // filler sentences carry only UNIQUE per-line tokens (tf 1) so the
    // repeated-term sentences must be selected when the cap forces
    // exclusions.
    const many: readonly TranscriptSegment[] = Array.from({ length: 12 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: i % 4 === 0 ? "wombat survey wombat habitat" : `zz${i} qq${i} yy${i}`,
    }));
    const result = await engine.summarize({ segments: many });
    expect(result.sentences.length).toBe(SUMMARY_MAX_SENTENCES);
    const texts = result.sentences.map((s) => s.text);
    const wombatLines = texts.filter((t) => t.startsWith("wombat"));
    expect(wombatLines.length).toBe(3); // all three repeated-term sentences kept
  });

  it("empty segments => the honest EMPTY summary (never an error, never fabricated)", async () => {
    const result = await engine.summarize({ segments: [] });
    expect(result).toEqual({ sentences: [] });
  });
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
describe("BuiltInSummaryEngine.overview", () => {
  it("builds 10-segment contiguous chapters with ranges and counts", async () => {
    const result = await engine.overview({ segments: CHAPTERS_FIXTURE });
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters.map((c) => c.segmentCount)).toEqual([10, 10, 5]);
    // Ranges are [firstSegment.startMs, lastSegment.endMs) of each chapter.
    expect(result.chapters[0]).toMatchObject({ startMs: 0, endMs: 50000 });
    expect(result.chapters[1]).toMatchObject({ startMs: 50000, endMs: 100000 });
    expect(result.chapters[2]).toMatchObject({ startMs: 100000, endMs: 125000 });
  });

  it("titles come from the chapter's own dominant SOURCE terms (deterministic tie-break)", async () => {
    const result = await engine.overview({ segments: CHAPTERS_FIXTURE });
    // Each block repeats exactly its three topic words ten (or five) times;
    // ties break alphabetically.
    expect(result.chapters[0]?.title).toBe("deployment · pipeline · testing");
    expect(result.chapters[1]?.title).toBe("database · migration · schema");
    expect(result.chapters[2]?.title).toBe("canary · monitoring · rollout");
  });

  it("a term-less chapter gets the honest fallback title", async () => {
    const segments: readonly TranscriptSegment[] = Array.from({ length: 12 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: ".. a", // no token survives the length floor
    }));
    const result = await engine.overview({ segments });
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters.map((c) => c.title)).toEqual(["chapter 1", "chapter 2"]);
  });

  it("a sub-capacity transcript yields ONE chapter covering everything", async () => {
    const result = await engine.overview({ segments: LECTURE });
    expect(result.chapters).toHaveLength(2); // 12 segments => 10 + 2
    expect(result.chapters[1]?.segmentCount).toBe(2);
    const single = await engine.overview({
      segments: CHAPTERS_FIXTURE.slice(0, OVERVIEW_SEGMENTS_PER_CHAPTER),
    });
    expect(single.chapters).toHaveLength(1);
    expect(single.chapters[0]?.segmentCount).toBe(OVERVIEW_SEGMENTS_PER_CHAPTER);
  });

  it("empty segments => the honest EMPTY overview", async () => {
    const result = await engine.overview({ segments: [] });
    expect(result).toEqual({ chapters: [] });
  });
});

// ---------------------------------------------------------------------------
// Q&A — the quote-discipline centrepiece
// ---------------------------------------------------------------------------
describe("BuiltInSummaryEngine.answer", () => {
  it("ranks matching segments by overlap DESC, index ASC; quotes are the ENTIRE segment text VERBATIM", async () => {
    const result = await engine.answer({
      segments: QA_FIXTURE,
      question: "what happened during the deployment?",
    });
    // Question tokens (stopword-filtered): {happened, deployment}.
    // Seg 1: {happened, deployment} = 2; seg 3: {deployment, happened} = 2;
    // seg 0: {deployment} = 1; seg 2: {} = 0 (NEVER included).
    expect(result.spans.map((s) => s.segmentIndex)).toEqual([1, 3, 0]);
    for (const span of result.spans) {
      const segment = QA_FIXTURE[span.segmentIndex] as TranscriptSegment;
      // QUOTE DISCIPLINE, byte-equal: the quote IS the segment's text.
      expect(span.quote).toBe(segment.text);
      expect(span.startMs).toBe(segment.startMs);
      expect(span.endMs).toBe(segment.endMs);
    }
  });

  it("QUOTE DISCIPLINE over the corpus: every quote is byte-equal to its cited segment's full text", async () => {
    const result = await engine.answer({
      segments: LECTURE,
      question: "what happens to the database during a failed migration?",
    });
    expect(result.spans.length).toBeGreaterThan(0);
    for (const span of result.spans) {
      const segment = LECTURE[span.segmentIndex] as TranscriptSegment;
      expect(span.quote).toBe(segment.text);
      expect(segment.text.includes(span.quote)).toBe(true);
    }
  });

  it("caps the answer at the fixed maximum spans", async () => {
    const segments: readonly TranscriptSegment[] = Array.from({ length: 8 }, (_, i) => ({
      startMs: i * 1000,
      endMs: i * 1000 + 900,
      text: `alpha beta gamma delta number ${i}`,
    }));
    const result = await engine.answer({ segments, question: "alpha beta gamma?" });
    expect(result.spans).toHaveLength(QA_MAX_SPANS);
  });

  it("a question with NO matching tokens => the honest EMPTY answer (never an invented one)", async () => {
    const result = await engine.answer({ segments: QA_FIXTURE, question: "zzz qqq vvv" });
    expect(result).toEqual({ spans: [] });
  });

  it("a question with NO valid tokens after the tokenizer floor => empty spans (documented limit)", async () => {
    // "Is it?" — every word is under the 3-char floor.
    const result = await engine.answer({ segments: QA_FIXTURE, question: "Is it?" });
    expect(result).toEqual({ spans: [] });
  });

  it("empty segments => the honest EMPTY answer", async () => {
    const result = await engine.answer({ segments: [], question: "anything at all?" });
    expect(result).toEqual({ spans: [] });
  });
});

// ---------------------------------------------------------------------------
// Cancellation + progress
// ---------------------------------------------------------------------------
describe("cancellation (boundary + cooperative, every operation)", () => {
  it("an already-aborted signal rejects typed Cancelled at the boundary — no progress, no result", async () => {
    const controller = new AbortController();
    controller.abort();
    for (const run of [
      () => engine.summarize({ segments: LECTURE }, { signal: controller.signal }),
      () => engine.overview({ segments: LECTURE }, { signal: controller.signal }),
      () =>
        engine.answer(
          { segments: LECTURE, question: "deployment?" },
          { signal: controller.signal },
        ),
    ]) {
      const err = await expectCancelled(run);
      expect(err.reason).toContain("boundary");
    }
  });

  it("mid-run abort (deterministic queueMicrotask ordering) rejects typed Cancelled between units", async () => {
    for (const run of [
      (signal: AbortSignal) => engine.summarize({ segments: LECTURE }, { signal }),
      (signal: AbortSignal) => engine.overview({ segments: LECTURE }, { signal }),
      (signal: AbortSignal) =>
        engine.answer({ segments: LECTURE, question: "deployment?" }, { signal }),
    ]) {
      const controller = new AbortController();
      const pending = run(controller.signal);
      // The abort lands after the first unit's await — pinned microtask order.
      queueMicrotask(() => controller.abort());
      const err = await expectCancelled(() => pending);
      expect(err.reason).toContain("cooperatively");
    }
  });

  it("a THROWN onProgress is a stop request: the thrown error propagates AS-IS", async () => {
    const stop = new WebFlixError({
      code: ErrorCode.Cancelled,
      reason: "caller stop request",
      retryable: false,
      context: {},
    });
    let calls = 0;
    const err = await engine
      .summarize(
        { segments: LECTURE },
        {
          onProgress: () => {
            calls += 1;
            throw stop;
          },
        },
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBe(stop); // identity: propagated as-is, never swallowed
    expect(calls).toBe(1); // and the run stopped after the first unit
  });

  it("progress fires once per unit with the honestly-known total, in order", async () => {
    const events: { completedUnits: number; totalUnits?: number }[] = [];
    await engine.summarize(
      { segments: LECTURE },
      {
        onProgress: (progress) => {
          events.push({ completedUnits: progress.completedUnits, totalUnits: progress.totalUnits });
        },
      },
    );
    expect(events).toHaveLength(LECTURE.length);
    expect(events[0]).toEqual({ completedUnits: 1, totalUnits: LECTURE.length });
    expect(events.at(-1)).toEqual({ completedUnits: LECTURE.length, totalUnits: LECTURE.length });
  });
});

// ---------------------------------------------------------------------------
// The determinism corpus (sha256-pinned)
// ---------------------------------------------------------------------------
describe("determinism corpus (same input => byte-identical output, sha256-pinned)", () => {
  const pin = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

  it("the descriptor is the honest built-in identity (no external model facts, null license)", () => {
    expect(BUILT_IN_SUMMARY_ENGINE_DESCRIPTOR).toEqual({
      id: "webflix.built-in-summary-engine",
      label: "Built-in extractive engine (deterministic)",
      version: "0.1.0",
      licenseNote: null,
    });
  });

  it("summarize(LECTURE) is byte-identical across runs and matches the pinned sha256", async () => {
    const first = await engine.summarize({ segments: LECTURE });
    const second = await engine.summarize({ segments: LECTURE });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("40f79a49d8d0a67b21b668d9b301e903b880e0b0212c4eef944524f2a0cb390e");
  });

  it("overview(LECTURE) is byte-identical across runs and matches the pinned sha256", async () => {
    const first = await engine.overview({ segments: LECTURE });
    const second = await engine.overview({ segments: LECTURE });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("a5dae98d16bc66214127c8aa82ef0eb911267142dd0624e5fd347f7ab6d2a221");
  });

  it("answer(LECTURE, migration question) is byte-identical across runs and matches the pinned sha256", async () => {
    const question = "what happens to the database during a failed migration?";
    const first = await engine.answer({ segments: LECTURE, question });
    const second = await engine.answer({ segments: LECTURE, question });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("ba8da3c22bfdac574c82c4b13b6503163885e75271b8d27b859428adcfd2e037");
  });

  it("the honest-empty corpus cases pin their exact digests", async () => {
    const emptySummarize = await engine.summarize({ segments: [] });
    const emptyOverview = await engine.overview({ segments: [] });
    const noMatch = await engine.answer({ segments: LECTURE, question: "zzz qqq vvv" });
    const noTokens = await engine.answer({ segments: LECTURE, question: "is it?" });
    expect(pin(emptySummarize)).toBe(
      "b208b9e6e89ccd367770ec5acc60a0cd6e4c6bd12c7f53a3cc730623a3bf49c4",
    );
    expect(pin(emptyOverview)).toBe(
      "9b44599f24de73f3edff382bd3ef1ba6a85610ee390da94e2ee43dc2529b4648",
    );
    // Both honest no-answer shapes serialize identically: {"spans":[]}.
    expect(pin(noMatch)).toBe("bc5db12b0515efd146ad73a6951be4cff08b64a78bc39823f35bc9c8a6d59591");
    expect(pin(noTokens)).toBe("bc5db12b0515efd146ad73a6951be4cff08b64a78bc39823f35bc9c8a6d59591");
  });

  it("a DIFFERENT question or segment text changes the digest (input sensitivity)", async () => {
    const base = await engine.answer({ segments: LECTURE, question: "deployment pipeline?" });
    const other = await engine.answer({ segments: LECTURE, question: "database rollback?" });
    expect(pin(base)).not.toBe(pin(other));
    const shifted = await engine.summarize({
      segments: LECTURE.map((s) => ({ ...s, text: `${s.text} extra.` })),
    });
    const plain = await engine.summarize({ segments: LECTURE });
    expect(pin(shifted)).not.toBe(pin(plain));
  });
});
