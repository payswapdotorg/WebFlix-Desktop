import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";

/** Lifecycle of a linked provider account, as observed by the renderer. */
export const ProviderAccountStatusSchema = z.enum([
  "connected",
  "expired",
  "revoked",
]);
export type ProviderAccountStatus = z.infer<typeof ProviderAccountStatusSchema>;

/**
 * Renderer-safe record of a linked provider account. This shape crosses the
 * IPC boundary into the renderer, so it parses as a *strict* object: unknown
 * keys — and therefore tokens or any other credential material — are
 * rejected at parse time. Tokens never leave the main process; renderers
 * only ever reference credentials through {@link CredentialRef} handles.
 */
export const ProviderAccountRecordSchema = z.strictObject({
  providerId: z.string().min(1),
  /** Stable, installation-local id for the linked account. */
  internalAccountId: z.string().min(1),
  displayName: z.string().min(1),
  /** Scope names granted during OAuth, e.g. `youtube.readonly`. */
  grantedScopes: z.array(z.string().min(1)).default([]),
  status: ProviderAccountStatusSchema,
  connectedAt: IsoDateTimeSchema,
  /** When the grant expires, when the provider reports one. */
  expiresAt: IsoDateTimeSchema.optional(),
});
export type ProviderAccountRecord = z.infer<typeof ProviderAccountRecordSchema>;

/**
 * Opaque reference to a credential held in the main-process keychain.
 * `handle` is NOT a token — it is a lookup key that only the main process
 * can resolve. Renderer-safe by construction.
 */
export interface CredentialRef {
  readonly handle: string;
}

/**
 * Main-process port for resolving credentials. INTERFACE ONLY by design:
 * the contracts package defines the seam, the host app implements it (e.g.
 * over IPC to a keychain-backed service). Never implement, serialize, or
 * zod-wrap credential material inside this package.
 */
export interface CredentialPort {
  getToken(
    providerId: string,
    internalAccountId: string,
  ): Promise<CredentialRef>;
}
