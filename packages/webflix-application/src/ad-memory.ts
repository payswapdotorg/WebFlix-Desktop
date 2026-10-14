/**
 * Ad Center personal memory use cases (P7-AD-MEMORY-1 — WF-029) — the
 * EXPLICIT OPT-IN memory lane over the 0.13.0 ads-memory contract shapes,
 * the history-retention.ts house pattern (ports owned by the lane file,
 * in-memory doubles in ./in-memory-ad-memory-stores.ts, plain typed use
 * cases — no §2.6 job wrapper, no engine, no network, no telemetry).
 *
 * Semantics, stated honestly (each rule is pinned by a hermetic test):
 *
 * - CONSENT IS DATA AND IT GATES EVERY OPERATION: each of saveAd /
 *   forgetAd / recordObservation / listMemory resolves the per-scope
 *   consent record FIRST and refuses with the TYPED AdMemoryRefusal when
 *   the scope was never granted (`ads-memory/consent-required`) or its
 *   grant was revoked (`ads-memory/scope-revoked`, carrying the revoked
 *   record as evidence). A refusal is a STATE returned as DATA — never an
 *   exception, never a silent no-op, never a pretend-empty result. There
 *   is NO ambient path around the gate: nothing observes the user, no
 *   write happens without the grant, and one scope's grant never implies
 *   another's (the scopes are consented to independently).
 * - CONSENT IS WRITTEN ONLY BY EXPLICIT USER ACTION: GrantAdMemoryConsent
 *   / RevokeAdMemoryConsent are the only writers of the consent store,
 *   stamping the injected clock's instant (never a wall clock, never an
 *   inferred one). Revoking a never-granted scope is the honest typed
 *   `never-granted` outcome — no fabricated grant record is minted to
 *   record a closure that already exists. Re-granting after a revocation
 *   replaces the record with a fresh grant (the CURRENT-state semantic of
 *   the 0.13.0 shape — the scope re-opens; the memory it held is still
 *   there, because deletion is forget's explicit path, never a revocation
 *   side effect).
 * - SAVE/FORGET SEMANTICS: saved ads are keyed per adRecordId — re-saving
 *   an ad replaces the save (fresh note + fresh savedAt, the put-replaces
 *   house semantic; a save is the user's CURRENT relationship with the
 *   ad). forgetAd removes exactly one save and answers the honest typed
 *   `absent` when nothing was saved for that ad. The memory lane never
 *   resolves the ad-record reference (a dangling reference stays stored,
 *   the AdRecordStore.delete rule) and never cascades a forget into the
 *   observations or the Ad Center stores.
 * - OBSERVATIONS ARE USER-STATED, CLEARLY LABELED: every recorded
 *   observation carries the closed `user-stated` provenance literal —
 *   structurally the only value — and is never conflated with
 *   source-backed evidence: no field of the memory lane names a
 *   transparency source, an import batch, or a verification state. An
 *   observation MAY attach to one claim id when the user explicitly
 *   chose it (the only linkage an entry can carry).
 * - NO CROSS-SOURCE LINKING: memory entries never auto-join across
 *   sources — listMemory returns the FLAT entry list (saved ads then
 *   observations, each in its store's deterministic order), byte-equal to
 *   the stored records, never grouped, never enriched with the Ad
 *   Center's stored source-reported data. Linkage exists only through
 *   the user's own explicit reference choices (adRecordId / claimId).
 * - LIST NEVER HIDES A CLOSED SCOPE: listMemory lists the entries of
 *   every scope whose consent stands AND carries one typed refusal row
 *   per scope that is closed (never-consented or revoked) — the
 *   never-hide discipline (a federation never hides a failed source;
 *   a memory listing never hides a closed scope).
 * - PER-PROFILE ISOLATION (ADR-0003): every store instance is
 *   profile-scoped by construction — the composition root instantiates
 *   one set per profile and no port crosses profiles (the same law every
 *   store lane states; pinned by an isolation test over two fresh sets).
 *
 * NO durable storage this order (the in-memory doubles are the pure-test
 * defaults; the durable adapters follow the P5-STORES pattern in a later
 * row if sanctioned). NO shell/UI changes. NO provider calls. NO
 * telemetry. NO edits to existing use-case files.
 */
import type {
  AdMemoryConsent,
  AdMemoryEntry,
  AdMemoryRefusal,
  AdMemoryScope,
  SavedAdRecord,
  UserObservation,
} from "webflix-contracts";
import {
  AdMemoryConsentSchema,
  AdMemoryRefusalSchema,
  SavedAdRecordSchema,
  UserObservationSchema,
} from "webflix-contracts";
import type { ClockPort, IdGenerator } from "./ports";

// ---------------------------------------------------------------------------
// Typed rule codes — application-local (the RetentionRuleError precedent:
// no shared ErrorCode exists for this lane and none is added this order)
// ---------------------------------------------------------------------------

/** The caller-defect / shape-violation codes of the ad-memory lane. */
export type AdMemoryRuleCode =
  | "invalid-scope"
  | "invalid-consent"
  | "invalid-saved-ad"
  | "invalid-observation"
  | "invalid-refusal";

/** Raised when an ad-memory operation violates a shape/rule (typed, local). */
export class AdMemoryRuleError extends Error {
  readonly code: AdMemoryRuleCode;

  constructor(code: AdMemoryRuleCode, message: string) {
    super(message);
    this.name = "AdMemoryRuleError";
    this.code = code;
  }
}

/** Runtime guard for scope values crossing untyped boundaries. */
export function isAdMemoryScope(value: unknown): value is AdMemoryScope {
  return value === "saved-ads" || value === "observations";
}

/** Defensive shape validation — the same check the durable adapter runs. */
export function assertValidAdMemoryConsent(consent: AdMemoryConsent): void {
  const parsed = AdMemoryConsentSchema.safeParse(consent);
  if (!parsed.success) {
    throw new AdMemoryRuleError(
      "invalid-consent",
      `not a valid AdMemoryConsent (scope, ISO-8601 UTC grantedAt, optional revokedAt not preceding the grant required, got ${JSON.stringify(consent)})`,
    );
  }
}

/** Defensive shape validation — the same check the durable adapter runs. */
export function assertValidSavedAdRecord(record: SavedAdRecord): void {
  const parsed = SavedAdRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new AdMemoryRuleError(
      "invalid-saved-ad",
      `not a valid SavedAdRecord (kind "saved-ad", non-empty id/adRecordId, optional non-empty note, ISO-8601 UTC savedAt required, got ${JSON.stringify(record)})`,
    );
  }
}

/** Defensive shape validation — the same check the durable adapter runs. */
export function assertValidUserObservation(observation: UserObservation): void {
  const parsed = UserObservationSchema.safeParse(observation);
  if (!parsed.success) {
    throw new AdMemoryRuleError(
      "invalid-observation",
      `not a valid UserObservation (kind "user-observation", non-empty id/adRecordId/note, optional non-empty claimId, provenance "user-stated", ISO-8601 UTC recordedAt required, got ${JSON.stringify(observation)})`,
    );
  }
}

/** Defensive shape validation for refusals crossing untyped boundaries. */
export function assertValidAdMemoryRefusal(refusal: AdMemoryRefusal): void {
  const parsed = AdMemoryRefusalSchema.safeParse(refusal);
  if (!parsed.success) {
    throw new AdMemoryRuleError(
      "invalid-refusal",
      `not a valid AdMemoryRefusal (reason ads-memory/consent-required | ads-memory/scope-revoked, matching scope, and — for a revocation — a consent record actually revoked for the same scope, got ${JSON.stringify(refusal)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Ports — the ad-memory seams (in-memory defaults in
// ./in-memory-ad-memory-stores.ts)
// ---------------------------------------------------------------------------

/**
 * Per-profile consent store: one AdMemoryConsent record per scope, written
 * ONLY by the explicit grant/revoke use cases. `get` answers null for the
 * honest never-consented state; `put` replaces wholesale for the record's
 * scope (the CURRENT-state semantic); `list` is deterministic (the closed
 * scope-union order). Implementations MUST validate the shape on write
 * (typed AdMemoryRuleError, never a silently-mangled record).
 */
export interface AdMemoryConsentStore {
  /** The stored consent for one scope, or null when the user never acted. */
  get(scope: AdMemoryScope): Promise<AdMemoryConsent | null>;
  /** Persists (or replaces wholesale) the consent record for its scope. */
  put(consent: AdMemoryConsent): Promise<void>;
  /** Every stored consent record, deterministic order (scope-union order). */
  list(): Promise<readonly AdMemoryConsent[]>;
}

/**
 * Per-profile saved-ad store, keyed per adRecordId (one CURRENT save per
 * ad — the put-replaces house semantic; re-saving an ad replaces the note
 * and the instant). `get` answers null for the honest never-saved state
 * (absence is the lane's own null-answering surface: the memory lane has
 * no ads/*-absent error code because a missing save is not a defect, it
 * is the pre-action state); `delete` removes exactly one save and answers
 * whether it existed. Listing is deterministic (insertion order).
 */
export interface SavedAdStore {
  /** Persists (or replaces wholesale) the saved record for its ad. */
  put(record: SavedAdRecord): Promise<void>;
  /** The saved record for one ad, or null when the ad was never saved. */
  get(adRecordId: string): Promise<SavedAdRecord | null>;
  /** Every saved record, deterministic order (insertion order). */
  list(): Promise<readonly SavedAdRecord[]>;
  /** Removes the saved record for one ad; true when it existed. */
  delete(adRecordId: string): Promise<boolean>;
}

/** Idempotent-append outcome for observations (append-only user event log). */
export type UserObservationAppendResult =
  | { readonly outcome: "appended"; readonly observation: UserObservation }
  /** Same id as a stored observation: the store returns the stored one. */
  | { readonly outcome: "duplicate"; readonly existing: UserObservation };

/**
 * Per-profile user-observation store: the append-only event log of the
 * user's own reports (each an explicit action at its own instant — N
 * record calls are N observations, never deduplicated by content).
 * `append` is idempotent-by-id (a stored id re-appends as a duplicate
 * returning the STORED observation — the FeedbackStore house rule);
 * listing is deterministic (insertion order). There is no put, no
 * delete, no clearAll this order — observation management beyond
 * recording is a later surface if sanctioned.
 */
export interface UserObservationStore {
  /** Appends one observation; a stored id re-appends as a duplicate. */
  append(observation: UserObservation): Promise<UserObservationAppendResult>;
  /** Every stored observation, deterministic order (insertion order). */
  list(): Promise<readonly UserObservation[]>;
}

// ---------------------------------------------------------------------------
// The consent gate — resolved FIRST by every memory operation
// ---------------------------------------------------------------------------

/** The resolved state of one scope's consent (never ambient). */
type ConsentState =
  | { readonly state: "granted" }
  | { readonly state: "never-consented" }
  | { readonly state: "revoked"; readonly consent: AdMemoryConsent };

async function resolveConsentState(
  store: AdMemoryConsentStore,
  scope: AdMemoryScope,
): Promise<ConsentState> {
  const consent = await store.get(scope);
  if (consent === null) {
    return { state: "never-consented" };
  }
  if (consent.revokedAt !== undefined) {
    return { state: "revoked", consent };
  }
  return { state: "granted" };
}

/** The typed refusal for a closed scope (never-consented or revoked). */
function refusalFor(state: ConsentState, scope: AdMemoryScope): AdMemoryRefusal {
  if (state.state === "revoked") {
    return { reason: "ads-memory/scope-revoked", scope, consent: state.consent };
  }
  return { reason: "ads-memory/consent-required", scope };
}

/** The closed scope list in union order (deterministic listing). */
const AD_MEMORY_SCOPES: readonly AdMemoryScope[] = ["saved-ads", "observations"];

// ---------------------------------------------------------------------------
// Use cases 1+2 — grant / revoke consent (the ONLY consent writers)
// ---------------------------------------------------------------------------

export interface AdMemoryConsentDeps {
  readonly consent: AdMemoryConsentStore;
  readonly clock: ClockPort;
}

export interface AdMemoryScopeInput {
  readonly scope: AdMemoryScope;
}

/**
 * Grants one memory scope — an explicit user action, stamped from the
 * injected clock. Re-granting after a revocation replaces the record with
 * a fresh grant (the scope re-opens; the memory it held is untouched —
 * deletion is forget's explicit path, never a consent side effect). The
 * written record is returned so the surface can render the confirmed
 * state.
 */
export class GrantAdMemoryConsent {
  constructor(private readonly deps: AdMemoryConsentDeps) {}

  async grant(input: AdMemoryScopeInput): Promise<AdMemoryConsent> {
    if (!isAdMemoryScope(input.scope)) {
      throw new AdMemoryRuleError(
        "invalid-scope",
        `unknown ad-memory scope ${JSON.stringify(input.scope)} — expected one of saved-ads | observations`,
      );
    }
    const consent: AdMemoryConsent = {
      scope: input.scope,
      grantedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.consent.put(consent);
    return consent;
  }
}

/** The typed outcome of a revocation (a never-granted scope is honest data). */
export type RevokeAdMemoryConsentResult =
  | { readonly outcome: "revoked"; readonly consent: AdMemoryConsent }
  /**
   * The scope was never granted: nothing was written (no fabricated grant
   * record is minted to record a closure that already exists) — the
   * honest typed answer.
   */
  | { readonly outcome: "never-granted" };

/**
 * Revokes one memory scope — an explicit user action that closes the
 * scope mid-flight: subsequent operations on that scope refuse with the
 * typed `ads-memory/scope-revoked` reason carrying the revoked record.
 * Revoking a never-granted scope answers `never-granted` and writes
 * nothing. Re-granting is the recovery (GrantAdMemoryConsent).
 */
export class RevokeAdMemoryConsent {
  constructor(private readonly deps: AdMemoryConsentDeps) {}

  async revoke(input: AdMemoryScopeInput): Promise<RevokeAdMemoryConsentResult> {
    if (!isAdMemoryScope(input.scope)) {
      throw new AdMemoryRuleError(
        "invalid-scope",
        `unknown ad-memory scope ${JSON.stringify(input.scope)} — expected one of saved-ads | observations`,
      );
    }
    const current = await this.deps.consent.get(input.scope);
    if (current === null) {
      return { outcome: "never-granted" };
    }
    const consent: AdMemoryConsent = {
      scope: input.scope,
      grantedAt: current.grantedAt,
      revokedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.consent.put(consent);
    return { outcome: "revoked", consent };
  }
}

// ---------------------------------------------------------------------------
// Use case 3 — saveAd (gated by the saved-ads scope consent)
// ---------------------------------------------------------------------------

export interface SaveAdInput {
  /** The Ad Center AdRecord id the user is saving (their explicit choice). */
  readonly adRecordId: string;
  /** The user's own note; absent when they wrote none. */
  readonly note?: string;
}

/** The typed outcome of a save: saved, or refused by the consent gate. */
export type SaveAdResult =
  | { readonly outcome: "saved"; readonly record: SavedAdRecord }
  | { readonly outcome: "refused"; readonly refusal: AdMemoryRefusal };

export interface SaveAdDeps {
  readonly consent: AdMemoryConsentStore;
  readonly savedAds: SavedAdStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

/**
 * Saves one ad into personal memory — an explicit user action gated by
 * the `saved-ads` scope consent. Re-saving an ad replaces the save (the
 * fresh note + fresh savedAt — the user's CURRENT relationship with the
 * ad; put-replaces keyed per adRecordId). The record references the ad
 * by id only; the memory lane never resolves the reference, never copies
 * the ad's content, and never links the save to any other memory entry.
 */
export class SaveAd {
  constructor(private readonly deps: SaveAdDeps) {}

  async save(input: SaveAdInput): Promise<SaveAdResult> {
    const state = await resolveConsentState(this.deps.consent, "saved-ads");
    if (state.state !== "granted") {
      return { outcome: "refused", refusal: refusalFor(state, "saved-ads") };
    }
    const record: SavedAdRecord = {
      kind: "saved-ad",
      id: this.deps.generateId(),
      adRecordId: input.adRecordId,
      ...(input.note !== undefined ? { note: input.note } : {}),
      savedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.savedAds.put(record);
    return { outcome: "saved", record };
  }
}

// ---------------------------------------------------------------------------
// Use case 4 — forgetAd (gated by the saved-ads scope consent)
// ---------------------------------------------------------------------------

export interface ForgetAdInput {
  /** The Ad Center AdRecord id whose save is being forgotten. */
  readonly adRecordId: string;
}

/**
 * The typed outcome of a forget: forgotten (the save existed and was
 * removed), absent (nothing was saved for that ad — the honest
 * pre-action state), or refused by the consent gate.
 */
export type ForgetAdResult =
  | { readonly outcome: "forgotten"; readonly adRecordId: string }
  | { readonly outcome: "absent" }
  | { readonly outcome: "refused"; readonly refusal: AdMemoryRefusal };

export interface ForgetAdDeps {
  readonly consent: AdMemoryConsentStore;
  readonly savedAds: SavedAdStore;
}

/**
 * Forgets one saved ad — an explicit user action gated by the `saved-ads`
 * scope consent (each memory operation resolves the gate, per the order).
 * Removes exactly one save (delete keyed per adRecordId) and NEVER
 * cascades: the observations, the Ad Center stores, and every other save
 * stay byte-identical. Nothing was saved for the ad → the honest typed
 * `absent` outcome, never an error, never a pretend-success.
 */
export class ForgetAd {
  constructor(private readonly deps: ForgetAdDeps) {}

  async forget(input: ForgetAdInput): Promise<ForgetAdResult> {
    const state = await resolveConsentState(this.deps.consent, "saved-ads");
    if (state.state !== "granted") {
      return { outcome: "refused", refusal: refusalFor(state, "saved-ads") };
    }
    const removed = await this.deps.savedAds.delete(input.adRecordId);
    return removed ? { outcome: "forgotten", adRecordId: input.adRecordId } : { outcome: "absent" };
  }
}

// ---------------------------------------------------------------------------
// Use case 5 — recordObservation (gated by the observations scope consent)
// ---------------------------------------------------------------------------

export interface RecordObservationInput {
  /** The Ad Center AdRecord id the observation is about (user-chosen). */
  readonly adRecordId: string;
  /** The Claim id the observation attaches to; absent when unattached. */
  readonly claimId?: string;
  /** What the user stated — their own words, verbatim. */
  readonly note: string;
}

/** The typed outcome of a record: recorded, or refused by the consent gate. */
export type RecordObservationResult =
  | { readonly outcome: "recorded"; readonly observation: UserObservation }
  | { readonly outcome: "refused"; readonly refusal: AdMemoryRefusal };

export interface RecordObservationDeps {
  readonly consent: AdMemoryConsentStore;
  readonly observations: UserObservationStore;
  readonly clock: ClockPort;
  readonly generateId: IdGenerator;
}

/**
 * Records one user observation — an explicit user action gated by the
 * `observations` scope consent. The observation carries the closed
 * `user-stated` provenance label (structurally the only value — a user
 * observation can never present itself as source-backed evidence) and,
 * when the user chose it, exactly ONE claim attachment (the only linkage
 * a memory entry can carry; nothing auto-joins). Each record action is a
 * distinct event at its own instant — the lane never deduplicates the
 * user's own words.
 */
export class RecordObservation {
  constructor(private readonly deps: RecordObservationDeps) {}

  async record(input: RecordObservationInput): Promise<RecordObservationResult> {
    const state = await resolveConsentState(this.deps.consent, "observations");
    if (state.state !== "granted") {
      return { outcome: "refused", refusal: refusalFor(state, "observations") };
    }
    const observation: UserObservation = {
      kind: "user-observation",
      id: this.deps.generateId(),
      adRecordId: input.adRecordId,
      ...(input.claimId !== undefined ? { claimId: input.claimId } : {}),
      note: input.note,
      provenance: "user-stated",
      recordedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.observations.append(observation);
    return { outcome: "recorded", observation };
  }
}

// ---------------------------------------------------------------------------
// Use case 6 — listMemory (per-scope consent; never hides a closed scope)
// ---------------------------------------------------------------------------

/** The honest memory listing: consented entries + typed refusal per closed scope. */
export interface ListMemoryResult {
  /**
   * The entries of every scope whose consent stands — saved ads first,
   * then observations (the closed scope-union order), each in its store's
   * deterministic order; byte-equal to the stored records, never grouped,
   * never enriched, never auto-joined across sources.
   */
  readonly entries: readonly AdMemoryEntry[];
  /**
   * One typed refusal per scope that did NOT contribute entries (never
   * consented, or consent revoked) — the never-hide rule: a listing
   * states which memory it is NOT showing and why, as DATA.
   */
  readonly refusals: readonly AdMemoryRefusal[];
}

export interface ListMemoryDeps {
  readonly consent: AdMemoryConsentStore;
  readonly savedAds: SavedAdStore;
  readonly observations: UserObservationStore;
}

/**
 * Lists personal memory — gated by the per-scope consent exactly like
 * every other memory operation: a scope whose consent stands contributes
 * its entries; a scope without a grant or with a revocation contributes
 * one typed refusal row instead (never a silent omission, never a
 * thrown error). The entries are the flat stored records — saved ads
 * then observations — with no cross-entry linkage, no grouping, and no
 * enrichment with source-reported data. Pure read: nothing is mutated.
 */
export class ListMemory {
  constructor(private readonly deps: ListMemoryDeps) {}

  async list(): Promise<ListMemoryResult> {
    const entries: AdMemoryEntry[] = [];
    const refusals: AdMemoryRefusal[] = [];
    for (const scope of AD_MEMORY_SCOPES) {
      const state = await resolveConsentState(this.deps.consent, scope);
      if (state.state !== "granted") {
        refusals.push(refusalFor(state, scope));
        continue;
      }
      if (scope === "saved-ads") {
        entries.push(...(await this.deps.savedAds.list()));
      } else {
        entries.push(...(await this.deps.observations.list()));
      }
    }
    return { entries, refusals };
  }
}
