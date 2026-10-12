/**
 * In-memory Ad Center store defaults (P5-STORES row 2) — the PURE-TEST
 * doubles for the ads store ports (./ports.ts), the
 * in-memory-intelligence-stores precedent carried into the ads lane.
 *
 * Honest boundary, stated plainly: these implementations live in memory
 * ONLY — nothing survives a restart, and they are per-profile by
 * construction (the composition root instantiates one set per profile;
 * ADR-0003 — no cross-profile data ever). The DURABLE adapters ship in
 * THIS order on the local-library storage seam (better-sqlite3, own
 * `ad_*` tables, additive migration 0006, exported there for the
 * composition root). The port interfaces in ./ports.ts are the stable
 * seam — swapping defaults for persistent adapters changes nothing above
 * the ports.
 *
 * Validation honesty: the doubles validate the SHAPE through the 0.8.0
 * contracts schemas on write (typed ads/*-invalid errors, the same codes
 * the durable adapters throw) and surface the SAME typed ads/*-absent
 * errors on missing reads — so tests exercise the ports' honest contract
 * on both sides. The doubles do NOT checksum (tamper detection is a
 * serialized-row concern the durable lane owns alone) and do NOT run the
 * domain invariants (the import seam's job): stores persist validated
 * data, seams validate references.
 *
 * SEPARATION (phase5-ad-plan §3): this module imports ONLY the ads shapes
 * + error codes from webflix-contracts and the ads ports — nothing from
 * any intelligence/ranking module, in either direction.
 */
import { ErrorCode, WebFlixError } from "webflix-contracts";
import type {
  AdRecord,
  AdvertiserIdentity,
  Claim,
  EvidenceLink,
  ReviewSignal,
} from "webflix-contracts";
import {
  AdRecordSchema,
  AdvertiserIdentitySchema,
  ClaimSchema,
  EvidenceLinkSchema,
  ReviewSignalSchema,
} from "webflix-contracts";
import type {
  AdRecordStore,
  AdvertiserIdentityStore,
  ClaimStore,
  EvidenceEdgeAppendResult,
  EvidenceEdgeStore,
  ReviewSignalAppendResult,
  ReviewSignalStore,
} from "./ports";

// ---------------------------------------------------------------------------
// Typed error factories (the structural mirrors of the durable lane's)
// ---------------------------------------------------------------------------

function adsAbsent(code: ErrorCode, id: string, what: string): WebFlixError {
  return new WebFlixError({
    code,
    reason: `no stored Ad Center ${what} for id "${id}" — never imported or explicitly removed; import it through ads.import to make it resolvable`,
    retryable: false,
    context: { id },
  });
}

/** The typed shape-violation error (code per family, the durable mirror). */
function adsInvalid(code: ErrorCode, reason: string, subject: string): WebFlixError {
  return new WebFlixError({
    code,
    reason,
    retryable: false,
    context: { subject },
  });
}

// ---------------------------------------------------------------------------
// In-memory doubles
// ---------------------------------------------------------------------------

/** In-memory AdvertiserIdentityStore (NOT durable — see the module doc). */
export class InMemoryAdvertiserIdentityStore implements AdvertiserIdentityStore {
  private readonly identities = new Map<string, AdvertiserIdentity>();

  async put(identity: AdvertiserIdentity): Promise<void> {
    const parsed = AdvertiserIdentitySchema.safeParse(identity);
    if (!parsed.success) {
      throw adsInvalid(
        ErrorCode.AdsRecordInvalid,
        `not a valid AdvertiserIdentity (put): ${parsed.error.message}`,
        "AdvertiserIdentity",
      );
    }
    this.identities.set(parsed.data.id, parsed.data);
  }

  async get(id: string): Promise<AdvertiserIdentity> {
    const stored = this.identities.get(id);
    if (stored === undefined) {
      throw adsAbsent(ErrorCode.AdsIdentityAbsent, id, "identity");
    }
    return stored;
  }

  async list(): Promise<readonly AdvertiserIdentity[]> {
    return [...this.identities.values()];
  }
}

/** In-memory AdRecordStore (NOT durable — see the module doc). */
export class InMemoryAdRecordStore implements AdRecordStore {
  private readonly records = new Map<string, AdRecord>();
  private readonly order: string[] = [];

  async put(record: AdRecord): Promise<void> {
    const parsed = AdRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw adsInvalid(
        ErrorCode.AdsRecordInvalid,
        `not a valid AdRecord (put): ${parsed.error.message}`,
        "AdRecord",
      );
    }
    if (!this.records.has(parsed.data.id)) {
      this.order.push(parsed.data.id);
    }
    this.records.set(parsed.data.id, parsed.data);
  }

  async get(id: string): Promise<AdRecord> {
    const stored = this.records.get(id);
    if (stored === undefined) {
      throw adsAbsent(ErrorCode.AdsRecordAbsent, id, "record");
    }
    return stored;
  }

  async list(): Promise<readonly AdRecord[]> {
    return this.order.map((id) => this.records.get(id)!);
  }

  async listBySourceAdId(source: string, sourceAdId: string): Promise<readonly AdRecord[]> {
    return this.order
      .map((id) => this.records.get(id)!)
      .filter((record) => record.provenance.source === source && record.sourceAdId === sourceAdId);
  }

  async delete(id: string): Promise<boolean> {
    if (!this.records.delete(id)) {
      return false;
    }
    const at = this.order.indexOf(id);
    if (at >= 0) {
      this.order.splice(at, 1);
    }
    return true;
  }
}

/** In-memory ClaimStore (NOT durable — see the module doc). */
export class InMemoryClaimStore implements ClaimStore {
  private readonly claims = new Map<string, Claim>();
  private readonly order: string[] = [];

  async put(claim: Claim): Promise<void> {
    const parsed = ClaimSchema.safeParse(claim);
    if (!parsed.success) {
      throw adsInvalid(
        ErrorCode.AdsClaimInvalid,
        `not a valid Claim (put): ${parsed.error.message}`,
        "Claim",
      );
    }
    if (!this.claims.has(parsed.data.id)) {
      this.order.push(parsed.data.id);
    }
    this.claims.set(parsed.data.id, parsed.data);
  }

  async get(id: string): Promise<Claim> {
    const stored = this.claims.get(id);
    if (stored === undefined) {
      throw adsAbsent(ErrorCode.AdsClaimAbsent, id, "claim");
    }
    return stored;
  }

  async list(): Promise<readonly Claim[]> {
    return this.order.map((id) => this.claims.get(id)!);
  }

  async listByAdRecordId(adRecordId: string): Promise<readonly Claim[]> {
    return this.order
      .map((id) => this.claims.get(id)!)
      .filter((claim) => claim.adRecordId === adRecordId);
  }
}

/** In-memory EvidenceEdgeStore (NOT durable — see the module doc). */
export class InMemoryEvidenceEdgeStore implements EvidenceEdgeStore {
  private readonly edges = new Map<string, EvidenceLink>();
  private readonly order: string[] = [];

  async append(edge: EvidenceLink): Promise<EvidenceEdgeAppendResult> {
    const parsed = EvidenceLinkSchema.safeParse(edge);
    if (!parsed.success) {
      throw adsInvalid(
        ErrorCode.AdsEvidenceInvalid,
        `not a valid EvidenceLink (append): ${parsed.error.message}`,
        "EvidenceLink",
      );
    }
    const existing = this.edges.get(parsed.data.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    this.order.push(parsed.data.id);
    this.edges.set(parsed.data.id, parsed.data);
    return { outcome: "appended", edge: parsed.data };
  }

  async get(id: string): Promise<EvidenceLink> {
    const stored = this.edges.get(id);
    if (stored === undefined) {
      throw adsAbsent(ErrorCode.AdsEvidenceAbsent, id, "evidence edge");
    }
    return stored;
  }

  async list(): Promise<readonly EvidenceLink[]> {
    return this.order.map((id) => this.edges.get(id)!);
  }

  async listByClaim(claimId: string): Promise<readonly EvidenceLink[]> {
    return this.order.map((id) => this.edges.get(id)!).filter((edge) => edge.claimId === claimId);
  }
}

/** In-memory ReviewSignalStore (NOT durable — see the module doc). */
export class InMemoryReviewSignalStore implements ReviewSignalStore {
  private readonly signals = new Map<string, ReviewSignal>();
  private readonly order: string[] = [];

  async append(signal: ReviewSignal): Promise<ReviewSignalAppendResult> {
    const parsed = ReviewSignalSchema.safeParse(signal);
    if (!parsed.success) {
      throw adsInvalid(
        ErrorCode.AdsRecordInvalid,
        `not a valid ReviewSignal (append): ${parsed.error.message}`,
        "ReviewSignal",
      );
    }
    const existing = this.signals.get(parsed.data.id);
    if (existing !== undefined) {
      return { outcome: "duplicate", existing };
    }
    this.order.push(parsed.data.id);
    this.signals.set(parsed.data.id, parsed.data);
    return { outcome: "appended", signal: parsed.data };
  }

  async get(id: string): Promise<ReviewSignal> {
    const stored = this.signals.get(id);
    if (stored === undefined) {
      throw adsAbsent(ErrorCode.AdsReviewSignalAbsent, id, "review signal");
    }
    return stored;
  }

  async list(): Promise<readonly ReviewSignal[]> {
    return this.order.map((id) => this.signals.get(id)!);
  }
}

/** The full in-memory ads store set (one per port, fresh per profile). */
export interface InMemoryAdsStores {
  readonly identities: InMemoryAdvertiserIdentityStore;
  readonly records: InMemoryAdRecordStore;
  readonly claims: InMemoryClaimStore;
  readonly evidenceEdges: InMemoryEvidenceEdgeStore;
  readonly reviewSignals: InMemoryReviewSignalStore;
}

/** Creates a fresh set of in-memory ads store doubles (hermetic tests). */
export function createInMemoryAdsStores(): InMemoryAdsStores {
  return {
    identities: new InMemoryAdvertiserIdentityStore(),
    records: new InMemoryAdRecordStore(),
    claims: new InMemoryClaimStore(),
    evidenceEdges: new InMemoryEvidenceEdgeStore(),
    reviewSignals: new InMemoryReviewSignalStore(),
  };
}
