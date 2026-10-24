/**
 * WFX-ANON-VIEW-1 — the total parsers for the public web payloads (ported
 * verbatim from the web app's src/lib/youtube/mappers.ts — every parser is
 * total: never throws, never invents; an unparsable text is an honest
 * absence, exactly like the deployed site's own anonymous path).
 */

// ---------------------------------------------------------------------------
// generic tree walking + text helpers
// ---------------------------------------------------------------------------

/** Recursively collect every value stored at `key`, in document order. */
export function walkTree(obj: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === key) out.push(v);
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(obj);
  return out;
}

/** Pick the first value at `key` anywhere in the tree (document order). */
export function findFirst(obj: unknown, key: string): unknown {
  return walkTree(obj, key)[0] ?? null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the public payloads are
loosely typed at this layer (the web app's own discipline); the strong row
types are built by publicMapping.ts. */

/** runs[].text | simpleText | content — the three YouTube text encodings. */
export function runsText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.content === "string") return node.content;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => r?.text ?? "").join("");
  return "";
}

/** Best-quality thumbnail URL from a sources/thumbnails block. */
export function lastThumbnailUrl(node: any): string {
  const thumbs = node?.thumbnails ?? node?.sources;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return "";
  const best = thumbs.reduce((a: any, b: any) => ((b?.width ?? 0) >= (a?.width ?? 0) ? b : a));
  return typeof best?.url === "string" ? best.url : "";
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// numeric text parsing — every parser is total (never throws, never invents)
// ---------------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  K: 1_000,
  M: 1_000_000,
  B: 1_000_000_000,
};

const WORD_MULTIPLIERS: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

/** "12:34" → 754 · "1:02:03" → 3723 · "9 minutes, 26 seconds" → 566 · else null. */
export function parseDurationSec(text: string | null | undefined): number | null {
  if (!text) return null;
  const compact = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (compact !== null) {
    const h = Number(compact[1] ?? 0);
    const m = Number(compact[2]);
    const s = Number(compact[3]);
    if (m < 60 && s < 60) return h * 3600 + m * 60 + s;
    return null;
  }
  const words =
    /^\s*(?:(\d+)\s+hours?,\s*)?(?:(\d+)\s+minutes?,\s*)?(\d+)\s+seconds?\s*$/.exec(text);
  if (words !== null) {
    return Number(words[1] ?? 0) * 3600 + Number(words[2] ?? 0) * 60 + Number(words[3]);
  }
  return null;
}

/** Count text → number. "1.2M"→1.2e6 · "5,561,627"→5561627 · else null. */
export function parseCompactCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*([\d.,]+)\s*([KMB])?\s*$/.exec(text);
  if (m === null) return null;
  const raw = m[1].replace(/,/g, "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const mult = m[2] !== undefined ? MULTIPLIERS[m[2]] : 1;
  return Math.round(value * mult);
}

/** "1.2M views" / "5,561,627 views" / "No views" → number (0 when none). */
export function parseViewCount(text: string | null | undefined): number | null {
  if (!text) return null;
  if (/^no views$/i.test(text.trim())) return 0;
  return parseCompactCount(text.replace(/\s*views?\s*$/i, ""));
}

/** Accessibility variant: "345 thousand views" → 345000. */
export function parseSpelledCount(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*([\d.,]+)\s*(thousand|million|billion)\b/i.exec(text);
  if (m === null) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * WORD_MULTIPLIERS[m[2].toLowerCase()]);
}

/** Views from either the display text or the a11y text (a11y is expanded). */
export function viewsFromTexts(
  display: string | null | undefined,
  a11y: string | null | undefined,
): number | undefined {
  const parsed =
    parseViewCount(a11y) ??
    parseSpelledCount(a11y) ??
    parseViewCount(display) ??
    parseCompactCount(display);
  return parsed ?? undefined;
}

/** "4.55M subscribers" → 4550000 · "918 subscribers" → 918. */
export function parseSubscriberCount(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const spelled = parseSpelledCount(text);
  if (spelled !== null) return spelled;
  return parseCompactCount(text.replace(/\s*subscribers?\s*$/i, "")) ?? undefined;
}

const AGE_UNITS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
  year: 31_536_000,
};

const AGE_UNIT_ALIASES: Record<string, string> = {
  s: "second",
  sec: "second",
  secs: "second",
  second: "second",
  seconds: "second",
  m: "minute",
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  wk: "week",
  week: "week",
  weeks: "week",
  mo: "month",
  month: "month",
  months: "month",
  y: "year",
  yr: "year",
  yrs: "year",
  year: "year",
  years: "year",
};

/**
 * Relative age passthrough → approximate ISO date ("16 years ago" →
 * now-16y, "4mo ago" likewise). The exact passthrough text stays on the row
 * for display; this derives the sortable instant from the real text (an
 * honest approximation of the provider's own relative age, never a guess
 * beyond what the text states).
 */
export function relativeAgeToDate(
  text: string | null | undefined,
  now = new Date(),
): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/^Streamed\s+/i, "").trim();
  const m = /^(\d+)\s*([a-z]+)\s+ago$/i.exec(cleaned);
  if (m === null) return undefined;
  const unit = AGE_UNIT_ALIASES[m[2].toLowerCase()];
  if (unit === undefined) return undefined;
  const seconds = Number(m[1]) * (AGE_UNITS[unit] ?? 0);
  return new Date(now.getTime() - seconds * 1000).toISOString();
}
