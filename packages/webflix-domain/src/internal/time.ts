import { ErrorCode, WebFlixError } from "webflix-contracts";
import type { IsoDateTime } from "webflix-contracts";

const ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * Pure ISO 8601 UTC instant → epoch milliseconds.
 *
 * Hand-rolled instead of `Date.parse` so fractional seconds compare
 * correctly regardless of engine quirks; no I/O involved. Returns NaN for
 * strings that do not match the locked contract instant shape.
 */
export function parseIsoToEpochMs(iso: string): number {
  const match = ISO_INSTANT_RE.exec(iso);
  if (!match) return Number.NaN;
  const millis = match[7] === undefined ? 0 : Number(match[7].padEnd(3, "0"));
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    millis,
  );
}

/**
 * Total order over two contract instants: -1 | 0 | 1.
 *
 * Lexicographic comparison is NOT safe here (`…:00.500Z` sorts before
 * `…:00Z` as raw strings), so both sides are parsed to epoch ms first.
 * Throws a typed WebFlixError on non-contract instants.
 */
export function compareInstants(a: IsoDateTime, b: IsoDateTime): -1 | 0 | 1 {
  const epochA = parseIsoToEpochMs(a);
  const epochB = parseIsoToEpochMs(b);
  if (Number.isNaN(epochA) || Number.isNaN(epochB)) {
    throw new WebFlixError({
      code: ErrorCode.Unknown,
      reason: `invalid ISO instant: ${Number.isNaN(epochA) ? a : b}`,
      retryable: false,
      context: { a, b },
    });
  }
  return epochA < epochB ? -1 : epochA > epochB ? 1 : 0;
}
