/**
 * Contract-parse guard for the application layer (P4-CONTRACTS).
 *
 * Mirrors webflix-domain's internal parseOrThrow (application cannot import
 * webflix-domain this order: the package manifest edge application->domain
 * is in the binding freeze table but declaring it requires a root
 * pnpm-lock.yaml change, which is outside this order's allowed paths — see
 * the P4-FD1 proposal in the delivery report). Same semantics: re-validate
 * through the locked zod schema, rethrow as a typed WebFlixError so no raw
 * zod error ever escapes.
 */
import { WebFlixError } from "webflix-contracts";
import { ErrorCode } from "webflix-contracts";

export function parseContractOrThrow<T>(
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
