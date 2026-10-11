/**
 * The built-in DETERMINISTIC extractive engine (P4-SUMMARIZE scope row 3) —
 * summaries, timeline overviews and extractive Q&A over STORED transcript
 * segments, implementing the contracts' SummaryEnginePort.
 *
 * WHAT THIS IS, honestly: pure functions over the request's segments —
 * NO model, NO network, NO storage reads, NO wall clock, NO randomness.
 * The same request produces the BYTE-IDENTICAL result on every machine,
 * forever (pinned by the determinism corpus test, sha256-stated). There is
 * no external model, so the descriptor's engineVersion/modelLineage are
 * honestly ABSENT and licenseNote is null (our own code, no model license
 * applies).
 *
 * FIXED PARAMETERS (changing any of them is a new engine version — they are
 * constants, never inputs, never tunables):
 *
 * - Tokenizer (shared by every operation): lowercase, alphanumeric runs of
 *   length >= 3, minus a FIXED stopword list (the high-frequency English
 *   function words that survive the length floor — "the", "and", "that",
 *   …). Without the filter, function words dominate term frequency and
 *   chapter titles degenerate to "the · and · production" — a term list a
 *   human recognizes as noise. The list is a FIXED PARAMETER (below),
 *   alphabetical, documented; changing it is a new engine version.
 * - SUMMARIZE: sentence scoring =
 *     score = 0.65 * normalizedTermScore + 0.35 * positionScore
 *   where termScore(s) = (sum of the document term-frequency over s's
 *   UNIQUE terms) / max(1, s's token count) — length-normalized so long
 *   sentences do not win by bulk — normalized by the max termScore across
 *   the document; positionScore(s) = 1 - i/(N-1) for sentence i of N (N=1
 *   => 1) — an early-position bias, the classic extractive lead weighting.
 *   Selection: the top min(7, N) sentences by score DESC, tie-break by
 *   source order ASC, OUTPUT IN SOURCE ORDER (a summary reads in transcript
 *   order, not score order). Sentences are split WITHIN each segment's text
 *   on ASCII sentence enders ('.', '!', '?') followed by whitespace or
 *   end-of-text; no cross-segment merging — every sentence cites exactly
 *   ONE segment. Known limits, stated plainly: abbreviations ("e.g.") can
 *   split early; non-ASCII sentence enders are not boundaries. Deterministic
 *   and documented beats clever here.
 * - OVERVIEW: timeline chapters = contiguous runs of 10 segments (the last
 *   chapter takes the remainder); a chapter's range is
 *   [firstSegment.startMs, lastSegment.endMs). The title is the chapter's
 *   top 3 terms by in-chapter term frequency (ties broken alphabetically)
 *   joined by " · " — every content word of a title comes from the
 *   chapter's own source text; a chapter with no >= 3-char tokens gets the
 *   literal fallback title "chapter N" (honest: no dominant terms exist).
 * - Q&A: the question is tokenized with the shared rule; each segment's
 *   match score = |unique question tokens ∩ unique segment tokens|.
 *   Segments with score 0 NEVER appear (no fabrication); the top 3 by score
 *   DESC, tie-break segment index ASC, become the answer — each span's
 *   quote is the segment's ENTIRE text VERBATIM (byte-equal, enforced by
 *   tests), cited by segment index + time range. A question with no valid
 *   tokens honestly matches nothing: spans = [].
 *
 * QUOTE DISCIPLINE (rg-provable): summary sentences and Q&A quotes are
 * constructed EXCLUSIVELY from the source segments' own text — the only
 * string literals in the extractive paths are the chapter-title separator,
 * the chapter fallback prefix and error/cancellation reasons, none of which
 * enter any sentence or quote.
 *
 * CANCELLATION (the port's binding rules): the signal is checked at entry
 * (the boundary — no work starts) AND between units (units = segments: one
 * deterministic microtask yield per unit so an abort DURING the run is
 * observable at the next checkpoint) AND once more before the synchronous
 * finalize. A cancelled run rejects with the typed common/cancelled error
 * and produces NO result. A THROWN onProgress callback is a stop request —
 * the thrown error propagates as-is (stopping the run), the fixture-double
 * precedent. The post-loop finalize (scoring/selection) is synchronous and
 * sub-millisecond — like the ranking job, there is no await point inside
 * it to interrupt, and the pre-finalize checkpoint covers the boundary.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  OverviewRequest,
  OverviewResult,
  QaAnswer,
  QaRequest,
  SummaryEngineDescriptor,
  SummaryEngineOptions,
  SummaryEnginePort,
  SummaryRequest,
  SummaryResult,
  TranscriptSegment,
} from "webflix-contracts";

/** Adapter identity — OUR code's, always known (there is no external model). */
export const BUILT_IN_SUMMARY_ENGINE_ID = "webflix.built-in-summary-engine";
export const BUILT_IN_SUMMARY_ENGINE_VERSION = "0.1.0";

/**
 * The extractive ALGORITHM's identity, carried in the produced artifacts'
 * lineage as modelId: `webflix.extractive.v1`. The algorithm version lives
 * in the id itself (v1) — lineage.modelVersion carries "v1" (the frozen
 * ArtifactLineage shape requires a non-empty modelVersion; the honest
 * value is the algorithm's version, not the adapter package's).
 */
export const EXTRACTIVE_MODEL_ID = "webflix.extractive.v1";
export const EXTRACTIVE_MODEL_VERSION = "v1";

/** The descriptor this engine exposes (lineage honestly absent — see above). */
export const BUILT_IN_SUMMARY_ENGINE_DESCRIPTOR: SummaryEngineDescriptor = {
  id: BUILT_IN_SUMMARY_ENGINE_ID,
  label: "Built-in extractive engine (deterministic)",
  version: BUILT_IN_SUMMARY_ENGINE_VERSION,
  licenseNote: null,
};

// ---------------------------------------------------------------------------
// FIXED PARAMETERS (constants — the module docblock is the documentation)
// ---------------------------------------------------------------------------

/** Summarize: the term-frequency component's weight. */
export const SUMMARY_TERM_WEIGHT = 0.65;
/** Summarize: the position component's weight (early sentences score higher). */
export const SUMMARY_POSITION_WEIGHT = 0.35;
/** Summarize: maximum sentences a summary keeps. */
export const SUMMARY_MAX_SENTENCES = 7;
/** Overview: segments per timeline chapter (the last chapter takes the remainder). */
export const OVERVIEW_SEGMENTS_PER_CHAPTER = 10;
/** Overview: dominant terms joined into a chapter title. */
export const OVERVIEW_TITLE_TERMS = 3;
/** Overview: the fixed separator between a title's terms. */
export const OVERVIEW_TITLE_SEPARATOR = " · ";
/** Q&A: maximum spans an answer keeps. */
export const QA_MAX_SPANS = 3;

// ---------------------------------------------------------------------------
// Tokenizer (the extractive token rule + the fixed stopword list)
// ---------------------------------------------------------------------------

/**
 * The FIXED stopword list: high-frequency English function words that
 * survive the >= 3-char token floor (shorter ones — "a", "is", "of", "to" —
 * already drop out). Alphabetical; a FIXED PARAMETER of the engine — adding
 * or removing a word is a new engine version (webflix.extractive.v2), never
 * a silent behaviour change.
 */
export const EXTRACTIVE_STOPWORDS: readonly string[] = [
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "and",
  "any",
  "are",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "can",
  "could",
  "did",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "had",
  "has",
  "have",
  "having",
  "here",
  "hers",
  "himself",
  "how",
  "into",
  "its",
  "itself",
  "just",
  "may",
  "might",
  "more",
  "most",
  "must",
  "now",
  "off",
  "only",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "too",
  "under",
  "until",
  "very",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "whose",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
];

const STOPWORD_SET: ReadonlySet<string> = new Set(EXTRACTIVE_STOPWORDS);

/**
 * Extractive tokens: lowercase alphanumeric runs of length >= 3 that are
 * NOT fixed stopwords, WITH duplicates (term frequency counts them);
 * callers derive unique sets when they need set semantics. Deterministic:
 * no locale, no Unicode folding.
 */
export function extractiveTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORD_SET.has(raw)) tokens.push(raw);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** One sentence extracted from one segment (internal scoring unit). */
interface ExtractedSentence {
  /** The sentence text — an exact substring of the source segment's text. */
  readonly text: string;
  /** Source segment index (the citation). */
  readonly segmentIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  /** Sentence order within the WHOLE transcript (position scoring input). */
  readonly orderIndex: number;
}

/**
 * The built-in extractive engine. Pure, deterministic, local — see the
 * module docblock for the binding parameter documentation.
 */
export class BuiltInSummaryEngine implements SummaryEnginePort {
  readonly descriptor: SummaryEngineDescriptor = BUILT_IN_SUMMARY_ENGINE_DESCRIPTOR;

  async summarize(request: SummaryRequest, options?: SummaryEngineOptions): Promise<SummaryResult> {
    const sentences: ExtractedSentence[] = [];
    let orderIndex = 0;
    await processSegments(request.segments, options, (segment, segmentIndex) => {
      for (const sentence of splitSentences(segment.text)) {
        sentences.push({
          text: sentence,
          segmentIndex,
          startMs: segment.startMs,
          endMs: segment.endMs,
          orderIndex: orderIndex++,
        });
      }
    });

    // Finalize (synchronous, deterministic): score + select.
    const total = sentences.length;
    if (total === 0) return { sentences: [] };

    // Document term frequency: count of a term across ALL sentences.
    const termFrequency = new Map<string, number>();
    const sentenceTokenCounts: number[] = [];
    const sentenceUniqueTerms: string[][] = [];
    for (const sentence of sentences) {
      const tokens = extractiveTokens(sentence.text);
      sentenceTokenCounts.push(tokens.length);
      const unique = [...new Set(tokens)];
      sentenceUniqueTerms.push(unique);
      for (const term of unique) {
        termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
      }
    }

    // Term score per sentence, then normalize by the document max.
    const termScores: number[] = sentenceUniqueTerms.map((unique, index) => {
      let sum = 0;
      for (const term of unique) {
        sum += termFrequency.get(term) ?? 0;
      }
      return sum / Math.max(1, sentenceTokenCounts[index] ?? 0);
    });
    let maxTermScore = 0;
    for (const score of termScores) {
      if (score > maxTermScore) maxTermScore = score;
    }

    // Combined score = term weight * normalized term score + position
    // weight * position score. Selection: top K by score DESC, tie-break by
    // source order ASC; output in SOURCE order.
    const scored = sentences.map((sentence, index) => {
      const normalizedTerm = maxTermScore > 0 ? (termScores[index] ?? 0) / maxTermScore : 0;
      const positionScore = total > 1 ? 1 - sentence.orderIndex / (total - 1) : 1;
      return {
        orderIndex: sentence.orderIndex,
        score: SUMMARY_TERM_WEIGHT * normalizedTerm + SUMMARY_POSITION_WEIGHT * positionScore,
      };
    });
    const keep = Math.min(SUMMARY_MAX_SENTENCES, total);
    const selected = [...scored]
      .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.orderIndex - b.orderIndex))
      .slice(0, keep)
      .map((entry) => entry.orderIndex)
      .sort((a, b) => a - b);

    return {
      sentences: selected.map((orderIdx) => {
        const sentence = sentences[orderIdx] as ExtractedSentence;
        return {
          text: sentence.text,
          segmentIndex: sentence.segmentIndex,
          startMs: sentence.startMs,
          endMs: sentence.endMs,
        };
      }),
    };
  }

  async overview(
    request: OverviewRequest,
    options?: SummaryEngineOptions,
  ): Promise<OverviewResult> {
    const segments = request.segments;

    // Chapter assignment is pure arithmetic over the segment list; the
    // per-unit loop below accumulates each chapter's term counts. An empty
    // segment list still rides processSegments (boundary + final
    // checkpoints) and finalizes to the honest empty overview.
    const chapterCount = Math.ceil(segments.length / OVERVIEW_SEGMENTS_PER_CHAPTER);
    const chapterTerms: Map<string, number>[] = [];
    for (let chapter = 0; chapter < chapterCount; chapter += 1) {
      chapterTerms.push(new Map<string, number>());
    }
    await processSegments(segments, options, (segment, segmentIndex) => {
      const chapter = Math.floor(segmentIndex / OVERVIEW_SEGMENTS_PER_CHAPTER);
      const counts = chapterTerms[chapter] as Map<string, number>;
      for (const token of extractiveTokens(segment.text)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    });
    if (segments.length === 0) {
      return { chapters: [] };
    }

    // Finalize (synchronous, deterministic): build the chapters in order.
    const chapters: OverviewResult["chapters"] = [];
    for (let chapter = 0; chapter < chapterCount; chapter += 1) {
      const first = chapter * OVERVIEW_SEGMENTS_PER_CHAPTER;
      const last = Math.min(first + OVERVIEW_SEGMENTS_PER_CHAPTER, segments.length) - 1;
      const firstSegment = segments[first] as TranscriptSegment;
      const lastSegment = segments[last] as TranscriptSegment;
      chapters.push({
        title: chapterTitle(chapterTerms[chapter] as Map<string, number>, chapter + 1),
        startMs: firstSegment.startMs,
        endMs: lastSegment.endMs,
        segmentCount: last - first + 1,
      });
    }
    return { chapters };
  }

  async answer(request: QaRequest, options?: SummaryEngineOptions): Promise<QaAnswer> {
    const questionTerms = new Set(extractiveTokens(request.question));
    const overlaps: number[] = [];
    await processSegments(request.segments, options, (segment) => {
      if (questionTerms.size === 0) {
        // No valid question tokens: nothing can match (honest no-match —
        // the overlap stays 0 for every segment, computed uniformly).
        overlaps.push(0);
        return;
      }
      const segmentTerms = new Set(extractiveTokens(segment.text));
      let overlap = 0;
      for (const term of questionTerms) {
        if (segmentTerms.has(term)) overlap += 1;
      }
      overlaps.push(overlap);
    });

    // Finalize (synchronous, deterministic): rank matching segments by
    // overlap DESC, segment index ASC; quote each VERBATIM in full.
    const candidates: { segmentIndex: number; overlap: number }[] = [];
    for (let index = 0; index < overlaps.length; index += 1) {
      const overlap = overlaps[index] ?? 0;
      if (overlap > 0) {
        candidates.push({ segmentIndex: index, overlap });
      }
    }
    if (candidates.length === 0) return { spans: [] };

    const selected = candidates
      .sort((a, b) =>
        a.overlap !== b.overlap ? b.overlap - a.overlap : a.segmentIndex - b.segmentIndex,
      )
      .slice(0, QA_MAX_SPANS);

    return {
      spans: selected.map((candidate) => {
        const segment = request.segments[candidate.segmentIndex] as TranscriptSegment;
        // QUOTE DISCIPLINE: the quote is the segment's ENTIRE text, exactly
        // as stored — nothing is paraphrased, trimmed, or invented.
        return {
          quote: segment.text,
          segmentIndex: candidate.segmentIndex,
          startMs: segment.startMs,
          endMs: segment.endMs,
        };
      }),
    };
  }
}

/** The shared built-in singleton (the BUILT_IN_RANKER precedent). */
export const BUILT_IN_SUMMARY_ENGINE = new BuiltInSummaryEngine();

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The uniform per-segment processing loop every operation rides: boundary
 * check, one deterministic microtask yield + cooperative checkpoint per
 * unit, progress with the honestly-known total, a thrown onProgress
 * honoured as a stop request (the error propagates as-is), and a final
 * checkpoint before the caller's synchronous finalize.
 */
async function processSegments(
  segments: readonly TranscriptSegment[],
  options: SummaryEngineOptions | undefined,
  collect: (segment: TranscriptSegment, segmentIndex: number) => void,
): Promise<void> {
  // Boundary cancellation: an already-aborted signal never starts work.
  if (signalAborted(options)) {
    throw cancellationError("built-in extractive engine cancelled at the boundary");
  }
  const total = segments.length;
  let completed = 0;
  for (const [segmentIndex, segment] of segments.entries()) {
    // A yield point: the deterministic microtask queue makes an abort
    // DURING the run observable at the next checkpoint (no timers, no
    // wall clock — the fixture-replay engine's proven pattern).
    await Promise.resolve();
    // The re-read through signalAborted() defeats control-flow narrowing —
    // the AbortSignal's flag is external mutable state.
    if (signalAborted(options)) {
      throw cancellationError(
        `built-in extractive engine cancelled cooperatively after ${completed} of ${total} units`,
      );
    }
    collect(segment, segmentIndex);
    completed += 1;
    options?.onProgress?.({ completedUnits: completed, totalUnits: total });
  }
  // Final checkpoint before the caller's synchronous finalize.
  await Promise.resolve();
  if (signalAborted(options)) {
    throw cancellationError(
      `built-in extractive engine cancelled before finalizing after ${completed} of ${total} units`,
    );
  }
}

/** True when the run's signal is (now) aborted — re-read at every checkpoint. */
function signalAborted(options: SummaryEngineOptions | undefined): boolean {
  return options?.signal?.aborted === true;
}

/**
 * Splits one segment's text into sentences: a boundary is an ASCII sentence
 * ender ('.', '!', '?') followed by whitespace or end-of-text. The emitted
 * sentence is the EXACT slice from the previous boundary's end (leading
 * whitespace skipped) up to and including the ender — a byte-substring of
 * the source text (quote discipline). A trailing fragment without an ender
 * is kept. Whitespace-only fragments are dropped.
 */
function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char !== "." && char !== "!" && char !== "?") continue;
    const next = index + 1 < text.length ? (text[index + 1] as string) : "";
    if (next !== "" && !isWhitespace(next)) continue;
    const sentence = text.slice(start, index + 1);
    if (sentence.trim().length > 0) sentences.push(sentence);
    start = index + 1;
    while (start < text.length && isWhitespace(text[start] as string)) {
      start += 1;
    }
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (tail.trim().length > 0) sentences.push(tail);
  }
  return sentences;
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "\v"
  );
}

/**
 * Builds one chapter's title: the top OVERVIEW_TITLE_TERMS terms by
 * in-chapter frequency (ties broken alphabetically — deterministic),
 * joined by the fixed separator. Every content word comes from the
 * chapter's own source text. A term-less chapter gets the literal honest
 * fallback "chapter N" (no dominant terms exist to name it with).
 */
function chapterTitle(termCounts: Map<string, number>, chapterNumber: number): string {
  const ranked = [...termCounts.entries()]
    .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, OVERVIEW_TITLE_TERMS)
    .map(([term]) => term);
  if (ranked.length === 0) {
    return `chapter ${chapterNumber}`;
  }
  return ranked.join(OVERVIEW_TITLE_SEPARATOR);
}

/** The typed cancellation error the engine rejects with on abort. */
function cancellationError(reason: string): WebFlixError {
  return new WebFlixError({
    code: ErrorCode.Cancelled,
    reason,
    retryable: false,
    context: { phase: "engine-run", engineId: BUILT_IN_SUMMARY_ENGINE_ID },
  });
}
