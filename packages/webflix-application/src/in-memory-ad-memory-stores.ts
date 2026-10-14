/**
 * In-memory Ad Center personal-memory store defaults (P7-AD-MEMORY-1) —
 * the PURE-TEST doubles for the ad-memory seams defined in
 * `./ad-memory.ts`, the in-memory-ads-stores / in-memory-retention-stores
 * precedents carried into the memory lane.
 *
 * Honest boundary, stated plainly: these implementations live in memory
 * ONLY — nothing survives a process restart, and they are per-profile by
 * construction (the composition root instantiates one set per profile;
 * ADR-0003 — no cross-profile data ever). The DURABLE adapters follow the
 * P5-STORES pattern on the local-library storage seam in a LATER order if
 * sanctioned, and are wired by the composition root (P7-COMPOSE lane).
 * The port interfaces in ./ad-memory.ts are the stable seam — swapping
 * these defaults for persistent adapters changes nothing above the ports.
 *
 * Validation honesty: the doubles validate the SHAPE through the 0.13.0
 * contracts schemas on write (typed application-local AdMemoryRuleError,
 * the RetentionRuleError precedent — the lane adds NO shared ErrorCode
 * this order and its refusals are DATA, never thrown) and surface the
 * same honest-absent reads the use cases gate on (`null` for a
 * never-consented scope / a never-saved ad — the pre-action state, not a
 * defect). The doubles do NOT run any cross-entry invariant (there is
 * none to run: the lane's honesty is structural — no linkage fields
 * exist to validate).
 *
 * SEPARATION (phase5-ad-plan §3): this module imports ONLY the ads-memory
 * shapes + the lane's own ports — nothing from any intelligence/ranking
 * module, in either direction, and nothing from the ads store lane.
 */
import type {
  AdMemoryConsent,
  AdMemoryScope,
  SavedAdRecord,
  UserObservation,
} from "webflix-contracts";
import type {
  AdMemoryConsentStore,
  SavedAdStore,
  UserObservationAppendResult,
  UserObservationStore,
} from "./ad-memory";
import {
  assertValidAdMemoryConsent,
  assertValidSavedAdRecord,
  assertValidUserObservation,
} from "./ad-memory";

/** The closed scope union in its declaration order (deterministic listing). */
const SCOPES: readonly AdMemoryScope[] = ["saved-ads", "observations"];

/**
 * In-memory AdMemoryConsentStore (NOT durable — see the module doc).
 * `put` validates the shape (typed AdMemoryRuleError on any violation,
 * never a silently-mangled record) and replaces wholesale for the
 * record's scope; `get` answers null for the honest never-consented
 * state; `list` is deterministic (the closed scope-union order).
 */
export class InMemoryAdMemoryConsentStore implements AdMemoryConsentStore {
  private readonly consents = new Map<AdMemoryScope, AdMemoryConsent>();

  async get(scope: AdMemoryScope): Promise<AdMemoryConsent | null> {
    const stored = this.consents.get(scope);
    return stored === undefined ? null : { ...stored };
  }

  async put(consent: AdMemoryConsent): Promise<void> {
    assertValidAdMemoryConsent(consent);
    this.consents.set(consent.scope, { ...consent });
  }

  async list(): Promise<readonly AdMemoryConsent[]> {
    return SCOPES.filter((scope) => this.consents.has(scope)).map((scope) => ({
      ...this.consents.get(scope)!,
    }));
  }
}

/**
 * In-memory SavedAdStore (NOT durable — see the module doc). Keyed per
 * adRecordId (the put-replaces house semantic — one CURRENT save per ad);
 * `put` validates the shape (typed AdMemoryRuleError), `get` answers null
 * for the honest never-saved state, `delete` removes exactly one save,
 * and listing is deterministic (insertion order — a re-save keeps the
 * save's original position, matching the durable row-order semantic).
 */
export class InMemorySavedAdStore implements SavedAdStore {
  private readonly saves = new Map<string, SavedAdRecord>();

  async put(record: SavedAdRecord): Promise<void> {
    assertValidSavedAdRecord(record);
    this.saves.set(record.adRecordId, { ...record });
  }

  async get(adRecordId: string): Promise<SavedAdRecord | null> {
    const stored = this.saves.get(adRecordId);
    return stored === undefined ? null : { ...stored };
  }

  async list(): Promise<readonly SavedAdRecord[]> {
    return [...this.saves.values()].map((record) => ({ ...record }));
  }

  async delete(adRecordId: string): Promise<boolean> {
    return this.saves.delete(adRecordId);
  }
}

/**
 * In-memory UserObservationStore (NOT durable — see the module doc): the
 * append-only event log of the user's own reports. `append` validates the
 * shape (typed AdMemoryRuleError) and is idempotent-by-id (a stored id
 * re-appends as a duplicate returning the STORED observation — the
 * FeedbackStore house rule); listing is deterministic (insertion order).
 */
export class InMemoryUserObservationStore implements UserObservationStore {
  private readonly observations = new Map<string, UserObservation>();

  async append(observation: UserObservation): Promise<UserObservationAppendResult> {
    assertValidUserObservation(observation);
    const existing = this.observations.get(observation.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing: { ...existing } };
    }
    this.observations.set(observation.id, { ...observation });
    return { outcome: "appended", observation: { ...observation } };
  }

  async list(): Promise<readonly UserObservation[]> {
    return [...this.observations.values()].map((observation) => ({ ...observation }));
  }
}

/** The full in-memory ad-memory store set (one per seam, fresh per profile). */
export interface InMemoryAdMemoryStores {
  readonly consent: InMemoryAdMemoryConsentStore;
  readonly savedAds: InMemorySavedAdStore;
  readonly observations: InMemoryUserObservationStore;
}

/** Creates a fresh set of in-memory ad-memory store doubles (hermetic tests). */
export function createInMemoryAdMemoryStores(): InMemoryAdMemoryStores {
  return {
    consent: new InMemoryAdMemoryConsentStore(),
    savedAds: new InMemorySavedAdStore(),
    observations: new InMemoryUserObservationStore(),
  };
}
