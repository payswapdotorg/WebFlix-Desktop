/**
 * The built-in deterministic claim extractor's tests (P5-CLAIMS scope rows
 * 1 + 4): the FIXED pattern set (each pattern fires on its canonical
 * examples; each documented non-match stays empty), the OVERLAP rule (one
 * claim per sentence, first-in-fixed-order wins), the sentence-segmentation
 * edges (newline boundaries, trimming, ender-at-end-of-text, no split
 * inside "acme.tv", the abbreviation limit pinned as the documented
 * behavior), UTF-16 offset discipline (surrogate pairs), the id-minting
 * rule (extractor id + version + pattern + record + offsets), QUOTE
 * DISCIPLINE over a battery of texts (every quote byte-equal to its
 * offsets slice; zero claims whose text does not appear in the source),
 * and the sha256-pinned DETERMINISM CORPUS (same records => byte-identical
 * claim sets; honest-empty cases pin the empty-list digest; input
 * sensitivity: a changed text changes the digest).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AdRecord } from "webflix-contracts";
import {
  ADS_CLAIM_PATTERN_SET,
  BUILT_IN_ADS_CLAIM_EXTRACTOR_ID,
  BUILT_IN_ADS_CLAIM_EXTRACTOR_VERSION,
  BuiltInAdsClaimExtractor,
} from "../index";

const ISO = "2026-10-12T00:00:00Z";

function record(id: string, creativeText?: string): AdRecord {
  return {
    id,
    advertiserIdentityId: "adv-1",
    ...(creativeText !== undefined ? { creativeText } : {}),
    provenance: { source: "user-import", importedAt: ISO, importBatchId: "batch-001" },
  };
}

const extractor = new BuiltInAdsClaimExtractor();

/** Every claim of every listed record obeys the extractive discipline. */
function expectQuoteDiscipline(records: readonly AdRecord[]): void {
  for (const one of records) {
    const text = one.creativeText ?? "";
    for (const claim of extractor.extract(one)) {
      expect(claim.adRecordId).toBe(one.id);
      expect(claim.startOffset).toBeGreaterThanOrEqual(0);
      expect(claim.endOffset).toBeGreaterThan(claim.startOffset);
      expect(claim.endOffset).toBeLessThanOrEqual(text.length);
      // Byte-equal to the offset window — the discipline's core.
      expect(text.slice(claim.startOffset, claim.endOffset)).toBe(claim.quote);
      // Zero claims whose text does not appear in the source.
      expect(text.includes(claim.quote)).toBe(true);
    }
  }
}

describe("BuiltInAdsClaimExtractor — the fixed pattern set", () => {
  it("exposes the documented pattern set as data, in its fixed evaluation order", () => {
    expect(ADS_CLAIM_PATTERN_SET.map((pattern) => pattern.id)).toEqual([
      "comparative-superlative",
      "pricing-offer",
      "guarantee-assurance",
      "quantified-statement",
    ]);
    for (const pattern of ADS_CLAIM_PATTERN_SET) {
      expect(pattern.description.length).toBeGreaterThan(0);
    }
  });

  it("the engine identity is the honest built-in one", () => {
    expect(extractor.id).toBe(BUILT_IN_ADS_CLAIM_EXTRACTOR_ID);
    expect(extractor.version).toBe(BUILT_IN_ADS_CLAIM_EXTRACTOR_VERSION);
    expect(extractor.id).toBe("webflix.ads-claim-extractor");
    expect(extractor.version).toBe("1.0.0");
  });

  it("quantified-statement: pure quantity sentences are claimed by the any-digit pattern", () => {
    const text = "Over 10 million users trust us.";
    const claims = extractor.extract(record("q-1", text));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.quote).toBe(text);
    expect(claims[0]!.id).toContain(":quantified-statement:");
    expect(claims[0]!.startOffset).toBe(0);
    expect(claims[0]!.endOffset).toBe(text.length);
  });

  it("quantified-statement: decimals, thousands separators and bare counts all match", () => {
    for (const text of [
      "1,000 songs in every plan.",
      "Accuracy of 99.9 percent.",
      "3 months free.",
    ]) {
      const claims = extractor.extract(record("q-2", text));
      expect(claims.map((claim) => claim.quote)).toEqual([text]);
    }
  });

  it("comparative-superlative: the fixed word list fires, case-insensitively", () => {
    for (const text of ["The BEST streaming experience.", "Our fastest network yet."]) {
      const claims = extractor.extract(record("s-1", text));
      expect(claims).toHaveLength(1);
      expect(claims[0]!.id).toContain(":comparative-superlative:");
    }
  });

  it("comparative-superlative: the phrase list fires (market leader, number one, no.1, #N)", () => {
    for (const text of [
      "The market leader in streaming.",
      "The number one choice of families.",
      "Rated no.1 by users.",
      "#1 rated service overall.",
    ]) {
      const claims = extractor.extract(record("s-2", text));
      expect(claims.map((claim) => claim.quote)).toEqual([text]);
      expect(claims[0]!.id).toContain(":comparative-superlative:");
    }
  });

  it("DOCUMENTED LIMIT: the spaced 'no. N' splits at its abbreviation period before any pattern sees it", () => {
    // 'no. 1' (with the space) is split by the sentence segmentation at
    // the 'no.' ender — the abbreviation limit, stated plainly in the
    // module docblock; only the unspaced 'no.1' form reaches the phrase
    // matcher (the previous test). The tail sentence claims by its own
    // content, honestly.
    const claims = extractor.extract(record("s-3", "Rated no. 1 by users."));
    expect(claims.map((claim) => claim.quote)).toEqual(["1 by users."]);
    expect(claims[0]!.id).toContain(":quantified-statement:");
  });

  it("pricing-offer: currency amounts, %-off phrasings and the offer word list fire", () => {
    for (const text of [
      "Only $9.99 per month.",
      "Take 30 percent off today.",
      "Everything must go — huge sale!",
      "Start your free trial now.",
    ]) {
      const claims = extractor.extract(record("p-1", text));
      expect(claims.map((claim) => claim.quote)).toEqual([text]);
      expect(claims[0]!.id).toContain(":pricing-offer:");
    }
  });

  it('pricing-offer: the standalone word "free" matches; hyphen compounds do not (risk-free is guarantee language)', () => {
    const standalone = extractor.extract(record("p-2", "Streaming is free forever."));
    expect(standalone[0]!.id).toContain(":pricing-offer:");
    const compound = extractor.extract(record("p-3", "Try it risk-free for a week."));
    expect(compound[0]!.id).toContain(":guarantee-assurance:");
  });

  it("guarantee-assurance: the assurance word list fires", () => {
    for (const text of [
      "Satisfaction guaranteed or your money back.",
      "Clinically proven results.",
      "No questions asked refunds.",
    ]) {
      const claims = extractor.extract(record("g-1", text));
      expect(claims.map((claim) => claim.quote)).toEqual([text]);
      expect(claims[0]!.id).toContain(":guarantee-assurance:");
    }
  });

  it("HONEST EMPTY: no pattern, no claim — never a forced claim", () => {
    for (const text of [
      "Just a plain sentence about nothing in particular here",
      "We make films for people who like films.",
      "  \n  ",
      "",
    ]) {
      expect(extractor.extract(record("e-1", text))).toEqual([]);
    }
  });

  it("HONEST EMPTY: a record with no creative text yields nothing", () => {
    expect(extractor.extract(record("e-2", undefined))).toEqual([]);
  });
});

describe("BuiltInAdsClaimExtractor — the overlap rule (deterministic, total)", () => {
  it("one claim per sentence, won by the FIRST pattern in the fixed order", () => {
    // Matches superlative (best), pricing (offer, % off), guarantee
    // (guaranteed) AND quantified (50) — the superlative wins, alone.
    const claims = extractor.extract(record("o-1", "The best offer — 50% off, guaranteed!"));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.id).toContain(":comparative-superlative:");
  });

  it("specific-before-generic: a #1 sentence types as superlative, a $ price as pricing", () => {
    const hash = extractor.extract(record("o-2", "#1 rated service, 4.9 out of 5."));
    expect(hash[0]!.id).toContain(":comparative-superlative:");
    const price = extractor.extract(record("o-3", "Only $9.99 per month after trial."));
    expect(price[0]!.id).toContain(":pricing-offer:");
    const assurance = extractor.extract(record("o-4", "Risk-free for 30 days."));
    expect(assurance[0]!.id).toContain(":guarantee-assurance:");
  });

  it("distinct sentences never overlap: offsets are disjoint and ordered", () => {
    const claims = extractor.extract(
      record("o-5", "The best streaming experience.\nOver 10 million users trust us."),
    );
    expect(claims).toHaveLength(2);
    expect(claims[0]!.endOffset).toBeLessThanOrEqual(claims[1]!.startOffset);
  });
});

describe("BuiltInAdsClaimExtractor — sentence segmentation (the span rule)", () => {
  it("the claim span is the FULL sentence, trimmed of boundary whitespace (offsets move)", () => {
    const text = "   Best in class.   ";
    const claims = extractor.extract(record("seg-1", text));
    expect(claims[0]!.quote).toBe("Best in class.");
    expect(claims[0]!.startOffset).toBe(text.indexOf("Best in class."));
    expect(claims[0]!.endOffset).toBe(text.indexOf("Best in class.") + "Best in class.".length);
  });

  it("newline is a hard boundary: un-ended lines are their own sentences", () => {
    const claims = extractor.extract(
      record("seg-2", "Over 1 million users\nThe cheapest plan anywhere"),
    );
    expect(claims.map((claim) => claim.quote)).toEqual([
      "Over 1 million users",
      "The cheapest plan anywhere",
    ]);
    expect(claims[0]!.endOffset).toBeLessThanOrEqual(claims[1]!.startOffset);
  });

  it("a period NOT followed by whitespace does not split (acme.tv stays one sentence)", () => {
    const claims = extractor.extract(record("seg-3", "Stream at acme.tv for the best price."));
    expect(claims.map((claim) => claim.quote)).toEqual(["Stream at acme.tv for the best price."]);
  });

  it("an ender at end-of-text ends the sentence (no trailing whitespace needed)", () => {
    const text = "Trusted by teams.";
    const claims = extractor.extract(record("seg-4", text));
    expect(claims.map((claim) => claim.quote)).toEqual([text]);
    expect(claims[0]!.endOffset).toBe(text.length);
  });

  it("the abbreviation limit is the documented behavior: e.g. splits early", () => {
    const claims = extractor.extract(record("seg-5", "e.g. the best offer."));
    // Splits after "e.g." (ender + whitespace) — the documented limit; the
    // second sentence carries the match.
    expect(claims.map((claim) => claim.quote)).toEqual(["the best offer."]);
  });

  it("UTF-16 offsets: surrogate pairs count as two code units (the Claim discipline)", () => {
    const text = "🔥 Best deals — save $19.99 today! 🎉";
    const claims = extractor.extract(record("seg-6", text));
    expect(claims).toHaveLength(1);
    expect(claims[0]!.quote).toBe("🔥 Best deals — save $19.99 today!");
    // The fire emoji occupies code units 0-1; the quote starts at 0 and the
    // discipline check below re-slices byte-exactly.
    expect(text.slice(claims[0]!.startOffset, claims[0]!.endOffset)).toBe(claims[0]!.quote);
  });
});

describe("BuiltInAdsClaimExtractor — id minting (the version rule's substrate)", () => {
  it("the id embeds extractor id + version + pattern + record + offsets, verbatim", () => {
    const claims = extractor.extract(record("id-1", "Over 10 million users."));
    expect(claims[0]!.id).toBe(
      `${BUILT_IN_ADS_CLAIM_EXTRACTOR_ID}:${BUILT_IN_ADS_CLAIM_EXTRACTOR_VERSION}:` +
        "quantified-statement:id-1:0-22",
    );
  });

  it("the same record + the same version re-mints the SAME ids (idempotent substrate)", () => {
    const first = extractor.extract(record("id-2", "The best offer — 50% off!"));
    const second = extractor.extract(record("id-2", "The best offer — 50% off!"));
    expect(first.map((claim) => claim.id)).toEqual(second.map((claim) => claim.id));
  });

  it("a different sentence in the same record mints a different id (offsets ride the id)", () => {
    const first = extractor.extract(record("id-3", "The best offer."));
    const second = extractor.extract(record("id-3", "  The best offer."));
    expect(first[0]!.id).not.toBe(second[0]!.id);
  });
});

describe("BuiltInAdsClaimExtractor — QUOTE DISCIPLINE (rg-provable extractive behavior)", () => {
  const DISCIPLINE_TEXTS: readonly string[] = [
    "Watch Acme — 50% off your first 3 months!",
    "The best streaming experience.\nOver 10 million users trust us.\nTry it free today.",
    "Results guaranteed or your money back.\nNo risk. Cancel anytime.",
    "🔥 Best deals of 2026 — save $19.99 today! 🎉\nDoctor recommended since 2015.",
    "  Leading the market since day one.  \n\n  Half price for students.  ",
    "#1 rated service, 4.9 out of 5.",
    "Certified organic since 1999. Award-winning taste, unmatched quality.",
    "Try it FREE for 30 days. Then just $4.99/month. Cancel anytime.",
    "La mejor experiencia de streaming. Más de 10 millones de usuarios.",
    "Die günstigsten Tarife. Jetzt 50 Prozent Rabatt sichern!",
    "No superlatives or numbers or offers in this line at all",
    "e.g. various examples, incl. abbreviations, approx. 5 kinds.",
    "100% organic. 0% additives. 24/7 support.",
    "Save more. Pay less. Stream better.",
    "A single sentence with a trailing quantity 42",
    "money-back guarantee, risk-free trial, no-questions-asked refund",
    "We are the market leader.\nWe are number one.\nWe are no. 1.\nWe are #1.",
    "streaming at acme.tv since 2015 — the finest catalogue",
    "INTRODUCING: the BIGGEST library ever assembled.",
    "limited time only — act now!!! operators are standing by",
  ];

  it("every claim's quote is byte-equal to its offsets slice; zero claims absent from the source", () => {
    expectQuoteDiscipline(DISCIPLINE_TEXTS.map((text, index) => record(`disc-${index}`, text)));
  });

  it("the discipline also holds over multi-record corpora with textless records mixed in", () => {
    expectQuoteDiscipline([
      ...DISCIPLINE_TEXTS.slice(0, 10).map((text, index) => record(`mix-${index}`, text)),
      record("mix-textless"),
    ]);
  });
});

// ---------------------------------------------------------------------------
// The determinism corpus (sha256-pinned)
// ---------------------------------------------------------------------------
const CORPUS: readonly AdRecord[] = [
  record("corpus-1", "Watch Acme — 50% off your first 3 months! Limited time offer."),
  record(
    "corpus-2",
    "The best streaming experience.\nOver 10 million users trust us.\nTry it free today.",
  ),
  record("corpus-3", "Results guaranteed or your money back.\nNo risk. Cancel anytime."),
  record("corpus-4", "Just a plain sentence about nothing in particular here"),
  record("corpus-5", undefined),
  record(
    "corpus-6",
    "🔥 Best deals of 2026 — save $19.99 today! 🎉\nDoctor recommended since 2015.",
  ),
  record("corpus-7", "  Leading the market since day one.  \n\n  Half price for students.  "),
  record("corpus-8", "#1 rated service, 4.9 out of 5."),
];

describe("determinism corpus (same records => byte-identical claim sets, sha256-pinned)", () => {
  const pin = (value: unknown): string =>
    createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

  it("the whole corpus is byte-identical across runs and matches the pinned sha256", () => {
    const first = CORPUS.map((one) => extractor.extract(one));
    const second = CORPUS.map((one) => extractor.extract(one));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(pin(first)).toBe("72cec72f87ece854eab63d10e919a83a4e3dd822132e1bd280f3a5dcf9eb76b8");
  });

  it("each corpus record pins its own digest", () => {
    const expected: readonly [string, string][] = [
      ["corpus-1", "173a92938f4b183cef3913f607d4110529304b564679d0939c78222e946307e7"],
      ["corpus-2", "acb5d9f6fae7917b746c4bf9d31babbd7510ad9a191fde8debffda4770de9261"],
      ["corpus-3", "c427d85ac3c3e6dd0b5b580c177b892149a86155d0e4f9984515cb07d90eaa72"],
      ["corpus-4", "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"],
      ["corpus-5", "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"],
      ["corpus-6", "d6422db0acbfa9b86ec6e6bfd418173d802d2cd54bf87b0195805244b5ae8844"],
      ["corpus-7", "f9737c7f57490234086ad5c531fdf0ac100f7f712dffd0a52708d8ae90e3d548"],
      ["corpus-8", "f70fcdd2556e397e8bd7cb3054e1cbf17411fc5e544f56b8312de7a5e5a7a497"],
    ];
    for (const [recordId, expectedPin] of expected) {
      const one = CORPUS.find((candidate) => candidate.id === recordId)!;
      expect(pin(extractor.extract(one))).toBe(expectedPin);
    }
  });

  it("the honest-empty cases pin the SAME digest (both serialize as the empty list)", () => {
    // corpus-4 (no pattern matched) and corpus-5 (no creative text) are
    // indistinguishable as empty claim lists — the honest-empty shape.
    const noMatch = CORPUS.find((one) => one.id === "corpus-4")!;
    const textless = CORPUS.find((one) => one.id === "corpus-5")!;
    expect(pin(extractor.extract(noMatch))).toBe(pin(extractor.extract(textless)));
  });

  it("input sensitivity: a changed text changes the digest (no cached outputs)", () => {
    const base = extractor.extract(record("sens-1", "Over 10 million users trust us."));
    const changed = extractor.extract(record("sens-1", "Over 10 million users trust us today."));
    expect(pin(base)).not.toBe(pin(changed));
    const differentRecordId = extractor.extract(
      record("sens-2", "Over 10 million users trust us."),
    );
    expect(pin(base)).not.toBe(pin(differentRecordId));
  });

  it("the corpus obeys the quote discipline end-to-end (the pins are disciplined claims)", () => {
    expectQuoteDiscipline(CORPUS);
  });
});
