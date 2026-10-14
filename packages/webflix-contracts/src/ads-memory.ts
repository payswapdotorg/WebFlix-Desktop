/**
 * Ad Center personal-memory contract shapes (Phase 7, P7-AD-MEMORY-1 —
 * WF-029 ad personal memory, honestly).
 *
 * ADDITIVE module (semver minor 0.12.0 -> 0.13.0 per the §3 method): the
 * frozen §2.1–2.6 shapes, the intelligence modules and every earlier
 * additive sibling (ads, ads-sources, search) are untouched. Like
 * ./ads-sources, this module is an ads-lane sibling that imports ONLY the
 * shared primitives (`./internal/primitives`) — nothing from the
 * intelligence/ranking modules, in either direction (phase5-ad-plan §3;
 * the architecture-check `ads-separation` rules pin both directions, and
 * this file matches their `ads*.ts` glob).
 *
 * What this module is: the EXPLICIT OPT-IN personal memory seam's data
 * shapes — the closed consent-scope union, the per-scope consent record
 * (grants + revocations with timestamps), the saved-ad record, the
 * user observation with its user-stated provenance label, the memory
 * entry union, and the typed refusal reasons. Honesty rules encoded
 * here, binding on every implementation:
 *
 * - CONSENT IS DATA, NEVER AMBIENT: every memory operation is gated by an
 *   explicit per-scope consent record the user granted through an explicit
 *   action — never by a default, never by inference, never by a timeout.
 *   A scope without a consent record is CLOSED (the honest initial
 *   state); refusal is the typed answer, never an exception, never a
 *   silent no-op. Revocation is likewise data: a consent record carrying
 *   `revokedAt` closes the scope again, mid-flight, with the refusal
 *   carrying the record as its evidence.
 * - THE REFUSALS ARE DATA, NOT FAILURES: `ads-memory/consent-required`
 *   and `ads-memory/scope-revoked` are typed reason VALUES carried in
 *   results (the AdMemoryRefusal union), surfaced with their scope and —
 *   for a revocation — the consent record that refused the action. They
 *   are never thrown, never hidden, never converted into empty results.
 * - USER-STATED PROVENANCE, CLEARLY LABELED: a UserObservation is what
 *   the USER reported about an ad or one of its claims. Its provenance is
 *   the closed literal `user-stated` — the only value the field can carry
 *   — so a user observation can never present itself as source-backed
 *   evidence (the source-reported shapes live in ./ads and are never
 *   mirrored here). Nothing in the memory lane normalizes, scores, or
 *   upgrades a user's words into a verification state.
 * - NO CROSS-SOURCE LINKING: a memory entry references exactly what the
 *   user explicitly pointed it at (one ad record id, optionally one
 *   claim id) and NOTHING else — there is no field that joins entries to
 *   each other, groups them by advertiser, or enriches them with the Ad
 *   Center's stored source-reported data. Linkage happens only through
 *   the user's own explicit actions; these shapes make auto-joining
 *   structurally unrepresentable.
 * - NO RANKING SIGNALS, NO AMBIENT CAPTURE: nothing here feeds the
 *   organic ranking path, and nothing here observes the user — the
 *   shapes carry user actions only (the architecture rule pins the
 *   separation).
 */
import { z } from "zod";
import { IsoDateTimeSchema } from "./internal/primitives";

// ---------------------------------------------------------------------------
// The consent scopes — the closed union of what memory can exist for
// ---------------------------------------------------------------------------

/**
 * The explicit consent scopes of the Ad Center's personal memory — a
 * closed union, extended only by a future additive order. Each scope is
 * consented to INDEPENDENTLY: a grant for one scope never implies a grant
 * for any other, and every memory operation names the single scope it
 * rides. This order carries exactly two:
 * - `saved-ads`: the ads the user explicitly saved (with their own note);
 * - `observations`: the user's own reported observations about ads or
 *   claims (user-stated, clearly labeled).
 */
export const AdMemoryScopeSchema = z.enum(["saved-ads", "observations"]);
export type AdMemoryScope = z.infer<typeof AdMemoryScopeSchema>;

// ---------------------------------------------------------------------------
// AdMemoryConsent — the per-scope grant/revocation record (consent is DATA)
// ---------------------------------------------------------------------------

/**
 * The per-scope consent record — the DATA a memory operation is gated by.
 * One record per scope (the put-replaces house semantic): `grantedAt` is
 * the instant of the user's explicit grant; `revokedAt` is the instant of
 * their explicit revocation, ABSENT while the grant stands (the scope is
 * open). A revocation closes the scope mid-flight — subsequent operations
 * on that scope refuse with the typed `ads-memory/scope-revoked` reason
 * carrying this record as evidence. A re-grant after revocation replaces
 * the record with a fresh grant (the CURRENT state; prior grant/revocation
 * instants are not a history this shape keeps — a durable adapter order
 * may keep one behind the same seam). A scope with NO record is the
 * honest never-consented state: closed, refusing with
 * `ads-memory/consent-required` — never defaulted open, never ambient.
 */
export const AdMemoryConsentSchema = z
  .object({
    /** The scope this consent governs. */
    scope: AdMemoryScopeSchema,
    /** When the user granted the scope (an explicit action, never inferred). */
    grantedAt: IsoDateTimeSchema,
    /** When the user revoked the scope; absent while the grant stands. */
    revokedAt: IsoDateTimeSchema.optional(),
  })
  .superRefine((consent, ctx) => {
    if (consent.revokedAt !== undefined && consent.revokedAt < consent.grantedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a consent revocation must not precede its grant",
      });
    }
  });
export type AdMemoryConsent = z.infer<typeof AdMemoryConsentSchema>;

// ---------------------------------------------------------------------------
// SavedAdRecord — an AdRecord reference + the user's note + saved-at
// ---------------------------------------------------------------------------

/**
 * One saved ad: a REFERENCE to an Ad Center AdRecord (its id — the record
 * itself is never copied or mirrored here), the user's own note about it
 * (honest-absent when they wrote none — never a placeholder), and the
 * instant the user saved it. The memory lane does not resolve the
 * reference: a saved ad whose record was later removed (or was never
 * imported) stays stored as the user's memory — an honest dangling
 * reference, exactly like the claims of a deleted record stay stored and
 * readable (the AdRecordStore.delete rule). Nothing on this shape links
 * it to any other memory entry.
 */
export const SavedAdRecordSchema = z.object({
  /** The memory-entry kind discriminator (an AdMemoryEntry variant). */
  kind: z.literal("saved-ad"),
  /** The saved record's own id (minted by the use case per save action). */
  id: z.string().min(1),
  /** The Ad Center AdRecord id this save references (user-chosen). */
  adRecordId: z.string().min(1),
  /** The user's own note, verbatim; absent when they wrote none. */
  note: z.string().min(1).optional(),
  /** When the user saved the ad (an explicit action, injected clock). */
  savedAt: IsoDateTimeSchema,
});
export type SavedAdRecord = z.infer<typeof SavedAdRecordSchema>;

// ---------------------------------------------------------------------------
// UserObservation — the user's own report, provenance = user-stated
// ---------------------------------------------------------------------------

/**
 * The provenance label of a user observation: the closed literal
 * `user-stated` — the ONLY value this field can ever carry. A user
 * observation is what the USER reported; it can never present itself as
 * source-backed evidence, and no field on the observation names a
 * transparency source, an import batch, or any source-reported fact (the
 * source-reported shapes live in ./ads and are never mirrored here).
 */
export const UserObservationProvenanceSchema = z.literal("user-stated");
export type UserObservationProvenance = z.infer<typeof UserObservationProvenanceSchema>;

/**
 * One user observation: the user's own claim/evidence note about an ad —
 * optionally attached to ONE claim of that ad when the user explicitly
 * chose it (the only linkage a memory entry can carry) — with the
 * user-stated provenance label and the instant the user recorded it. The
 * note is the user's words, verbatim (no trim, no normalization — the
 * extractive house discipline applied to user input). Nothing here
 * scores, verifies, or upgrades the user's statement; nothing joins it
 * to any other memory entry or to the Ad Center's stored source-reported
 * data. It is DATA the user stated, clearly labeled as such.
 */
export const UserObservationSchema = z.object({
  /** The memory-entry kind discriminator (an AdMemoryEntry variant). */
  kind: z.literal("user-observation"),
  /** The observation's own id (minted by the use case per record action). */
  id: z.string().min(1),
  /** The Ad Center AdRecord id this observation is about (user-chosen). */
  adRecordId: z.string().min(1),
  /** The Claim id this observation attaches to; absent when unattached. */
  claimId: z.string().min(1).optional(),
  /** What the user stated — their own words, verbatim. */
  note: z.string().min(1),
  /** The provenance label: user-stated, structurally the only value. */
  provenance: UserObservationProvenanceSchema,
  /** When the user recorded the observation (an explicit action, injected clock). */
  recordedAt: IsoDateTimeSchema,
});
export type UserObservation = z.infer<typeof UserObservationSchema>;

// ---------------------------------------------------------------------------
// AdMemoryEntry — the union of what personal memory holds
// ---------------------------------------------------------------------------

/**
 * One personal-memory entry: a saved ad or a user observation — the two
 * consent scopes' record shapes, discriminated by `kind`. The listing
 * surface returns this union; each variant carries exactly the fields the
 * user's explicit action produced (plus its own id and instant) and
 * NOTHING that joins it to other entries, groups it with them, or
 * enriches it with source-reported data.
 */
export const AdMemoryEntrySchema = z.discriminatedUnion("kind", [
  SavedAdRecordSchema,
  UserObservationSchema,
]);
export type AdMemoryEntry = z.infer<typeof AdMemoryEntrySchema>;

// ---------------------------------------------------------------------------
// The typed refusals — DATA, never thrown
// ---------------------------------------------------------------------------

/**
 * The typed refusal reasons of the ad-memory lane. Refusing is the HONEST
 * answer of a closed scope — a state, carried as DATA in results, never
 * an exception and never a silent no-op:
 * - `ads-memory/consent-required`: the scope has no consent record (the
 *   honest never-consented state) — the memory operation was refused
 *   before anything was read or written;
 * - `ads-memory/scope-revoked`: the scope's consent record carries a
 *   revocation — the memory operation was refused mid-flight, and the
 *   refusal carries the record as its evidence (re-granting is the
 *   recovery, forget is the deletion path).
 */
export const AdMemoryRefusalReasonSchema = z.enum([
  "ads-memory/consent-required",
  "ads-memory/scope-revoked",
]);
export type AdMemoryRefusalReason = z.infer<typeof AdMemoryRefusalReasonSchema>;

/**
 * One typed refusal, a discriminated union on `reason`: the scope it
 * refuses for, and — for a revocation — the consent record whose
 * `revokedAt` closed the scope (the evidence, so a surface can state the
 * closure honestly). The superRefine pins the shape's own honesty: a
 * `scope-revoked` refusal must carry a consent record that actually IS
 * revoked, for the SAME scope it refuses — a refusal that misstates its
 * evidence is not a valid AdMemoryRefusal.
 */
export const AdMemoryRefusalSchema = z
  .discriminatedUnion("reason", [
    z.object({
      reason: z.literal("ads-memory/consent-required"),
      scope: AdMemoryScopeSchema,
    }),
    z.object({
      reason: z.literal("ads-memory/scope-revoked"),
      scope: AdMemoryScopeSchema,
      /** The revoked consent record that closed the scope (the evidence). */
      consent: AdMemoryConsentSchema,
    }),
  ])
  .superRefine((refusal, ctx) => {
    if (refusal.reason === "ads-memory/scope-revoked") {
      if (refusal.consent.revokedAt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "a scope-revoked refusal must carry a consent record with revokedAt set — the evidence must actually be a revocation",
        });
      }
      if (refusal.consent.scope !== refusal.scope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "a refusal's consent record must be for the same scope it refuses",
        });
      }
    }
  });
export type AdMemoryRefusal = z.infer<typeof AdMemoryRefusalSchema>;
