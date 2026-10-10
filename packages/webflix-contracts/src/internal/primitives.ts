import { z } from "zod";

/**
 * Shared primitive schemas used across the contract modules.
 *
 * These are internal building blocks re-exported through `index.ts` so
 * downstream packages can compose with the exact primitives the locked
 * shapes are built from.
 */

/** ISO 8601 UTC instant, e.g. `2025-06-01T12:00:00Z`. */
export const IsoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    "must be an ISO 8601 UTC instant such as 2025-06-01T12:00:00Z",
  );
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** ISO 3166-1 alpha-2 region code, e.g. `US`. */
export const RegionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "must be an ISO 3166-1 alpha-2 region code such as US");
export type RegionCode = z.infer<typeof RegionCodeSchema>;

/**
 * Best-effort detectors for raw secret material. Credentials live in the
 * main-process keychain and cross boundaries only as opaque handles, so
 * anything that trips these detectors must never appear in a contract.
 */
const SECRET_NAME_RE =
  /(?:api[-_]?key|api[-_]?secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|id[-_]?token|password|credential|private[-_]?key)/i;
const SECRET_ASSIGN_RE =
  /(?:^|[&?#[\s_;=-])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password|signature|auth|credential)[-_=]/i;

/** Returns true when `value` looks like raw secret material. */
export function looksLikeSecret(value: string): boolean {
  return SECRET_NAME_RE.test(value) || SECRET_ASSIGN_RE.test(value);
}

/** WHATWG-parseable absolute URL check (http(s) or app/deep-link schemes). */
function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

/**
 * Absolute URL, either `http(s)` or an application/deep-link scheme such as
 * `spotify:track:…`. Validated with the WHATWG URL parser so behaviour is
 * identical everywhere, and hard-refused when it carries raw secret
 * material (credentialed URLs are resolved at playback time, never stored
 * in contracts).
 */
export const AbsoluteUrlSchema = z
  .string()
  .min(1)
  .refine(isAbsoluteUrl, {
    message: "must be an absolute http(s) or app-scheme URL",
  })
  .refine((value) => !looksLikeSecret(value), {
    message: "url must not contain raw secret material (tokens, api keys, passwords, signatures)",
  });
export type AbsoluteUrl = z.infer<typeof AbsoluteUrlSchema>;

/** A string that must never contain raw secret material. */
export const SecretFreeStringSchema = z.string().refine((value) => !looksLikeSecret(value), {
  message: "string must not contain raw secret material (tokens, api keys, passwords, signatures)",
});

/**
 * A string-keyed record whose keys and string values are free of secret
 * material. Used for provider-defined payloads such as embed specs.
 */
export const SecretFreeRecordSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (record) =>
      Object.keys(record).every((key) => !looksLikeSecret(key)) &&
      Object.values(record).every((value) => typeof value !== "string" || !looksLikeSecret(value)),
    {
      message: "record must not contain raw secret material in keys or string values",
    },
  );
