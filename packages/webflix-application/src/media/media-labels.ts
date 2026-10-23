/**
 * Deterministic en-US display-label formatting (WFX-PROVIDER-SLICE-1).
 *
 * PRODUCER-FORMATTED LABELS (the frozen media-views law): the card views
 * carry PRE-FORMATTED strings (viewsLabel, publishedLabel, durationLabel,
 * subscriberLabel, videoCountLabel, progressLabel, createdAtLabel) so the
 * shell never guesses locales. The formatting rules here are DETERMINISTIC
 * and documented — fixed en-US conventions, no ambient locale, no wall
 * clock: every time-relative label takes the "now" instant from the
 * injected ClockPort (tests pass a fixed clock), and number formatting
 * uses Intl with a PINNED "en-US" locale (identical output everywhere).
 *
 * Documented rules:
 *   - compactCount: en-US compact notation via TWO pinned Intl formatters
 *     — the mantissa keeps ONE fractional digit while it is < 10 (1,234 →
 *     "1.2K", 2,500,000 → "2.5M", 1,048,576 → "1M") and rounds to whole
 *     units once it is ≥ 10 (12,345 → "12K", 123,456 → "123K") — the
 *     reference app's display convention (mantissa never wider than the
 *     leading digit + one decimal), deterministic everywhere because both
 *     formatters are pinned to "en-US"; values < 1000 print verbatim
 *     (999 → "999", 0 → "0").
 *   - viewsLabel: count 0 → "No views"; otherwise "<compactCount> views"
 *     (12,345 → "12K views"). Absent count → no label.
 *   - publishedLabel (relative, computed against the injected now):
 *     < 60s "just now"; < 60m "N minute(s) ago"; < 24h "N hour(s) ago";
 *     < 7d "N day(s) ago"; < 30d "N week(s) ago"; < 365d "N month(s) ago";
 *     else "N year(s) ago". Unparsable/absent instant → no label.
 *   - durationLabel: ms → "M:SS" under an hour ("4:13"), "H:MM:SS" at or
 *     above ("1:02:03"); rounded down to whole seconds; non-positive or
 *     non-finite input → no label (live rows carry no duration).
 *   - subscriberLabel: "<compactCount> subscribers" ("4.2K subscribers").
 *   - videoCountLabel: "<plain count> videos" ("87 videos").
 *   - progressLabel: "<positionLabel> of <durationLabel>" ("12:34 of 4:13").
 *   - createdAtLabel: "Joined <Month YYYY>" with fixed English month names
 *     ("Joined Feb 2020").
 */

const COMPACT_ONE_DIGIT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const COMPACT_WHOLE = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});

/** The mantissa below which the compact label keeps one fractional digit. */
const COMPACT_FRACTIONAL_MANTISSA_CEILING = 10;

function compactMantissa(value: number): number {
  const abs = Math.abs(value);
  let mantissa = abs;
  while (mantissa >= 1000) mantissa /= 1000;
  return mantissa;
}

/** Compact en-US count: 1234 → "1.2K"; 12,345 → "12K"; 1_048_576 → "1M"; 2_500_000 → "2.5M". */
export function compactCount(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const mantissa = compactMantissa(value);
  return mantissa < COMPACT_FRACTIONAL_MANTISSA_CEILING
    ? COMPACT_ONE_DIGIT.format(value)
    : COMPACT_WHOLE.format(value);
}

const ENGLISH_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Whole-second clock label: 253_000 → "4:13"; 3_723_000 → "1:02:03". */
export function clockLabel(totalMs: number): string | undefined {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return undefined;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const twoDigit = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${twoDigit(minutes)}:${twoDigit(seconds)}` : `${minutes}:${twoDigit(seconds)}`;
}

/** viewsLabel: 0 → "No views"; 12,345 → "12K views"; 1_048_576 → "1M views". */
export function viewsLabel(viewCount: number | undefined): string | undefined {
  if (viewCount === undefined || !Number.isFinite(viewCount) || viewCount < 0) return undefined;
  if (viewCount === 0) return "No views";
  return `${compactCount(viewCount)} views`;
}

/**
 * publishedLabel relative to `now` (the injected ClockPort instant) — the
 * deterministic rule set in the module docblock.
 */
export function relativePublishedLabel(publishedAt: string | undefined, now: Date): string | undefined {
  if (typeof publishedAt !== "string" || publishedAt === "") return undefined;
  const publishedMs = Date.parse(publishedAt);
  if (!Number.isFinite(publishedMs)) return undefined;
  const deltaSeconds = Math.floor((now.getTime() - publishedMs) / 1000);
  if (deltaSeconds < 0) return undefined; // future-dated provider data: no label (honest absence)
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, "day");
  if (days < 30) return plural(Math.floor(days / 7), "week");
  if (days < 365) return plural(Math.floor(days / 30), "month");
  return plural(Math.floor(days / 365), "year");
}

/** subscriberLabel: 4200 → "4.2K subscribers". */
export function subscriberLabel(subscriberCount: number | undefined): string | undefined {
  if (subscriberCount === undefined || !Number.isFinite(subscriberCount) || subscriberCount < 0) {
    return undefined;
  }
  return `${compactCount(subscriberCount)} subscribers`;
}

/** videoCountLabel: 87 → "87 videos". */
export function videoCountLabel(videoCount: number | undefined): string | undefined {
  if (videoCount === undefined || !Number.isFinite(videoCount) || videoCount < 0) return undefined;
  return `${videoCount} videos`;
}

/** progressLabel: "12:34 of 4:13" (needs both facts; else no label). */
export function progressLabel(positionMs: number, durationMs: number | undefined): string | undefined {
  const position = clockLabel(positionMs);
  const duration = durationMs !== undefined ? clockLabel(durationMs) : undefined;
  if (position === undefined || duration === undefined) return undefined;
  return `${position} of ${duration}`;
}

/** createdAtLabel: channel publishedAt → "Joined Feb 2020". */
export function createdAtLabel(publishedAt: string | undefined): string | undefined {
  if (typeof publishedAt !== "string" || publishedAt === "") return undefined;
  const parsed = new Date(publishedAt);
  const year = parsed.getUTCFullYear();
  const monthIndex = parsed.getUTCMonth();
  if (!Number.isFinite(year) || year < 1000 || monthIndex < 0 || monthIndex > 11) return undefined;
  return `Joined ${ENGLISH_MONTHS[monthIndex]} ${year}`;
}

function plural(value: number, unit: "minute" | "hour" | "day" | "week" | "month" | "year"): string {
  return value === 1 ? `1 ${unit} ago` : `${value} ${unit}s ago`;
}
