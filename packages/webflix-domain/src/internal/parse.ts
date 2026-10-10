import { ErrorCode, WebFlixError } from "webflix-contracts";

/**
 * Runtime input guard for domain rules.
 *
 * Domain functions accept contract instances and re-validate them with the
 * locked zod schemas re-exported from `webflix-contracts`, rethrowing any
 * failure as a typed `WebFlixError` so no raw zod error ever escapes the
 * domain layer. Pure: no I/O, no clock, no globals.
 */
export function parseOrThrow<T>(
  schema: { parse(value: unknown): T },
  value: unknown,
  code: ErrorCode,
  what: string,
): T {
  try {
    return schema.parse(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "invalid input";
    const context: Record<string, unknown> = { subject: what };
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues)) context.issues = issues;
    throw new WebFlixError({
      code,
      reason: `${what}: ${detail}`,
      retryable: false,
      context,
    });
  }
}
