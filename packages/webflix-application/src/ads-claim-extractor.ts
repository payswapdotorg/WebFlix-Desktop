/**
 * The built-in DETERMINISTIC claim-extraction engine (P5-CLAIMS scope row 1)
 * — pattern-matched EXTRACTIVE claim spans over an imported ad record's own
 * creative text, implementing the application layer's AdsClaimExtractor seam
 * (./ports.ts; the built-in-summary-engine house style: fixed documented
 * parameters, pure functions, byte-identical outputs forever).
 *
 * WHAT THIS IS, honestly: a LEXICAL pattern matcher. It finds what its
 * patterns match — recall is NOT promised (phase5-ad-plan §6: extraction is
 * EXTRACTIVE; a claim the source did not state is a defect — this engine
 * constructs NO text of its own). NO LLM, NO generative text, NO network,
 * NO embedding, NO scoring, NO wall clock, NO randomness: the same record
 * produces the byte-identical claim set on every machine, forever (pinned
 * by the sha256-stated determinism corpus test).
 *
 * FIXED PARAMETERS (changing any of them is a new extractor version — they
 * are constants, never inputs, never tunables):
 *
 * - SENTENCE SEGMENTATION (the claim-span boundary rule): the creative text
 *   is split into sentence spans on ASCII enders ('.', '!', '?') followed by
 *   whitespace or end-of-text (the built-in summarizer's splitter rule,
 *   verbatim), with '\n' as an additional hard boundary (ad creative text
 *   is routinely multi-line without enders). Each span is trimmed of
 *   boundary whitespace by moving the offsets (the quote stays a verbatim
 *   substring); spans that trim to nothing are skipped. Known limits,
 *   stated plainly: abbreviations ("e.g.") split early; non-ASCII enders
 *   ('。', '…') are not boundaries; a period NOT followed by whitespace
 *   ("acme.tv") does not split.
 * - THE PATTERN SET (four typed patterns, evaluated in this FIXED ORDER —
 *   SPECIFIC BEFORE GENERIC, so the most specific pattern types the
 *   claim: a "#1 rated" sentence is a superlative claim, a "$9.99"
 *   sentence is a pricing claim, and the any-digit pattern catches what
 *   only a quantity phrasing supports):
 *   1. `comparative-superlative` — the sentence contains one of the FIXED
 *      word list (alphabetical, word-boundary, case-insensitive): best,
 *      better, biggest, cheapest, fastest, finest, greatest, largest,
 *      leading, least, lowest, most, smallest, strongest, unbeatable,
 *      unmatched, worse, worst — or one of the FIXED phrase list: "market
 *      leader", "number one", "no.1" (the UNSPACED form only: the spaced
 *      it — the documented segmentation limit below), "#N".
 *      ([$€£¥₹] followed by a digit run), a "% off"/"percent off" phrasing,
 *      or one of the FIXED word list (alphabetical, word-boundary,
 *      case-insensitive): coupon, deal, deals, discount, discounted, free
 *      (the standalone word — a hyphen compound like "risk-free" is the
 *      guarantee pattern's, so the matcher requires the preceding character
 *      to be neither a word char nor a hyphen), freemium, half-price /
 *      half price, no-cost / no cost, offer,
 *      offers, promo, promotion, sale, save, saves, saving, savings,
 *      subscription, trial, trials, voucher, vouchers.
 *   3. `guarantee-assurance` — the sentence contains one of the FIXED word
 *      list (alphabetical, word-boundary, case-insensitive): award-winning
 *      / award winning, certified, clinically-proven / clinically proven,
 *      doctor-recommended / doctor recommended, guarantee, guaranteed,
 *      lifetime, money-back / money back (refund assurance — owned
 *      HERE, deliberately: not an offer phrasing), no-questions-asked /
 *      no questions asked, no-risk / no risk, proven, refund, refunds,
 *      reliable, risk-free / risk free, safe, satisfaction, secure,
 *      trusted, warranty.
 *   4. `quantified-statement` — the sentence contains a digit run with
 *      optional decimal/thousands parts ("50%", "10 million", "1,000",
 *      "9.99"), matching the regex `\\d+(?:[.,]\\d+)*` (no delimiters
 *      shown, by necessity: a slash pair would end this comment). The
 *      pattern flags the lexical fact of a stated quantity; it does NOT
 *      interpret the quantity — and it runs LAST so the specific patterns
 *      above type the sentences that carry them.
 * - THE OVERLAP RULE (deterministic, total): ONE claim per sentence, won by
 *   the FIRST pattern in the fixed order above whose matcher set matches;
 *   sentences matching no pattern yield NOTHING (honest empty, never a
 *   forced claim). Sentence-aligned spans are either identical or disjoint,
 *   so no partial-overlap resolution ever exists — the rule is total.
 * - THE SPAN RULE: the claim span is the FULL sentence containing the match
 *   (trimmed), so a claim reads as the source stated it — the pattern
 *   determines WHICH sentences become claims, never how their text is cut.
 * - ID MINTING: `${extractorId}:${extractorVersion}:${patternId}:${recordId}:${startOffset}-${endOffset}`
 *   — deterministic; the version rides the id, which is what makes the
 *   store-level version rule enforceable (same version + same record = the
 *   same ids = idempotent put-replace; a different version = different ids
 *   = a new append; prior claims are never silently overwritten). The Claim
 *   shape itself carries no provenance fields (0.9.0) — the extractor's
 *   identity/version rides these minted ids and the §2.6 job provenance.
 *
 * QUOTE DISCIPLINE (rg-provable): every claim's quote is constructed
 * EXCLUSIVELY as `creativeText.slice(startOffset, endOffset)` — the matched
 * sentence's own bytes. The module contains no other string construction
 * that can enter a claim's quote (the id template is the only other literal
 * assembly, and ids are not quotes).
 */
import type { AdRecord, Claim } from "webflix-contracts";
import type { AdsClaimExtractor } from "./ports";

/** The engine's identity — OUR code's, always known (no external model). */
export const BUILT_IN_ADS_CLAIM_EXTRACTOR_ID = "webflix.ads-claim-extractor";
export const BUILT_IN_ADS_CLAIM_EXTRACTOR_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// FIXED PARAMETERS (constants — the module docblock is the documentation)
// ---------------------------------------------------------------------------

/** Pattern 2's fixed superlative/comparative word list (alphabetical). */
const SUPERLATIVE_WORDS: readonly string[] = [
  "best",
  "better",
  "biggest",
  "cheapest",
  "fastest",
  "finest",
  "greatest",
  "largest",
  "leading",
  "least",
  "lowest",
  "most",
  "smallest",
  "strongest",
  "unbeatable",
  "unmatched",
  "worse",
  "worst",
];

/** Pattern 2's fixed phrase list (whitespace-flexible, alphabetical). */
const SUPERLATIVE_PHRASES: readonly string[] = ["market leader", "number one"];

/** Pattern 3's fixed pricing/offer word list (alphabetical; bare words). */
const PRICING_WORDS: readonly string[] = [
  "coupon",
  "deal",
  "deals",
  "discount",
  "discounted",
  "freemium",
  "offer",
  "offers",
  "promo",
  "promotion",
  "sale",
  "save",
  "saves",
  "saving",
  "savings",
  "subscription",
  "trial",
  "trials",
  "voucher",
  "vouchers",
];

/** Pattern 3's fixed hyphen-or-space compound list (alphabetical). */
const PRICING_COMPOUNDS: readonly string[] = ["half price", "no cost"];

/** Pattern 4's fixed guarantee/assurance word list (alphabetical). */
const GUARANTEE_WORDS: readonly string[] = [
  "certified",
  "guarantee",
  "guaranteed",
  "lifetime",
  "proven",
  "refund",
  "refunds",
  "reliable",
  "safe",
  "satisfaction",
  "secure",
  "trusted",
  "warranty",
];

/** Pattern 4's fixed hyphen-or-space compound list (alphabetical). */
const GUARANTEE_COMPOUNDS: readonly string[] = [
  "award winning",
  "clinically proven",
  "doctor recommended",
  "money back",
  "no questions asked",
  "no risk",
  "risk free",
];

/** A digit run with optional decimal/thousands parts (the quantified
 * pattern's matcher — evaluated LAST: specific before generic). */
const QUANTIFIED_MATCHER: RegExp = /\d+(?:[.,]\d+)*/;

/**
 * One typed claim pattern: the id (rides the minted claim ids), the
 * human description, and the matcher set — the pattern matches a sentence
 * when ANY matcher matches (all matchers case-insensitive, none global).
 */
interface ClaimPattern {
  readonly id: string;
  readonly description: string;
  readonly matchers: readonly RegExp[];
}

const wordListMatcher = (words: readonly string[]): RegExp =>
  new RegExp(`\\b(?:${words.join("|")})\\b`, "i");

const compoundMatcher = (phrases: readonly string[]): RegExp =>
  new RegExp(`\\b(?:${phrases.map((p) => p.replace(/ /g, "[-\\s]+")).join("|")})\\b`, "i");

/**
 * THE PATTERN SET, in its FIXED evaluation order (the overlap rule's
 * precedence) — the module docblock documents every list above.
 */
const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "comparative-superlative",
    description: "a superlative/comparative word or phrase from the fixed list",
    matchers: [
      wordListMatcher(SUPERLATIVE_WORDS),
      compoundMatcher(SUPERLATIVE_PHRASES),
      /\bno\.\s*\d+\b/i,
      /#\s*\d+\b/,
    ],
  },
  {
    id: "pricing-offer",
    description: "a currency amount, an X%-off phrasing, or a pricing/offer word",
    matchers: [
      /[$€£¥₹]\s*\d+(?:[.,]\d+)*/,
      /(?:%|percent)\s+off\b/i,
      wordListMatcher(PRICING_WORDS),
      compoundMatcher(PRICING_COMPOUNDS),
      // The standalone word "free" only: a preceding word char or hyphen
      // means a compound ("risk-free") that belongs to the guarantee pattern.
      /(?<![\w-])free\b/i,
    ],
  },
  {
    id: "guarantee-assurance",
    description: "a guarantee/assurance word or phrase from the fixed list",
    matchers: [wordListMatcher(GUARANTEE_WORDS), compoundMatcher(GUARANTEE_COMPOUNDS)],
  },
  {
    id: "quantified-statement",
    description: "a stated quantity: a digit run with optional decimal/thousands parts",
    matchers: [QUANTIFIED_MATCHER],
  },
];

/** The pattern set's public, read-only description (documentation as data). */
export const ADS_CLAIM_PATTERN_SET: readonly {
  readonly id: string;
  readonly description: string;
}[] = CLAIM_PATTERNS.map((pattern) => ({ id: pattern.id, description: pattern.description }));

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * The built-in deterministic claim extractor. One instance, no state, no
 * configuration: the pattern set above IS the engine. `extract` is pure —
 * it reads nothing but its argument and returns only matched substrings.
 */
export class BuiltInAdsClaimExtractor implements AdsClaimExtractor {
  // Declared `string` (not the literal constants' inferred literal types) so
  // a versioned test double may honestly override the version — the seam's
  // contract is the string, the constants are the DEFAULTS.
  readonly id: string = BUILT_IN_ADS_CLAIM_EXTRACTOR_ID;
  readonly version: string = BUILT_IN_ADS_CLAIM_EXTRACTOR_VERSION;

  extract(record: AdRecord): readonly Claim[] {
    const text = record.creativeText;
    // Honest empty: no creative text, nothing to extract — never a forced claim.
    if (text === undefined || text.length === 0) {
      return [];
    }
    const claims: Claim[] = [];
    for (const span of sentenceSpans(text)) {
      const sentence = text.slice(span.start, span.end);
      const pattern = firstMatchingPattern(sentence);
      if (pattern === undefined) {
        continue; // no pattern matched — this sentence is not a claim
      }
      claims.push({
        id: `${this.id}:${this.version}:${pattern.id}:${record.id}:${span.start}-${span.end}`,
        adRecordId: record.id,
        // THE ONLY claim-text construction: the matched sentence's own bytes.
        quote: sentence,
        startOffset: span.start,
        endOffset: span.end,
      });
    }
    return claims;
  }
}

// ---------------------------------------------------------------------------
// Internal — segmentation + pattern evaluation (pure)
// ---------------------------------------------------------------------------

/** A half-open [start, end) sentence span within the source text. */
interface SentenceSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Splits the text into trimmed sentence spans: ASCII enders ('.', '!', '?')
 * followed by whitespace or end-of-text end the sentence INCLUSIVE of the
 * ender; '\n' is a hard boundary exclusive of itself. Pure, allocation-
 * bounded, UTF-16 index-based (JS string indices ARE UTF-16 code units —
 * the Claim offset discipline).
 */
function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (ch === "\n") {
      pushTrimmedSpan(spans, text, start, index);
      start = index + 1;
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?") {
      const next = index + 1 < text.length ? text.charAt(index + 1) : "";
      if (next === "" || isWhitespace(next)) {
        pushTrimmedSpan(spans, text, start, index + 1);
        start = index + 1;
      }
    }
  }
  pushTrimmedSpan(spans, text, start, text.length);
  return spans;
}

/** Appends [start, end) with boundary whitespace trimmed; skips empty. */
function pushTrimmedSpan(spans: SentenceSpan[], text: string, start: number, end: number): void {
  let from = start;
  while (from < end && isWhitespace(text.charAt(from))) {
    from += 1;
  }
  let to = end;
  while (to > from && isWhitespace(text.charAt(to - 1))) {
    to -= 1;
  }
  if (to > from) {
    spans.push({ start: from, end: to });
  }
}

/** Whitespace test (the ender-followed-by-whitespace rule's whitespace). */
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

/** The FIRST pattern (fixed order) whose matcher set matches the sentence. */
function firstMatchingPattern(sentence: string): ClaimPattern | undefined {
  for (const pattern of CLAIM_PATTERNS) {
    if (pattern.matchers.some((matcher) => matcher.test(sentence))) {
      return pattern;
    }
  }
  return undefined;
}
